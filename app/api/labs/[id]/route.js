import fs from 'node:fs';
import path from 'node:path';
import { handle, ok, readJson, ApiError } from '@/lib/api.js';
import { getDb, UPLOAD_DIR } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { buildUpdate, todayISO } from '@/lib/util.js';

const STATUSES = ['requested', 'in_progress', 'completed'];
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB (PRD §11: verify type and size)
const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx'];
const MIME_BY_EXT = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function load(db, id) {
  return db
    .prepare(
      `SELECT t.*, p.name AS patient_name, p.patient_code,
              u.name AS requested_by_name, ub.name AS uploaded_by_name
       FROM lab_tests t
       JOIN patients p ON p.id = t.patient_id
       LEFT JOIN users u ON u.id = t.requested_by
       LEFT JOIN users ub ON ub.id = t.uploaded_by
       WHERE t.id = ?`
    )
    .get(id);
}

function safeStoredName(original) {
  const ext = path.extname(String(original || '')).toLowerCase().replace('.', '') || 'txt';
  const base = path
    .basename(String(original || 'report'), path.extname(String(original || 'report')))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'report';
  return `lab-${Date.now()}-${base}.${ext}`;
}

export const GET = handle(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const db = getDb();
  const test = load(db, Number(id));
  if (!test) throw new ApiError(404, 'Lab test not found.');
  if (user.role === 'patient' && patientIdFor(user) !== test.patient_id) {
    throw new ApiError(403, 'You can only view your own laboratory reports.');
  }
  return ok({ lab_test: test });
});

/** Update status / results / attach a report file (multipart or JSON). */
export const PUT = handle(async (req, ctx) => {
  const user = await requireUser(['admin', 'lab']);
  const { id } = await ctx.params;
  const db = getDb();
  const test = load(db, Number(id));
  if (!test) throw new ApiError(404, 'Lab test not found.');

  const contentType = req.headers.get('content-type') || '';
  let body = {};
  let file = null;
  if (contentType.includes('multipart/form-data')) {
    const fd = await req.formData();
    for (const [k, v] of fd.entries()) {
      if (typeof v === 'string') body[k] = v;
    }
    const maybe = fd.get('file');
    if (maybe && typeof maybe === 'object' && typeof maybe.arrayBuffer === 'function') file = maybe;
  } else {
    body = await readJson(req);
  }

  const patch = {};
  const changes = [];

  if (body.status !== undefined && body.status !== test.status) {
    if (!STATUSES.includes(body.status)) throw new ApiError(400, 'Invalid lab status.');
    patch.status = body.status;
    changes.push(`status ${test.status} → ${body.status}`);
    if (body.status === 'completed') patch.completed_at = `${todayISO()} ${new Date().toTimeString().slice(0, 8)}`;
  }
  if (body.result !== undefined) {
    const result = String(body.result).trim();
    if (result.length > 4000) throw new ApiError(400, 'Result text is too long (max 4000 characters).');
    if (result !== test.result) { patch.result = result; changes.push('result'); }
  }
  if (body.referenceRange !== undefined) {
    const rr = String(body.referenceRange).trim();
    if (rr.length > 300) throw new ApiError(400, 'Reference range is too long.');
    if (rr !== test.reference_range) { patch.reference_range = rr; changes.push('reference range'); }
  }
  if (body.notes !== undefined) {
    const notes = String(body.notes).trim();
    if (notes.length > 800) throw new ApiError(400, 'Notes are too long.');
    if (notes !== test.notes) { patch.notes = notes; changes.push('notes'); }
  }

  /* ---- file upload (validated type + size) ---- */
  if (file) {
    const original = String(file.name || 'report.txt');
    const ext = path.extname(original).toLowerCase().replace('.', '');
    if (!ext || !ALLOWED_EXT.includes(ext)) {
      throw new ApiError(400, `Unsupported file type ".${ext}". Allowed: ${ALLOWED_EXT.join(', ')}.`);
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new ApiError(400, `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 5 MB.`);
    }
    if (file.size === 0) throw new ApiError(400, 'The uploaded file is empty.');

    const stored = safeStoredName(original);
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), Buffer.from(await file.arrayBuffer()));

    // remove the previous file (best effort) to avoid orphans
    if (test.file_name) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(test.file_name))); } catch {}
    }
    patch.file_name = stored;
    patch.original_name = original.slice(0, 160);
    patch.file_type = MIME_BY_EXT[ext] || 'application/octet-stream';
    patch.uploaded_by = user.id;
    changes.push(`uploaded ${patch.original_name}`);
  }

  if (!Object.keys(patch).length) throw new ApiError(400, 'Nothing to update.');

  const wantsComplete = patch.status === 'completed' || (patch.status === undefined && test.status === 'completed');
  const hasResult = (patch.result !== undefined ? patch.result : test.result).trim().length > 0;
  const hasFile = patch.file_name || test.file_name;
  if (wantsComplete && !hasResult && !hasFile) {
    throw new ApiError(400, 'Add a result or upload a report file before marking the test as completed.');
  }

  patch.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const upd = buildUpdate('lab_tests', patch, 'id = ?', [test.id]);
  db.prepare(upd.sql).run(...upd.params);

  const action = patch.file_name ? 'lab.upload' : 'lab.result';
  audit(user, action, 'lab_tests', test.id, `${test.test_code} (${test.patient_code}): ${changes.join('; ')}`);
  return ok({ lab_test: load(db, test.id) });
});
