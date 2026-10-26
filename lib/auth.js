import { cookies } from 'next/headers';
import { getDb } from './db.js';
import { verifyToken, createToken } from './crypto.js';
import { ApiError } from './util.js';

/** Shape a user row for API responses — never leaks the password hash. */
export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

export const SESSION_COOKIE = 'his_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

/**
 * Returns the authenticated active user, or null.
 * The session is a signed, expiring cookie; the user row is re-checked on
 * every request so disabled accounts lose access immediately.
 */
export async function getSessionUser() {
  let token = null;
  try {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value || null;
  } catch {
    return null;
  }
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || !payload.uid) return null;
  const db = getDb();
  const user = db
    .prepare(
      `SELECT id, name, email, phone, role, status, linked_patient_id, linked_doctor_id, last_login, created_at
       FROM users WHERE id = ?`
    )
    .get(payload.uid);
  if (!user || user.status !== 'active') return null;
  return user;
}

/** Server-side role gate — every mutating route calls this. */
export async function requireUser(roles) {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, 'Please sign in to continue.');
  if (roles && roles.length && !roles.includes(user.role)) {
    throw new ApiError(403, 'You do not have permission to perform this action.');
  }
  return user;
}

export async function startSession(user) {
  const store = await cookies();
  const token = createToken({ uid: user.id, role: user.role, exp: Date.now() + SESSION_TTL_MS });
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
    secure: process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === '1',
  });
}

export async function endSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Record-level scoping: a patient user only ever sees the patient row
 * linked to their account (FR-08).
 */
export function patientIdFor(user) {
  if (!user || user.role !== 'patient') return null;
  if (user.linked_patient_id) return user.linked_patient_id;
  const db = getDb();
  const row = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(user.id);
  return row ? row.id : null;
}

/** Capability matrix used both by API routes and by the UI to hide actions. */
export function can(user, action, context = {}) {
  if (!user) return false;
  const role = user.role;
  switch (action) {
    /* patients */
    case 'patient:create': return ['admin', 'receptionist'].includes(role);
    case 'patient:update': return ['admin', 'receptionist'].includes(role);
    case 'patient:view': return ['admin', 'doctor', 'receptionist', 'lab'].includes(role) || context.self === true;
    /* doctors */
    case 'doctor:create': return role === 'admin';
    case 'doctor:update': return role === 'admin' || (role === 'doctor' && context.self === true);
    case 'doctor:view': return ['admin', 'receptionist', 'patient', 'doctor', 'lab'].includes(role);
    /* appointments */
    case 'appointment:book': return ['admin', 'receptionist', 'patient'].includes(role);
    case 'appointment:manage': return ['admin', 'receptionist'].includes(role);
    case 'appointment:complete': return ['admin', 'doctor'].includes(role);
    case 'appointment:cancel': return ['admin', 'receptionist', 'patient'].includes(role) || context.selfDoctor === true;
    /* medical records */
    case 'record:create': return ['admin', 'doctor'].includes(role);
    case 'record:update': return ['admin', 'doctor'].includes(role);
    case 'record:view': return ['admin', 'doctor', 'patient'].includes(role) && (role !== 'patient' || context.self === true);
    /* lab */
    case 'lab:order': return ['admin', 'doctor', 'receptionist'].includes(role);
    case 'lab:result': return ['admin', 'lab'].includes(role);
    case 'lab:view': return ['admin', 'doctor', 'lab', 'patient'].includes(role) && (role !== 'patient' || context.self === true);
    /* prescriptions */
    case 'rx:create': return ['admin', 'doctor'].includes(role);
    case 'rx:view': return ['admin', 'doctor', 'patient'].includes(role) && (role !== 'patient' || context.self === true);
    /* billing */
    case 'invoice:create': return ['admin', 'receptionist'].includes(role);
    case 'invoice:update': return ['admin', 'receptionist'].includes(role);
    case 'payment:record': return ['admin', 'receptionist'].includes(role);
    case 'billing:view': return ['admin', 'receptionist', 'patient'].includes(role) && (role !== 'patient' || context.self === true);
    /* reports & admin */
    case 'report:view': return ['admin', 'doctor', 'receptionist'].includes(role);
    case 'admin:manage': return role === 'admin';
    default: return false;
  }
}
