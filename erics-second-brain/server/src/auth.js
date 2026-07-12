import crypto from 'node:crypto';
import { db, now } from './db.js';
import { config } from './config.js';

export const COOKIE_NAME = 'esb_session';

// ── Password hashing (scrypt, no native deps) ─────────────────────
// Format: scrypt$<salt-hex>$<hash-hex>
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// If no hash is configured (and auth isn't disabled), generate a random
// one-time password per boot rather than ever running unprotected.
let effectiveHash = config.authPasswordHash;
if (!config.authDisabled && !effectiveHash) {
  const oneTime = crypto.randomBytes(9).toString('base64url');
  effectiveHash = hashPassword(oneTime);
  console.warn(
    `[auth] AUTH_PASSWORD_HASH is not set. One-time password for this run: ${oneTime}\n` +
      `[auth] Set a permanent one with: npm run hash-password -- 'your-password'`
  );
}

// ── Sessions ───────────────────────────────────────────────────────
function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.sessionTtlMs).toISOString();
  db.prepare('INSERT INTO sessions(token, expires_at) VALUES (?, ?)').run(token, expires);
  return token;
}

function validSession(token) {
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token);
  if (!row) return false;
  if (row.expires_at < now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return false;
  }
  return true;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: config.basePath === '/' ? '/' : config.basePath,
    maxAge: config.sessionTtlMs,
  };
}

// ── Login rate limiting (in-memory; single user, single process) ──
let failures = 0;
let lockedUntil = 0;

export function loginHandler(req, res) {
  if (config.authDisabled) return res.json({ ok: true });
  if (Date.now() < lockedUntil) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  }
  const { username, password } = req.body ?? {};
  const userOk = typeof username === 'string' && username === config.authUsername;
  const passOk = typeof password === 'string' && verifyPassword(password, effectiveHash);
  if (!userOk || !passOk) {
    failures += 1;
    if (failures >= 5) {
      lockedUntil = Date.now() + 60_000;
      failures = 0;
    }
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  failures = 0;
  const token = createSession();
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true });
}

export function logoutHandler(req, res) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE_NAME, { path: cookieOptions().path });
  res.json({ ok: true });
}

export function meHandler(req, res) {
  res.json({ authenticated: true, username: config.authUsername });
}

// Every /api route (except login/health) goes through this. There are
// no unauthenticated read OR write endpoints.
export function requireAuth(req, res, next) {
  if (config.authDisabled) return next();
  if (validSession(req.cookies?.[COOKIE_NAME])) return next();
  return res.status(401).json({ error: 'Not authenticated.' });
}

// Cheap CSRF hardening for mutations, alongside SameSite=Lax: browsers
// always send Origin on cross-site POSTs; reject any that don't match.
export function sameOriginGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // same-origin fetches may omit Origin
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  try {
    if (new URL(origin).host === host) return next();
  } catch {
    /* fall through */
  }
  return res.status(403).json({ error: 'Cross-origin request rejected.' });
}
