import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb, insert } from '@/lib/db.js';
import { requireUser, publicUser } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { isEmail, ROLES } from '@/lib/util.js';
import { hashPassword } from '@/lib/crypto.js';

export const GET = handle(async () => {
  const user = await requireUser(['admin']);
  const db = getDb();
  const rows = db.prepare(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.linked_patient_id, u.linked_doctor_id,
            u.last_login, u.created_at,
            p.patient_code, d.doctor_code, d.specialization
     FROM users u
     LEFT JOIN patients p ON p.id = u.linked_patient_id
     LEFT JOIN doctors d ON d.id = u.linked_doctor_id
     ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'doctor' THEN 1 WHEN 'receptionist' THEN 2 WHEN 'lab' THEN 3 ELSE 4 END,
              u.name COLLATE NOCASE ASC`
  ).all();
  return ok({ users: rows, selfId: user.id });
});

/** Create a staff / patient portal account. */
export const POST = handle(async (req) => {
  const user = await requireUser(['admin']);
  const db = getDb();
  const body = await readJson(req);

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const role = String(body.role || '');
  const password = String(body.password || '');
  const patientId = Number(body.patientId || 0) || null;
  const doctorId = Number(body.doctorId || 0) || null;

  if (name.length < 2 || !/^[A-Za-z .'-]+$/.test(name)) throw new ApiError(400, 'Please enter a valid name (letters only).');
  if (!isEmail(email)) throw new ApiError(400, 'A valid email address is required — it is used to sign in.');
  if (!ROLES.includes(role)) throw new ApiError(400, 'Please choose a valid role.');
  if (password.length < 6) throw new ApiError(400, 'Password must be at least 6 characters.');
  if (db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email)) {
    throw new ApiError(409, 'A user with this email already exists.');
  }

  if (role === 'patient') {
    if (!patientId) throw new ApiError(400, 'Link this login to a patient record.');
    const p = db.prepare('SELECT id, name, user_id FROM patients WHERE id = ?').get(patientId);
    if (!p) throw new ApiError(404, 'Patient record not found.');
    if (p.user_id) throw new ApiError(409, `${p.name} already has a portal account.`);
  }
  if (role === 'doctor') {
    if (!doctorId) throw new ApiError(400, 'Link this login to a doctor profile.');
    const d = db.prepare('SELECT id, name, user_id FROM doctors WHERE id = ?').get(doctorId);
    if (!d) throw new ApiError(404, 'Doctor profile not found.');
    if (d.user_id) throw new ApiError(409, `${d.name} already has a login account.`);
  }

  const id = insert(db, 'users', {
    name, email, phone, role,
    password_hash: hashPassword(password),
    status: 'active',
    linked_patient_id: role === 'patient' ? patientId : null,
    linked_doctor_id: role === 'doctor' ? doctorId : null,
  });

  if (role === 'patient' && patientId) db.prepare('UPDATE patients SET user_id = ? WHERE id = ?').run(id, patientId);
  if (role === 'doctor' && doctorId) db.prepare('UPDATE doctors SET user_id = ? WHERE id = ?').run(id, doctorId);

  audit(user, 'user.create', 'users', id, `Created ${role} account for ${name} (${email})`);
  return ok({ user: { ...publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) } }, 201);
});
