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
  ).run(id, role, name, email.toLowerCase(), phone || null, await hashPassword(password), city || null);
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

async function seed() {
  seedPackages();
  seedPlans();
  await upsertUser({
    role: 'admin',
    name: 'Hotelzz Admin',
    email: env.SEED_ADMIN_EMAIL,
    phone: '+919930090487',
    password: env.SEED_ADMIN_PASSWORD
  });

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
