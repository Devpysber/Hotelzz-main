'use strict';
const express = require('express');
const { z } = require('zod');
const { db, uid, audit } = require('../lib/db');
const A = require('../lib/auth');
const { validate, wrap } = require('../lib/http');
const { sendMailAsync } = require('../lib/mailer');
const { invalidateCatalog } = require('./properties');

const router = express.Router();
router.use(A.requireAuth('owner', 'admin'));

const json = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } };

function ownedProperty(req, propertyId) {
  const row = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
  if (!row) return { error: 404 };
  if (req.user.role !== 'admin' && row.owner_id !== req.user.id) return { error: 403 };
  return { row };
}

/** Guard used by every /properties/:id/* route below. */
function guard(req, res, next) {
  const { row, error } = ownedProperty(req, req.params.id);
  if (error === 404) return res.status(404).json({ ok: false, error: 'Property not found.' });
  if (error === 403) return res.status(403).json({ ok: false, error: 'Not your property.' });
  req.property = row;
  next();
}

const mask = (phone) => {
  const s = String(phone || '');
  return s.length > 6 ? s.slice(0, 5) + '••••••' + s.slice(-2) : s;
};

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

/** How complete a listing looks to a guest — drives the progress ring. */
function completeness(p, details, photoCount, roomCount) {
  const checks = [
    p.name, p.location, p.address, p.phone, p.email, p.website, p.image_url,
    details.description, details.category, p.pincode, photoCount > 0, roomCount > 0
  ];
  return pct(checks.filter(Boolean).length, checks.length);
}

function statsFor(propertyId, days) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(views),0) views, COALESCE(SUM(phone_clicks),0) phone_clicks,
            COALESCE(SUM(website_clicks),0) website_clicks
       FROM property_stats WHERE property_id = ? AND day >= date('now', ?)`
  ).get(propertyId, `-${days} days`);
  return row;
}

function shapeProperty(p) {
  const details = json(p.details, {});
  const rooms = db.prepare('SELECT * FROM rooms WHERE property_id = ? ORDER BY created_at').all(p.id);
  const photos = db.prepare('SELECT * FROM photos WHERE property_id = ? ORDER BY is_cover DESC, created_at').all(p.id);
  const offers = db.prepare('SELECT * FROM offers WHERE property_id = ? ORDER BY created_at DESC').all(p.id);
  const reviews = db.prepare('SELECT * FROM reviews WHERE property_id = ? ORDER BY created_at DESC').all(p.id);
  const leads = db.prepare('SELECT * FROM enquiries WHERE property_id = ? ORDER BY sent_at DESC').all(p.id);
  const sub = db.prepare('SELECT * FROM subscriptions WHERE property_id = ?').get(p.id);
  const invoices = db.prepare('SELECT * FROM invoices WHERE property_id = ? ORDER BY issued_at DESC').all(p.id);

  const s30 = statsFor(p.id, 30);
  const s60 = statsFor(p.id, 60);
  const favorites = db.prepare('SELECT COUNT(*) c FROM saved_hotels WHERE property_id = ?').get(p.id).c;
  const growth = (now, prev) => {
    const before = Math.max(prev - now, 0);
    if (!before) return now ? '+100%' : '0%';
    const g = ((now - before) / before) * 100;
    return (g >= 0 ? '+' : '') + g.toFixed(1) + '%';
  };

  return {
    id: p.id,
    name: p.name,
    city: p.location,
    state: details.state || '',
    address: p.address || '',
    locality: details.locality || '',
    pincode: p.pincode || '',
    category: details.category || p.property_type || 'Hotel',
    rating: p.rating,
    reviewCount: reviews.filter((r) => r.status === 'Published').length || p.google_review_count || 0,
    status: p.status_label || 'Published',
    claimedStatus: p.claim_status === 'verified' ? 'Claimed & Verified'
                 : p.claim_status === 'pending' ? 'Claim Pending' : 'Unclaimed',
    completeness: completeness(p, details, photos.length, rooms.length),
    phoneFull: p.phone || '',
    phoneMasked: mask(p.phone),
    email: p.email || '',
    website: p.website || '',
    whatsapp: details.whatsapp || p.phone || '',
    description: details.description || p.google_summary || '',
    checkIn: details.checkIn || '02:00 PM',
    checkOut: details.checkOut || '11:00 AM',
    receptionHours: details.receptionHours || '24 Hours',
    cancellationPolicy: details.cancellationPolicy || '',
    childPolicy: details.childPolicy || '',
    petPolicy: details.petPolicy || '',
    smokingPolicy: details.smokingPolicy || '',
    idPolicy: details.idPolicy || '',
    highlights: details.highlights || [],
    coverPhoto: p.image_url || (photos[0] && photos[0].url) || '',
    gmbLink: p.gmb_link || '',

    kpis: {
      views: s30.views,
      viewsGrowth: growth(s30.views, s60.views),
      phoneClicks: s30.phone_clicks,
      phoneClicksGrowth: growth(s30.phone_clicks, s60.phone_clicks),
      websiteClicks: s30.website_clicks,
      websiteClicksGrowth: growth(s30.website_clicks, s60.website_clicks),
      leads: leads.length,
      leadsGrowth: '+' + leads.filter((l) => l.sent_at >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).length + ' this month',
      favorites: favorites,
      favoritesGrowth: favorites ? '+' + favorites : '0',
      reviewsCount: reviews.length,
      reviewsGrowth: '+' + reviews.filter((r) => r.created_at >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).length + ' this month',
      responseRate: pct(leads.filter((l) => l.status === 'Responded').length, leads.length) + '%'
    },

    visibilityScore: completeness(p, details, photos.length, rooms.length),
    photos: photos.map((ph) => ({
      id: ph.id, url: ph.url, category: ph.category,
      title: ph.caption || ph.category || p.name, isCover: !!ph.is_cover
    })),
    amenities: json(p.amenities, { general: [], recreation: [], dining: [], family: [], business: [] }),
    rooms: rooms.map((r) => ({
      id: r.id, name: r.name, type: r.type || 'Standard',
      priceBase: r.price, priceWeekend: Math.round(r.price * 1.1), priceHoliday: Math.round(r.price * 1.25),
      maxGuests: r.capacity, bedType: r.beds || '—', size: r.size || '—', totalRooms: r.count,
      status: r.active ? 'Published' : 'Hidden',
      photo: (photos[0] && photos[0].url) || p.image_url || '',
      amenities: json(r.amenities, [])
    })),
    leads: leads.map((l) => ({
      id: l.id, guestName: l.guest_name, email: l.guest_email, phone: l.guest_phone || '',
      checkIn: l.check_in, checkOut: l.check_out, guests: l.guests,
      inquiry: l.message || 'No message provided.',
      date: l.sent_at, status: l.status, respondedAt: l.responded_at, response: l.hotel_response
    })),
    reviews: reviews.map((r) => ({
      id: r.id, guestName: r.user_name, rating: r.rating, comment: r.comment,
      ownerReply: r.owner_reply, status: r.status, date: r.created_at
    })),
    offers: offers.map((o) => ({
      id: o.id, title: o.title, description: o.description, discount: o.discount || '—',
      code: o.code, validFrom: o.valid_from || '—', validUntil: o.valid_to || '—',
      rooms: 'All Rooms', views: 0, clicks: 0, status: o.status
    })),
    subscription: {
      planName: sub ? sub.plan_name : 'Free Listing',
      price: sub ? sub.price : '₹0',
      billingCycle: sub ? sub.billing_cycle : 'Monthly',
      status: sub ? sub.status : 'Active',
      renewalDate: sub ? sub.renewal_date : null,
      features: sub ? json(sub.features, []) : ['Standard profile', 'Direct guest enquiries'],
      invoices: invoices.map((i) => ({ id: i.number, number: i.number, amount: i.amount, plan: i.plan, status: i.status, date: i.issued_at }))
    }
  };
}

/** Merged, newest-first feed of enquiries and reviews across the owner's properties. */
function buildActivity(propIds) {
  const marks = propIds.map(() => '?').join(',');
  const enq = db.prepare(
    `SELECT id, guest_name, property_name, sent_at FROM enquiries
      WHERE property_id IN (${marks}) ORDER BY sent_at DESC LIMIT 10`
  ).all(...propIds).map((e) => ({
    title: 'New enquiry from ' + e.guest_name,
    desc: e.property_name,
    time: e.sent_at
  }));
  const rev = db.prepare(
    `SELECT id, user_name, rating, property_name, created_at FROM reviews
      WHERE property_id IN (${marks}) ORDER BY created_at DESC LIMIT 10`
  ).all(...propIds).map((r) => ({
    title: `${r.rating}★ review from ${r.user_name}`,
    desc: r.property_name,
    time: r.created_at
  }));
  return enq.concat(rev).sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, 12);
}

/* --------------------------------------------------------------- bootstrap */

router.get('/bootstrap', (req, res) => {
  const props = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM properties WHERE owner_id IS NOT NULL ORDER BY name LIMIT 25').all()
    : db.prepare('SELECT * FROM properties WHERE owner_id = ? ORDER BY name').all(req.user.id);

  const properties = {};
  props.forEach((p) => { properties[p.id] = shapeProperty(p); });

  const campaigns = db.prepare('SELECT * FROM campaigns WHERE owner_id = ? ORDER BY created_at DESC').all(req.user.id);
  const propIds = props.map((p) => p.id);
  const recentActivity = propIds.length ? buildActivity(propIds) : [];

  res.json({
    ok: true,
    ownerProfile: {
      id: req.user.id,
      name: req.user.name,
      company: req.user.city ? req.user.name + ' — ' + req.user.city : req.user.name,
      email: req.user.email,
      phoneMasked: mask(req.user.phone),
      role: 'Property Owner',
      avatar: (req.user.name || '?').charAt(0).toUpperCase()
    },
    activePropertyId: props.length ? props[0].id : null,
    recentActivity,
    properties,
    campaigns: campaigns.map((c) => ({
      id: c.id, name: c.name, propertyId: c.property_id, channel: c.channel, plan: c.plan,
      budget: c.budget, spend: c.spend, impressions: c.impressions, clicks: c.clicks,
      leads: c.leads_count, status: c.status, startDate: c.start_date, endDate: c.end_date
    }))
  });
});

router.get('/properties/:id', guard, (req, res) => {
  res.json({ ok: true, property: shapeProperty(req.property) });
});

/* ------------------------------------------------------------ profile edit */

router.patch('/properties/:id',
  guard,
  validate(z.object({
    name: z.string().trim().min(2).optional(),
    city: z.string().trim().optional(),
    address: z.string().trim().optional(),
    pincode: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    email: z.string().trim().email().optional().or(z.literal('')),
    website: z.string().trim().optional(),
    coverPhoto: z.string().trim().optional(),
    status: z.enum(['Published', 'Draft', 'Hidden']).optional(),
    details: z.record(z.any()).optional()
  })),
  (req, res) => {
    const b = req.body;
    const p = req.property;
    const details = Object.assign(json(p.details, {}), b.details || {});

    db.prepare(
      `UPDATE properties SET name = COALESCE(?, name), location = COALESCE(?, location),
              address = COALESCE(?, address), pincode = COALESCE(?, pincode),
              phone = COALESCE(?, phone), email = COALESCE(?, email), website = COALESCE(?, website),
              image_url = COALESCE(?, image_url), status_label = COALESCE(?, status_label),
              details = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).run(b.name || null, b.city || null, b.address || null, b.pincode || null, b.phone || null,
          b.email || null, b.website || null, b.coverPhoto || null, b.status || null,
          JSON.stringify(details), p.id);
    invalidateCatalog();

    audit(req.user.id, 'owner.property.update', 'property', p.id, null, req.ip);
    res.json({ ok: true, property: shapeProperty(db.prepare('SELECT * FROM properties WHERE id = ?').get(p.id)) });
  });

router.put('/properties/:id/amenities',
  guard,
  validate(z.object({ amenities: z.record(z.array(z.string())) })),
  (req, res) => {
    db.prepare(`UPDATE properties SET amenities = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(req.body.amenities), req.property.id);
    invalidateCatalog();
    res.json({ ok: true, amenities: req.body.amenities });
  });

/* ------------------------------------------------------------------- rooms */

const roomSchema = z.object({
  name: z.string().trim().min(2, 'Enter a room name'),
  type: z.string().trim().optional(),
  price: z.coerce.number().min(0).default(0),
  capacity: z.coerce.number().int().min(1).default(2),
  count: z.coerce.number().int().min(1).default(1),
  size: z.string().trim().optional(),
  beds: z.string().trim().optional(),
  amenities: z.array(z.string()).optional(),
  active: z.coerce.boolean().optional()
});

router.post('/properties/:id/rooms', guard, validate(roomSchema), (req, res) => {
  const b = req.body;
  const id = uid('room');
  db.prepare(
    `INSERT INTO rooms (id, property_id, name, type, price, capacity, count, size, beds, amenities, active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, req.property.id, b.name, b.type || null, b.price, b.capacity, b.count,
        b.size || null, b.beds || null, JSON.stringify(b.amenities || []), b.active === false ? 0 : 1);
  res.status(201).json({ ok: true, property: shapeProperty(req.property) });
});

router.patch('/properties/:id/rooms/:roomId', guard, validate(roomSchema.partial()), (req, res) => {
  const b = req.body;
  const room = db.prepare('SELECT * FROM rooms WHERE id = ? AND property_id = ?').get(req.params.roomId, req.property.id);
  if (!room) return res.status(404).json({ ok: false, error: 'Room not found.' });
  db.prepare(
    `UPDATE rooms SET name=COALESCE(?,name), type=COALESCE(?,type), price=COALESCE(?,price),
            capacity=COALESCE(?,capacity), count=COALESCE(?,count), size=COALESCE(?,size),
            beds=COALESCE(?,beds), amenities=COALESCE(?,amenities), active=COALESCE(?,active),
            updated_at=datetime('now')
      WHERE id = ?`
  ).run(b.name ?? null, b.type ?? null, b.price ?? null, b.capacity ?? null, b.count ?? null,
        b.size ?? null, b.beds ?? null, b.amenities ? JSON.stringify(b.amenities) : null,
        b.active === undefined ? null : (b.active ? 1 : 0), room.id);
  res.json({ ok: true, property: shapeProperty(req.property) });
});

router.delete('/properties/:id/rooms/:roomId', guard, (req, res) => {
  db.prepare('DELETE FROM rooms WHERE id = ? AND property_id = ?').run(req.params.roomId, req.property.id);
  res.json({ ok: true, property: shapeProperty(req.property) });
});

/* ------------------------------------------------------------------ photos */

router.post('/properties/:id/photos',
  guard,
  validate(z.object({
    url: z.string().trim().min(4, 'Enter an image URL'),
    category: z.string().trim().optional(),
    caption: z.string().trim().optional()
  })),
  (req, res) => {
    const id = uid('pho');
    db.prepare('INSERT INTO photos (id, property_id, url, category, caption) VALUES (?,?,?,?,?)')
      .run(id, req.property.id, req.body.url, req.body.category || 'General', req.body.caption || null);
    res.status(201).json({ ok: true, property: shapeProperty(req.property) });
  });

router.post('/properties/:id/photos/:photoId/cover', guard, (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND property_id = ?').get(req.params.photoId, req.property.id);
  if (!photo) return res.status(404).json({ ok: false, error: 'Photo not found.' });
  db.prepare('UPDATE photos SET is_cover = 0 WHERE property_id = ?').run(req.property.id);
  db.prepare('UPDATE photos SET is_cover = 1 WHERE id = ?').run(photo.id);
  db.prepare(`UPDATE properties SET image_url = ?, updated_at = datetime('now') WHERE id = ?`).run(photo.url, req.property.id);
  invalidateCatalog();
  res.json({ ok: true, property: shapeProperty(db.prepare('SELECT * FROM properties WHERE id = ?').get(req.property.id)) });
});

router.delete('/properties/:id/photos/:photoId', guard, (req, res) => {
  db.prepare('DELETE FROM photos WHERE id = ? AND property_id = ?').run(req.params.photoId, req.property.id);
  res.json({ ok: true, property: shapeProperty(req.property) });
});

/* ------------------------------------------------------------------ offers */

const offerSchema = z.object({
  title: z.string().trim().min(2, 'Enter an offer title'),
  description: z.string().trim().optional(),
  discount: z.string().trim().optional(),
  code: z.string().trim().optional(),
  validFrom: z.string().trim().optional(),
  validTo: z.string().trim().optional(),
  status: z.enum(['Active', 'Scheduled', 'Expired', 'Paused']).optional()
});

router.post('/properties/:id/offers', guard, validate(offerSchema), (req, res) => {
  const b = req.body;
  db.prepare(
    `INSERT INTO offers (id, property_id, title, description, discount, code, valid_from, valid_to, status)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(uid('off'), req.property.id, b.title, b.description || null, b.discount || null,
        b.code || null, b.validFrom || null, b.validTo || null, b.status || 'Active');
  res.status(201).json({ ok: true, property: shapeProperty(req.property) });
});

router.patch('/properties/:id/offers/:offerId', guard, validate(offerSchema.partial()), (req, res) => {
  const b = req.body;
  const offer = db.prepare('SELECT * FROM offers WHERE id = ? AND property_id = ?').get(req.params.offerId, req.property.id);
  if (!offer) return res.status(404).json({ ok: false, error: 'Offer not found.' });
  db.prepare(
    `UPDATE offers SET title=COALESCE(?,title), description=COALESCE(?,description),
            discount=COALESCE(?,discount), code=COALESCE(?,code), valid_from=COALESCE(?,valid_from),
            valid_to=COALESCE(?,valid_to), status=COALESCE(?,status), updated_at=datetime('now')
      WHERE id = ?`
  ).run(b.title ?? null, b.description ?? null, b.discount ?? null, b.code ?? null,
        b.validFrom ?? null, b.validTo ?? null, b.status ?? null, offer.id);
  res.json({ ok: true, property: shapeProperty(req.property) });
});

router.delete('/properties/:id/offers/:offerId', guard, (req, res) => {
  db.prepare('DELETE FROM offers WHERE id = ? AND property_id = ?').run(req.params.offerId, req.property.id);
  res.json({ ok: true, property: shapeProperty(req.property) });
});

/* ----------------------------------------------------- plans / performance */

router.post('/properties/:id/subscription',
  guard,
  validate(z.object({
    planName: z.string().trim().min(2),
    price: z.string().trim().optional(),
    billingCycle: z.string().trim().optional(),
    features: z.array(z.string()).optional()
  })),
  wrap(async (req, res) => {
    const b = req.body;
    const renewal = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    db.prepare(
      `INSERT INTO subscriptions (property_id, plan_name, price, billing_cycle, status, renewal_date, features)
       VALUES (?,?,?,?, 'Active', ?, ?)
       ON CONFLICT(property_id) DO UPDATE SET plan_name=excluded.plan_name, price=excluded.price,
         billing_cycle=excluded.billing_cycle, status='Active', renewal_date=excluded.renewal_date,
         features=excluded.features, updated_at=datetime('now')`
    ).run(req.property.id, b.planName, b.price || '₹0', b.billingCycle || 'Monthly', renewal,
          JSON.stringify(b.features || []));

    // Upgrades are fulfilled manually today, so the invoice starts unpaid.
    const invoiceNumber = 'HZ-' + Date.now().toString().slice(-8);
    db.prepare('INSERT INTO invoices (id, property_id, number, amount, plan, status) VALUES (?,?,?,?,?,?)')
      .run(uid('inv'), req.property.id, invoiceNumber, b.price || '₹0', b.planName, 'Pending');
    db.prepare(`UPDATE properties SET plan = ?, updated_at = datetime('now') WHERE id = ?`).run(b.planName, req.property.id);
    audit(req.user.id, 'owner.subscription.change', 'property', req.property.id, { plan: b.planName }, req.ip);

    const ownerUser = req.property.owner_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(req.property.owner_id) : null;
    if (ownerUser) {
      sendMailAsync(ownerUser.email, 'subscriptionChanged', { name: ownerUser.name, hotelName: req.property.name, planName: b.planName, price: b.price });
      sendMailAsync(ownerUser.email, 'invoiceIssued', { name: ownerUser.name, hotelName: req.property.name, invoiceNumber, amount: b.price || '₹0', planName: b.planName });
    }

    res.json({ ok: true, property: shapeProperty(db.prepare('SELECT * FROM properties WHERE id = ?').get(req.property.id)) });
  }));

router.get('/properties/:id/performance', guard, (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
  const rows = db.prepare(
    `SELECT day, views, phone_clicks, website_clicks
       FROM property_stats WHERE property_id = ? AND day >= date('now', ?)
      ORDER BY day`
  ).all(req.property.id, `-${days} days`);

  const enquiries = db.prepare(
    `SELECT date(sent_at) day, COUNT(*) c FROM enquiries
      WHERE property_id = ? AND sent_at >= date('now', ?) GROUP BY date(sent_at)`
  ).all(req.property.id, `-${days} days`);
  const enqByDay = Object.fromEntries(enquiries.map((e) => [e.day, e.c]));

  res.json({
    ok: true,
    days,
    series: rows.map((r) => ({
      day: r.day, views: r.views, phoneClicks: r.phone_clicks,
      websiteClicks: r.website_clicks, leads: enqByDay[r.day] || 0
    }))
  });
});

/* ---------------------------------------------------------------- invoices */

// A printable invoice. The browser opens it in a tab; Ctrl-P saves a PDF.
router.get('/invoices/:invoiceId', (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? OR number = ?')
    .get(req.params.invoiceId, req.params.invoiceId);
  if (!invoice) return res.status(404).send('Invoice not found.');

  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(invoice.property_id);
  if (!property) return res.status(404).send('Invoice not found.');
  if (req.user.role !== 'admin' && property.owner_id !== req.user.id) {
    return res.status(403).send('This invoice belongs to another partner.');
  }

  const owner = property.owner_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(property.owner_id) : null;
  const payment = db.prepare(
    'SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(invoice.id);
  const esc = (v) => String(v == null ? '' : v)
    .replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Invoice ${esc(invoice.number)} — Hotelzz.in</title>
<style>
  body { font-family: Inter, Segoe UI, Arial, sans-serif; color:#0F172A; margin:0; padding:40px; }
  .sheet { max-width:720px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 4px; }
  .muted { color:#64748B; font-size:13px; }
  table { width:100%; border-collapse:collapse; margin-top:28px; font-size:14px; }
  th, td { text-align:left; padding:12px 10px; border-bottom:1px solid #E2E8F0; }
  th { background:#F8FAFC; font-size:12px; text-transform:uppercase; color:#64748B; }
  .total { font-size:18px; font-weight:800; }
  .badge { display:inline-block; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:700;
           background:${invoice.status === 'Paid' ? '#ECFDF5;color:#047857' : '#FEF3C7;color:#B45309'}; }
  @media print { body { padding:0; } .noprint { display:none; } }
</style></head>
<body><div class="sheet">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <div style="font-size:22px;font-weight:800;color:#2563EB">Hotelzz<span style="color:#0F172A">.in</span></div>
      <div class="muted">India's hotel marketplace &amp; marketing platform</div>
    </div>
    <div style="text-align:right">
      <h1>Invoice ${esc(invoice.number)}</h1>
      <div class="muted">Issued ${esc(invoice.issued_at)}</div>
      <div style="margin-top:6px"><span class="badge">${esc(invoice.status)}</span></div>
    </div>
  </div>

  <table>
    <tr><th>Billed to</th><th>Property</th></tr>
    <tr>
      <td>${esc(owner ? owner.name : '—')}<br/><span class="muted">${esc(owner ? owner.email : '')}</span></td>
      <td>${esc(property.name)}<br/><span class="muted">${esc(property.location || '')}</span></td>
    </tr>
  </table>

  <table>
    <tr><th>Description</th><th style="text-align:right">Amount</th></tr>
    <tr><td>${esc(invoice.plan || 'Hotelzz subscription')}</td><td style="text-align:right">${esc(invoice.amount)}</td></tr>
    <tr><td class="total">Total</td><td class="total" style="text-align:right">${esc(invoice.amount)}</td></tr>
  </table>

  <p class="muted" style="margin-top:24px">
    ${payment && payment.status === 'paid'
      ? 'Paid via ' + esc(payment.provider) + ' on ' + esc(payment.updated_at) + '.'
      : 'Payment pending. Our team will share payment instructions.'}
  </p>

  <p class="muted">Questions? Reply to support@hotelzz.in or call +91 99300 90487.</p>
  <button class="noprint" onclick="window.print()"
    style="margin-top:20px;background:#2563EB;color:#fff;border:none;padding:11px 20px;border-radius:8px;font-weight:700;cursor:pointer">
    Print / save as PDF
  </button>
</div></body></html>`);
});

module.exports = router;
