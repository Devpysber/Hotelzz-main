'use strict';
/**
 * Server-side SEO for the pages search engines index most.
 *
 * property.html and city.html are one HTML file each, filled in by JavaScript.
 * Search engines and link previews (WhatsApp, Facebook, X) should not depend on
 * that, so these routes send the same file with the real title, description,
 * canonical URL, Open Graph/Twitter tags and schema.org JSON-LD already in the
 * <head>. Unknown or hidden listings answer 404 + noindex instead of an empty
 * "soft 404" page. Also builds the live sitemap.xml from the database.
 */
const fs = require('fs');
const path = require('path');
const env = require('./env');
const { db } = require('./db');

const ROOT = path.resolve(__dirname, '..', '..');
const SITE = 'https://hotelzz.in';
const BASE = (env.isProd ? SITE : env.PUBLIC_URL).replace(/\/$/, '');
const DEFAULT_IMAGE = SITE + '/og-image.jpg';

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// JSON inside <script> must not be able to close the tag.
const ld = (obj) => '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>';
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const titleCase = (s) => String(s || '').replace(/(^|[\s-])(\w)/g, (_, a, b) => a + b.toUpperCase());

const templates = {};
function template(file) {
  const full = path.join(ROOT, file);
  const mtime = fs.statSync(full).mtimeMs;
  if (!templates[file] || templates[file].mtime !== mtime) templates[file] = { mtime, html: fs.readFileSync(full, 'utf8') };
  return templates[file].html;
}

function render(file, meta) {
  let html = template(file);
  html = html.replace(/<title([^>]*)>[\s\S]*?<\/title>/i, `<title$1>${esc(meta.title)}</title>`);
  html = html.replace(/<meta\s+name="description"([^>]*?)content="[^"]*"/i, `<meta name="description"$1content="${esc(meta.description)}"`);
  const tags = [
    `<link rel="canonical" href="${esc(meta.url)}" />`,
    meta.robots ? `<meta name="robots" content="${esc(meta.robots)}" />` : '',
    `<meta property="og:site_name" content="Hotelzz.in" />`,
    `<meta property="og:type" content="${esc(meta.type || 'website')}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    `<meta property="og:image" content="${esc(meta.image || DEFAULT_IMAGE)}" />`,
    `<meta property="og:locale" content="en_IN" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(meta.image || DEFAULT_IMAGE)}" />`
  ].concat((meta.jsonld || []).map(ld)).filter(Boolean).join('\n');
  return html.replace(/<\/head>/i, tags + '\n</head>');
}

const publicImage = (u) => {
  const s = String(u || '');
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/uploads\//.test(s)) return SITE + s;
  return '';
};

/* ----------------------------------------------------------- property */

function propertyPage(req, res) {
  const id = String(req.query.id || '');
  const p = id ? db.prepare('SELECT * FROM properties WHERE id = ? AND active = 1').get(id) : null;
  const url = `${SITE}/property.html?id=${encodeURIComponent(id)}`;
  res.set('Cache-Control', 'public, max-age=300');
  if (!p) {
    return res.status(404).type('html').send(render('property.html', {
      title: 'Property not found | Hotelzz.in', description: 'This listing is no longer available on Hotelzz.in. Browse 3,000+ verified stays across India.',
      url, robots: 'noindex, follow'
    }));
  }
  const place = p.location ? titleCase(p.location) : 'India';
  const reviews = db.prepare("SELECT ROUND(AVG(rating),1) avg, COUNT(*) c FROM reviews WHERE property_id = ? AND status = 'Published'").get(p.id);
  const minPrice = db.prepare('SELECT MIN(price) m FROM rooms WHERE property_id = ? AND active = 1 AND price > 0').get(p.id).m;
  const photo = db.prepare('SELECT url FROM photos WHERE property_id = ? ORDER BY is_cover DESC, created_at LIMIT 1').get(p.id);
  const image = publicImage(photo && photo.url) || publicImage(p.image_url);

  const title = clip(`${p.name}, ${place} — Book Direct`, 58) + ' | Hotelzz.in';
  const description = clip(p.google_summary
    ? `${p.name} in ${place}: ${p.google_summary} Book direct on WhatsApp — zero booking fees.`
    : `${p.name} in ${place}${p.rating ? ' · rated ' + p.rating + '/5' : ''}. See photos, address and policies, and book direct on WhatsApp with zero booking fees on Hotelzz.in.`, 158);

  const hotel = {
    '@context': 'https://schema.org', '@type': 'Hotel', '@id': url + '#hotel',
    name: p.name, url, description,
    address: { '@type': 'PostalAddress', streetAddress: p.address || undefined, addressLocality: place, postalCode: p.pincode || undefined, addressCountry: 'IN' }
  };
  if (image) hotel.image = image;
  if (p.phone) hotel.telephone = p.phone;
  if (minPrice) hotel.priceRange = '₹' + Math.round(minPrice).toLocaleString('en-IN') + '+';
  if (p.google_cid) hotel.hasMap = 'https://www.google.com/maps?cid=' + String(p.google_cid).replace(/\D/g, '');
  // Only ratings collected on Hotelzz itself — never imported/third-party scores.
  if (reviews.c > 0) hotel.aggregateRating = { '@type': 'AggregateRating', ratingValue: reviews.avg, reviewCount: reviews.c, bestRating: 5 };

  const crumbs = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: `Hotels in ${place}`, item: `${SITE}/city.html?city=${encodeURIComponent(p.city_slug || '')}` },
      { '@type': 'ListItem', position: 3, name: p.name, item: url }
    ]
  };
  res.type('html').send(render('property.html', { title, description, url, image, type: 'hotel', jsonld: [hotel, crumbs] }));
}

/* --------------------------------------------------------------- city */

function cityPage(req, res) {
  const slug = String(req.query.city || 'all').toLowerCase();
  const all = slug === 'all';
  const url = `${SITE}/city.html?city=${encodeURIComponent(slug)}`;
  const rows = db.prepare(
    `SELECT id, name, location FROM properties WHERE active = 1 ${all ? '' : 'AND city_slug = ?'} ORDER BY rating DESC, google_review_count DESC LIMIT 20`
  ).all(...(all ? [] : [slug]));
  const count = db.prepare(`SELECT COUNT(*) c FROM properties WHERE active = 1 ${all ? '' : 'AND city_slug = ?'}`).get(...(all ? [] : [slug])).c;
  res.set('Cache-Control', 'public, max-age=300');
  if (!count) {
    return res.status(404).type('html').send(render('city.html', {
      title: 'No hotels listed here yet | Hotelzz.in', description: 'We don\'t have stays in this area yet. Browse 3,000+ verified hotels, villas and homestays across India on Hotelzz.in.',
      url, robots: 'noindex, follow'
    }));
  }
  const place = all ? 'India' : titleCase((rows[0] && rows[0].location) || slug.replace(/-/g, ' '));
  const title = all ? `Hotels Across India — ${count.toLocaleString('en-IN')}+ Stays, Book Direct | Hotelzz.in`
    : `Hotels in ${place} — ${count} Stays, Book Direct | Hotelzz.in`;
  const description = clip(`Compare ${count} hand-picked hotels, villas and homestays in ${place}. Real photos, guest ratings and direct WhatsApp booking with zero booking fees on Hotelzz.in.`, 158);
  const list = {
    '@context': 'https://schema.org', '@type': 'ItemList', name: `Hotels in ${place}`, numberOfItems: count,
    itemListElement: rows.map((h, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/property.html?id=${encodeURIComponent(h.id)}`, name: h.name }))
  };
  const crumbs = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: `Hotels in ${place}`, item: url }
    ]
  };
  res.type('html').send(render('city.html', { title, description, url, jsonld: [list, crumbs] }));
}

/* ------------------------------------------------------------ sitemap */

let sitemapCache = null;
function sitemap(_req, res) {
  if (!sitemapCache || Date.now() - sitemapCache.at > 60 * 60 * 1000) {
    const today = new Date().toISOString().slice(0, 10);
    const day = (d) => (d ? String(d).slice(0, 10) : today);
    const urls = [];
    const add = (loc, lastmod, changefreq, priority, image) => urls.push(
      `  <url><loc>${esc(loc)}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority>` +
      (image ? `<image:image><image:loc>${esc(image)}</image:loc></image:image>` : '') + '</url>');

    add(SITE + '/', today, 'daily', '1.0');
    add(SITE + '/deals.html', today, 'daily', '0.9');
    add(SITE + '/city.html?city=all', today, 'daily', '0.9');
    add(SITE + '/marketing.html', today, 'weekly', '0.8');
    add(SITE + '/ota-listing.html', today, 'weekly', '0.8');
    add(SITE + '/claim.html', today, 'monthly', '0.6');
    add(SITE + '/privacy.html', '2026-06-24', 'yearly', '0.2');
    add(SITE + '/terms.html', '2026-06-24', 'yearly', '0.2');

    db.prepare(
      `SELECT city_slug, MAX(updated_at) u, COUNT(*) c FROM properties
        WHERE active = 1 AND city_slug IS NOT NULL AND city_slug <> '' GROUP BY city_slug ORDER BY c DESC`
    ).all().forEach((c) => add(`${SITE}/city.html?city=${encodeURIComponent(c.city_slug)}`, day(c.u), 'daily', c.c >= 20 ? '0.8' : '0.7'));

    db.prepare('SELECT id, updated_at, image_url FROM properties WHERE active = 1 ORDER BY rating DESC').all()
      .forEach((p) => add(`${SITE}/property.html?id=${encodeURIComponent(p.id)}`, day(p.updated_at), 'weekly', '0.6', publicImage(p.image_url)));

    const body = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
      urls.join('\n') + '\n</urlset>\n';
    sitemapCache = { at: Date.now(), body, count: urls.length };
  }
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(sitemapCache.body);
}

function robots(_req, res) {
  res.type('text/plain').send([
    '# Hotelzz.in',
    'User-agent: *',
    'Allow: /',
    '',
    '# Signed-in areas, sign-in pages and the API are not for search results',
    'Disallow: /api/',
    'Disallow: /admin.html',
    'Disallow: /admin-login.html',
    'Disallow: /owner.html',
    'Disallow: /user-portal.html',
    'Disallow: /login.html',
    'Disallow: /dashboard-login.html',
    'Disallow: /reset-password.html',
    'Disallow: /downloads/',
    'Disallow: /tests/',
    'Disallow: /server/',
    'Disallow: /*.md$',
    'Disallow: /*.gs$',
    '',
    `Sitemap: ${SITE}/sitemap.xml`,
    ''
  ].join('\n'));
}

// Private and utility pages: never in search results, whatever links to them.
const NOINDEX = /^\/(admin|admin-login|owner|user-portal|login|dashboard-login|reset-password|404)(\.html)?$|^\/api\//;
function noindexPrivate(req, res, next) {
  if (NOINDEX.test(req.path)) res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
}

function invalidate() { sitemapCache = null; }

module.exports = { propertyPage, cityPage, sitemap, robots, noindexPrivate, invalidate };
