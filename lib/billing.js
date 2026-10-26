import { ApiError } from './util.js';

/** Validate line items and compute totals server-side (never trust client totals). */
export function computeInvoice(rawItems, rawDiscount) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw new ApiError(400, 'Add at least one billable line item.');
  if (rawItems.length > 40) throw new ApiError(400, 'An invoice can contain at most 40 line items.');
  const items = rawItems.map((it, i) => {
    const description = String(it?.description || '').trim();
    const qty = Math.round(Number(it?.qty));
    const amount = Number(it?.amount);
    if (!description) throw new ApiError(400, `Item #${i + 1}: description is required.`);
    if (description.length > 160) throw new ApiError(400, `Item #${i + 1}: description is too long.`);
    if (!Number.isFinite(qty) || qty < 1 || qty > 999) throw new ApiError(400, `Item #${i + 1}: quantity must be between 1 and 999.`);
    if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) throw new ApiError(400, `Item #${i + 1}: amount must be between 0 and 10,000,000.`);
    return { description, qty, amount: Math.round(amount * 100) / 100 };
  });
  const subtotal = Math.round(items.reduce((s, it) => s + it.qty * it.amount, 0) * 100) / 100;
  let discount = Number(rawDiscount || 0);
  if (!Number.isFinite(discount) || discount < 0) throw new ApiError(400, 'Discount must be zero or more.');
  if (discount > subtotal) throw new ApiError(400, `Discount (${discount}) cannot exceed the subtotal (${subtotal}).`);
  discount = Math.round(discount * 100) / 100;
  const total = Math.round((subtotal - discount) * 100) / 100;
  return { items, subtotal, discount, total };
}

/** Invoice lifecycle derived from recorded payments (FR-06). */
export function statusFor(paid, total) {
  if (total > 0 && paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'pending';
}
