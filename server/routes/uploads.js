'use strict';
const express = require('express');
const { db, uid, audit } = require('../lib/db');
const A = require('../lib/auth');
const { upload, publicUrl, remove, MAX_BYTES } = require('../lib/uploads');
const { invalidateCatalog } = require('./properties');

const router = express.Router();

/** Owners may only touch their own listing; admins may touch any. */
function ownsProperty(user, propertyId) {
  const row = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
  if (!row) return { error: 404 };
  if (user.role !== 'admin' && row.owner_id !== user.id) return { error: 403 };
  return { row };
}

router.post('/properties/:id/photos',
  A.requireAuth('owner', 'admin'),
  (req, res, next) => {
    const { error } = ownsProperty(req.user, req.params.id);
    if (error === 404) return res.status(404).json({ ok: false, error: 'Property not found.' });
    if (error === 403) return res.status(403).json({ ok: false, error: 'Not your property.' });
    next();
  },
  upload.array('photos', 10),
  (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: 'Attach at least one image.' });

    const category = (req.body.category || 'General').slice(0, 40);
    const caption = (req.body.caption || '').slice(0, 200) || null;
    const insert = db.prepare(
      'INSERT INTO photos (id, property_id, url, category, caption) VALUES (?,?,?,?,?)'
    );

    const saved = files.map((f) => {
      const url = publicUrl(f);
      const id = uid('pho');
      insert.run(id, req.params.id, url, category, caption);
      return { id, url, category, size: f.size };
    });

    // First image on an empty listing becomes the cover.
    const property = db.prepare('SELECT image_url FROM properties WHERE id = ?').get(req.params.id);
    if (!property.image_url) {
      db.prepare("UPDATE properties SET image_url = ?, updated_at = datetime('now') WHERE id = ?")
        .run(saved[0].url, req.params.id);
      db.prepare('UPDATE photos SET is_cover = 1 WHERE id = ?').run(saved[0].id);
      invalidateCatalog();
    }

    audit(req.user.id, 'photo.upload', 'property', req.params.id, { count: saved.length }, req.ip);
    res.status(201).json({ ok: true, photos: saved });
  });

router.delete('/properties/:id/photos/:photoId',
  A.requireAuth('owner', 'admin'),
  (req, res) => {
    const { error } = ownsProperty(req.user, req.params.id);
    if (error === 404) return res.status(404).json({ ok: false, error: 'Property not found.' });
    if (error === 403) return res.status(403).json({ ok: false, error: 'Not your property.' });

    const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND property_id = ?')
      .get(req.params.photoId, req.params.id);
    if (!photo) return res.status(404).json({ ok: false, error: 'Photo not found.' });

    db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
    remove(photo.url);
    if (photo.is_cover) {
      const next = db.prepare('SELECT url FROM photos WHERE property_id = ? ORDER BY created_at LIMIT 1')
        .get(req.params.id);
      db.prepare("UPDATE properties SET image_url = ?, updated_at = datetime('now') WHERE id = ?")
        .run(next ? next.url : null, req.params.id);
      if (next) db.prepare('UPDATE photos SET is_cover = 1 WHERE property_id = ? AND url = ?').run(req.params.id, next.url);
      invalidateCatalog();
    }
    audit(req.user.id, 'photo.delete', 'property', req.params.id, { photoId: photo.id }, req.ip);
    res.json({ ok: true });
  });

router.get('/limits', (_req, res) => {
  res.json({ ok: true, maxBytes: MAX_BYTES, maxFiles: 10, types: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] });
});

module.exports = router;
