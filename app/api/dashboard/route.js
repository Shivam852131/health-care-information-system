import { handle, ok } from '@/lib/api.js';
import { getDb, getSetting } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { todayISO, safeJson } from '@/lib/util.js';

const q = (db, sql, ...p) => db.prepare(sql).get(...p);
const all = (db, sql, ...p) => db.prepare(sql).all(...p);
/** Unwrap `SELECT COUNT(*) AS c` style rows (or pass a plain number through). */
const one = (row) => {
  if (row && typeof row === 'object') return Number(row.c ?? row.v ?? 0);
  return Number(row || 0);
};

function monthKeys(count) {
  const out = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('en-US', { month: 'short' }) });
  }
  return out;
}

function lastDayKeys(count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = todayISO(-i);
    out.push({ date, label: new Date(`${date}T00:00:00`).toLocaleString('en-US', { weekday: 'short' }) });
  }
  return out;
}

function fillMonths(db) {
  const rows = all(db, `SELECT substr(paid_at, 1, 7) AS m, SUM(amount) AS total FROM payments GROUP BY m`);
  const map = Object.fromEntries(rows.map((r) => [r.m, r.total]));
  return monthKeys(6).map((m) => ({ label: m.label, value: Math.round((map[m.key] || 0) * 100) / 100 }));
}

function fillDays(db, whereSql, params) {
  const rows = all(db, `SELECT date, COUNT(*) AS c FROM appointments WHERE ${whereSql} GROUP BY date`, ...params);
  const map = Object.fromEntries(rows.map((r) => [r.date, r.c]));
  return lastDayKeys(7).map((d) => ({ label: d.label, date: d.date, value: map[d.date] || 0 }));
}

export const GET = handle(async () => {
  const user = await requireUser();
  const db = getDb();
  const today = todayISO();
  const monthPrefix = today.slice(0, 7);
  const payload = { role: user.role, today, kpis: [], charts: {}, lists: {}, notes: [] };

  const apptSelect = `SELECT a.id, a.appointment_code, a.date, a.time, a.status, a.reason,
            p.name AS patient_name, p.patient_code, p.allergies,
            d.name AS doctor_name, d.specialization
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN doctors d ON d.id = a.doctor_id`;

  /* ================================ ADMIN ================================ */
  if (user.role === 'admin') {
    const activePatients = one(q(db, `SELECT COUNT(*) c FROM patients WHERE status = 'active'`));
    const activeDoctors = one(q(db, `SELECT COUNT(*) c FROM doctors WHERE status = 'active'`));
    const todayAppts = one(q(db, `SELECT COUNT(*) c FROM appointments WHERE date = ? AND status = 'scheduled'`, today));
    const doneToday = one(q(db, `SELECT COUNT(*) c FROM appointments WHERE date = ? AND status = 'completed'`, today));
    const pendingInv = q(db, `SELECT COUNT(*) c, COALESCE(SUM(total - paid_amount),0) due FROM invoices WHERE status <> 'paid'`);
    const revenueMonth = one(q(db, `SELECT COALESCE(SUM(amount),0) v FROM payments WHERE paid_at LIKE ?`, `${monthPrefix}%`));
    const pendingLabs = one(q(db, `SELECT COUNT(*) c FROM lab_tests WHERE status <> 'completed'`));
    const usersActive = one(q(db, `SELECT COUNT(*) c FROM users WHERE status = 'active'`));
    const newPatientsMonth = one(q(db, `SELECT COUNT(*) c FROM patients WHERE created_at LIKE ?`, `${monthPrefix}%`));

    payload.kpis = [
      { label: 'Patients registered', value: activePatients, foot: `${newPatientsMonth} added this month`, icon: '👥', tint: '#e5f4fd' },
      { label: 'Today’s appointments', value: todayAppts, foot: `${doneToday} completed so far`, icon: '📅', tint: '#ecfdf9' },
      { label: 'Outstanding dues', value: pendingInv.due, money: true, foot: `${pendingInv.c} unpaid invoice(s)`, icon: '🧾', tint: '#fdf2e0' },
      { label: 'Collected this month', value: revenueMonth, money: true, foot: 'Payments received', icon: '💰', tint: '#e8f8ee' },
      { label: 'Active doctors', value: activeDoctors, foot: `${usersActive} staff accounts`, icon: '🩺', tint: '#f1eafd' },
      { label: 'Lab tests pending', value: pendingLabs, foot: 'Awaiting results', icon: '🧪', tint: '#fdecec' },
    ];

    payload.charts.revenue = fillMonths(db);
    const statusRows = all(db, `SELECT status, COUNT(*) c FROM appointments WHERE date >= ? GROUP BY status`, todayISO(-30));
    payload.charts.apptStatus = [
      { label: 'Scheduled', value: statusRows.find((r) => r.status === 'scheduled')?.c || 0, color: '#0d9488' },
      { label: 'Completed', value: statusRows.find((r) => r.status === 'completed')?.c || 0, color: '#16a34a' },
      { label: 'Cancelled', value: statusRows.find((r) => r.status === 'cancelled')?.c || 0, color: '#dc2626' },
      { label: 'No-show', value: statusRows.find((r) => r.status === 'no_show')?.c || 0, color: '#d97706' },
    ];
    payload.charts.week = fillDays(db, `date >= ?`, [todayISO(-6)]);

    payload.lists.todayAppointments = all(db, `${apptSelect} WHERE a.date = ? ORDER BY a.time ASC LIMIT 8`, today);
    payload.lists.pendingLabs = all(db,
      `SELECT t.id, t.test_code, t.test_name, t.status, t.requested_at, p.name AS patient_name, p.patient_code
       FROM lab_tests t JOIN patients p ON p.id = t.patient_id
       WHERE t.status <> 'completed' ORDER BY t.requested_at ASC LIMIT 5`);
    payload.lists.activity = all(db, `SELECT * FROM audit_logs ORDER BY id DESC LIMIT 7`);
    payload.lists.recentPatients = all(db, `SELECT id, patient_code, name, phone, gender, dob, created_at FROM patients ORDER BY id DESC LIMIT 5`);
    return ok(payload);
  }

  /* ================================ DOCTOR =============================== */
  if (user.role === 'doctor') {
    if (!user.linked_doctor_id) {
      payload.notes.push('Your account is not yet linked to a doctor profile. Ask an administrator to link it.');
      return ok(payload);
    }
    const did = user.linked_doctor_id;
    const todayAppts = all(db, `${apptSelect} WHERE a.doctor_id = ? AND a.date = ? ORDER BY a.time ASC`, did, today);
    const myPatients = one(q(db, `SELECT COUNT(DISTINCT patient_id) c FROM appointments WHERE doctor_id = ?`, did));
    const activeRx = one(q(db, `SELECT COUNT(*) c FROM prescriptions WHERE doctor_id = ? AND status = 'active'`, did));
    const pendingLabs = one(q(db,
      `SELECT COUNT(*) c FROM lab_tests t
       WHERE t.status <> 'completed'
         AND t.patient_id IN (SELECT DISTINCT patient_id FROM appointments WHERE doctor_id = ?)`, did));
    const recordsMonth = one(q(db, `SELECT COUNT(*) c FROM medical_records WHERE doctor_id = ? AND visit_date LIKE ?`, did, `${monthPrefix}%`));
    const upcoming = all(db, `${apptSelect} WHERE a.doctor_id = ? AND a.date > ? AND a.status = 'scheduled' ORDER BY a.date ASC, a.time ASC LIMIT 6`, did, today);

    payload.kpis = [
      { label: 'Today’s schedule', value: todayAppts.filter((a) => a.status === 'scheduled').length, foot: `${todayAppts.filter((a) => a.status === 'completed').length} completed today`, icon: '📅', tint: '#ecfdf9' },
      { label: 'My patients', value: myPatients, foot: 'Distinct patients seen', icon: '👥', tint: '#e5f4fd' },
      { label: 'Active prescriptions', value: activeRx, foot: 'Currently issued', icon: '💊', tint: '#f1eafd' },
      { label: 'Lab results pending', value: pendingLabs, foot: 'Ordered for my patients', icon: '🧪', tint: '#fdf2e0' },
      { label: 'Notes this month', value: recordsMonth, foot: 'Consultations recorded', icon: '📝', tint: '#e8f8ee' },
    ];
    payload.charts.week = fillDays(db, `date >= ? AND doctor_id = ?`, [todayISO(-6), did]);
    payload.lists.todayAppointments = todayAppts;
    payload.lists.upcoming = upcoming;
    payload.lists.pendingLabs = all(db,
      `SELECT t.id, t.test_code, t.test_name, t.status, t.requested_at, p.name AS patient_name, p.patient_code
       FROM lab_tests t JOIN patients p ON p.id = t.patient_id
       WHERE t.status <> 'completed' AND t.patient_id IN (SELECT DISTINCT patient_id FROM appointments WHERE doctor_id = ?)
       ORDER BY t.requested_at ASC LIMIT 5`, did);
    payload.lists.recentRecords = all(db,
      `SELECT r.id, r.record_code, r.visit_date, r.diagnosis, p.name AS patient_name, p.patient_code
       FROM medical_records r JOIN patients p ON p.id = r.patient_id
       WHERE r.doctor_id = ? ORDER BY r.visit_date DESC, r.id DESC LIMIT 5`, did);
    return ok(payload);
  }

  /* ================================ PATIENT ============================== */
  if (user.role === 'patient') {
    const pid = patientIdFor(user);
    if (!pid) {
      payload.notes.push('No patient profile is linked to your account yet. Please contact reception.');
      return ok(payload);
    }
    const next = db.prepare(`${apptSelect} WHERE a.patient_id = ? AND a.date >= ? AND a.status = 'scheduled' ORDER BY a.date ASC, a.time ASC LIMIT 1`).get(pid, today);
    const upcomingCount = one(q(db, `SELECT COUNT(*) c FROM appointments WHERE patient_id = ? AND status = 'scheduled'`, pid));
    const activeRx = all(db,
      `SELECT r.id, r.rx_code, r.issued_date, r.diagnosis, d.name AS doctor_name, d.specialization
       FROM prescriptions r JOIN doctors d ON d.id = r.doctor_id
       WHERE r.patient_id = ? AND r.status = 'active' ORDER BY r.issued_date DESC LIMIT 4`, pid);
    const dues = q(db, `SELECT COUNT(*) c, COALESCE(SUM(total - paid_amount),0) due FROM invoices WHERE patient_id = ? AND status <> 'paid'`, pid);
    const recentLabs = all(db, `SELECT * FROM lab_tests WHERE patient_id = ? ORDER BY requested_at DESC LIMIT 4`, pid);
    const recentRecords = all(db,
      `SELECT r.id, r.record_code, r.visit_date, r.diagnosis, r.treatment, d.name AS doctor_name
       FROM medical_records r LEFT JOIN doctors d ON d.id = r.doctor_id
       WHERE r.patient_id = ? ORDER BY r.visit_date DESC LIMIT 3`, pid);

    payload.kpis = [
      { label: 'Next appointment', value: next ? `${next.date.slice(5)} ${next.time}` : '—', foot: next ? `${next.doctor_name} · ${next.specialization}` : 'No appointment booked', icon: '📅', tint: '#ecfdf9', plain: true },
      { label: 'Upcoming visits', value: upcomingCount, foot: 'Scheduled appointments', icon: '🩺', tint: '#e5f4fd' },
      { label: 'Active prescriptions', value: activeRx.length, foot: 'From your doctors', icon: '💊', tint: '#f1eafd' },
      { label: 'Outstanding bills', value: dues.due, money: true, foot: dues.c ? `${dues.c} invoice(s) due` : 'All bills cleared', icon: '🧾', tint: dues.c ? '#fdf2e0' : '#e8f8ee' },
    ];
    payload.lists.nextAppointment = next || null;
    payload.lists.prescriptions = activeRx;
    payload.lists.recentLabs = recentLabs;
    payload.lists.recentRecords = recentRecords;
    return ok(payload);
  }

  /* ============================ RECEPTIONIST ============================= */
  if (user.role === 'receptionist') {
    const todayAppts = all(db, `${apptSelect} WHERE a.date = ? ORDER BY a.time ASC LIMIT 10`, today);
    const scheduled = one(q(db, `SELECT COUNT(*) c FROM appointments WHERE date = ? AND status = 'scheduled'`, today));
    const newPatients = one(q(db, `SELECT COUNT(*) c FROM patients WHERE created_at LIKE ?`, `${monthPrefix}%`));
    const dues = q(db, `SELECT COUNT(*) c, COALESCE(SUM(total - paid_amount),0) due FROM invoices WHERE status <> 'paid'`);
    const overdue = one(q(db, `SELECT COUNT(*) c FROM invoices WHERE status <> 'paid' AND due_date <> '' AND due_date < ?`, today));
    const totalPatients = one(q(db, `SELECT COUNT(*) c FROM patients`));

    payload.kpis = [
      { label: 'Today’s appointments', value: scheduled, foot: `${todayAppts.length} shown for today`, icon: '📅', tint: '#ecfdf9' },
      { label: 'New patients (month)', value: newPatients, foot: `${totalPatients} total registered`, icon: '➕', tint: '#e5f4fd' },
      { label: 'Outstanding dues', value: dues.due, money: true, foot: `${dues.c} unpaid invoice(s)`, icon: '🧾', tint: '#fdf2e0' },
      { label: 'Overdue invoices', value: overdue, foot: 'Past their due date', icon: '⏰', tint: '#fdecec' },
    ];
    payload.charts.week = fillDays(db, `date >= ?`, [todayISO(-6)]);
    payload.lists.todayAppointments = todayAppts;
    payload.lists.recentPatients = all(db, `SELECT id, patient_code, name, phone, gender, dob, created_at FROM patients ORDER BY id DESC LIMIT 6`);
    return ok(payload);
  }

  /* ================================= LAB ================================= */
  if (user.role === 'lab') {
    const requested = one(q(db, `SELECT COUNT(*) c FROM lab_tests WHERE status = 'requested'`));
    const inProgress = one(q(db, `SELECT COUNT(*) c FROM lab_tests WHERE status = 'in_progress'`));
    const completedToday = one(q(db, `SELECT COUNT(*) c FROM lab_tests WHERE completed_at LIKE ?`, `${today}%`));
    const withFile = one(q(db, `SELECT COUNT(*) c FROM lab_tests WHERE file_name <> ''`));
    const totalTests = one(q(db, `SELECT COUNT(*) c FROM lab_tests`));

    payload.kpis = [
      { label: 'Awaiting start', value: requested, foot: 'Tests requested', icon: '📋', tint: '#e5f4fd' },
      { label: 'In progress', value: inProgress, foot: 'Samples being processed', icon: '🔬', tint: '#fdf2e0' },
      { label: 'Completed today', value: completedToday, foot: 'Reports uploaded', icon: '✅', tint: '#e8f8ee' },
      { label: 'Reports on file', value: withFile, foot: `${totalTests} tests recorded`, icon: '📁', tint: '#f1eafd' },
    ];
    payload.lists.queue = all(db,
      `SELECT t.id, t.test_code, t.test_name, t.status, t.requested_at, t.category, p.name AS patient_name, p.patient_code, p.id AS patient_id
       FROM lab_tests t JOIN patients p ON p.id = t.patient_id
       WHERE t.status <> 'completed' ORDER BY CASE t.status WHEN 'requested' THEN 0 ELSE 1 END, t.requested_at ASC LIMIT 10`);
    payload.lists.recentCompleted = all(db,
      `SELECT t.id, t.test_code, t.test_name, t.completed_at, t.file_name, p.name AS patient_name, p.patient_code
       FROM lab_tests t JOIN patients p ON p.id = t.patient_id
       WHERE t.status = 'completed' ORDER BY t.completed_at DESC LIMIT 5`);
    return ok(payload);
  }

  return ok(payload);
});
