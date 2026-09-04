'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const env = require('../lib/env');
const { db, uid, audit } = require('../lib/db');
const A = require('../lib/auth');
const { limiter, validate, wrap } = require('../lib/http');
const { sendMailAsync } = require('../lib/mailer');

const router = express.Router();

const norm = (s) => String(s || '').trim();
const lower = (s) => norm(s).toLowerCase();
const normPhone = (s) => norm(s).replace(/[^\d+]/g, '');

const digits = (s) => String(s || '').replace(/\D/g, '');

// Matches on email, or on the last 10 digits of the phone so that "+91 98201 44512",
// "919820144512" and "9820144512" all resolve to the same account.
function findUser(identifier, role) {
  const id = norm(identifier);
  const byEmail = db.prepare('SELECT * FROM users WHERE role = ? AND lower(email) = ?').get(role, id.toLowerCase());
  if (byEmail) return byEmail;

  const tail = digits(id).slice(-10);
  if (tail.length < 10) return null;
  return db.prepare(
    `SELECT * FROM users
      WHERE role = ? AND phone IS NOT NULL
        AND replace(replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')',''),'+','') LIKE ?
      LIMIT 1`
  ).get(role, '%' + tail);
}

function createUser({ role, name, email, phone, passwordHash, city, status }) {
  const id = uid(role === 'owner' ? 'own' : role === 'admin' ? 'adm' : 'usr');
  db.prepare(
    `INSERT INTO users (id, role, name, email, phone, password_hash, city, status)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, role, name, email, phone || null, passwordHash || null, city || null, status || 'active');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function redirectFor(role) {
  return role === 'admin' ? '/admin.html' : role === 'owner' ? '/owner.html' : '/user-portal.html';
}

const emailSchema = z.string().trim().email('Enter a valid email address');
const passwordSchema = z.string().min(8, 'Password must be at least 8 characters');

/* ---------------------------------------------------------------- register */

router.post('/register/traveler',
  limiter(10, 60),
  validate(z.object({
    name: z.string().trim().min(2, 'Enter your full name'),
    email: emailSchema,
    phone: z.string().trim().min(8, 'Enter a valid phone number'),
    password: passwordSchema,
    city: z.string().trim().optional()
  })),
  async (req, res) => {
    const { name, email, phone, password, city } = req.body;
    if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ? AND role = ?').get(lower(email), 'traveler')) {
      return res.status(409).json({ ok: false, field: 'email', error: 'An account with this email already exists. Sign in instead.' });
    }
    const user = createUser({
      role: 'traveler', name, email: lower(email), phone: normPhone(phone),
      passwordHash: await A.hashPassword(password), city
    });
    A.setSessionCookie(res, user);
    audit(user.id, 'auth.register', 'user', user.id, { role: 'traveler' }, req.ip);
    sendMailAsync(user.email, 'welcomeTraveler', { name: user.name });
    res.status(201).json({ ok: true, user: A.publicUser(user), redirect: redirectFor('traveler') });
  });

router.post('/register/owner',
  limiter(10, 60),
  validate(z.object({
    hotelName: z.string().trim().min(2, 'Enter the property name'),
    city: z.string().trim().min(2, 'Enter the city'),
    name: z.string().trim().min(2, 'Enter the owner or manager name'),
    phone: z.string().trim().min(8, 'Enter a valid phone number'),
    email: emailSchema,
    password: passwordSchema
  })),
  async (req, res) => {
    const { hotelName, city, name, phone, email, password } = req.body;
    if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ? AND role = ?').get(lower(email), 'owner')) {
      return res.status(409).json({ ok: false, field: 'email', error: 'This email is already registered as a partner. Sign in instead.' });
    }
    const user = createUser({
      role: 'owner', name, email: lower(email), phone: normPhone(phone), city,
      passwordHash: await A.hashPassword(password), status: 'active'
    });

    const propId = uid('prop');
    const citySlug = city.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
    db.prepare(
      `INSERT INTO properties (id, owner_id, name, location, city_slug, phone, email, claim_status, active)
       VALUES (?,?,?,?,?,?,?, 'pending', 1)`
    ).run(propId, user.id, hotelName, city, citySlug, normPhone(phone), lower(email));

    A.setSessionCookie(res, user);
    audit(user.id, 'auth.register', 'user', user.id, { role: 'owner', propertyId: propId }, req.ip);
    sendMailAsync(user.email, 'welcomeOwner', { name: user.name, hotelName });
    sendMailAsync(env.ADMIN_EMAIL, 'adminNewOwner', { name, hotelName, city, email: lower(email), phone });
    res.status(201).json({ ok: true, user: A.publicUser(user), propertyId: propId, redirect: redirectFor('owner') });
  });

/* ------------------------------------------------------------------- login */

router.post('/login',
  limiter(20, 15),
  validate(z.object({
    role: z.enum(['traveler', 'owner', 'admin']),
    identifier: z.string().trim().min(3, 'Enter your email or phone'),
    password: z.string().min(1, 'Enter your password')
  })),
  async (req, res) => {
    const { role, identifier, password } = req.body;
    const user = findUser(identifier, role);
    const ok = user && await A.verifyPassword(password, user.password_hash);
    if (!ok) {
      audit(user ? user.id : null, 'auth.login.failed', 'user', user ? user.id : null, { role, identifier }, req.ip);
      return res.status(401).json({ ok: false, error: 'Incorrect email/phone or password.' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ ok: false, error: 'This account is suspended. Contact support.' });
    }
    db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
    A.setSessionCookie(res, user);
    audit(user.id, 'auth.login', 'user', user.id, { role }, req.ip);
    res.json({ ok: true, user: A.publicUser(user), redirect: redirectFor(role) });
  });

/* --------------------------------------------------------------- OTP login */

router.post('/otp/request',
  limiter(8, 15),
  validate(z.object({
    identifier: z.string().trim().min(3, 'Enter your email or phone'),
    role: z.enum(['traveler', 'owner', 'admin']).default('owner')
  })),
  async (req, res) => {
    const { identifier, role } = req.body;
    const user = findUser(identifier, role);
    const code = A.issueCode({
      userId: user ? user.id : null,
      identifier,
      purpose: 'login-otp:' + role,
      ttlMinutes: env.OTP_TTL_MIN
    });

    // Only mail a real account, but always answer identically so this endpoint
    // cannot be used to enumerate registered emails/phones.
    if (user && user.email) {
      sendMailAsync(user.email, 'otp', { name: user.name, code, purpose: 'sign in' });
    }
    audit(user ? user.id : null, 'auth.otp.request', 'user', user ? user.id : null, { role, identifier }, req.ip);

    const body = { ok: true, message: 'If the account exists, a code has been sent.', expiresInMinutes: env.OTP_TTL_MIN };
    if (!env.isProd && env.OTP_DEV_ECHO) body.devCode = code;
    res.json(body);
  });

router.post('/otp/verify',
  limiter(15, 15),
  validate(z.object({
    identifier: z.string().trim().min(3),
    code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the 6-digit code'),
    role: z.enum(['traveler', 'owner', 'admin']).default('owner')
  })),
  async (req, res) => {
    const { identifier, code, role } = req.body;
    const result = A.consumeToken({ identifier, purpose: 'login-otp:' + role, value: code });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });

    const user = result.row.user_id
      ? db.prepare('SELECT * FROM users WHERE id = ?').get(result.row.user_id)
      : findUser(identifier, role);
    if (!user) return res.status(404).json({ ok: false, error: 'No account found for this identifier.' });
    if (user.status === 'suspended') {
      return res.status(403).json({ ok: false, error: 'This account is suspended. Contact support.' });
    }

    db.prepare(`UPDATE users SET last_login_at = datetime('now'), email_verified = 1 WHERE id = ?`).run(user.id);
    user.email_verified = 1; // the row just above is stale otherwise — publicUser would report unverified right after verifying
    A.setSessionCookie(res, user);
    audit(user.id, 'auth.login.otp', 'user', user.id, { role }, req.ip);
    res.json({ ok: true, user: A.publicUser(user), redirect: redirectFor(role) });
  });

/* ------------------------------------------------------- Google sign-in */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function googleRedirectUri() {
  return env.PUBLIC_URL + '/api/auth/google/callback';
}

// Starts the flow: redirects the browser to Google's consent screen. `role`
// picks which portal the account is created/signed into (never 'admin' —
// admin sign-in stays password/OTP only). `state` is a short-lived signed
// JWT so the callback can trust role/next without server-side session state.
router.get('/google/start', (req, res) => {
  if (!env.googleAuthConfigured) {
    return res.status(503).send('Google sign-in is not configured on this server yet.');
  }
  const role = req.query.role === 'owner' ? 'owner' : 'traveler';
  const next = typeof req.query.next === 'string' && /^\/[^/\\]/.test(req.query.next) ? req.query.next : null;
  const state = jwt.sign({ role, next }, env.JWT_SECRET, { expiresIn: '10m' });

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', googleRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

router.get('/google/callback', wrap(async (req, res) => {
  const fail = (role) => res.redirect('/login.html?type=' + (role || 'traveler') + '&error=google_failed');
  if (!env.googleAuthConfigured || !req.query.code || !req.query.state) return fail();

  let payload;
  try { payload = jwt.verify(String(req.query.state), env.JWT_SECRET); }
  catch (_) { return fail(); }
  const role = payload.role === 'owner' ? 'owner' : 'traveler';

  let tokenRes, tokens;
  try {
    tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(),
        grant_type: 'authorization_code'
      })
    });
    tokens = await tokenRes.json();
  } catch (_) { return fail(role); }
  if (!tokenRes.ok || !tokens.id_token) return fail(role);

  // The id_token came straight from Google's token endpoint over TLS (not
  // from the browser), so decoding its payload without a signature check is
  // the standard trusted pattern here — no client ever got to touch it.
  let profile;
  try { profile = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8')); }
  catch (_) { return fail(role); }
  if (!profile.email || profile.email_verified === false) return fail(role);

  const email = lower(profile.email);
  let user = db.prepare('SELECT * FROM users WHERE lower(email) = ? AND role = ?').get(email, role);
  if (!user) {
    user = createUser({ role, name: profile.name || email.split('@')[0], email, status: 'active' });
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user.id);
    audit(user.id, 'auth.register', 'user', user.id, { role, via: 'google' }, req.ip);
    sendMailAsync(user.email, role === 'owner' ? 'welcomeOwner' : 'welcomeTraveler',
      role === 'owner' ? { name: user.name, hotelName: 'your property' } : { name: user.name });
  } else if (!user.email_verified) {
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user.id);
  }
  if (user.status === 'suspended') return fail(role);

  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
  A.setSessionCookie(res, user);
  audit(user.id, 'auth.login.google', 'user', user.id, { role }, req.ip);
  res.redirect(payload.next || redirectFor(role));
}));

/* ---------------------------------------------------------------- password */

router.post('/password/forgot',
  limiter(6, 60),
  validate(z.object({ email: emailSchema, role: z.enum(['traveler', 'owner', 'admin']).default('traveler') })),
  async (req, res) => {
    const { email, role } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE lower(email) = ? AND role = ?').get(lower(email), role);
    if (user) {
      const raw = A.issueLinkToken({ userId: user.id, identifier: user.email, purpose: 'password-reset', ttlMinutes: 60 });
      const link = `${env.PUBLIC_URL}/reset-password.html?token=${raw}&email=${encodeURIComponent(user.email)}&role=${role}`;
      sendMailAsync(user.email, 'passwordReset', { name: user.name, link });
      audit(user.id, 'auth.password.forgot', 'user', user.id, null, req.ip);
    }
    res.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
  });

router.post('/password/reset',
  limiter(10, 60),
  validate(z.object({
    email: emailSchema,
    token: z.string().min(20, 'Invalid reset link'),
    password: passwordSchema
  })),
  async (req, res) => {
    const { email, token, password } = req.body;
    const result = A.consumeToken({ identifier: lower(email), purpose: 'password-reset', value: token });
    if (!result.ok) return res.status(400).json({ ok: false, error: 'This reset link is invalid or has expired.' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.row.user_id);
    if (!user) return res.status(404).json({ ok: false, error: 'Account not found.' });

    db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(await A.hashPassword(password), user.id);
    audit(user.id, 'auth.password.reset', 'user', user.id, null, req.ip);
    sendMailAsync(user.email, 'passwordChanged', { name: user.name });
    res.json({ ok: true, message: 'Password updated. You can sign in now.', redirect: '/login.html?type=' + user.role });
  });

router.post('/password/change',
  A.requireAuth(),
  validate(z.object({ currentPassword: z.string().min(1), password: passwordSchema })),
  async (req, res) => {
    const ok = await A.verifyPassword(req.body.currentPassword, req.user.password_hash);
    if (!ok) return res.status(400).json({ ok: false, field: 'currentPassword', error: 'Current password is incorrect.' });
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(await A.hashPassword(req.body.password), req.user.id);
    audit(req.user.id, 'auth.password.change', 'user', req.user.id, null, req.ip);
    sendMailAsync(req.user.email, 'passwordChanged', { name: req.user.name });
    res.json({ ok: true, message: 'Password updated.' });
  });

/* ------------------------------------------------------------ session/self */

router.get('/me', (req, res) => {
  res.json({ ok: true, user: A.publicUser(req.user) });
});

router.patch('/me',
  A.requireAuth(),
  validate(z.object({
    name: z.string().trim().min(2).optional(),
    phone: z.string().trim().min(8).optional(),
    city: z.string().trim().optional()
  })),
  (req, res) => {
    const { name, phone, city } = req.body;
    db.prepare(
      `UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone),
              city = COALESCE(?, city), updated_at = datetime('now')
        WHERE id = ?`
    ).run(name || null, phone ? normPhone(phone) : null, city || null, req.user.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ ok: true, user: A.publicUser(user) });
  });

router.post('/logout', (req, res) => {
  if (req.user) audit(req.user.id, 'auth.logout', 'user', req.user.id, null, req.ip);
  A.clearSessionCookie(res);
  res.json({ ok: true });
});

module.exports = router;
