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
const kit = require('./sitekit');

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
  // data-ssr tells the page script the server already wrote the head, so it
  // must not overwrite it (Site Kit overrides would otherwise be lost).
  html = html.replace(/<title([^>]*)>[\s\S]*?<\/title>/i, `<title data-ssr$1>${esc(meta.title)}</title>`);
  html = html.replace(/<meta\s+name="description"([^>]*?)content="[^"]*"/i, `<meta name="description" data-ssr$1content="${esc(meta.description)}"`);
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
  if (meta.robots) html = html.replace(/<meta\s+name="robots"[^>]*>\s*/gi, '');
  html = html.replace(/<\/head>/i, tags + '\n</head>');
  if (meta.ssr) html = html.replace('<div id="content">', '<div id="content">' + meta.ssr);
  return kit.decorate(html, { key: meta.key || '/' + file, section: meta.section, faqs: meta.faqs, vars: meta.vars, skipMeta: true });
}

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const rupees = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const plural = (n, one, many) => fmt(n) + ' ' + (n === 1 ? one : (many || one + 's'));
const typeWord = (t) => {
  const s = String(t || '').trim().toLowerCase();
  return !s ? 'stays' : /[^aeiou]y$/.test(s) ? s.replace(/y$/, 'ies') : s + 's';
};
const listWords = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
const today = () => new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

function liveDeals(where, args) {
  return db.prepare(
    `SELECT o.title, o.discount, p.name hotel, p.id pid FROM offers o JOIN properties p ON p.id = o.property_id
      WHERE o.status = 'Active' AND p.active = 1
        AND (o.valid_from IS NULL OR o.valid_from = '' OR o.valid_from <= date('now'))
        AND (o.valid_to IS NULL OR o.valid_to = '' OR o.valid_to >= date('now')) ${where}
      ORDER BY o.created_at DESC LIMIT 5`
  ).all(...args);
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
  const aeo = propertyAnswers(p, { place, reviews, minPrice });
  res.type('html').send(render('property.html', {
    title, description, url, image, type: 'hotel', jsonld: [hotel, crumbs],
    key: '/property.html?id=' + p.id, vars: { city: place }, section: aeo.section, faqs: aeo.faqs, ssr: aeo.ssr
  }));
}

/**
 * The answer box for one hotel: facts and the questions travellers (and answer
 * engines) ask, written only from data we actually hold. property.html's
 * script replaces #content, so the server copy inside #content is what
 * crawlers without JavaScript read; the section after it stays for everyone.
 */
function propertyAnswers(p, { place, reviews, minPrice }) {
  const E = kit.esc;
  const type = p.property_type ? p.property_type.toLowerCase() : 'property';
  // Only call it a Google rating when we hold the Google review count with it.
  const rating = p.rating && p.google_review_count ? `${p.rating}/5 from ${plural(p.google_review_count, 'Google review')}`
    : (p.rating ? `${p.rating}/5` : '');
  const cityUrl = `city.html?city=${encodeURIComponent(p.city_slug || '')}`;
  const deals = liveDeals('AND p.id = ?', [p.id]);
  const faqs = [];
  faqs.push({ q: `Where is ${p.name} located?`, a: p.address
    ? `${p.name} is at ${p.address}${p.pincode && !String(p.address).includes(p.pincode) ? ' – ' + p.pincode : ''}` +
      (String(p.address).toLowerCase().includes(place.toLowerCase()) ? '.' : `, in ${place}.`)
    : `${p.name} is in ${place}, India.` });
  if (rating) faqs.push({ q: `How is ${p.name} rated?`, a: `${p.name} is rated ${rating}${reviews.c ? `, and ${plural(reviews.c, 'guest review')} on Hotelzz average ${reviews.avg}/5` : ''}.` });
  if (minPrice) faqs.push({ q: `How much does ${p.name} cost per night?`, a: `Rooms at ${p.name} start from ${rupees(minPrice)} per night. Ask the property on WhatsApp for the exact price on your dates.` });
  faqs.push({ q: `How do I book ${p.name}?`, a: `Tap "Book on WhatsApp"${p.phone ? ' or call ' + p.phone : ''} on this page. You talk to ${p.name} directly to confirm dates and price — Hotelzz charges no booking fee.` });
  if (deals.length) faqs.push({ q: `Does ${p.name} have any offers right now?`, a: `Yes: ${deals.map((d) => d.title + (d.discount ? ' (' + d.discount + ')' : '')).join('; ')}. Unlock the code on the Hotelzz Deals page.` });
  faqs.push({ q: `Is ${p.name} verified by its owner?`, a: p.claim_status === 'verified'
    ? `Yes. The owner of ${p.name} has claimed and verified this listing on Hotelzz, so the details are kept up to date by the property.`
    : `Not yet. The details come from public sources. If you own ${p.name}, you can claim this listing on Hotelzz for free.` });

  const nearby = db.prepare(
    'SELECT id, name, rating FROM properties WHERE active = 1 AND city_slug = ? AND id <> ? ORDER BY rating DESC, google_review_count DESC LIMIT 8'
  ).all(p.city_slug || '', p.id);

  const facts = [
    ['Type', p.property_type || 'Stay'], ['Location', place],
    rating ? [p.google_review_count ? 'Google rating' : 'Rating', rating] : null,
    minPrice ? ['Price from', rupees(minPrice) + ' / night'] : null,
    p.phone ? ['Phone', p.phone] : null,
    ['Booking fee', '₹0 — book direct']
  ].filter(Boolean);

  const lead = `${p.name} is a ${type} in ${place}${rating ? ', rated ' + rating : ''}.` +
    (p.google_summary ? ' ' + String(p.google_summary).trim() : '') +
    ` Book it directly with the property on WhatsApp${p.phone ? ' or phone' : ''} — Hotelzz charges no booking fee.`;

  const ssr = `<div class="aeo-ssr" style="max-width:1100px;margin:0 auto;padding:28px 20px"><nav style="font-size:13px;color:#64748B"><a href="/">Home</a> › <a href="${cityUrl}">Hotels in ${E(place)}</a></nav>` +
    `<h1 style="font-size:28px;margin:10px 0 8px">${E(p.name)}</h1><p style="color:#334155;line-height:1.6;max-width:820px">${E(lead)}</p></div>`;

  const section = `<section class="aeo" id="answers" aria-labelledby="aeo-h"><div class="aeo-in">
<h2 id="aeo-h">${E(p.name)} at a glance</h2>
<p class="aeo-lead">${E(lead)}</p>
<dl class="aeo-facts">${facts.map((f) => `<div><dt>${E(f[0])}</dt><dd>${E(f[1])}</dd></div>`).join('')}</dl>
<h3>Questions about ${E(p.name)}</h3>
${kit.faqHtml(faqs)}<!--aeo-extra-->
${nearby.length ? `<h3>More stays in ${E(place)}</h3><ul class="aeo-links">${nearby.map((n) => `<li><a href="property.html?id=${encodeURIComponent(n.id)}">${E(n.name)}${n.rating ? ' · ★ ' + n.rating : ''}</a></li>`).join('')}<li><a href="${cityUrl}">All hotels in ${E(place)} →</a></li></ul>` : ''}
<p class="aeo-upd">Information last checked ${today()}.</p>
</div></section>`;
  return { section, faqs, ssr };
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
  const aeo = cityAnswers(slug, all, place, count);
  res.type('html').send(render('city.html', {
    title, description, url, jsonld: [list, crumbs],
    key: '/city.html?city=' + slug, vars: { city: place }, section: aeo.section, faqs: aeo.faqs
  }));
}

/** The answer box for a destination: a direct summary, top stays and FAQs from live data. */
function cityAnswers(slug, all, place, count) {
  const E = kit.esc;
  const scope = all ? '' : 'AND city_slug = ?';
  const args = all ? [] : [slug];
  const stats = db.prepare(
    `SELECT ROUND(AVG(NULLIF(rating,0)),1) avg, SUM(google_review_count) reviews,
            SUM(CASE WHEN rating >= 4.5 THEN 1 ELSE 0 END) excellent,
            SUM(CASE WHEN claim_status = 'verified' THEN 1 ELSE 0 END) verified
       FROM properties WHERE active = 1 ${scope}`).get(...args);
  const types = db.prepare(
    `SELECT property_type t, COUNT(*) c FROM properties WHERE active = 1 ${scope}
       AND property_type IS NOT NULL AND property_type <> '' GROUP BY property_type ORDER BY c DESC LIMIT 4`).all(...args);
  const price = db.prepare(
    `SELECT MIN(r.price) lo, ROUND(AVG(r.price)) avg FROM rooms r JOIN properties p ON p.id = r.property_id
      WHERE r.active = 1 AND r.price > 0 AND p.active = 1 ${all ? '' : 'AND p.city_slug = ?'}`).get(...args);
  const deals = liveDeals(all ? '' : 'AND p.city_slug = ?', args);
  // Rating weighted by review count, so a 5.0 from two reviews doesn't top the list.
  const top = db.prepare(
    `SELECT id, name, rating, google_review_count rc FROM properties WHERE active = 1 ${scope}
      ORDER BY (rating * (1 - 1.0 / (1 + google_review_count / 20.0))) DESC, rating DESC LIMIT 10`).all(...args);
  const typeText = types.length ? listWords(types.map((t) => `${fmt(t.c)} ${t.c === 1 ? String(t.t).toLowerCase() : typeWord(t.t)}`)) : '';

  const lead = all
    ? `Hotelzz lists ${fmt(count)} hotels, villas, cottages and homestays across India` +
      (stats.avg ? `, with an average rating of ${stats.avg}/5` : '') + '. ' +
      'Pick a destination, compare stays by rating and type, and book directly with the property on WhatsApp — no booking fee.'
    : `There ${count === 1 ? 'is 1 place' : 'are ' + fmt(count) + ' places'} to stay in ${place} on Hotelzz` + (typeText ? `: ${typeText}` : '') + '. ' +
      (stats.avg ? `${count === 1 ? 'It is rated' : 'They average'} ${stats.avg}/5${stats.reviews ? ' across ' + plural(stats.reviews, 'Google review') : ''}` +
        (stats.excellent && count > 1 ? `, and ${fmt(stats.excellent)} ${stats.excellent === 1 ? 'is' : 'are'} rated 4.5 or higher` : '') + '. ' : '') +
      'You book directly with the property on WhatsApp or phone, and Hotelzz charges no booking fee.';

  const faqs = [];
  if (all) {
    const cities = db.prepare(
      `SELECT MAX(location) n, COUNT(*) c FROM properties WHERE active = 1 AND city_slug IS NOT NULL AND city_slug <> ''
        GROUP BY city_slug ORDER BY c DESC LIMIT 8`).all();
    faqs.push({ q: 'Which destinations does Hotelzz cover?', a: `Hotelzz covers destinations including ${listWords(cities.map((c) => titleCase(c.n)))}, with ${fmt(count)} stays in total.` });
  } else {
    faqs.push({ q: `How many hotels are there in ${place}?`, a: `Hotelzz lists ${plural(count, 'stay')} in ${place}${typeText ? ' — ' + typeText : ''}.` });
  }
  if (top.length >= 3) {
    faqs.push({ q: `What are the best-rated hotels in ${place}?`, a: `Top-rated: ${top.slice(0, 3).map((h) => `${h.name} (${h.rating}/5${h.rc ? ', ' + fmt(h.rc) + ' reviews' : ''})`).join('; ')}.` });
  }
  if (types.length) faqs.push({ q: `What kind of stays are available in ${place}?`, a: `You can choose from ${typeText}.` });
  if (price && price.lo) faqs.push({ q: `How much does a hotel in ${place} cost per night?`, a: `Rooms listed on Hotelzz in ${place} start from ${rupees(price.lo)} a night, averaging about ${rupees(price.avg)}. Prices change by season, so confirm with the property.` });
  faqs.push({ q: `How do I book a hotel in ${place} on Hotelzz?`, a: 'Open a property and tap "Book on WhatsApp" or call it. You agree dates and price with the hotel directly; there is no booking fee and no middleman.' });
  if (deals.length) faqs.push({ q: `Are there hotel deals in ${place} right now?`, a: `Yes — for example ${listWords(deals.slice(0, 3).map((d) => `${d.title}${d.discount ? ' (' + d.discount + ')' : ''} at ${d.hotel}`))}. See all offers on the Hotelzz Deals page.` });
  if (stats.verified) faqs.push({ q: `Are the ${place} listings verified?`, a: `${fmt(stats.verified)} ${stats.verified === 1 ? 'property has' : 'properties have'} been claimed and verified by the owner, who keeps the details up to date.` });

  const section = `<section class="aeo" id="answers" aria-labelledby="aeo-h"><div class="aeo-in">
<h2 id="aeo-h">${all ? 'Hotels in India' : 'Hotels in ' + E(place)}: quick answers</h2>
<p class="aeo-lead">${E(lead)}</p>
${top.length ? `<h3>Top-rated stays${all ? '' : ' in ' + E(place)}</h3><ol class="aeo-top">${top.map((h) => `<li><a href="property.html?id=${encodeURIComponent(h.id)}">${E(h.name)}</a><span>★ ${h.rating}${h.rc ? ' · ' + fmt(h.rc) : ''}</span></li>`).join('')}</ol>` : ''}
<h3>Frequently asked</h3>
${kit.faqHtml(faqs)}<!--aeo-extra-->
<p class="aeo-upd">Updated ${today()} from live listings.</p>
</div></section>`;
  return { section, faqs };
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
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(kit.robotsTxt());
}

function llms(_req, res) {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/plain; charset=utf-8').send(kit.llmsTxt());
}

// Private and utility pages: never in search results, whatever links to them.
const NOINDEX = /^\/(admin|admin-login|owner|user-portal|login|dashboard-login|reset-password|404)(\.html)?$|^\/api\//;
function noindexPrivate(req, res, next) {
  if (NOINDEX.test(req.path)) res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
}

function invalidate() { sitemapCache = null; kit.invalidate(); }
const sitemapCount = () => (sitemapCache ? sitemapCache.count : null);

module.exports = { propertyPage, cityPage, sitemap, robots, llms, noindexPrivate, invalidate, sitemapCount };
