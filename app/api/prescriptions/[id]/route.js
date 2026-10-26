import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { buildUpdate, safeJson, normalizeMedicines } from '@/lib/util.js';

const STATUSES = ['active', 'completed', 'cancelled'];

function load(db, id) {
  return db
    .prepare(
      `SELECT r.*, p.name AS patient_name, p.patient_code, p.gender AS patient_gender, p.dob AS patient_dob,
              p.allergies AS patient_allergies, p.blood_group, p.phone AS patient_phone,
              d.name AS doctor_name, d.specialization, d.qualification, d.phone AS doctor_phone
       FROM prescriptions r
       JOIN patients p ON p.id = r.patient_id
       JOIN doctors d ON d.id = r.doctor_id
       WHERE r.id = ?`
    )
    .get(id);
}

export const GET = handle(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const db = getDb();
  if (['receptionist', 'lab'].includes(user.role)) throw new ApiError(403, 'You do not have permission to view prescriptions.');

  const rx = load(db, Number(id));
  if (!rx) throw new ApiError(404, 'Prescription not found.');
  if (user.role === 'patient' && patientIdFor(user) !== rx.patient_id) {
    throw new ApiError(403, 'You can only view your own prescriptions.');
  }
  return ok({ prescription: { ...rx, medicines: safeJson(rx.medicines, []) } });
});

export const PUT = handle(async (req, ctx) => {
  const user = await requireUser(['admin', 'doctor']);
  const { id } = await ctx.params;
  const db = getDb();
  const rx = load(db, Number(id));
  if (!rx) throw new ApiError(404, 'Prescription not found.');
  if (user.role === 'doctor' && user.linked_doctor_id !== rx.doctor_id) {
    throw new ApiError(403, 'You can only edit prescriptions you issued.');
  }

  const body = await readJson(req);
  const patch = {};
  const changes = [];

  if (body.medicines !== undefined) {
    const medicines = normalizeMedicines(body.medicines);
    const next = JSON.stringify(medicines);
    if (next !== rx.medicines) { patch.medicines = next; changes.push('medicine list'); }
  }
  if (body.diagnosis !== undefined) {
    const diagnosis = String(body.diagnosis).trim();
    if (diagnosis.length < 3) throw new ApiError(400, 'A diagnosis / indication is required.');
    if (diagnosis !== rx.diagnosis) { patch.diagnosis = diagnosis; changes.push('diagnosis'); }
  }
  if (body.instructions !== undefined) {
    const instructions = String(body.instructions).trim();
    if (instructions.length > 800) throw new ApiError(400, 'Instructions are too long.');
    if (instructions !== rx.instructions) { patch.instructions = instructions; changes.push('instructions'); }
  }
  if (body.followUp !== undefined) {
    const followUp = String(body.followUp).trim();
    if (followUp.length > 120) throw new ApiError(400, 'Follow-up note is too long.');
    if (followUp !== rx.follow_up) { patch.follow_up = followUp; changes.push('follow-up'); }
  }
  if (body.status !== undefined && body.status !== rx.status) {
    if (!STATUSES.includes(body.status)) throw new ApiError(400, 'Invalid prescription status.');
    patch.status = body.status;
    changes.push(`status ${rx.status} → ${body.status}`);
  }

  if (!Object.keys(patch).length) throw new ApiError(400, 'Nothing has changed.');
  patch.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const upd = buildUpdate('prescriptions', patch, 'id = ?', [rx.id]);
  db.prepare(upd.sql).run(...upd.params);

  audit(user, 'prescription.update', 'prescriptions', rx.id, `${rx.rx_code}: ${changes.join('; ')}`);
  const fresh = load(db, rx.id);
  return ok({ prescription: { ...fresh, medicines: safeJson(fresh.medicines, []) } });
});
