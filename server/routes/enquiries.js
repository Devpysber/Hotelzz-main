'use strict';
const express = require('express');
const { z } = require('zod');
const env = require('../lib/env');
const { db, uid, audit } = require('../lib/db');
const A = require('../lib/auth');
const { limiter, validate, validateQuery, wrap } = require('../lib/http');
const { sendMailAsync, sendMail } = require('../lib/mailer');

const router = express.Router();

function events(enquiryId) {
  return db.prepare('SELECT title, description, created_at FROM enquiry_events WHERE enquiry_id = ? ORDER BY created_at, rowid')
    .all(enquiryId)
    .map((e) => ({ time: e.created_at, title: e.title, desc: e.description }));
}

function addEvent(enquiryId, title, description) {
  db.prepare('INSERT INTO enquiry_events (id, enquiry_id, title, description) VALUES (?,?,?,?)')
    .run(uid('evt'), enquiryId, title, description || null);
}

function shape(row, withTimeline) {
  if (!row) return null;
  // The traveller needs the hotel's own number to call or WhatsApp them.
  const property = row.property_id
    ? db.prepare('SELECT phone, website, address FROM properties WHERE id = ?').get(row.property_id)
    : null;
  return {
    propertyPhone: property ? property.phone : null,
    propertyAddress: property ? property.address : null,
    propertyWebsite: property ? property.website : null,
    id: row.id,
    userId: row.user_id,
    propertyId: row.property_id,
    propertyName: row.property_name,
    propertyCity: row.property_city,
    ownerId: row.owner_id,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone,
    checkIn: row.check_in,
    checkOut: row.check_out,
    guests: row.guests,
    message: row.message,
    source: row.source,
    status: row.status,
    hotelResponse: row.hotel_response,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    openedAt: row.opened_at,
    respondedAt: row.responded_at,
    closedAt: row.closed_at,
    reviewId: row.review_id,
    isEligibleForReview: row.status === 'Responded' && !row.review_id,
    timeline: withTimeline ? events(row.id) : undefined
  };
}

/** The visibility rule for a single enquiry, shared by every read/write route. */
function canSee(user, row) {
  if (!user || !row) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'owner') return row.owner_id === user.id;
  return row.user_id === user.id;
}

const isOwnerOf = (user, row) => user && (user.role === 'admin' || (user.role === 'owner' && row.owner_id === user.id));

/* ------------------------------------------------------------------ create */

router.post('/',
  limiter(20, 60),
  validate(z.object({
    propertyId: z.string().trim().min(1, 'Missing property'),
    propertyName: z.string().trim().min(1, 'Missing property name').optional(),
    propertyCity: z.string().trim().optional(),
    name: z.string().trim().min(2, 'Enter your name'),
    email: z.string().trim().email('Enter a valid email address'),
    phone: z.string().trim().min(8, 'Enter a valid phone number'),
    checkIn: z.string().trim().optional(),
    checkOut: z.string().trim().optional(),
    guests: z.coerce.number().int().min(1).max(50).default(2),
    message: z.string().trim().max(2000).optional(),
    source: z.string().trim().max(40).optional()
  })),
  wrap(async (req, res) => {
    const b = req.body;
    const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(b.propertyId);
    const propertyName = property ? property.name : b.propertyName;
    if (!propertyName) return res.status(400).json({ ok: false, field: 'propertyId', error: 'Unknown property.' });

    const id = 'HZ-ENQ-' + Math.floor(Math.random() * 89999 + 10000);
    db.prepare(
      `INSERT INTO enquiries (id, user_id, property_id, property_name, property_city, owner_id,
                              guest_name, guest_email, guest_phone, check_in, check_out, guests,
                              message, source, status, delivered_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Sent', datetime('now'))`
    ).run(id, req.user ? req.user.id : null, b.propertyId, propertyName,
          b.propertyCity || (property ? property.location : null), property ? property.owner_id : null,
          b.name, b.email.toLowerCase(), b.phone, b.checkIn || null, b.checkOut || null,
          b.guests, b.message || null, b.source || 'website');

    addEvent(id, 'Enquiry Sent', 'Delivered to Hotelzz platform.');
    audit(req.user ? req.user.id : null, 'enquiry.create', 'enquiry', id, { propertyId: b.propertyId }, req.ip);

    const mailData = {
      hotelName: propertyName, guestName: b.name, guestEmail: b.email, guestPhone: b.phone,
      checkIn: b.checkIn, checkOut: b.checkOut, guests: b.guests, message: b.message, enquiryId: id,
      city: b.propertyCity || (property ? property.location : null)
    };
    const ownerEmail = property && (property.email || null);
    const ownerUser = property && property.owner_id
      ? db.prepare('SELECT email FROM users WHERE id = ?').get(property.owner_id) : null;
    const target = (ownerUser && ownerUser.email) || ownerEmail;
    // Timeline used to always say "Notification sent to the hotel owner" even
    // when the property is unclaimed and has no owner email to send to —
    // fabricating a delivery that never happened. Say what actually occurred.
    if (target) {
      sendMailAsync(target, 'enquiryToOwner', mailData);
      addEvent(id, 'Delivered to Hotel', 'Notification sent to the hotel owner.');
    } else {
      addEvent(id, 'Awaiting Claim', 'This property has no verified owner yet — Hotelzz ops will follow up directly.');
    }
    sendMailAsync(b.email, 'enquiryReceipt', { guestName: b.name, hotelName: propertyName, checkIn: b.checkIn, checkOut: b.checkOut, enquiryId: id });
    sendMailAsync(env.ADMIN_EMAIL, 'adminNewEnquiry', mailData);

    const row = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(id);
    res.status(201).json({ ok: true, enquiry: shape(row, true) });
  }));

/* -------------------------------------------------------------------- list */

router.get('/',
  A.requireAuth(),
  validateQuery(z.object({
    status: z.string().trim().optional(),
    propertyId: z.string().trim().optional(),
    q: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).default(0)
  })),
  (req, res) => {
    const { status, propertyId, q, limit, offset } = req.q;
    const where = [];
    const params = [];

    if (req.user.role === 'traveler') { where.push('user_id = ?'); params.push(req.user.id); }
    if (req.user.role === 'owner') { where.push('owner_id = ?'); params.push(req.user.id); }
    if (status && status !== 'All') { where.push('status = ?'); params.push(status); }
    if (propertyId) { where.push('property_id = ?'); params.push(propertyId); }
    if (q) {
      where.push('(guest_name LIKE ? OR guest_email LIKE ? OR property_name LIKE ? OR id LIKE ?)');
      const like = '%' + q + '%';
      params.push(like, like, like, like);
    }
    const sql = 'SELECT * FROM enquiries' + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
                ' ORDER BY sent_at DESC, rowid DESC LIMIT ? OFFSET ?';
    const rows = db.prepare(sql).all(...params, limit, offset);
    const total = db.prepare('SELECT COUNT(*) c FROM enquiries' + (where.length ? ' WHERE ' + where.join(' AND ') : ''))
      .get(...params).c;

    res.json({ ok: true, total, enquiries: rows.map((r) => shape(r, false)) });
  });

/* ------------------------------------------------------------------ detail */

router.get('/:id', A.requireAuth(), (req, res) => {
  const row = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Enquiry not found.' });
  if (!canSee(req.user, row)) return res.status(403).json({ ok: false, error: 'Not your enquiry.' });

  // An owner opening the enquiry is what marks it read for the traveler.
  if (row.status === 'Sent' && isOwnerOf(req.user, row)) {
    db.prepare(`UPDATE enquiries SET status='Opened', opened_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(row.id);
    addEvent(row.id, 'Opened by Hotel', 'The hotel opened and viewed your enquiry.');
    return res.json({ ok: true, enquiry: shape(db.prepare('SELECT * FROM enquiries WHERE id = ?').get(row.id), true) });
  }
  res.json({ ok: true, enquiry: shape(row, true) });
});

/* ------------------------------------------------------------ owner actions */

router.post('/:id/open', A.requireAuth('owner', 'admin'), (req, res) => {
  const row = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Enquiry not found.' });
  if (!isOwnerOf(req.user, row)) return res.status(403).json({ ok: false, error: 'Not your enquiry.' });

  if (row.status === 'Sent') {
    db.prepare(`UPDATE enquiries SET status='Opened', opened_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(row.id);
    addEvent(row.id, 'Opened by Hotel', 'The hotel opened and viewed your enquiry.');
  }
  res.json({ ok: true, enquiry: shape(db.prepare('SELECT * FROM enquiries WHERE id = ?').get(row.id), true) });
});

router.post('/:id/respond',
  A.requireAuth('owner', 'admin'),
  validate(z.object({ response: z.string().trim().min(2, 'Write a response').max(4000) })),
  (req, res) => {
    const row = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Enquiry not found.' });
    if (!isOwnerOf(req.user, row)) return res.status(403).json({ ok: false, error: 'Not your enquiry.' });

    db.prepare(
      `UPDATE enquiries SET status='Responded', hotel_response=?, responded_at=datetime('now'),
              opened_at=COALESCE(opened_at, datetime('now')), updated_at=datetime('now') WHERE id=?`
    ).run(req.body.response, row.id);
    addEvent(row.id, 'Hotel Responded', 'The hotel sent a direct availability response.');
    audit(req.user.id, 'enquiry.respond', 'enquiry', row.id, null, req.ip);

    sendMailAsync(row.guest_email, 'enquiryResponse', {
      guestName: row.guest_name, hotelName: row.property_name,
      response: req.body.response, enquiryId: row.id
    });

    res.json({ ok: true, enquiry: shape(db.prepare('SELECT * FROM enquiries WHERE id = ?').get(row.id), true) });
  });

router.patch('/:id',
  A.requireAuth(),
  validate(z.object({ status: z.enum(['Sent', 'Opened', 'Responded', 'Contacted', 'Converted', 'Closed', 'Spam']) })),
  (req, res) => {
    const row = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Enquiry not found.' });
    const mayEdit = req.user.role === 'admin' || isOwnerOf(req.user, row) ||
                    (req.user.role === 'traveler' && row.user_id === req.user.id && req.body.status === 'Closed');
    if (!mayEdit) return res.status(403).json({ ok: false, error: 'Not allowed.' });

    db.prepare(
      `UPDATE enquiries SET status=?, closed_at=CASE WHEN ?='Closed' THEN datetime('now') ELSE closed_at END,
              updated_at=datetime('now') WHERE id=?`
    ).run(req.body.status, req.body.status, row.id);
    addEvent(row.id, 'Status: ' + req.body.status, 'Updated by ' + req.user.role + '.');

    if (['Closed', 'Converted'].includes(req.body.status) && row.guest_email) {
      sendMailAsync(row.guest_email, 'enquiryClosed', {
        guestName: row.guest_name, hotelName: row.property_name, status: req.body.status, enquiryId: row.id
      });
    }
    res.json({ ok: true, enquiry: shape(db.prepare('SELECT * FROM enquiries WHERE id = ?').get(row.id), true) });
  });

/* --------------------------------------------------- owner -> guest message */

// A hotel's own mail service to its own guest, and only that guest — the
// recipient is derived from the enquiry (owner_id must match), never taken
// as a free-form address from the client.
router.post('/:id/message',
  A.requireAuth('owner', 'admin'),
  limiter(10, 60),
  validate(z.object({
    subject: z.string().trim().max(150).optional(),
    message: z.string().trim().min(2, 'Write a message').max(4000)
  })),
  wrap(async (req, res) => {
    const row = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Enquiry not found.' });
    if (!isOwnerOf(req.user, row)) return res.status(403).json({ ok: false, error: 'Not your guest.' });
    if (!row.guest_email) return res.status(400).json({ ok: false, error: 'This enquiry has no guest email on file.' });

    const property = row.property_id ? db.prepare('SELECT email FROM properties WHERE id = ?').get(row.property_id) : null;
    const result = await sendMail(row.guest_email, 'vendorToGuest', {
      guestName: row.guest_name, hotelName: row.property_name, ownerName: req.user.name,
      subject: req.body.subject, message: req.body.message, enquiryId: row.id
    }, {
      replyTo: property && property.email ? property.email : req.user.email,
      kind: 'vendor', senderUserId: req.user.id
    });
    if (!result.ok) return res.status(502).json({ ok: false, error: 'Could not send that message right now.' });

    addEvent(row.id, 'Message from hotel', req.body.subject || req.body.message.slice(0, 120));
    audit(req.user.id, 'enquiry.message', 'enquiry', row.id, { emailId: result.id }, req.ip);
    res.json({ ok: true, enquiry: shape(db.prepare('SELECT * FROM enquiries WHERE id = ?').get(row.id), true) });
  }));

module.exports = router;
