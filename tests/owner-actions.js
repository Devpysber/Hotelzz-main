// Exercises the owner dashboard actions that touch new subsystems:
// photo upload (multipart), plan purchase (checkout in manual mode), and the
// admin payments view that settles it.
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

async function signIn(page, role, identifier, password, landing) {
  // login.html bounces an already-signed-in visitor to their portal.
  await page.evaluate(() => window.HotelzzAPI && window.HotelzzAPI.auth.logout()).catch(() => {});
  await page.goto(`${BASE}/login.html?type=${role}`, { waitUntil: 'networkidle' });
  const form = role === 'owner' ? '#formOwnerLogin' : '#formAdminLogin';
  await page.fill(`${form} [name=identifier]`, identifier);
  await page.fill(`${form} [name=password]`, password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === landing, { timeout: 15000, waitUntil: 'domcontentloaded' }),
    page.click(`${form} button[type=submit]`)
  ]);
  await page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome() });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());

  // --- owner: upload a photo through the real file input -------------------
  await signIn(page, 'owner', 'owner@grandpalace.com', 'newowner123', '/owner.html');

  const before = await page.evaluate(() => {
    const d = window.HotelzzOwnerData;
    return d.properties[d.activePropertyId].photos.length;
  });
  await page.setInputFiles('#ownerPhotoInput', path.resolve('jpg.png'));
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => {
    const d = window.HotelzzOwnerData;
    return d.properties[d.activePropertyId].photos.length;
  });
  console.log(`photos: ${before} -> ${after} ${after > before ? 'OK' : 'FAILED'}`);

  // --- owner: buy a plan (manual mode records a payment) -------------------
  const purchase = await page.evaluate(async () => {
    const d = window.HotelzzOwnerData;
    await d.changePlan(d.activePropertyId, { planName: 'Premium Plan', price: '₹4,999', billingCycle: 'Monthly' });
    const res = await window.HotelzzAPI.payments.checkout({
      purpose: 'subscription', referenceId: d.activePropertyId, propertyId: d.activePropertyId
    });
    return res.mode;
  });
  console.log('checkout mode:', purchase);

  // --- admin: the payment shows up and can be settled ----------------------
  await signIn(page, 'admin', 'admin@hotelzz.in', 'admin123', '/admin.html');
  await page.evaluate(() => window.switchView('payments'));
  await page.waitForTimeout(800);
  const rows = await page.locator('#paymentsTableBody tr').count();
  const pending = await page.locator('#paymentsTableBody button').count();
  console.log(`admin payments rows=${rows} settleable=${pending}`);

  if (pending) {
    await page.locator('#paymentsTableBody button').first().click();
    await page.waitForTimeout(2000);
    const stillPending = await page.locator('#paymentsTableBody button').count();
    console.log(`after settling: settleable=${stillPending} ${stillPending < pending ? 'OK' : 'FAILED'}`);
  }

  if (errors.length) console.log('console errors:\n - ' + errors.slice(0, 6).join('\n - '));
  await browser.close();
  process.exit(errors.length || after <= before ? 1 : 0);
})();
