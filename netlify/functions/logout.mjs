import { clearPasswordGateCookie, clearSessionCookie, json, sameOrigin } from '../lib/editor-auth.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  const response = json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(request) });
  response.headers.append('set-cookie', clearPasswordGateCookie(request));
  return response;
};

export const config = { path: '/api/editor/logout' };
