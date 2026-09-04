'use strict';
const express = require('express');
const { z } = require('zod');
const { db, uid, audit } = require('../lib/db');
const A = require('../lib/auth');
const { limiter, validate, validateQuery, wrap } = require('../lib/http');
const { sendMailAsync, sendMail, sendCustomMail, renderTemplate, listTemplates } = require('../lib/mailer');
const { invalidateCatalog } = require('./properties');

const router = express.Router();
router.use(A.requireAuth('admin'));

const json = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } };
const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const mask = (phone) => {
  const s = String(phone || '');
  return s.length > 6 ? s.slice(0, 5) + '••••••' + s.slice(-2) : (s || '—');
};
const one = (sql, ...params) => db.prepare(sql).get(...params);
const many = (sql, ...params) => db.prepare(sql).all(...params);

/**
 * Pulls whatever real records exist for this address — the account itself,
 * their property, latest enquiry, review, lead, invoice, campaign, payment —
 * and flattens them into the same field names the email templates use
 * (guestName, hotelName, enquiryId, amount, ...). Used so the Email Center
 * fills a template with this recipient's actual data instead of sample text.
 */
function buildRealContext(email) {
  const lower = String(email || '').trim().toLowerCase();
  const ctx = {};
  if (!lower) return ctx;

  const user = one('SELECT * FROM users WHERE lower(email) = ? ORDER BY created_at DESC LIMIT 1', lower);
  if (user) {
    ctx.name = user.name;
    ctx.email = user.email;
    ctx.phone = user.phone;
  }

  let property = user && user.role === 'owner'
    ? one('SELECT * FROM properties WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 1', user.id)
    : null;
  if (!property) property = one('SELECT * FROM properties WHERE lower(email) = ? ORDER BY updated_at DESC LIMIT 1', lower);
  if (property) {
    ctx.hotelName = property.name;
    ctx.city = property.location;
    ctx.ownerName = ctx.name;

    const sub = one('SELECT * FROM subscriptions WHERE property_id = ?', property.id);
    if (sub) { ctx.planName = sub.plan_name; ctx.price = sub.price; }

    const inv = one('SELECT * FROM invoices WHERE property_id = ? ORDER BY issued_at DESC LIMIT 1', property.id);
    if (inv) { ctx.invoiceNumber = inv.number; ctx.amount = inv.amount; ctx.plan = inv.plan; }

    const camp = one('SELECT * FROM campaigns WHERE property_id = ? ORDER BY created_at DESC LIMIT 1', property.id);
    if (camp) { ctx.campaignId = camp.id; ctx.campaign = camp.name; ctx.packageName = camp.plan; ctx.status = camp.status; }
  }

  let enquiry = one('SELECT * FROM enquiries WHERE lower(guest_email) = ? ORDER BY sent_at DESC LIMIT 1', lower);
  if (!enquiry && property) enquiry = one('SELECT * FROM enquiries WHERE property_id = ? ORDER BY sent_at DESC LIMIT 1', property.id);
  if (enquiry) {
    ctx.enquiryId = enquiry.id;
    ctx.guestName = enquiry.guest_name;
    ctx.guestEmail = enquiry.guest_email;
    ctx.guestPhone = enquiry.guest_phone;
    ctx.checkIn = enquiry.check_in;
    ctx.checkOut = enquiry.check_out;
    ctx.guests = enquiry.guests;
    ctx.message = enquiry.message;
    ctx.hotelName = ctx.hotelName || enquiry.property_name;
    ctx.city = ctx.city || enquiry.property_city;
    ctx.response = enquiry.hotel_response;
    ctx.status = enquiry.status;
  }

  let review = user ? one('SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', user.id) : null;
  if (!review && property) review = one('SELECT * FROM reviews WHERE property_id = ? ORDER BY created_at DESC LIMIT 1', property.id);
  if (review) {
    ctx.rating = review.rating;
    ctx.comment = review.comment;
    ctx.reply = review.owner_reply;
    ctx.userName = review.user_name;
    ctx.hotelName = ctx.hotelName || review.property_name;
  }

  const lead = one('SELECT * FROM leads WHERE lower(email) = ? ORDER BY created_at DESC LIMIT 1', lower);
  if (lead) {
    ctx.plan = ctx.plan || lead.plan;
    ctx.hotelName = ctx.hotelName || lead.hotel_name;
    ctx.city = ctx.city || lead.city;
    ctx.phone = ctx.phone || lead.phone;
    ctx.name = ctx.name || lead.name;
  }

  if (user) {
    const payment = one('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', user.id);
    if (payment) {
      ctx.amount = ctx.amount || payment.amount;
      ctx.currency = payment.currency;
      ctx.purpose = payment.purpose;
      ctx.reference = payment.reference_id || payment.id;
    }
  }

  return ctx;
}

// Plan catalogue lives in the `plans` table (seeded once, editable from the
// admin panel from here on) — not a hardcoded list, so an admin edit here
// actually changes pricing everywhere it's used (MRR, revenue chart, the
// owner-facing upgrade cards), instead of only updating this screen.
function loadPlans() {
  return many('SELECT * FROM plans ORDER BY sort_order, name').map((p) => ({
    id: p.id, name: p.name, price: p.price, period: p.period,
    features: json(p.features, [])
  }));
}

/* --------------------------------------------------------------- bootstrap */

router.get('/bootstrap', (req, res) => {
  const totalProperties = one('SELECT COUNT(*) c FROM properties').c;
  const claimed = one("SELECT COUNT(*) c FROM properties WHERE claim_status = 'verified'").c;
  const pendingClaims = one("SELECT COUNT(*) c FROM properties WHERE claim_status = 'pending'").c;
  const rejected = one("SELECT COUNT(*) c FROM properties WHERE claim_status = 'rejected'").c;
  const owners = many("SELECT * FROM users WHERE role = 'owner' ORDER BY created_at DESC LIMIT 200");
  const activeSubs = one("SELECT COUNT(*) c FROM subscriptions WHERE status = 'Active' AND plan_name <> 'Free Listing'").c;

  // Real claim outcome rate — verified vs rejected, out of every claim
  // that's actually been decided (pending ones aren't a "success" or a
  // "failure" yet, so they're excluded from the rate itself).
  const claimsDecided = claimed + rejected;
  const claimsSuccessRate = claimsDecided ? ((claimed / claimsDecided) * 100).toFixed(1) + '%' : null;

  // Real, cumulative CSV import quality — summed across every import audit
  // entry ever recorded (a single upload can span several chunked calls,
  // each logged separately, so this is the honest total rather than a
  // fabricated one-shot number).
  const importRows = many("SELECT meta, created_at FROM audit_log WHERE action = 'admin.import' ORDER BY created_at DESC");
  let importTotalRows = 0, importImported = 0, importDuplicates = 0, importInvalid = 0;
  let lastImportSize = null;
  importRows.forEach((r, i) => {
    let m; try { m = JSON.parse(r.meta || '{}'); } catch (_) { m = {}; }
    importTotalRows += m.total || 0;
    importImported += m.imported || 0;
    importDuplicates += m.duplicates || 0;
    importInvalid += m.invalid || 0;
    if (i === 0) lastImportSize = m.total || null;
  });
  const importSuccessRate = importTotalRows ? ((importImported / importTotalRows) * 100).toFixed(1) + '%' : null;
  const importDuplicateRate = importTotalRows ? ((importDuplicates / importTotalRows) * 100).toFixed(1) + '%' : null;

  const PLANS = loadPlans();
  const planPrice = (name) => {
    const p = PLANS.find((x) => x.name === name);
    return p ? p.price : 0;
  };
  const subs = many(
    `SELECT s.*, p.name AS hotel_name, p.owner_id, u.name AS owner_name
       FROM subscriptions s JOIN properties p ON p.id = s.property_id
       LEFT JOIN users u ON u.id = p.owner_id`
  );
  const mrr = subs.filter((s) => s.status === 'Active').reduce((sum, s) => sum + planPrice(s.plan_name), 0);
  const invoiceTotal = many('SELECT amount FROM invoices')
    .reduce((sum, i) => sum + (parseFloat(String(i.amount).replace(/[^\d.]/g, '')) || 0), 0);

  const cities = many(
    `SELECT city_slug AS slug, MIN(location) AS name, COUNT(*) AS properties,
            SUM(CASE WHEN claim_status = 'verified' THEN 1 ELSE 0 END) AS claimed
       FROM properties WHERE city_slug IS NOT NULL AND city_slug <> ''
      GROUP BY city_slug ORDER BY properties DESC LIMIT 25`
  );

  const propertyRows = many(
    `SELECT p.*, u.name AS owner_name, u.email AS owner_email,
            (SELECT COUNT(*) FROM enquiries e WHERE e.property_id = p.id) AS lead_count,
            (SELECT COALESCE(SUM(views),0) FROM property_stats st WHERE st.property_id = p.id) AS views,
            (SELECT plan_name FROM subscriptions s WHERE s.property_id = p.id) AS plan_name
       FROM properties p LEFT JOIN users u ON u.id = p.owner_id
      ORDER BY p.updated_at DESC LIMIT 200`
  );

  const claimRows = many(
    `SELECT p.*, u.name AS claimant, u.email AS claimant_email, u.phone AS claimant_phone, u.id AS claimant_id
       FROM properties p JOIN users u ON u.id = p.owner_id
      WHERE p.claim_status IN ('pending','verified','rejected')
      ORDER BY p.updated_at DESC LIMIT 200`
  );

  const enquiryLeads = many(
    `SELECT e.*, p.location AS city, u.name AS owner_name
       FROM enquiries e LEFT JOIN properties p ON p.id = e.property_id
       LEFT JOIN users u ON u.id = e.owner_id
      ORDER BY e.sent_at DESC LIMIT 200`
  );
  const marketingLeads = many('SELECT * FROM leads ORDER BY created_at DESC LIMIT 200');

  res.json({
    ok: true,
    admin: { id: req.user.id, name: req.user.name, email: req.user.email },

    integrations: {
      email: require('../lib/env').smtpConfigured ? 'smtp' : 'console-only',
      payments: require('../lib/payments').isConfigured() ? 'razorpay' : 'manual-invoicing',
      ads: require('../lib/ads').status()
    },

    kpis: {
      totalProperties,
      totalPropertiesGrowth: '+' + one("SELECT COUNT(*) c FROM properties WHERE created_at >= date('now','-30 days')").c + ' this month',
      claimedProperties: claimed,
      unclaimedProperties: totalProperties - claimed,
      claimedPercentage: totalProperties ? ((claimed / totalProperties) * 100).toFixed(1) + '%' : '0%',
      activeOwners: owners.filter((o) => o.status === 'active').length,
      activeOwnersGrowth: '+' + one("SELECT COUNT(*) c FROM users WHERE role='owner' AND created_at >= date('now','-30 days')").c + ' this month',
      activeSubscriptions: activeSubs,
      subscriptionsGrowth: '',
      mrr: inr(mrr),
      mrrGrowth: '',
      claimsTotal: claimed + pendingClaims + rejected,
      claimsSuccessful: claimed,
      claimsFailed: rejected,
      claimsSuccessRate,
      pendingClaims,
      lastImportSize,
      totalImportedProperties: importImported,
      importSuccessRate,
      importDuplicateRate,
      totalEnquiries: one('SELECT COUNT(*) c FROM enquiries').c,
      enquiriesThisMonth: one("SELECT COUNT(*) c FROM enquiries WHERE sent_at >= date('now','-30 days')").c,
      respondedEnquiries: one("SELECT COUNT(*) c FROM enquiries WHERE status IN ('Responded','Converted')").c,
      totalReviews: one('SELECT COUNT(*) c FROM reviews').c,
      totalLeads: one('SELECT COUNT(*) c FROM leads').c,
      newLeads: one("SELECT COUNT(*) c FROM leads WHERE status = 'New'").c,
      emailsSent: one('SELECT COUNT(*) c FROM email_log').c,
      emailsFailed: one("SELECT COUNT(*) c FROM email_log WHERE status = 'failed'").c
    },

    revenueStats: {
      totalRevenue: inr(invoiceTotal),
      thisMonth: inr(many("SELECT amount FROM invoices WHERE issued_at >= date('now','start of month')")
        .reduce((s, i) => s + (parseFloat(String(i.amount).replace(/[^\d.]/g, '')) || 0), 0)),
      mrr: inr(mrr),
      arpu: activeSubs ? inr(mrr / activeSubs) : '₹0'
    },

    propertyTrends: {
      series: many(
        `SELECT date(created_at) AS day, COUNT(*) AS added FROM properties
          WHERE created_at >= date('now','-30 days') GROUP BY date(created_at) ORDER BY day`
      ),
      enquiries: many(
        `SELECT date(sent_at) AS day, COUNT(*) AS count FROM enquiries
          WHERE sent_at >= date('now','-30 days') GROUP BY date(sent_at) ORDER BY day`
      )
    },

    cities,
    plans: PLANS.map((p) => ({
      ...p,
      subscribers: subs.filter((s) => s.plan_name === p.name).length,
      mrr: inr(subs.filter((s) => s.plan_name === p.name && s.status === 'Active').length * p.price),
      status: 'Active'
    })),

    properties: propertyRows.map((p) => ({
      id: p.id,
      name: p.name,
      city: p.location,
      state: json(p.details, {}).state || '',
      address: p.address || '',
      owner: p.owner_name || '—',
      ownerEmail: p.owner_email || '—',
      phoneMasked: mask(p.phone),
      claimStatus: p.claim_status === 'verified' ? 'Claimed'
                 : p.claim_status === 'pending' ? 'Pending' : 'Unclaimed',
      subscription: p.plan_name || 'Free',
      rating: p.rating,
      reviewCount: p.google_review_count || 0,
      addedOn: p.created_at,
      status: p.active ? 'Active' : 'Hidden',
      category: p.property_type || json(p.details, {}).category || '—',
      views: p.views || 0,
      leads: p.lead_count || 0
    })),

    claims: claimRows.map((c) => ({
      id: 'CLM-' + String(c.id).slice(-6),
      propertyId: c.id,
      propertyName: c.name,
      city: c.location,
      claimantName: c.claimant,
      email: c.claimant_email,
      phoneMasked: mask(c.claimant_phone),
      phoneMatchStatus: c.claim_status === 'verified' ? 'Verified' : 'Pending review',
      claimStatus: c.claim_status === 'verified' ? 'Claimed'
                 : c.claim_status === 'rejected' ? 'Rejected' : 'Pending',
      startedDate: c.created_at,
      completedDate: c.claim_status === 'verified' ? c.updated_at : null,
      ownerAccount: c.claimant_id
    })),

    owners: owners.map((o) => ({
      id: o.id,
      name: o.name,
      company: o.city ? o.name + ' — ' + o.city : o.name,
      email: o.email,
      phoneMasked: mask(o.phone),
      propertiesCount: one('SELECT COUNT(*) c FROM properties WHERE owner_id = ?', o.id).c,
      verified: !!o.email_verified,
      subscription: (one('SELECT plan_name FROM subscriptions s JOIN properties p ON p.id = s.property_id WHERE p.owner_id = ? LIMIT 1', o.id) || {}).plan_name || 'Free',
      joinedDate: o.created_at,
      lastActive: o.last_login_at,
      status: o.status === 'active' ? 'Active' : o.status === 'suspended' ? 'Suspended' : 'Pending'
    })),

    subscriptions: subs.map((s) => ({
      id: 'SUB-' + String(s.property_id).slice(-6),
      propertyId: s.property_id,
      hotel: s.hotel_name,
      owner: s.owner_name || 'Unclaimed',
      plan: s.plan_name,
      amount: s.price,
      billingCycle: s.billing_cycle,
      lastChanged: s.updated_at,
      renewalDate: s.renewal_date,
      status: s.status,
      paymentStatus: (one("SELECT status FROM invoices WHERE property_id = ? ORDER BY issued_at DESC LIMIT 1", s.property_id) || {}).status || '—'
    })),

    leads: enquiryLeads.map((l) => ({
      id: l.id,
      leadName: l.guest_name,
      phoneMasked: mask(l.guest_phone),
      email: l.guest_email,
      hotel: l.property_name,
      city: l.city || l.property_city,
      owner: l.owner_name || '—',
      source: l.source || 'website',
      date: l.sent_at,
      status: l.status
    })),

    marketingLeads: marketingLeads.map((l) => ({
      id: l.id, name: l.name, email: l.email, phone: l.phone, hotel: l.hotel_name,
      city: l.city, plan: l.plan, message: l.message, source: l.source,
      status: l.status, date: l.created_at
    })),

    reviews: many('SELECT * FROM reviews ORDER BY created_at DESC LIMIT 200').map((r) => ({
      id: r.id, hotel: r.property_name, propertyId: r.property_id, reviewer: r.user_name,
      rating: r.rating, comment: r.comment, date: r.created_at, status: r.status,
      reported: false, ownerReply: r.owner_reply
    })),

    offers: many(
      `SELECT o.*, p.name AS hotel, u.name AS owner FROM offers o
         JOIN properties p ON p.id = o.property_id
         LEFT JOIN users u ON u.id = p.owner_id ORDER BY o.created_at DESC LIMIT 200`
    ).map((o) => ({
      id: o.id, title: o.title, hotel: o.hotel, owner: o.owner || '—',
      startDate: o.valid_from, endDate: o.valid_to, views: 0, clicks: 0, status: o.status
    })),

    campaigns: many(
      `SELECT c.*, p.name AS property_name, u.name AS owner_name FROM campaigns c
         LEFT JOIN properties p ON p.id = c.property_id
         LEFT JOIN users u ON u.id = c.owner_id ORDER BY c.created_at DESC LIMIT 200`
    ).map((c) => ({
      id: c.id, name: c.name, hotel: c.property_name, owner: c.owner_name,
      channel: c.channel, plan: c.plan, budget: c.budget, spend: c.spend,
      impressions: c.impressions, clicks: c.clicks, leads: c.leads_count,
      status: c.status, startDate: c.start_date, endDate: c.end_date
    })),

    activityLogs: many(
      `SELECT al.*, u.name AS admin_name, u.email AS admin_email
         FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
        ORDER BY al.created_at DESC LIMIT 200`
    ).map((a) => ({
      id: a.id, timestamp: a.created_at, admin: a.admin_name || a.admin_email || a.user_id || 'System',
      action: a.action, object: a.entity_id || '—', target: a.entity || '—',
      ip: a.ip || '—', result: 'Success', meta: json(a.meta, null)
    })),

    emailLog: many('SELECT * FROM email_log ORDER BY created_at DESC LIMIT 100').map((e) => ({
      id: e.id, to: e.to_addr, subject: e.subject, template: e.template,
      status: e.status, error: e.error, date: e.created_at,
      account: e.account, from: e.from_addr, kind: e.kind
    })),

    adminUsers: many("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at").map((u) => ({
      id: u.id, name: u.name, email: u.email, role: 'Admin',
      status: u.status === 'active' ? 'Active' : 'Suspended',
      lastActive: u.last_login_at, created: u.created_at
    })),

    notifications: buildNotifications(req.user.id),
    settings: readSettings()
  });
});

/** Attention feed: what an admin has to act on right now. */
function buildNotifications(userId) {
  const readIds = new Set(
    db.prepare('SELECT notification_id FROM notification_reads WHERE user_id = ?').all(userId)
      .map((r) => r.notification_id)
  );
  const out = [];
  many(`SELECT p.id, p.name, u.name AS claimant, p.updated_at FROM properties p
          JOIN users u ON u.id = p.owner_id
         WHERE p.claim_status = 'pending' ORDER BY p.updated_at DESC LIMIT 10`)
    .forEach((c) => out.push({
      id: 'claim-' + c.id, type: 'claim', read: false, time: c.updated_at,
      title: 'Claim awaiting approval',
      message: `${c.claimant} claims ${c.name}.`
    }));

  many("SELECT * FROM leads WHERE status = 'New' ORDER BY created_at DESC LIMIT 10")
    .forEach((l) => out.push({
      id: 'lead-' + l.id, type: 'lead', read: false, time: l.created_at,
      title: 'New marketing lead',
      message: `${l.name}${l.hotel_name ? ' — ' + l.hotel_name : ''}${l.plan ? ' (' + l.plan + ')' : ''}.`
    }));

  many("SELECT * FROM enquiries WHERE status = 'Sent' ORDER BY sent_at DESC LIMIT 10")
    .forEach((e) => out.push({
      id: 'enq-' + e.id, type: 'enquiry', read: false, time: e.sent_at,
      title: 'Enquiry not yet opened',
      message: `${e.guest_name} → ${e.property_name}.`
    }));

  many("SELECT * FROM email_log WHERE status = 'failed' ORDER BY created_at DESC LIMIT 5")
    .forEach((e) => out.push({
      id: 'mail-' + e.id, type: 'email', read: false, time: e.created_at,
      title: 'Email delivery failed',
      message: `${e.subject} → ${e.to_addr}.`
    }));

  out.forEach((n) => { n.read = readIds.has(n.id); });
  return out.sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, 25);
}

/* -------------------------------------------------------------- moderation */

router.post('/claims/:propertyId/:action',
  (req, res) => {
    const { propertyId, action } = req.params;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ ok: false, error: 'Unknown action.' });
    }
    const row = one('SELECT * FROM properties WHERE id = ?', propertyId);
    if (!row) return res.status(404).json({ ok: false, error: 'Property not found.' });

    // Grab the claimant before a reject clears owner_id off the property.
    const owner = row.owner_id ? one('SELECT * FROM users WHERE id = ?', row.owner_id) : null;

    const status = action === 'approve' ? 'verified' : 'rejected';
    db.prepare(`UPDATE properties SET claim_status = ?, owner_id = CASE WHEN ? = 'rejected' THEN NULL ELSE owner_id END,
                       updated_at = datetime('now') WHERE id = ?`).run(status, status, row.id);
    invalidateCatalog();

    if (owner && action === 'approve') {
      sendMailAsync(owner.email, 'claimApproved', { name: owner.name, hotelName: row.name });
    } else if (owner && action === 'reject') {
      sendMailAsync(owner.email, 'claimRejected', { name: owner.name, hotelName: row.name });
    }
    audit(req.user.id, 'admin.claim.' + action, 'property', row.id, null, req.ip);
    res.json({ ok: true, status });
  });

router.patch('/properties/:id',
  validate(z.object({
    active: z.coerce.boolean().optional(),
    claim_status: z.enum(['unclaimed', 'pending', 'verified', 'rejected']).optional(),
    plan: z.string().trim().optional(),
    ownerId: z.string().trim().optional()
  })),
  (req, res) => {
    const row = one('SELECT * FROM properties WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Property not found.' });
    const b = req.body;
    db.prepare(
      `UPDATE properties SET active = COALESCE(?, active), claim_status = COALESCE(?, claim_status),
              plan = COALESCE(?, plan), owner_id = COALESCE(?, owner_id), updated_at = datetime('now')
        WHERE id = ?`
    ).run(b.active === undefined ? null : (b.active ? 1 : 0), b.claim_status || null,
          b.plan || null, b.ownerId || null, row.id);
    invalidateCatalog();
    audit(req.user.id, 'admin.property.update', 'property', row.id, b, req.ip);
    res.json({ ok: true });
  });

router.patch('/users/:id',
  validate(z.object({ status: z.enum(['active', 'pending', 'suspended']), reason: z.string().trim().max(500).optional() })),
  (req, res) => {
    const row = one('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'User not found.' });
    if (row.id === req.user.id) return res.status(400).json({ ok: false, error: 'You cannot change your own status.' });
    db.prepare(`UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(req.body.status, row.id);
    audit(req.user.id, 'admin.user.status', 'user', row.id, req.body, req.ip);

    if (row.role === 'owner' && row.status !== req.body.status) {
      if (req.body.status === 'active' && row.status === 'suspended') {
        sendMailAsync(row.email, 'partnerAccountActivated', { name: row.name });
      } else if (req.body.status === 'suspended') {
        sendMailAsync(row.email, 'partnerAccountSuspended', { name: row.name, reason: req.body.reason });
      }
    }
    res.json({ ok: true });
  });

/* ------------------------------------------------------------- csv export */

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (columns, rows) => {
  const header = columns.map((c) => c.label).join(',');
  const lines = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(','));
  return [header, ...lines].join('\r\n');
};
const sendCsv = (res, req, columns, rows, name) => {
  audit(req.user.id, `admin.${name}.export`, name, null, { count: rows.length }, req.ip);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="hotelzz-${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + toCsv(columns, rows));
};

router.get('/owners/export', (req, res) => {
  const rows = many(
    `SELECT u.id, u.name, u.email, u.phone, u.city, u.status, u.email_verified, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM properties p WHERE p.owner_id = u.id) AS properties_count,
            (SELECT plan_name FROM subscriptions s JOIN properties p ON p.id = s.property_id WHERE p.owner_id = u.id LIMIT 1) AS plan
       FROM users u WHERE u.role = 'owner' ORDER BY u.created_at DESC`
  );
  sendCsv(res, req, [
    { key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' }, { key: 'city', label: 'City' }, { key: 'properties_count', label: 'Properties' },
    { key: 'plan', label: 'Plan' }, { key: 'status', label: 'Status' }, { key: 'email_verified', label: 'Verified' },
    { key: 'created_at', label: 'Joined At' }, { key: 'last_login_at', label: 'Last Active' }
  ], rows, 'owners');
});

router.get('/leads/export', (req, res) => {
  const rows = many(
    `SELECT e.id, e.guest_name, e.guest_phone, e.guest_email, e.property_name AS hotel_name,
            COALESCE(p.location, e.property_city) AS city, u.name AS owner_name, e.check_in, e.check_out, e.guests,
            e.message, e.source, e.status, e.sent_at
       FROM enquiries e LEFT JOIN properties p ON p.id = e.property_id
       LEFT JOIN users u ON u.id = e.owner_id
      ORDER BY e.sent_at DESC`
  );
  sendCsv(res, req, [
    { key: 'id', label: 'ID' }, { key: 'guest_name', label: 'Guest Name' }, { key: 'guest_phone', label: 'Phone' },
    { key: 'guest_email', label: 'Email' }, { key: 'hotel_name', label: 'Hotel' }, { key: 'city', label: 'City' },
    { key: 'owner_name', label: 'Owner' }, { key: 'check_in', label: 'Check In' }, { key: 'check_out', label: 'Check Out' },
    { key: 'guests', label: 'Guests' }, { key: 'message', label: 'Message' }, { key: 'source', label: 'Source' },
    { key: 'status', label: 'Status' }, { key: 'sent_at', label: 'Sent At' }
  ], rows, 'leads');
});

router.get('/reviews/export', (req, res) => {
  const rows = many(
    `SELECT r.id, r.property_name, r.user_name, r.rating, r.comment, r.status, r.owner_reply, r.created_at
       FROM reviews r ORDER BY r.created_at DESC`
  );
  sendCsv(res, req, [
    { key: 'id', label: 'ID' }, { key: 'property_name', label: 'Hotel' }, { key: 'user_name', label: 'Reviewer' },
    { key: 'rating', label: 'Rating' }, { key: 'comment', label: 'Comment' }, { key: 'status', label: 'Status' },
    { key: 'owner_reply', label: 'Owner Reply' }, { key: 'created_at', label: 'Date' }
  ], rows, 'reviews');
});

router.get('/properties/export', (req, res) => {
  const rows = many(
    `SELECT p.id, p.name, p.location, p.city_slug, p.address, p.phone, p.email, p.website,
            p.rating, p.property_type, p.plan, p.claim_status, p.active, p.status_label,
            u.name AS owner_name, u.email AS owner_email,
            (SELECT COUNT(*) FROM enquiries e WHERE e.property_id = p.id) AS lead_count,
            (SELECT COALESCE(SUM(views),0) FROM property_stats st WHERE st.property_id = p.id) AS views,
            p.created_at
       FROM properties p LEFT JOIN users u ON u.id = p.owner_id
      ORDER BY p.created_at DESC`
  );
  sendCsv(res, req, [
    { key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }, { key: 'location', label: 'Location' },
    { key: 'city_slug', label: 'City' }, { key: 'address', label: 'Address' }, { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' }, { key: 'website', label: 'Website' }, { key: 'rating', label: 'Rating' },
    { key: 'property_type', label: 'Type' }, { key: 'plan', label: 'Plan' }, { key: 'claim_status', label: 'Claim Status' },
    { key: 'active', label: 'Active' }, { key: 'status_label', label: 'Status Label' },
    { key: 'owner_name', label: 'Owner Name' }, { key: 'owner_email', label: 'Owner Email' },
    { key: 'lead_count', label: 'Leads' }, { key: 'views', label: 'Views' }, { key: 'created_at', label: 'Created At' }
  ], rows, 'properties');
});

/* ------------------------------------------------------------- csv import */

router.post('/import',
  validate(z.object({
    rows: z.array(z.record(z.any())).min(1, 'No rows to import').max(50000, 'Split files larger than 50,000 rows'),
    dryRun: z.coerce.boolean().optional(),
    filename: z.string().trim().max(200).optional()
  })),
  (req, res) => {
    const { slugify } = require('../lib/http');
    const rows = req.body.rows;
    const existing = new Set(many('SELECT id FROM properties').map((r) => r.id));

    // Cities the team has chosen to skip, configured in Platform Settings.
    const excluded = new Set(
      String(readSettings().excludedCities || '')
        .split(',').map((c) => slugify(c)).filter(Boolean)
    );

    const valid = [];
    const duplicates = [];
    const invalid = [];
    const skippedCities = [];
    rows.forEach((r) => {
      const id = String(r.id || slugify(r.name || '')).trim();
      if (!id || !r.name) { invalid.push(r); return; }
      if (existing.has(id)) { duplicates.push(Object.assign({ id }, r)); return; }
      const city = r.city_slug ? slugify(r.city_slug) : slugify(r.location);
      if (city && excluded.has(city)) { skippedCities.push(Object.assign({ id }, r)); return; }
      valid.push(Object.assign({}, r, { id }));
    });

    if (req.body.dryRun) {
      return res.json({
        ok: true, dryRun: true,
        summary: {
          total: rows.length, importable: valid.length, duplicates: duplicates.length,
          invalid: invalid.length, excludedCities: skippedCities.length
        },
        duplicates: duplicates.slice(0, 50)
      });
    }

    const insert = db.prepare(
      `INSERT INTO properties (id, name, location, city_slug, address, phone, website, rating, pincode,
                               image_url, property_type, google_cid, google_review_count, google_summary, gmb_link, active)
       VALUES (@id,@name,@location,@city_slug,@address,@phone,@website,@rating,@pincode,
               @image_url,@property_type,@google_cid,@google_review_count,@google_summary,@gmb_link,1)
       ON CONFLICT(id) DO NOTHING`
    );
    const run = db.transaction((list) => {
      list.forEach((h) => insert.run({
        id: h.id, name: h.name, location: h.location || null,
        city_slug: h.city_slug || slugify(h.location), address: h.address || null,
        phone: h.phone || null, website: h.website || null, rating: parseFloat(h.rating) || 4.5,
        pincode: h.pincode || null, image_url: h.image_url || null, property_type: h.property_type || null,
        google_cid: h.google_cid || null, google_review_count: parseInt(h.google_review_count, 10) || 0,
        google_summary: h.google_summary || null, gmb_link: h.gmb_link || null
      }));
    });
    run(valid);
    invalidateCatalog();

    audit(req.user.id, 'admin.import', 'properties', null,
          { total: rows.length, imported: valid.length, duplicates: duplicates.length, invalid: invalid.length,
            excludedCities: skippedCities.length, filename: req.body.filename || null }, req.ip);
    res.json({
      ok: true,
      summary: {
        total: rows.length, imported: valid.length, duplicates: duplicates.length,
        invalid: invalid.length, excludedCities: skippedCities.length
      },
      totalProperties: one('SELECT COUNT(*) c FROM properties').c
    });
  });

/* ------------------------------------------------------- user management */

/* ------------------------------------------------------------------- plans */

router.get('/plans', (_req, res) => {
  res.json({ ok: true, plans: loadPlans() });
});

router.patch('/plans/:id',
  validate(z.object({
    name: z.string().trim().min(2).optional(),
    price: z.coerce.number().min(0).optional(),
    period: z.string().trim().min(2).max(20).optional(),
    features: z.array(z.string().trim().min(1)).optional()
  })),
  (req, res) => {
    const row = one('SELECT * FROM plans WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Plan not found.' });
    const b = req.body;
    db.prepare(
      `UPDATE plans SET name = COALESCE(?, name), price = COALESCE(?, price),
              period = COALESCE(?, period), features = COALESCE(?, features),
              updated_at = datetime('now')
        WHERE id = ?`
    ).run(b.name || null, b.price != null ? b.price : null, b.period || null,
          b.features ? JSON.stringify(b.features) : null, req.params.id);

    audit(req.user.id, 'admin.plan.update', 'plan', req.params.id, b, req.ip);
    res.json({ ok: true, plans: loadPlans() });
  });

// Every user, any role — the bootstrap payload only ever surfaced owners
// (Hotel Owners) and admins (Admin Users); travelers had no admin view at
// all despite the account-status endpoint below already working for them.
router.get('/users',
  validateQuery(z.object({
    role: z.enum(['traveler', 'owner', 'admin']).optional(),
    status: z.enum(['active', 'pending', 'suspended']).optional(),
    q: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0)
  })),
  (req, res) => {
    const { role, status, q, limit, offset } = req.q;
    const where = [];
    const params = [];
    if (role) { where.push('role = ?'); params.push(role); }
    if (status) { where.push('status = ?'); params.push(status); }
    if (q) {
      where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
      const like = '%' + q + '%';
      params.push(like, like, like);
    }
    const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const rows = many('SELECT * FROM users' + clause + ' ORDER BY created_at DESC LIMIT ? OFFSET ?', ...params, limit, offset);
    const total = one('SELECT COUNT(*) c FROM users' + clause, ...params).c;

    res.json({
      ok: true,
      total,
      counts: {
        traveler: one("SELECT COUNT(*) c FROM users WHERE role = 'traveler'").c,
        owner: one("SELECT COUNT(*) c FROM users WHERE role = 'owner'").c,
        admin: one("SELECT COUNT(*) c FROM users WHERE role = 'admin'").c
      },
      users: rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        city: u.city,
        status: u.status,
        emailVerified: !!u.email_verified,
        properties: u.role === 'owner' ? one('SELECT COUNT(*) c FROM properties WHERE owner_id = ?', u.id).c : null,
        createdAt: u.created_at,
        lastActive: u.last_login_at
      }))
    });
  });

/* ---------------------------------------------------------------- emails */

router.get('/emails',
  validateQuery(z.object({
    status: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100)
  })),
  (req, res) => {
    const rows = req.q.status
      ? many('SELECT * FROM email_log WHERE status = ? ORDER BY created_at DESC LIMIT ?', req.q.status, req.q.limit)
      : many('SELECT * FROM email_log ORDER BY created_at DESC LIMIT ?', req.q.limit);
    res.json({ ok: true, emails: rows });
  });

/** One logged email's full stored HTML — for re-opening a past send in the preview pane. */
router.get('/emails/:id', (req, res) => {
  const row = one('SELECT * FROM email_log WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Email not found.' });
  res.json({ ok: true, email: row });
});

/* ---------------------------------------------------------- email templates */

// Every registered template, grouped for the panel's gallery. Static
// metadata + sample data only — no send, no DB touch.
router.get('/email-templates', (_req, res) => {
  res.json({ ok: true, templates: listTemplates(), accounts: Object.keys(require('../lib/env').SMTP_ACCOUNTS) });
});

// Whatever real data exists for this address (their account, property,
// latest enquiry/review/lead/invoice/campaign/payment) — lets the panel
// fill a template with the actual recipient's data instead of sample text.
router.get('/lookup',
  validateQuery(z.object({ email: z.string().trim().email() })),
  (req, res) => {
    const context = buildRealContext(req.q.email);
    res.json({ ok: true, found: Object.keys(context).length > 0, context });
  });

// Renders a template with sample data merged with any overrides — a pure
// preview, never sent or logged. Pass `to` to have real data for that
// address (if any account/record matches it) take priority over the sample.
router.post('/email-templates/:name/preview',
  validate(z.object({ data: z.record(z.any()).optional(), to: z.string().trim().email().optional() })),
  (req, res) => {
    try {
      const real = req.body.to ? buildRealContext(req.body.to) : {};
      const rendered = renderTemplate(req.params.name, Object.assign({}, real, req.body.data || {}));
      res.json({ ok: true, ...rendered });
    } catch (err) {
      res.status(404).json({ ok: false, error: err.message });
    }
  });

// Manual send: either a registered template (template + data) or a fully
// custom message (subject + html/text). Always goes through the real
// transport and is logged like any automated email, tagged kind: 'manual'.
router.post('/email-send',
  limiter(30, 60),
  validate(z.object({
    to: z.string().trim().email('Enter a valid recipient address'),
    template: z.string().trim().optional(),
    data: z.record(z.any()).optional(),
    account: z.enum(['info', 'support', 'admin']).optional(),
    subject: z.string().trim().max(200).optional(),
    html: z.string().max(200000).optional(),
    text: z.string().max(20000).optional()
  })),
  wrap(async (req, res) => {
    const b = req.body;
    let result;
    if (b.template) {
      // Real data for this recipient (if any account/record matches them)
      // fills the template first; whatever the admin explicitly typed wins.
      const real = buildRealContext(b.to);
      result = await sendMail(b.to, b.template, Object.assign({}, real, b.data || {}), {
        account: b.account, kind: 'manual', senderUserId: req.user.id
      });
    } else {
      if (!b.subject || (!b.html && !b.text)) {
        return res.status(400).json({ ok: false, error: 'Provide a template, or a subject with html/text.' });
      }
      result = await sendCustomMail(b.to, { subject: b.subject, html: b.html, text: b.text }, {
        account: b.account || 'admin', senderUserId: req.user.id
      });
    }
    audit(req.user.id, 'admin.email.send', 'email', result.id, { to: b.to, template: b.template || 'custom' }, req.ip);
    if (!result.ok) return res.status(502).json({ ok: false, error: result.error, id: result.id });
    res.json({ ok: true, id: result.id });
  }));

/* ---------------------------------------------------------------- settings */

const SETTING_KEYS = ['platformTitle', 'supportEmail', 'supportPhone', 'whatsappNumber',
                      'notifyEmail', 'defaultCurrency', 'excludedCities'];

const SETTING_DEFAULTS = {
  platformTitle: "Hotelzz.in — India's Hotel Marketplace",
  supportEmail: 'hello@hotelzz.in',
  supportPhone: '+91 99300 90487',
  whatsappNumber: '919930090487',
  notifyEmail: require('../lib/env').ADMIN_EMAIL,
  defaultCurrency: 'INR',
  excludedCities: ''
};

function readSettings() {
  const rows = many('SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return Object.assign({}, SETTING_DEFAULTS, stored);
}

router.get('/settings', (_req, res) => {
  res.json({ ok: true, settings: readSettings() });
});

router.put('/settings',
  validate(z.object({
    platformTitle: z.string().trim().max(120).optional(),
    supportEmail: z.string().trim().email().optional(),
    supportPhone: z.string().trim().max(30).optional(),
    whatsappNumber: z.string().trim().max(20).optional(),
    notifyEmail: z.string().trim().email().optional(),
    defaultCurrency: z.string().trim().max(6).optional(),
    excludedCities: z.string().trim().max(2000).optional()
  })),
  (req, res) => {
    const write = db.prepare(
      `INSERT INTO settings (key, value, updated_by) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updated_at = datetime('now'), updated_by = excluded.updated_by`
    );
    const applied = {};
    SETTING_KEYS.forEach((key) => {
      if (req.body[key] === undefined) return;
      write.run(key, String(req.body[key]), req.user.id);
      applied[key] = req.body[key];
    });
    if (!Object.keys(applied).length) return res.status(400).json({ ok: false, error: 'Nothing to save.' });

    audit(req.user.id, 'admin.settings.update', 'settings', null, applied, req.ip);
    res.json({ ok: true, settings: readSettings() });
  });

/* ------------------------------------------------------------ admin users */

router.post('/users',
  validate(z.object({
    name: z.string().trim().min(2, 'Enter a name'),
    email: z.string().trim().email('Enter a valid email address')
  })),
  wrap(async (req, res) => {
    const email = req.body.email.toLowerCase();
    if (one("SELECT 1 AS c FROM users WHERE lower(email) = ? AND role = 'admin'", email)) {
      return res.status(409).json({ ok: false, field: 'email', error: 'That admin already exists.' });
    }

    // Created without a password; the invite link is what sets one.
    const id = uid('adm');
    db.prepare("INSERT INTO users (id, role, name, email, status) VALUES (?, 'admin', ?, ?, 'active')")
      .run(id, req.body.name, email);

    const A2 = require('../lib/auth');
    const raw = A2.issueLinkToken({ userId: id, identifier: email, purpose: 'password-reset', ttlMinutes: 60 * 48 });
    const env2 = require('../lib/env');
    const link = `${env2.PUBLIC_URL}/reset-password.html?token=${raw}&email=${encodeURIComponent(email)}&role=admin`;
    sendMailAsync(email, 'passwordReset', { name: req.body.name, link });

    audit(req.user.id, 'admin.user.invite', 'user', id, { email }, req.ip);
    res.status(201).json({ ok: true, id, message: 'Invite sent — the link sets their password.' });
  }));

router.post('/users/:id/reset', wrap(async (req, res) => {
  const user = one('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

  const A2 = require('../lib/auth');
  const env2 = require('../lib/env');
  const raw = A2.issueLinkToken({ userId: user.id, identifier: user.email, purpose: 'password-reset', ttlMinutes: 60 });
  const link = `${env2.PUBLIC_URL}/reset-password.html?token=${raw}&email=${encodeURIComponent(user.email)}&role=${user.role}`;
  sendMailAsync(user.email, 'passwordReset', { name: user.name, link });
  audit(req.user.id, 'admin.user.reset', 'user', user.id, null, req.ip);
  res.json({ ok: true, message: 'Password reset link emailed.' });
}));

/* ------------------------------------------------------------ notifications */

router.post('/notifications/read',
  validate(z.object({ ids: z.array(z.string().trim().min(1)).min(1).max(200) })),
  (req, res) => {
    const write = db.prepare(
      'INSERT OR IGNORE INTO notification_reads (user_id, notification_id) VALUES (?,?)'
    );
    db.transaction((ids) => ids.forEach((id) => write.run(req.user.id, id)))(req.body.ids);
    res.json({ ok: true, read: req.body.ids.length });
  });

/* ------------------------------------------------------------ automation */

// Lets an admin fire the scheduled email jobs immediately (each job is still
// idempotent, so this cannot double-send anything already sent).
router.post('/automation/run', wrap(async (req, res) => {
  const automation = require('../lib/automation');
  const summary = await automation.runOnce();
  audit(req.user.id, 'admin.automation.run', 'automation', null, summary, req.ip);
  res.json({ ok: true, summary });
}));

module.exports = router;
