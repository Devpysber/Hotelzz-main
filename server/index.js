'use strict';
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const env = require('./lib/env');
const { db, dbPath } = require('./lib/db');
const A = require('./lib/auth');
const { seed } = require('./lib/seed');
const automation = require('./lib/automation');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// The Razorpay webhook signature covers the exact bytes, so it needs the raw
// body — mount it before the JSON parser.
app.use('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }));
// Catalogue imports post thousands of rows; everything else stays small.
app.use('/api/admin/import', express.json({ limit: '32mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(A.attachUser);

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    env: env.NODE_ENV,
    db: dbPath,
    smtp: env.smtpConfigured ? 'configured' : 'dev-log-only',
    googleAuth: env.googleAuthConfigured ? 'configured' : 'not-configured',
    payments: env.paymentsConfigured ? 'razorpay' : 'manual-invoicing',
    ads: require('./lib/ads').status(),
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    time: new Date().toISOString()
  });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/enquiries', require('./routes/enquiries'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/saved', require('./routes/saved'));
app.use('/api/owner', require('./routes/owner'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/marketing', require('./routes/marketing'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/uploads', require('./routes/uploads'));

// Uploaded partner photos, served read-only from outside the repo.
const { UPLOAD_ROOT } = require('./lib/uploads');
app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '30d', index: false, dotfiles: 'ignore' }));

// Static site (same origin as the API, so cookies just work).
const ROOT = path.resolve(__dirname, '..');
app.use(express.static(ROOT, { extensions: ['html'], index: 'index.html' }));

app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'Unknown endpoint' }));
app.use((_req, res) => res.status(404).sendFile(path.join(ROOT, '404.html')));

app.use((err, _req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: 'That image is too large.' });
  }
  console.error('[error]', err);
  res.status(err.status || 500).json({ ok: false, error: env.isProd ? 'Server error' : err.message });
});

seed().then(() => {
  A.purgeExpiredTokens();
  setInterval(A.purgeExpiredTokens, 6 * 60 * 60 * 1000).unref();
  automation.start();

  // Keep campaign spend/impressions fresh when an ad platform is connected.
  const ads = require('./lib/ads');
  if (ads.status().mode === 'api') {
    setInterval(() => { ads.syncMetrics().catch((e) => console.error('[ads]', e.message)); },
                60 * 60 * 1000).unref();
    console.log('  Ads: metric sync hourly');
  }
  app.listen(env.PORT, () => {
    console.log(`\n  Hotelzz server → http://localhost:${env.PORT}`);
    console.log(`  DB   : ${dbPath}`);
    console.log(`  Mail : ${env.smtpConfigured ? env.SMTP_HOST : 'no SMTP configured — emails logged to console'}\n`);
  });
});
