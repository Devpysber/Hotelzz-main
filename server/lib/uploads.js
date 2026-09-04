'use strict';
/**
 * Image uploads.
 *
 * Files land in `data/uploads/<yyyy-mm>/` and are served read-only from
 * `/uploads/...`. Keeping them outside the repo means a redeploy never wipes
 * partner photos, and the served path is stable so stored URLs stay valid.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const env = require('./env');

const UPLOAD_ROOT = path.resolve(process.cwd(), env.UPLOAD_DIR);
const MAX_BYTES = env.UPLOAD_MAX_MB * 1024 * 1024;

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif'
};

fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

function monthDir() {
  const dir = path.join(UPLOAD_ROOT, new Date().toISOString().slice(0, 7));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try { cb(null, monthDir()); } catch (err) { cb(err); }
  },
  filename: (_req, file, cb) => {
    // Never trust the client filename — generate our own.
    cb(null, crypto.randomBytes(16).toString('hex') + (ALLOWED[file.mimetype] || '.bin'));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED[file.mimetype]) {
      return cb(Object.assign(new Error('Only JPG, PNG, WebP or AVIF images are allowed.'), { status: 400 }));
    }
    cb(null, true);
  }
});

/** Public URL for a stored file, relative so it works on any host. */
function publicUrl(file) {
  const rel = path.relative(UPLOAD_ROOT, file.path).split(path.sep).join('/');
  return '/uploads/' + rel;
}

/** Deletes a previously uploaded file, ignoring anything outside the store. */
function remove(url) {
  if (!url || !url.startsWith('/uploads/')) return false;
  const target = path.resolve(UPLOAD_ROOT, url.slice('/uploads/'.length));
  if (!target.startsWith(UPLOAD_ROOT)) return false;
  try { fs.unlinkSync(target); return true; } catch (_) { return false; }
}

module.exports = { upload, publicUrl, remove, UPLOAD_ROOT, MAX_BYTES };
