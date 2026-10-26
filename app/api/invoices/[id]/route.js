import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb, getSettings } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { buildUpdate, safeJson, todayISO } from '@/lib/util.js';
import { computeInvoice, statusFor } from '@/lib/billing.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function load(db, id) {
  const inv = db
    .prepare(
      `SELECT i.*, p.name AS patient_name, p.patient_code, p.phone AS patient_phone,
              p.address AS patient_address, p.dob AS patient_dob, p.gender AS patient_gender
       FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.id = ?`
    )
    .get(id);
  if (!inv) return null;
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at DESC, id DESC').all(inv.id);
  return { ...inv, items: safeJson(inv.items, []), payments, balance: Math.max(0, Math.round((inv.total - inv.paid_amount) * 100) / 100) };
}

export const GET = handle(async (req, ctx) => {
  const user = await requireUser();
  const db = getDb();
  if (!['admin', 'receptionist', 'patient'].includes(user.role)) {
    throw new ApiError(403, 'Billing information is restricted.');
  }
  const { id } = await ctx.params;
  const invoice = load(db, Number(id));
  if (!invoice) throw new ApiError(404, 'Invoice not found.');
  if (user.role === 'patient' && patientIdFor(user) !== invoice.patient_id) {
    throw new ApiError(403, 'You can only view your own invoices.');
  }
  const s = getSettings(db);
  return ok({
    invoice,
    settings: {
      hospital_name: s.hospital_name || '',
      hospital_address: s.hospital_address || '',
      hospital_phone: s.hospital_phone || '',
      hospital_email: s.hospital_email || '',
      currency: s.currency || '$',
    },
    canPay: ['admin', 'receptionist'].includes(user.role) && invoice.balance > 0,
  });
});

export const PUT = handle(async (req, ctx) => {
  const user = await requireUser(['admin', 'receptionist']);
  const db = getDb();
  const { id } = await ctx.params;
  const current = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(id));
  if (!current) throw new ApiError(404, 'Invoice not found.');

  const body = await readJson(req);
  const patch = {};
  const changes = [];

  if (body.items !== undefined || body.discount !== undefined) {
    const items = body.items !== undefined ? body.items : safeJson(current.items, []);
    const discount = body.discount !== undefined ? body.discount : current.discount;
    const calc = computeInvoice(items, discount);
    if (JSON.stringify(calc.items) !== current.items) changes.push('line items');
    if (calc.discount !== current.discount) changes.push('discount');
    patch.items = JSON.stringify(calc.items);
    patch.subtotal = calc.subtotal;
    patch.discount = calc.discount;
    patch.total = calc.total;
  }
  if (body.notes !== undefined) {
    const notes = String(body.notes).trim();
    if (notes.length > 400) throw new ApiError(400, 'Notes are too long.');
    if (notes !== current.notes) { patch.notes = notes; changes.push('notes'); }
  }
  if (body.dueDate !== undefined) {
    const dueDate = String(body.dueDate).trim();
    if (dueDate && !DATE_RE.test(dueDate)) throw new ApiError(400, 'Invalid due date.');
    if (dueDate !== current.due_date) { patch.due_date = dueDate; changes.push('due date'); }
  }
  if (body.issueDate !== undefined) {
    const issueDate = String(body.issueDate);
    if (!DATE_RE.test(issueDate)) throw new ApiError(400, 'Invalid issue date.');
    if (issueDate > todayISO()) throw new ApiError(400, 'Issue date cannot be in the future.');
    if (issueDate !== current.issue_date) { patch.issue_date = issueDate; changes.push('issue date'); }
  }

  if (!Object.keys(patch).length) throw new ApiError(400, 'Nothing has changed.');

  /* keep money fields consistent with recorded payments */
  const paidAgg = db.prepare('SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id = ?').get(current.id);
  const paid = Math.round(paidAgg.paid * 100) / 100;
  const newTotal = patch.total !== undefined ? patch.total : current.total;
  if (paid > newTotal + 0.001) {
    throw new ApiError(400, `Recorded payments (${paid}) already exceed the new invoice total (${newTotal}). Reduce the payment or keep the amount.`);
  }
  patch.paid_amount = paid;
  patch.status = statusFor(paid, newTotal);
  patch.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const upd = buildUpdate('invoices', patch, 'id = ?', [current.id]);
  db.prepare(upd.sql).run(...upd.params);

  audit(user, 'invoice.update', 'invoices', current.id, `${current.invoice_no}: updated ${changes.join(', ')} → total ${newTotal.toFixed(2)} (${patch.status})`);
  return ok({ invoice: load(db, current.id) });
});
