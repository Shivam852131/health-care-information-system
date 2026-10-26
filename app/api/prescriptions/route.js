import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb, insert } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { nextCode, safeJson, todayISO, normalizeMedicines } from '@/lib/util.js';

const STATUSES = ['active', 'completed', 'cancelled'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = handle(async (req) => {
  const user = await requireUser();
  const db = getDb();
  if (['receptionist', 'lab'].includes(user.role)) {
    throw new ApiError(403, 'Prescriptions are restricted to doctors, patients and administrators.');
  }

  const url = new URL(req.url);
  const patientId = Number(url.searchParams.get('patientId') || 0);
  const doctorId = Number(url.searchParams.get('doctorId') || 0);
  const status = url.searchParams.get('status') || 'all';
  const q = (url.searchParams.get('q') || '').trim();

  const where = [];
  const params = [];

  if (user.role === 'patient') {
    const own = patientIdFor(user);
    if (!own) return ok({ prescriptions: [] });
    where.push('r.patient_id = ?');
    params.push(own);
  }
  if (patientId) { where.push('r.patient_id = ?'); params.push(patientId); }
  if (doctorId) { where.push('r.doctor_id = ?'); params.push(doctorId); }
  if (status !== 'all') {
    if (!STATUSES.includes(status)) throw new ApiError(400, 'Invalid status filter.');
    where.push('r.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(r.rx_code LIKE ? OR r.diagnosis LIKE ? OR p.name LIKE ? OR p.patient_code LIKE ? OR d.name LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }

  const rows = db.prepare(
    `SELECT r.*, p.name AS patient_name, p.patient_code, p.gender AS patient_gender, p.dob AS patient_dob,
            p.allergies AS patient_allergies, p.blood_group,
            d.name AS doctor_name, d.specialization, d.qualification
     FROM prescriptions r
     JOIN patients p ON p.id = r.patient_id
     JOIN doctors d ON d.id = r.doctor_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.issued_date DESC, r.id DESC
     LIMIT 300`
  ).all(...params).map((r) => ({ ...r, medicines: safeJson(r.medicines, []) }));

  return ok({ prescriptions: rows });
});

export const POST = handle(async (req) => {
  const user = await requireUser(['admin', 'doctor']);
  const db = getDb();
  const body = await readJson(req);

  const patientId = Number(body.patientId || 0);
  const diagnosis = String(body.diagnosis || '').trim();
  const instructions = String(body.instructions || '').trim();
  const followUp = String(body.followUp || '').trim();
  const issuedDate = String(body.issuedDate || todayISO());
  const medicines = normalizeMedicines(body.medicines);

  if (!patientId) throw new ApiError(400, 'Please select a patient.');
  if (diagnosis.length < 3) throw new ApiError(400, 'A diagnosis / indication is required.');
  if (diagnosis.length > 400) throw new ApiError(400, 'Diagnosis is too long (max 400 characters).');
  if (instructions.length > 800) throw new ApiError(400, 'Instructions are too long (max 800 characters).');
  if (followUp.length > 120) throw new ApiError(400, 'Follow-up note is too long.');
  if (!DATE_RE.test(issuedDate)) throw new ApiError(400, 'Invalid prescription date.');
  if (issuedDate > todayISO()) throw new ApiError(400, 'A prescription cannot be dated in the future.');

  const patient = db.prepare('SELECT id, patient_code, name, allergies FROM patients WHERE id = ?').get(patientId);
  if (!patient) throw new ApiError(404, 'Patient not found.');

  let doctorId = Number(body.doctorId || 0) || null;
  if (user.role === 'doctor') {
    if (!user.linked_doctor_id) throw new ApiError(400, 'Your account is not linked to a doctor profile.');
    doctorId = user.linked_doctor_id;
  }
  if (!doctorId) throw new ApiError(400, 'Please select the prescribing doctor.');
  const doctor = db.prepare('SELECT id, name FROM doctors WHERE id = ?').get(doctorId);
  if (!doctor) throw new ApiError(404, 'Doctor not found.');

  let appointmentId = Number(body.appointmentId || 0) || null;
  if (appointmentId) {
    const appt = db.prepare('SELECT id, patient_id FROM appointments WHERE id = ?').get(appointmentId);
    if (!appt || appt.patient_id !== patientId) {
      throw new ApiError(400, 'The selected appointment does not belong to this patient.');
    }
  }

  const rx_code = nextCode(db, 'prescriptions', 'rx_code', 'RX');
  const id = insert(db, 'prescriptions', {
    rx_code,
    patient_id: patientId,
    doctor_id: doctorId,
    appointment_id: appointmentId,
    diagnosis,
    medicines: JSON.stringify(medicines),
    instructions,
    follow_up: followUp,
    status: 'active',
    issued_date: issuedDate,
    created_by: user.id,
  });

  audit(user, 'prescription.create', 'prescriptions', id, `${rx_code} for ${patient.patient_code} by ${doctor.name} (${medicines.length} medicine${medicines.length > 1 ? 's' : ''})`);
  const created = db
    .prepare(
      `SELECT r.*, p.name AS patient_name, p.patient_code, d.name AS doctor_name, d.specialization, d.qualification
       FROM prescriptions r JOIN patients p ON p.id = r.patient_id JOIN doctors d ON d.id = r.doctor_id
       WHERE r.id = ?`
    )
    .get(id);
  return ok({ prescription: { ...created, medicines } }, 201);
});
