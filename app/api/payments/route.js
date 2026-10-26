import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb, insert, getSettings } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { nextCode, todayISO } from '@/lib/util.js';
import { statusFor } from '@/lib/billing.js';

const METHODS = ['cash', 'card', 'upi', 'insurance', 'cheque', 'bank_transfer'];

export const GET = handle(async (req) => {
  const user = await requireUser();
  const db = getDb();
  if (!['admin', 'receptionist'].includes(user.role)) {
    throw new ApiError(403, 'Transaction history is restricted to reception and administrators.');
  }
  const invoiceId = Number(new URL(req.url).searchParams.get('invoiceId') || 0);
  const rows = invoiceId
    ? db.prepare(
        `SELECT py.*, i.invoice_no, p.name AS patient_name, p.patient_code, u.name AS received_by_name
         FROM payments py JOIN invoices i ON i.id = py.invoice_id
         JOIN patients p ON p.id = i.patient_id
         LEFT JOIN users u ON u.id = py.received_by
         WHERE py.invoice_id = ? ORDER BY py.paid_at DESC, py.id DESC`
      ).all(invoiceId)
    : db.prepare(
        `SELECT py.*, i.invoice_no, p.name AS patient_name, p.patient_code, u.name AS received_by_name
         FROM payments py JOIN invoices i ON i.id = py.invoice_id
         JOIN patients p ON p.id = i.patient_id
         LEFT JOIN users u ON u.id = py.received_by
         ORDER BY py.paid_at DESC, py.id DESC LIMIT 300`
      ).all();
  return ok({ payments: rows });
});

/** Record a payment against an invoice (FR-06). */
export const POST = handle(async (req) => {
  const user = await requireUser(['admin', 'receptionist']);
  const db = getDb();
  const body = await readJson(req);

  const invoiceId = Number(body.invoiceId || 0);
  const amount = Math.round(Number(body.amount) * 100) / 100;
  const method = String(body.method || 'cash');
  const reference = String(body.reference || '').trim();

  if (!invoiceId) throw new ApiError(400, 'No invoice selected.');
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, 'Payment amount must be greater than zero.');
  if (amount > 10000000) throw new ApiError(400, 'Payment amount is too large.');
  if (!METHODS.includes(method)) throw new ApiError(400, 'Please choose a valid payment method.');
  if (reference.length > 60) throw new ApiError(400, 'Transaction reference is too long (max 60 characters).');

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) throw new ApiError(404, 'Invoice not found.');

  const balance = Math.max(0, Math.round((invoice.total - invoice.paid_amount) * 100) / 100);
  if (balance <= 0) throw new ApiError(400, `Invoice ${invoice.invoice_no} is already fully paid.`);
  if (amount > balance + 0.001) {
    throw new ApiError(400, `Amount exceeds the outstanding balance (${balance.toFixed(2)}).`);
  }

  const payment_code = nextCode(db, 'payments', 'payment_code', 'PY');
  const id = insert(db, 'payments', {
    payment_code,
    invoice_id: invoiceId,
    amount,
    method,
    reference,
    paid_at: `${todayISO()} ${new Date().toTimeString().slice(0, 8)}`,
    received_by: user.id,
  });

  const paidAgg = db.prepare('SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id = ?').get(invoiceId);
  const paid = Math.round(paidAgg.paid * 100) / 100;
  const status = statusFor(paid, invoice.total);
  db.prepare('UPDATE invoices SET paid_amount = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(paid, status, invoiceId);

  const s = getSettings(db);
  audit(user, 'payment.record', 'payments', id, `${payment_code}: ${(s.currency || '')}${amount.toFixed(2)} ${method} toward ${invoice.invoice_no} (now ${status})`);

  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  const fresh = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  return ok({
    payment,
    invoice: { ...fresh, items: [], balance: Math.max(0, fresh.total - fresh.paid_amount) },
  }, 201);
});
