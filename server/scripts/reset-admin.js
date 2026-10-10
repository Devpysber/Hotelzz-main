'use strict';
/**
 * Resets an admin account's sign-in email and/or password, straight in the DB.
 * Use it when the admin is locked out (forgotten password, lost mailbox) or to
 * replace the seed admin@hotelzz.in / admin123 credentials on a live server.
 *
 *   node server/scripts/reset-admin.js --email new@hotelzz.in --password 'N3w-strong-pass'
 *   node server/scripts/reset-admin.js --password 'N3w-strong-pass'          # keep email
 *   node server/scripts/reset-admin.js --email new@hotelzz.in                # random password
 *   node server/scripts/reset-admin.js --current old@hotelzz.in --email ...  # pick one of several admins
 *
 * The password may also come from RESET_ADMIN_PASSWORD so it stays out of
 * shell history. If no password is given, a random one is generated and printed.
 * Run it on the server with the same .env / DB_PATH the app uses.
 */
const crypto = require('crypto');
const { db, audit, dbPath } = require('../lib/db');
const { hashPassword } = require('../lib/auth');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`Unexpected argument: ${argv[i]}`);
    out[m[1]] = m[2] !== undefined ? m[2] : argv[++i];
  }
  return out;
}

function fail(msg) {
  console.error(`[reset-admin] ${msg}`);
  process.exit(1);
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { fail(e.message); }

  const newEmail = args.email ? String(args.email).trim().toLowerCase() : null;
  let password = args.password || process.env.RESET_ADMIN_PASSWORD || null;
  const current = args.current ? String(args.current).trim().toLowerCase() : null;

  if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) fail(`Invalid email: ${newEmail}`);
  if (password && password.length < 8) fail('Password must be at least 8 characters');

  const admins = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at").all();
  if (!admins.length) fail(`No admin accounts in ${dbPath}. Start the server once to seed one.`);

  let admin;
  if (current) {
    admin = admins.find((a) => a.email.toLowerCase() === current);
    if (!admin) fail(`No admin with email ${current}. Admins: ${admins.map((a) => a.email).join(', ')}`);
  } else if (admins.length === 1) {
    admin = admins[0];
  } else {
    fail(`Several admins exist — pass --current <email>. Admins: ${admins.map((a) => a.email).join(', ')}`);
  }

  if (newEmail && newEmail !== admin.email.toLowerCase()) {
    const taken = db.prepare("SELECT 1 FROM users WHERE lower(email) = ? AND role = 'admin' AND id <> ?")
      .get(newEmail, admin.id);
    if (taken) fail(`Another admin already uses ${newEmail}`);
  }

  const generated = !password;
  if (generated) password = crypto.randomBytes(12).toString('base64url');

  db.prepare(
    `UPDATE users
        SET email = ?, password_hash = ?, status = 'active', email_verified = 1, updated_at = datetime('now')
      WHERE id = ?`
  ).run(newEmail || admin.email, await hashPassword(password), admin.id);
  // Outstanding OTP / reset links were issued for the old credentials.
  db.prepare('DELETE FROM tokens WHERE user_id = ?').run(admin.id);
  audit(admin.id, 'admin.credentials.reset', 'user', admin.id,
        { from: admin.email, to: newEmail || admin.email, via: 'cli' }, null);

  console.log(`[reset-admin] Updated admin ${admin.id}`);
  console.log(`  email:    ${newEmail || admin.email}${newEmail && newEmail !== admin.email ? ` (was ${admin.email})` : ''}`);
  console.log(`  password: ${generated ? password + '  (generated — store it now)' : '(as provided)'}`);
}

main().catch((e) => fail(e.stack || e.message));
