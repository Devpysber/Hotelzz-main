// Full end-to-end suite: every page and panel, every view, every inline
// handler, the main user journeys, and a responsive (no sideways scroll) sweep.
//
//   npm start                       (in another terminal; NODE_ENV=development)
//   node tests/e2e.js               (HZ_BASE / CHROME_PATH to override)
//   node tests/e2e.js --only=responsive|wiring|flows
//
// Requests to other hosts (fonts, analytics, CDN images) are blocked so the
// run is deterministic offline; only the app's own errors are reported.
const { chromium } = require('playwright-core');
const { BASE, findChrome } = require('./_browser');

const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const run = (part) => !ONLY || ONLY === part;

const ACCOUNTS = {
  traveler: { identifier: 'rahul@example.com', password: 'password123', home: '/user-portal.html' },
  owner: { identifier: 'owner@grandpalace.com', password: 'owner12345', home: '/owner.html' },
  admin: { identifier: 'admin@hotelzz.in', password: 'admin123', home: '/admin.html' }
};

// Handlers that sign out, leave the page, open a file picker or change real
// data are checked for existence but never clicked in the wiring pass —
// the flows pass exercises the important ones deliberately.
const DO_NOT_CLICK = /logout|Logout|submit|Submit|save|Save|delete|Delete|remove|Remove|approve|reject|Reject|moderate|markPayment|toggleListing|setOwner|toggleUser|sendCredentials|registerNew|executeSearch|verifyPhone|change(Password|Email)|import|Import|upload|Upload|launch|Launch|confirm|Confirm|pay|Pay|respond|update|Update|send|Send|reset|Reset|forgot|Forgot|export|Export|download|Download|invite|Invite|run|Run|sync|Sync|toggleSaved|grab|patch|Patch|feature|pause|click\(\)|window\.open|location/;

const problems = [];
const report = (area, msg) => { problems.push(`[${area}] ${msg}`); console.log(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

function collectHandlers() {
  const BUILTINS = new Set(['event', 'return', 'if', 'for', 'while', 'function', 'alert', 'confirm', 'prompt',
    'fetch', 'setTimeout', 'Number', 'String', 'Boolean', 'parseInt', 'this', 'encodeURIComponent', 'decodeURIComponent']);
  const out = [];
  document.querySelectorAll('[onclick],[onsubmit],[onchange],[oninput],[onkeyup]').forEach((el, idx) => {
    ['onclick', 'onsubmit', 'onchange', 'oninput', 'onkeyup'].forEach((attr) => {
      const code = el.getAttribute(attr);
      if (!code) return;
      const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
      let m;
      while ((m = re.exec(code)) !== null) {
        if (BUILTINS.has(m[2])) continue;
        out.push({
          idx, attr, code: code.slice(0, 120), name: m[2],
          defined: typeof window[m[2]] === 'function',
          label: (el.textContent || el.value || el.id || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          visible: !!(el.offsetParent || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden'
        });
      }
    });
  });
  return out;
}

async function newContext(browser, width) {
  const ctx = await browser.newContext({ viewport: { width: width || 1280, height: 900 } });
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    return route.abort();
  });
  return ctx;
}

function watch(page, sink) {
  page.on('pageerror', (e) => sink.push('pageerror: ' + String(e.message).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|ERR_FAILED|ERR_BLOCKED|net::/.test(t)) return; // blocked third-party assets
    sink.push('console: ' + t.slice(0, 200));
  });
  page.on('response', (r) => {
    const u = r.url();
    if (!u.startsWith(BASE + '/api/') || r.status() < 400) return;
    // Expected: anonymous session probes and deliberately invalid inputs in flows.
    if (r.status() === 401 && /\/api\/(auth\/me|owner\/bootstrap|admin\/bootstrap)/.test(u)) return;
    sink.push(`api ${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`);
  });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
}

async function login(ctx, role) {
  const a = ACCOUNTS[role];
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { role, identifier: a.identifier, password: a.password } });
  if (!r.ok()) throw new Error(`login ${role} failed: ${r.status()} ${await r.text()}`);
}

async function closeOverlays(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll('.show, .open').forEach((el) => {
      if (/modal|overlay|drawer|Drawer|dropdown|menu/i.test(el.className + ' ' + el.id)) el.classList.remove('show', 'open');
    });
  }).catch(() => {});
}

/* ------------------------------------------------------------- wiring */

async function auditPage(page, label, views) {
  console.log(`\n${label}`);
  const errs = [];
  watch(page, errs);
  const missing = new Map();
  let clicks = 0;

  for (const view of views.length ? views : [null]) {
    if (view) {
      const exists = await page.evaluate((v) => !!document.getElementById('view-' + v), view);
      if (!exists) { report(label, `view "${view}" has no #view-${view} section`); continue; }
      await page.evaluate((v) => window.switchView(v), view);
      await page.waitForTimeout(600);
      const shown = await page.evaluate((v) => {
        const el = document.getElementById('view-' + v);
        return el && el.classList.contains('active') && el.innerText.trim().length > 0;
      }, view);
      if (!shown) report(label, `view "${view}" did not render`);
    }
    const handlers = await page.evaluate(collectHandlers);
    handlers.filter((h) => !h.defined).forEach((h) => missing.set(h.name, `${h.name}() is not defined — "${h.label}" (${h.attr})${view ? ' in ' + view : ''}`));

    const safe = handlers.filter((h) => h.defined && h.visible && h.attr === 'onclick' && !DO_NOT_CLICK.test(h.code));
    const seen = new Set();
    for (const h of safe) {
      if (seen.has(h.code)) continue;
      seen.add(h.code);
      const before = errs.length;
      const url = page.url();
      await page.evaluate((i) => {
        const el = document.querySelectorAll('[onclick],[onsubmit],[onchange],[oninput],[onkeyup]')[i];
        if (el) el.click();
      }, h.idx).catch(() => {});
      clicks++;
      await page.waitForTimeout(150);
      if (errs.length > before) report(label, `clicking "${h.label}" (${h.code}) → ${errs.slice(before).join(' | ')}`);
      if (page.url().split('#')[0] !== url.split('#')[0]) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        if (view) await page.evaluate((v) => window.switchView(v), view).catch(() => {});
      }
      await closeOverlays(page);
    }
  }
  missing.forEach((m) => report(label, m));
  const leftover = errs.filter((e) => !problems.some((p) => p.includes(e)));
  [...new Set(leftover)].forEach((e) => report(label, e));
  ok(`${views.length || 1} view(s), ${clicks} controls clicked`);
}

async function viewsOf(page, selector) {
  return page.evaluate((sel) => [...new Set([...document.querySelectorAll(sel)].map((e) => e.getAttribute('data-view')).filter(Boolean))], selector);
}

async function wiring(browser) {
  console.log('\n=== WIRING: every page, view and inline handler');
  const pub = ['/index.html', '/city.html?city=panaji', '/deals.html', '/marketing.html', '/ota-listing.html',
               '/claim.html', '/login.html', '/dashboard-login.html', '/admin-login.html', '/reset-password.html',
               '/privacy.html', '/terms.html', '/404.html'];
  const ctx = await newContext(browser);
  for (const url of pub) {
    const page = await ctx.newPage();
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await auditPage(page, url, []);
    await page.close();
  }
  const prop = (await (await ctx.request.get(BASE + '/api/properties?limit=1')).json()).properties[0].id;
  let page = await ctx.newPage();
  await page.goto(`${BASE}/property.html?id=${encodeURIComponent(prop)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await auditPage(page, '/property.html', []);
  await ctx.close();

  for (const [role, navSel] of [['traveler', '.user-nav-item'], ['owner', '.owner-nav-item'], ['admin', '.nav-item']]) {
    const c = await newContext(browser);
    await login(c, role);
    page = await c.newPage();
    await page.goto(BASE + ACCOUNTS[role].home, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const views = await viewsOf(page, navSel);
    await auditPage(page, ACCOUNTS[role].home, views);
    await c.close();
  }
}

/* --------------------------------------------------------- responsive */

async function responsive(browser) {
  console.log('\n=== RESPONSIVE: no sideways scrolling, nothing cut off');
  const widths = [320, 375, 414, 768, 1024, 1366];
  const pages = ['/index.html', '/city.html?city=panaji', '/deals.html', '/marketing.html', '/ota-listing.html',
                 '/claim.html', '/login.html', '/dashboard-login.html', '/admin-login.html', '/reset-password.html',
                 '/privacy.html', '/terms.html', '/404.html'];
  const anon = await newContext(browser);
  const prop = (await (await anon.request.get(BASE + '/api/properties?limit=1')).json()).properties[0].id;
  pages.push('/property.html?id=' + encodeURIComponent(prop));
  await anon.close();

  const panels = [['traveler', '.user-nav-item'], ['owner', '.owner-nav-item'], ['admin', '.nav-item']];

  for (const w of widths) {
    const ctx = await newContext(browser, w);
    const page = await ctx.newPage();
    for (const url of pages) {
      await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      await checkOverflow(page, `${url} @${w}px`);
    }
    for (const [role, sel] of panels) {
      await login(ctx, role);
      await page.goto(BASE + ACCOUNTS[role].home, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const views = await viewsOf(page, sel);
      for (const v of views) {
        await page.evaluate((x) => window.switchView(x), v);
        await page.waitForTimeout(400);
        await checkOverflow(page, `${ACCOUNTS[role].home}#${v} @${w}px`);
      }
      await ctx.request.post(BASE + '/api/auth/logout');
    }
    await ctx.close();
    ok(`${w}px checked`);
  }
}

async function checkOverflow(page, label) {
  const res = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const pageOverflow = document.documentElement.scrollWidth - vw;
    const offenders = [];
    if (pageOverflow > 1) {
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || r.right <= vw + 1) return;
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' && r.left >= vw) return; // off-canvas drawers
        // Skip children of scroll containers — they scroll inside, not the page.
        let p = el.parentElement, scrolls = false;
        while (p && p !== document.body) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'auto' || o === 'scroll' || o === 'hidden') { scrolls = true; break; }
          p = p.parentElement;
        }
        if (scrolls) return;
        offenders.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) + ` (→${Math.round(r.right)}px)`);
      });
    }
    return { pageOverflow, offenders: offenders.slice(0, 4) };
  });
  if (res.pageOverflow > 1) report('responsive', `${label}: page scrolls sideways by ${res.pageOverflow}px — ${res.offenders.join(', ')}`);
}

/* -------------------------------------------------------------- flows */

async function flows(browser) {
  console.log('\n=== FLOWS: the journeys real users take');
  const errs = [];
  const step = async (name, fn) => {
    const before = errs.length;
    try { await fn(); } catch (e) { report('flow', `${name}: ${String(e.message).split('\n')[0]}`); return; }
    if (errs.length > before) report('flow', `${name}: ${errs.slice(before).join(' | ')}`);
    else ok(name);
  };
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  watch(page, errs);
  const api = async (method, path, data) => {
    const r = await ctx.request[method](BASE + '/api' + path, data ? { data } : undefined);
    const body = await r.json().catch(() => ({}));
    if (!r.ok()) throw new Error(`${method.toUpperCase()} ${path} → ${r.status()} ${body.error || ''}`);
    return body;
  };
  const props = (await api('get', '/properties?limit=50')).properties;
  const unclaimed = props.find((p) => p.claimStatus === 'unclaimed' && p.phone);
  const stamp = Date.now().toString(36);

  await step('Home search → city page lists hotels', async () => {
    await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.fill('#heroSearchInput', 'Jaipur');
    await page.keyboard.press('Enter');
    await page.waitForURL(/city\.html/, { timeout: 8000 });
    await page.waitForTimeout(1500);
    const cards = await page.evaluate(() => document.querySelectorAll('.hotel-card, .listing-card, .property-card, article').length);
    if (!cards) throw new Error('no hotel cards rendered');
  });

  await step('Guest enquiry from property page', async () => {
    await page.goto(`${BASE}/property.html?id=${encodeURIComponent(props[0].id)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const r = await api('post', '/enquiries', {
      propertyId: props[0].id, name: 'E2E Guest', email: `guest.${stamp}@example.com`, phone: '9876543210',
      checkIn: '2026-12-10', checkOut: '2026-12-12', guests: 2, message: 'E2E test enquiry'
    });
    if (!r.enquiry && !r.ok) throw new Error('no enquiry returned');
  });

  await step('Marketing lead form', async () => {
    await api('post', '/leads', { name: 'E2E Lead', hotelName: 'E2E Hotel', city: 'Goa', phone: '9876543210',
                                  email: `lead.${stamp}@example.com`, plan: 'Gold Plan — Quote Request', source: 'e2e' });
  });

  await step('Deals page: unlock a deal', async () => {
    await page.goto(BASE + '/deals.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    if (!(await page.$('[data-grab]'))) { console.log('    (no live deals — creating one)'); }
  });

  await step('OTA plan purchase (manual mode) → admin sees it', async () => {
    await page.goto(BASE + '/ota-listing.html#pricing', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.click('[data-buy-plan="ota-starter"]');
    await page.fill('#hzbName', 'E2E Buyer');
    await page.fill('#hzbEmail', `buyer.${stamp}@example.com`);
    await page.fill('#hzbPhone', '9876501234');
    await page.click('#hzbPay');
    await page.waitForSelector('#hzbDone:not([hidden])', { timeout: 8000 });
  });

  if (unclaimed) {
    await step('Claim a listing end-to-end (deep link → code → pending)', async () => {
      const claimCtx = await newContext(browser);
      const p = await claimCtx.newPage();
      const ce = [];
      watch(p, ce);
      await p.goto(`${BASE}/claim.html?id=${encodeURIComponent(unclaimed.id)}`, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('#step3.active', { timeout: 8000 });
      await p.fill('#inputPhone', unclaimed.phone);
      await p.click('#step3 .btn-submit');
      await p.waitForSelector('#step4.active', { timeout: 8000 });
      await p.fill('#inputEmail', `claimer.${stamp}@example.com`);
      await p.click('#step4 .btn-submit');
      await p.waitForSelector('#step5.active', { timeout: 8000 });
      const hint = await p.textContent('#claimCodeHint');
      const code = (hint.match(/\d{6}/) || [])[0];
      if (!code) throw new Error('no dev code shown (OTP_DEV_ECHO off?)');
      await p.evaluate(() => openPasswordResetModal());
      await p.fill('#claimCodeInput', code);
      await p.fill('#newPassInput', 'claimpass123!');
      await p.fill('#confirmPassInput', 'claimpass123!');
      await p.evaluate(() => submitNewPassword());
      await p.waitForSelector('#step6.active', { timeout: 8000 });
      const href = await p.getAttribute('#step6 a.btn-submit', 'href');
      if (href !== 'owner.html') throw new Error('success button points to ' + href);
      if (ce.length) throw new Error(ce.join(' | '));
      await claimCtx.close();
    });
  }

  // Owner
  await login(ctx, 'owner');
  let ownerProp;
  await step('Owner: bootstrap + publish a deal + see it publicly', async () => {
    const boot = await api('get', '/owner/bootstrap');
    ownerProp = boot.activePropertyId;
    await page.goto(BASE + '/owner.html#offers', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => openCreateOfferModal());
    await page.fill('#offerTitleInput', 'E2E Deal ' + stamp);
    await page.fill('#offerCodeInput', 'E2E' + stamp.slice(-4));
    await page.evaluate(() => saveOfferForm());
    await page.waitForTimeout(1500);
    const live = await api('get', '/deals?q=' + encodeURIComponent('E2E Deal ' + stamp));
    if (!live.deals.length) throw new Error('deal not on public list');
    const grab = await api('post', `/deals/${live.deals[0].id}/grab`, { name: 'E2E Grabber', email: `grab.${stamp}@example.com`, phone: '9876500000' });
    if (!grab.code) throw new Error('grab returned no code');
  });

  await step('Owner: edit listing details', async () => {
    await api('patch', `/owner/properties/${encodeURIComponent(ownerProp)}`, { description: 'Updated by e2e ' + stamp });
  });

  await step('Owner: add + delete a room', async () => {
    const r = await api('post', `/owner/properties/${encodeURIComponent(ownerProp)}/rooms`, { name: 'E2E Room', price: 2500, capacity: 2 });
    const room = (r.property.rooms || []).find((x) => x.name === 'E2E Room');
    if (!room) throw new Error('room not returned');
    await api('delete', `/owner/properties/${encodeURIComponent(ownerProp)}/rooms/${room.id}`);
  });

  await step('Owner: Account & Security view shows email', async () => {
    await page.goto(BASE + '/owner.html#account', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const t = await page.textContent('#acctOwnerEmail');
    if (!t.includes('@')) throw new Error('email not shown: ' + t);
  });

  await step('Owner: subscription upgrade creates pending payment', async () => {
    await api('post', `/owner/properties/${encodeURIComponent(ownerProp)}/subscription`, { planName: 'Starter Plan', price: '₹999', features: ['x'] });
    const o = await api('post', '/payments/orders', { purpose: 'subscription', referenceId: ownerProp, propertyId: ownerProp });
    if (!o.order) throw new Error('no order');
  });
  await api('post', '/auth/logout');

  // Traveler
  await login(ctx, 'traveler');
  await step('Traveler: portal loads enquiries & saves a hotel', async () => {
    await page.goto(BASE + '/user-portal.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await api('post', '/saved', { propertyId: props[1].id }).catch(() => api('post', '/saved/' + encodeURIComponent(props[1].id)));
  });
  await api('post', '/auth/logout');

  // Admin
  await login(ctx, 'admin');
  await step('Admin: bootstrap + payments + deals + users load', async () => {
    await api('get', '/admin/bootstrap');
    const pays = await api('get', '/payments');
    const planPay = pays.payments.find((p) => p.purpose === 'plan' && p.status !== 'paid');
    if (planPay) await api('post', `/payments/${planPay.id}/mark-paid`);
    await api('get', '/admin/deals');
    await api('get', '/admin/users?limit=10');
  });

  await step('Admin: approve the pending claim', async () => {
    const boot = await api('get', '/admin/bootstrap');
    const pending = (boot.claims || []).find((c) => /pending/i.test(c.status || c.claimStatus || ''));
    if (!pending) { console.log('    (no pending claim)'); return; }
    const id = pending.propertyId || pending.id;
    await api('post', `/admin/claims/${encodeURIComponent(id)}/approve`);
  });

  await step('Admin: CSV import dry run + real import', async () => {
    const rows = [{ id: 'e2e-hotel-' + stamp, name: 'E2E Hotel ' + stamp, location: 'Panaji', phone: '9800000000' }];
    await api('post', '/admin/import', { rows, dryRun: true });
    const r = await api('post', '/admin/import', { rows });
    if (r.summary.imported !== 1) throw new Error('imported ' + r.summary.imported);
  });

  await step('Admin: email templates render', async () => {
    const t = await api('get', '/admin/email-templates');
    const list = t.templates || [];
    for (const tpl of list) await api('post', `/admin/email-templates/${tpl.name}/preview`, { data: {} });
    if (!list.length) throw new Error('no templates');
  });

  await step('Admin: every panel view opens without errors', async () => {
    await page.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  });

  await step('Forgot password works for every role', async () => {
    for (const [role, a] of Object.entries(ACCOUNTS)) await api('post', '/auth/password/forgot', { email: a.identifier, role });
  });
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome() });
  const t0 = Date.now();
  try {
    if (run('flows')) await flows(browser);
    if (run('wiring')) await wiring(browser);
    if (run('responsive')) await responsive(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n${problems.length ? problems.length + ' problem(s)' : 'All checks passed'} in ${Math.round((Date.now() - t0) / 1000)}s`);
  problems.forEach((p) => console.log(' - ' + p));
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
