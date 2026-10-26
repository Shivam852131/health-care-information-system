import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { buildUpdate, todayISO } from '@/lib/util.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function load(db, id) {
  return db
    .prepare(
      `SELECT r.*, p.name AS patient_name, p.patient_code, p.gender AS patient_gender, p.dob AS patient_dob,
              d.name AS doctor_name, d.specialization, u.name AS updated_by_name
       FROM medical_records r
       JOIN patients p ON p.id = r.patient_id
       LEFT JOIN doctors d ON d.id = r.doctor_id
       LEFT JOIN users u ON u.id = r.updated_by
       WHERE r.id = ?`
    )
    .get(id);
}

export const GET = handle(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const db = getDb();
  const record = load(db, Number(id));
  if (!record) throw new ApiError(404, 'Record not found.');

  if (user.role === 'patient') {
    if (patientIdFor(user) !== record.patient_id) throw new ApiError(403, 'You can only view your own records.');
  } else if (user.role === 'doctor') {
    /* doctors read the history of patients they are involved with */
  } else if (!['admin'].includes(user.role)) {
    throw new ApiError(403, 'You do not have permission to view clinical records.');
  }
  return ok({ record });
});

export const PUT = handle(async (req, ctx) => {
  const user = await requireUser(['admin', 'doctor']);
  const { id } = await ctx.params;
  const db = getDb();
  const record = load(db, Number(id));
  if (!record) throw new ApiError(404, 'Record not found.');

  if (user.role === 'doctor' && user.linked_doctor_id !== record.doctor_id) {
    throw new ApiError(403, 'You can only edit consultations you recorded.');
  }

  const body = await readJson(req);
  const patch = {};
  const changes = [];

  if (body.visitDate !== undefined) {
    const visitDate = String(body.visitDate);
    if (!DATE_RE.test(visitDate)) throw new ApiError(400, 'Invalid visit date.');
    if (visitDate > todayISO()) throw new ApiError(400, 'The visit date cannot be in the future.');
    if (visitDate !== record.visit_date) { patch.visit_date = visitDate; changes.push('visit date'); }
  }
  if (body.diagnosis !== undefined) {
    const diagnosis = String(body.diagnosis).trim();
    if (diagnosis.length < 3) throw new ApiError(400, 'A diagnosis is required.');
    if (diagnosis.length > 400) throw new ApiError(400, 'Diagnosis is too long (max 400 characters).');
    if (diagnosis !== record.diagnosis) { patch.diagnosis = diagnosis; changes.push('diagnosis'); }
  }
  if (body.treatment !== undefined) {
    const treatment = String(body.treatment).trim();
    if (treatment.length > 1200) throw new ApiError(400, 'Treatment notes are too long.');
    if (treatment !== record.treatment) { patch.treatment = treatment; changes.push('treatment'); }
  }
  if (body.notes !== undefined) {
    const notes = String(body.notes).trim();
    if (notes.length > 2000) throw new ApiError(400, 'Notes are too long.');
    if (notes !== record.notes) { patch.notes = notes; changes.push('notes'); }
  }

  if (!Object.keys(patch).length) throw new ApiError(400, 'Nothing has changed.');

  patch.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  patch.updated_by = user.id;

  const upd = buildUpdate('medical_records', patch, 'id = ?', [record.id]);
  db.prepare(upd.sql).run(...upd.params);

  audit(user, 'record.update', 'medical_records', record.id, `${record.record_code}: updated ${changes.join(', ')} (timestamp + author recorded)`);
  return ok({ record: load(db, record.id) });
});
