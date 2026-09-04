'use strict';
const rateLimit = require('express-rate-limit');
const env = require('./env');

// Production limits are strict. Development multiplies them so repeated manual
// testing and the browser test suite don't lock themselves out.
const DEV_MULTIPLIER = 25;

const limiter = (max, windowMinutes) => rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max: env.isProd ? max : max * DEV_MULTIPLIER,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests. Try again later.' }
});

const validate = (schema) => (req, res, next) => {
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ ok: false, error: issue.message, field: issue.path[0] });
  }
  req.body = parsed.data;
  next();
};

const validateQuery = (schema) => (req, res, next) => {
  const parsed = schema.safeParse(req.query || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ ok: false, error: issue.message, field: issue.path[0] });
  }
  req.q = parsed.data;
  next();
};

// Wraps an async handler so a rejected promise reaches the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const slugify = (s) => String(s || '').toLowerCase()
  .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

module.exports = { limiter, validate, validateQuery, wrap, slugify };
