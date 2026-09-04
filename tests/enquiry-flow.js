// End-to-end: anonymous visitor sends an enquiry from a property page,
// then the owner sees it in the dashboard and replies.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:3000';

function findChrome() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const dir = fs.readdirSync(root).find((d) => d.startsWith('chromium-'));
  for (const sub of ['chrome-win64', 'chrome-win']) {
    const exe = path.join(root, dir, sub, 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error('Chromium not found under ' + root);
}

(async () => {
  const propertyId = process.argv[2];
  if (!propertyId) throw new Error('usage: node tests/enquiry-flow.js <propertyId>');

  const browser = await chromium.launch({ executablePath: findChrome() });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // The form opens WhatsApp in a new tab; close it silently.
  ctx.on('page', (p) => p.close().catch(() => {}));

  await page.goto(`${BASE}/property.html?id=${encodeURIComponent(propertyId)}`, { waitUntil: 'domcontentloaded' });
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
