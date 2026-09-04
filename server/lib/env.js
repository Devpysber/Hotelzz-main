'use strict';
require('dotenv').config();

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  DB_PATH: process.env.DB_PATH || './data/hotelzz.db',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  COOKIE_NAME: process.env.COOKIE_NAME || 'hz_session',
  PUBLIC_URL: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),

  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_SECURE: String(process.env.SMTP_SECURE || 'false') === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  MAIL_FROM: process.env.MAIL_FROM || 'Hotelzz <no-reply@hotelzz.in>',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@hotelzz.in',

  // "Sign in with Google" for travelers/owners.
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',

  // Three real Hostinger mailboxes, one per audience. Each falls back to the
  // legacy single SMTP_USER/PASS (the "info" mailbox) when its own vars are
  // unset, so a single-mailbox setup keeps working unchanged.
  SMTP_ACCOUNTS: {
    info: {
      user: process.env.SMTP_USER_INFO || process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS_INFO || process.env.SMTP_PASS || '',
      from: process.env.MAIL_FROM_INFO || `Hotelzz <${process.env.SMTP_USER_INFO || process.env.SMTP_USER || 'info@hotelzz.in'}>`
    },
    support: {
      user: process.env.SMTP_USER_SUPPORT || '',
      pass: process.env.SMTP_PASS_SUPPORT || '',
      from: process.env.MAIL_FROM_SUPPORT || `Hotelzz Partner Support <${process.env.SMTP_USER_SUPPORT || 'support@hotelzz.in'}>`
    },
    admin: {
      user: process.env.SMTP_USER_ADMIN || '',
      pass: process.env.SMTP_PASS_ADMIN || '',
      from: process.env.MAIL_FROM_ADMIN || `Hotelzz Ops <${process.env.SMTP_USER_ADMIN || 'admin@hotelzz.in'}>`
    }
  },

  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL || 'admin@hotelzz.in',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || 'admin123',
  OTP_TTL_MIN: parseInt(process.env.OTP_TTL_MIN || '10', 10),

  UPLOAD_DIR: process.env.UPLOAD_DIR || './data/uploads',
  UPLOAD_MAX_MB: parseInt(process.env.UPLOAD_MAX_MB || '8', 10),

  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  CURRENCY: process.env.CURRENCY || 'INR',

  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || '',
  META_AD_ACCOUNT_ID: process.env.META_AD_ACCOUNT_ID || '',
  GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
  GOOGLE_ADS_CUSTOMER_ID: process.env.GOOGLE_ADS_CUSTOMER_ID || '',
  GOOGLE_ADS_ACCESS_TOKEN: process.env.GOOGLE_ADS_ACCESS_TOKEN || '',
  OTP_DEV_ECHO: String(process.env.OTP_DEV_ECHO || 'true') === 'true',

  // Google Sheet mirror. When set, every admin write (claim decisions, listing
  // edits, moderation, imports, campaign/package changes, settings...) is also
  // POSTed to this Apps Script Web App URL, which logs it as a new row — see
  // handleLogUpdate_ in LEADS-APPS-SCRIPT.gs and Part 3 of SETUP-GOOGLE-SHEET.md.
  GOOGLE_SHEET_WEBHOOK_URL: process.env.GOOGLE_SHEET_WEBHOOK_URL || ''
};

env.googleAuthConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
env.isProd = env.NODE_ENV === 'production';
env.smtpConfigured = Boolean(env.SMTP_HOST &&
  Object.values(env.SMTP_ACCOUNTS).some((a) => a.user && a.pass));
// Any account missing its own creds sends through the info mailbox instead of
// going dev-log-only — as long as at least the info mailbox is configured.
if (env.SMTP_ACCOUNTS.info.user && env.SMTP_ACCOUNTS.info.pass) {
  for (const key of ['support', 'admin']) {
    if (!env.SMTP_ACCOUNTS[key].user || !env.SMTP_ACCOUNTS[key].pass) {
      env.SMTP_ACCOUNTS[key] = Object.assign({}, env.SMTP_ACCOUNTS.info, { from: env.SMTP_ACCOUNTS[key].from });
    }
  }
}
env.paymentsConfigured = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
env.metaAdsConfigured = Boolean(env.META_ACCESS_TOKEN && env.META_AD_ACCOUNT_ID);
env.googleAdsConfigured = Boolean(env.GOOGLE_ADS_DEVELOPER_TOKEN && env.GOOGLE_ADS_CUSTOMER_ID && env.GOOGLE_ADS_ACCESS_TOKEN);
env.sheetWebhookConfigured = Boolean(env.GOOGLE_SHEET_WEBHOOK_URL);

// Catches the code's own dev fallback AND any obviously-placeholder value
// someone typed into .env by hand ("change-me-in-production" and similar) —
// the previous check only matched the exact fallback string, so a weak
// placeholder that WAS set in .env silently passed and would sign real
// production session tokens. Length is the real signal: any placeholder
// short enough to type is far below what a real secret looks like.
const weakJwtSecret = !env.JWT_SECRET || env.JWT_SECRET.length < 32 ||
  /change.?me|insecure|placeholder|example|secret123/i.test(env.JWT_SECRET);
if (env.isProd && weakJwtSecret) {
  throw new Error('JWT_SECRET must be set to a long random value in production (openssl rand -hex 32).');
}

module.exports = env;
