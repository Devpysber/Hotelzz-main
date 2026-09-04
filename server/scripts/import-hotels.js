'use strict';
/**
 * Imports hotels.csv into the properties table.
 *   node server/scripts/import-hotels.js [path/to/hotels.csv]
 * Re-runnable: rows are matched on the CSV `id` and updated in place, so a
 * refreshed export never duplicates listings or wipes owner/claim state.
 */
const fs = require('fs');
const path = require('path');
const { db } = require('../lib/db');
const { slugify } = require('../lib/http');
const { parseCSV: parseCSVRows } = require('../lib/csv');

function parseCSV(text) {
  return parseCSVRows(text).filter((o) => o.id || o.name);
}

const file = path.resolve(process.cwd(), process.argv[2] || 'hotels.csv');
const rows = parseCSV(fs.readFileSync(file, 'utf8'));
console.log(`Parsed ${rows.length} rows from ${file}`);

const insert = db.prepare(
  `INSERT INTO properties (id, name, location, city_slug, address, phone, website, rating, pincode,
                           image_url, property_type, google_cid, google_review_count, google_summary,
                           gmb_link, active)
   VALUES (@id,@name,@location,@city_slug,@address,@phone,@website,@rating,@pincode,
           @image_url,@property_type,@google_cid,@google_review_count,@google_summary,@gmb_link,@active)
   ON CONFLICT(id) DO UPDATE SET
     name=excluded.name, location=excluded.location, city_slug=excluded.city_slug,
     address=excluded.address, phone=excluded.phone, website=excluded.website,
     rating=excluded.rating, pincode=excluded.pincode, image_url=excluded.image_url,
     property_type=excluded.property_type, google_cid=excluded.google_cid,
     google_review_count=excluded.google_review_count, google_summary=excluded.google_summary,
     gmb_link=excluded.gmb_link, active=excluded.active, updated_at=datetime('now')`
);

const truthy = (v) => { const s = String(v || '').toLowerCase(); return !s || ['yes', 'true', '1', 'y'].includes(s); };

const run = db.transaction((list) => {
  let n = 0;
  for (const h of list) {
    if (!h.id || !h.name) continue;
    insert.run({
      id: h.id,
      name: h.name,
      location: h.location || null,
      city_slug: h.city_slug || slugify(h.location),
      address: h.address || null,
      phone: h.phone || null,
      website: h.website || null,
      rating: parseFloat(h.rating) || 4.5,
      pincode: h.pincode || null,
      image_url: h.image_url || null,
      property_type: h.property_type || null,
      google_cid: h.google_cid || null,
      google_review_count: parseInt(h.google_review_count, 10) || 0,
      google_summary: h.google_summary || null,
      gmb_link: h.gmb_link || null,
      active: truthy(h.active) ? 1 : 0
    });
    n++;
  }
  return n;
});

const count = run(rows);
const total = db.prepare('SELECT COUNT(*) c FROM properties').get().c;
console.log(`Imported/updated ${count} properties. Table now holds ${total}.`);
