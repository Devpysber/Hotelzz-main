'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const env = require('./env');

const dbPath = path.resolve(process.cwd(), env.DB_PATH);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  role           TEXT NOT NULL CHECK (role IN ('traveler','owner','admin')),
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  phone          TEXT,
  password_hash  TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','suspended')),
  city           TEXT,
  avatar         TEXT,
  last_login_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_role ON users(lower(email), role);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

CREATE TABLE IF NOT EXISTS tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  identifier  TEXT,
  purpose     TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  meta        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tokens_lookup ON tokens(purpose, identifier, consumed_at);

CREATE TABLE IF NOT EXISTS email_log (
  id         TEXT PRIMARY KEY,
  to_addr    TEXT NOT NULL,
  subject    TEXT NOT NULL,
  template   TEXT,
  status     TEXT NOT NULL,
  error      TEXT,
  preview    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  meta       TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS properties (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  location       TEXT,
  city_slug      TEXT,
  address        TEXT,
  phone          TEXT,
  email          TEXT,
  website        TEXT,
  rating         REAL DEFAULT 4.5,
  pincode        TEXT,
  image_url      TEXT,
  property_type  TEXT,
  google_cid     TEXT,
  google_review_count INTEGER DEFAULT 0,
  google_summary TEXT,
  gmb_link       TEXT,
  plan           TEXT DEFAULT 'free',
  claim_status   TEXT NOT NULL DEFAULT 'unclaimed' CHECK (claim_status IN ('unclaimed','pending','verified','rejected')),
  active         INTEGER NOT NULL DEFAULT 1,
  details        TEXT,
  amenities      TEXT,
  status_label   TEXT NOT NULL DEFAULT 'Published',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_properties_city ON properties(city_slug);
CREATE TABLE IF NOT EXISTS enquiries (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  property_id   TEXT,
  property_name TEXT NOT NULL,
  property_city TEXT,
  owner_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  guest_name    TEXT NOT NULL,
  guest_email   TEXT NOT NULL,
  guest_phone   TEXT,
  check_in      TEXT,
  check_out     TEXT,
  guests        INTEGER DEFAULT 2,
  message       TEXT,
  source        TEXT DEFAULT 'website',
  status        TEXT NOT NULL DEFAULT 'Sent'
                CHECK (status IN ('Sent','Opened','Responded','Contacted','Converted','Closed','Spam')),
  hotel_response TEXT,
  sent_at       TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at  TEXT,
  opened_at     TEXT,
  responded_at  TEXT,
  closed_at     TEXT,
  review_id     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_enq_user ON enquiries(user_id);
CREATE INDEX IF NOT EXISTS idx_enq_prop ON enquiries(property_id);
CREATE INDEX IF NOT EXISTS idx_enq_owner ON enquiries(owner_id);
CREATE INDEX IF NOT EXISTS idx_enq_status ON enquiries(status);

CREATE TABLE IF NOT EXISTS enquiry_events (
  id          TEXT PRIMARY KEY,
  enquiry_id  TEXT NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_enqev ON enquiry_events(enquiry_id);

CREATE TABLE IF NOT EXISTS reviews (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_name     TEXT NOT NULL,
  property_id   TEXT,
  property_name TEXT NOT NULL,
  enquiry_id    TEXT REFERENCES enquiries(id) ON DELETE SET NULL,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  cleanliness   INTEGER, service INTEGER, location INTEGER, amenities INTEGER, value INTEGER,
  owner_reply   TEXT,
  status        TEXT NOT NULL DEFAULT 'Published'
                CHECK (status IN ('Pending','Published','Rejected')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rev_prop ON reviews(property_id);
CREATE INDEX IF NOT EXISTS idx_rev_user ON reviews(user_id);

CREATE TABLE IF NOT EXISTS saved_hotels (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, property_id)
);

CREATE TABLE IF NOT EXISTS leads (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL DEFAULT 'marketing',
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  hotel_name  TEXT,
  city        TEXT,
  plan        TEXT,
  message     TEXT,
  property_id TEXT,
  source      TEXT,
  status      TEXT NOT NULL DEFAULT 'New'
              CHECK (status IN ('New','Contacted','Qualified','Won','Lost')),
  owner_notes TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

CREATE TABLE IF NOT EXISTS campaigns (
  id          TEXT PRIMARY KEY,
  property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
  owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'google',
  plan        TEXT,
  budget      REAL DEFAULT 0,
  spend       REAL DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks      INTEGER DEFAULT 0,
  leads_count INTEGER DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'Draft'
              CHECK (status IN ('Draft','Pending','Active','Paused','Completed')),
  start_date  TEXT, end_date TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_camp_owner ON campaigns(owner_id);
CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT,
  price       REAL DEFAULT 0,
  capacity    INTEGER DEFAULT 2,
  count       INTEGER DEFAULT 1,
  size        TEXT,
  beds        TEXT,
  amenities   TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rooms_prop ON rooms(property_id);

CREATE TABLE IF NOT EXISTS photos (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  category    TEXT DEFAULT 'General',
  caption     TEXT,
  is_cover    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_prop ON photos(property_id);

CREATE TABLE IF NOT EXISTS offers (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  discount    TEXT,
  code        TEXT,
  valid_from  TEXT,
  valid_to    TEXT,
  status      TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Scheduled','Expired','Paused')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_offers_prop ON offers(property_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  property_id   TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  plan_name     TEXT NOT NULL DEFAULT 'Free Listing',
  price         TEXT DEFAULT '₹0',
  billing_cycle TEXT DEFAULT 'Monthly',
  status        TEXT NOT NULL DEFAULT 'Active',
  renewal_date  TEXT,
  features      TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  number      TEXT NOT NULL,
  amount      TEXT NOT NULL,
  plan        TEXT,
  status      TEXT NOT NULL DEFAULT 'Paid',
  issued_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_prop ON invoices(property_id);

CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  property_id    TEXT REFERENCES properties(id) ON DELETE SET NULL,
  purpose        TEXT NOT NULL,
  reference_id   TEXT,
  provider       TEXT NOT NULL DEFAULT 'razorpay',
  provider_order TEXT,
  provider_payment TEXT,
  amount         REAL NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'INR',
  status         TEXT NOT NULL DEFAULT 'created'
                 CHECK (status IN ('created','paid','failed','refunded','manual')),
  invoice_id     TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(provider_order);

CREATE TABLE IF NOT EXISTS automation_log (
  id         TEXT PRIMARY KEY,
  job        TEXT NOT NULL,
  entity_id  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_once ON automation_log(job, entity_id);
CREATE INDEX IF NOT EXISTS idx_automation_job ON automation_log(job, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  price      REAL NOT NULL DEFAULT 0,
  period     TEXT NOT NULL DEFAULT 'month',
  features   TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_reads (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL,
  read_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, notification_id)
);

CREATE TABLE IF NOT EXISTS marketing_packages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  price       REAL NOT NULL DEFAULT 0,
  recommended INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  config      TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaign_events (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_campev ON campaign_events(campaign_id);

CREATE TABLE IF NOT EXISTS property_stats (
  property_id    TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  day            TEXT NOT NULL,
  views          INTEGER NOT NULL DEFAULT 0,
  phone_clicks   INTEGER NOT NULL DEFAULT 0,
  website_clicks INTEGER NOT NULL DEFAULT 0,
  whatsapp_clicks INTEGER NOT NULL DEFAULT 0,
  direction_clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, day)
);
`);

// --- migrations -----------------------------------------------------------
// The enquiry status list grew (Contacted/Converted) after the first release;
// SQLite cannot alter a CHECK constraint, so rebuild the table when we see an
// old one. Data is copied, not dropped.
(function migrateEnquiryStatuses() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='enquiries'").get();
  if (!row || row.sql.includes("'Converted'")) return;
  const create = row.sql.replace(
    "CHECK (status IN ('Sent','Opened','Responded','Closed','Spam'))",
    "CHECK (status IN ('Sent','Opened','Responded','Contacted','Converted','Closed','Spam'))"
  ).replace('CREATE TABLE enquiries', 'CREATE TABLE enquiries_new')
   .replace('CREATE TABLE IF NOT EXISTS enquiries', 'CREATE TABLE enquiries_new');
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(create);
    db.exec('INSERT INTO enquiries_new SELECT * FROM enquiries');
    db.exec('DROP TABLE enquiries');
    db.exec('ALTER TABLE enquiries_new RENAME TO enquiries');
  })();
  db.pragma('foreign_keys = ON');
  console.log('[migrate] enquiries status list widened');
})();

// email_log grew columns (account/from/body/kind/sender) after the first
// release — add anything missing rather than rebuilding the table.
(function migrateEmailLogColumns() {
  const cols = db.prepare("PRAGMA table_info(email_log)").all().map((c) => c.name);
  const add = (name, def) => { if (!cols.includes(name)) db.exec(`ALTER TABLE email_log ADD COLUMN ${name} ${def}`); };
  add('account', 'TEXT');
  add('from_addr', 'TEXT');
  add('body_html', 'TEXT');
  add('kind', "TEXT NOT NULL DEFAULT 'auto'");
  add('sender_user_id', 'TEXT');
})();

function uid(prefix) {
  const s = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}_${s}` : s;
}

function audit(userId, action, entity, entityId, meta, ip) {
  db.prepare(
    'INSERT INTO audit_log (id, user_id, action, entity, entity_id, meta, ip) VALUES (?,?,?,?,?,?,?)'
  ).run(uid('aud'), userId || null, action, entity || null, entityId || null, meta ? JSON.stringify(meta) : null, ip || null);
  mirrorToSheet(userId, action, entity, entityId, meta, ip);
}

// Best-effort mirror of every admin action to a Google Sheet (via Apps Script
// Web App — see LEADS-APPS-SCRIPT.gs, action=logUpdate). Configure
// GOOGLE_SHEET_WEBHOOK_URL to turn this on; silently a no-op otherwise, and
// never lets a slow/unreachable Sheet block or fail the actual request.
function mirrorToSheet(userId, action, entity, entityId, meta, ip) {
  if (!env.sheetWebhookConfigured) return;
  let adminEmail = null;
  try {
    adminEmail = userId ? (db.prepare('SELECT email FROM users WHERE id = ?').get(userId) || {}).email : null;
  } catch (_) { /* best effort */ }

  const body = new URLSearchParams({
    action: 'logUpdate',
    admin: adminEmail || userId || 'system',
    change: action,
    entity: entity || '',
    entityId: entityId || '',
    meta: meta ? JSON.stringify(meta) : '',
    ip: ip || ''
  });

  fetch(env.GOOGLE_SHEET_WEBHOOK_URL, { method: 'POST', body })
    .catch((err) => console.warn('[sheet-mirror] failed:', err.message));
}

module.exports = { db, uid, audit, dbPath };
