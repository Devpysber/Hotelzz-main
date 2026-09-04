// Audits every clickable control on every page.
//
// Pass 1 is static: for each element with an inline handler, resolve the
// function it names and report any that are not defined.
// Pass 2 clicks the safe ones and records anything that throws.
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

// Handlers that navigate away, submit real data, or open a native dialog are
// resolved statically but not clicked.
const DO_NOT_CLICK = /logout|submitBooking|handleCsvFile|startLiveImport|simulateLaunchCampaign|confirmPlanUpgrade|deleteRoom|deletePhoto|rejectClaim|markPaymentPaid|toggleListingActive|setOwnerStatus|approveClaim|moderateReview|sendCredentials|submitNewPassword|registerNewProperty|executeSearch|verifyPhone|saveProfileForm|changePasswordForm|savePropertyDetails|saveRoomForm|saveOfferForm|saveAmenities|submitOwnerReply|respondToLead|updateLeadStatus|saveAdmin|updateMktLeadStatus|updateMarketingLead|toggleSaved|sendPortalEnquiryDirect/;

// Passed to page.evaluate as a function, so no string-escaping games.
function collectHandlers() {
  const BUILTINS = ['event', 'return', 'if', 'for', 'while', 'function', 'alert', 'confirm',
                    'prompt', 'fetch', 'setTimeout', 'Number', 'String', 'Boolean', 'parseInt', 'this'];
  const out = [];

  document.querySelectorAll('[onclick],[onsubmit],[onchange],[onkeyup]').forEach((el) => {
    ['onclick', 'onsubmit', 'onchange', 'onkeyup'].forEach((attr) => {
      const code = el.getAttribute(attr);
      if (!code) return;

      // Page-level calls only: anything preceded by a dot is a method call.
      const names = [];
      const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
      let m;
      while ((m = re.exec(code)) !== null) names.push(m[2]);

      names.forEach((name) => {
        if (BUILTINS.indexOf(name) !== -1) return;
        out.push({
          name,
          defined: typeof window[name] === 'function',
          attr,
          label: (el.textContent || el.value || el.id || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          visible: !!(el.offsetParent || el.getClientRects().length)
        });
      });
    });
  });
  return out;
}

async function signIn(page, role, identifier, password, landing) {
  await page.evaluate(() => window.HotelzzAPI && window.HotelzzAPI.auth.logout()).catch(() => {});
  await page.goto(`${BASE}/login.html?type=${role}`, { waitUntil: 'domcontentloaded' });
  const form = role === 'traveler' ? '#formTravelerLogin' : role === 'owner' ? '#formOwnerLogin' : '#formAdminLogin';
  await page.fill(`${form} [name=identifier]`, identifier);
  await page.fill(`${form} [name=password]`, password);
  await Promise.all([
    page.waitForURL((u) => u.pathname === landing, { timeout: 15000, waitUntil: 'domcontentloaded' }),
    page.click(`${form} button[type=submit]`)
  ]);
  await page.waitForTimeout(2200);
}

async function audit(page, label, views) {
  const errors = [];
  const onError = (e) => errors.push(String(e.message || e).slice(0, 160));
  page.on('pageerror', onError);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });

  const missing = new Map();
  const clicked = [];

  for (const view of views || [null]) {
    if (view) {
      await page.evaluate((v) => window.switchView && window.switchView(v), view);
      await page.waitForTimeout(700);
    }

    const handlers = await page.evaluate(collectHandlers);
    handlers.filter((h) => !h.defined).forEach((h) => {
      missing.set(h.name, `${h.name}() — on "${h.label}"${view ? ' in ' + view : ''}`);
    });

    // Click the visible, side-effect-free controls.
    const clickable = handlers.filter((h) => h.defined && h.visible && h.attr === 'onclick' && !DO_NOT_CLICK.test(h.name));
    for (const h of clickable.slice(0, 25)) {
      const before = errors.length;
      await page.evaluate((sel) => {
        const el = [...document.querySelectorAll('[onclick]')]
          .find((e) => (e.getAttribute('onclick') || '').includes(sel.name) &&
                       (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) === sel.label);
        if (el) el.click();
      }, h).catch(() => {});
      await page.waitForTimeout(120);
      if (errors.length > before) clicked.push(`${h.name} threw: ${errors[errors.length - 1]}`);
    }
  }

  page.off('pageerror', onError);
  console.log(`\n[${label}]`);
  console.log('  undefined handlers:', missing.size ? '\n    - ' + [...missing.values()].join('\n    - ') : 'none');
  console.log('  click failures    :', clicked.length ? '\n    - ' + clicked.join('\n    - ') : 'none');
  if (errors.length) console.log('  console errors    :\n    - ' + [...new Set(errors)].slice(0, 8).join('\n    - '));
  return missing.size + clicked.length + errors.length;
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome() });
  const page = await browser.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  let problems = 0;

  for (const url of ['/index.html', '/city.html?city=panaji', '/marketing.html', '/ota-listing.html',
                     '/claim.html', '/login.html', '/dashboard-login.html', '/reset-password.html',
                     '/privacy.html', '/terms.html', '/404.html']) {
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    problems += await audit(page, url);
  }

  const prop = await page.evaluate(async () => {
    const r = await fetch('/api/properties?limit=1').then((x) => x.json());
    return r.properties[0].id;
  });
  await page.goto(`${BASE}/property.html?id=${encodeURIComponent(prop)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  problems += await audit(page, '/property.html');

  await signIn(page, 'traveler', 'rahul@example.com', 'password123', '/user-portal.html');
  problems += await audit(page, '/user-portal.html',
    ['overview', 'search', 'enquiries', 'reviews', 'saved', 'profile']);

  await signIn(page, 'owner', 'owner@grandpalace.com', 'newowner123', '/owner.html');
  problems += await audit(page, '/owner.html',
    ['dashboard', 'property-details', 'photos', 'amenities', 'rooms', 'leads',
     'reviews', 'offers', 'subscription', 'billing', 'grow-business']);

  await signIn(page, 'admin', 'admin@hotelzz.in', 'admin123', '/admin.html');
  problems += await audit(page, '/admin.html',
    ['dashboard', 'properties', 'claims', 'owners', 'subscriptions', 'payments', 'reviews',
     'leads', 'cities', 'revenue', 'activity', 'admins', 'admin-marketing', 'import', 'import-history', 'settings']);

  console.log(`\ntotal problems: ${problems}`);
  await browser.close();
  process.exit(problems ? 1 : 0);
})();
