'use strict';
const env = require('./env');
const { db, uid } = require('./db');
const { hashPassword } = require('./auth');

async function upsertUser({ role, name, email, phone, password, city }) {
  const existing = db.prepare('SELECT * FROM users WHERE lower(email) = ? AND role = ?').get(email.toLowerCase(), role);
  if (existing) return existing;
  const id = uid(role === 'owner' ? 'own' : role === 'admin' ? 'adm' : 'usr');
  db.prepare(
    `INSERT INTO users (id, role, name, email, phone, password_hash, city, email_verified, status)
     VALUES (?,?,?,?,?,?,?,1,'active')`
  ).run(id, role, name, email.toLowerCase(), phone || null, password ? await hashPassword(password) : null, city || null);
  console.log(`[seed] created ${role}: ${email}`);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

/** The marketing catalogue ships with the product; admins edit it in the panel. */
function seedPackages() {
  const defaults = require('./default-packages.json');
  const insert = db.prepare(
    `INSERT INTO marketing_packages (id, name, description, price, recommended, active, config, sort_order)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO NOTHING`
  );
  defaults.forEach((p, i) => {
    const { id, name, description, startingPrice, recommended, active, ...config } = p;
    insert.run(id, name, description || null, startingPrice || 0,
               recommended ? 1 : 0, active === false ? 0 : 1, JSON.stringify(config), i);
  });
}

/** The plan catalogue ships with the product; admins edit price/features in the panel. */
function seedPlans() {
  const defaults = require('./default-plans.json');
  const insert = db.prepare(
    `INSERT INTO plans (id, name, price, period, features, sort_order)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO NOTHING`
  );
  defaults.forEach((p, i) => {
    insert.run(p.id, p.name, p.price || 0, p.period || 'month', JSON.stringify(p.features || []), i);
  });
}

/**
 * The public catalogue lives in the database. If it is missing most of the
 * bundled hotels.csv (a fresh or partly-imported database), add the missing
 * listings. Insert-only: existing rows — edited, deactivated, claimed — are
 * never touched, so admin and owner changes always win.
 */
function seedCatalogue() {
  const fs = require('fs');
  const path = require('path');
  const file = path.resolve(__dirname, '..', '..', 'hotels.csv');
  if (!fs.existsSync(file)) return;
  const { parseCSV } = require('./csv');
  const { slugify } = require('./http');
  const rows = parseCSV(fs.readFileSync(file, 'utf8')).filter((r) => r.id && r.name);
  const have = db.prepare('SELECT COUNT(*) c FROM properties').get().c;
  if (!rows.length || have >= rows.length * 0.5) return;

  const truthy = (v) => { const t = String(v || '').toLowerCase(); return !t || ['yes', 'true', '1', 'y'].includes(t); };
  const insert = db.prepare(
    `INSERT INTO properties (id, name, location, city_slug, address, phone, website, rating, pincode,
                             image_url, property_type, google_cid, google_review_count, google_summary, gmb_link, active)
     VALUES (@id,@name,@location,@city_slug,@address,@phone,@website,@rating,@pincode,
             @image_url,@property_type,@google_cid,@google_review_count,@google_summary,@gmb_link,@active)
     ON CONFLICT(id) DO NOTHING`
  );
  const added = db.transaction((list) => list.reduce((n, h) => n + insert.run({
    id: h.id, name: h.name, location: h.location || null, city_slug: h.city_slug || slugify(h.location),
    address: h.address || null, phone: h.phone || null, website: h.website || null,
    rating: parseFloat(h.rating) || 4.5, pincode: h.pincode || null, image_url: h.image_url || null,
    property_type: h.property_type || null, google_cid: String(h.google_cid || '').replace(/\D/g, '') || null,
    google_review_count: parseInt(h.google_review_count, 10) || 0, google_summary: h.google_summary || null,
    gmb_link: h.gmb_link || null, active: truthy(h.active) ? 1 : 0
  }).changes, 0))(rows);
  console.log(`[seed] catalogue had ${have} listings — added ${added} missing ones from hotels.csv`);
}

async function seed() {
  seedPackages();
  seedPlans();
  seedCatalogue();
  // Only bootstrap the first admin. Once any admin exists, never re-create the
  // seed account — otherwise changing the admin email in Settings would bring
  // SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD back on the next restart.
  const anyAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!anyAdmin) {
    const weak = env.WEAK_ADMIN_PASSWORDS.includes(env.SEED_ADMIN_PASSWORD) || env.SEED_ADMIN_PASSWORD.length < 10;
    if (env.isProd && weak) {
      // Never create a production admin with a guessable password: create it
      // without one — sign in with an email code or "Forgot password".
      await upsertUser({ role: 'admin', name: 'Hotelzz Admin', email: env.SEED_ADMIN_EMAIL, phone: '+919930090487', password: null });
      console.warn('[seed] SEED_ADMIN_PASSWORD is weak — admin created without a password. Use Email OTP or Forgot password at /admin-login.html.');
    } else {
      await upsertUser({ role: 'admin', name: 'Hotelzz Admin', email: env.SEED_ADMIN_EMAIL, phone: '+919930090487', password: env.SEED_ADMIN_PASSWORD });
    }
  }

  if (!env.isProd) {
    await upsertUser({
      role: 'traveler', name: 'Rahul Sharma', email: 'rahul@example.com',
      phone: '+919820144512', password: 'password123', city: 'Mumbai'
    });
    const owner = await upsertUser({
      role: 'owner', name: 'Vikram Malhotra', email: 'owner@grandpalace.com',
      phone: '+919800012345', password: 'owner12345', city: 'Mumbai'
    });
    const hasProp = db.prepare('SELECT 1 FROM properties WHERE owner_id = ?').get(owner.id);
    if (!hasProp) {
      db.prepare(
        `INSERT INTO properties (id, owner_id, name, location, city_slug, phone, email, claim_status, rating, active)
         VALUES (?,?,?,?,?,?,?, 'verified', 4.6, 1)`
      ).run(uid('prop'), owner.id, 'The Grand Palace Mumbai', 'Mumbai', 'mumbai',
            '+919800012345', 'owner@grandpalace.com');
    }
  }
}

module.exports = { seed };
