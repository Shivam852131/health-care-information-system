import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb } from '@/lib/db.js';
import { requireUser, publicUser } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { buildUpdate, ROLES } from '@/lib/util.js';
import { hashPassword } from '@/lib/crypto.js';

export const PUT = handle(async (req, ctx) => {
  const admin = await requireUser(['admin']);
  const { id } = await ctx.params;
  const db = getDb();
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!target) throw new ApiError(404, 'User not found.');
  if (target.id === admin.id) {
    throw new ApiError(400, 'You cannot modify your own account from this screen (safety guard).');
  }

  const body = await readJson(req);
  const patch = {};
  const changes = [];

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2 || !/^[A-Za-z .'-]+$/.test(name)) throw new ApiError(400, 'Please enter a valid name.');
    if (name !== target.name) { patch.name = name; changes.push('name'); }
  }
  if (body.phone !== undefined) {
    patch.phone = String(body.phone).trim().slice(0, 25);
    if (patch.phone !== target.phone) changes.push('phone');
  }
  if (body.status !== undefined && body.status !== target.status) {
    if (!['active', 'inactive'].includes(body.status)) throw new ApiError(400, 'Invalid account status.');
    patch.status = body.status;
    changes.push(`status → ${body.status}`);
  }
  if (body.password !== undefined && body.password !== '') {
    if (String(body.password).length < 6) throw new ApiError(400, 'New password must be at least 6 characters.');
    patch.password_hash = hashPassword(body.password);
    changes.push('password reset');
  }

  /* ---- role + record links ---- */
  let newRole = target.role;
  if (body.role !== undefined && body.role !== target.role) {
    newRole = String(body.role);
    if (!ROLES.includes(newRole)) throw new ApiError(400, 'Invalid role.');
    patch.role = newRole;
    changes.push(`role ${target.role} → ${newRole}`);
  }

  let linkPatient = target.linked_patient_id;
  let linkDoctor = target.linked_doctor_id;
  if (body.patientId !== undefined) linkPatient = Number(body.patientId) || null;
  if (body.doctorId !== undefined) linkDoctor = Number(body.doctorId) || null;
  if (newRole !== 'patient') linkPatient = null;
  if (newRole !== 'doctor') linkDoctor = null;
  if (newRole === 'patient' && !linkPatient) throw new ApiError(400, 'Select the patient record this login belongs to.');
  if (newRole === 'doctor' && !linkDoctor) throw new ApiError(400, 'Select the doctor profile this login belongs to.');

  if (linkPatient && linkPatient !== target.linked_patient_id) {
    const p = db.prepare('SELECT id, name, user_id FROM patients WHERE id = ?').get(linkPatient);
    if (!p) throw new ApiError(404, 'Patient record not found.');
    if (p.user_id && p.user_id !== target.id) throw new ApiError(409, `${p.name} is already linked to another login.`);
    changes.push('patient link');
  }
  if (linkDoctor && linkDoctor !== target.linked_doctor_id) {
    const d = db.prepare('SELECT id, name, user_id FROM doctors WHERE id = ?').get(linkDoctor);
    if (!d) throw new ApiError(404, 'Doctor profile not found.');
    if (d.user_id && d.user_id !== target.id) throw new ApiError(409, `${d.name} is already linked to another login.`);
    changes.push('doctor link');
  }

  if (body.role !== undefined) {
    patch.linked_patient_id = linkPatient;
    patch.linked_doctor_id = linkDoctor;
  } else if (body.patientId !== undefined || body.doctorId !== undefined) {
    patch.linked_patient_id = linkPatient;
    patch.linked_doctor_id = linkDoctor;
  }

  if (!Object.keys(patch).length) throw new ApiError(400, 'Nothing has changed.');
  const upd = buildUpdate('users', patch, 'id = ?', [target.id]);
  db.prepare(upd.sql).run(...upd.params);

  /* keep the reverse link on the clinical record in sync */
  if (Object.keys(patch).some((k) => ['linked_patient_id', 'linked_doctor_id', 'role'].includes(k))) {
    db.prepare('UPDATE patients SET user_id = NULL WHERE user_id = ? AND id IS NOT ?').run(target.id, linkPatient ?? -1);
    if (linkPatient) db.prepare('UPDATE patients SET user_id = ? WHERE id = ?').run(target.id, linkPatient);
    db.prepare('UPDATE doctors SET user_id = NULL WHERE user_id = ? AND id IS NOT ?').run(target.id, linkDoctor ?? -1);
    if (linkDoctor) db.prepare('UPDATE doctors SET user_id = ? WHERE id = ?').run(target.id, linkDoctor);
  }

  audit(admin, 'user.update', 'users', target.id, `${target.email}: ${changes.join(', ') || 'updated'}`);
  return ok({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)) });
});
