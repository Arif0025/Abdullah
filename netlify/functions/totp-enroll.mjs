import { clearPasswordGateCookie, editorIdentity, hasPasswordGate, json, sameOrigin, sessionCookie } from '../lib/editor-auth.mjs';
import { finishTotpEnrollment } from '../lib/totp.mjs';

export default async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  if (!hasPasswordGate(request)) return json({ error: 'Your password check expired. Sign in again.' }, 401);
  try {
    const body = await request.json();
    const email = editorIdentity();
    const recoveryCodes = await finishTotpEnrollment(email, typeof body.code === 'string' ? body.code.trim() : '');
    if (!recoveryCodes) return json({ error: 'That authenticator code is invalid or the setup expired. Try again.' }, 401);
    const response = json({ ok: true, recoveryCodes }, 200, { 'set-cookie': sessionCookie(email, request) });
    response.headers.append('set-cookie', clearPasswordGateCookie(request));
    return response;
  } catch (error) {
    console.error('Authenticator enrollment failed:', error.message);
    return json({ error: error.message || 'Could not finish authenticator setup.' }, 503);
  }
};

export const config = { path: '/api/editor/totp-enroll', rateLimit: { windowLimit: 8, windowSize: 300, aggregateBy: ['ip', 'domain'] } };
