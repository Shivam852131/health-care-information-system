import { ApiError } from './util.js';

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
export const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validate + normalise a weekly availability map:
 * { mon: ['09:00','17:00'], sun: null, ... }
 */
export function normalizeAvailability(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'Schedule must be an object keyed by weekday.');
  }
  const out = {};
  for (const day of DAY_ORDER) {
    const v = input[day] === undefined ? null : input[day];
    if (v === null || v === '' || v === false) {
      out[day] = null;
      continue;
    }
    if (!Array.isArray(v) || v.length !== 2) {
      throw new ApiError(400, `Invalid schedule entry for ${DAY_LABELS[day]}.`);
    }
    const [start, end] = [String(v[0]).trim(), String(v[1]).trim()];
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      throw new ApiError(400, `Times must use 24-hour HH:MM format (e.g. 09:00).`);
    }
    if (start >= end) {
      throw new ApiError(400, `${DAY_LABELS[day]}: opening time must be before closing time.`);
    }
    out[day] = [start, end];
  }
  return out;
}

export function dayKeyForDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return DAY_KEYS[d.getDay()];
}

export function minutesOf(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function hhmmOf(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Build the slot grid for a doctor on a date.
 * Returns { slots:[{time, available, reason}], window, closedReason? }
 */
export function buildSlots({ availability, date, slotMinutes, takenTimes = [], excludeAppointmentId = null, patientBusyTimes = [], nowMinutes = null }) {
  const dayKey = dayKeyForDate(date);
  if (!dayKey) throw new ApiError(400, 'Invalid appointment date.');

  const window = availability ? availability[dayKey] : null;
  if (!window) {
    return { slots: [], closedReason: `The doctor is not available on ${DAY_LABELS[dayKey]}s.`, window: null };
  }

  const [start, end] = window;
  const step = Math.max(5, Math.min(240, Number(slotMinutes) || 30));
  const taken = new Set(takenTimes);
  const mine = new Set(patientBusyTimes);
  const isToday = date === new Date().toISOString().slice(0, 10);
  const cutoff = nowMinutes !== null ? nowMinutes : null;

  const slots = [];
  for (let t = minutesOf(start); t + step <= minutesOf(end); t += step) {
    const time = hhmmOf(t);
    let available = true;
    let reason = '';
    if (taken.has(time)) {
      available = false;
      reason = 'Already booked';
    } else if (mine.has(time)) {
      available = false;
      reason = 'You have another appointment then';
    } else if (isToday && cutoff !== null && t < cutoff + 15) {
      available = false;
      reason = 'Time has passed';
    }
    slots.push({ time, available, reason });
  }
  return { slots, closedReason: null, window };
}
