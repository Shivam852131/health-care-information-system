import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb } from '@/lib/db.js';
import { requireUser } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { buildUpdate, safeJson, isEmail } from '@/lib/util.js';
import { normalizeAvailability } from '@/lib/schedule.js';

export const GET = handle(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const db = getDb();
  const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(Number(id));
  if (!doctor) throw new ApiError(404, 'Doctor not found.');

  const isAdmin = user.role === 'admin';
  const isSelf = user.role === 'doctor' && doctor.user_id === user.id;
  if (!['admin', 'doctor', 'receptionist', 'patient', 'lab'].includes(user.role)) {
    throw new ApiError(403, 'You do not have permission to view this profile.');
  }

  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    today_count: db.prepare(`SELECT COUNT(*) c FROM appointments WHERE doctor_id = ? AND date = ? AND status = 'scheduled'`).get(doctor.id, today).c,
    upcoming_count: db.prepare(`SELECT COUNT(*) c FROM appointments WHERE doctor_id = ? AND status = 'scheduled'`).get(doctor.id).c,
    patient_count: db.prepare(`SELECT COUNT(DISTINCT patient_id) c FROM appointments WHERE doctor_id = ?`).get(doctor.id).c,
    completed_count: db.prepare(`SELECT COUNT(*) c FROM appointments WHERE doctor_id = ? AND status = 'completed'`).get(doctor.id).c,
  };

  const upcoming = db.prepare(
    `SELECT a.id, a.appointment_code, a.date, a.time, a.status, a.reason,
            p.name AS patient_name, p.patient_code
     FROM appointments a JOIN patients p ON p.id = a.patient_id
     WHERE a.doctor_id = ? AND a.date >= ? AND a.status = 'scheduled'
     ORDER BY a.date ASC, a.time ASC LIMIT 12`
  ).all(doctor.id, today);

  return ok({
    doctor: { ...doctor, availability: safeJson(doctor.availability, {}) },
    stats,
    upcoming,
    permissions: { canEdit: isAdmin || isSelf, canFullEdit: isAdmin },
  });
});

export const PUT = handle(async (req, ctx) => {
  const user = await requireUser(['admin', 'doctor']);
  const { id } = await ctx.params;
  const db = getDb();
  const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(Number(id));
  if (!doctor) throw new ApiError(404, 'Doctor not found.');

  const isAdmin = user.role === 'admin';
  const isSelf = doctor.user_id === user.id;
  if (!isAdmin && !isSelf) throw new ApiError(403, 'You can only edit your own profile.');

  const body = await readJson(req);
  const patch = {};

  if (body.availability !== undefined) {
    const availability = normalizeAvailability(body.availability);
    if (!Object.values(availability || {}).some(Boolean)) {
      throw new ApiError(400, 'Working hours are required for at least one day.');
    }
    patch.availability = JSON.stringify(availability);
  }
  if (body.phone !== undefined) patch.phone = String(body.phone).trim();
  if (body.qualification !== undefined) patch.qualification = String(body.qualification).trim();

  if (isAdmin) {
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2 || !/^[A-Za-z .'-]+$/.test(name)) throw new ApiError(400, 'Invalid doctor name.');
      patch.name = name;
    }
    if (body.specialization !== undefined) {
      if (!String(body.specialization).trim()) throw new ApiError(400, 'Specialization is required.');
      patch.specialization = String(body.specialization).trim();
    }
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (email && !isEmail(email)) throw new ApiError(400, 'Invalid email address.');
      patch.email = email;
    }
    if (body.fee !== undefined) {
      const fee = Number(body.fee);
      if (!Number.isFinite(fee) || fee < 0 || fee > 100000) throw new ApiError(400, 'Invalid consultation fee.');
      patch.fee = fee;
    }
    if (body.status !== undefined) {
      if (!['active', 'inactive'].includes(body.status)) throw new ApiError(400, 'Invalid status.');
      patch.status = body.status;
    }
  }

  if (!Object.keys(patch).length) throw new ApiError(400, 'Nothing to update.');
  patch.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const upd = buildUpdate('doctors', patch, 'id = ?', [doctor.id]);
  db.prepare(upd.sql).run(...upd.params);

  audit(user, 'doctor.update', 'doctors', doctor.id, `Updated profile of ${doctor.name}${patch.availability ? ' (schedule changed)' : ''}`);
  const fresh = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctor.id);
  return ok({ doctor: { ...fresh, availability: safeJson(fresh.availability, {}) } });
});
