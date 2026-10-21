import { editorIdentity, json, passwordGateCookie, sameOrigin, verifyEditorPassword } from '../lib/editor-auth.mjs';
import { hasTotp } from '../lib/totp.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  try {
    const body = await request.json();
    if (!verifyEditorPassword(body?.password)) return json({ error: 'The editor password is incorrect.' }, 401);
    const email = editorIdentity();
    return json({ ok: true, totpEnabled: await hasTotp(email) }, 200, { 'set-cookie': passwordGateCookie(request) });
  } catch (error) {
    return json({ error: error.message || 'Could not verify the editor password.' }, 503);
  }
};

export const config = {
  path: '/api/editor/verify-password',
  rateLimit: { windowLimit: 10, windowSize: 300, aggregateBy: ['ip', 'domain'] },
};
