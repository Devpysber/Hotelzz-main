// Backend regression checks (API only, no browser) for bugs found in the
// end-to-end review: payments, plans, campaigns, email content, owner rights.
//
//   npm start               (NODE_ENV=development, no Razorpay keys)
//   node tests/backend.js   (HZ_BASE to override)
const { BASE } = require('./_browser');

let failed = 0;
const check = (cond, m) => { if (cond) console.log('  ✓ ' + m); else { failed++; console.log('  ✗ ' + m); } };

function session() {
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(BASE + '/api' + path, {
      method, headers: Object.assign({ Cookie: cookie }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined, redirect: 'manual'
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: r.status, json: json || {}, text };
  };
  return { call, login: (identifier, password, role) => call('POST', '/auth/login', { identifier, password, role }) };
}

const BAD = /undefined|\bnull\b|NaN|\[object Object\]/;

(async () => {
  const admin = session();
  const owner = session();
  check((await admin.login('admin@hotelzz.in', 'admin123', 'admin')).status === 200, 'admin signs in');
  check((await owner.login('owner@grandpalace.com', 'owner12345', 'owner')).status === 200, 'owner signs in');
  const boot = (await owner.call('GET', '/owner/bootstrap')).json;
  const prop = Object.values(boot.properties || {})[0];
  check(!!prop, 'owner has a property');
  const pid = prop.id;
  const plans = ((await admin.call('GET', '/admin/plans')).json.plans || []).filter((p) => p.price > 0).sort((a, b) => a.price - b.price);
  const cheap = plans[0];
  const dear = plans[plans.length - 1];

  console.log('Plans and payments');
  await owner.call('POST', `/owner/properties/${pid}/subscription`, { planName: cheap.name });
  const o1 = await owner.call('POST', '/payments/orders', { purpose: 'subscription', referenceId: 'x', propertyId: pid });
  check(o1.status === 201 && o1.json.order.amount === cheap.price, `order for ${cheap.name} is ₹${cheap.price}`);
  const again = await owner.call('POST', '/payments/orders', { purpose: 'subscription', referenceId: 'x', propertyId: pid });
  check(again.json.order && again.json.order.paymentId === o1.json.order.paymentId, '"Pay now" twice reuses the open order');
  await owner.call('POST', `/owner/properties/${pid}/subscription`, { planName: dear.name });
  const paidStale = await admin.call('POST', `/payments/${o1.json.order.paymentId}/mark-paid`);
  check(paidStale.status === 200 && paidStale.json.payment.needsReview, 'paying the old cheap order is flagged for review');
  const sub1 = (await owner.call('GET', '/owner/bootstrap')).json.properties[pid].subscription;
  check(!(sub1.planName === dear.name && sub1.status === 'Active'), `${dear.name} not activated by the ₹${cheap.price} payment (now: ${sub1.planName}, ${sub1.status})`);
  const o2 = await owner.call('POST', '/payments/orders', { purpose: 'subscription', referenceId: 'x', propertyId: pid });
  check(o2.json.order && o2.json.order.amount === dear.price, `new order for ${dear.name} is ₹${dear.price}`);
  check((await admin.call('POST', `/payments/${o2.json.order.paymentId}/mark-paid`)).status === 200, 'admin marks the right order paid');
  const pays = (await admin.call('GET', '/payments')).json.payments;
  const p2 = pays.find((p) => p.id === o2.json.order.paymentId);
  check(p2 && p2.status === 'paid' && !p2.needsReview, 'matching payment settles cleanly');
  const sub2 = (await owner.call('GET', '/owner/bootstrap')).json.properties[pid].subscription;
  check(sub2.planName === dear.name && sub2.status === 'Active', `${dear.name} active after paying its own order`);

  console.log('Campaigns');
  const custom = await owner.call('POST', '/marketing/campaigns', { propertyId: pid, packageId: 'pkg-whatsapp', durationLabel: 'Custom Campaign', durationDays: 400 });
  check(custom.status === 400, 'custom-length campaign cannot be bought at a flat price');
  const ids = new Set();
  let errors = 0;
  for (let i = 0; i < 40; i++) {
    const c = await owner.call('POST', '/marketing/campaigns', { propertyId: pid, packageId: 'pkg-whatsapp', durationLabel: '10 Days' });
    if (c.status !== 201) errors++; else ids.add((c.json.campaign || {}).id);
  }
  check(!errors && ids.size === 40, '40 campaigns in a row get unique ids');
  const cid = [...ids][0];
  const co = await owner.call('POST', '/payments/orders', { purpose: 'campaign', referenceId: cid, propertyId: pid });
  await admin.call('POST', `/payments/${co.json.order.paymentId}/mark-paid`);
  check((await owner.call('POST', '/payments/orders', { purpose: 'campaign', referenceId: cid, propertyId: pid })).status === 409, 'a paid campaign cannot be ordered again');

  console.log('Email content');
  await admin.call('PUT', '/admin/settings', { notifyEmail: 'ops-test@hotelzz.in' });
  await fetch(BASE + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Lead Only', phone: '9876543210', type: 'ota-listing' }) });
  await new Promise((r) => setTimeout(r, 400));
  const log = (await admin.call('GET', '/admin/emails?limit=200')).json;
  const emails = log.emails || log.rows || [];
  const leadMail = emails.find((e) => /lead/i.test(e.subject || '') && /ops-test@hotelzz\.in/.test(e.to || e.toAddr || e.to_addr || ''));
  check(!!leadMail, 'ops copy goes to the "notification email" setting');
  const dirty = emails.filter((e) => BAD.test((e.subject || '') + ' ' + (e.preview || '')));
  check(!dirty.length, 'no undefined/null/NaN in sent emails' + (dirty.length ? ': ' + dirty.slice(0, 3).map((e) => e.subject).join(' | ') : ''));
  const prev = await admin.call('POST', '/admin/email-templates/purchaseConfirmation/preview', { to: 'owner@grandpalace.com' });
  check(prev.status === 200 && !BAD.test(prev.json.text || '') && !/Priya Nair|pay_abc123/.test(prev.json.text || ''), 'Email Center preview uses real data, no samples');
  await admin.call('PUT', '/admin/settings', { notifyEmail: 'admin@hotelzz.in' });

  console.log('Owner panel');
  const P = `/owner/properties/${pid}`;
  await owner.call('PATCH', P, { website: 'https://example.com', address: 'Old address 1' });
  await owner.call('PATCH', P, { website: '', address: '' });
  const cleared = (await owner.call('GET', '/owner/bootstrap')).json.properties[pid];
  check(!cleared.website && !cleared.address, 'emptied listing fields are cleared');
  const room = await owner.call('POST', P + '/rooms', { name: 'Deluxe', price: 3000, capacity: 3, count: 4 });
  const rid = room.json.property.rooms.find((r) => r.name === 'Deluxe').id;
  const patched = await owner.call('PATCH', P + '/rooms/' + rid, { size: '300 sq ft', active: 'false' });
  const r2 = patched.json.property.rooms.find((r) => r.id === rid);
  check(r2.priceBase === 3000 && r2.maxGuests === 3 && r2.totalRooms === 4, 'room edit keeps price, guests and count');
  check(r2.status === 'Hidden', 'room active "false" hides the room');
  await owner.call('POST', P + '/offers', { title: 'Test offer', originalPrice: 5000, dealPrice: 4000 });
  let off = (await owner.call('GET', '/owner/bootstrap')).json.properties[pid].offers.find((o) => o.title === 'Test offer');
  await owner.call('PATCH', P + '/offers/' + off.id, { originalPrice: null, dealPrice: null });
  off = (await owner.call('GET', '/owner/bootstrap')).json.properties[pid].offers.find((o) => o.id === off.id);
  check(!off.originalPrice && !off.dealPrice, 'offer prices can be cleared');
  await owner.call('POST', P + '/photos', { url: 'https://example.com/a.jpg' });
  await owner.call('POST', P + '/photos', { url: 'https://example.com/b.jpg' });
  let photos = (await owner.call('GET', '/owner/bootstrap')).json.properties[pid].photos;
  const first = photos.find((x) => /a\.jpg/.test(x.url || x.src || ''));
  await owner.call('POST', P + '/photos/' + first.id + '/cover');
  const afterDel = await owner.call('DELETE', P + '/photos/' + first.id);
  const cov = afterDel.json.property.coverPhoto || '';
  check(!/a\.jpg/.test(cov), 'deleting the cover photo moves the cover on (now ' + (cov || 'none') + ')');

  console.log('Pending claim privacy');
  const traveler = session();
  await traveler.login('rahul@example.com', 'password123', 'traveler');
  const target = (await fetch(BASE + '/api/properties?limit=50&claimStatus=unclaimed').then((r) => r.json())).properties.find((p) => !p.ownerId);
  const enq = await traveler.call('POST', '/enquiries', { propertyId: target.id, name: 'Guest Secret', email: 'secret@example.com', phone: '9876500000', checkIn: '2026-12-01', checkOut: '2026-12-03', guests: 2, message: 'Private message' });
  check(enq.status === 201, 'guest enquiry for an unclaimed listing is saved');
  const bob = session();
  const tail = String(Date.now()).slice(-8);
  await bob.call('POST', '/auth/register/owner', { hotelName: 'Bob Inn', city: 'Goa', name: 'Bob Test', phone: '98' + tail, email: `bob${tail}@example.com`, password: 'bobpassword1' });
  check((await bob.call('POST', `/properties/${encodeURIComponent(target.id)}/claim`, {})).status === 200, 'second owner files a claim');
  const peek = await bob.call('GET', `/owner/properties/${encodeURIComponent(target.id)}`);
  const leaked = JSON.stringify(peek.json).includes('secret@example.com');
  check(!leaked, 'pending claimant cannot see guest contact details');
  await admin.call('POST', `/admin/claims/${encodeURIComponent(target.id)}/approve`);
  const after = await bob.call('GET', `/owner/properties/${encodeURIComponent(target.id)}`);
  check(JSON.stringify(after.json).includes('secret@example.com'), 'once approved, the owner does see the enquiry');

  console.log('Traveler and auth');
  check((await traveler.call('POST', '/reviews', { propertyId: target.id, rating: 1 })).status === 400, 'review without an answered enquiry is refused');
  check((await traveler.call('POST', '/reviews', { propertyId: 'nope-not-real', rating: 1, propertyName: 'Fake' })).status === 404, 'review for a made-up property is refused');
  check((await fetch(BASE + '/api/deals?sort=constructor')).status === 200, 'deals ?sort=constructor no longer 500s');
  const pct = await fetch(BASE + '/api/properties?q=%25&limit=1').then((r) => r.json());
  check(pct.total === 0, '"%" search is literal (' + pct.total + ' results)');
  check((await traveler.call('POST', '/saved/not-a-property')).status === 404, 'saving an unknown property is refused');
  const anon = session();
  check((await anon.call('POST', '/auth/register/traveler', { name: 'Clone', email: `clone${tail}@example.com`, phone: '+91 98201 44512', password: 'password123' })).status === 409, 'second account with the same phone is refused');
  check((await anon.call('POST', '/auth/register/traveler', { name: 'Letters', email: `letters${tail}@example.com`, phone: 'abcdefghij', password: 'password123' })).status === 400, 'phone without digits is refused');
  await anon.call('POST', '/auth/password/forgot', { email: 'rahul@example.com', role: 'traveler' });
  for (let i = 0; i < 6; i++) await anon.call('POST', '/auth/password/reset', { email: 'rahul@example.com', token: 'x'.repeat(40), password: 'whatever123' });
  const resetMail = ((await admin.call('GET', '/admin/emails?limit=50')).json.emails || []).find((e) => /reset/i.test(e.subject || '') && /rahul@example\.com/.test(e.to || e.toAddr || e.to_addr || ''));
  const full = resetMail ? (await admin.call('GET', '/admin/emails/' + resetMail.id)).json : {};
  const tok = (JSON.stringify(full).match(/token=([a-f0-9]{64})/) || [])[1];
  const okReset = tok ? await anon.call('POST', '/auth/password/reset', { email: 'rahul@example.com', token: tok, password: 'password123' }) : { status: 0 };
  check(okReset.status === 200, 'wrong guesses no longer burn a real reset link');
  const otp = await anon.call('POST', '/auth/otp/request', { identifier: '+91 98201 44512', role: 'traveler' });
  const otpOk = otp.json.devCode ? await anon.call('POST', '/auth/otp/verify', { identifier: '9820144512', code: otp.json.devCode, role: 'traveler' }) : { status: 'no dev code' };
  check(!otp.json.devCode || otpOk.status === 200, 'OTP works whichever way the phone is written');

  console.log('Admin');
  const imp = await admin.call('POST', '/admin/import', { rows: [{ id: 'dupx-' + tail, name: 'Dup One' }, { id: 'dupx-' + tail, name: 'Dup Two' }] });
  check(imp.json.summary && imp.json.summary.imported === 1 && imp.json.summary.duplicates === 1, 'import counts a repeated id once');
  check((await admin.call('POST', `/admin/claims/${encodeURIComponent('dupx-' + tail)}/approve`)).status === 409, 'approving a listing with no pending claim is refused');
  check((await admin.call('PUT', '/admin/sitekit', { redirects: [{ from: '/admin-login.html', to: 'https://example.com/' }] })).status === 400, 'admin sign-in page cannot be redirected away');
  await admin.call('PUT', '/admin/sitekit', { pages: { '/city.html?city=Goa': { title: 'Goa Override Title | Hotelzz', description: '', noindex: false } } });
  const goa = await fetch(BASE + '/city.html?city=goa').then((r) => r.text());
  check(/Goa Override Title/.test(goa), 'Site Kit override saved as ?city=Goa applies to ?city=goa');
  await admin.call('PUT', '/admin/sitekit', { pages: {} });
  check((await admin.call('POST', '/admin/deals', { propertyId: pid, title: 'Bad dates', validFrom: '01/10/2026', validTo: '2026-12-31' })).status === 400, 'deal with a non-ISO date is refused');
  check((await admin.call('POST', '/admin/deals', { propertyId: pid, title: 'Reversed', validFrom: '2026-12-31', validTo: '2026-01-01' })).status === 400, 'deal ending before it starts is refused');
  const adminId = (await admin.call('GET', '/auth/me')).json.user.id;
  check((await admin.call('POST', `/admin/users/${adminId}/credentials`, { password: 'admin123' })).status === 400, 'weak admin password refused when set by another admin');
  check((await admin.call('PUT', '/admin/settings', { notifyEmail: '' })).status === 200, 'notification email can be cleared');
  await admin.call('PUT', '/admin/settings', { notifyEmail: 'admin@hotelzz.in' });

  console.log(failed ? `\n${failed} check(s) failed` : '\nAll backend checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
