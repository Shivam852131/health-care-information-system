import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getDb, UPLOAD_DIR } from '@/lib/db.js';
import { requireUser, patientIdFor } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';
import { ApiError } from '@/lib/util.js';

/**
 * GET /api/files/lab/[id] — authorised, audited download of a lab report file.
 */
export async function GET(req, ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const db = getDb();
    const test = db.prepare('SELECT * FROM lab_tests WHERE id = ?').get(Number(id));
    if (!test) throw new ApiError(404, 'Report not found.');

    if (user.role === 'patient') {
      if (patientIdFor(user) !== test.patient_id) throw new ApiError(403, 'You can only download your own reports.');
    } else if (!['admin', 'doctor', 'lab'].includes(user.role)) {
      throw new ApiError(403, 'Your role does not have access to report files.');
    }

    if (!test.file_name) throw new ApiError(404, 'No file has been uploaded for this test yet.');

    // basename() blocks any path traversal — only the stored name is honoured.
    const full = path.join(UPLOAD_DIR, path.basename(test.file_name));
    if (!fs.existsSync(full)) throw new ApiError(404, 'The stored file is missing.');

    const data = fs.readFileSync(full);
    const original = String(test.original_name || test.file_name).replace(/["\\\r\n]/g, '');
    audit(user, 'lab.download', 'lab_tests', test.id, `Downloaded ${test.test_code} file (${test.patient_code})`);

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': test.file_type || 'application/octet-stream',
        'Content-Length': String(data.length),
        'Content-Disposition': `attachment; filename="${original}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[files]', err);
    return NextResponse.json({ error: 'Download failed.' }, { status: 500 });
  }
}
