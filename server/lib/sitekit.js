'use strict';
/**
 * Site Kit — the admin-controlled layer of SEO / AEO for every public page.
 *
 * One JSON document in the settings table (key "sitekit") holds:
 *   - connections: GA4 / GTM / Meta Pixel ids and the verification tokens for
 *     Google Search Console, Bing, Yandex, Pinterest and Facebook
 *   - IndexNow key (instant indexing on Bing, Yandex, Seznam, Naver…)
 *   - organisation details used in schema.org (Organization / WebSite)
 *   - per-page title / description / noindex overrides
 *   - "AEO answers": question + answer pairs shown on a page and marked up as
 *     FAQPage, so search and answer engines (Google AI Overviews, ChatGPT,
 *     Perplexity, Claude, Gemini) can quote them
 *   - 301 redirects and which AI crawlers robots.txt lets in
 *
 * decorate(html, path) applies all of it to an HTML page on the way out, so
 * the static files never need editing to change a tracking id or a title.
 */
const fs = require('fs');
const path = require('path');
const env = require('./env');
const { db } = require('./db');

const ROOT = path.resolve(__dirname, '..', '..');
const SITE = 'https://hotelzz.in';
const KEY = 'sitekit';

// AI / answer-engine crawlers. Allowed by default: being quotable by answer
// engines is the point of AEO. Each can be switched off in Admin → Site Kit.
const AI_CRAWLERS = [
  { id: 'GPTBot', owner: 'OpenAI', use: 'ChatGPT training' },
  { id: 'OAI-SearchBot', owner: 'OpenAI', use: 'ChatGPT search answers' },
  { id: 'ChatGPT-User', owner: 'OpenAI', use: 'ChatGPT browsing on a user\'s request' },
  { id: 'ClaudeBot', owner: 'Anthropic', use: 'Claude training' },
  { id: 'Claude-SearchBot', owner: 'Anthropic', use: 'Claude search answers' },
  { id: 'Claude-User', owner: 'Anthropic', use: 'Claude browsing on a user\'s request' },
  { id: 'PerplexityBot', owner: 'Perplexity', use: 'Perplexity answers' },
  { id: 'Google-Extended', owner: 'Google', use: 'Gemini / AI Overviews grounding' },
  { id: 'Applebot-Extended', owner: 'Apple', use: 'Apple Intelligence' },
  { id: 'Bingbot', owner: 'Microsoft', use: 'Bing + Copilot answers' },
  { id: 'CCBot', owner: 'Common Crawl', use: 'Open web dataset used by many AI models' },
  { id: 'Bytespider', owner: 'ByteDance', use: 'AI training (aggressive crawler)' }
];

const DEFAULTS = {
  ga4Id: 'G-S3XDVMFR2D',
  gtmId: '',
  metaPixelId: '',
  gscVerification: '',
  bingVerification: '',
  yandexVerification: '',
  pinterestVerification: '',
  facebookDomainVerification: '',
  gscSiteUrl: 'sc-domain:hotelzz.in',
  ga4PropertyId: '',
  indexNowKey: '',
  autoIndexNow: true,
  lastIndexNowAt: '',
  lastIndexNowResult: '',
  org: {
    name: 'Hotelzz.in',
    legalName: '',
    logo: SITE + '/jpg.png',
    email: 'support@hotelzz.in',
    phone: '+91-9930090487',
    city: 'Mumbai',
    region: 'Maharashtra',
    description: "India's hotel marketplace and marketing platform: 3,000+ verified hotels, villas and homestays with direct booking and zero booking fees.",
    sameAs: []
  },
  defaultImage: SITE + '/og-image.jpg',
  aiCrawlers: Object.fromEntries(AI_CRAWLERS.map((c) => [c.id, c.id !== 'Bytespider'])),
  pages: {},
  faqs: [
    { page: '/', q: 'What is Hotelzz.in?', a: 'Hotelzz.in is an Indian hotel marketplace with 3,000+ hand-picked hotels, villas, cottages and homestays across India. Travellers contact and book each property directly on WhatsApp or phone, with zero booking fees.' },
    { page: '/', q: 'Does Hotelzz charge travellers a booking fee?', a: 'No. Booking through Hotelzz is free for travellers. You deal with the hotel directly, so the price you agree is the price you pay.' },
    { page: '/', q: 'How do I book a hotel on Hotelzz?', a: 'Open a city, pick a stay, and tap "Book on WhatsApp" or call the property. The hotel confirms availability and price with you directly.' },
    { page: '/deals.html', q: 'How do Hotelzz hotel deals work?', a: 'Each deal is posted by the hotel itself. Tap "Unlock deal", enter your name and contact, and the coupon code is shown and emailed to you. Quote the code when you book directly with the hotel.' },
    { page: '/deals.html', q: 'Do I pay anything to use a deal?', a: 'No. Deals are free to unlock and there is no booking fee — you pay the hotel the discounted price directly.' },
    { page: '/claim.html', q: 'How do I claim my hotel listing on Hotelzz?', a: 'Search for your property, select it, verify the phone number on the listing, and we email your owner-dashboard login. Claiming is free.' },
    { page: '/claim.html', q: 'What can I change after claiming my listing?', a: 'Photos, description, room prices, amenities, offers and contact details. Guest enquiries come to you directly with no commission.' },
    { page: '/city', q: 'How do I find the best-rated stays in {city}?', a: 'On the {city} page, sort by "Highest rated" and use the rating filter (4.5+ Excellent). The "Top-rated stays" list on the page also ranks them for you.' }
  ],
  redirects: []
};

let cache = null;

// Only what an admin changed is stored; everything else follows DEFAULTS, so
// improved defaults in a later release reach sites that never touched them.
function stored() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY);
    return row && row.value ? JSON.parse(row.value) : {};
  } catch (_) { return {}; }
}

function load() {
  if (cache) return cache;
  const raw = stored();
  if (!raw.indexNowKey) {
    // Generated once and kept: the key file must stay reachable at the same URL.
    raw.indexNowKey = require('crypto').randomBytes(16).toString('hex');
    write(raw, null);
  }
  const merged = Object.assign({}, DEFAULTS, raw);
  merged.org = Object.assign({}, DEFAULTS.org, raw.org || {});
  merged.aiCrawlers = Object.assign({}, DEFAULTS.aiCrawlers, raw.aiCrawlers || {});
  cache = merged;
  return cache;
}

function write(obj, userId) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_by) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by`
  ).run(KEY, JSON.stringify(obj), userId || null);
}

function save(patch, userId) {
  write(Object.assign(stored(), patch), userId);
  cache = null;
  return load();
}

/* ------------------------------------------------------------ helpers */

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ld = (obj) => '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>';
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/** "/index.html" → "/", "/deals" → "/deals.html": one key per page. */
function pageKey(p) {
  let s = String(p || '/').split('?')[0].split('#')[0];
  if (s === '' || s === '/index.html' || s === '/index') return '/';
  if (!/\.[a-z0-9]+$/i.test(s) && s !== '/') s += '.html';
  return s;
}

/* ------------------------------------------------------ head snippets */

function analyticsTags(s) {
  const out = [];
  if (/^GTM-[A-Z0-9]{4,12}$/.test(s.gtmId)) {
    out.push(`<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${s.gtmId}');</script>`);
  }
  if (/^G-[A-Z0-9]{4,15}$/.test(s.ga4Id)) {
    out.push(`<!-- Google tag (gtag.js) - GA4, managed in Admin → Site Kit -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${s.ga4Id}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${s.ga4Id}');
</script>`);
  }
  if (/^\d{5,20}$/.test(s.metaPixelId)) {
    out.push(`<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${s.metaPixelId}');fbq('track','PageView');</script>`);
  }
  return out;
}

const TOKEN = /^[A-Za-z0-9_\-.=+/]{6,120}$/;
function verificationTags(s) {
  const tags = [
    ['google-site-verification', s.gscVerification],
    ['msvalidate.01', s.bingVerification],
    ['yandex-verification', s.yandexVerification],
    ['p:domain_verify', s.pinterestVerification],
    ['facebook-domain-verification', s.facebookDomainVerification]
  ];
  return tags.filter(([, v]) => v && TOKEN.test(v)).map(([n, v]) => `<meta name="${n}" content="${esc(v)}" />`);
}

function orgGraph(s) {
  const o = s.org;
  const org = {
    '@type': 'Organization', '@id': SITE + '/#org', name: o.name, url: SITE + '/', logo: o.logo || undefined,
    email: o.email || undefined, telephone: o.phone || undefined, description: o.description || undefined,
    legalName: o.legalName || undefined,
    address: { '@type': 'PostalAddress', addressLocality: o.city || undefined, addressRegion: o.region || undefined, addressCountry: 'IN' },
    contactPoint: o.phone ? { '@type': 'ContactPoint', telephone: o.phone, contactType: 'customer support', areaServed: 'IN', availableLanguage: ['en', 'hi'] } : undefined,
    sameAs: (o.sameAs || []).filter((u) => /^https:\/\//.test(u))
  };
  if (!org.sameAs.length) delete org.sameAs;
  return {
    '@context': 'https://schema.org',
    '@graph': [org, { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: o.name, publisher: { '@id': SITE + '/#org' }, inLanguage: 'en-IN' }]
  };
}

/* ------------------------------------------------------------- FAQ */

/** Admin answers for a page. "/city" entries apply to every city page, with {city} filled in. */
function faqsFor(key, vars) {
  const s = load();
  const v = vars || {};
  return (s.faqs || []).filter((f) => f && f.q && f.a && (f.page === key || (f.page === '/city' && key.startsWith('/city') && v.city)))
    .map((f) => ({ q: f.q.replace(/\{city\}/g, v.city || ''), a: f.a.replace(/\{city\}/g, v.city || '') }));
}

/** FAQ items already written into a page as <details class="faq-item"><summary>Q</summary>A</details>. */
function visibleFaqs(html) {
  const out = [];
  const re = /<details[^>]*class="[^"]*faq-item[^"]*"[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const q = stripTags(m[1]); const a = stripTags(m[2]);
    if (q && a) out.push({ q, a });
  }
  return out;
}

const faqLd = (items) => ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
});

const AEO_CSS = `<style id="aeo-css">
.aeo{padding:40px 0 48px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-family:inherit;color:#0F172A}
.aeo .aeo-in{max-width:1100px;margin:0 auto;padding:0 20px}
.aeo h2{font-size:22px;line-height:1.3;margin:0 0 10px;font-weight:800;letter-spacing:-.01em}
.aeo h3{font-size:16px;margin:22px 0 10px;font-weight:700}
.aeo .aeo-lead{font-size:15.5px;line-height:1.65;color:#334155;margin:0 0 6px;max-width:860px}
.aeo .aeo-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr));gap:10px;margin:16px 0 4px;padding:0}
.aeo .aeo-facts div{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:12px 14px}
.aeo .aeo-facts dt{font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.04em}
.aeo .aeo-facts dd{margin:4px 0 0;font-size:15px;font-weight:700;color:#0F172A;overflow-wrap:anywhere}
.aeo .aeo-top{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;counter-reset:t}
.aeo .aeo-top li{counter-increment:t;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:10px 14px;display:flex;gap:10px;align-items:center;min-width:0}
.aeo .aeo-top li::before{content:counter(t);flex:0 0 26px;height:26px;border-radius:50%;background:#EFF6FF;color:#2563EB;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center}
.aeo .aeo-top a{color:#0F172A;font-weight:700;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.aeo .aeo-top a:hover{color:#2563EB}
.aeo .aeo-top span{font-size:12.5px;color:#64748B;white-space:nowrap}
.aeo .aeo-faq{display:grid;gap:8px;max-width:900px}
.aeo .aeo-faq details{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:0 16px}
.aeo .aeo-faq summary{cursor:pointer;font-weight:700;font-size:15px;padding:14px 0;list-style:none;display:flex;justify-content:space-between;gap:12px}
.aeo .aeo-faq summary::-webkit-details-marker{display:none}
.aeo .aeo-faq summary::after{content:"+";font-size:20px;line-height:1;color:#2563EB;flex:0 0 auto}
.aeo .aeo-faq details[open] summary::after{content:"−"}
.aeo .aeo-faq details p{margin:0 0 14px;color:#334155;line-height:1.65;font-size:14.5px}
.aeo .aeo-links{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.aeo .aeo-links a{display:inline-block;padding:7px 12px;border-radius:999px;background:#fff;border:1px solid #E2E8F0;color:#334155;font-size:13.5px;font-weight:600;text-decoration:none}
.aeo .aeo-links a:hover{border-color:#2563EB;color:#2563EB}
.aeo .aeo-upd{font-size:12.5px;color:#64748B;margin-top:18px}
@media (max-width:640px){.aeo{padding:28px 0 36px}.aeo h2{font-size:19px}.aeo .aeo-in{padding:0 16px}}
</style>`;

function faqHtml(items) {
  return '<div class="aeo-faq">' + items.map((f, i) =>
    `<details${i === 0 ? ' open' : ''}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('') + '</div>';
}

/* ---------------------------------------------------------- decorate */

/**
 * Apply Site Kit to an outgoing public HTML page.
 *  opts.key        page key (see pageKey)
 *  opts.section    extra server-rendered HTML to place before <footer> (AEO answers)
 *  opts.faqs       Q&A already shown in opts.section, for FAQPage markup
 *  opts.robots     robots value decided by the caller (e.g. 404 → noindex)
 *  opts.skipMeta   true when the caller already set title/description/canonical
 */
function decorate(html, opts) {
  const s = load();
  const key = opts.key;
  const o = s.pages[key] || {};
  const head = [];

  // Drop any GA snippet baked into the file: Site Kit owns the tracking ids.
  html = html.replace(/<!--\s*Google tag \(gtag\.js\)[^>]*-->\s*<script[^>]*googletagmanager[^>]*><\/script>\s*<script>[\s\S]*?<\/script>/gi, '');

  if (o.title) {
    html = html.replace(/<title([^>]*)>[\s\S]*?<\/title>/i, `<title$1>${esc(o.title)}</title>`)
      .replace(/(<meta\s+(?:property|name)="(?:og|twitter):title"\s+content=")[^"]*"/gi, `$1${esc(o.title)}"`);
  }
  if (o.description) {
    html = html.replace(/(<meta\s+name="description"[^>]*?content=")[^"]*"/i, `$1${esc(o.description)}"`)
      .replace(/(<meta\s+(?:property|name)="(?:og|twitter):description"\s+content=")[^"]*"/gi, `$1${esc(o.description)}"`);
  }
  const robots = o.noindex ? 'noindex, follow' : opts.robots;
  if (robots) {
    html = html.replace(/<meta\s+name="robots"[^>]*>\s*/gi, '');
    head.push(`<meta name="robots" content="${esc(robots)}" />`);
  }
  if (!opts.skipMeta && !/<link\s+rel="canonical"/i.test(html) && !robots) {
    head.push(`<link rel="canonical" href="${SITE}${key === '/' ? '/' : key}" />`);
  }
  if (!/<meta\s+property="og:image"/i.test(html)) head.push(`<meta property="og:image" content="${esc(s.defaultImage)}" />`);
  head.push(...verificationTags(s));

  // Home: the organisation graph comes from Site Kit (logo, phone, social profiles).
  if (key === '/') {
    html = html.replace(/<script type="application\/ld\+json">\s*\{\s*"@context":\s*"https:\/\/schema\.org",\s*"@graph"[\s\S]*?<\/script>/i, '');
    head.push(ld(orgGraph(s)));
  }

  // Static pages with no structured data still get WebPage + breadcrumbs.
  if (!opts.skipMeta && key !== '/' && !/application\/ld\+json/.test(html)) {
    const name = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s*[|·—-]\s*Hotelzz\.in.*$/i, '');
    head.push(ld({
      '@context': 'https://schema.org', '@type': 'WebPage', name, url: SITE + key, isPartOf: { '@id': SITE + '/#website' }, inLanguage: 'en-IN',
      breadcrumb: { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name, item: SITE + key }] }
    }));
  }

  // AEO answers for this page (admin-managed), shown before the footer.
  let section = opts.section || '';
  const extra = opts.extraFaqs === false ? [] : faqsFor(key, opts.vars);
  let shown = (opts.faqs || []).slice();
  if (extra.length && !opts.section) {
    section = `<section class="aeo" id="answers" aria-labelledby="aeo-h"><div class="aeo-in"><h2 id="aeo-h">Quick answers</h2>${faqHtml(extra)}</div></section>`;
    shown = shown.concat(extra);
  } else if (extra.length) {
    section = section.replace('<!--aeo-extra-->', faqHtml(extra));
    shown = shown.concat(extra);
  } else {
    section = section.replace('<!--aeo-extra-->', '');
  }
  // FAQ markup covers everything visible on the page, once.
  const all = shown.concat(visibleFaqs(html));
  if (all.length && !/"FAQPage"/.test(html)) head.push(ld(faqLd(dedupe(all))));
  if (section) {
    head.push(AEO_CSS);
    html = /<footer[\s>]/i.test(html) ? html.replace(/<footer([\s>])/i, section + '\n<footer$1') : html.replace(/<\/body>/i, section + '\n</body>');
  }

  head.push(...analyticsTags(s));
  return html.replace(/<\/head>/i, head.join('\n') + '\n</head>');
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((f) => { const k = f.q.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ------------------------------------------------ static public pages */

const PUBLIC_PAGES = ['/', '/deals.html', '/marketing.html', '/ota-listing.html', '/claim.html', '/privacy.html', '/terms.html'];
const files = {};
function readPage(key) {
  const file = path.join(ROOT, key === '/' ? 'index.html' : key.slice(1));
  const mtime = fs.statSync(file).mtimeMs;
  if (!files[key] || files[key].mtime !== mtime) files[key] = { mtime, html: fs.readFileSync(file, 'utf8') };
  return files[key].html;
}

/** Express middleware: serves the public marketing pages through decorate(). */
function staticPages(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const key = pageKey(req.path);
  if (!PUBLIC_PAGES.includes(key)) return next();
  let html;
  try { html = readPage(key); } catch (_) { return next(); }
  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(decorate(html, { key }));
}

/* ----------------------------------------------------------- redirects */

function redirects(req, res, next) {
  const list = load().redirects || [];
  if (!list.length || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
  const hit = list.find((r) => r && r.from === req.path);
  if (!hit) return next();
  const qs = req.originalUrl.includes('?') && !hit.to.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(301, hit.to + qs);
}

/* ---------------------------------------------------- robots / llms */

const PRIVATE_PATHS = ['/api/', '/admin.html', '/admin-login.html', '/owner.html', '/user-portal.html', '/login.html',
  '/dashboard-login.html', '/reset-password.html', '/downloads/', '/tests/', '/server/', '/*.md$', '/*.gs$'];

function robotsTxt() {
  const s = load();
  const lines = ['# Hotelzz.in — managed in Admin → Site Kit', ''];
  const group = (agents, allow) => {
    agents.forEach((a) => lines.push('User-agent: ' + a));
    if (allow) { lines.push('Allow: /'); PRIVATE_PATHS.forEach((p) => lines.push('Disallow: ' + p)); }
    else lines.push('Disallow: /');
    lines.push('');
  };
  group(['*'], true);
  // A crawler with its own group ignores "*", so each AI group repeats the rules.
  const allowed = AI_CRAWLERS.filter((c) => s.aiCrawlers[c.id] !== false).map((c) => c.id);
  const blocked = AI_CRAWLERS.filter((c) => s.aiCrawlers[c.id] === false).map((c) => c.id);
  if (allowed.length) { lines.push('# AI answer engines: welcome (see /llms.txt)'); group(allowed, true); }
  if (blocked.length) { lines.push('# AI crawlers switched off in Site Kit'); group(blocked, false); }
  lines.push(`Sitemap: ${SITE}/sitemap.xml`, '');
  return lines.join('\n');
}

function titleCase(s) { return String(s || '').replace(/(^|[\s-])(\w)/g, (_, a, b) => a + b.toUpperCase()); }

let llmsCache = null;
function llmsTxt() {
  if (llmsCache && Date.now() - llmsCache.at < 60 * 60 * 1000) return llmsCache.body;
  const s = load();
  const total = db.prepare('SELECT COUNT(*) c FROM properties WHERE active = 1').get().c;
  const cities = db.prepare(
    `SELECT city_slug slug, MAX(location) name, COUNT(*) c, ROUND(AVG(rating),1) r FROM properties
      WHERE active = 1 AND city_slug IS NOT NULL AND city_slug <> '' GROUP BY city_slug ORDER BY c DESC, slug`
  ).all();
  const types = db.prepare(
    `SELECT property_type t, COUNT(*) c FROM properties WHERE active = 1 AND property_type IS NOT NULL AND property_type <> ''
      GROUP BY property_type ORDER BY c DESC LIMIT 6`
  ).all();
  const faqs = (s.faqs || []).filter((f) => f.page === '/');
  const body = [
    `# ${s.org.name}`,
    '',
    `> ${s.org.description}`,
    '',
    `Hotelzz.in lists ${total.toLocaleString('en-IN')} hotels, villas, cottages and homestays in ${cities.length} Indian destinations. ` +
      'Travellers book directly with each property on WhatsApp or phone; Hotelzz charges travellers no booking fee. ' +
      'Hotel owners can claim and manage their listing for free and buy optional marketing plans.',
    types.length ? '\nStay types: ' + types.map((t) => `${t.t} (${t.c})`).join(', ') + '.' : '',
    '',
    '## Key pages',
    `- [All destinations](${SITE}/city.html?city=all): every city with its hotels`,
    `- [Hotel deals](${SITE}/deals.html): live discounts and coupon codes from hotels`,
    `- [List your property](${SITE}/ota-listing.html): plans and pricing for hotel owners`,
    `- [Hotel marketing](${SITE}/marketing.html): marketing services for hotels`,
    `- [Claim a listing](${SITE}/claim.html): owners take control of their free listing`,
    `- [Sitemap](${SITE}/sitemap.xml): every hotel page`,
    '',
    '## Destinations',
    ...cities.map((c) => `- [Hotels in ${titleCase(c.name || c.slug)}](${SITE}/city.html?city=${encodeURIComponent(c.slug)}): ${c.c} stays${c.r ? ', average rating ' + c.r : ''}`),
    '',
    faqs.length ? '## FAQ' : '',
    ...faqs.map((f) => `### ${f.q}\n${f.a}\n`),
    '## Contact',
    `- Email: ${s.org.email}`,
    `- Phone / WhatsApp: ${s.org.phone}`,
    ''
  ].join('\n');
  llmsCache = { at: Date.now(), body };
  return body;
}

/* ------------------------------------------------------------ IndexNow */

/** Sends URLs to IndexNow (Bing, Yandex, Seznam, Naver share submissions). */
async function indexNow(urls, userId) {
  const s = load();
  const list = Array.from(new Set(urls)).filter((u) => u.startsWith(SITE + '/')).slice(0, 10000);
  if (!list.length) return { ok: true, submitted: 0, note: 'Nothing new to submit.' };
  if (!env.isProd) return { ok: true, skipped: true, submitted: 0, note: 'Not sent: IndexNow runs only on the live site (NODE_ENV=production on hotelzz.in).' };
  let result;
  try {
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: 'hotelzz.in', key: s.indexNowKey, keyLocation: `${SITE}/${s.indexNowKey}.txt`, urlList: list }),
      signal: AbortSignal.timeout(20000)
    });
    // 200 = accepted, 202 = accepted (key check pending).
    result = r.status === 200 || r.status === 202
      ? { ok: true, submitted: list.length, status: r.status }
      : { ok: false, submitted: 0, status: r.status, error: 'IndexNow answered HTTP ' + r.status + (r.status === 403 ? ' (key file not reachable yet)' : '') };
  } catch (e) {
    result = { ok: false, submitted: 0, error: e.message };
  }
  save({ lastIndexNowAt: new Date().toISOString(), lastIndexNowResult: result.ok ? `${result.submitted} URLs accepted` : result.error }, userId);
  return result;
}

function changedUrls(sinceIso) {
  const since = sinceIso ? sinceIso.replace('T', ' ').slice(0, 19) : '1970-01-01';
  const props = db.prepare('SELECT id, city_slug FROM properties WHERE active = 1 AND updated_at > ? LIMIT 9000').all(since);
  const urls = props.map((p) => `${SITE}/property.html?id=${encodeURIComponent(p.id)}`);
  new Set(props.map((p) => p.city_slug).filter(Boolean)).forEach((c) => urls.push(`${SITE}/city.html?city=${encodeURIComponent(c)}`));
  if (urls.length) urls.push(SITE + '/', SITE + '/deals.html');
  return urls;
}

function keyUrls() {
  const urls = PUBLIC_PAGES.map((k) => SITE + (k === '/' ? '/' : k));
  urls.push(SITE + '/city.html?city=all');
  db.prepare("SELECT DISTINCT city_slug c FROM properties WHERE active = 1 AND city_slug IS NOT NULL AND city_slug <> ''").all()
    .forEach((r) => urls.push(`${SITE}/city.html?city=${encodeURIComponent(r.c)}`));
  return urls;
}

/** Hourly: when auto IndexNow is on, submit listings changed since the last ping. */
function startAutoIndexNow() {
  if (!env.isProd) return;
  const tick = () => {
    const s = load();
    if (!s.autoIndexNow) return;
    const urls = changedUrls(s.lastIndexNowAt);
    if (urls.length) indexNow(urls, null).catch((e) => console.error('[indexnow]', e.message));
  };
  setTimeout(tick, 5 * 60 * 1000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}

function invalidate() { llmsCache = null; }

module.exports = {
  SITE, AI_CRAWLERS, DEFAULTS, PUBLIC_PAGES,
  load, save, decorate, pageKey, staticPages, redirects, robotsTxt, llmsTxt,
  indexNow, changedUrls, keyUrls, startAutoIndexNow, invalidate, faqsFor, faqHtml, esc
};
