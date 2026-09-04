'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('./env');
const { db, uid } = require('./db');

const ROLES = ['traveler', 'owner', 'admin'];

const hashPassword = (pw) => bcrypt.hash(pw, 10);
const verifyPassword = (pw, hash) => (hash ? bcrypt.compare(pw, hash) : Promise.resolve(false));
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN
  });
}

function setSessionCookie(res, user) {
  res.cookie(env.COOKIE_NAME, signToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie(env.COOKIE_NAME, { path: '/' });
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    role: u.role,
    name: u.name,
    email: u.email,
    phone: u.phone,
    city: u.city,
    avatar: u.avatar || (u.name || '?').trim().charAt(0).toUpperCase(),
    status: u.status,
    emailVerified: !!u.email_verified,
    createdAt: u.created_at
  };
}

function readToken(req) {
  const fromCookie = req.cookies && req.cookies[env.COOKIE_NAME];
  if (fromCookie) return fromCookie;
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Populates req.user when a valid session exists. Never rejects.
function attachUser(req, _res, next) {
  req.user = null;
  const token = readToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (row && row.status !== 'suspended') req.user = row;
  } catch (_) { /* expired or tampered token = anonymous */ }
  next();
}

function requireAuth(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: 'Not signed in' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: 'Insufficient permissions' });
    }
    next();
  };
}

// ---- one-time codes / links (OTP, password reset, email verification) ----

function issueCode({ userId, identifier, purpose, ttlMinutes, length = 6, meta }) {
  const code = String(crypto.randomInt(0, 10 ** length)).padStart(length, '0');
  db.prepare(
    `INSERT INTO tokens (id,user_id,identifier,purpose,token_hash,expires_at,meta)
     VALUES (?,?,?,?,?, datetime('now', ?), ?)`
  ).run(uid('tok'), userId || null, String(identifier).toLowerCase(), purpose, sha256(code),
        `+${ttlMinutes} minutes`, meta ? JSON.stringify(meta) : null);
  return code;
}

function issueLinkToken({ userId, identifier, purpose, ttlMinutes }) {
  const raw = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO tokens (id,user_id,identifier,purpose,token_hash,expires_at)
     VALUES (?,?,?,?,?, datetime('now', ?))`
  ).run(uid('tok'), userId || null, identifier ? String(identifier).toLowerCase() : null, purpose, sha256(raw), `+${ttlMinutes} minutes`);
  return raw;
}

const MAX_ATTEMPTS = 5;

// Returns { ok, row } | { ok:false, error }
function consumeToken({ identifier, purpose, value }) {
  const row = db.prepare(
    `SELECT * FROM tokens
      WHERE purpose = ? AND consumed_at IS NULL
        AND (? IS NULL OR identifier = ?)
      ORDER BY created_at DESC LIMIT 1`
  ).get(purpose, identifier ? String(identifier).toLowerCase() : null, identifier ? String(identifier).toLowerCase() : null);

  if (!row) return { ok: false, error: 'No pending code. Request a new one.' };
  if (new Date(row.expires_at + 'Z') < new Date()) return { ok: false, error: 'Code expired. Request a new one.' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'Too many attempts. Request a new code.' };

  if (row.token_hash !== sha256(value)) {
    db.prepare('UPDATE tokens SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return { ok: false, error: 'Invalid code.' };
  }
  db.prepare("UPDATE tokens SET consumed_at = datetime('now') WHERE id = ?").run(row.id);
  return { ok: true, row };
}

function purgeExpiredTokens() {
  db.prepare("DELETE FROM tokens WHERE expires_at < datetime('now','-1 day')").run();
}

module.exports = {
  ROLES, hashPassword, verifyPassword, sha256, signToken, setSessionCookie, clearSessionCookie,
  publicUser, attachUser, requireAuth, issueCode, issueLinkToken, consumeToken, purgeExpiredTokens
};
