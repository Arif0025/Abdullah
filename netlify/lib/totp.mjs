import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const store = () => getStore({ name: 'profile-editor-auth', consistency: 'strong' });
const keyFor = (purpose, env = process.env) => createHmac('sha256', env.EDITOR_SESSION_SECRET || '').update(`profile-editor:${purpose}`).digest();
const recordKey = email => `totp:${createHmac('sha256', process.env.EDITOR_SESSION_SECRET || '').update(email).digest('hex')}`;

function seal(value, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor('totp-encryption', env), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}
function unseal(value, env = process.env) {
  const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', keyFor('totp-encryption', env), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0; const output = [];
  for (const char of input.replace(/=+$/g, '').toUpperCase()) { const index = alphabet.indexOf(char); if (index < 0) throw new Error('Invalid authenticator key.'); value = (value << 5) | index; bits += 5; if (bits >= 8) { output.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(output);
}
function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30_000);
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, '0');
}
function verifyTotp(secret, code, now = Date.now()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  const supplied = Buffer.from(code);
  for (const offset of [-30_000, 0, 30_000]) {
    const expected = Buffer.from(totp(secret, now + offset));
    if (timingSafeEqual(supplied, expected)) return true;
  }
  return false;
}
const hashRecovery = (code, env = process.env) => createHmac('sha256', keyFor('recovery-codes', env)).update(code.toUpperCase()).digest('hex');
const randomRecovery = () => `${base32Encode(randomBytes(5)).slice(0, 5)}-${base32Encode(randomBytes(5)).slice(0, 5)}`;

export async function hasTotp(email) {
  return !!await store().get(recordKey(email), { type: 'json', consistency: 'strong' });
}

export async function beginTotpEnrollment(email, env = process.env) {
  const db = store();
  if (await db.get(recordKey(email), { type: 'json', consistency: 'strong' })) throw new Error('An authenticator is already enrolled. Use a recovery code to replace it.');
  const secret = base32Encode(randomBytes(20));
  const pending = { secret: seal(secret, env), expires: Date.now() + 10 * 60_000, attempts: 0 };
  await db.set(`totp-pending:${recordKey(email)}`, JSON.stringify(pending));
  const label = encodeURIComponent(`Profile Editor:${email}`);
  const issuer = encodeURIComponent('Profile Editor');
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}

export async function finishTotpEnrollment(email, code, env = process.env) {
  const db = store(), pendingKey = `totp-pending:${recordKey(email)}`;
  const pending = await db.get(pendingKey, { type: 'json', consistency: 'strong' });
  if (!pending || pending.expires < Date.now() || pending.attempts >= 5) { await db.delete(pendingKey); return null; }
  const secret = unseal(pending.secret, env);
  if (!verifyTotp(secret, code)) { pending.attempts += 1; await db.set(pendingKey, JSON.stringify(pending)); return null; }
  const codes = Array.from({ length: 8 }, randomRecovery);
  await db.set(recordKey(email), JSON.stringify({ secret: pending.secret, recoveryHashes: codes.map(code => hashRecovery(code, env)) }));
  await db.delete(pendingKey);
  return codes;
}

export async function verifyTotpOrRecovery(email, code, env = process.env) {
  const db = store(), key = recordKey(email);
  const record = await db.getWithMetadata(key, { type: 'json', consistency: 'strong' });
  const entry = record?.data;
  if (!entry || typeof code !== 'string') return { valid: false };
  if (verifyTotp(unseal(entry.secret, env), code)) return { valid: true, recovery: false };
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(normalized)) return { valid: false };
  const candidate = Buffer.from(hashRecovery(normalized, env), 'hex');
  const index = entry.recoveryHashes.findIndex(hash => { const expected = Buffer.from(hash, 'hex'); return candidate.length === expected.length && timingSafeEqual(candidate, expected); });
  if (index < 0) return { valid: false };
  entry.recoveryHashes.splice(index, 1);
  const consumed = await db.set(key, JSON.stringify(entry), { onlyIfMatch: record.etag });
  if (!consumed.modified) return { valid: false };
  return { valid: true, recovery: true, remaining: entry.recoveryHashes.length };
}

export async function clearTotp(email) {
  const db = store();
  await db.delete(recordKey(email));
  await db.delete(`totp-pending:${recordKey(email)}`);
}
