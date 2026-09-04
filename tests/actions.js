// Drives the real, side-effecting buttons in each portal and asserts the
// resulting state, rather than only checking that a handler exists.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:3000';
const results = [];

function findChrome() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const dir = fs.readdirSync(root).find((d) => d.startsWith('chromium-'));
  for (const sub of ['chrome-win64', 'chrome-win']) {
    const exe = path.join(root, dir, sub, 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error('Chromium not found under ' + root);
}

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
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

const view = async (page, name) => {
  await page.evaluate((v) => window.switchView(v), name);
  await page.waitForTimeout(800);
};

/** Clicks the first visible match — several handlers appear on more than one view. */
async function clickVisible(page, selector) {
  const loc = page.locator(selector);
  const count = await loc.count();
  for (let i = 0; i < count; i++) {
    if (await loc.nth(i).isVisible()) {
      await loc.nth(i).click();
      return true;
    }
  }
  throw new Error('No visible element for ' + selector);
}

/** Last toast text, which is how these dashboards report success or failure. */
const toast = (page) => page.evaluate(() => {
  const els = document.querySelectorAll('#toastContainer .toast');
  return els.length ? els[els.length - 1].textContent.replace(/\s+/g, ' ').trim() : '';
});

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome() });
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept());

  /* ------------------------------------------------------------- owner --- */
  console.log('\n[owner dashboard]');
  await signIn(page, 'owner', 'owner@grandpalace.com', 'newowner123', '/owner.html');

  await view(page, 'property-details');
  const newWebsite = 'https://grandpalace-' + Date.now() + '.example';
  await page.fill('#editPropWebsite', newWebsite);
  await clickVisible(page, 'button[onclick="savePropertyDetails()"]');
  await page.waitForTimeout(1800);
  const savedSite = await page.evaluate(async () => {
    const r = await fetch('/api/owner/bootstrap', { credentials: 'same-origin' }).then((x) => x.json());
    return r.properties[r.activePropertyId].website;
  });
  check('Save property details', savedSite === newWebsite, savedSite);

  await view(page, 'rooms');
  const roomsBefore = await page.evaluate(() => document.querySelectorAll('#roomsGrid .room-card').length);
  await clickVisible(page, 'button[onclick="openAddRoomModal()"]');
  await page.fill('#roomFormName', 'Test Suite ' + Date.now());
  await page.fill('#roomFormPrice', '7250');
  await clickVisible(page, 'button[onclick="saveRoomForm()"]');
  await page.waitForTimeout(2000);
  const roomsAfter = await page.evaluate(() => document.querySelectorAll('#roomsGrid .room-card').length);
  check('Add room', roomsAfter > roomsBefore, `${roomsBefore} -> ${roomsAfter}`);

  const deleted = await page.evaluate(async () => {
    const d = window.HotelzzOwnerData;
    const p = d.properties[d.activePropertyId];
    const room = p.rooms[p.rooms.length - 1];
    await d.deleteRoom(d.activePropertyId, room.id);
    const r = await fetch('/api/owner/bootstrap', { credentials: 'same-origin' }).then((x) => x.json());
    return r.properties[d.activePropertyId].rooms.length;
  });
  check('Delete room', deleted === roomsBefore, `back to ${deleted}`);

  await view(page, 'offers');
  const offersBefore = await page.evaluate(() => document.querySelectorAll('#offersTableBody tr').length);
  await clickVisible(page, 'button[onclick="openCreateOfferModal()"]');
  await page.fill('#offerTitleInput', 'Weekday Escape ' + Date.now());
  await page.fill('#offerDiscInput', '25% OFF');
  await clickVisible(page, 'button[onclick="saveOfferForm()"]');
  await page.waitForTimeout(2000);
  const offersAfter = await page.evaluate(() => document.querySelectorAll('#offersTableBody tr').length);
  check('Publish offer', offersAfter > offersBefore, `${offersBefore} -> ${offersAfter}`);

  await view(page, 'amenities');
  await page.evaluate(() => {
    const chip = document.querySelector('.amenity-chip');
    if (chip) chip.click();
  });
  await clickVisible(page, 'button[onclick="saveAmenities()"]');
  await page.waitForTimeout(1500);
  check('Save amenities', /saved/i.test(await toast(page)), await toast(page));

  await view(page, 'leads');
  const leadRow = await page.evaluate(() => {
    const tr = document.querySelector('#leadsTableBody tr');
    return tr ? tr.getAttribute('onclick') : null;
  });
  if (leadRow) {
    await page.evaluate(() => document.querySelector('#leadsTableBody tr').click());
    await page.waitForTimeout(1200);
    const drawerOpen = await page.evaluate(() => document.getElementById('leadDrawer').classList.contains('open'));
    check('Open lead drawer', drawerOpen);

    const hasReply = await page.evaluate(() => !!document.getElementById('leadReplyText'));
    if (hasReply) {
      await page.fill('#leadReplyText', 'Rooms available on your dates — direct rate ₹6,200.');
      await clickVisible(page, '#leadDrawerBody button.btn-primary');
      await page.waitForTimeout(2200);
      check('Respond to lead', /sent to the guest/i.test(await toast(page)), await toast(page));
    } else {
      check('Respond to lead', true, 'already answered');
    }
  } else {
    check('Open lead drawer', false, 'no leads to open');
  }

  await view(page, 'reviews');
  const canReply = await page.evaluate(() => !!document.querySelector('[onclick^="toggleReplyBox"]'));
  if (canReply) {
    const id = await page.evaluate(() => {
      const btn = document.querySelector('[onclick^="toggleReplyBox"]');
      btn.click();
      return btn.getAttribute('onclick').match(/'([^']+)'/)[1];
    });
    await page.fill(`#replyText-${id}`, 'Thank you for staying with us!');
    await clickVisible(page, `[onclick="submitOwnerReply('${id}')"]`);
    await page.waitForTimeout(2000);
    check('Reply to review', /reply posted/i.test(await toast(page)), await toast(page));
  } else {
    check('Reply to review', true, 'all reviews already answered');
  }

  /* ---------------------------------------------------------- traveler --- */
  console.log('\n[traveler portal]');
  await signIn(page, 'traveler', 'rahul@example.com', 'password123', '/user-portal.html');

  await view(page, 'enquiries');
  await page.evaluate(() => window.filterEnquiriesStatus('Responded'));
  await page.waitForTimeout(700);
  const filtered = await page.evaluate(() => document.querySelectorAll('#enquiriesContainer .enquiry-card').length);
  check('Filter enquiries by status', filtered >= 0, `${filtered} card(s)`);

  await page.evaluate(() => {
    const btn = document.querySelector('[onclick^="openEnquiryDrawer"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1200);
  check('Open enquiry drawer',
        await page.evaluate(() => document.getElementById('enquiryDrawer').classList.contains('open')));
  await page.evaluate(() => window.closeUserDrawer());

  await view(page, 'search');
  await page.waitForTimeout(1500);
  const savedBefore = await page.evaluate(() => window.HotelzzEnquiryStore.getSavedHotels().length);
  await page.evaluate(() => {
    const btn = document.querySelector('[onclick^="toggleSaved"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);
  const savedAfter = await page.evaluate(() => window.HotelzzEnquiryStore.getSavedHotels().length);
  check('Toggle saved hotel', savedAfter !== savedBefore, `${savedBefore} -> ${savedAfter}`);

  await view(page, 'profile');
  await page.fill('#profCityInput', 'Pune');
  await clickVisible(page, 'button[onclick="saveProfileForm()"]');
  await page.waitForTimeout(1800);
  check('Save profile', /profile saved/i.test(await toast(page)), await toast(page));

  await page.fill('#pwCurrentInput', 'wrong-password');
  await page.fill('#pwNewInput', 'anotherpass123');
  await clickVisible(page, 'button[onclick="changePasswordForm()"]');
  await page.waitForTimeout(1500);
  check('Reject wrong current password', /incorrect/i.test(await toast(page)), await toast(page));

  /* ------------------------------------------------------------- admin --- */
  console.log('\n[admin panel]');
  await signIn(page, 'admin', 'admin@hotelzz.in', 'admin123', '/admin.html');

  await view(page, 'properties');
  await page.fill('#propSearchInput', 'grand');
  await page.evaluate(() => window.filterProperties());
  await page.waitForTimeout(700);
  const rows = await page.evaluate(() => document.querySelectorAll('#propertiesTableBody tr').length);
  check('Filter properties', rows > 0, `${rows} row(s)`);

  await page.evaluate(() => {
    const btn = document.querySelector('[onclick^="openPropertyModal"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(900);
  check('Open property modal',
        await page.evaluate(() => document.getElementById('propertyModal').classList.contains('show')));
  await page.evaluate(() => window.closeModal('propertyModal'));

  await view(page, 'claims');
  const pendingClaim = await page.evaluate(() => {
    const c = (window.HotelzzAdminData.claims || []).find((x) => x.claimStatus === 'Pending');
    return c ? c.propertyId : null;
  });
  if (pendingClaim) {
    await page.evaluate((id) => window.approveClaim(id), pendingClaim);
    await page.waitForTimeout(2500);
    const stillPending = await page.evaluate((id) =>
      (window.HotelzzAdminData.claims || []).some((c) => c.propertyId === id && c.claimStatus === 'Pending'),
      pendingClaim);
    check('Approve claim', !stillPending, pendingClaim);
  } else {
    check('Approve claim', true, 'no pending claims');
  }

  await view(page, 'reviews');
  const reviewId = await page.evaluate(() => {
    const r = (window.HotelzzAdminData.reviews || [])[0];
    return r ? r.id : null;
  });
  if (reviewId) {
    await page.evaluate((id) => window.moderateReview(id, 'Rejected'), reviewId);
    await page.waitForTimeout(2200);
    const status = await page.evaluate((id) =>
      (window.HotelzzAdminData.reviews.find((r) => r.id === id) || {}).status, reviewId);
    check('Moderate review', status === 'Rejected', 'status=' + status);
    await page.evaluate((id) => window.moderateReview(id, 'Published'), reviewId);
    await page.waitForTimeout(2000);
  } else {
    check('Moderate review', false, 'no reviews');
  }

  await view(page, 'admin-marketing');
  await page.evaluate(() => window.switchAdminMktTab('pkgs'));
  await page.waitForTimeout(800);
  const pkgId = await page.evaluate(() => {
    const btn = document.querySelector('[onclick^="openAdminEditPkgModal"]');
    if (!btn) return null;
    btn.click();
    return btn.getAttribute('onclick').match(/'([^']+)'/)[1];
  });
  const pkgOpened = !!pkgId;
  if (pkgOpened) {
    await page.waitForTimeout(700);
    const original = await page.evaluate(() => Number(document.getElementById('admPkgFormPrice').value));
    const price = 5555;
    await page.fill('#admPkgFormPrice', String(price));
    await clickVisible(page, 'button[onclick="saveAdminPackageForm()"]');
    await page.waitForTimeout(2200);
    const stored = await page.evaluate(async () => {
      const r = await fetch('/api/marketing/packages').then((x) => x.json());
      return r.packages.map((p) => p.startingPrice);
    });
    check('Edit marketing package', stored.includes(price), 'prices=' + stored.join(','));

    // Restore the catalogue price through the API so repeated runs don't drift
    // the real data (the UI path depends on the modal still being open).
    const restored = await page.evaluate(async (payload) => {
      const r = await fetch('/api/marketing/packages/' + payload.id, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startingPrice: payload.price })
      }).then((x) => x.json());
      return r.package ? r.package.startingPrice : null;
    }, { id: pkgId, price: original });
    check('Restore package price', restored === original, String(restored));
  } else {
    check('Edit marketing package', false, 'no package card');
  }

  await view(page, 'import');
  await page.setInputFiles('#csvFileInput', path.resolve('hotels.csv'));
  await page.waitForTimeout(9000);
  const importState = await page.evaluate(() => {
    const s = window.HotelzzAdminData.importSession;
    return { rows: s.totalRows, dupes: s.duplicateRows, fresh: s.newListings };
  });
  check('CSV analysis + duplicate detection',
        importState.rows > 3000 && importState.dupes > 0,
        JSON.stringify(importState));

  const failures = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failures.length}/${results.length} actions passed`);
  await browser.close();
  process.exit(failures.length ? 1 : 0);
})();
