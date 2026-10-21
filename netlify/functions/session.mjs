import { json, readSession } from '../lib/editor-auth.mjs';

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  try { return json({ authenticated: !!readSession(request) }); }
  catch { return json({ authenticated: false }); }
};

export const config = { path: '/api/editor/session' };
