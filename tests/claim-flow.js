// End-to-end claim: search a real listing, verify the phone, receive the code
// (dev echo), set a password, and land on a pending claim.
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
  const [hotelName, city, phone, email] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: findChrome() });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());

  await page.goto(BASE + '/claim.html', { waitUntil: 'domcontentloaded' });

  await page.fill('#searchName', hotelName);
  await page.selectOption('#searchCity', { label: city }).catch(async () => {
    // City is not in the fixed dropdown — add it so the search can run.
    await page.evaluate((c) => {
      const sel = document.getElementById('searchCity');
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c; sel.appendChild(opt); sel.value = c;
    }, city);
  });
  await page.click('#step1 .btn-submit');
  await page.waitForSelector('.btn-this-is-mine', { timeout: 10000 });
  console.log('results:', await page.locator('.property-card').count());

  await page.click('.btn-this-is-mine');
  await page.waitForSelector('#step3.active');
  await page.fill('#inputPhone', phone);
  await page.click('#step3 .btn-submit');

  await page.waitForSelector('#step4.active', { timeout: 10000 });
  await page.fill('#inputEmail', email);
  await page.click('#step4 .btn-submit');

  await page.waitForSelector('#step5.active', { timeout: 10000 });
  const hint = await page.textContent('#claimCodeHint');
  const code = (hint.match(/\d{6}/) || [])[0];
  console.log('code hint:', hint.trim());

  await page.click('#step5 .btn-submit');
  await page.fill('#claimCodeInput', code);
  await page.fill('#newPassInput', 'claimpass123');
  await page.fill('#confirmPassInput', 'claimpass123');
  await page.click('#passwordModal .btn-submit');

  await page.waitForSelector('#step6.active', { timeout: 10000 });
  console.log('claimed:', (await page.textContent('#finalPropName')).trim(), '|',
              (await page.textContent('#finalPropCity')).trim());

  if (errors.length) console.log('console errors:\n - ' + errors.join('\n - '));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
