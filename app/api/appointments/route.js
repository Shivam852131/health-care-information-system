import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb, insert, getSetting } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { nextCode, safeJson, todayISO } from '@/lib/util.js';
import { dayKeyForDate, minutesOf, DAY_LABELS } from '@/lib/schedule.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'];

/* --------------------------------- LIST --------------------------------- */

export const GET = handle(async (req) => {
  const user = await requireUser();
  const db = getDb();

  if (user.role === 'lab') throw new ApiError(403, 'Laboratory staff do not manage appointments.');

  const url = new URL(req.url);
  const status = url.searchParams.get('status') || 'all';
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  const doctorId = Number(url.searchParams.get('doctorId') || 0);
  const patientIdParam = Number(url.searchParams.get('patientId') || 0);
  const q = (url.searchParams.get('q') || '').trim();
  const sort = url.searchParams.get('sort') === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(500, Number(url.searchParams.get('limit') || 250) || 250);

  if (status !== 'all' && !STATUSES.includes(status)) throw new ApiError(400, 'Invalid status filter.');

  const where = [];
  const params = [];

  /* record-level scoping (FR-08) */
  if (user.role === 'patient') {
    const own = patientIdFor(user);
    if (!own) return ok({ appointments: [] });
    where.push('a.patient_id = ?');
    params.push(own);
  } else if (user.role === 'doctor') {
    if (!user.linked_doctor_id) return ok({ appointments: [] });
    where.push('a.doctor_id = ?');
    params.push(user.linked_doctor_id);
  }

  if (status !== 'all') { where.push('a.status = ?'); params.push(status); }
  if (DATE_RE.test(from)) { where.push('a.date >= ?'); params.push(from); }
  if (DATE_RE.test(to)) { where.push('a.date <= ?'); params.push(to); }
  if (doctorId) { where.push('a.doctor_id = ?'); params.push(doctorId); }
  if (patientIdParam) { where.push('a.patient_id = ?'); params.push(patientIdParam); }
  if (q) {
    where.push('(p.name LIKE ? OR p.patient_code LIKE ? OR a.appointment_code LIKE ? OR a.reason LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const rows = db.prepare(
    `SELECT a.*,
            p.name AS patient_name, p.patient_code, p.phone AS patient_phone,
            p.gender AS patient_gender, p.dob AS patient_dob, p.allergies AS patient_allergies,
            d.name AS doctor_name, d.specialization, d.fee AS doctor_fee
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN doctors d ON d.id = a.doctor_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.date ${sort}, a.time ${sort}
     LIMIT ?`
  ).all(...params, limit);

  return ok({ appointments: rows });
});

/* --------------------------------- BOOK --------------------------------- */

export const POST = handle(async (req) => {
  const user = await requireUser(['admin', 'receptionist', 'patient']);
  const db = getDb();
  const body = await readJson(req);

  const today = todayISO();
  const slotMinutes = Number(getSetting(db, 'appointment_slot_minutes', '30')) || 30;
  const horizon = Number(getSetting(db, 'appointment_horizon_days', '30')) || 30;

  let patientId = Number(body.patientId || 0);
  const doctorId = Number(body.doctorId || 0);
  const date = String(body.date || '');
  const time = String(body.time || '');
  const reason = String(body.reason || '').trim();
  const notes = String(body.notes || '').trim();

  /* patients can only book for themselves */
  if (user.role === 'patient') {
    const own = patientIdFor(user);
    if (!own) throw new ApiError(400, 'No patient profile is linked to your account. Please contact reception.');
    if (patientId && patientId !== own) throw new ApiError(403, 'You can only book appointments for yourself.');
    patientId = own;
  }

  if (!patientId) throw new ApiError(400, 'Please select a patient.');
  if (!doctorId) throw new ApiError(400, 'Please select a doctor.');
  if (!DATE_RE.test(date)) throw new ApiError(400, 'Please choose a valid appointment date.');
  if (!TIME_RE.test(time)) throw new ApiError(400, 'Please choose a valid appointment time.');
  if (reason.length > 300) throw new ApiError(400, 'Reason is too long (max 300 characters).');

  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  if (!patient) throw new ApiError(404, 'Patient not found.');
  if (patient.status !== 'active') throw new ApiError(400, 'This patient record is inactive.');

  const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctorId);
  if (!doctor || doctor.status !== 'active') throw new ApiError(404, 'Doctor not found or inactive.');

  /* date rules */
  if (date < today) throw new ApiError(400, 'Appointments cannot be booked in the past.');
  if (date > todayISO(horizon)) throw new ApiError(400, `Bookings open up to ${horizon} days in advance.`);
  if (date === today) {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (minutesOf(time) < nowMinutes + 15) throw new ApiError(400, 'Please pick a slot at least 15 minutes from now.');
  }

  /* working hours */
  const dayKey = dayKeyForDate(date);
  const availability = safeJson(doctor.availability, {});
  const window = availability[dayKey];
  if (!window) throw new ApiError(400, `${doctor.name} does not consult on ${DAY_LABELS[dayKey]}s.`);
  const [open, close] = window;
  if (minutesOf(time) < minutesOf(open) || minutesOf(time) + slotMinutes > minutesOf(close)) {
    throw new ApiError(400, `That time is outside ${doctor.name}'s working hours (${open}–${close}).`);
  }
  if (minutesOf(time) % slotMinutes !== 0) {
    throw new ApiError(400, `Appointment times must start on the ${slotMinutes}-minute schedule (e.g. ${open}).`);
  }

  /* conflict prevention (FR-03) */
  const doctorClash = db
    .prepare(`SELECT appointment_code FROM appointments WHERE doctor_id = ? AND date = ? AND time = ? AND status = 'scheduled'`)
    .get(doctorId, date, time);
  if (doctorClash) throw new ApiError(409, `${doctor.name} already has a booking at ${time} on ${date}. Please pick another slot.`);

  const patientClash = db
    .prepare(`SELECT appointment_code FROM appointments WHERE patient_id = ? AND date = ? AND time = ? AND status = 'scheduled'`)
    .get(patientId, date, time);
  if (patientClash) throw new ApiError(409, `${patient.name} already has an appointment at ${time} on ${date} (${patientClash.appointment_code}).`);

  const appointment_code = nextCode(db, 'appointments', 'appointment_code', 'AP');
  const id = insert(db, 'appointments', {
    appointment_code,
    patient_id: patientId,
    doctor_id: doctorId,
    date,
    time,
    reason: reason || 'General consultation',
    notes,
    status: 'scheduled',
    created_by: user.id,
  });

  audit(user, 'appointment.create', 'appointments', id, `${appointment_code}: ${patient.name} with ${doctor.name} on ${date} ${time}`);

  const created = db
    .prepare(
      `SELECT a.*, p.name AS patient_name, p.patient_code, d.name AS doctor_name, d.specialization
       FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id
       WHERE a.id = ?`
    )
    .get(id);
  return ok({ appointment: created }, 201);
});
