'use strict';
/**
 * Input hygiene for every JSON/form request, applied before any route runs.
 *
 * Nothing on Hotelzz is meant to be HTML except an admin's hand-written email
 * body, so angle brackets are removed from every other text field. That stops
 * stored script injection at the door even where a page forgets to escape.
 * Fields that hold links only accept real web addresses (http/https) or our
 * own /uploads/ paths, and the Google Maps id only digits.
 */

// Never touched: secrets compared byte-for-byte, and the admin's own HTML email.
const RAW_KEYS = new Set(['password', 'currentPassword', 'newPassword', 'html', 'signature', 'token']);
const URL_KEY = /(^|_)(url|link|website|image|photo)$|Url$|Link$|Website$|Image$|Photo$|^imageUrl$|^coverPhoto$/i;
const CID_KEY = /^(google_cid|googleCid)$/;
const SAFE_URL = /^(https?:\/\/[^\s"'<>`\\]+|\/uploads\/[\w\-./]+)$/i;

function cleanUrl(v) {
  let s = String(v).trim();
  if (!s) return s;
  if (/^www\.|^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s)) s = 'https://' + s;
  return SAFE_URL.test(s) && !/^\/uploads\/.*\.\./.test(s) ? s : '';
}

function cleanValue(key, v) {
  if (typeof v !== 'string') return v;
  if (RAW_KEYS.has(key)) return v;
  if (CID_KEY.test(key)) return v.replace(/\D/g, '');
  if (URL_KEY.test(key)) return cleanUrl(v);
  return v.replace(/[<>]/g, '');
}

function walk(node, depth) {
  if (depth > 6 || !node || typeof node !== 'object' || Buffer.isBuffer(node)) return node;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      node[i] = typeof node[i] === 'string' ? node[i].replace(/[<>]/g, '') : walk(node[i], depth + 1);
    }
    return node;
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    node[k] = v && typeof v === 'object' ? walk(v, depth + 1) : cleanValue(k, v);
  }
  return node;
}

function sanitizeBody(req, _res, next) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) walk(req.body, 0);
  next();
}

module.exports = { sanitizeBody, cleanUrl };
