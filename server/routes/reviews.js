'use strict';
const express = require('express');
const { z } = require('zod');
const { db, uid, audit } = require('../lib/db');
const A = require('../lib/auth');
const { limiter, validate, validateQuery, wrap } = require('../lib/http');
const { sendMailAsync } = require('../lib/mailer');

const router = express.Router();

function shape(r) {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    propertyId: r.property_id,
    propertyName: r.property_name,
    enquiryId: r.enquiry_id,
    rating: r.rating,
    comment: r.comment,
    cleanliness: r.cleanliness,
    service: r.service,
    location: r.location,
    amenities: r.amenities,
    value: r.value,
    ownerReply: r.owner_reply,
    status: r.status,
    date: r.created_at
  };
}

const score = z.coerce.number().int().min(1).max(5).optional();

/* -------------------------------------------------------------------- list */

router.get('/',
  validateQuery(z.object({
    propertyId: z.string().trim().optional(),
    mine: z.coerce.boolean().optional(),
    status: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).default(0)
  })),
  (req, res) => {
    const { propertyId, mine, status, limit, offset } = req.q;
    const where = [];
    const params = [];

    if (propertyId) { where.push('property_id = ?'); params.push(propertyId); }
    if (mine) {
      if (!req.user) return res.status(401).json({ ok: false, error: 'Not signed in' });
      where.push('user_id = ?'); params.push(req.user.id);
    } else if (req.user && req.user.role === 'owner') {
      // An owner sees every review on the properties they own, including pending ones.
      where.push('property_id IN (SELECT id FROM properties WHERE owner_id = ?)');
      params.push(req.user.id);
    } else if (!req.user || req.user.role !== 'admin') {
      where.push("status = 'Published'");
    }
    if (status && req.user && req.user.role === 'admin') { where.push('status = ?'); params.push(status); }

    const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const rows = db.prepare('SELECT * FROM reviews' + clause + ' ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?')
      .all(...params, limit, offset);
    const total = db.prepare('SELECT COUNT(*) c FROM reviews' + clause).get(...params).c;
    const agg = propertyId
      ? db.prepare("SELECT ROUND(AVG(rating),2) avg, COUNT(*) c FROM reviews WHERE property_id = ? AND status='Published'").get(propertyId)
      : null;

    res.json({ ok: true, total, average: agg ? agg.avg : null, count: agg ? agg.c : total, reviews: rows.map(shape) });
  });

/* ------------------------------------------------------------------ create */

router.post('/',
  A.requireAuth('traveler', 'admin'),
  limiter(15, 60),
  validate(z.object({
    propertyId: z.string().trim().min(1, 'Missing property'),
    propertyName: z.string().trim().optional(),
    enquiryId: z.string().trim().optional(),
    rating: z.coerce.number().int().min(1, 'Pick a rating').max(5),
    comment: z.string().trim().max(3000).optional(),
    cleanliness: score, service: score, location: score, amenities: score, value: score
  })),
  wrap(async (req, res) => {
    const b = req.body;
    const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(b.propertyId);
    const propertyName = property ? property.name : b.propertyName;
    if (!propertyName) return res.status(400).json({ ok: false, field: 'propertyId', error: 'Unknown property.' });

    // Reviews are tied to a real enquiry the hotel answered — that is the proof of stay.
    if (b.enquiryId) {
      const enq = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(b.enquiryId);
      if (!enq || (req.user.role !== 'admin' && enq.user_id !== req.user.id)) {
        return res.status(403).json({ ok: false, error: 'That enquiry is not yours.' });
      }
      if (enq.review_id) return res.status(409).json({ ok: false, error: 'You already reviewed this stay.' });
    }

    const id = 'REV-' + Math.floor(Math.random() * 899999 + 100000);
    db.prepare(
      `INSERT INTO reviews (id,user_id,user_name,property_id,property_name,enquiry_id,rating,comment,
                            cleanliness,service,location,amenities,value,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'Published')`
    ).run(id, req.user.id, req.user.name, b.propertyId, propertyName, b.enquiryId || null, b.rating,
          b.comment || null, b.cleanliness || null, b.service || null, b.location || null,
          b.amenities || null, b.value || null);

    if (b.enquiryId) db.prepare('UPDATE enquiries SET review_id = ? WHERE id = ?').run(id, b.enquiryId);
    audit(req.user.id, 'review.create', 'review', id, { propertyId: b.propertyId, rating: b.rating }, req.ip);

    if (property && property.owner_id) {
      const owner = db.prepare('SELECT email FROM users WHERE id = ?').get(property.owner_id);
      if (owner && owner.email) {
        sendMailAsync(owner.email, 'newReviewToOwner', {
          hotelName: propertyName, userName: req.user.name, rating: b.rating, comment: b.comment
        });
      }
    }

    res.status(201).json({ ok: true, review: shape(db.prepare('SELECT * FROM reviews WHERE id = ?').get(id)) });
  }));

/* --------------------------------------------------------- reply / moderate */

router.post('/:id/reply',
  A.requireAuth('owner', 'admin'),
  validate(z.object({ reply: z.string().trim().min(2, 'Write a reply').max(2000) })),
  (req, res) => {
    const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Review not found.' });
    if (req.user.role === 'owner') {
      const owns = db.prepare('SELECT 1 FROM properties WHERE id = ? AND owner_id = ?').get(row.property_id, req.user.id);
      if (!owns) return res.status(403).json({ ok: false, error: 'Not your property.' });
    }
    db.prepare(`UPDATE reviews SET owner_reply = ?, updated_at = datetime('now') WHERE id = ?`).run(req.body.reply, row.id);

    if (row.user_id) {
      const reviewer = db.prepare('SELECT email, name FROM users WHERE id = ?').get(row.user_id);
      if (reviewer && reviewer.email) {
        sendMailAsync(reviewer.email, 'reviewReplyNotice', {
          guestName: reviewer.name || row.user_name, hotelName: row.property_name, reply: req.body.reply, rating: row.rating
        });
      }
    }
    res.json({ ok: true, review: shape(db.prepare('SELECT * FROM reviews WHERE id = ?').get(row.id)) });
  });

router.patch('/:id',
  A.requireAuth('admin'),
  validate(z.object({ status: z.enum(['Pending', 'Published', 'Rejected']) })),
  (req, res) => {
    const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Review not found.' });
    db.prepare(`UPDATE reviews SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(req.body.status, row.id);
    audit(req.user.id, 'review.moderate', 'review', row.id, { status: req.body.status }, req.ip);
    res.json({ ok: true, review: shape(db.prepare('SELECT * FROM reviews WHERE id = ?').get(row.id)) });
  });

router.delete('/:id', A.requireAuth(), (req, res) => {
  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Review not found.' });
  if (req.user.role !== 'admin' && row.user_id !== req.user.id) {
    return res.status(403).json({ ok: false, error: 'Not your review.' });
  }
  db.prepare('DELETE FROM reviews WHERE id = ?').run(row.id);
  if (row.enquiry_id) db.prepare('UPDATE enquiries SET review_id = NULL WHERE id = ?').run(row.enquiry_id);
  audit(req.user.id, 'review.delete', 'review', row.id, null, req.ip);
  res.json({ ok: true });
});

module.exports = router;
