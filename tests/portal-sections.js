// Walks every traveler-portal section and asserts it renders from live data
// with no leftover sample content.
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
  const browser = await chromium.launch({ executablePath: findChrome() });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(`${BASE}/login.html?type=traveler`, { waitUntil: 'domcontentloaded' });
  await page.fill('#formTravelerLogin [name=identifier]', 'rahul@example.com');
  await page.fill('#formTravelerLogin [name=password]', 'password123');
  await Promise.all([
    page.waitForURL((u) => u.pathname === '/user-portal.html', { waitUntil: 'domcontentloaded' }),
    page.click('#formTravelerLogin button[type=submit]')
  ]);
  await page.waitForTimeout(2000);

  const state = await page.evaluate(() => {
    const store = window.HotelzzEnquiryStore;
    return {
      user: store.getUser().name,
      enquiries: store.getEnquiries().length,
      reviews: store.getReviews().length,
      saved: store.getSavedHotels().length
    };
  });
  console.log('store:', JSON.stringify(state));

  const checks = [];
  const seen = async (view, selector) => {
    await page.evaluate((v) => window.switchView(v), view);
    await page.waitForTimeout(1200);
    const text = (await page.textContent(selector).catch(() => '')) || '';
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 110);
    checks.push(`${view.padEnd(10)} ${clean || '(empty)'}`);
  };

  await seen('overview', '.kpi-grid');
  await seen('search', '#portalSearchResultsContainer');
  await seen('enquiries', '#enquiriesContainer');
  await seen('reviews', '#userReviewsContainer');
  await seen('saved', '#savedHotelsContainer');
  await seen('profile', '#view-profile');
  checks.forEach((c) => console.log('  ' + c));

  // City pills and stay dates must come from real data, not fixed values.
  const pills = await page.$$eval('#portalCityPills button', (els) => els.map((e) => e.textContent.trim()));
  const dates = await page.evaluate(() => ({
    in: document.getElementById('portalSearchCheckIn').value,
    out: document.getElementById('portalSearchCheckOut').value
  }));
  console.log('city pills:', pills.join(', ') || '(none)');
  console.log('stay dates:', dates.in, '->', dates.out);

  const html = await page.content();
  const stale = ['PROP-101', 'Lake View Resort Goa', 'Royal Residency Pune', 'HZ-ENQ-28491']
    .filter((needle) => html.includes(needle));
  console.log('stale sample data:', stale.length ? stale.join(', ') : 'none');

  if (errors.length) console.log('console errors:\n - ' + errors.slice(0, 6).join('\n - '));
  await browser.close();
  process.exit(errors.length || stale.length ? 1 : 0);
})();
