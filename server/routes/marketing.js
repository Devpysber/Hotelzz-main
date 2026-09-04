'use strict';
const express = require('express');
const { z } = require('zod');
const env = require('../lib/env');
const { db, uid, audit } = require('../lib/db');
const A = require('../lib/auth');
const { validate, wrap } = require('../lib/http');
const { sendMailAsync } = require('../lib/mailer');

const router = express.Router();
const json = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } };

/* ---------------------------------------------------------------- packages */

function shapePackage(p) {
  const cfg = json(p.config, {});
  return Object.assign({
    id: p.id,
    name: p.name,
    description: p.description,
    startingPrice: p.price,
    recommended: !!p.recommended,
    active: !!p.active,
    platforms: [],
    estimatedReach: '',
    estimatedImpressions: '',
    estimatedLeads: '',
    estimatedWhatsAppEnquiries: '',
    durations: []
  }, cfg);
}

router.get('/packages', (_req, res) => {
  const rows = db.prepare('SELECT * FROM marketing_packages ORDER BY sort_order, name').all();
  res.json({ ok: true, packages: rows.map(shapePackage) });
});

/* ------------------------------------------------------------------- plans */
// Public, read-only mirror of the admin-editable plan catalogue — the owner
// dashboard's upgrade cards read real prices from here instead of carrying
// their own hardcoded copy that an admin price edit would never reach.
router.get('/plans', (_req, res) => {
  const rows = db.prepare('SELECT * FROM plans ORDER BY sort_order, name').all();
  res.json({
    ok: true,
    plans: rows.map((p) => ({ id: p.id, name: p.name, price: p.price, period: p.period, features: json(p.features, []) }))
  });
});

router.patch('/packages/:id',
  A.requireAuth('admin'),
  validate(z.object({
    name: z.string().trim().min(2).optional(),
    description: z.string().trim().max(2000).optional(),
    startingPrice: z.coerce.number().min(0).optional(),
    recommended: z.coerce.boolean().optional(),
    active: z.coerce.boolean().optional(),
    platforms: z.array(z.string()).optional(),
    estimatedReach: z.string().trim().optional(),
    estimatedImpressions: z.string().trim().optional(),
    estimatedLeads: z.string().trim().optional(),
    estimatedWhatsAppEnquiries: z.string().trim().optional(),
    durations: z.array(z.record(z.any())).optional()
  })),
  (req, res) => {
    const row = db.prepare('SELECT * FROM marketing_packages WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Package not found.' });

    const b = req.body;
    const cfg = Object.assign(json(row.config, {}), {
      platforms: b.platforms, estimatedReach: b.estimatedReach,
      estimatedImpressions: b.estimatedImpressions, estimatedLeads: b.estimatedLeads,
      estimatedWhatsAppEnquiries: b.estimatedWhatsAppEnquiries, durations: b.durations
    });
    Object.keys(cfg).forEach((k) => { if (cfg[k] === undefined) delete cfg[k]; });

    db.prepare(
      `UPDATE marketing_packages SET name = COALESCE(?, name), description = COALESCE(?, description),
              price = COALESCE(?, price), recommended = COALESCE(?, recommended),
              active = COALESCE(?, active), config = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).run(b.name || null, b.description || null,
          b.startingPrice === undefined ? null : b.startingPrice,
          b.recommended === undefined ? null : (b.recommended ? 1 : 0),
          b.active === undefined ? null : (b.active ? 1 : 0),
          JSON.stringify(cfg), row.id);

    audit(req.user.id, 'marketing.package.update', 'package', row.id, b, req.ip);
    res.json({ ok: true, package: shapePackage(db.prepare('SELECT * FROM marketing_packages WHERE id = ?').get(row.id)) });
  });

/* --------------------------------------------------------------- campaigns */

function events(campaignId) {
  return db.prepare('SELECT title, description, created_at FROM campaign_events WHERE campaign_id = ? ORDER BY created_at, rowid')
    .all(campaignId)
    .map((e) => ({ time: e.created_at, title: e.title, desc: e.description }));
}

function addEvent(campaignId, title, description) {
  db.prepare('INSERT INTO campaign_events (id, campaign_id, title, description) VALUES (?,?,?,?)')
    .run(uid('cev'), campaignId, title, description || null);
}

function shapeCampaign(c) {
  const d = json(c.details, {});
  return {
    id: c.id,
    ownerId: c.owner_id,
    propertyId: c.property_id,
    propertyName: d.propertyName || '',
    propertyCity: d.propertyCity || '',
    packageId: d.packageId || null,
    packageName: c.plan || d.packageName || c.name,
    duration: d.duration || '',
    totalDays: d.totalDays || 0,
    targetLocations: d.targetLocations || [],
    audience: d.audience || [],
    gender: d.gender || 'All',
    targetingNotes: d.targetingNotes || '',
    amount: c.budget,
    gst: d.gst || 0,
    total: d.total || c.budget,
    paymentStatus: d.paymentStatus || 'Pending',
    campaignStatus: c.status,
    status: c.status,
    startDate: c.start_date,
    endDate: c.end_date,
    kpis: {
      reach: d.reach || 0,
      impressions: c.impressions,
      clicks: c.clicks,
      leads: c.leads_count,
      whatsappEnquiries: d.whatsappEnquiries || 0,
      costPerLead: c.leads_count ? Math.round(c.spend / c.leads_count) : 0
    },
    spend: c.spend,
    timeline: events(c.id)
  };
}

router.get('/campaigns', A.requireAuth(), (req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 300').all()
    : db.prepare('SELECT * FROM campaigns WHERE owner_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ ok: true, campaigns: rows.map(shapeCampaign) });
});

router.post('/campaigns',
  A.requireAuth('owner', 'admin'),
  validate(z.object({
    propertyId: z.string().trim().min(1, 'Pick a property'),
    packageId: z.string().trim().min(1, 'Pick a package'),
    durationDays: z.coerce.number().int().min(1).max(400).default(30),
    durationLabel: z.string().trim().optional(),
    amount: z.coerce.number().min(0),
    targetLocations: z.array(z.string()).optional(),
    audience: z.array(z.string()).optional(),
    gender: z.string().trim().optional(),
    targetingNotes: z.string().trim().max(1000).optional()
  })),
  wrap(async (req, res) => {
    const b = req.body;
    const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(b.propertyId);
    if (!property) return res.status(404).json({ ok: false, error: 'Property not found.' });
    if (req.user.role === 'owner' && property.owner_id !== req.user.id) {
      return res.status(403).json({ ok: false, error: 'Not your property.' });
    }
    const pkg = db.prepare('SELECT * FROM marketing_packages WHERE id = ?').get(b.packageId);
    if (!pkg) return res.status(404).json({ ok: false, error: 'Package not found.' });

    const gst = Math.round(b.amount * 0.18);
    const total = b.amount + gst;
    const id = 'HZ-CMP-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' +
               String(Math.floor(Math.random() * 900 + 100));
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + b.durationDays * 864e5).toISOString().slice(0, 10);

    db.prepare(
      `INSERT INTO campaigns (id, property_id, owner_id, name, channel, plan, budget, status,
                              start_date, end_date, details)
       VALUES (?,?,?,?,?,?,?, 'Pending', ?, ?, ?)`
    ).run(id, property.id, req.user.id, pkg.name + ' — ' + property.name, 'meta', pkg.name, b.amount,
          start, end, JSON.stringify({
            packageId: pkg.id, packageName: pkg.name,
            propertyName: property.name, propertyCity: property.location,
            duration: b.durationLabel || b.durationDays + ' Days', totalDays: b.durationDays,
            targetLocations: b.targetLocations || [], audience: b.audience || [],
            gender: b.gender || 'All', targetingNotes: b.targetingNotes || '',
            gst, total, paymentStatus: 'Payment pending'
          }));

    addEvent(id, 'Campaign requested', `${pkg.name} for ${b.durationDays} days — ₹${total.toLocaleString('en-IN')} incl. GST.`);
    addEvent(id, 'Pending review', 'Submitted to the Hotelzz marketing team.');
    audit(req.user.id, 'campaign.create', 'campaign', id, { packageId: pkg.id }, req.ip);

    sendMailAsync(req.user.email, 'campaignCreated', {
      name: req.user.name, hotelName: property.name, campaignId: id, packageName: pkg.name,
      amount: '₹' + total.toLocaleString('en-IN')
    });
    sendMailAsync(env.ADMIN_EMAIL, 'adminNewLead', {
      name: req.user.name, email: req.user.email, phone: req.user.phone,
      hotelName: property.name, city: property.location, plan: pkg.name,
      message: `Campaign ${id}: ${b.durationDays} days, ₹${total} incl. GST. Locations: ${(b.targetLocations || []).join(', ')}`
    });

    res.status(201).json({ ok: true, campaign: shapeCampaign(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id)) });
  }));

router.patch('/campaigns/:id',
  A.requireAuth('admin'),
  validate(z.object({
    status: z.enum(['Draft', 'Pending', 'Active', 'Paused', 'Completed']).optional(),
    spend: z.coerce.number().min(0).optional(),
    impressions: z.coerce.number().int().min(0).optional(),
    clicks: z.coerce.number().int().min(0).optional(),
    leads: z.coerce.number().int().min(0).optional(),
    note: z.string().trim().max(500).optional()
  })),
  (req, res) => {
    const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Campaign not found.' });
    const b = req.body;

    db.prepare(
      `UPDATE campaigns SET status = COALESCE(?, status), spend = COALESCE(?, spend),
              impressions = COALESCE(?, impressions), clicks = COALESCE(?, clicks),
              leads_count = COALESCE(?, leads_count), updated_at = datetime('now')
        WHERE id = ?`
    ).run(b.status || null, b.spend ?? null, b.impressions ?? null, b.clicks ?? null, b.leads ?? null, row.id);

    if (b.status) addEvent(row.id, 'Status updated to ' + b.status, b.note || 'Updated by the Hotelzz marketing team.');
    audit(req.user.id, 'campaign.update', 'campaign', row.id, b, req.ip);

    const owner = row.owner_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(row.owner_id) : null;
    if (owner && b.status) {
      sendMailAsync(owner.email, 'campaignStatus', {
        name: owner.name, campaignId: row.id, campaign: row.name, status: b.status, note: b.note
      });
    }

    res.json({ ok: true, campaign: shapeCampaign(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(row.id)) });
  });

module.exports = router;
