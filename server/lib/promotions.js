'use strict';
/**
 * Promotions engine — the scheduled promotional email Hotelzz sends.
 *
 * Audiences
 *   owners     tips and offers built from their own listing's numbers
 *              (listing live, finish your listing, reviews, deals, plans, campaigns)
 *   listings   unclaimed hotels with a public email: "claim your free listing"
 *   travellers deals in cities they looked at, saved stays, top-rated stays
 *
 * Pacing (what keeps this from being spam)
 *   - one promotional email per person every `minGapDays` (default 5)
 *   - the same template is not repeated within someone's last 3 promos
 *   - unclaimed listings: at most `outreachMax` emails ever, `outreachGapDays` apart
 *   - unsubscribed addresses are never mailed (mailer.js suppresses them)
 *   - at most `maxPerSweep` emails per run
 *
 * Schedule
 *   2–3 runs a day at random times between 10:00 and 19:30 India time, new
 *   times every day. The times are drawn from a seed (date + server secret), so
 *   a restart keeps the same plan and nobody outside can predict it. Running
 *   several times a day doesn't mean several emails: it just catches whoever
 *   became eligible since the last run.
 */
const crypto = require('crypto');
const env = require('./env');
const { db } = require('./db');

/* ------------------------------------------------------------ schema */

(function migrate() {
  const ucols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!ucols.includes('last_marketing_at')) db.exec('ALTER TABLE users ADD COLUMN last_marketing_at TEXT');
  if (!ucols.includes('recent_promos')) db.exec('ALTER TABLE users ADD COLUMN recent_promos TEXT');
  const pcols = db.prepare('PRAGMA table_info(properties)').all().map((c) => c.name);
  if (!pcols.includes('last_outreach_at')) db.exec('ALTER TABLE properties ADD COLUMN last_outreach_at TEXT');
  if (!pcols.includes('outreach_count')) db.exec('ALTER TABLE properties ADD COLUMN outreach_count INTEGER NOT NULL DEFAULT 0');
})();

const TEMPLATES = ['promoListingLive', 'promoProfileGaps', 'promoCollectReviews', 'promoPostDeal', 'promoBoostVisibility',
  'promoGrowCampaign', 'promoClaimListing', 'promoTravelerDeals', 'promoSavedReminder', 'promoTopStays'];

const DEFAULTS = {
  enabled: true,
  minGapDays: 5,
  maxPerSweep: 150,
  outreachGapDays: 30,
  outreachMax: 3,
  runsPerDay: 3,
  templates: Object.fromEntries(TEMPLATES.map((t) => [t, true]))
};

const KEY = 'promotions';
function config() {
  let stored = {};
  try { stored = JSON.parse((db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) || {}).value || '{}'); } catch (_) { stored = {}; }
  const c = Object.assign({}, DEFAULTS, stored);
  c.templates = Object.assign({}, DEFAULTS.templates, stored.templates || {});
  return c;
}
function saveConfig(patch, userId) {
  let stored = {};
  try { stored = JSON.parse((db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) || {}).value || '{}'); } catch (_) { stored = {}; }
  const next = Object.assign(stored, patch);
  if (patch.templates) next.templates = Object.assign({}, stored.templates || {}, patch.templates);
  db.prepare(`INSERT INTO settings (key, value, updated_by) VALUES (?,?,?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by`)
    .run(KEY, JSON.stringify(next), userId || null);
  replan();
  return config();
}

/* ------------------------------------------------------------ helpers */

const SITE = () => env.PUBLIC_URL.replace(/\/$/, '');
const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch (_) { return d; } };
const titleCase = (s) => String(s || '').replace(/(^|[\s-])(\w)/g, (_, a, b) => a + b.toUpperCase());
const views30 = (pid) => db.prepare("SELECT COALESCE(SUM(views),0) v FROM property_stats WHERE property_id = ? AND day >= date('now','-30 day')").get(pid).v;
const cityCount = (slug) => (slug ? db.prepare('SELECT COUNT(*) c FROM properties WHERE active = 1 AND city_slug = ?').get(slug).c : 0);
const LIVE_DEAL = `o.status = 'Active' AND p.active = 1
  AND (o.valid_from IS NULL OR o.valid_from = '' OR o.valid_from <= date('now'))
  AND (o.valid_to IS NULL OR o.valid_to = '' OR o.valid_to >= date('now'))`;
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString().replace('T', ' ').slice(0, 19);
const everSent = (email, template) => !!db.prepare('SELECT 1 FROM email_log WHERE lower(to_addr) = lower(?) AND template = ? LIMIT 1').get(email, template);

function missingFields(p) {
  const details = json(p.details, {});
  const photos = db.prepare('SELECT COUNT(*) c FROM photos WHERE property_id = ?').get(p.id).c;
  const rooms = db.prepare('SELECT COUNT(*) c FROM rooms WHERE property_id = ? AND price > 0').get(p.id).c;
  const amenities = Object.values(json(p.amenities, {})).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
  const checks = [
    ['Photos', photos > 0 || !!p.image_url], ['Description', !!details.description], ['Room prices', rooms > 0],
    ['Amenities', amenities > 0], ['Phone number', !!p.phone], ['Full address', !!p.address]
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([k]) => k);
  return { missing, completeness: Math.round(((checks.length - missing.length) / checks.length) * 100) };
}

/* --------------------------------------------------- message choice */

/** Ordered candidates for one owner; the first allowed one is sent. */
function ownerMessages(u, p) {
  const out = [];
  const base = { name: u.name, hotelName: p.name, city: p.location ? titleCase(p.location) : '' };
  const listingUrl = `${SITE()}/property.html?id=${encodeURIComponent(p.id)}`;
  if (!everSent(u.email, 'promoListingLive')) {
    out.push(['promoListingLive', Object.assign({}, base, { cityCount: cityCount(p.city_slug), views30: views30(p.id), listingUrl })]);
  }
  const gaps = missingFields(p);
  if (gaps.missing.length) out.push(['promoProfileGaps', Object.assign({}, base, gaps, { dashUrl: SITE() + '/owner.html#property-details' })]);
  const reviews = db.prepare("SELECT COUNT(*) c FROM reviews WHERE property_id = ? AND status = 'Published'").get(p.id).c;
  if (reviews < 5) out.push(['promoCollectReviews', Object.assign({}, base, { reviewCount: reviews, listingUrl })]);
  const ownDeal = db.prepare(`SELECT 1 FROM offers o JOIN properties p ON p.id = o.property_id WHERE o.property_id = ? AND ${LIVE_DEAL}`).get(p.id);
  if (!ownDeal) {
    const dealsLive = db.prepare(`SELECT COUNT(DISTINCT o.property_id) c FROM offers o JOIN properties p ON p.id = o.property_id WHERE ${LIVE_DEAL}`).get().c;
    out.push(['promoPostDeal', Object.assign({}, base, { dealsLive, dashUrl: SITE() + '/owner.html#offers' })]);
  }
  const sub = db.prepare('SELECT * FROM subscriptions WHERE property_id = ?').get(p.id);
  const onPaid = sub && sub.status === 'Active' && (parseFloat(String(sub.price || '').replace(/[^\d.]/g, '')) || 0) > 0;
  if (!onPaid) out.push(['promoBoostVisibility', Object.assign({}, base, { views30: views30(p.id), cityCount: cityCount(p.city_slug), plansUrl: SITE() + '/owner.html#billing' })]);
  const recentCampaign = db.prepare("SELECT 1 FROM campaigns WHERE property_id = ? AND created_at >= datetime('now','-60 day')").get(p.id);
  if (!recentCampaign) {
    const pkg = db.prepare('SELECT MIN(price) m FROM marketing_packages WHERE active = 1 AND price > 0').get();
    const enquiries30 = db.prepare("SELECT COUNT(*) c FROM enquiries WHERE property_id = ? AND sent_at >= datetime('now','-30 day')").get(p.id).c;
    out.push(['promoGrowCampaign', Object.assign({}, base, { enquiries30, fromPrice: (pkg && pkg.m) || 4999, growUrl: SITE() + '/owner.html#grow-business' })]);
  }
  return out;
}

function travelerMessages(u) {
  const out = [];
  const cities = db.prepare(
    `SELECT city_slug, MAX(location) name, COUNT(*) c FROM (
       SELECT p.city_slug, p.location FROM enquiries e JOIN properties p ON p.id = e.property_id WHERE e.user_id = ?
       UNION ALL
       SELECT p.city_slug, p.location FROM saved_hotels s JOIN properties p ON p.id = s.property_id WHERE s.user_id = ?)
     WHERE city_slug IS NOT NULL AND city_slug <> '' GROUP BY city_slug ORDER BY c DESC LIMIT 3`).all(u.id, u.id);
  const city = cities[0];
  const dealRows = (slug) => db.prepare(
    `SELECT o.id, o.title, o.discount, p.name hotel FROM offers o JOIN properties p ON p.id = o.property_id
      WHERE ${LIVE_DEAL} ${slug ? 'AND p.city_slug = ?' : ''} ORDER BY o.featured DESC, o.grabs DESC, o.created_at DESC LIMIT 4`
  ).all(...(slug ? [slug] : []));
  let deals = city ? dealRows(city.city_slug) : [];
  const dealCity = deals.length ? titleCase(city.name) : '';
  if (!deals.length) deals = dealRows(null);
  if (deals.length >= (dealCity ? 1 : 2)) {
    out.push(['promoTravelerDeals', { name: u.name, city: dealCity, dealsUrl: SITE() + '/deals.html' + (dealCity ? '?city=' + encodeURIComponent(city.city_slug) : ''),
      deals: deals.map((d) => ({ title: d.title, hotel: d.hotel, discount: d.discount || '', url: SITE() + '/deals.html#' + encodeURIComponent(d.id) })) }]);
  }
  const saved = db.prepare(
    `SELECT p.id, p.name, p.location, p.rating FROM saved_hotels s JOIN properties p ON p.id = s.property_id
      WHERE s.user_id = ? AND p.active = 1 ORDER BY s.created_at DESC LIMIT 4`).all(u.id);
  if (saved.length) {
    out.push(['promoSavedReminder', { name: u.name, portalUrl: SITE() + '/user-portal.html#saved',
      hotels: saved.map((h) => ({ name: h.name, city: titleCase(h.location), rating: h.rating || 0, url: `${SITE()}/property.html?id=${encodeURIComponent(h.id)}` })) }]);
  }
  if (city) {
    const stays = db.prepare(
      `SELECT id, name, rating FROM properties WHERE active = 1 AND city_slug = ? AND rating IS NOT NULL
        ORDER BY (rating * (1 - 1.0 / (1 + google_review_count / 20.0))) DESC, rating DESC LIMIT 5`).all(city.city_slug);
    if (stays.length >= 3) {
      out.push(['promoTopStays', { name: u.name, city: titleCase(city.name), cityUrl: `${SITE()}/city.html?city=${encodeURIComponent(city.city_slug)}`,
        stays: stays.map((h) => ({ name: h.name, rating: h.rating, url: `${SITE()}/property.html?id=${encodeURIComponent(h.id)}` })) }]);
    }
  }
  return out;
}

/* -------------------------------------------------------------- sweep */

let lastRun = null;
let running = false;

/**
 * One pass over every audience. `dryRun` returns what would be sent without
 * sending or updating anything. Returns { sent, byTemplate, skipped, sample }.
 */
async function sweep({ dryRun = false, trigger = 'schedule' } = {}) {
  if (running) return { ok: false, error: 'A promotions run is already in progress.' };
  running = true;
  const c = config();
  const { sendMail } = require('./mailer');
  const optout = require('./optout');
  const result = { ok: true, dryRun, trigger, startedAt: new Date().toISOString(), sent: 0, byTemplate: {}, suppressed: 0, failed: 0, sample: [] };
  const allowed = (t) => c.templates[t] !== false;
  const budget = () => result.sent < c.maxPerSweep;
  const record = (template, to) => {
    result.byTemplate[template] = (result.byTemplate[template] || 0) + 1;
    if (result.sample.length < 25) result.sample.push({ template, to });
  };

  async function deliver(to, template, data) {
    if (dryRun) { result.sent++; record(template, to); return true; }
    const r = await sendMail(to, template, data);
    if (r.ok) { result.sent++; record(template, to); }
    else if (r.suppressed) result.suppressed++;
    else result.failed++;
    if (env.isProd) await new Promise((res) => setTimeout(res, 400)); // gentle on the SMTP server
    return r.ok || r.suppressed;
  }

  try {
    const cutoff = daysAgo(c.minGapDays);
    const people = db.prepare(
      `SELECT * FROM users WHERE role IN ('owner','traveler') AND status = 'active' AND email IS NOT NULL AND email <> ''
          AND created_at <= datetime('now','-1 day')
          AND (last_marketing_at IS NULL OR last_marketing_at <= ?)
        ORDER BY COALESCE(last_marketing_at, '1970') ASC LIMIT 2000`).all(cutoff);

    for (const u of people) {
      if (!budget()) break;
      if (optout.isOptedOut(u.email)) continue;
      let options = [];
      if (u.role === 'owner') {
        const own = require('./ownership');
        const p = db.prepare('SELECT * FROM properties WHERE owner_id = ? AND active = 1 ORDER BY updated_at DESC').all(u.id).find((x) => own.canManage(x));
        if (p) options = ownerMessages(u, p);
      } else {
        options = travelerMessages(u);
      }
      const recent = json(u.recent_promos, []);
      const pick = options.find(([t]) => allowed(t) && !recent.includes(t));
      if (!pick) continue;
      const done = await deliver(u.email, pick[0], pick[1]);
      if (done && !dryRun) {
        db.prepare("UPDATE users SET last_marketing_at = datetime('now'), recent_promos = ? WHERE id = ?")
          .run(JSON.stringify([pick[0]].concat(recent).slice(0, 3)), u.id);
      }
    }

    // Unclaimed listings with a public email: a few invitations per run.
    if (allowed('promoClaimListing')) {
      const listings = db.prepare(
        `SELECT * FROM properties WHERE active = 1 AND owner_id IS NULL AND claim_status IN ('unclaimed','rejected')
            AND email IS NOT NULL AND email LIKE '%@%' AND outreach_count < ?
            AND (last_outreach_at IS NULL OR last_outreach_at <= ?)
          ORDER BY google_review_count DESC LIMIT 60`).all(c.outreachMax, daysAgo(c.outreachGapDays));
      const seen = new Set();
      for (const p of listings) {
        if (!budget()) break;
        const to = optout.norm(p.email);
        // One email per address per run, and never to an address that is already a partner account.
        if (seen.has(to) || optout.isOptedOut(to) || db.prepare("SELECT 1 FROM users WHERE lower(email) = ? AND role = 'owner'").get(to)) continue;
        seen.add(to);
        const done = await deliver(to, 'promoClaimListing', {
          hotelName: p.name, city: p.location ? titleCase(p.location) : '', views30: views30(p.id), cityCount: cityCount(p.city_slug),
          claimUrl: `${SITE()}/claim.html?id=${encodeURIComponent(p.id)}`
        });
        if (done && !dryRun) {
          db.prepare("UPDATE properties SET last_outreach_at = datetime('now'), outreach_count = outreach_count + 1 WHERE id = ?").run(p.id);
        }
      }
    }
  } catch (err) {
    result.ok = false;
    result.error = err.message;
    console.error('[promotions] sweep failed:', err.message);
  } finally {
    running = false;
  }
  result.finishedAt = new Date().toISOString();
  if (!dryRun) {
    lastRun = result;
    const runs = json((db.prepare("SELECT value FROM settings WHERE key = 'promotions_runs'").get() || {}).value, []);
    runs.unshift({ at: result.startedAt, trigger, sent: result.sent, byTemplate: result.byTemplate, suppressed: result.suppressed, failed: result.failed, error: result.error || null });
    db.prepare(`INSERT INTO settings (key, value) VALUES ('promotions_runs', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(JSON.stringify(runs.slice(0, 30)));
    if (result.sent) console.log('[promotions] sent', result.sent, JSON.stringify(result.byTemplate));
  }
  return result;
}

/* ---------------------------------------------------- random schedule */

const IST_MS = 5.5 * 3600 * 1000;
let plan = { day: null, slots: [], timers: [] };

/** Deterministic per day + secret: every restart and instance agree, outsiders can't predict. */
function rng(seed) {
  let a = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Today's run times (as Date) in India time: 10:00–19:30, at least 2 hours apart. */
function slotsFor(dayKey, runs) {
  const r = rng(`promotions:${env.JWT_SECRET}:${dayKey}`);
  const count = Math.max(1, Math.min(4, runs || 3)) - (r() < 0.34 ? 1 : 0) || 1;
  const START = 10 * 60, END = 19 * 60 + 30, GAP = 120;
  const mins = [];
  let guard = 0;
  while (mins.length < count && guard++ < 200) {
    const m = START + Math.floor(r() * (END - START));
    if (mins.every((x) => Math.abs(x - m) >= GAP)) mins.push(m);
  }
  mins.sort((a, b) => a - b);
  const [y, mo, d] = dayKey.split('-').map(Number);
  return mins.map((m) => new Date(Date.UTC(y, mo - 1, d, 0, m) - IST_MS));
}

function replan() {
  plan.timers.forEach(clearTimeout);
  plan.timers = [];
  const dayKey = new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
  const c = config();
  plan.day = dayKey;
  plan.slots = slotsFor(dayKey, c.runsPerDay);
  if (!schedulerOn) return;
  if (c.enabled) {
    plan.slots.filter((t) => t > Date.now()).forEach((t) => {
      plan.timers.push(setTimeout(() => sweep({ trigger: 'schedule' }).catch((e) => console.error('[promotions]', e.message)), t - Date.now()).unref());
    });
  }
  // Re-plan just after midnight India time.
  const nextMidnight = Date.UTC(...dayKey.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v)))) + 864e5 - IST_MS + 60 * 1000;
  plan.timers.push(setTimeout(replan, Math.max(60 * 1000, nextMidnight - Date.now())).unref());
}

let schedulerOn = false;
/** Starts the daily random schedule (production, or PROMOTIONS_IN_DEV=1 for testing). */
function start() {
  schedulerOn = env.isProd || process.env.PROMOTIONS_IN_DEV === '1';
  replan();
  if (schedulerOn) console.log('  Promotions: ' + plan.slots.map((t) => new Date(t.getTime() + IST_MS).toISOString().slice(11, 16)).join(', ') + ' IST today');
}

function status() {
  const c = config();
  const runs = json((db.prepare("SELECT value FROM settings WHERE key = 'promotions_runs'").get() || {}).value, []);
  const sent7 = db.prepare(
    `SELECT template, COUNT(*) c FROM email_log WHERE kind = 'marketing' AND status IN ('sent','dev-logged')
        AND created_at >= datetime('now','-7 day') GROUP BY template`).all();
  return {
    config: c, schedulerOn, running,
    today: { day: plan.day, slots: plan.slots.map((t) => ({ at: t.toISOString(), ist: new Date(t.getTime() + IST_MS).toISOString().slice(11, 16), done: t <= Date.now() })) },
    runs: runs.slice(0, 10),
    sent7: Object.fromEntries(sent7.map((r) => [r.template, r.c])),
    unsubscribed: require('./optout').count(),
    audience: {
      owners: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'owner' AND status = 'active'").get().c,
      travelers: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'traveler' AND status = 'active'").get().c,
      unclaimedWithEmail: db.prepare("SELECT COUNT(*) c FROM properties WHERE active = 1 AND owner_id IS NULL AND email LIKE '%@%'").get().c
    },
    templates: TEMPLATES
  };
}

module.exports = { sweep, start, status, config, saveConfig, slotsFor, TEMPLATES };
