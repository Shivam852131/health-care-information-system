import { handle, ok, ApiError } from '@/lib/api.js';
import { getDb } from '@/lib/db.js';
import { requireUser } from '@/lib/auth.js';

/** Read-only audit trail (FR-08: maintain audit logs for important actions). */
export const GET = handle(async (req) => {
  await requireUser(['admin']);
  const db = getDb();
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const role = url.searchParams.get('role') || 'all';
  const action = url.searchParams.get('action') || 'all';
  const limit = Math.min(500, Number(url.searchParams.get('limit') || 120) || 120);

  const where = [];
  const params = [];
  if (q) {
    where.push('(user_name LIKE ? OR action LIKE ? OR detail LIKE ? OR entity LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (role !== 'all') {
    if (!['admin', 'doctor', 'patient', 'lab', 'receptionist'].includes(role)) throw new ApiError(400, 'Invalid role filter.');
    where.push('user_role = ?');
    params.push(role);
  }
  if (action !== 'all') {
    if (!/^[a-z_.]+$/.test(action)) throw new ApiError(400, 'Invalid action filter.');
    where.push('action LIKE ?');
    params.push(`${action}%`);
  }

  const rows = db.prepare(
    `SELECT * FROM audit_logs
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY id DESC LIMIT ?`
  ).all(...params, limit);

  const actions = db.prepare(`SELECT DISTINCT action FROM audit_logs ORDER BY action LIMIT 60`).all().map((r) => r.action);
  return ok({ logs: rows, actions });
});
