/* Small shared helpers — no external dependencies. */

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** SQLite accepts null / number / string / bigint only — normalise JS values. */
export function norm(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/** INSERT helper that returns the new row id. */
export function buildInsert(table, obj) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return { sql, params: keys.map((k) => norm(obj[k])) };
}

/** UPDATE helper (skips undefined values). */
export function buildUpdate(table, obj, whereClause, whereParams = []) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  if (!keys.length) return null;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const sql = `UPDATE ${table} SET ${sets} WHERE ${whereClause}`;
  return { sql, params: [...keys.map((k) => norm(obj[k])), ...whereParams] };
}

/** Next sequential code such as PT-0007 / INV-2026-0042. */
export function nextCode(db, table, column, prefix, withYear = false) {
  let rows = [];
  try {
    rows = db.prepare(`SELECT ${column} AS v FROM ${table}`).all();
  } catch {
    rows = [];
  }
  let max = 0;
  for (const r of rows) {
    const m = String(r.v || '').match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const year = withYear ? `${new Date().getFullYear()}-` : '';
  return `${prefix}-${year}${String(max + 1).padStart(4, '0')}`;
}

export function safeJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
}

export function ageFromDob(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

export function todayISO(offsetDays = 0) {
  const x = new Date();
  x.setDate(x.getDate() + offsetDays);
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${mm}-${dd}`;
}

export function nowLocal() {
  const x = new Date();
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  const hh = String(x.getHours()).padStart(2, '0');
  const mi = String(x.getMinutes()).padStart(2, '0');
  return `${x.getFullYear()}-${mm}-${dd} ${hh}:${mi}`;
}

export function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const ROLES = ['admin', 'doctor', 'patient', 'lab', 'receptionist'];

/** Validate + normalise prescription medicine rows (FR-07). */
export function normalizeMedicines(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new ApiError(400, 'Add at least one medicine to the prescription.');
  if (raw.length > 25) throw new ApiError(400, 'A prescription can contain at most 25 medicines.');
  return raw.map((m, i) => {
    const row = {
      name: String(m?.name || '').trim(),
      strength: String(m?.strength || '').trim(),
      dosage: String(m?.dosage || '').trim(),
      frequency: String(m?.frequency || '').trim(),
      duration: String(m?.duration || '').trim(),
      notes: String(m?.notes || '').trim(),
    };
    if (!row.name) throw new ApiError(400, `Medicine #${i + 1}: name is required.`);
    if (row.name.length > 120) throw new ApiError(400, `Medicine #${i + 1}: name is too long.`);
    if (row.strength.length > 40) throw new ApiError(400, `Medicine #${i + 1}: strength is too long.`);
    if (row.dosage.length > 60) throw new ApiError(400, `Medicine #${i + 1}: dosage is too long.`);
    if (row.frequency.length > 80) throw new ApiError(400, `Medicine #${i + 1}: frequency is too long.`);
    if (row.duration.length > 60) throw new ApiError(400, `Medicine #${i + 1}: duration is too long.`);
    if (row.notes.length > 160) throw new ApiError(400, `Medicine #${i + 1}: note is too long.`);
    return row;
  });
}

export const ROLE_LABELS = {
  admin: 'Administrator',
  doctor: 'Doctor',
  patient: 'Patient',
  lab: 'Laboratory Staff',
  receptionist: 'Receptionist',
};

export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'];
export const INVOICE_STATUSES = ['pending', 'partial', 'paid'];
export const LAB_STATUSES = ['requested', 'in_progress', 'completed'];
