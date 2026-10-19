'use strict';
/**
 * Admin → Site Kit API: connections, SEO/AEO settings, live site audit,
 * listing content quality, IndexNow and Google Search Console / GA4 data.
 */
const express = require('express');
const { z } = require('zod');
const env = require('../lib/env');
const { db, audit } = require('../lib/db');
const A = require('../lib/auth');
const { validate, wrap } = require('../lib/http');
const kit = require('../lib/sitekit');
const seo = require('../lib/seo');
const google = require('../lib/google');

const router = express.Router();
router.use(A.requireAuth('admin'));

const SITE = kit.SITE;

/* ------------------------------------------------------------ overview */

function connections(s) {
  const g = google.status();
  return {
    ga4: { on: /^G-[A-Z0-9]{4,15}$/.test(s.ga4Id), value: s.ga4Id },
    gtm: { on: /^GTM-[A-Z0-9]{4,12}$/.test(s.gtmId), value: s.gtmId },
    metaPixel: { on: /^\d{5,20}$/.test(s.metaPixelId), value: s.metaPixelId },
    searchConsole: { on: !!s.gscVerification || g.configured, verification: !!s.gscVerification, api: g.configured },
    bing: { on: !!s.bingVerification },
    indexNow: { on: true, key: s.indexNowKey, auto: s.autoIndexNow, last: s.lastIndexNowAt, result: s.lastIndexNowResult },
    serviceAccount: g,
    ga4Data: { on: g.configured && /^\d{5,15}$/.test(s.ga4PropertyId || ''), propertyId: s.ga4PropertyId }
  };
}

router.get('/', (_req, res) => {
  const s = kit.load();
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const totals = one(`SELECT COUNT(*) total, SUM(active) active, COUNT(DISTINCT CASE WHEN active = 1 THEN city_slug END) cities FROM properties`);
  const reviews = one("SELECT COUNT(*) c FROM reviews WHERE status = 'Published'").c;
  const views = one("SELECT COALESCE(SUM(views),0) v, COALESCE(SUM(whatsapp_clicks + phone_clicks),0) leads FROM property_stats WHERE day >= date('now','-28 day')");
  const topViewed = db.prepare(
    `SELECT p.id, p.name, p.location, SUM(s.views) views, SUM(s.whatsapp_clicks + s.phone_clicks) leads
       FROM property_stats s JOIN properties p ON p.id = s.property_id
      WHERE s.day >= date('now','-28 day') GROUP BY p.id ORDER BY views DESC LIMIT 10`).all();
  res.json({
    ok: true,
    settings: s,
    crawlers: kit.AI_CRAWLERS,
    connections: connections(s),
    stats: {
      listings: totals.active || 0, inactive: (totals.total || 0) - (totals.active || 0), cities: totals.cities || 0,
      indexablePages: kit.PUBLIC_PAGES.length + 1 + (totals.cities || 0) + (totals.active || 0),
      sitemapUrls: seo.sitemapCount(), reviews, aeoAnswers: (s.faqs || []).length,
      redirects: (s.redirects || []).length, overrides: Object.keys(s.pages || {}).length,
      views28: views.v, leads28: views.leads
    },
    topViewed,
    links: {
      sitemap: SITE + '/sitemap.xml', robots: SITE + '/robots.txt', llms: SITE + '/llms.txt',
      indexNowKey: `${SITE}/${s.indexNowKey}.txt`,
      searchConsole: 'https://search.google.com/search-console?resource_id=' + encodeURIComponent(s.gscSiteUrl || 'sc-domain:hotelzz.in'),
      analytics: 'https://analytics.google.com/analytics/web/',
      bing: 'https://www.bing.com/webmasters/home?siteUrl=' + encodeURIComponent(SITE + '/'),
      pageSpeed: 'https://pagespeed.web.dev/analysis?url=' + encodeURIComponent(SITE + '/'),
      richResults: 'https://search.google.com/test/rich-results?url=' + encodeURIComponent(SITE + '/')
    },
    env: { production: env.isProd }
  });
});

/* ------------------------------------------------------------ settings */

const id = (re, msg) => z.string().trim().max(40).refine((v) => !v || re.test(v), msg).optional();
const token = z.string().trim().max(120).refine((v) => !v || /^[A-Za-z0-9_\-.=+/]{6,120}$/.test(v), 'That verification code has characters it should not have. Paste only the content="…" value.').optional();
const pagePath = z.string().trim().max(200).regex(/^\/[A-Za-z0-9_\-./?=&%]*$/, 'Page paths start with / (e.g. /deals.html or /city.html?city=goa)');

const settingsSchema = z.object({
  ga4Id: id(/^G-[A-Z0-9]{4,15}$/, 'GA4 measurement id looks like G-XXXXXXXXXX'),
  gtmId: id(/^GTM-[A-Z0-9]{4,12}$/, 'Tag Manager id looks like GTM-XXXXXXX'),
  metaPixelId: id(/^\d{5,20}$/, 'Meta Pixel id is a number'),
  gscVerification: token, bingVerification: token, yandexVerification: token,
  pinterestVerification: token, facebookDomainVerification: token,
  gscSiteUrl: z.string().trim().max(120).refine((v) => !v || /^(sc-domain:[a-z0-9.-]+|https:\/\/[^\s]+\/)$/.test(v), 'Use sc-domain:hotelzz.in or https://hotelzz.in/').optional(),
  ga4PropertyId: id(/^\d{5,15}$/, 'GA4 property id is the number in GA4 → Admin → Property details'),
  autoIndexNow: z.boolean().optional(),
  defaultImage: z.string().trim().url().max(300).optional(),
  org: z.object({
    name: z.string().trim().min(2).max(80), legalName: z.string().trim().max(120).optional().default(''),
    logo: z.string().trim().url().max(300).or(z.literal('')), email: z.string().trim().email().or(z.literal('')),
    phone: z.string().trim().max(30), city: z.string().trim().max(60), region: z.string().trim().max(60),
    description: z.string().trim().max(400), sameAs: z.array(z.string().trim().url().max(300)).max(15)
  }).optional(),
  aiCrawlers: z.record(z.string(), z.boolean()).optional(),
  pages: z.record(pagePath, z.object({
    title: z.string().trim().max(70).optional().default(''),
    description: z.string().trim().max(170).optional().default(''),
    noindex: z.boolean().optional().default(false)
  })).optional(),
  faqs: z.array(z.object({
    page: pagePath, q: z.string().trim().min(5, 'Each question needs at least 5 characters').max(200),
    a: z.string().trim().min(10, 'Each answer needs at least 10 characters').max(1200)
  })).max(200).optional(),
  redirects: z.array(z.object({
    from: z.string().trim().max(200).regex(/^\/[A-Za-z0-9_\-./%]*$/, 'Redirect "from" is a path like /old-page.html (no ?query)')
      // Sign-in pages, panels, the API and the SEO files must always answer.
      .refine((v) => v !== '/' && !/^\/(api|admin|owner|uploads|\.well-known|login|dashboard-login|reset-password|user-portal)([/.\-]|$)/.test(v) &&
        !/^\/(robots\.txt|sitemap\.xml|llms\.txt|index\.html)$/.test(v), 'That path cannot be redirected'),
    to: z.string().trim().max(300).refine((v) => /^\/[^\s]*$/.test(v) || /^https:\/\/[^\s]+$/.test(v), 'Redirect "to" is a /path or an https:// URL')
  })).max(300).optional()
});

/**
 * One spelling per page, the same one the page lookup uses: "/deals" →
 * "/deals.html", "/city.html?city=Pune" → "/city.html?city=pune"; other query
 * strings are dropped (static pages ignore them).
 */
function normPageKey(raw) {
  const [path, query = ''] = String(raw).split('?');
  if (path === '/city') return '/city';
  const key = kit.pageKey(path);
  const params = new URLSearchParams(query);
  if (key === '/city.html' && params.get('city')) return key + '?city=' + params.get('city').toLowerCase();
  if (key === '/property.html' && params.get('id')) return key + '?id=' + params.get('id');
  return key;
}

router.put('/', validate(settingsSchema), (req, res) => {
  const b = req.body;
  if (b.pages) b.pages = Object.fromEntries(Object.entries(b.pages).map(([k, v]) => [normPageKey(k), v]));
  if (b.faqs) b.faqs = b.faqs.map((f) => Object.assign({}, f, { page: normPageKey(f.page) }));
  if (b.redirects) {
    const froms = new Set();
    for (const r of b.redirects) {
      if (froms.has(r.from)) return res.status(400).json({ ok: false, error: `"${r.from}" is redirected twice.` });
      if (r.from === r.to) return res.status(400).json({ ok: false, error: `"${r.from}" redirects to itself.` });
      froms.add(r.from);
    }
    if (b.redirects.some((r) => froms.has(r.to.split('?')[0]))) {
      return res.status(400).json({ ok: false, error: 'A redirect points at another redirected path — point it at the final page instead.' });
    }
  }
  if (b.pages) {
    // Empty rows are deletions.
    Object.keys(b.pages).forEach((k) => { const p = b.pages[k]; if (!p.title && !p.description && !p.noindex) delete b.pages[k]; });
  }
  if (b.aiCrawlers) {
    const known = new Set(kit.AI_CRAWLERS.map((c) => c.id));
    Object.keys(b.aiCrawlers).forEach((k) => { if (!known.has(k)) delete b.aiCrawlers[k]; });
  }
  const s = kit.save(b, req.user.id);
  seo.invalidate();
  audit(req.user.id, 'admin.sitekit.update', 'settings', 'sitekit', { fields: Object.keys(b) }, req.ip);
  res.json({ ok: true, settings: s, connections: connections(s) });
});

/* --------------------------------------------------------------- audit */

const SELF = () => `http://127.0.0.1:${env.PORT}`;

function inspect(html) {
  const get = (re) => { const m = html.match(re); return m ? m[1].trim() : ''; };
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const title = decode(get(/<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = decode(get(/<meta\s+name="description"[^>]*content="([^"]*)"/i));
  const canonical = get(/<link\s+rel="canonical"\s+href="([^"]*)"/i);
  const robots = get(/<meta\s+name="robots"\s+content="([^"]*)"/i);
  // Count what a crawler sees in the markup, not HTML strings inside scripts.
  const markup = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const h1 = (markup.match(/<h1[\s>]/gi) || []).length;
  const types = []; let ldErrors = 0;
  (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []).forEach((blk) => {
    try {
      const j = JSON.parse(blk.replace(/^<script[^>]*>|<\/script>$/gi, ''));
      (j['@graph'] || [j]).forEach((n) => types.push(n['@type']));
    } catch (_) { ldErrors++; }
  });
  const body = html.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const words = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
  const imgs = body.match(/<img\b[^>]*>/gi) || [];
  const noAlt = imgs.filter((t) => !/\balt="[^"]+"/i.test(t)).length;
  return { title, description, canonical, robots, h1, types, ldErrors, words, images: imgs.length, noAlt,
           ogImage: /<meta\s+property="og:image"/i.test(html), ogTitle: /<meta\s+property="og:title"/i.test(html),
           ga: /googletagmanager\.com\/(gtag|gtm)/.test(html) };
}

function grade(page, info, status, ms) {
  const checks = [];
  const add = (name, level, detail) => checks.push({ name, level, detail });
  add('Responds', status === 200 ? 'pass' : 'fail', 'HTTP ' + status + ' in ' + ms + ' ms');
  const tl = info.title.length;
  add('Title', !tl ? 'fail' : tl < 20 || tl > 65 ? 'warn' : 'pass', tl ? `${tl} characters: "${info.title}"` : 'missing');
  const dl = info.description.length;
  add('Meta description', !dl ? 'fail' : dl < 70 || dl > 165 ? 'warn' : 'pass', dl ? dl + ' characters' : 'missing');
  add('Canonical URL', info.canonical ? 'pass' : 'warn', info.canonical || 'missing');
  add('One H1', info.h1 === 1 ? 'pass' : 'warn', info.h1 + ' found');
  add('Indexable', /noindex/i.test(info.robots) ? 'fail' : 'pass', info.robots || 'index, follow');
  add('Structured data', info.ldErrors ? 'fail' : info.types.length ? 'pass' : 'warn',
      info.ldErrors ? info.ldErrors + ' invalid JSON-LD block(s)' : (info.types.join(', ') || 'none'));
  if (/^\/(privacy|terms)\.html$/.test(page)) add('AEO answers (FAQPage)', 'pass', 'not needed on legal pages');
  else add('AEO answers (FAQPage)', info.types.includes('FAQPage') ? 'pass' : 'warn', info.types.includes('FAQPage') ? 'present' : 'no question/answer markup — add some in AEO answers');
  add('Social preview', info.ogImage && info.ogTitle ? 'pass' : 'warn', (info.ogTitle ? 'og:title ✓ ' : 'og:title ✗ ') + (info.ogImage ? 'og:image ✓' : 'og:image ✗'));
  add('Image alt text', info.noAlt ? 'warn' : 'pass', info.images ? `${info.images - info.noAlt}/${info.images} images have alt text` : 'no images in HTML');
  add('Content in HTML', info.words >= 150 ? 'pass' : 'warn', info.words + ' words readable without JavaScript');
  add('Analytics', info.ga ? 'pass' : 'warn', info.ga ? 'tag present' : 'no Google tag');
  const score = Math.round(100 * checks.reduce((n, c) => n + (c.level === 'pass' ? 1 : c.level === 'warn' ? 0.5 : 0), 0) / checks.length);
  return { page, score, checks };
}

async function fetchPage(p) {
  const t0 = Date.now();
  const r = await fetch(SELF() + p, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'HotelzzSiteKit/1.0' } });
  const text = await r.text();
  return { status: r.status, text, ms: Date.now() - t0 };
}

router.get('/audit', wrap(async (_req, res) => {
  const cities = db.prepare(
    `SELECT city_slug c FROM properties WHERE active = 1 AND city_slug IS NOT NULL AND city_slug <> ''
      GROUP BY city_slug ORDER BY COUNT(*) DESC LIMIT 3`).all().map((r) => '/city.html?city=' + encodeURIComponent(r.c));
  const props = db.prepare('SELECT id FROM properties WHERE active = 1 ORDER BY google_review_count DESC LIMIT 2').all()
    .map((r) => '/property.html?id=' + encodeURIComponent(r.id));
  const pages = ['/', '/deals.html', '/ota-listing.html', '/marketing.html', '/claim.html', '/city.html?city=all']
    .concat(cities, props, ['/privacy.html', '/terms.html']);

  const results = [];
  for (const p of pages) {
    try {
      const r = await fetchPage(p);
      results.push(grade(p, inspect(r.text), r.status, r.ms));
    } catch (e) {
      results.push({ page: p, score: 0, checks: [{ name: 'Responds', level: 'fail', detail: e.message }] });
    }
  }

  const site = [];
  const siteCheck = async (name, p, test) => {
    try {
      const r = await fetchPage(p);
      const v = r.status === 200 ? test(r.text) : { level: 'fail', detail: 'HTTP ' + r.status };
      site.push(Object.assign({ name, url: SITE + p }, v));
    } catch (e) { site.push({ name, url: SITE + p, level: 'fail', detail: e.message }); }
  };
  const s = kit.load();
  await siteCheck('robots.txt', '/robots.txt', (t) => /Sitemap:/i.test(t)
    ? { level: 'pass', detail: 'Lists the sitemap; ' + kit.AI_CRAWLERS.filter((c) => s.aiCrawlers[c.id] !== false).length + ' AI crawlers allowed' }
    : { level: 'warn', detail: 'No Sitemap: line' });
  await siteCheck('sitemap.xml', '/sitemap.xml', (t) => {
    const n = (t.match(/<loc>/g) || []).length;
    return n ? { level: n > 50000 ? 'warn' : 'pass', detail: n.toLocaleString('en-IN') + ' URLs' + (n > 50000 ? ' (over 50,000 — split needed)' : '') } : { level: 'fail', detail: 'empty' };
  });
  await siteCheck('llms.txt (AI summary)', '/llms.txt', (t) => ({ level: t.length > 200 ? 'pass' : 'warn', detail: Math.round(t.length / 1024) + ' KB, ' + (t.match(/^- \[/gm) || []).length + ' links' }));
  await siteCheck('IndexNow key file', '/' + s.indexNowKey + '.txt', (t) => ({ level: t.trim() === s.indexNowKey ? 'pass' : 'fail', detail: t.trim() === s.indexNowKey ? 'Reachable' : 'Wrong content' }));
  site.push({ name: 'Search Console', level: s.gscVerification || google.status().configured ? 'pass' : 'warn',
              detail: s.gscVerification ? 'Verification tag on every page' : google.status().configured ? 'Connected through service account' : 'Not verified yet — add the HTML tag code in Connections' });
  site.push({ name: 'Bing Webmaster Tools', level: s.bingVerification ? 'pass' : 'warn', detail: s.bingVerification ? 'Verification tag on every page' : 'Not verified — Bing also powers Copilot and ChatGPT search' });
  site.push({ name: 'HTTPS + HSTS', level: env.isProd ? 'pass' : 'warn', detail: env.isProd ? 'Strict-Transport-Security sent' : 'Development server (live site sends HSTS)' });

  const score = Math.round(results.reduce((n, r) => n + r.score, 0) / Math.max(1, results.length));
  const ranAt = new Date().toISOString();
  kit.save({ lastAudit: { score, ranAt, pages: results.length } }, null);
  res.json({ ok: true, score, pages: results, site, ranAt });
}));

/* -------------------------------------------------------------- content */

const ISSUES = {
  'no-photo': { label: 'No photo', hint: 'Listings without a photo get far fewer clicks from search and social previews.',
    where: "NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.property_id = p.id) AND (p.image_url IS NULL OR p.image_url = '')" },
  'no-summary': { label: 'No description', hint: 'A 1–2 sentence description is what answer engines quote.',
    where: "(p.google_summary IS NULL OR TRIM(p.google_summary) = '')" },
  'no-type': { label: 'No property type', hint: 'Type (Hotel, Resort, Homestay…) feeds the "what kind of stays" answers.',
    where: "(p.property_type IS NULL OR p.property_type = '')" },
  'no-phone': { label: 'No phone', hint: 'Phone is part of LocalBusiness markup and lets travellers call.',
    where: "(p.phone IS NULL OR p.phone = '')" },
  'no-address': { label: 'No address', hint: 'Address powers "where is…" answers and map results.',
    where: "(p.address IS NULL OR p.address = '')" },
  'no-city': { label: 'No city', hint: 'Without a city the listing is missing from every city page and the sitemap groups.',
    where: "(p.city_slug IS NULL OR p.city_slug = '')" },
  'duplicate': { label: 'Duplicate name in city', hint: 'Two listings with the same name in one city compete with each other in search.',
    where: 'EXISTS (SELECT 1 FROM properties d WHERE d.active = 1 AND d.id <> p.id AND d.city_slug = p.city_slug AND LOWER(TRIM(d.name)) = LOWER(TRIM(p.name)))' }
};

router.get('/content', (req, res) => {
  const counts = Object.entries(ISSUES).map(([key, v]) => ({
    key, label: v.label, hint: v.hint, count: db.prepare(`SELECT COUNT(*) c FROM properties p WHERE p.active = 1 AND ${v.where}`).get().c
  }));
  const issue = Object.prototype.hasOwnProperty.call(ISSUES, req.query.issue) ? req.query.issue : null;
  const rows = issue ? db.prepare(
    `SELECT p.id, p.name, p.location, p.property_type, p.phone, p.claim_status, p.rating, p.google_review_count
       FROM properties p WHERE p.active = 1 AND ${ISSUES[issue].where}
      ORDER BY p.google_review_count DESC, p.name LIMIT 100`).all() : [];
  const total = db.prepare('SELECT COUNT(*) c FROM properties WHERE active = 1').get().c;
  const cities = db.prepare(
    `SELECT city_slug slug, MAX(location) name, COUNT(*) listings,
            SUM(CASE WHEN google_summary IS NOT NULL AND TRIM(google_summary) <> '' THEN 1 ELSE 0 END) described,
            SUM(CASE WHEN claim_status = 'verified' THEN 1 ELSE 0 END) verified, ROUND(AVG(rating),1) rating
       FROM properties WHERE active = 1 AND city_slug IS NOT NULL AND city_slug <> ''
      GROUP BY city_slug ORDER BY listings DESC`).all();
  res.json({ ok: true, total, counts, issue, rows, cities });
});

/* ------------------------------------------------------------- IndexNow */

router.post('/indexnow', validate(z.object({
  scope: z.enum(['changed', 'key', 'urls']),
  urls: z.array(z.string().trim().max(500).refine((u) => u.startsWith(SITE + '/'), 'Only hotelzz.in addresses can be submitted')).max(500).optional()
})), wrap(async (req, res) => {
  const s = kit.load();
  const urls = req.body.scope === 'changed' ? kit.changedUrls(s.lastIndexNowAt)
    : req.body.scope === 'key' ? kit.keyUrls() : (req.body.urls || []);
  const result = await kit.indexNow(urls, req.user.id);
  audit(req.user.id, 'admin.sitekit.indexnow', 'settings', 'sitekit', { scope: req.body.scope, submitted: result.submitted }, req.ip);
  res.status(result.ok ? 200 : 502).json(Object.assign({ candidates: urls.length }, result));
}));

router.post('/refresh', (req, res) => {
  seo.invalidate();
  audit(req.user.id, 'admin.sitekit.refresh', 'settings', 'sitekit', null, req.ip);
  res.json({ ok: true });
});

/* -------------------------------------------------------------- Google */

let googleCache = null;
router.get('/google', wrap(async (req, res) => {
  const s = kit.load();
  const days = [7, 28, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 28;
  const st = google.status();
  if (!st.configured) return res.json({ ok: true, configured: false, status: st });
  const cacheKey = days + '|' + s.gscSiteUrl + '|' + s.ga4PropertyId;
  if (req.query.fresh !== '1' && googleCache && googleCache.key === cacheKey && Date.now() - googleCache.at < 3 * 60 * 60 * 1000) {
    return res.json(googleCache.body);
  }
  const out = { ok: true, configured: true, status: st, days, fetchedAt: new Date().toISOString() };
  await Promise.all([
    google.searchConsole(s.gscSiteUrl, days).then((d) => { out.search = d; }).catch((e) => { out.searchError = e.message; }),
    google.sitemaps(s.gscSiteUrl).then((d) => { out.sitemaps = d; }).catch(() => {}),
    /^\d{5,15}$/.test(s.ga4PropertyId || '')
      ? google.analytics(s.ga4PropertyId, days).then((d) => { out.analytics = d; }).catch((e) => { out.analyticsError = e.message; })
      : Promise.resolve((out.analyticsError = 'Add the GA4 property id in Connections to see traffic here.'))
  ]);
  // Only good answers are cached, so fixing a permission shows up on the next load.
  googleCache = out.searchError || (out.analyticsError && /^\d/.test(s.ga4PropertyId || '')) ? null : { key: cacheKey, at: Date.now(), body: out };
  res.json(out);
}));

router.post('/google/sitemap', wrap(async (req, res) => {
  const s = kit.load();
  if (!google.status().configured) return res.status(400).json({ ok: false, error: 'Connect the Google service account first (see Connections).' });
  await google.submitSitemap(s.gscSiteUrl, SITE + '/sitemap.xml');
  googleCache = null;
  audit(req.user.id, 'admin.sitekit.sitemap.submit', 'settings', 'sitekit', null, req.ip);
  res.json({ ok: true });
}));

module.exports = router;
