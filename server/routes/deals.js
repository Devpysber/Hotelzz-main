'use strict';
/**
 * Deals — the public face of hotel offers (deals.html, property.html, home).
 *
 * Owners create offers from their dashboard (routes/owner.js); admins can
 * create, feature, pause or bulk-import them for any property here. A visitor
 * "grabs" a deal with their name/email/phone: the coupon code is revealed and
 * emailed to them, and the hotel gets the lead.
 */
const express = require('express');
const { z } = require('zod');
const env = require('../lib/env');
const { db, uid, audit } = require('../lib/db');
const A = require('../lib/auth');
const { limiter, validate, wrap, slugify } = require('../lib/http');
const { sendMailAsync } = require('../lib/mailer');

const router = express.Router();

const CATEGORIES = ['Stay', 'Weekend', 'Honeymoon', 'Family', 'Long Stay', 'Dining', 'Spa', 'Last Minute', 'Festive'];

// A deal is live when it is Active, its property is active, and today falls
// inside its validity window (open-ended on either side when unset).
const LIVE = `o.status = 'Active' AND p.active = 1
  AND (o.valid_from IS NULL OR o.valid_from = '' OR o.valid_from <= date('now'))
  AND (o.valid_to IS NULL OR o.valid_to = '' OR o.valid_to >= date('now'))`;

const BASE_SELECT = `
  SELECT o.*, p.name AS hotel_name, p.location AS hotel_location, p.city_slug AS hotel_city_slug,
         p.rating AS hotel_rating, p.claim_status AS hotel_claim_status, p.owner_id AS hotel_owner_id,
         COALESCE(o.image_url,
                  (SELECT url FROM photos ph WHERE ph.property_id = p.id ORDER BY ph.is_cover DESC, ph.created_at LIMIT 1),
                  p.image_url) AS display_image
    FROM offers o JOIN properties p ON p.id = o.property_id`;

/** Public shape — never includes the coupon code. */
function publicShape(r) {
  const savings = r.original_price && r.deal_price && r.original_price > r.deal_price
    ? Math.round((1 - r.deal_price / r.original_price) * 100) : null;
  return {
    id: r.id,
    title: r.title,
    description: r.description || '',
    discount: r.discount || (savings ? savings + '% OFF' : ''),
    category: r.category || 'Stay',
    image: r.display_image || null,
    originalPrice: r.original_price || null,
    dealPrice: r.deal_price || null,
    terms: r.terms || '',
    validFrom: r.valid_from || null,
    validTo: r.valid_to || null,
    featured: !!r.featured,
    hasCode: !!(r.code && String(r.code).trim()),
    grabs: r.grabs || 0,
    property: {
      id: r.property_id, name: r.hotel_name, location: r.hotel_location,
      citySlug: r.hotel_city_slug, rating: r.hotel_rating, verified: r.hotel_claim_status === 'verified'
    }
  };
}

function adminShape(r) {
  return Object.assign(publicShape(r), {
    code: r.code || '', imageUrl: r.image_url || '', status: r.status, views: r.views || 0, createdAt: r.created_at, propertyId: r.property_id
  });
}

/* ------------------------------------------------------------------ public */

router.get('/', (req, res) => {
  const where = [LIVE];
  const params = [];
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) {
    where.push('(lower(o.title) LIKE ? OR lower(p.name) LIKE ? OR lower(p.location) LIKE ? OR lower(COALESCE(o.description,\'\')) LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (req.query.city) { where.push('p.city_slug = ?'); params.push(slugify(String(req.query.city))); }
  if (req.query.category) { where.push('o.category = ?'); params.push(String(req.query.category)); }
  if (req.query.property) { where.push('o.property_id = ?'); params.push(String(req.query.property)); }
  if (req.query.featured === '1') where.push('o.featured = 1');

  const order = {
    ending: "CASE WHEN o.valid_to IS NULL OR o.valid_to = '' THEN 1 ELSE 0 END, o.valid_to ASC",
    popular: 'o.grabs DESC, o.created_at DESC',
    newest: 'o.created_at DESC'
  }[req.query.sort] || 'o.featured DESC, o.grabs DESC, o.created_at DESC';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 200);

  const rows = db.prepare(`${BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit}`).all(...params);
  const cities = db.prepare(
    `SELECT p.location AS name, p.city_slug AS slug, COUNT(*) c FROM offers o JOIN properties p ON p.id = o.property_id
      WHERE ${LIVE} AND p.city_slug IS NOT NULL AND p.city_slug <> '' GROUP BY p.city_slug ORDER BY c DESC LIMIT 40`
  ).all();
  res.json({ ok: true, deals: rows.map(publicShape), categories: CATEGORIES, cities });
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`${BASE_SELECT} WHERE o.id = ? AND ${LIVE}`).get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'This deal has ended or does not exist.' });
  db.prepare('UPDATE offers SET views = views + 1 WHERE id = ?').run(row.id);
  res.json({ ok: true, deal: publicShape(row) });
});

/** Reveals the code: records the lead, emails the visitor and the hotel. */
router.post('/:id/grab',
  limiter(20, 60),
  validate(z.object({
    name: z.string().trim().min(2, 'Enter your name').max(120),
    email: z.string().trim().email('Enter a valid email address').max(200),
    phone: z.string().trim().min(8, 'Enter your phone number').max(20)
  })),
  (req, res) => {
    const row = db.prepare(`${BASE_SELECT} WHERE o.id = ? AND ${LIVE}`).get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'This deal has ended or does not exist.' });
    const b = req.body;
    const email = b.email.toLowerCase();

    // One grab per email per deal — repeat grabs just get the code again.
    const already = db.prepare('SELECT 1 FROM deal_grabs WHERE offer_id = ? AND lower(email) = ?').get(row.id, email);
    if (!already) {
      db.prepare('INSERT INTO deal_grabs (id, offer_id, property_id, user_id, name, email, phone) VALUES (?,?,?,?,?,?,?)')
        .run(uid('grb'), row.id, row.property_id, req.user ? req.user.id : null, b.name, email, b.phone);
      db.prepare('UPDATE offers SET grabs = grabs + 1 WHERE id = ?').run(row.id);

      const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(row.property_id);
      const owner = row.hotel_owner_id && require('../lib/ownership').canManage(prop)
        ? db.prepare('SELECT * FROM users WHERE id = ?').get(row.hotel_owner_id) : null;
      if (owner) {
        sendMailAsync(owner.email, 'dealGrabbedOwner', {
          name: owner.name, hotelName: row.hotel_name, title: row.title,
          guestName: b.name, guestEmail: email, guestPhone: b.phone
        });
      }
      audit(req.user ? req.user.id : null, 'deal.grab', 'offer', row.id, { email }, req.ip);
    }

    sendMailAsync(email, 'dealGrabbed', {
      name: b.name, title: row.title, hotelName: row.hotel_name, discount: row.discount || '',
      code: row.code || '', validTo: row.valid_to || '', terms: row.terms || '', propertyId: row.property_id
    });
    res.json({ ok: true, code: row.code || null, deal: publicShape(row),
               message: 'Deal unlocked! We have also emailed it to ' + email + '.' });
  });

/* ------------------------------------------------------------------- admin */

const admin = express.Router();
admin.use(A.requireAuth('admin'));

const dealSchema = z.object({
  propertyId: z.string().trim().min(1, 'Choose a property'),
  title: z.string().trim().min(2, 'Enter a deal title').max(160),
  description: z.string().trim().max(2000).optional(),
  discount: z.string().trim().max(60).optional(),
  code: z.string().trim().max(40).optional(),
  category: z.string().trim().max(40).optional(),
  imageUrl: z.string().trim().max(500).optional(),
  originalPrice: z.coerce.number().min(0).optional(),
  dealPrice: z.coerce.number().min(0).optional(),
  terms: z.string().trim().max(2000).optional(),
  validFrom: z.string().trim().optional(),
  validTo: z.string().trim().optional(),
  featured: z.coerce.boolean().optional(),
  status: z.enum(['Active', 'Scheduled', 'Expired', 'Paused']).optional()
});

const COLUMNS = {
  title: 'title', description: 'description', discount: 'discount', code: 'code', category: 'category',
  imageUrl: 'image_url', originalPrice: 'original_price', dealPrice: 'deal_price', terms: 'terms',
  validFrom: 'valid_from', validTo: 'valid_to', status: 'status', propertyId: 'property_id'
};

function insertDeal(b) {
  const id = uid('off');
  db.prepare(
    `INSERT INTO offers (id, property_id, title, description, discount, code, category, image_url,
                         original_price, deal_price, terms, valid_from, valid_to, featured, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, b.propertyId, b.title, b.description || null, b.discount || null, b.code || null,
        b.category || 'Stay', b.imageUrl || null, b.originalPrice || null, b.dealPrice || null,
        b.terms || null, b.validFrom || null, b.validTo || null, b.featured ? 1 : 0, b.status || 'Active');
  return id;
}

admin.get('/', (_req, res) => {
  const rows = db.prepare(`${BASE_SELECT} ORDER BY o.created_at DESC LIMIT 1000`).all();
  const grabs = db.prepare(
    `SELECT g.*, o.title, p.name AS hotel FROM deal_grabs g JOIN offers o ON o.id = g.offer_id
       LEFT JOIN properties p ON p.id = g.property_id ORDER BY g.created_at DESC LIMIT 300`
  ).all();
  res.json({ ok: true, deals: rows.map(adminShape), categories: CATEGORIES, grabs: grabs.map((g) => ({
    id: g.id, dealId: g.offer_id, deal: g.title, hotel: g.hotel, name: g.name, email: g.email, phone: g.phone, createdAt: g.created_at
  })) });
});

admin.post('/', validate(dealSchema), (req, res) => {
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.body.propertyId);
  if (!prop) return res.status(404).json({ ok: false, field: 'propertyId', error: 'Property not found.' });
  const id = insertDeal(req.body);
  audit(req.user.id, 'admin.deal.create', 'offer', id, { title: req.body.title }, req.ip);
  res.status(201).json({ ok: true, deal: adminShape(db.prepare(`${BASE_SELECT} WHERE o.id = ?`).get(id)) });
});

admin.patch('/:id', validate(dealSchema.partial()), (req, res) => {
  const row = db.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Deal not found.' });
  const b = req.body;
  if (b.propertyId && !db.prepare('SELECT 1 FROM properties WHERE id = ?').get(b.propertyId)) {
    return res.status(404).json({ ok: false, field: 'propertyId', error: 'Property not found.' });
  }
  const sets = [];
  const params = [];
  Object.keys(COLUMNS).forEach((k) => {
    if (b[k] !== undefined) { sets.push(`${COLUMNS[k]} = ?`); params.push(b[k] === '' ? null : b[k]); }
  });
  if (b.featured !== undefined) { sets.push('featured = ?'); params.push(b.featured ? 1 : 0); }
  if (!sets.length) return res.status(400).json({ ok: false, error: 'Nothing to update.' });
  db.prepare(`UPDATE offers SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params, row.id);
  audit(req.user.id, 'admin.deal.update', 'offer', row.id, b, req.ip);
  res.json({ ok: true, deal: adminShape(db.prepare(`${BASE_SELECT} WHERE o.id = ?`).get(row.id)) });
});

admin.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM offers WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ ok: false, error: 'Deal not found.' });
  audit(req.user.id, 'admin.deal.delete', 'offer', req.params.id, null, req.ip);
  res.json({ ok: true });
});

/**
 * Bulk import from CSV (parsed in the browser). Columns: property_id (or
 * property_name), title, description, discount, code, category, image_url,
 * original_price, deal_price, terms, valid_from, valid_to, featured.
 */
admin.post('/import',
  validate(z.object({ rows: z.array(z.record(z.any())).min(1, 'No rows to import').max(5000, 'Split files larger than 5,000 rows') })),
  (req, res) => {
    const byName = db.prepare('SELECT id FROM properties WHERE lower(name) = lower(?) LIMIT 1');
    const byId = db.prepare('SELECT id FROM properties WHERE id = ?');
    const errors = [];
    let imported = 0;
    const s = (v) => (v === undefined || v === null ? '' : String(v).trim());
    const num = (v) => { const n = parseFloat(s(v).replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : undefined; };

    db.transaction(() => {
      req.body.rows.forEach((r, i) => {
        const prop = (s(r.property_id) && byId.get(s(r.property_id))) || (s(r.property_name) && byName.get(s(r.property_name)));
        if (!prop) { errors.push({ row: i + 2, error: 'Property not found' }); return; }
        if (s(r.title).length < 2) { errors.push({ row: i + 2, error: 'Missing title' }); return; }
        insertDeal({
          propertyId: prop.id, title: s(r.title), description: s(r.description), discount: s(r.discount),
          code: s(r.code), category: s(r.category) || 'Stay', imageUrl: s(r.image_url),
          originalPrice: num(r.original_price), dealPrice: num(r.deal_price), terms: s(r.terms),
          validFrom: s(r.valid_from), validTo: s(r.valid_to),
          featured: /^(1|true|yes|y)$/i.test(s(r.featured)), status: 'Active'
        });
        imported++;
      });
    })();
    audit(req.user.id, 'admin.deal.import', 'offer', null, { imported, failed: errors.length }, req.ip);
    res.json({ ok: true, summary: { total: req.body.rows.length, imported, failed: errors.length }, errors: errors.slice(0, 100) });
  });

admin.get('/grabs/export', (req, res) => {
  const rows = db.prepare(
    `SELECT g.created_at, o.title, p.name AS hotel, g.name, g.email, g.phone FROM deal_grabs g
       JOIN offers o ON o.id = g.offer_id LEFT JOIN properties p ON p.id = g.property_id ORDER BY g.created_at DESC`
  ).all();
  const cell = (v) => { let t = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const csv = ['Date,Deal,Hotel,Name,Email,Phone']
    .concat(rows.map((r) => [r.created_at, r.title, r.hotel, r.name, r.email, r.phone].map(cell).join(','))).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="hotelzz-deal-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + csv);
});

module.exports = router;
module.exports.admin = admin;
module.exports.CATEGORIES = CATEGORIES;
