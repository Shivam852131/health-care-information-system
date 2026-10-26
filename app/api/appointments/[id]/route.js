import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb, getSetting } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { buildUpdate, safeJson, todayISO } from '@/lib/util.js';
import { dayKeyForDate, minutesOf, DAY_LABELS } from '@/lib/schedule.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'];

const STATUS_RIGHTS = {
  patient: ['cancelled'],
  doctor: ['completed', 'cancelled', 'no_show'],
  receptionist: STATUSES,
  admin: STATUSES,
};

function load(db, id) {
  return db
    .prepare(
      `SELECT a.*, p.name AS patient_name, p.patient_code, p.phone AS patient_phone,
              d.name AS doctor_name, d.specialization, d.fee AS doctor_fee
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       WHERE a.id = ?`
    )
    .get(id);
}

export const GET = handle(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const db = getDb();
  const appt = load(db, Number(id));
  if (!appt) throw new ApiError(404, 'Appointment not found.');
  assertVisible(user, appt);
  return ok({ appointment: appt });
});

function assertVisible(user, appt) {
  if (user.role === 'patient') {
    const own = patientIdFor(user);
    if (own !== appt.patient_id) throw new ApiError(403, 'You can only view your own appointments.');
  } else if (user.role === 'doctor') {
    if (user.linked_doctor_id !== appt.doctor_id) throw new ApiError(403, 'This appointment is not assigned to you.');
  } else if (!['admin', 'receptionist'].includes(user.role)) {
    throw new ApiError(403, 'You do not have permission to manage appointments.');
  }
}

export const PUT = handle(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const db = getDb();

  if (user.role === 'lab') throw new ApiError(403, 'Laboratory staff do not manage appointments.');

  const appt = load(db, Number(id));
  if (!appt) throw new ApiError(404, 'Appointment not found.');
  assertVisible(user, appt);

  const body = await readJson(req);
  const patch = {};
  const changes = [];
  const today = todayISO();
  const slotMinutes = Number(getSetting(db, 'appointment_slot_minutes', '30')) || 30;
  const horizon = Number(getSetting(db, 'appointment_horizon_days', '30')) || 30;

  /* ---- status update ---- */
  if (body.status !== undefined && body.status !== null && body.status !== appt.status) {
    const status = String(body.status);
    if (!STATUSES.includes(status)) throw new ApiError(400, 'Invalid appointment status.');
    const allowed = STATUS_RIGHTS[user.role] || [];
    if (!allowed.includes(status)) {
      throw new ApiError(403, `Your role cannot mark an appointment as ${status.replace('_', ' ')}.`);
    }
    if (status === 'completed' && appt.date > today) {
      throw new ApiError(400, 'Appointments can only be completed on or after their scheduled date.');
    }
    patch.status = status;
    changes.push(`status ${appt.status} → ${status}`);
  }

  /* ---- reschedule ---- */
  const wantsReschedule = (body.date !== undefined && body.date !== appt.date) || (body.time !== undefined && body.time !== appt.time);
  if (wantsReschedule) {
    if (!['admin', 'receptionist', 'patient'].includes(user.role)) {
      throw new ApiError(403, 'This role can update appointment status only. Ask reception to reschedule.');
    }
    if (!['scheduled', 'cancelled'].includes(appt.status)) {
      throw new ApiError(400, 'Only scheduled or cancelled appointments can be rescheduled.');
    }

    const date = body.date !== undefined ? String(body.date) : appt.date;
    const time = body.time !== undefined ? String(body.time) : appt.time;
    if (!DATE_RE.test(date)) throw new ApiError(400, 'Invalid appointment date.');
    if (!TIME_RE.test(time)) throw new ApiError(400, 'Invalid appointment time.');
    if (date < today) throw new ApiError(400, 'Appointments cannot be moved into the past.');
    if (date > todayISO(horizon)) throw new ApiError(400, `Bookings only open up to ${horizon} days in advance.`);
    if (date === today) {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      if (minutesOf(time) < nowMinutes + 15) throw new ApiError(400, 'Please pick a slot at least 15 minutes from now.');
    }

    const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(appt.doctor_id);
    const dayKey = dayKeyForDate(date);
    const window = safeJson(doctor?.availability || '{}', {})[dayKey];
    if (!window) throw new ApiError(400, `${appt.doctor_name} does not consult on ${DAY_LABELS[dayKey]}s.`);
    if (minutesOf(time) < minutesOf(window[0]) || minutesOf(time) + slotMinutes > minutesOf(window[1])) {
      throw new ApiError(400, `That time is outside working hours (${window[0]}–${window[1]}).`);
    }

    const docClash = db
      .prepare(`SELECT appointment_code FROM appointments WHERE doctor_id = ? AND date = ? AND time = ? AND status = 'scheduled' AND id <> ?`)
      .get(appt.doctor_id, date, time, appt.id);
    if (docClash) throw new ApiError(409, `${appt.doctor_name} already has a booking at ${time} on ${date}.`);

    const patClash = db
      .prepare(`SELECT appointment_code FROM appointments WHERE patient_id = ? AND date = ? AND time = ? AND status = 'scheduled' AND id <> ?`)
      .get(appt.patient_id, date, time, appt.id);
    if (patClash) throw new ApiError(409, `${appt.patient_name} already has another appointment at ${time} on ${date} (${patClash.appointment_code}).`);

    if (date !== appt.date || time !== appt.time) {
      patch.date = date;
      patch.time = time;
      changes.push(`rescheduled ${appt.date} ${appt.time} → ${date} ${time}`);
    }
    if (appt.status === 'cancelled') patch.status = 'scheduled';
  }

  /* ---- free-text fields ---- */
  if (body.reason !== undefined && ['admin', 'receptionist'].includes(user.role)) {
    const reason = String(body.reason).trim();
    if (reason && reason.length <= 300 && reason !== appt.reason) {
      patch.reason = reason;
      changes.push('reason updated');
    }
  }
  if (body.notes !== undefined && ['admin', 'receptionist', 'doctor'].includes(user.role)) {
    const notes = String(body.notes).trim();
    if (notes !== appt.notes) {
      patch.notes = notes;
      changes.push('clinical notes updated');
    }
  }

  if (!Object.keys(patch).length) throw new ApiError(400, 'Nothing to update.');
  patch.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const upd = buildUpdate('appointments', patch, 'id = ?', [appt.id]);
  db.prepare(upd.sql).run(...upd.params);

  audit(user, 'appointment.update', 'appointments', appt.id, `${appt.appointment_code}: ${changes.join('; ')}`);
  return ok({ appointment: load(db, appt.id) });
});
