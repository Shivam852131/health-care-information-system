import { NextResponse } from 'next/server';
import { ApiError } from './util.js';

/** Success envelope. */
export function ok(data = {}, status = 200) {
  return NextResponse.json({ ...data }, { status });
}

/** Error envelope — the client shows `error` in a toast. */
export function fail(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Wraps a route handler with consistent error handling.
 * Never leaks stack traces or medical data to the client (PRD §11).
 */
export function handle(handler) {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) return fail(err.message, err.status);
      const msg = String(err?.message || '');
      if (/UNIQUE constraint failed/i.test(msg)) {
        return fail('That record conflicts with an existing entry (possible duplicate).', 409);
      }
      if (/FOREIGN KEY constraint failed/i.test(msg)) {
        return fail('Related record not found.', 409);
      }
      console.error('[api]', err);
      return fail('Something went wrong. Please try again.', 500);
    }
  };
}

/** Parse a JSON body defensively (400 on garbage input). */
export async function readJson(req) {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') throw new Error('bad body');
    return body;
  } catch {
    throw new ApiError(400, 'Invalid request body.');
  }
}

export { ApiError };
