// Checks the public pages render from the API catalogue without console errors.
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

const pages = [
  { url: '/index.html', probe: () => (window.HOTELS || []).length },
  { url: '/city.html?city=panaji', probe: () => document.querySelectorAll('a[href^="property.html"]').length },
  { url: '/marketing.html', probe: () => !!document.querySelector('form, .mkt-package-card') },
  { url: '/ota-listing.html', probe: () => !!document.body },
  { url: '/claim.html', probe: () => !!document.getElementById('searchName') },
  { url: '/login.html', probe: () => !!document.getElementById('formTravelerLogin') },
  { url: '/dashboard-login.html', probe: () => !!document.getElementById('fEmail') }
];

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome() });
  let failures = 0;

  for (const p of pages) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

    await page.goto(BASE + p.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    const value = await page.evaluate(p.probe).catch((e) => 'probe failed: ' + e.message);

    if (errors.length) failures++;
    console.log(`${p.url.padEnd(28)} probe=${value}${errors.length ? '  ERRORS: ' + errors.slice(0, 3).join(' | ') : ''}`);
    await ctx.close();
  }

  await browser.close();
  process.exit(failures ? 1 : 0);
})();
