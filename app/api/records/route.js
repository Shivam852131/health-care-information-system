import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb, insert } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { nextCode, todayISO, safeJson } from '@/lib/util.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = handle(async (req) => {
  const user = await requireUser();
  const db = getDb();

  if (['receptionist', 'lab'].includes(user.role)) {
    throw new ApiError(403, 'Clinical records are restricted to doctors, patients and administrators.');
  }

  const url = new URL(req.url);
  const patientId = Number(url.searchParams.get('patientId') || 0);
  const doctorId = Number(url.searchParams.get('doctorId') || 0);
  const q = (url.searchParams.get('q') || '').trim();

  const where = [];
  const params = [];

  if (user.role === 'patient') {
    const own = patientIdFor(user);
    if (!own) return ok({ records: [] });
    where.push('r.patient_id = ?');
    params.push(own);
  }
  if (patientId) { where.push('r.patient_id = ?'); params.push(patientId); }
  if (doctorId) { where.push('r.doctor_id = ?'); params.push(doctorId); }
  if (q) {
    where.push('(r.diagnosis LIKE ? OR r.treatment LIKE ? OR r.record_code LIKE ? OR p.name LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const rows = db.prepare(
    `SELECT r.*, p.name AS patient_name, p.patient_code, p.gender AS patient_gender, p.dob AS patient_dob,
            d.name AS doctor_name, d.specialization,
            u.name AS updated_by_name
     FROM medical_records r
     JOIN patients p ON p.id = r.patient_id
     LEFT JOIN doctors d ON d.id = r.doctor_id
     LEFT JOIN users u ON u.id = r.updated_by
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.visit_date DESC, r.id DESC
     LIMIT 400`
  ).all(...params);

  return ok({ records: rows });
});

export const POST = handle(async (req) => {
  const user = await requireUser(['admin', 'doctor']);
  const db = getDb();
  const body = await readJson(req);

  const patientId = Number(body.patientId || 0);
  const visitDate = String(body.visitDate || todayISO());
  const diagnosis = String(body.diagnosis || '').trim();
  const treatment = String(body.treatment || '').trim();
  const notes = String(body.notes || '').trim();

  if (!patientId) throw new ApiError(400, 'Please select a patient.');
  if (!DATE_RE.test(visitDate)) throw new ApiError(400, 'Please choose a valid visit date.');
  if (visitDate > todayISO()) throw new ApiError(400, 'The visit date cannot be in the future.');
  if (diagnosis.length < 3) throw new ApiError(400, 'A diagnosis is required (at least 3 characters).');
  if (diagnosis.length > 400) throw new ApiError(400, 'Diagnosis is too long (max 400 characters).');
  if (treatment.length > 1200) throw new ApiError(400, 'Treatment notes are too long (max 1200 characters).');
  if (notes.length > 2000) throw new ApiError(400, 'Notes are too long (max 2000 characters).');

  const patient = db.prepare('SELECT id, patient_code, name FROM patients WHERE id = ?').get(patientId);
  if (!patient) throw new ApiError(404, 'Patient not found.');

  /* doctors record their own consultations; admins can attribute to any doctor */
  let doctorId = Number(body.doctorId || 0) || null;
  if (user.role === 'doctor') {
    if (!user.linked_doctor_id) throw new ApiError(400, 'Your account is not linked to a doctor profile.');
    doctorId = user.linked_doctor_id;
  }
  if (doctorId) {
    const doc = db.prepare('SELECT id FROM doctors WHERE id = ?').get(doctorId);
    if (!doc) throw new ApiError(404, 'Doctor not found.');
  }

  const record_code = nextCode(db, 'medical_records', 'record_code', 'MR');
  const id = insert(db, 'medical_records', {
    record_code,
    patient_id: patientId,
    doctor_id: doctorId,
    visit_date: visitDate,
    diagnosis,
    treatment,
    notes,
    created_by: user.id,
    updated_by: null,
  });

  audit(user, 'record.create', 'medical_records', id, `${record_code} for ${patient.patient_code}: ${diagnosis.slice(0, 80)}`);
  const created = db
    .prepare(
      `SELECT r.*, p.name AS patient_name, p.patient_code, d.name AS doctor_name, d.specialization
       FROM medical_records r JOIN patients p ON p.id = r.patient_id
       LEFT JOIN doctors d ON d.id = r.doctor_id WHERE r.id = ?`
    )
    .get(id);
  return ok({ record: created }, 201);
});
