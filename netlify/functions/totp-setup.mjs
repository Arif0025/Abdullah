import { editorIdentity, hasPasswordGate, json, sameOrigin } from '../lib/editor-auth.mjs';
import { beginTotpEnrollment, hasTotp } from '../lib/totp.mjs';

export default async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  if (!hasPasswordGate(request)) return json({ error: 'Your password check expired. Sign in again.' }, 401);
  try {
    const email = editorIdentity();
    if (await hasTotp(email)) return json({ error: 'An authenticator is already enrolled.' }, 409);
    return json(await beginTotpEnrollment(email));
  } catch (error) {
    console.error('Authenticator setup failed:', error.message);
    return json({ error: error.message || 'Could not start authenticator setup.' }, 503);
  }
};

export const config = { path: '/api/editor/totp-setup', rateLimit: { windowLimit: 5, windowSize: 300, aggregateBy: ['ip', 'domain'] } };
