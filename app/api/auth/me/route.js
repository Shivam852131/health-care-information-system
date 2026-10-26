import { NextResponse } from 'next/server';
import { getSessionUser, patientIdFor, publicUser } from '@/lib/auth.js';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  return NextResponse.json({ user: publicUser(user), patientId: patientIdFor(user) });
}
