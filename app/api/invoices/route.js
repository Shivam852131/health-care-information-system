import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb, insert, getSettings } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { nextCode, safeJson, todayISO } from '@/lib/util.js';
import { computeInvoice, statusFor } from '@/lib/billing.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['pending', 'partial', 'paid'];

export const GET = handle(async (req) => {
  const user = await requireUser();
  const db = getDb();
  if (!['admin', 'receptionist', 'patient'].includes(user.role)) {
    throw new ApiError(403, 'Billing information is restricted to reception, administrators and patients.');
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status') || 'all';
  const patientId = Number(url.searchParams.get('patientId') || 0);
  const q = (url.searchParams.get('q') || '').trim();

  const where = [];
  const params = [];

  if (user.role === 'patient') {
    const own = patientIdFor(user);
    if (!own) return ok({ invoices: [] });
    where.push('i.patient_id = ?');
    params.push(own);
  }
  if (patientId) { where.push('i.patient_id = ?'); params.push(patientId); }
  if (status !== 'all') {
    if (!STATUSES.includes(status)) throw new ApiError(400, 'Invalid status filter.');
    where.push('i.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(i.invoice_no LIKE ? OR p.name LIKE ? OR p.patient_code LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const rows = db.prepare(
    `SELECT i.*, p.name AS patient_name, p.patient_code, p.phone AS patient_phone,
            (SELECT COUNT(*) FROM payments py WHERE py.invoice_id = i.id) AS payment_count
     FROM invoices i
     JOIN patients p ON p.id = i.patient_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY i.issue_date DESC, i.id DESC
     LIMIT 300`
  ).all(...params).map((r) => ({
    ...r,
    items: safeJson(r.items, []),
    balance: Math.max(0, Math.round((r.total - r.paid_amount) * 100) / 100),
  }));

  const totals = db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN total ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'partial' THEN total ELSE 0 END) AS partial,
       SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) AS paid,
       SUM(paid_amount) AS collected,
       SUM(total) AS billed
     FROM invoices${user.role === 'patient' ? ' WHERE patient_id = ?' : ''}`
  );
  const t = user.role === 'patient' ? totals.get(patientIdFor(user)) : totals.get();

  return ok({
    invoices: rows,
    summary: {
      pending: t.pending || 0,
      partial: t.partial || 0,
      paid: t.paid || 0,
      collected: t.collected || 0,
      billed: t.billed || 0,
      outstanding: Math.max(0, (t.billed || 0) - (t.collected || 0)),
    },
  });
});

export const POST = handle(async (req) => {
  const user = await requireUser(['admin', 'receptionist']);
  const db = getDb();
  const body = await readJson(req);

  const patientId = Number(body.patientId || 0);
  const issueDate = String(body.issueDate || todayISO());
  const dueDate = String(body.dueDate || '').trim();
  const notes = String(body.notes || '').trim();

  if (!patientId) throw new ApiError(400, 'Please select a patient.');
  if (!DATE_RE.test(issueDate)) throw new ApiError(400, 'Invalid issue date.');
  if (dueDate && !DATE_RE.test(dueDate)) throw new ApiError(400, 'Invalid due date.');
  if (notes.length > 400) throw new ApiError(400, 'Notes are too long (max 400 characters).');

  const patient = db.prepare('SELECT id, patient_code, name FROM patients WHERE id = ?').get(patientId);
  if (!patient) throw new ApiError(404, 'Patient not found.');

  const { items, subtotal, discount, total } = computeInvoice(body.items, body.discount);

  const invoice_no = nextCode(db, 'invoices', 'invoice_no', 'INV', true);
  const id = insert(db, 'invoices', {
    invoice_no,
    patient_id: patientId,
    items: JSON.stringify(items),
    subtotal,
    discount,
    total,
    paid_amount: 0,
    status: 'pending',
    issue_date: issueDate,
    due_date: dueDate,
    notes,
    created_by: user.id,
  });

  audit(user, 'invoice.create', 'invoices', id, `${invoice_no} for ${patient.patient_code}: ${getSettings(db).currency || ''}${total.toFixed(2)} across ${items.length} item(s)`);
  const created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  return ok({ invoice: { ...created, items, balance: total } }, 201);
});
