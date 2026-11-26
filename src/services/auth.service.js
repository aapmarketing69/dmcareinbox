import crypto from 'node:crypto';
import { timingSafeEqualStr } from './crypto.service.js';

export const SESSION_COOKIE_NAME = 'dmcare_session';
export const LEGACY_SESSION_COOKIE_NAME = 'omnichat_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Hashes a password with Node's built-in scrypt KDF + random 16-byte salt.
 */
export function hashPassword(password) {
  const clean = String(password || '');
  if (clean.length < 6) {
    const err = new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    err.statusCode = 400;
    throw err;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(clean, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  if (!password || !storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  const derivedHex = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return timingSafeEqualStr(derivedHex, keyHex);
}

function getSigningSecret(config) {
  return config.sessionSecret || `${config.encryptionKey}:session_signing_v1`;
}

export function createSessionToken(agent, config, { activeWorkspaceId = null } = {}) {
  const payload = {
    sub: agent.id,
    role: agent.role,
    ws: activeWorkspaceId || agent.workspace_id || 'ws_default',
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret(config))
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function createSignedActionToken(payloadObj, config, { ttlMs = 5 * 60 * 1000 } = {}) {
  const payload = { ...payloadObj, exp: Date.now() + ttlMs };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret(config))
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySignedActionToken(token, expectedKind, config) {
  const payload = verifySessionToken(token, config);
  if (!payload || payload.kind !== expectedKind) return null;
  return payload;
}

export function verifySessionToken(token, config) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  const expected = crypto
    .createHmac('sha256', getSigningSecret(config))
    .update(encoded)
    .digest('base64url');

  if (!timingSafeEqualStr(sig, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload?.sub || !payload?.exp || Date.now() > Number(payload.exp)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader) return map;
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) map[key] = decodeURIComponent(val);
  }
  return map;
}

export function buildSessionCookieHeader(token, { secure = false, maxAgeSec = 7 * 24 * 3600 } = {}) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookieHeader({ secure = false } = {}) {
  const clearCurrent = buildSessionCookieHeader('', { secure, maxAgeSec: 0 });
  const clearLegacy = clearCurrent.replace(`${SESSION_COOKIE_NAME}=`, `${LEGACY_SESSION_COOKIE_NAME}=`);
  return [clearCurrent, clearLegacy];
}

export function isSuperAdminRole(role) {
  return String(role || '').toLowerCase() === 'super_admin';
}

export function isManagerRole(role) {
  return ['super_admin', 'owner', 'admin', 'supervisor'].includes(String(role || '').toLowerCase());
}
