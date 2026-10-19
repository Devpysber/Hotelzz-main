// Email checks against a running dev server: every template renders and
// sends, every scheduled job fires when due (and only once), and promotions
// pace, personalise and honour unsubscribes.
//
//   npm start                (NODE_ENV=development, no SMTP: mail is logged)
//   node tests/email.js      (HZ_BASE to override)
//
// Reads/backdates rows in the dev database (path from /api/health) to make
// jobs due — never run this against production.
const path = require('path');
const Database = require('better-sqlite3');
const { BASE } = require('./_browser');

let failed = 0;
const check = (cond, m) => { if (cond) console.log('  ✓ ' + m); else { failed++; console.log('  ✗ ' + m); } };
const BAD = /undefined|\bnull\b|NaN|\[object Object\]/;

let cookie = '';
async function call(method, p, body) {
  const r = await fetch(BASE + p, { method, redirect: 'manual',
    headers: Object.assign({ Cookie: cookie }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie');
  if (set && /hz_session/.test(set)) cookie = set.split(';')[0];
  const text = await r.text();
  let json = {};
  try { json = JSON.parse(text); } catch (_) { /* html */ }
  return { status: r.status, json, text };
}

(async () => {
  await call('POST', '/api/auth/login', { identifier: 'admin@hotelzz.in', password: 'admin123', role: 'admin' });
  const health = (await call('GET', '/api/health')).json;
  if (!health.db) throw new Error('Run against a development server (needs /api/health db path).');
  const db = new Database(path.resolve(health.db));
  const lastLog = (to, template) => db.prepare('SELECT * FROM email_log WHERE lower(to_addr) = lower(?) AND template = ? ORDER BY rowid DESC LIMIT 1').get(to, template);

  console.log('Every template');
  const templates = (await call('GET', '/api/admin/email-templates')).json.templates || [];
  check(templates.length >= 40, templates.length + ' templates registered');
  let renderBad = [], sendBad = [];
  for (const t of templates) {
    const prev = await call('POST', `/api/admin/email-templates/${t.name}/preview`, {});
    if (prev.status !== 200 || BAD.test(prev.json.subject + prev.json.text + prev.json.html) || !prev.json.html) renderBad.push(t.name);
    const sent = await call('POST', '/api/admin/email-send', { to: 'template-check@example.com', template: t.name, data: t.sample });
    const row = lastLog('template-check@example.com', t.name);
    if (sent.status !== 200 || !row || !['sent', 'dev-logged'].includes(row.status) || BAD.test(row.subject + row.preview)) sendBad.push(t.name);
  }
  check(!renderBad.length, 'every template previews cleanly' + (renderBad.length ? ': ' + renderBad.join(', ') : ''));
  check(!sendBad.length, 'every template sends and is logged' + (sendBad.length ? ': ' + sendBad.join(', ') : ''));
  const promoT = templates.filter((t) => t.marketing).map((t) => t.name);
  check(promoT.length === 10, promoT.length + ' promotional templates');
  const promoRow = lastLog('template-check@example.com', promoT[0]);
  check(promoRow && promoRow.kind === 'marketing' && /unsubscribe\?e=/.test(promoRow.body_html), 'promotional mail is tagged marketing and carries an unsubscribe link');
  const tx = lastLog('template-check@example.com', 'otp');
  check(tx && tx.kind !== 'marketing' && !/unsubscribe\?e=/.test(tx.body_html || ''), 'account emails are not marketing (no unsubscribe)');

  console.log('Scheduled account emails');
  const owner = db.prepare("SELECT * FROM users WHERE email = 'owner@grandpalace.com'").get();
  const prop = db.prepare('SELECT * FROM properties WHERE owner_id = ? LIMIT 1').get(owner.id);
  const traveler = db.prepare("SELECT * FROM users WHERE email = 'rahul@example.com'").get();
  const stamp = Date.now().toString(36);
  const ins = db.prepare(`INSERT INTO enquiries (id, user_id, property_id, property_name, property_city, owner_id, guest_name, guest_email, guest_phone,
                            message, status, sent_at, responded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  ins.run('HZ-T1-' + stamp, traveler.id, prop.id, prop.name, prop.location, owner.id, 'Late Guest', 'rahul@example.com', '9820144512', 'Hi', 'Sent',
          db.prepare("SELECT datetime('now','-30 hours') d").get().d, null);
  ins.run('HZ-T2-' + stamp, traveler.id, prop.id, prop.name, prop.location, owner.id, 'Happy Guest', 'rahul@example.com', '9820144512', 'Hi', 'Responded',
          db.prepare("SELECT datetime('now','-5 day') d").get().d, db.prepare("SELECT datetime('now','-4 day') d").get().d);
  db.prepare(`INSERT INTO leads (id, type, name, email, phone, plan, source, status, created_at) VALUES (?,?,?,?,?,?,?, 'New', datetime('now','-4 day'))`)
    .run('lead_t_' + stamp, 'marketing', 'Old Lead', `oldlead-${stamp}@example.com`, '9876512345', 'Growth Plan', 'test');
  const run1 = (await call('POST', '/api/admin/automation/run', {})).json.summary || {};
  check(run1['enquiry-reminder'] >= 1 && lastLog(owner.email, 'enquiryReminder'), 'unanswered enquiry → owner reminder (' + run1['enquiry-reminder'] + ')');
  check(run1['review-request'] >= 1 && lastLog('rahul@example.com', 'reviewRequest'), 'answered enquiry → review request (' + run1['review-request'] + ')');
  check(run1['lead-followup'] >= 1 && lastLog(`oldlead-${stamp}@example.com`, 'leadFollowUp'), 'quiet lead → follow-up (' + run1['lead-followup'] + ')');
  const run2 = (await call('POST', '/api/admin/automation/run', {})).json.summary || {};
  check(!run2['enquiry-reminder'] && !run2['review-request'] && !run2['lead-followup'], 'running again sends nothing twice');
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  console.log(`  · owner digest (Mondays) and admin digest (08–10 IST) are time-gated — today is ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][ist.getUTCDay()]} ${String(ist.getUTCHours()).padStart(2,'0')}:${String(ist.getUTCMinutes()).padStart(2,'0')} IST: digest counts ${run1['owner-digest']} / ${run1['admin-digest']}`);

  console.log('Promotions');
  db.prepare("UPDATE users SET created_at = datetime('now','-3 day'), last_marketing_at = NULL, recent_promos = NULL WHERE role IN ('owner','traveler')").run();
  db.prepare("DELETE FROM email_optouts").run();
  // Give the traveller something real to hear about: a saved stay.
  const anyStay = db.prepare('SELECT id FROM properties WHERE active = 1 AND id <> ? LIMIT 1').get(prop.id);
  db.prepare('INSERT OR IGNORE INTO saved_hotels (user_id, property_id) VALUES (?, ?)').run(traveler.id, anyStay.id);
  const dry = (await call('POST', '/api/admin/promotions/run', { dryRun: true })).json;
  check(dry.ok && dry.sent >= 2, 'preview finds recipients (' + dry.sent + ': ' + JSON.stringify(dry.byTemplate) + ')');
  const beforeCount = db.prepare("SELECT COUNT(*) c FROM email_log WHERE kind = 'marketing'").get().c;
  check(db.prepare("SELECT COUNT(*) c FROM email_log WHERE kind = 'marketing'").get().c === beforeCount, 'preview sends nothing');
  const real = (await call('POST', '/api/admin/promotions/run', { dryRun: false })).json;
  check(real.ok && real.sent === dry.sent, 'run sends what the preview showed (' + real.sent + ')');
  const ownerPromo = db.prepare("SELECT * FROM email_log WHERE kind = 'marketing' AND to_addr = 'owner@grandpalace.com' ORDER BY rowid DESC LIMIT 1").get();
  check(ownerPromo && ownerPromo.subject.includes(prop.name), 'owner promo is personalised: "' + (ownerPromo || {}).subject + '"');
  const travelerPromo = db.prepare("SELECT * FROM email_log WHERE kind = 'marketing' AND to_addr = 'rahul@example.com' ORDER BY rowid DESC LIMIT 1").get();
  check(travelerPromo && !BAD.test(travelerPromo.subject + travelerPromo.body_html), 'traveller promo sent: "' + (travelerPromo || {}).subject + '"');
  check((await call('POST', '/api/admin/promotions/run', { dryRun: false })).json.sent === 0, 'a second run the same day sends nothing (pacing)');
  const status = (await call('GET', '/api/admin/promotions')).json.status;
  check(status.today.slots.length >= 1 && status.today.slots.every((x) => x.ist >= '10:00' && x.ist <= '19:30'), 'today\'s random send times sit in 10:00–19:30 IST: ' + status.today.slots.map((x) => x.ist).join(', '));
  const unsubUrl = (ownerPromo.body_html.match(/href="([^"]*\/unsubscribe\?[^"]*)"/) || [])[1].replace(/^https?:\/\/[^/]+/, '');
  check((await call('GET', unsubUrl)).text.includes('Stop promotional emails'), 'unsubscribe link opens the confirm page');
  check((await call('POST', unsubUrl, null)).status === 200, 'one-click unsubscribe (inbox button) works');
  check((await call('GET', unsubUrl.replace(/t=[a-f0-9]+/, 't=' + '0'.repeat(32)))).status === 400, 'forged unsubscribe link is refused');
  db.prepare("UPDATE users SET last_marketing_at = NULL, recent_promos = NULL WHERE email = 'owner@grandpalace.com'").run();
  const after = (await call('POST', '/api/admin/promotions/run', { dryRun: false })).json;
  check(!(after.sample || []).some((x) => x.to === 'owner@grandpalace.com'), 'unsubscribed owner gets no more promotions');
  const otp = await call('POST', '/api/auth/otp/request', { identifier: 'owner@grandpalace.com', role: 'owner' });
  check(otp.status === 200 && ['sent', 'dev-logged'].includes((lastLog('owner@grandpalace.com', 'otp') || {}).status), '…but still gets account emails (sign-in code)');
  db.prepare("DELETE FROM email_optouts WHERE email = 'owner@grandpalace.com'").run();

  console.log(failed ? `\n${failed} check(s) failed` : '\nAll email checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
