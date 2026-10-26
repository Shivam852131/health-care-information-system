import { handle, ok, ApiError } from '@/lib/api.js';
import { getDb, getSetting } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { safeJson, todayISO } from '@/lib/util.js';
import { buildSlots } from '@/lib/schedule.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/slots?doctorId=1&date=2026-10-25[&patientId=3][&excludeId=12]
 * Returns the live availability grid used by the booking / reschedule forms.
 */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const db = getDb();
  const url = new URL(req.url);

  const doctorId = Number(url.searchParams.get('doctorId'));
  const date = url.searchParams.get('date') || '';
  const excludeId = Number(url.searchParams.get('excludeId') || 0) || null;

  if (!doctorId) throw new ApiError(400, 'Please choose a doctor.');
  if (!DATE_RE.test(date)) throw new ApiError(400, 'Please choose a valid date.');

  const today = todayISO();
  if (date < today) throw new ApiError(400, 'Appointments cannot be booked in the past.');

  const horizon = Number(getSetting(db, 'appointment_horizon_days', '30')) || 30;
  const maxDate = todayISO(horizon);
  if (date > maxDate) throw new ApiError(400, `Bookings open up to ${horizon} days in advance (until ${maxDate}).`);

  const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctorId);
  if (!doctor || doctor.status !== 'active') throw new ApiError(404, 'Doctor not found or inactive.');

  /* Which patient's clash information should we show? */
  let patientId = Number(url.searchParams.get('patientId') || 0) || null;
  if (user.role === 'patient') {
    const own = patientIdFor(user);
    if (patientId && patientId !== own) throw new ApiError(403, 'You can only view your own booking slots.');
    patientId = own;
  } else if (!patientId) {
    patientId = null;
  }

  const takenRows = db
    .prepare(`SELECT id, time FROM appointments WHERE doctor_id = ? AND date = ? AND status = 'scheduled'`)
    .all(doctorId, date)
    .filter((r) => r.id !== excludeId);

  const busyRows = patientId
    ? db
        .prepare(`SELECT id, time FROM appointments WHERE patient_id = ? AND date = ? AND status = 'scheduled'`)
        .all(patientId, date)
        .filter((r) => r.id !== excludeId)
    : [];

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const result = buildSlots({
    availability: safeJson(doctor.availability, {}),
    date,
    slotMinutes: Number(getSetting(db, 'appointment_slot_minutes', '30')) || 30,
    takenTimes: takenRows.map((r) => r.time),
    patientBusyTimes: busyRows.map((r) => r.time),
    excludeAppointmentId: excludeId,
    nowMinutes,
  });

  return ok({
    date,
    doctor: { id: doctor.id, name: doctor.name, specialization: doctor.specialization, fee: doctor.fee },
    window: result.window,
    slots: result.slots,
    closedReason: result.closedReason,
    availableCount: result.slots.filter((s) => s.available).length,
  });
});
