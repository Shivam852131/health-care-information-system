import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb } from '@/lib/db.js';
import { verifyPassword } from '@/lib/crypto.js';
import { startSession, patientIdFor, publicUser } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';

export const POST = handle(async (req) => {
  const { email, password } = await readJson(req);
  const identifier = String(email || '').trim().toLowerCase();
  if (!identifier || !password) throw new ApiError(400, 'Email and password are required.');

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(identifier);

  // Identical error for unknown account vs wrong password (no account enumeration).
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new ApiError(401, 'Invalid email or password.');
  }
  if (user.status !== 'active') {
    throw new ApiError(403, 'This account has been disabled. Please contact your administrator.');
  }

  await startSession(user);
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(
    `${new Date().toISOString().slice(0, 10)} ${new Date().toTimeString().slice(0, 8)}`,
    user.id
  );
  audit(user, 'auth.login', 'sessions', user.id, `Signed in (${user.role})`);

  return ok({ user: publicUser(user), patientId: patientIdFor(user) });
});
