import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb, insert } from '@/lib/db.js';
import { requireUser, can } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { isEmail, buildUpdate, safeJson } from '@/lib/util.js';
import { hashPassword } from '@/lib/crypto.js';
import { normalizeAvailability } from '@/lib/schedule.js';

export const GET = handle(async () => {
  const user = await requireUser();
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const rows = db.prepare(
    `SELECT d.*,
       u.email AS login_email, u.status AS login_status,
       (SELECT COUNT(*) FROM appointments a WHERE a.doctor_id = d.id AND a.date = ? AND a.status = 'scheduled') AS today_count,
       (SELECT COUNT(*) FROM appointments a WHERE a.doctor_id = d.id AND a.status = 'scheduled') AS upcoming_count,
       (SELECT COUNT(DISTINCT a.patient_id) FROM appointments a WHERE a.doctor_id = d.id) AS patient_count
     FROM doctors d
     LEFT JOIN users u ON u.id = d.user_id
     ORDER BY d.name COLLATE NOCASE ASC`
  ).all(today);

  const doctors = rows.map((r) => ({
    ...r,
    availability: safeJson(r.availability, {}),
    canEdit: user.role === 'admin' || (user.role === 'doctor' && r.user_id === user.id),
  }));
  return ok({ doctors });
});

export const POST = handle(async (req) => {
  const user = await requireUser(['admin']);
  if (!can(user, 'doctor:create')) throw new ApiError(403, 'Only administrators can add doctors.');

  const body = await readJson(req);
  const db = getDb();

  const name = String(body.name || '').trim();
  const specialization = String(body.specialization || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const fee = Number(body.fee);

  if (name.length < 2 || !/^[A-Za-z .'-]+$/.test(name)) throw new ApiError(400, 'Please enter a valid doctor name (letters only).');
  if (!specialization) throw new ApiError(400, 'Specialization is required.');
  if (!Number.isFinite(fee) || fee < 0 || fee > 100000) throw new ApiError(400, 'Consultation fee must be a number between 0 and 100,000.');
  if (email && !isEmail(email)) throw new ApiError(400, 'Please enter a valid email address.');

  const availability = normalizeAvailability(body.availability) || {};
  if (!Object.values(availability).some(Boolean)) {
    throw new ApiError(400, 'Set working hours for at least one day of the week.');
  }

  if (email) {
    const dup = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
    if (dup) throw new ApiError(409, 'A user account with this email already exists.');
  }
  if (body.createLogin && email && String(body.password || '').length < 6) {
    throw new ApiError(400, 'Login password must be at least 6 characters.');
  }

  const doctor_code = `DR-${String(db.prepare('SELECT COUNT(*) AS c FROM doctors').get().c + 1).padStart(4, '0')}`;
  let userId = null;
  if (email && body.createLogin) {
    userId = insert(db, 'users', {
      name, email, phone: String(body.phone || '').trim(),
      password_hash: hashPassword(body.password), role: 'doctor', status: 'active',
    });
  }

  const doctorId = insert(db, 'doctors', {
    doctor_code, user_id: userId, name, specialization,
    qualification: String(body.qualification || '').trim(),
    phone: String(body.phone || '').trim(), email,
    fee, availability: JSON.stringify(availability), status: 'active',
  });
  if (userId) db.prepare('UPDATE users SET linked_doctor_id = ? WHERE id = ?').run(doctorId, userId);

  audit(user, 'doctor.create', 'doctors', doctorId, `Added ${specialization} specialist ${name}`);
  const fresh = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctorId);
  return ok({ doctor: { ...fresh, availability: safeJson(fresh.availability, {}) } }, 201);
});
