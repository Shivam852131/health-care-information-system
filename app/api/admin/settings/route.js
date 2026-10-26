import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb, getSettings } from '@/lib/db.js';
import { requireUser } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';

const ALLOWED_KEYS = ['hospital_name', 'hospital_address', 'hospital_phone', 'hospital_email', 'currency', 'appointment_slot_minutes', 'appointment_horizon_days'];

export const GET = handle(async () => {
  await requireUser(['admin']);
  const db = getDb();
  return ok({ settings: getSettings(db) });
});

export const PUT = handle(async (req) => {
  const user = await requireUser(['admin']);
  const db = getDb();
  const body = await readJson(req);

  const next = {};
  for (const key of ALLOWED_KEYS) {
    if (body[key] !== undefined) next[key] = String(body[key]).trim();
  }
  if (!Object.keys(next).length) throw new ApiError(400, 'No settings were provided.');

  if (next.hospital_name !== undefined && !next.hospital_name) throw new ApiError(400, 'Hospital name cannot be empty.');
  if (next.hospital_name && next.hospital_name.length > 120) throw new ApiError(400, 'Hospital name is too long.');
  if (next.hospital_address && next.hospital_address.length > 240) throw new ApiError(400, 'Address is too long.');
  if (next.hospital_phone && next.hospital_phone.length > 40) throw new ApiError(400, 'Phone is too long.');
  if (next.hospital_email && next.hospital_email.length > 80) throw new ApiError(400, 'Email is too long.');
  if (next.currency && next.currency.length > 6) throw new ApiError(400, 'Currency symbol must be 6 characters or fewer.');
  if (next.appointment_slot_minutes !== undefined) {
    const n = Number(next.appointment_slot_minutes);
    if (!Number.isInteger(n) || n < 5 || n > 240) throw new ApiError(400, 'Slot length must be between 5 and 240 minutes.');
    next.appointment_slot_minutes = String(n);
  }
  if (next.appointment_horizon_days !== undefined) {
    const n = Number(next.appointment_horizon_days);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw new ApiError(400, 'Booking horizon must be between 1 and 365 days.');
    next.appointment_horizon_days = String(n);
  }

  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [key, value] of Object.entries(next)) stmt.run(key, value);

  audit(user, 'settings.update', 'settings', '', `Updated: ${Object.keys(next).join(', ')}`);
  return ok({ settings: getSettings(db) });
});
