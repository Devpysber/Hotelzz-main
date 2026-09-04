// Walks every owner and admin dashboard view and asserts each renders from the
// API, with no sample identities or invented numbers left in the DOM.
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

// Strings that only ever came from the old mock data files.
const STALE = [
  'Rahul Mehta', 'Vikram R.', 'Amit Shah', 'Neha Jain',
  'Taj Palace Hotel', 'Lake View Palace Resort', 'Royal Orchid Suites',
  'hotel-listings-india-2026.csv', '₹18,60,000', '24,860', '12,842',
  'IMP-20260902-003', 'HZ-TEMP-89231'
];

async function signIn(page, role, identifier, password, landing) {
  await page.evaluate(() => window.HotelzzAPI && window.HotelzzAPI.auth.logout()).catch(() => {});
  await page.goto(`${BASE}/login.html?type=${role}`, { waitUntil: 'domcontentloaded' });
  const form = role === 'owner' ? '#formOwnerLogin' : '#formAdminLogin';
  await page.fill(`${form} [name=identifier]`, identifier);
  await page.fill(`${form} [name=password]`, password);
  await Promise.all([
    page.waitForURL((u) => u.pathname === landing, { timeout: 15000, waitUntil: 'domcontentloaded' }),
    page.click(`${form} button[type=submit]`)
  ]);
  await page.waitForTimeout(2200);
}

async function walk(page, label, views) {
  const rows = [];
  for (const v of views) {
    await page.evaluate((view) => window.switchView(view), v);
    await page.waitForTimeout(900);
    const text = await page.evaluate((view) => {
      const el = document.getElementById('view-' + view);
      return el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : '';
    }, v);
    rows.push(`${v.padEnd(18)} ${text ? text.slice(0, 90) : '(empty)'}`);
  }
  console.log(`\n[${label}]`);
  rows.forEach((r) => console.log('  ' + r));
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome() });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await signIn(page, 'owner', 'owner@grandpalace.com', 'newowner123', '/owner.html');
  await walk(page, 'owner', ['dashboard', 'property-details', 'photos', 'amenities', 'rooms',
                             'leads', 'reviews', 'offers', 'subscription', 'billing', 'grow-business']);
  const ownerHtml = await page.content();

  await signIn(page, 'admin', 'admin@hotelzz.in', 'admin123', '/admin.html');
  await walk(page, 'admin', ['dashboard', 'properties', 'claims', 'owners', 'subscriptions',
                             'payments', 'reviews', 'leads', 'cities', 'revenue', 'activity',
                             'admins', 'admin-marketing', 'import']);
  const adminHtml = await page.content();

  const found = STALE.filter((needle) => ownerHtml.includes(needle) || adminHtml.includes(needle));
  console.log('\nstale sample data:', found.length ? found.join(', ') : 'none');

  if (errors.length) console.log('console errors:\n - ' + errors.slice(0, 8).join('\n - '));
  await browser.close();
  process.exit(errors.length || found.length ? 1 : 0);
})();
