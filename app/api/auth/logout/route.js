import { handle, ok } from '@/lib/api.js';
import { getSessionUser, endSession } from '@/lib/auth.js';
import { audit } from '@/lib/audit.js';

export const POST = handle(async () => {
  const user = await getSessionUser();
  if (user) audit(user, 'auth.logout', 'sessions', user.id, 'Signed out');
  await endSession();
  return ok({ success: true });
});
