'use strict';
const express = require('express');
const { z } = require('zod');
const { db, uid, audit } = require('../lib/db');
const A = require('../lib/auth');
const env = require('../lib/env');
const { limiter, validate, validateQuery, wrap, slugify } = require('../lib/http');
const { sendMailAsync } = require('../lib/mailer');

const router = express.Router();

function shape(r) {
  if (!r) return null;
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    location: r.location,
    city_slug: r.city_slug,
    address: r.address,
    phone: r.phone,
    email: r.email,
    website: r.website,
    rating: r.rating,
    pincode: r.pincode,
    image_url: r.image_url,
    property_type: r.property_type,
    google_cid: r.google_cid,
    google_review_count: r.google_review_count,
    google_summary: r.google_summary,
    gmb_link: r.gmb_link,
    plan: r.plan,
    claimStatus: r.claim_status,
    active: !!r.active,
    createdAt: r.created_at
  };
}

/* -------------------------------------------------------------------- list */

router.get('/',
  validateQuery(z.object({
    city: z.string().trim().optional(),
    q: z.string().trim().optional(),
    mine: z.coerce.boolean().optional(),
    claimStatus: z.string().trim().optional(),
    includeInactive: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(24),
    offset: z.coerce.number().int().min(0).default(0)
  })),
  (req, res) => {
    const { city, q, mine, claimStatus, includeInactive, limit, offset } = req.q;
    const where = [];
    const params = [];

    if (mine) {
      if (!req.user) return res.status(401).json({ ok: false, error: 'Not signed in' });
      where.push('owner_id = ?'); params.push(req.user.id);
    }
    if (!includeInactive || !req.user || req.user.role !== 'admin') where.push('active = 1');
    if (city) { where.push('(city_slug = ? OR lower(location) = ?)'); params.push(slugify(city), city.toLowerCase()); }
    if (claimStatus) { where.push('claim_status = ?'); params.push(claimStatus); }
    if (q) {
      where.push('(name LIKE ? OR location LIKE ? OR address LIKE ?)');
      const like = '%' + q + '%';
      params.push(like, like, like);
    }

    const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const rows = db.prepare('SELECT * FROM properties' + clause + ' ORDER BY rating DESC, name LIMIT ? OFFSET ?')
      .all(...params, limit, offset);
    const total = db.prepare('SELECT COUNT(*) c FROM properties' + clause).get(...params).c;
    res.json({ ok: true, total, properties: rows.map(shape) });
  });

router.get('/cities', (_req, res) => {
  const rows = db.prepare(
    `SELECT city_slug AS slug, MIN(location) AS name, COUNT(*) AS count
       FROM properties WHERE active = 1 AND city_slug IS NOT NULL AND city_slug <> ''
      GROUP BY city_slug ORDER BY count DESC`
  ).all();
  res.json({ ok: true, cities: rows });
});

/* ---------------------------------------------------------------- catalog */

// Full active catalogue in the shape the front-end pages expect on window.HOTELS.
// Served from a memoised string with an ETag: it is large and changes rarely.
let catalogCache = null;

function buildCatalog() {
  const rows = db.prepare(
    `SELECT p.id, p.name, p.location, p.city_slug, p.address, p.phone, p.website, p.rating, p.pincode, p.image_url,
            p.property_type, p.google_cid, p.google_review_count, p.google_summary, p.gmb_link, p.claim_status, p.amenities,
            (SELECT MIN(price) FROM rooms r WHERE r.property_id = p.id AND r.active = 1 AND r.price > 0) AS min_price
       FROM properties p WHERE p.active = 1 ORDER BY p.rating DESC, p.name`
  ).all();
  // amenities is stored as JSON ({general:[],recreation:[],...} or a flat
  // array from CSV import) — flatten it here so the frontend never has to
  // parse it, and never has to fabricate amenities for a listing that
  // genuinely doesn't have any set yet.
  rows.forEach((r) => {
    let flat = [];
    try {
      const parsed = r.amenities ? JSON.parse(r.amenities) : null;
      if (Array.isArray(parsed)) flat = parsed;
      else if (parsed && typeof parsed === 'object') flat = Object.values(parsed).flat();
    } catch (_) { /* leave flat empty */ }
    r.amenities = flat.filter(Boolean);
  });
  const body = JSON.stringify({ ok: true, count: rows.length, hotels: rows });
  const etag = 'W/"' + require('crypto').createHash('sha1').update(body).digest('hex').slice(0, 16) + '"';
  catalogCache = { body, etag, builtAt: Date.now() };
  return catalogCache;
}

function invalidateCatalog() { catalogCache = null; }

const CATALOG_TTL_MS = 5 * 60 * 1000;

router.get('/catalog', (req, res) => {
  if (!catalogCache || Date.now() - catalogCache.builtAt > CATALOG_TTL_MS) buildCatalog();
  if (req.get('if-none-match') === catalogCache.etag) return res.status(304).end();
  res.set('ETag', catalogCache.etag);
  res.set('Cache-Control', 'public, max-age=300');
  res.type('application/json').send(catalogCache.body);
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Property not found.' });
  const agg = db.prepare("SELECT ROUND(AVG(rating),2) avg, COUNT(*) c FROM reviews WHERE property_id = ? AND status='Published'")
    .get(row.id);
  res.json({ ok: true, property: shape(row), reviewSummary: { average: agg.avg, count: agg.c } });
});

/* ------------------------------------------------------------ create/update */

const propertyFields = {
  name: z.string().trim().min(2).optional(),
  location: z.string().trim().optional(),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  website: z.string().trim().optional(),
  pincode: z.string().trim().optional(),
  image_url: z.string().trim().optional(),
  property_type: z.string().trim().optional(),
  google_cid: z.string().trim().optional(),
  gmb_link: z.string().trim().optional(),
  google_summary: z.string().trim().max(2000).optional()
};

router.post('/',
  A.requireAuth('owner', 'admin'),
  validate(z.object(Object.assign({}, propertyFields, { name: z.string().trim().min(2, 'Enter the property name') }))),
  (req, res) => {
    const b = req.body;
    const id = uid('prop');
    db.prepare(
      `INSERT INTO properties (id, owner_id, name, location, city_slug, address, phone, email, website,
                               pincode, image_url, property_type, google_cid, gmb_link, google_summary,
                               claim_status, active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`
    ).run(id, req.user.role === 'owner' ? req.user.id : null, b.name, b.location || null, slugify(b.location),
          b.address || null, b.phone || null, b.email || null, b.website || null, b.pincode || null,
          b.image_url || null, b.property_type || null, b.google_cid || null, b.gmb_link || null,
          b.google_summary || null, req.user.role === 'admin' ? 'verified' : 'pending');
    invalidateCatalog();
    audit(req.user.id, 'property.create', 'property', id, null, req.ip);
    res.status(201).json({ ok: true, property: shape(db.prepare('SELECT * FROM properties WHERE id = ?').get(id)) });
  });

router.patch('/:id',
  A.requireAuth('owner', 'admin'),
  validate(z.object(Object.assign({}, propertyFields, {
    active: z.coerce.boolean().optional(),
    plan: z.string().trim().optional(),
    claim_status: z.enum(['unclaimed', 'pending', 'verified', 'rejected']).optional()
  }))),
  (req, res) => {
    const row = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Property not found.' });
    if (req.user.role === 'owner' && row.owner_id !== req.user.id) {
      return res.status(403).json({ ok: false, error: 'Not your property.' });
    }
    const b = req.body;
    // claim_status and plan are commercial fields — only an admin may move them.
    if (req.user.role !== 'admin') { delete b.claim_status; delete b.plan; }

    const allowed = ['name', 'location', 'address', 'phone', 'email', 'website', 'pincode', 'image_url',
                     'property_type', 'google_cid', 'gmb_link', 'google_summary', 'plan', 'claim_status'];
    const sets = [];
    const params = [];
    allowed.forEach((f) => {
      if (b[f] !== undefined) { sets.push(f + ' = ?'); params.push(b[f]); }
    });
    if (b.location !== undefined) { sets.push('city_slug = ?'); params.push(slugify(b.location)); }
    if (b.active !== undefined) { sets.push('active = ?'); params.push(b.active ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ ok: false, error: 'Nothing to update.' });

    db.prepare(`UPDATE properties SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params, row.id);
    invalidateCatalog();
    audit(req.user.id, 'property.update', 'property', row.id, b, req.ip);
    res.json({ ok: true, property: shape(db.prepare('SELECT * FROM properties WHERE id = ?').get(row.id)) });
  });

/* ------------------------------------------------------------------- claim */

router.post('/:id/claim',
  A.requireAuth('owner', 'admin'),
  validate(z.object({
    name: z.string().trim().min(2).optional(),
    phone: z.string().trim().optional(),
    note: z.string().trim().max(1000).optional()
  })),
  (req, res) => {
    const row = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Property not found.' });
    if (row.claim_status === 'verified' && row.owner_id && row.owner_id !== req.user.id) {
      return res.status(409).json({ ok: false, error: 'This listing is already claimed by another partner.' });
    }
    db.prepare(`UPDATE properties SET owner_id = ?, claim_status = 'pending', updated_at = datetime('now') WHERE id = ?`)
      .run(req.user.id, row.id);
    invalidateCatalog();
    audit(req.user.id, 'property.claim', 'property', row.id, { note: req.body.note }, req.ip);
    sendMailAsync(req.user.email, 'claimSubmitted', { name: req.user.name, hotelName: row.name });
    res.json({ ok: true, message: 'Claim submitted. We verify ownership within 24 hours.' });
  });

router.post('/:id/claim/approve', A.requireAuth('admin'), (req, res) => {
  const row = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Property not found.' });
  db.prepare(`UPDATE properties SET claim_status='verified', updated_at=datetime('now') WHERE id = ?`).run(row.id);
  invalidateCatalog();
  const owner = row.owner_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(row.owner_id) : null;
  if (owner) sendMailAsync(owner.email, 'claimApproved', { name: owner.name, hotelName: row.name });
  audit(req.user.id, 'property.claim.approve', 'property', row.id, null, req.ip);
  res.json({ ok: true, property: shape(db.prepare('SELECT * FROM properties WHERE id = ?').get(row.id)) });
});

/* ------------------------------------------------------- guided claim flow */

const digitsOnly = (v) => String(v || '').replace(/\D/g, '');

// Step 1 of claim.html: does the caller know the phone number we hold for this
// listing? We never reveal the stored number, only whether the tail matches.
router.post('/:id/claim/verify-phone',
  limiter(15, 60),
  validate(z.object({ phone: z.string().trim().min(6, 'Enter your phone number') })),
  (req, res) => {
    const row = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Property not found.' });

    const stored = digitsOnly(row.phone).slice(-10);
    const given = digitsOnly(req.body.phone).slice(-10);
    if (given.length < 10) return res.status(400).json({ ok: false, field: 'phone', error: 'Enter a 10-digit phone number.' });

    // Listings imported without a phone number fall back to manual review.
    const matched = stored ? stored === given : false;
    res.json({ ok: true, matched, manualReview: !stored });
  });

// Step 2: email a one-time code to the person claiming, creating the partner
// account if this is their first claim.
router.post('/:id/claim/start',
  limiter(10, 60),
  validate(z.object({
    name: z.string().trim().min(2, 'Enter your name'),
    email: z.string().trim().email('Enter a valid email address'),
    phone: z.string().trim().min(8, 'Enter your phone number')
  })),
  (req, res) => {
    const row = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Property not found.' });
    if (row.claim_status === 'verified' && row.owner_id) {
      return res.status(409).json({ ok: false, error: 'This listing is already claimed. Contact support if it is yours.' });
    }

    const email = req.body.email.toLowerCase();
    let user = db.prepare("SELECT * FROM users WHERE lower(email) = ? AND role = 'owner'").get(email);
    if (!user) {
      const id = uid('own');
      db.prepare(
        `INSERT INTO users (id, role, name, email, phone, city, status)
         VALUES (?, 'owner', ?, ?, ?, ?, 'active')`
      ).run(id, req.body.name, email, digitsOnly(req.body.phone), row.location || null);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    }

    const code = A.issueCode({
      userId: user.id, identifier: email, purpose: 'claim:' + row.id, ttlMinutes: env.OTP_TTL_MIN
    });
    sendMailAsync(email, 'otp', { name: user.name, code, purpose: 'property claim' });
    audit(user.id, 'property.claim.start', 'property', row.id, null, req.ip);

    const body = { ok: true, message: 'We emailed you a 6-digit code.', expiresInMinutes: env.OTP_TTL_MIN };
    if (!env.isProd && env.OTP_DEV_ECHO) body.devCode = code;
    res.json(body);
  });

// Step 3: the code proves the email, so sign the partner in and attach the
// listing as a pending claim for the Hotelzz team to approve.
router.post('/:id/claim/confirm',
  limiter(15, 60),
  validate(z.object({
    email: z.string().trim().email(),
    code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the 6-digit code'),
    password: z.string().min(8, 'Password must be at least 8 characters').optional()
  })),
  wrap(async (req, res) => {
    const row = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Property not found.' });

    const email = req.body.email.toLowerCase();
    const result = A.consumeToken({ identifier: email, purpose: 'claim:' + row.id, value: req.body.code });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.row.user_id);
    if (!user) return res.status(404).json({ ok: false, error: 'Account not found.' });

    if (req.body.password) {
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(await A.hashPassword(req.body.password), user.id);
    }
    db.prepare(`UPDATE users SET email_verified = 1, last_login_at = datetime('now') WHERE id = ?`).run(user.id);
    db.prepare(`UPDATE properties SET owner_id = ?, claim_status = 'pending', updated_at = datetime('now') WHERE id = ?`)
      .run(user.id, row.id);
    invalidateCatalog();

    A.setSessionCookie(res, user);
    audit(user.id, 'property.claim.confirm', 'property', row.id, null, req.ip);
    sendMailAsync(user.email, 'claimSubmitted', { name: user.name, hotelName: row.name });
    sendMailAsync(env.ADMIN_EMAIL, 'adminNewOwner', {
      name: user.name, hotelName: row.name, city: row.location || '', email: user.email, phone: user.phone || ''
    });

    const freshUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    res.json({
      ok: true,
      user: A.publicUser(freshUser),
      property: shape(db.prepare('SELECT * FROM properties WHERE id = ?').get(row.id)),
      redirect: '/owner.html'
    });
  }));

/* ---------------------------------------------------------------- tracking */

const TRACK_COLUMNS = {
  view: 'views', phone: 'phone_clicks', website: 'website_clicks',
  whatsapp: 'whatsapp_clicks', directions: 'direction_clicks'
};

// Public: the listing pages call this so owners see real view/click counts.
router.post('/:id/track',
  validate(z.object({ event: z.enum(Object.keys(TRACK_COLUMNS)) })),
  (req, res) => {
    const column = TRACK_COLUMNS[req.body.event];
    const exists = db.prepare('SELECT 1 FROM properties WHERE id = ?').get(req.params.id);
    if (!exists) return res.status(404).json({ ok: false, error: 'Property not found.' });
    db.prepare(
      `INSERT INTO property_stats (property_id, day, ${column}) VALUES (?, date('now'), 1)
       ON CONFLICT(property_id, day) DO UPDATE SET ${column} = ${column} + 1`
    ).run(req.params.id);
    res.json({ ok: true });
  });

module.exports = router;
module.exports.invalidateCatalog = invalidateCatalog;
