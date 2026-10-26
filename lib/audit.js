import { getDb } from './db.js';
import { todayISO } from './util.js';

/**
 * Append-only audit trail for important actions (FR-08 / PRD §11).
 * Never stores clinical content beyond a short human-readable reference.
 */
export function audit(user, action, entity = '', entityId = '', detail = '') {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, entity, entity_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      user?.id ?? null,
      user?.name || '',
      user?.role || '',
      action,
      String(entity || ''),
      entityId === null || entityId === undefined ? '' : String(entityId),
      String(detail || '').slice(0, 300),
      `${todayISO()} ${new Date().toTimeString().slice(0, 8)}`
    );
  } catch (e) {
    console.error('[audit] failed to write log', e);
  }
}
