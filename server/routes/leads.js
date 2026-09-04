'use strict';
const express = require('express');
const { z } = require('zod');
const env = require('../lib/env');
const { db, uid, audit } = require('../lib/db');
const A = require('../lib/auth');
const { limiter, validate, validateQuery } = require('../lib/http');
const { sendMailAsync } = require('../lib/mailer');

const router = express.Router();

function shape(l) {
  return {
    id: l.id, type: l.type, name: l.name, email: l.email, phone: l.phone,
    hotelName: l.hotel_name, city: l.city, plan: l.plan, message: l.message,
    propertyId: l.property_id, source: l.source, status: l.status,
    notes: l.owner_notes, createdAt: l.created_at
  };
}

/* ------------------------------------------------------------------ create */

router.post('/',
  limiter(20, 60),
  validate(z.object({
    name: z.string().trim().min(2, 'Enter your name'),
    email: z.string().trim().email('Enter a valid email address').optional().or(z.literal('')),
    phone: z.string().trim().min(8, 'Enter a valid phone number'),
    hotelName: z.string().trim().optional(),
    city: z.string().trim().optional(),
    plan: z.string().trim().optional(),
    message: z.string().trim().max(2000).optional(),
    propertyId: z.string().trim().optional(),
    type: z.string().trim().max(40).optional(),
    source: z.string().trim().max(80).optional()
  })),
  (req, res) => {
    const b = req.body;
    const id = uid('lead');
    db.prepare(
      `INSERT INTO leads (id, type, name, email, phone, hotel_name, city, plan, message, property_id, source, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'New')`
    ).run(id, b.type || 'marketing', b.name, b.email || null, b.phone, b.hotelName || null,
          b.city || null, b.plan || null, b.message || null, b.propertyId || null, b.source || 'website');

    audit(req.user ? req.user.id : null, 'lead.create', 'lead', id, { plan: b.plan }, req.ip);
    if (b.email) sendMailAsync(b.email, 'leadReceipt', { name: b.name, plan: b.plan });
    sendMailAsync(env.ADMIN_EMAIL, 'adminNewLead', {
      name: b.name, email: b.email, phone: b.phone, hotelName: b.hotelName,
      city: b.city, plan: b.plan, message: b.message
    });

    res.status(201).json({ ok: true, id, message: 'Thanks! Our team calls you back within one business day.' });
  });

/* -------------------------------------------------------------- admin CRM */

router.get('/',
  A.requireAuth('admin'),
  validateQuery(z.object({
    status: z.string().trim().optional(),
    type: z.string().trim().optional(),
    q: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
    offset: z.coerce.number().int().min(0).default(0)
  })),
  (req, res) => {
    const { status, type, q, limit, offset } = req.q;
    const where = [];
    const params = [];
    if (status && status !== 'All') { where.push('status = ?'); params.push(status); }
    if (type) { where.push('type = ?'); params.push(type); }
    if (q) {
      where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR hotel_name LIKE ?)');
      const like = '%' + q + '%';
      params.push(like, like, like, like);
    }
    const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const rows = db.prepare('SELECT * FROM leads' + clause + ' ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(...params, limit, offset);
    const total = db.prepare('SELECT COUNT(*) c FROM leads' + clause).get(...params).c;
    res.json({ ok: true, total, leads: rows.map(shape) });
  });

router.patch('/:id',
  A.requireAuth('admin'),
  validate(z.object({
    status: z.enum(['New', 'Contacted', 'Qualified', 'Won', 'Lost']).optional(),
    notes: z.string().trim().max(2000).optional()
  })),
  (req, res) => {
    const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Lead not found.' });
    db.prepare(
      `UPDATE leads SET status = COALESCE(?, status), owner_notes = COALESCE(?, owner_notes),
              updated_at = datetime('now') WHERE id = ?`
    ).run(req.body.status || null, req.body.notes || null, row.id);
    audit(req.user.id, 'lead.update', 'lead', row.id, req.body, req.ip);
    res.json({ ok: true, lead: shape(db.prepare('SELECT * FROM leads WHERE id = ?').get(row.id)) });
  });

router.delete('/:id', A.requireAuth('admin'), (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  audit(req.user.id, 'lead.delete', 'lead', req.params.id, null, req.ip);
  res.json({ ok: true });
});

module.exports = router;
