import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb, insert } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { nextCode } from '@/lib/util.js';

const STATUSES = ['requested', 'in_progress', 'completed'];

export const GET = handle(async (req) => {
  const user = await requireUser();
  const db = getDb();
  const url = new URL(req.url);

  const status = url.searchParams.get('status') || 'all';
  const patientId = Number(url.searchParams.get('patientId') || 0);
  const q = (url.searchParams.get('q') || '').trim();
  if (status !== 'all' && !STATUSES.includes(status)) throw new ApiError(400, 'Invalid status filter.');

  const where = [];
  const params = [];
  const countWhere = [];
  const countParams = [];

  if (user.role === 'patient') {
    const own = patientIdFor(user);
    if (!own) return ok({ lab_tests: [] });
    where.push('t.patient_id = ?');
    params.push(own);
    countWhere.push('t.patient_id = ?');
    countParams.push(own);
  }
  if (patientId) {
    where.push('t.patient_id = ?');
    params.push(patientId);
    countWhere.push('t.patient_id = ?');
    countParams.push(patientId);
  }
  if (status !== 'all') {
    where.push('t.status = ?');
    params.push(status);
  }
  if (q) {
    const like = `%${q}%`;
    const clause = '(t.test_name LIKE ? OR t.test_code LIKE ? OR t.category LIKE ? OR p.name LIKE ? OR p.patient_code LIKE ?)';
    where.push(clause);
    params.push(like, like, like, like, like);
    countWhere.push(clause);
    countParams.push(like, like, like, like, like);
  }

  const rows = db.prepare(
    `SELECT t.*, p.name AS patient_name, p.patient_code, p.phone AS patient_phone,
            u.name AS requested_by_name, ub.name AS uploaded_by_name
     FROM lab_tests t
     JOIN patients p ON p.id = t.patient_id
     LEFT JOIN users u ON u.id = t.requested_by
     LEFT JOIN users ub ON ub.id = t.uploaded_by
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE t.status WHEN 'requested' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
              t.requested_at DESC
     LIMIT 400`
  ).all(...params);

  const countsWhere = countWhere.length ? `WHERE ${countWhere.join(' AND ')}` : '';
  const counts = db.prepare(
    `SELECT
       COUNT(DISTINCT CASE WHEN t.status = 'requested' THEN t.id END) AS requested,
       COUNT(DISTINCT CASE WHEN t.status = 'in_progress' THEN t.id END) AS in_progress,
       COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id END) AS completed
     FROM lab_tests t
     JOIN patients p ON p.id = t.patient_id
     ${countsWhere}`
  ).get(...countParams);

  return ok({ lab_tests: rows, counts: { requested: counts.requested || 0, in_progress: counts.in_progress || 0, completed: counts.completed || 0 } });
});

/** Order a new laboratory test (FR-05). */
export const POST = handle(async (req) => {
  const user = await requireUser(['admin', 'doctor', 'receptionist']);
  const db = getDb();
  const body = await readJson(req);

  const patientId = Number(body.patientId || 0);
  const testName = String(body.testName || '').trim();
  const category = String(body.category || 'General').trim() || 'General';
  const referenceRange = String(body.referenceRange || '').trim();
  const notes = String(body.notes || '').trim();

  if (!patientId) throw new ApiError(400, 'Please select a patient.');
  if (testName.length < 2) throw new ApiError(400, 'Test name is required.');
  if (testName.length > 160) throw new ApiError(400, 'Test name is too long (max 160 characters).');
  if (referenceRange.length > 300) throw new ApiError(400, 'Reference range is too long.');
  if (notes.length > 600) throw new ApiError(400, 'Notes are too long.');

  const patient = db.prepare('SELECT id, patient_code, name FROM patients WHERE id = ?').get(patientId);
  if (!patient) throw new ApiError(404, 'Patient not found.');

  const test_code = nextCode(db, 'lab_tests', 'test_code', 'LB');
  const id = insert(db, 'lab_tests', {
    test_code,
    patient_id: patientId,
    test_name: testName,
    category,
    status: 'requested',
    requested_by: user.id,
    reference_range: referenceRange,
    notes,
  });

  audit(user, 'lab.order', 'lab_tests', id, `${test_code} ${testName} for ${patient.patient_code}`);
  const created = db.prepare('SELECT * FROM lab_tests WHERE id = ?').get(id);
  return ok({ lab_test: created }, 201);
});
