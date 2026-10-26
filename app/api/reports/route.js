import { handle, ok, ApiError } from '@/lib/api.js';
import { getDb } from '@/lib/db.js';
import { requireUser } from '@/lib/auth.js';
import { todayISO, ageFromDob, safeJson } from '@/lib/util.js';

const ALLOWED_DAYS = [30, 90, 180, 365];

function monthSeries(fromDate, values) {
  // values: { 'YYYY-MM': number } → array of {label, value} from fromDate to today
  const out = [];
  const start = new Date(`${fromDate}T00:00:00`);
  const now = new Date();
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  let guard = 0;
  while (cursor <= now && guard < 24) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    out.push({ label: cursor.toLocaleString('en-US', { month: 'short' }), value: Math.round((values[key] || 0) * 100) / 100 });
    cursor.setMonth(cursor.getMonth() + 1);
    guard++;
  }
  if (!out.length) out.push({ label: now.toLocaleString('en-US', { month: 'short' }), value: 0 });
  return out;
}

/**
 * GET /api/reports?days=90 — operational + financial summaries (PRD module list).
 */
export const GET = handle(async (req) => {
  const user = await requireUser();
  if (!['admin', 'doctor', 'receptionist'].includes(user.role)) {
    throw new ApiError(403, 'Reports are available to administrators, doctors and reception.');
  }
  const db = getDb();
  const url = new URL(req.url);
  let days = Number(url.searchParams.get('days') || 90);
  if (!ALLOWED_DAYS.includes(days)) days = 90;
  const from = todayISO(-(days - 1));
  const monthPrefix = todayISO().slice(0, 7);

  /* ---- appointments ---- */
  const apptRows = db.prepare(`SELECT status, doctor_id, date FROM appointments WHERE date >= ?`).all(from);
  const byStatusMap = Object.fromEntries(apptRows.map((r) => [r.status, 0]));
  for (const r of apptRows) byStatusMap[r.status] = (byStatusMap[r.status] || 0) + 1;
  const apptStatus = [
    ['Scheduled', byStatusMap.scheduled || 0, '#0d9488'],
    ['Completed', byStatusMap.completed || 0, '#16a34a'],
    ['Cancelled', byStatusMap.cancelled || 0, '#dc2626'],
    ['No-show', byStatusMap.no_show || 0, '#d97706'],
  ].map(([label, value, color]) => ({ label, value, color }));

  const byDoctor = db.prepare(
    `SELECT d.name, d.specialization, COUNT(*) c
     FROM appointments a JOIN doctors d ON d.id = a.doctor_id
     WHERE a.date >= ? GROUP BY d.id ORDER BY c DESC LIMIT 6`
  ).all(from).map((r) => ({ label: r.name.replace(/^Dr\.\s*/, ''), sub: r.specialization, value: r.c }));

  const apptMonthValues = {};
  for (const r of apptRows) {
    const key = String(r.date).slice(0, 7);
    apptMonthValues[key] = (apptMonthValues[key] || 0) + 1;
  }

  /* ---- patients ---- */
  const patients = db.prepare(`SELECT id, gender, dob FROM patients WHERE status = 'active'`).all();
  const newPatients = Number(db.prepare(`SELECT COUNT(*) c FROM patients WHERE created_at >= ?`).get(from).c);
  const genderMap = {};
  for (const p of patients) genderMap[p.gender || 'Unspecified'] = (genderMap[p.gender || 'Unspecified'] || 0) + 1;
  const gender = Object.entries(genderMap).map(([label, value]) => ({ label, value }));
  const buckets = [
    { label: '0–12 yrs', min: 0, max: 12, value: 0 },
    { label: '13–18 yrs', min: 13, max: 18, value: 0 },
    { label: '19–35 yrs', min: 19, max: 35, value: 0 },
    { label: '36–60 yrs', min: 36, max: 60, value: 0 },
    { label: '60+ yrs', min: 61, max: 200, value: 0 },
  ];
  for (const p of patients) {
    const age = ageFromDob(p.dob);
    if (age === null) continue;
    const b = buckets.find((x) => age >= x.min && age <= x.max);
    if (b) b.value++;
  }

  /* ---- laboratory ---- */
  const labRows = db.prepare(`SELECT test_name, status FROM lab_tests WHERE requested_at >= ?`).all(from);
  const labStatus = ['requested', 'in_progress', 'completed'].map((s) => ({
    label: s === 'in_progress' ? 'In progress' : s[0].toUpperCase() + s.slice(1),
    value: labRows.filter((r) => r.status === s).length,
  }));
  const testCount = {};
  for (const r of labRows) testCount[r.test_name] = (testCount[r.test_name] || 0) + 1;
  const topTests = Object.entries(testCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));

  /* ---- billing ---- */
  const invoices = db.prepare(`SELECT items, subtotal, discount, total, paid_amount, status, issue_date FROM invoices WHERE issue_date >= ?`).all(from);
  const billed = invoices.reduce((s, i) => s + i.total, 0);
  const collectedInPeriod = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE paid_at >= ?`).get(from).v;
  const outstanding = db.prepare(`SELECT COALESCE(SUM(total - paid_amount),0) v FROM invoices WHERE status <> 'paid'`).get().v;
  const invStatus = ['pending', 'partial', 'paid'].map((s) => ({ label: s === 'partial' ? 'Partially paid' : s[0].toUpperCase() + s.slice(1), value: invoices.filter((i) => i.status === s).length }));

  const payRows = db.prepare(`SELECT substr(paid_at, 1, 7) AS m, SUM(amount) v FROM payments WHERE paid_at >= ? GROUP BY m`).all(from);
  const payMap = Object.fromEntries(payRows.map((r) => [r.m, r.v]));

  const serviceMap = {};
  for (const inv of invoices) {
    for (const it of safeJson(inv.items, [])) {
      const key = it.description || 'Other';
      if (!serviceMap[key]) serviceMap[key] = { revenue: 0, qty: 0 };
      serviceMap[key].revenue += (it.amount || 0) * (it.qty || 1);
      serviceMap[key].qty += it.qty || 1;
    }
  }
  const topServices = Object.entries(serviceMap)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 6)
    .map(([label, v]) => ({ label, value: Math.round(v.revenue * 100) / 100, qty: v.qty }));

  const rxCount = Number(db.prepare(`SELECT COUNT(*) c FROM prescriptions WHERE issued_date >= ?`).get(from).c);
  const recordCount = Number(db.prepare(`SELECT COUNT(*) c FROM medical_records WHERE visit_date >= ?`).get(from).c);

  return ok({
    period: { days, from, to: todayISO() },
    appointments: {
      total: apptRows.length,
      byStatus: apptStatus,
      byDoctor,
      series: monthSeries(from, apptMonthValues),
      completionRate: apptRows.length ? Math.round(((byStatusMap.completed || 0) / apptRows.length) * 100) : 0,
    },
    patients: {
      total: Number(db.prepare(`SELECT COUNT(*) c FROM patients`).get().c),
      active: patients.length,
      newInPeriod: newPatients,
      gender,
      ageBuckets: buckets.map(({ label, value }) => ({ label, value })),
    },
    labs: {
      total: labRows.length,
      byStatus: labStatus,
      topTests,
    },
    billing: {
      billed: Math.round(billed * 100) / 100,
      collected: Math.round(collectedInPeriod * 100) / 100,
      outstanding: Math.round(outstanding * 100) / 100,
      invoiceCount: invoices.length,
      byStatus: invStatus,
      revenueSeries: monthSeries(from, payMap),
      topServices,
    },
    clinical: { prescriptions: rxCount, records: recordCount },
    generatedAt: new Date().toISOString(),
  });
});
