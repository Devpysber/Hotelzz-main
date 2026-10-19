// SEO / AEO / Site Kit checks against a running server (no browser needed).
//
//   npm start                (NODE_ENV=development)
//   node tests/seo.js        (HZ_BASE to override; HZ_ADMIN_EMAIL / HZ_ADMIN_PASSWORD for a production copy)
//
// Saves Site Kit settings while it runs and puts the originals back at the end.
const { BASE } = require('./_browser');

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.log('  ✗ ' + m); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

let cookie = '';
async function req(method, path, body) {
  const r = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: Object.assign({ Cookie: cookie }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* html */ }
  return { status: r.status, text, json, headers: r.headers };
}

const ldTypes = (html) => {
  const out = [];
  (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []).forEach((b) => {
    const j = JSON.parse(b.replace(/^<script[^>]*>|<\/script>$/g, ''));
    (j['@graph'] || [j]).forEach((n) => out.push(n['@type']));
  });
  return out;
};

(async () => {
  console.log('Public SEO files');
  const robots = await req('GET', '/robots.txt');
  check(robots.status === 200 && /Sitemap: https:\/\/hotelzz\.in\/sitemap\.xml/.test(robots.text), 'robots.txt lists the sitemap');
  check(/User-agent: ClaudeBot/.test(robots.text) && /Disallow: \/admin\.html/.test(robots.text), 'robots.txt has AI crawler groups that keep private paths closed');
  const llms = await req('GET', '/llms.txt');
  check(llms.status === 200 && /^# /.test(llms.text) && /city\.html\?city=/.test(llms.text), 'llms.txt summarises the site with destination links');
  const sm = await req('GET', '/sitemap.xml');
  check(sm.status === 200 && (sm.text.match(/<loc>/g) || []).length > 10, 'sitemap.xml has URLs');

  console.log('Pages');
  const home = await req('GET', '/');
  const types = ldTypes(home.text);
  check(types.includes('Organization') && types.includes('WebSite') && types.includes('FAQPage'), 'home: Organization, WebSite and FAQPage markup');
  check((home.text.match(/<h1[\s>]/g) || []).length === 1, 'home: exactly one H1');
  check((home.text.match(/googletagmanager\.com\/gtag\/js/g) || []).length === 1, 'home: one GA4 tag (no duplicate)');
  const title = (home.text.match(/<title[^>]*>([^<]*)<\/title>/) || [])[1] || '';
  check(title.length >= 20 && title.length <= 65, 'home: title length ' + title.length);

  const cities = await req('GET', '/api/properties/cities');
  const slug = cities.json && (cities.json.cities || [])[0] && (cities.json.cities[0].slug || cities.json.cities[0].city_slug);
  const city = await req('GET', '/city.html?city=' + encodeURIComponent(slug || 'agra'));
  check(city.status === 200 && /id="answers"/.test(city.text), 'city: server-rendered answer box');
  check(ldTypes(city.text).includes('FAQPage') && ldTypes(city.text).includes('ItemList'), 'city: FAQPage + ItemList markup');
  check(/<title data-ssr/.test(city.text), 'city: title marked server-rendered');

  const list = await req('GET', '/api/properties?limit=1');
  const pid = list.json.properties[0].id;
  const prop = await req('GET', '/property.html?id=' + encodeURIComponent(pid));
  check(prop.status === 200 && /id="answers"/.test(prop.text) && /class="aeo-ssr"/.test(prop.text), 'property: answer box + crawlable heading');
  check(ldTypes(prop.text).includes('Hotel') && ldTypes(prop.text).includes('FAQPage'), 'property: Hotel + FAQPage markup');
  const missing = await req('GET', '/property.html?id=does-not-exist');
  check(missing.status === 404 && /noindex/.test(missing.text), 'unknown property: 404 + noindex');

  console.log('Site Kit admin API');
  check((await req('GET', '/api/admin/sitekit')).status === 401, 'anonymous access refused');
  const login = await req('POST', '/api/auth/login', { identifier: process.env.HZ_ADMIN_EMAIL || 'admin@hotelzz.in', password: process.env.HZ_ADMIN_PASSWORD || 'admin123', role: 'admin' });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const kit = await req('GET', '/api/admin/sitekit');
  check(kit.status === 200 && kit.json.settings.indexNowKey, 'admin can read Site Kit');
  const original = kit.json.settings;
  const key = await req('GET', '/' + original.indexNowKey + '.txt');
  check(key.status === 200 && key.text.trim() === original.indexNowKey, 'IndexNow key file served');

  const put = await req('PUT', '/api/admin/sitekit', {
    gscVerification: 'testVerify_123',
    pages: { '/deals.html': { title: 'Test Deals Title | Hotelzz.in', description: '', noindex: false } },
    redirects: [{ from: '/seo-test-old.html', to: '/deals.html' }],
    faqs: (original.faqs || []).concat([{ page: '/deals.html', q: 'Is this a test question?', a: 'Yes, this answer is added by tests/seo.js.' }]),
    aiCrawlers: { CCBot: false }
  });
  check(put.status === 200, 'settings saved');
  const deals = await req('GET', '/deals.html');
  check(/<meta name="google-site-verification" content="testVerify_123"/.test(deals.text), 'verification tag injected');
  check(/<title>Test Deals Title \| Hotelzz\.in<\/title>/.test(deals.text), 'page title override applied');
  check(/Is this a test question\?/.test(deals.text) && ldTypes(deals.text).includes('FAQPage'), 'AEO answer shown and marked up');
  const redirect = await req('GET', '/seo-test-old.html?a=1');
  check(redirect.status === 301 && /\/deals\.html\?a=1$/.test(redirect.headers.get('location') || ''), '301 redirect keeps the query string');
  check(/switched off[^\n]*\n(User-agent: [^\n]+\n)*User-agent: CCBot\n(User-agent: [^\n]+\n)*Disallow: \/\n/.test((await req('GET', '/robots.txt')).text), 'switched-off crawler is disallowed');

  // Text with "$'" / "$&" must come out literally, not splice the page.
  await req('PUT', '/api/admin/sitekit', {
    faqs: [{ page: '/claim.html', q: "Costs $' and $& and $1 here?", a: "Price is $' exactly $& nothing $1 more." }],
    pages: { '/claim.html': { title: "Claim $' $& $1 | Hotelzz.in", description: '', noindex: false },
             '/privacy.html': { title: '', description: '', noindex: true } },
    redirects: [{ from: '/terms.html', to: '/privacy.html' }]
  });
  const claim = await req('GET', '/claim.html');
  check(claim.text.includes("Costs $' and $&amp; and $1 here?") && claim.text.includes("<title>Claim $' $&amp; $1 | Hotelzz.in</title>") &&
        (claim.text.match(/<\/html>/g) || []).length === 1, 'special $ patterns stay literal');
  const sm2 = (await req('GET', '/sitemap.xml')).text;
  check(!sm2.includes('/privacy.html') && !sm2.includes('/terms.html'), 'noindex and redirected pages left out of the sitemap');
  check(/<meta name="robots" content="noindex, follow"/.test((await req('GET', '/privacy.html')).text), 'noindex override on the page');
  check((await req('GET', '/api/admin/sitekit/content?issue=constructor')).status === 200, 'unknown issue name handled');
  check((await req('GET', '/api/admin/sitekit/content?issue=__proto__')).status === 200, 'prototype issue name handled');
  const inx = await req('POST', '/api/admin/sitekit/indexnow', { scope: 'key' });
  check((inx.status === 200 && inx.json.ok) || (inx.status === 502 && inx.json.error), 'IndexNow endpoint answers (sent, skipped in dev, or a clear error)');
  check((await req('POST', '/api/admin/sitekit/indexnow', { scope: 'urls', urls: ['javascript:alert(1)'] })).status === 400, 'IndexNow rejects bad URLs');

  check((await req('PUT', '/api/admin/sitekit', { ga4Id: 'UA-1' })).status === 400, 'bad GA4 id rejected');
  check((await req('PUT', '/api/admin/sitekit', { gscVerification: '"><script>' })).status === 400, 'unsafe verification code rejected');
  check((await req('PUT', '/api/admin/sitekit', { redirects: [{ from: '/admin.html', to: '/' }] })).status === 400, 'redirecting admin pages refused');

  const audit = await req('GET', '/api/admin/sitekit/audit');
  check(audit.status === 200 && audit.json.score >= 85, 'site audit score ' + (audit.json && audit.json.score));
  const content = await req('GET', '/api/admin/sitekit/content?issue=no-summary');
  check(content.status === 200 && content.json.counts.length >= 5, 'listing quality report');
  const g = await req('GET', '/api/admin/sitekit/google');
  check(g.status === 200 && g.json.configured === false || g.json.configured === true, 'Google data endpoint answers');

  await req('PUT', '/api/admin/sitekit', {
    gscVerification: original.gscVerification, pages: original.pages, redirects: original.redirects,
    faqs: original.faqs, aiCrawlers: original.aiCrawlers
  });

  console.log(failed ? `\n${failed} check(s) failed` : '\nAll SEO checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
