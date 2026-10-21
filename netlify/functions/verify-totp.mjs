import { clearPasswordGateCookie, editorIdentity, hasPasswordGate, json, sameOrigin, sessionCookie } from '../lib/editor-auth.mjs';
import { clearTotp, verifyTotpOrRecovery } from '../lib/totp.mjs';

export default async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  if (!hasPasswordGate(request)) return json({ error: 'Your password check expired. Sign in again.' }, 401);
  try {
    const body = await request.json();
    const email = editorIdentity();
    const result = await verifyTotpOrRecovery(email, typeof body.code === 'string' ? body.code.trim() : '');
    if (!result.valid) return json({ error: 'That authenticator or recovery code is invalid.' }, 401);
    if (result.recovery) {
      await clearTotp(email);
      return json({ ok: true, recoveryUsed: true, remainingRecoveryCodes: result.remaining });
    }
    const response = json({ ok: true }, 200, { 'set-cookie': sessionCookie(email, request) });
    response.headers.append('set-cookie', clearPasswordGateCookie(request));
    return response;
  } catch (error) {
    console.error('Authenticator verification failed:', error.message);
    return json({ error: error.message || 'Could not verify the authenticator code.' }, 503);
  }
};

export const config = { path: '/api/editor/verify-totp', rateLimit: { windowLimit: 10, windowSize: 300, aggregateBy: ['ip', 'domain'] } };
