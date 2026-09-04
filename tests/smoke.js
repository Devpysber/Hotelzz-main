// Browser smoke test: signs in as each role and reports console/page errors.
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

const cases = [
  { role: 'traveler', identifier: 'rahul@example.com', password: 'password123', page: '/user-portal.html',
    checks: ['#kpiSent', '#userNameDisplay'] },
  { role: 'owner', identifier: 'owner@grandpalace.com', password: 'newowner123', page: '/owner.html',
    checks: ['#headerPropNameDisplay', '#kpiViews'] },
  { role: 'admin', identifier: 'admin@hotelzz.in', password: 'admin123', page: '/admin.html',
    checks: ['#dashTotalProps', '#dashPendingClaims'] }
];

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome() });
  let failures = 0;

  for (const c of cases) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

    await page.goto(BASE + '/login.html?type=' + c.role, { waitUntil: 'domcontentloaded' });
    const form = c.role === 'traveler' ? '#formTravelerLogin' : c.role === 'owner' ? '#formOwnerLogin' : '#formAdminLogin';
    await page.fill(`${form} [name=identifier]`, c.identifier);
    await page.fill(`${form} [name=password]`, c.password);
    await Promise.all([
      page.waitForURL('**' + c.page, { timeout: 15000 }).catch(() => {}),
      page.click(`${form} button[type=submit]`)
    ]);
    await page.waitForTimeout(1500);

    const url = page.url();
    const results = {};
    for (const sel of c.checks) {
      results[sel] = await page.textContent(sel).catch(() => '<missing>');
    }
    const ok = url.includes(c.page);
    if (!ok || errors.length) failures++;
    console.log(`\n[${c.role}] url=${url} landed=${ok}`);
    console.log('  values:', JSON.stringify(results));
    if (errors.length) console.log('  console errors:\n   - ' + errors.slice(0, 8).join('\n   - '));
    await ctx.close();
  }

  await browser.close();
  process.exit(failures ? 1 : 0);
})();
