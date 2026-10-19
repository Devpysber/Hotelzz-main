'use strict';
/**
 * Promotional email opt-outs.
 *
 * Every promotional message carries a signed unsubscribe link and the
 * List-Unsubscribe headers Gmail/Yahoo require for bulk senders. The token is
 * an HMAC of the address, so a link works without a login and can't be forged
 * for someone else's address. Transactional mail (OTP, enquiries, receipts)
 * is never suppressed — only kind 'marketing'.
 */
const crypto = require('crypto');
const env = require('./env');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS email_optouts (
  email      TEXT PRIMARY KEY,
  source     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const norm = (email) => String(email || '').trim().toLowerCase();

function token(email) {
  return crypto.createHmac('sha256', 'unsubscribe:' + env.JWT_SECRET).update(norm(email)).digest('hex').slice(0, 32);
}

function verify(email, t) {
  const a = Buffer.from(token(email));
  const b = Buffer.from(String(t || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function url(email) {
  return `${env.PUBLIC_URL}/unsubscribe?e=${encodeURIComponent(norm(email))}&t=${token(email)}`;
}

const isOptedOut = (email) => !!db.prepare('SELECT 1 FROM email_optouts WHERE email = ?').get(norm(email));

function optOut(email, source) {
  db.prepare('INSERT OR IGNORE INTO email_optouts (email, source) VALUES (?, ?)').run(norm(email), source || 'link');
}

function optIn(email) {
  db.prepare('DELETE FROM email_optouts WHERE email = ?').run(norm(email));
}

function list(limit) {
  return db.prepare('SELECT email, source, created_at FROM email_optouts ORDER BY created_at DESC LIMIT ?').all(limit || 50);
}

const count = () => db.prepare('SELECT COUNT(*) c FROM email_optouts').get().c;

module.exports = { token, verify, url, isOptedOut, optOut, optIn, list, count, norm };
