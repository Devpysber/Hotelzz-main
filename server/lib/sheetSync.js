'use strict';
/**
 * Google Sheet → properties table sync.
 *
 * Every sheet in GOOGLE_SHEET_CSV_URLS is fetched as CSV and upserted into
 * SQLite, so the admin panel, owner dashboard and every public page read the
 * same listings — the sheet is no longer a browser-only overlay that the
 * server never saw. Runs on startup, on an interval, and on demand from
 * Admin → Import Listings.
 *
 * Two row shapes are understood (same as hotels-loader.js used to):
 *   - Hotelzz format: id,name,location,city_slug,address,phone,email,website,
 *     rating,pincode,image_url,property_type,active,google_cid,...
 *   - Raw Maps-scrape format: Keyword,Location,Company name,Website,Phone,
 *     Email 1,Email 2,Address,City,State,Pincode,Rating count,Review,Cid
 *
 * Rules: a sheet never deletes anything. Unclaimed listings take the sheet's
 * values; listings a hotel owner has claimed only get blank fields filled in,
 * so the owner's own edits are never overwritten by the sheet.
 */
const env = require('./env');
const { db, audit } = require('./db');
const { parseCSV } = require('./csv');
const { slugify } = require('./http');

const status = {
  configured: false,
  urls: [],
  running: false,
  lastRunAt: null,
  lastOkAt: null,
  lastResult: null,
  lastError: null
};

const truthy = (v) => { const s = String(v == null ? '' : v).toLowerCase().trim(); return !s || ['yes', 'true', '1', 'y'].includes(s); };
const blank = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

function mapScrapeRow(o) {
  const name = blank(o['Company name']);
  if (!name) return null;
  const cid = String(o['Cid'] || '').replace(/\D/g, '');

  let email = o['Email 1'];
  if (!email || /no email/i.test(email)) email = o['Email 2'];
  if (/no email/i.test(email || '')) email = '';

  const ratingText = o['Review'] || o['Rating count'] || '';
  const m = String(ratingText).match(/([\d.]+)\s*(?:out of|\/)\s*5/i);
  const rating = m ? m[1] : '';

  return {
    id: slugify(name) + (cid ? '-' + cid.slice(-6) : ''),
    name,
    location: o['Location'] || o['City'] || '',
    address: o['Address'] || '',
    phone: o['Phone'] || '',
    email: email || '',
    website: o['Website'] || '',
    rating,
    pincode: o['Pincode'] || '',
    google_cid: cid,
    active: 'yes'
  };
}

function normalizeRow(o) {
  const h = (o.id && o.name) ? o : (o.name && !o['Company name'] ? Object.assign({}, o, { id: slugify(o.name) }) : mapScrapeRow(o));
  if (!h || !h.id || !h.name) return null;
  const rating = parseFloat(h.rating);
  return {
    id: String(h.id).trim(),
    name: String(h.name).trim(),
    location: blank(h.location),
    city_slug: blank(h.city_slug) ? slugify(h.city_slug) : (blank(h.location) ? slugify(h.location) : null),
    address: blank(h.address),
    phone: blank(h.phone),
    email: blank(h.email),
    website: blank(h.website),
    rating: Number.isFinite(rating) && rating > 0 ? rating : null,
    pincode: blank(h.pincode),
    image_url: blank(h.image_url),
    property_type: blank(h.property_type),
    google_cid: blank(String(h.google_cid || '').replace(/\D/g, '')),
    google_review_count: parseInt(h.google_review_count, 10) || null,
    google_summary: blank(h.google_summary),
    gmb_link: blank(h.gmb_link),
    active: truthy(h.active) ? 1 : 0
  };
}

const FIELDS = ['name', 'location', 'city_slug', 'address', 'phone', 'email', 'website', 'rating', 'pincode',
  'image_url', 'property_type', 'google_cid', 'google_review_count', 'google_summary', 'gmb_link', 'active'];

const stmts = {
  byId: db.prepare('SELECT * FROM properties WHERE id = ?'),
  byCid: db.prepare('SELECT * FROM properties WHERE google_cid = ? LIMIT 1'),
  insert: db.prepare(
    `INSERT INTO properties (id, name, location, city_slug, address, phone, email, website, rating, pincode,
                             image_url, property_type, google_cid, google_review_count, google_summary, gmb_link, active)
     VALUES (@id,@name,@location,@city_slug,@address,@phone,@email,@website,COALESCE(@rating,4.5),@pincode,
             @image_url,@property_type,@google_cid,COALESCE(@google_review_count,0),@google_summary,@gmb_link,@active)`
  )
};

/** Applies one batch of normalised rows. Returns per-row counts. */
const apply = db.transaction((rows) => {
  const out = { inserted: 0, updated: 0, unchanged: 0, protectedClaimed: 0 };
  for (const r of rows) {
    let existing = stmts.byId.get(r.id);
    // A scrape row's derived id can differ from the id the listing was first
    // imported under — fall back to the Google CID so it never duplicates.
    if (!existing && r.google_cid) existing = stmts.byCid.get(r.google_cid);

    if (!existing) { stmts.insert.run(r); out.inserted++; continue; }

    const claimed = !!existing.owner_id || existing.claim_status === 'verified';
    const changes = {};
    for (const f of FIELDS) {
      const next = r[f];
      if (next == null) continue;                       // sheet cell blank: keep what we have
      if (claimed && f === 'active') continue;          // owner listings stay as the owner left them
      if (claimed && existing[f] != null && existing[f] !== '') continue; // owner edits win
      if (String(existing[f]) !== String(next)) changes[f] = next;
    }
    if (claimed && Object.keys(changes).length === 0) out.protectedClaimed++;
    if (!Object.keys(changes).length) { out.unchanged++; continue; }

    const sets = Object.keys(changes).map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE properties SET ${sets}, updated_at = datetime('now') WHERE id = @__id`)
      .run(Object.assign({ __id: existing.id }, changes));
    out.updated++;
  }
  return out;
});

async function fetchSheet(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error('Got a web page instead of CSV — share the sheet as "Anyone with the link" or use File → Share → Publish to web → CSV');
  }
  return parseCSV(text);
}

/** Runs one full sync across every configured sheet. */
async function run(trigger, userId) {
  status.urls = env.GOOGLE_SHEET_CSV_URLS;
  status.configured = status.urls.length > 0;
  if (!status.configured) return { ok: false, error: 'No Google Sheet configured (GOOGLE_SHEET_CSV_URLS in .env).' };
  if (status.running) return { ok: false, error: 'A sync is already running.' };

  status.running = true;
  status.lastRunAt = new Date().toISOString();
  const result = { trigger: trigger || 'schedule', sheets: [], rows: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
  try {
    for (const url of status.urls) {
      const sheet = { url, rows: 0, error: null };
      try {
        const raw = await fetchSheet(url);
        const rows = [];
        raw.forEach((o) => { const n = normalizeRow(o); if (n) rows.push(n); else result.skipped++; });
        const r = apply(rows);
        sheet.rows = rows.length;
        Object.assign(sheet, r);
        result.rows += rows.length;
        result.inserted += r.inserted;
        result.updated += r.updated;
        result.unchanged += r.unchanged;
      } catch (err) {
        sheet.error = err.message;
        console.warn('[sheet-sync] ' + url + ' failed:', err.message);
      }
      result.sheets.push(sheet);
    }

    const failed = result.sheets.filter((s) => s.error);
    status.lastResult = result;
    status.lastError = failed.length ? failed.map((s) => s.error).join('; ') : null;
    if (failed.length < result.sheets.length) status.lastOkAt = status.lastRunAt;

    if (result.inserted || result.updated) {
      require('../routes/properties').invalidateCatalog();
      audit(userId || null, 'sheet.sync', 'properties', null,
            { trigger: result.trigger, rows: result.rows, inserted: result.inserted, updated: result.updated });
    }
    console.log(`[sheet-sync] ${result.rows} rows from ${result.sheets.length} sheet(s): ` +
                `${result.inserted} new, ${result.updated} updated, ${result.unchanged} unchanged` +
                (failed.length ? `, ${failed.length} sheet(s) failed` : ''));
    return Object.assign({ ok: failed.length < result.sheets.length }, result);
  } finally {
    status.running = false;
  }
}

function getStatus() {
  return Object.assign({}, status, {
    urls: env.GOOGLE_SHEET_CSV_URLS,
    configured: env.GOOGLE_SHEET_CSV_URLS.length > 0,
    intervalMin: env.GOOGLE_SHEET_SYNC_MIN
  });
}

function start() {
  if (!env.GOOGLE_SHEET_CSV_URLS.length) return;
  const tick = () => run('schedule').catch((e) => console.error('[sheet-sync]', e.message));
  setTimeout(tick, 2000).unref();
  setInterval(tick, env.GOOGLE_SHEET_SYNC_MIN * 60 * 1000).unref();
  console.log(`  Sheets: ${env.GOOGLE_SHEET_CSV_URLS.length} Google Sheet(s) → properties, every ${env.GOOGLE_SHEET_SYNC_MIN} min`);
}

module.exports = { run, start, getStatus, normalizeRow };
