'use strict';
/**
 * Payments (Razorpay).
 *
 * When RAZORPAY_KEY_ID/SECRET are set, checkout runs for real. When they are
 * not, the same calls return a `manual` order: the platform records the amount
 * owed and the Hotelzz team invoices out of band, exactly as it did before.
 * Callers never branch on configuration — they read `order.mode`.
 */
const crypto = require('crypto');
const env = require('./env');
const { db, uid } = require('./db');

let client = null;
function getClient() {
  if (!env.paymentsConfigured) return null;
  if (!client) {
    const Razorpay = require('razorpay');
    client = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  }
  return client;
}

function record(row) {
  db.prepare(
    `INSERT INTO payments (id, user_id, property_id, purpose, reference_id, provider,
                           provider_order, amount, currency, status, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(row.id, row.userId || null, row.propertyId || null, row.purpose, row.referenceId || null,
        row.provider, row.providerOrder || null, row.amount, row.currency, row.status,
        row.notes ? JSON.stringify(row.notes) : null);
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(row.id);
}

/**
 * Creates an order for `amount` rupees. Returns what the browser needs to open
 * checkout, or `{ mode: 'manual' }` when no gateway is configured.
 */
async function createOrder({ userId, propertyId, purpose, referenceId, amount, notes }) {
  const id = uid('pay');
  const rzp = getClient();

  if (!rzp) {
    const row = record({
      id, userId, propertyId, purpose, referenceId, provider: 'manual',
      amount, currency: env.CURRENCY, status: 'manual', notes
    });
    return {
      mode: 'manual',
      paymentId: row.id,
      amount,
      currency: env.CURRENCY,
      message: 'Recorded. Our team will send you a payment link and activate this on confirmation.'
    };
  }

  // Razorpay works in the smallest currency unit.
  let order;
  try {
    order = await rzp.orders.create({
      amount: Math.round(amount * 100),
      currency: env.CURRENCY,
      receipt: id,
      notes: Object.assign({ purpose, referenceId: referenceId || '' }, notes || {})
    });
  } catch (err) {
    // The Razorpay SDK throws a plain { statusCode, error: { description } }
    // object, not a real Error — it has no .message, so the app's generic
    // error handler (which reads err.message) rendered a bare {"ok":false}
    // with no indication anything was even wrong, let alone what. Re-throw
    // a real Error carrying Razorpay's own description so it's actually
    // visible to whoever's debugging a failed checkout.
    const desc = (err && err.error && err.error.description) || (err && err.message) || 'Razorpay request failed.';
    const wrapped = new Error(desc);
    wrapped.status = (err && err.statusCode) || 502;
    throw wrapped;
  }

  const row = record({
    id, userId, propertyId, purpose, referenceId, provider: 'razorpay',
    providerOrder: order.id, amount, currency: env.CURRENCY, status: 'created', notes
  });

  return {
    mode: 'razorpay',
    paymentId: row.id,
    keyId: env.RAZORPAY_KEY_ID,
    orderId: order.id,
    amount,
    amountMinor: order.amount,
    currency: order.currency
  };
}

/** Verifies the signature the checkout widget hands back to the browser. */
function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!env.paymentsConfigured) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(orderId + '|' + paymentId)
    .digest('hex');
  return safeEqual(expected, signature);
}

/** Verifies a webhook body against the webhook secret. */
function verifyWebhookSignature(rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return safeEqual(expected, signature);
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b || ''));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/** Marks a payment paid and stamps its invoice. Idempotent. */
function markPaid(payment, providerPaymentId) {
  if (payment.status === 'paid') return payment;

  db.prepare(
    `UPDATE payments SET status = 'paid', provider_payment = ?, updated_at = datetime('now')
      WHERE id = ?`
  ).run(providerPaymentId || null, payment.id);

  if (payment.property_id) {
    const invoice = db.prepare(
      'SELECT * FROM invoices WHERE property_id = ? AND status = ? ORDER BY issued_at DESC LIMIT 1'
    ).get(payment.property_id, 'Pending');
    if (invoice) {
      db.prepare("UPDATE invoices SET status = 'Paid' WHERE id = ?").run(invoice.id);
      db.prepare('UPDATE payments SET invoice_id = ? WHERE id = ?').run(invoice.id, payment.id);
    }
  }
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id);
}

function findByOrder(orderId) {
  return db.prepare('SELECT * FROM payments WHERE provider_order = ?').get(orderId);
}

module.exports = {
  createOrder, verifyCheckoutSignature, verifyWebhookSignature,
  markPaid, findByOrder, isConfigured: () => env.paymentsConfigured
};
