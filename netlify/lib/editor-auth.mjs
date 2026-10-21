import { createHmac, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const STORE = 'profile-editor-auth';
const SESSION_TTL = 8 * 60 * 60;
const PASSWORD_GATE_TTL = 10 * 60;
const cookieName = 'profile_editor_session';
const passwordGateCookieName = 'profile_editor_password_gate';

export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !!origin && origin === new URL(request.url).origin;
}

export function editorIdentity(env = process.env) {
  // Fixed internal identity. TOTP enrollment is not tied to a changeable email address.
  return 'profile-editor';
}

function secret(env = process.env) {
  if (!env.EDITOR_SESSION_SECRET || env.EDITOR_SESSION_SECRET.length < 32) throw new Error('EDITOR_SESSION_SECRET must be at least 32 characters.');
  return env.EDITOR_SESSION_SECRET;
}

export function verifyEditorPassword(password, env = process.env) {
  const expected = env.EDITOR_PASSWORD || '';
  if (expected.length < 16) throw new Error('EDITOR_PASSWORD must be at least 16 characters and configured in Netlify.');
  if (typeof password !== 'string' || password.length > 1024) return false;
  const supplied = Buffer.from(password, 'utf8');
  const configured = Buffer.from(expected, 'utf8');
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

const digest = (value, key) => createHmac('sha256', key).update(value).digest('hex');
const store = () => getStore({ name: STORE, consistency: 'strong' });

function sign(payload, env = process.env) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${digest(encoded, secret(env))}`;
}

function verify(token, env = process.env, purpose = 'session') {
  if (!token || typeof token !== 'string') return null;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;
  const expected = Buffer.from(digest(encoded, secret(env)), 'hex');
  let supplied;
  try { supplied = Buffer.from(signature, 'hex'); } catch { return null; }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.exp < Date.now() || payload.email !== editorIdentity(env) || payload.purpose !== purpose) return null;
    return payload;
  } catch { return null; }
}

export function sessionCookie(email, request, env = process.env) {
  const token = sign({ email, purpose: 'session', exp: Date.now() + SESSION_TTL * 1000 }, env);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL}${secure}`;
}

export function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function passwordGateCookie(request, env = process.env) {
  const token = sign({ email: editorIdentity(env), purpose: 'password-gate', exp: Date.now() + PASSWORD_GATE_TTL * 1000 }, env);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${passwordGateCookieName}=${token}; Path=/api/editor/; HttpOnly; SameSite=Strict; Max-Age=${PASSWORD_GATE_TTL}${secure}`;
}

export function clearPasswordGateCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${passwordGateCookieName}=; Path=/api/editor/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function hasPasswordGate(request, env = process.env) {
  const raw = request.headers.get('cookie') || '';
  const token = raw.split(';').map(v => v.trim()).find(v => v.startsWith(`${passwordGateCookieName}=`))?.slice(passwordGateCookieName.length + 1);
  return !!verify(token, env, 'password-gate');
}

export function readSession(request, env = process.env) {
  const raw = request.headers.get('cookie') || '';
  const token = raw.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return verify(token, env, 'session');
}
