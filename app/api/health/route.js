import { handle, ok } from '@/lib/api.js';
import { getDb } from '@/lib/db.js';

const TABLES = [
  'users', 'patients', 'doctors', 'appointments', 'medical_records',
  'lab_tests', 'prescriptions', 'invoices', 'payments', 'audit_logs',
];

/** Lightweight health/readiness check used by the runbook and smoke tests. */
export const GET = handle(async () => {
  const db = getDb();
  const counts = {};
  for (const t of TABLES) {
    counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  }
  return ok({ status: 'ok', node: process.version, counts });
});
