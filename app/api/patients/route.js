import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb, insert } from '@/lib/db.js';
import { requireUser, patientIdFor, can } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { nextCode, isEmail, ageFromDob } from '@/lib/util.js';
import { hashPassword } from '@/lib/crypto.js';

const GENDERS = ['Male', 'Female', 'Other', ''];

function cleanPhone(v) {
  const s = String(v || '').replace(/[^\d+()\-\s]/g, '').trim();
  return s.length <= 25 ? s : s.slice(0, 25);
}

/* ------------------------------- LIST --------------------------------- */

export const GET = handle(async (req) => {
  const user = await requireUser();
  const db = getDb();
  const url = new URL(req.url);
  const search = (url.searchParams.get('search') || '').trim();
  const status = url.searchParams.get('status') || 'all';

  if (user.role === 'patient') {
    const pid = patientIdFor(user);
    const rows = pid ? db.prepare('SELECT * FROM patients WHERE id = ?').all(pid) : [];
    return ok({ patients: rows.map((r) => ({ ...r, age: ageFromDob(r.dob) })) });
  }

  const q = `%${search}%`;
  const rows = db.prepare(
    `SELECT p.*,
       (SELECT MAX(a.date) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'completed') AS last_visit,
       (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'scheduled') AS upcoming
     FROM patients p
     WHERE (p.name LIKE ? OR p.patient_code LIKE ? OR p.phone LIKE ? OR p.email LIKE ?)
       AND (? = 'all' OR p.status = ?)
     ORDER BY p.name COLLATE NOCASE ASC`
  ).all(q, q, q, q, status, status);

  return ok({ patients: rows.map((r) => ({ ...r, age: ageFromDob(r.dob) })) });
});

/* ------------------------------ REGISTER ------------------------------- */

export const POST = handle(async (req) => {
  const user = await requireUser(['admin', 'receptionist']);
  if (!can(user, 'patient:create')) throw new ApiError(403, 'Not allowed.');

  const body = await readJson(req);
  const name = String(body.name || '').trim();
  const dob = String(body.dob || '').trim();
  const gender = String(body.gender || '').trim();
  const phone = cleanPhone(body.phone);
  const email = String(body.email || '').trim().toLowerCase();

  /* --- validation (FR-09) --- */
  if (name.length < 2) throw new ApiError(400, 'Patient name is required (at least 2 characters).');
  if (!/^[A-Za-z .'-]+$/.test(name)) throw new ApiError(400, 'Patient name may only contain letters, spaces, dots and hyphens.');
  if (dob) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new ApiError(400, 'Date of birth must be a valid date.');
    if (dob > new Date().toISOString().slice(0, 10)) throw new ApiError(400, 'Date of birth cannot be in the future.');
  }
  if (email && !isEmail(email)) throw new ApiError(400, 'Please enter a valid email address.');
  if (phone && phone.replace(/\D/g, '').length < 7) throw new ApiError(400, 'Please enter a valid contact number.');

  const db = getDb();

  /* --- duplicate detection (FR-09) --- */
  const dup = db.prepare(
    `SELECT patient_code, name FROM patients
     WHERE status = 'active' AND (
       (? <> '' AND ? <> '' AND lower(phone) = lower(?))
       OR (name = ? AND dob = ? AND dob <> '')
     )`
  ).get(phone, phone, phone, name, dob);
  if (dup) {
    throw new ApiError(
      409,
      `Possible duplicate registration: ${dup.name} (${dup.patient_code}) already matches this phone number or date of birth. Open the existing record instead.`
    );
  }

  /* --- optional portal account --- */
  let account = null;
  if (body.createLogin) {
    const pw = String(body.password || '');
    if (!email) throw new ApiError(400, 'An email address is required to create a login account.');
    if (pw.length < 6) throw new ApiError(400, 'Login password must be at least 6 characters.');
    const exists = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
    if (exists) throw new ApiError(409, 'A user account with this email already exists.');
  }

  const patient_code = nextCode(db, 'patients', 'patient_code', 'PT');
  const patientId = insert(db, 'patients', {
    patient_code,
    name,
    dob,
    gender,
    blood_group: String(body.blood_group || '').trim(),
    phone,
    email,
    address: String(body.address || '').trim(),
    allergies: String(body.allergies || '').trim() || 'None',
    emergency_contact: String(body.emergency_contact || '').trim(),
    notes: String(body.notes || '').trim(),
    status: 'active',
  });

  if (body.createLogin) {
    const userId = insert(db, 'users', {
      name,
      email,
      phone,
      password_hash: hashPassword(body.password),
      role: 'patient',
      status: 'active',
      linked_patient_id: patientId,
    });
    db.prepare('UPDATE patients SET user_id = ? WHERE id = ?').run(userId, patientId);
    account = { id: userId, email };
  }

  audit(user, 'patient.create', 'patients', patientId, `Registered ${patient_code} — ${name}`);
  const created = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  return ok({ patient: { ...created, age: ageFromDob(created.dob) }, account }, 201);
});
