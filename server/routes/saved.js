'use strict';
const express = require('express');
const { db } = require('../lib/db');
const A = require('../lib/auth');

const router = express.Router();

router.get('/', A.requireAuth(), (req, res) => {
  const rows = db.prepare(
    `SELECT s.property_id, s.created_at, p.name, p.location, p.city_slug, p.rating, p.image_url
       FROM saved_hotels s LEFT JOIN properties p ON p.id = s.property_id
      WHERE s.user_id = ? ORDER BY s.created_at DESC`
  ).all(req.user.id);

  res.json({
    ok: true,
    ids: rows.map((r) => r.property_id),
    saved: rows.map((r) => ({
      id: r.property_id, name: r.name, location: r.location, city_slug: r.city_slug,
      rating: r.rating, image_url: r.image_url, savedAt: r.created_at
    }))
  });
});

router.post('/:propertyId', A.requireAuth(), (req, res) => {
  db.prepare('INSERT OR IGNORE INTO saved_hotels (user_id, property_id) VALUES (?,?)')
    .run(req.user.id, req.params.propertyId);
  res.status(201).json({ ok: true, saved: true });
});

router.delete('/:propertyId', A.requireAuth(), (req, res) => {
  db.prepare('DELETE FROM saved_hotels WHERE user_id = ? AND property_id = ?')
    .run(req.user.id, req.params.propertyId);
  res.json({ ok: true, saved: false });
});

// Convenience for a heart button: flips the state and reports the new one.
router.post('/:propertyId/toggle', A.requireAuth(), (req, res) => {
  const exists = db.prepare('SELECT 1 FROM saved_hotels WHERE user_id = ? AND property_id = ?')
    .get(req.user.id, req.params.propertyId);
  if (exists) {
    db.prepare('DELETE FROM saved_hotels WHERE user_id = ? AND property_id = ?').run(req.user.id, req.params.propertyId);
    return res.json({ ok: true, saved: false });
  }
  db.prepare('INSERT INTO saved_hotels (user_id, property_id) VALUES (?,?)').run(req.user.id, req.params.propertyId);
  res.json({ ok: true, saved: true });
});

module.exports = router;
