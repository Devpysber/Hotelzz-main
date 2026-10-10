'use strict';
const express = require('express');
const { z } = require('zod');
const env = require('../lib/env');
const { db, audit } = require('../lib/db');
const A = require('../lib/auth');
const { limiter, validate, wrap } = require('../lib/http');
const pay = require('../lib/payments');
const { sendMailAsync } = require('../lib/mailer');
const ads = require('../lib/ads');

const router = express.Router();
const PUBLIC_PLANS = require('../lib/public-plans.json');

const shape = (p) => {
  let notes = {};
  try { notes = JSON.parse(p.notes || '{}') || {}; } catch (_) { /* legacy row */ }
  return {
    id: p.id, purpose: p.purpose, referenceId: p.reference_id, propertyId: p.property_id,
    amount: p.amount, currency: p.currency, status: p.status, provider: p.provider,
    orderId: p.provider_order, invoiceId: p.invoice_id, createdAt: p.created_at,
    planName: notes.planName || null, buyerName: notes.buyerName || null,
    buyerEmail: notes.buyerEmail || null, buyerPhone: notes.buyerPhone || null
  };
};

router.get('/config', (_req, res) => {
  res.json({
    ok: true,
    provider: pay.isConfigured() ? 'razorpay' : 'manual',
    keyId: pay.isConfigured() ? env.RAZORPAY_KEY_ID : null,
    currency: env.CURRENCY
  });
});

/* ------------------------------------------------- public plan purchases */

// Fixed-price plans anyone can buy from the public pages (ota-listing.html),
// signed in or not. The buyer's contact details ride on the payment's notes.
router.get('/plans', (_req, res) => {
  res.json({ ok: true, plans: PUBLIC_PLANS, currency: env.CURRENCY });
});

router.post('/plan-orders',
  limiter(15, 60),
  validate(z.object({
    planId: z.string().trim().min(1, 'Choose a plan'),
    name: z.string().trim().min(2, 'Enter your name').max(120),
    email: z.string().trim().email('Enter a valid email address').max(200),
    phone: z.string().trim().min(8, 'Enter your phone number').max(20),
    hotelName: z.string().trim().max(200).optional(),
    city: z.string().trim().max(120).optional()
  })),
  wrap(async (req, res) => {
    const plan = PUBLIC_PLANS.find((p) => p.id === req.body.planId);
    if (!plan) return res.status(404).json({ ok: false, error: 'That plan is not available.' });
    const b = req.body;
    const buyer = { buyerName: b.name, buyerEmail: b.email.toLowerCase(), buyerPhone: b.phone,
                    hotelName: b.hotelName || '', city: b.city || '', planName: plan.name };

    const order = await pay.createOrder({
      userId: req.user ? req.user.id : null, propertyId: null, purpose: 'plan',
      referenceId: plan.id, amount: plan.price, notes: buyer
    });
    audit(req.user ? req.user.id : null, 'payment.plan.order', 'payment', order.paymentId,
          { plan: plan.id, amount: plan.price, email: buyer.buyerEmail }, req.ip);

    // No gateway configured: the order is recorded for manual invoicing, so
    // tell the buyer and the sales inbox now rather than waiting for payment.
    if (order.mode === 'manual') {
      notifyPurchase(db.prepare('SELECT * FROM payments WHERE id = ?').get(order.paymentId), 'Awaiting payment');
    }
    res.status(201).json({ ok: true, order: Object.assign(order, {
      planName: plan.name, prefill: { name: b.name, email: buyer.buyerEmail, contact: b.phone }
    }) });
  }));

/** Public counterpart of /verify for plan purchases — the signature is the proof. */
router.post('/plan-verify',
  limiter(30, 60),
  validate(z.object({
    orderId: z.string().trim().min(4),
    paymentId: z.string().trim().min(4),
    signature: z.string().trim().min(10)
  })),
  wrap(async (req, res) => {
    const { orderId, paymentId, signature } = req.body;
    if (!pay.verifyCheckoutSignature({ orderId, paymentId, signature })) {
      audit(null, 'payment.verify.failed', 'payment', orderId, null, req.ip);
      return res.status(400).json({ ok: false, error: 'Payment signature did not verify.' });
    }
    const row = pay.findByOrder(orderId);
    if (!row || row.purpose !== 'plan') return res.status(404).json({ ok: false, error: 'Order not found.' });

    const wasPaid = row.status === 'paid';
    const updated = pay.markPaid(row, paymentId);
    if (!wasPaid) await activate(updated, req.ip);
    res.json({ ok: true, payment: shape(updated),
               message: 'Payment received. A confirmation is on its way to ' + (notesOf(updated).buyerEmail || 'your email') + '.' });
  }));

/* ------------------------------------------------------------------ orders */

router.post('/orders',
  A.requireAuth('owner', 'admin'),
  limiter(20, 60),
  validate(z.object({
    purpose: z.enum(['subscription', 'campaign']),
    referenceId: z.string().trim().min(1, 'Missing reference'),
    propertyId: z.string().trim().min(1, 'Missing property')
  })),
  wrap(async (req, res) => {
    const { purpose, referenceId, propertyId } = req.body;
    const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
    if (!property) return res.status(404).json({ ok: false, error: 'Property not found.' });
    if (req.user.role === 'owner' && property.owner_id !== req.user.id) {
      return res.status(403).json({ ok: false, error: 'Not your property.' });
    }

    // The amount always comes from the server's own records, never the client.
    let amount = 0;
    if (purpose === 'campaign') {
      const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(referenceId);
      if (!camp) return res.status(404).json({ ok: false, error: 'Campaign not found.' });
      if (req.user.role === 'owner' && camp.owner_id !== req.user.id) {
        return res.status(403).json({ ok: false, error: 'Not your campaign.' });
      }
      const details = JSON.parse(camp.details || '{}');
      amount = details.total || camp.budget;
    } else {
      const invoice = db.prepare(
        "SELECT * FROM invoices WHERE property_id = ? AND status = 'Pending' ORDER BY issued_at DESC LIMIT 1"
      ).get(propertyId);
      if (!invoice) return res.status(404).json({ ok: false, error: 'No pending invoice for this property.' });
      amount = parseFloat(String(invoice.amount).replace(/[^\d.]/g, '')) || 0;
    }
    if (amount <= 0) return res.status(400).json({ ok: false, error: 'Nothing to pay for.' });

    const order = await pay.createOrder({
      userId: req.user.id, propertyId, purpose, referenceId, amount,
      notes: { hotel: property.name }
    });
    audit(req.user.id, 'payment.order', 'payment', order.paymentId, { purpose, amount }, req.ip);
    if (order.mode === 'manual') {
      notifyPurchase(db.prepare('SELECT * FROM payments WHERE id = ?').get(order.paymentId), 'Awaiting payment');
    }
    res.status(201).json({ ok: true, order });
  }));

/** Called by the browser right after Razorpay checkout succeeds. */
router.post('/verify',
  A.requireAuth('owner', 'admin'),
  validate(z.object({
    orderId: z.string().trim().min(4),
    paymentId: z.string().trim().min(4),
    signature: z.string().trim().min(10)
  })),
  wrap(async (req, res) => {
    const { orderId, paymentId, signature } = req.body;
    if (!pay.verifyCheckoutSignature({ orderId, paymentId, signature })) {
      audit(req.user.id, 'payment.verify.failed', 'payment', orderId, null, req.ip);
      return res.status(400).json({ ok: false, error: 'Payment signature did not verify.' });
    }
    const row = pay.findByOrder(orderId);
    if (!row) return res.status(404).json({ ok: false, error: 'Order not found.' });

    const wasPaid = row.status === 'paid';
    const updated = pay.markPaid(row, paymentId);
    if (!wasPaid) await activate(updated, req.ip);
    res.json({ ok: true, payment: shape(updated) });
  }));

/**
 * Server-to-server confirmation. Mounted with a raw body parser in index.js so
 * the signature is checked against the exact bytes Razorpay signed.
 */
router.post('/webhook', wrap(async (req, res) => {
  const signature = req.get('x-razorpay-signature');
  const raw = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body || {});
  if (!pay.verifyWebhookSignature(raw, signature)) {
    return res.status(400).json({ ok: false, error: 'Invalid signature' });
  }

  const event = JSON.parse(raw);
  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    const entity = (event.payload.payment && event.payload.payment.entity) || {};
    const row = pay.findByOrder(entity.order_id);
    // The browser's /verify usually lands first; only the first confirmation
    // activates, so nobody gets two receipts.
    if (row && row.status !== 'paid') {
      const updated = pay.markPaid(row, entity.id);
      await activate(updated, req.ip);
    }
  }
  res.json({ ok: true });
}));

/** Turns a paid order into the thing the customer bought. */
async function activate(payment, ip) {
  if (payment.purpose === 'subscription') {
    db.prepare("UPDATE subscriptions SET status = 'Active', updated_at = datetime('now') WHERE property_id = ?")
      .run(payment.property_id);
  }

  if (payment.purpose === 'campaign') {
    const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(payment.reference_id);
    if (camp) {
      const details = Object.assign(JSON.parse(camp.details || '{}'), { paymentStatus: 'Payment received' });
      db.prepare("UPDATE campaigns SET details = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(details), camp.id);
      // Hands off to the ad platforms when they are configured; otherwise the
      // campaign simply waits in Pending for the marketing team.
      await ads.launch(camp.id).catch((err) => console.error('[ads] launch failed:', err.message));
    }
  }

  notifyPurchase(payment, 'Paid');

  const user = payment.user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(payment.user_id) : null;
  if (user && payment.purpose !== 'plan') {
    sendMailAsync(user.email, 'paymentReceipt', {
      name: user.name,
      amount: payment.amount,
      currency: payment.currency,
      purpose: payment.purpose === 'campaign' ? 'campaign' : 'subscription',
      reference: payment.reference_id || payment.id
    });
  }
  audit(payment.user_id, 'payment.paid', 'payment', payment.id, { amount: payment.amount }, ip);
}

function notesOf(payment) {
  try { return JSON.parse(payment.notes || '{}') || {}; } catch (_) { return {}; }
}

/**
 * Purchase confirmation: one email to whoever bought, and an ops copy to every
 * address in PURCHASE_NOTIFY_EMAILS (antriksh@psyber.co by default).
 */
function notifyPurchase(payment, status) {
  const notes = notesOf(payment);
  const user = payment.user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(payment.user_id) : null;
  const property = payment.property_id ? db.prepare('SELECT * FROM properties WHERE id = ?').get(payment.property_id) : null;

  let planName = notes.planName;
  if (!planName && payment.purpose === 'subscription' && payment.property_id) {
    const sub = db.prepare('SELECT plan_name FROM subscriptions WHERE property_id = ?').get(payment.property_id);
    planName = sub ? sub.plan_name : 'Listing subscription';
  }
  if (!planName && payment.purpose === 'campaign') {
    const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(payment.reference_id);
    const details = camp ? JSON.parse(camp.details || '{}') : {};
    planName = 'Marketing campaign — ' + ((camp && (camp.plan || details.packageName || camp.name)) || payment.reference_id);
  }

  const buyerEmail = notes.buyerEmail || (user && user.email);
  const data = {
    name: notes.buyerName || (user && user.name) || 'there',
    email: buyerEmail || '',
    phone: notes.buyerPhone || (user && user.phone) || '',
    planName: planName || 'Hotelzz plan',
    amount: payment.amount,
    currency: payment.currency,
    orderId: payment.id,
    paymentRef: payment.provider_payment || '',
    status,
    hotelName: notes.hotelName || (property && property.name) || notes.hotel || '',
    city: notes.city || (property && property.location) || ''
  };

  if (buyerEmail) sendMailAsync(buyerEmail, 'purchaseConfirmation', data);
  env.PURCHASE_NOTIFY_EMAILS
    .filter((to) => !buyerEmail || to.toLowerCase() !== buyerEmail.toLowerCase())
    .forEach((to) => sendMailAsync(to, 'adminPlanPurchase', data));
}

/* -------------------------------------------------------------- read/admin */

router.get('/mine', A.requireAuth(), (req, res) => {
  const rows = db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(req.user.id);
  res.json({ ok: true, payments: rows.map(shape) });
});

router.get('/', A.requireAuth('admin'), (_req, res) => {
  const rows = db.prepare(
    `SELECT p.*, pr.name AS hotel_name FROM payments p
       LEFT JOIN properties pr ON pr.id = p.property_id
      ORDER BY p.created_at DESC LIMIT 300`
  ).all();
  const paid = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amount, 0);
  res.json({ ok: true, totalPaid: paid, payments: rows.map((r) => Object.assign(shape(r), { hotelName: r.hotel_name || null })) });
});

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

router.get('/export', A.requireAuth('admin'), (req, res) => {
  const rows = db.prepare(
    `SELECT p.id, p.purpose, p.reference_id, pr.name AS hotel_name, u.name AS user_name, u.email AS user_email,
            p.amount, p.currency, p.provider, p.status, p.invoice_id, p.notes, p.created_at
       FROM payments p LEFT JOIN properties pr ON pr.id = p.property_id
       LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC`
  ).all();

  const columns = [
    { key: 'id', label: 'ID' }, { key: 'purpose', label: 'Purpose' }, { key: 'reference_id', label: 'Reference' },
    { key: 'hotel_name', label: 'Hotel' }, { key: 'user_name', label: 'Customer' }, { key: 'user_email', label: 'Email' },
    { key: 'amount', label: 'Amount' }, { key: 'currency', label: 'Currency' }, { key: 'provider', label: 'Provider' },
    { key: 'status', label: 'Status' }, { key: 'invoice_id', label: 'Invoice' }, { key: 'notes', label: 'Notes' },
    { key: 'created_at', label: 'Created At' }
  ];
  const csv = [columns.map((c) => c.label).join(',')]
    .concat(rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(',')))
    .join('\r\n');

  audit(req.user.id, 'admin.payments.export', 'payment', null, { count: rows.length }, req.ip);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="hotelzz-payments-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + csv);
});

/** Manual settlement for bank transfers and cash. */
router.post('/:id/mark-paid', A.requireAuth('admin'), wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Payment not found.' });
  if (row.status === 'paid') return res.json({ ok: true, payment: shape(row) });
  const updated = pay.markPaid(row, 'manual-' + req.user.id);
  await activate(updated, req.ip);
  audit(req.user.id, 'payment.manual', 'payment', row.id, null, req.ip);
  res.json({ ok: true, payment: shape(updated) });
}));

module.exports = router;
