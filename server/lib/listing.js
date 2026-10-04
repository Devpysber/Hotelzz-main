'use strict';
/**
 * The owner-editable listing content shown on the public property page
 * (property.html) — one definition shared by the owner dashboard
 * (routes/owner.js) and the public API (routes/properties.js), so the editor
 * and the page always show the same values and the same defaults.
 */
const { db } = require('./db');

const json = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } };

// What the property page shows until the owner sets their own policy.
const DEFAULT_POLICIES = {
  checkIn: '2:00 PM onwards',
  checkOut: '11:00 AM',
  cancellationPolicy: 'Free cancellation up to 48hrs before check-in',
  paymentPolicy: 'Pay 25% to confirm · balance at check-in',
  idPolicy: 'Valid government photo ID for all guests',
  childPolicy: 'Allowed · contact host for extra bedding'
};

/** Policies in display order; pets/smoking only appear once the owner fills them. */
function policies(details) {
  const d = details || {};
  const pick = (k) => (d[k] && String(d[k]).trim()) || DEFAULT_POLICIES[k] || '';
  return [
    { key: 'checkIn', label: 'Check-in', value: pick('checkIn') },
    { key: 'checkOut', label: 'Check-out', value: pick('checkOut') },
    { key: 'cancellationPolicy', label: 'Cancellation', value: pick('cancellationPolicy') },
    { key: 'paymentPolicy', label: 'Payment', value: pick('paymentPolicy') },
    { key: 'idPolicy', label: 'ID required', value: pick('idPolicy') },
    { key: 'childPolicy', label: 'Children', value: pick('childPolicy') },
    { key: 'petPolicy', label: 'Pets', value: pick('petPolicy') },
    { key: 'smokingPolicy', label: 'Smoking', value: pick('smokingPolicy') }
  ].filter((p) => p.value);
}

/** Lowest active room rate, else the owner's "starting price per night". */
function startingPrice(p, details) {
  const room = db.prepare(
    'SELECT MIN(price) m FROM rooms WHERE property_id = ? AND active = 1 AND price > 0'
  ).get(p.id).m;
  const own = Number((details || {}).startingPrice) || 0;
  return room || own || null;
}

/** Everything property.html needs beyond the catalogue row. */
function publicListing(p) {
  const details = json(p.details, {});
  const photos = db.prepare(
    'SELECT url FROM photos WHERE property_id = ? ORDER BY is_cover DESC, created_at'
  ).all(p.id).map((r) => r.url);
  if (p.image_url && !photos.includes(p.image_url)) photos.unshift(p.image_url);

  let amenities = [];
  const parsed = json(p.amenities, null);
  if (Array.isArray(parsed)) amenities = parsed;
  else if (parsed && typeof parsed === 'object') amenities = Object.values(parsed).flat();

  return {
    description: (details.description && String(details.description).trim()) || '',
    propertyType: details.category || p.property_type || '',
    photos,
    amenities: amenities.filter(Boolean),
    policies: policies(details),
    startingPrice: startingPrice(p, details)
  };
}

module.exports = { DEFAULT_POLICIES, policies, publicListing };
