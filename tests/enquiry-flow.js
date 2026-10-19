// End-to-end: a signed-in traveller sends an enquiry from a property page and
// sees it confirmed. (Signed-out visitors book through WhatsApp instead.)
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const { BASE, findChrome } = require('./_browser');


(async () => {
  const propertyId = process.argv[2];
  if (!propertyId) throw new Error('usage: node tests/enquiry-flow.js <propertyId>');

  const browser = await chromium.launch({ executablePath: findChrome() });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Only the app's own requests: fonts/analytics would otherwise time out offline.
  await ctx.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  await page.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
  const login = await page.evaluate(async () => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'rahul@example.com', password: 'password123', role: 'traveler' }) })).status);
  if (login !== 200) throw new Error('traveler login failed: ' + login);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // The form opens WhatsApp in a new tab; close it silently.
  ctx.on('page', (p) => p.close().catch(() => {}));

  await page.goto(`${BASE}/property.html?id=${encodeURIComponent(propertyId)}`, { waitUntil: 'networkidle' });
  console.log('title:', (await page.title()).slice(0, 70));

  await page.fill('#fName', 'Anita Desai');
  await page.fill('#fPhone', '9812345678');
  await page.fill('#fEmail', 'anita@example.com');
  await page.fill('#fNotes', 'Need two sea-facing rooms with early check-in.');
  await page.click('#bookForm button[type=submit]');

  await page.waitForSelector('.enquiry-success', { timeout: 10000 });
  const text = (await page.textContent('.enquiry-success')).replace(/\s+/g, ' ').trim();
  console.log('success banner:', text.slice(0, 120));

  if (errors.length) console.log('console errors:\n - ' + errors.join('\n - '));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
