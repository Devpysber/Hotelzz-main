'use strict';
/**
 * Promotional email: the public unsubscribe page (no login — the signed link
 * is the proof) and the admin controls in Email Center → Promotions.
 */
const express = require('express');
const { z } = require('zod');
const { audit } = require('../lib/db');
const A = require('../lib/auth');
const { validate, wrap, limiter } = require('../lib/http');
const optout = require('../lib/optout');
const promotions = require('../lib/promotions');

/* --------------------------------------------------- public unsubscribe */

const pub = express.Router();

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · Hotelzz.in</title>
<style>body{margin:0;background:#F8FAFC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0F172A;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border:1px solid #E2E8F0;border-radius:16px;padding:32px 28px;max-width:440px;width:100%;box-shadow:0 10px 30px rgba(15,23,42,.06)}
.brand{font-weight:800;font-size:20px;color:#2563EB;margin-bottom:18px}.brand span{color:#0F172A}h1{font-size:20px;margin:0 0 10px}
p{color:#475569;line-height:1.6;font-size:15px}button,a.btn{display:inline-block;border:0;border-radius:10px;padding:12px 20px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none}
.primary{background:#2563EB;color:#fff}.ghost{background:#fff;color:#334155;border:1px solid #CBD5E1!important}form{margin:18px 0 0;display:flex;gap:10px;flex-wrap:wrap}</style></head>
<body><div class="card"><div class="brand">Hotelzz<span>.in</span></div>${body}</div></body></html>`;
}

pub.get('/unsubscribe', (req, res) => {
  const email = optout.norm(req.query.e);
  const t = String(req.query.t || '');
  res.set('X-Robots-Tag', 'noindex');
  if (!email || !optout.verify(email, t)) {
    return res.status(400).type('html').send(page('Link not valid', '<h1>This link is not valid</h1><p>Use the unsubscribe link from the bottom of one of our emails, or reply to the email and we will remove you.</p>'));
  }
  const out = optout.isOptedOut(email);
  res.type('html').send(page(out ? 'Unsubscribed' : 'Unsubscribe',
    out ? `<h1>You're unsubscribed</h1><p><b>${esc(email)}</b> won't get tips or offers from Hotelzz. Booking and account emails (codes, enquiry replies, receipts) still arrive.</p>
           <form method="post" action="/unsubscribe/resubscribe?e=${encodeURIComponent(email)}&t=${t}"><button class="ghost" type="submit">Subscribe me again</button><a class="btn primary" href="/">Go to Hotelzz</a></form>`
        : `<h1>Stop promotional emails?</h1><p>We'll stop sending tips and offers to <b>${esc(email)}</b>. Booking and account emails still arrive.</p>
           <form method="post" action="/unsubscribe?e=${encodeURIComponent(email)}&t=${t}"><button class="primary" type="submit">Unsubscribe</button><a class="btn ghost" href="/">Keep them</a></form>`));
});

// One-click (RFC 8058): mail apps POST here straight from the inbox.
pub.post('/unsubscribe', limiter(30, 15), express.urlencoded({ extended: false }), (req, res) => {
  const email = optout.norm(req.query.e);
  if (!email || !optout.verify(email, req.query.t)) return res.status(400).type('text').send('Invalid link');
  optout.optOut(email, 'link');
  audit(null, 'email.unsubscribe', 'email', email, null, req.ip);
  if (/html/.test(req.get('accept') || '')) return res.redirect(303, `/unsubscribe?e=${encodeURIComponent(email)}&t=${req.query.t}`);
  res.type('text').send('Unsubscribed');
});

pub.post('/unsubscribe/resubscribe', limiter(30, 15), (req, res) => {
  const email = optout.norm(req.query.e);
  if (!email || !optout.verify(email, req.query.t)) return res.status(400).type('text').send('Invalid link');
  optout.optIn(email);
  audit(null, 'email.resubscribe', 'email', email, null, req.ip);
  res.redirect(303, `/unsubscribe?e=${encodeURIComponent(email)}&t=${req.query.t}`);
});

/* ------------------------------------------------------------- admin */

const admin = express.Router();
admin.use(A.requireAuth('admin'));

admin.get('/', (_req, res) => {
  res.json({ ok: true, status: promotions.status(), optouts: optout.list(30) });
});

admin.put('/', validate(z.object({
  enabled: require('../lib/http').bool.optional(),
  minGapDays: z.coerce.number().int().min(2, 'At least 2 days between promotional emails').max(60).optional(),
  maxPerSweep: z.coerce.number().int().min(1).max(2000).optional(),
  outreachGapDays: z.coerce.number().int().min(7).max(180).optional(),
  outreachMax: z.coerce.number().int().min(0).max(10).optional(),
  runsPerDay: z.coerce.number().int().min(1).max(4).optional(),
  templates: z.record(z.string(), require('../lib/http').bool).optional()
})), (req, res) => {
  const b = req.body;
  if (b.templates) Object.keys(b.templates).forEach((k) => { if (!promotions.TEMPLATES.includes(k)) delete b.templates[k]; });
  const config = promotions.saveConfig(b, req.user.id);
  audit(req.user.id, 'admin.promotions.update', 'settings', 'promotions', b, req.ip);
  res.json({ ok: true, config, status: promotions.status() });
});

// Preview (dryRun) or send a run now.
admin.post('/run', validate(z.object({ dryRun: require('../lib/http').bool.optional() })), wrap(async (req, res) => {
  const result = await promotions.sweep({ dryRun: req.body.dryRun !== false, trigger: 'manual' });
  if (!req.body.dryRun) audit(req.user.id, 'admin.promotions.run', 'settings', 'promotions', { sent: result.sent }, req.ip);
  res.status(result.ok ? 200 : 409).json(Object.assign({ status: promotions.status() }, result));
}));

admin.post('/optouts', validate(z.object({ email: z.string().trim().email(), action: z.enum(['add', 'remove']) })), (req, res) => {
  if (req.body.action === 'add') optout.optOut(req.body.email, 'admin'); else optout.optIn(req.body.email);
  audit(req.user.id, 'admin.optout.' + req.body.action, 'email', req.body.email, null, req.ip);
  res.json({ ok: true, optouts: optout.list(30), count: optout.count() });
});

module.exports = { pub, admin };
