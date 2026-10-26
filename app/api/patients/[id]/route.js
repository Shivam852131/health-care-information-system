import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb } from '@/lib/db.js';
import { requireUser, patientIdFor, can } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { ageFromDob, isEmail, buildUpdate, safeJson } from '@/lib/util.js';

const cleanPhone = (v) => String(v || '').replace(/[^\d+()\-\s]/g, '').trim().slice(0, 25);

export async function loadDetail(db, id, user) {
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
  if (!patient) throw new ApiError(404, 'Patient not found.');

  const staff = ['admin', 'doctor', 'receptionist', 'lab'].includes(user.role);
  if (user.role === 'patient') {
    const own = patientIdFor(user);
    if (!own || own !== patient.id) throw new ApiError(403, 'You can only view your own medical record.');
  } else if (!staff) {
    throw new ApiError(403, 'You do not have permission to view this record.');
  }

  const scope = {
    patient: patient.id,
    // profile header extras
    doctor: db.prepare(
      `SELECT d.id, d.name, d.specialization FROM doctors d
       JOIN appointments a ON a.doctor_id = d.id WHERE a.patient_id = ?
       GROUP BY d.id ORDER BY MAX(a.date) DESC LIMIT 1`
    ).get(patient.id) || null,
    appointments: db.prepare(
      `SELECT a.*, d.name AS doctor_name, d.specialization
       FROM appointments a JOIN doctors d ON d.id = a.doctor_id
       WHERE a.patient_id = ? ORDER BY a.date DESC, a.time DESC LIMIT 60`
    ).all(patient.id),
    invoices: db.prepare(
      `SELECT * FROM invoices WHERE patient_id = ? ORDER BY issue_date DESC, id DESC`
    ).all(patient.id),
  };

  // Clinical detail is withheld from front-desk and lab roles (FR-08 privacy).
  if (user.role === 'admin' || user.role === 'doctor' || user.role === 'patient') {
    scope.records = db.prepare(
      `SELECT r.*, d.name AS doctor_name, d.specialization
       FROM medical_records r LEFT JOIN doctors d ON d.id = r.doctor_id
       WHERE r.patient_id = ? ORDER BY r.visit_date DESC, r.id DESC`
    ).all(patient.id);
    scope.prescriptions = db.prepare(
      `SELECT p.*, d.name AS doctor_name, d.specialization
       FROM prescriptions p JOIN doctors d ON d.id = p.doctor_id
       WHERE p.patient_id = ? ORDER BY p.issued_date DESC, p.id DESC`
    ).all(patient.id);
    scope.lab_tests = db.prepare(
      `SELECT * FROM lab_tests WHERE patient_id = ? ORDER BY requested_at DESC, id DESC`
    ).all(patient.id);
  } else if (user.role === 'lab') {
    scope.lab_tests = db.prepare(
      `SELECT * FROM lab_tests WHERE patient_id = ? ORDER BY requested_at DESC, id DESC`
    ).all(patient.id);
    scope.records = [];
    scope.prescriptions = [];
  } else {
    scope.records = [];
    scope.prescriptions = [];
    scope.lab_tests = db.prepare(
      `SELECT * FROM lab_tests WHERE patient_id = ? ORDER BY requested_at DESC, id DESC`
    ).all(patient.id);
  }

  for (const inv of scope.invoices) inv.items = safeJson(inv.items, []);
  for (const rx of scope.prescriptions) rx.medicines = safeJson(rx.medicines, []);
  return { ...patient, age: ageFromDob(patient.dob), ...scope };
}

export const GET = handle(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const db = getDb();
  const detail = await loadDetail(db, Number(id), user);
  return ok({ patient: detail });
});

export const PUT = handle(async (req, ctx) => {
  const user = await requireUser(['admin', 'receptionist']);
  const { id } = await ctx.params;
  const db = getDb();
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(Number(id));
  if (!patient) throw new ApiError(404, 'Patient not found.');

  const body = await readJson(req);
  const patch = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) throw new ApiError(400, 'Patient name is required.');
    patch.name = name;
  }
  if (body.dob !== undefined) {
    const dob = String(body.dob).trim();
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new ApiError(400, 'Invalid date of birth.');
    if (dob > new Date().toISOString().slice(0, 10)) throw new ApiError(400, 'Date of birth cannot be in the future.');
    patch.dob = dob;
  }
  if (body.gender !== undefined) patch.gender = String(body.gender).trim();
  if (body.blood_group !== undefined) patch.blood_group = String(body.blood_group).trim();
  if (body.phone !== undefined) patch.phone = cleanPhone(body.phone);
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (email && !isEmail(email)) throw new ApiError(400, 'Invalid email address.');
    patch.email = email;
  }
  if (body.address !== undefined) patch.address = String(body.address).trim();
  if (body.allergies !== undefined) patch.allergies = String(body.allergies).trim() || 'None';
  if (body.emergency_contact !== undefined) patch.emergency_contact = String(body.emergency_contact).trim();
  if (body.notes !== undefined) patch.notes = String(body.notes).trim();
  if (body.status !== undefined) {
    if (!['active', 'inactive'].includes(body.status)) throw new ApiError(400, 'Invalid status.');
    if (user.role !== 'admin') throw new ApiError(403, 'Only an administrator can change account status.');
    patch.status = body.status;
  }

  patch.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const upd = buildUpdate('patients', patch, 'id = ?', [patient.id]);
  if (upd) db.prepare(upd.sql).run(...upd.params);

  audit(user, 'patient.update', 'patients', patient.id, `Updated profile ${patient.patient_code}`);
  const fresh = db.prepare('SELECT * FROM patients WHERE id = ?').get(patient.id);
  return ok({ patient: { ...fresh, age: ageFromDob(fresh.dob) } });
});
