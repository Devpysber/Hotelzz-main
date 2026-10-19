'use strict';
/**
 * Google Search Console + Analytics 4 data for Admin → Site Kit, through a
 * Google Cloud service account (no OAuth screen, no extra npm packages).
 *
 * Setup (once):
 *   1. Google Cloud console → create a service account → Keys → Add key → JSON.
 *   2. Enable "Google Search Console API" and "Google Analytics Data API".
 *   3. Save the JSON on the server, e.g. /var/www/hotelzz/google-service-account.json,
 *      and set GOOGLE_SERVICE_ACCOUNT_FILE to that path in .env.
 *   4. Search Console → Settings → Users and permissions → add the service
 *      account email as a user (Full, so it can submit the sitemap).
 *   5. GA4 → Admin → Property access management → add the same email as Viewer,
 *      and put the numeric GA4 property id into Site Kit → Connections.
 */
const fs = require('fs');
const crypto = require('crypto');

const FILE = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '';
const SCOPES = ['https://www.googleapis.com/auth/webmasters', 'https://www.googleapis.com/auth/analytics.readonly'];

let account = null;
let accountError = '';
function loadAccount() {
  if (account || accountError) return account;
  if (!FILE) { accountError = 'GOOGLE_SERVICE_ACCOUNT_FILE is not set in .env'; return null; }
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!j.client_email || !j.private_key) throw new Error('not a service account key (no client_email/private_key)');
    account = { email: j.client_email, key: j.private_key, project: j.project_id || '' };
  } catch (e) {
    accountError = 'Cannot read ' + FILE + ': ' + e.message;
  }
  return account;
}

function status() {
  const a = loadAccount();
  return a ? { configured: true, email: a.email, project: a.project } : { configured: false, error: accountError };
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** Signed JWT for the OAuth token exchange (RFC 7523). Exported for tests. */
function signedAssertion(acct, now) {
  const iat = Math.floor((now || Date.now()) / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: acct.email, scope: SCOPES.join(' '), aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600
  }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(header + '.' + claims), acct.key);
  return header + '.' + claims + '.' + b64url(sig);
}

let token = null;
async function accessToken() {
  const a = loadAccount();
  if (!a) throw new Error(accountError);
  if (token && token.exp > Date.now() + 60000) return token.value;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedAssertion(a) }),
    signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Google sign-in failed: ' + (j.error_description || j.error || 'HTTP ' + r.status));
  token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return token.value;
}

async function call(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: Object.assign({ Authorization: 'Bearer ' + await accessToken() }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch (_) { j = {}; }
  if (!r.ok) {
    const msg = (j.error && (j.error.message || j.error.status)) || 'HTTP ' + r.status;
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return j;
}

const day = (d) => d.toISOString().slice(0, 10);

/** Clicks / impressions / CTR / position for the last `days`, by date, query and page. */
async function searchConsole(siteUrl, days) {
  const end = new Date(Date.now() - 2 * 864e5); // GSC data lags ~2 days
  const start = new Date(end.getTime() - (days - 1) * 864e5);
  const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const q = (dimensions, rowLimit) => call('POST', base, { startDate: day(start), endDate: day(end), dimensions, rowLimit, dataState: 'all' });
  const [byDate, byQuery, byPage, totals] = await Promise.all([q(['date'], days), q(['query'], 15), q(['page'], 15), q([], 1)]);
  const t = (totals.rows && totals.rows[0]) || {};
  const row = (r) => ({ key: r.keys ? r.keys[0] : '', clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
  return {
    range: { start: day(start), end: day(end) },
    totals: { clicks: t.clicks || 0, impressions: t.impressions || 0, ctr: t.ctr || 0, position: t.position || 0 },
    daily: (byDate.rows || []).map(row),
    queries: (byQuery.rows || []).map(row),
    pages: (byPage.rows || []).map(row)
  };
}

async function sitemaps(siteUrl) {
  const j = await call('GET', `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`);
  return (j.sitemap || []).map((s) => ({
    path: s.path, lastSubmitted: s.lastSubmitted, lastDownloaded: s.lastDownloaded, pending: s.isPending,
    errors: Number(s.errors || 0), warnings: Number(s.warnings || 0),
    submitted: (s.contents || []).reduce((n, c) => n + Number(c.submitted || 0), 0)
  }));
}

function submitSitemap(siteUrl, feed) {
  return call('PUT', `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feed)}`);
}

/** Users / sessions / views by date, top pages and traffic sources. */
async function analytics(propertyId, days) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
  const range = [{ startDate: days + 'daysAgo', endDate: 'yesterday' }];
  const report = (body) => call('POST', url, Object.assign({ dateRanges: range }, body));
  const [byDate, pages, sources] = await Promise.all([
    report({ dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }, { name: 'engagementRate' }],
             orderBys: [{ dimension: { dimensionName: 'date' } }] }),
    report({ dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
             orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 15 }),
    report({ dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }],
             orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 })
  ]);
  const num = (r, i) => Number(r.metricValues[i].value || 0);
  const daily = (byDate.rows || []).map((r) => ({
    date: r.dimensionValues[0].value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
    users: num(r, 0), sessions: num(r, 1), views: num(r, 2), engagement: num(r, 3)
  }));
  const sum = (k) => daily.reduce((n, d) => n + d[k], 0);
  return {
    totals: { users: sum('users'), sessions: sum('sessions'), views: sum('views'),
              engagement: daily.length ? daily.reduce((n, d) => n + d.engagement * d.sessions, 0) / Math.max(1, sum('sessions')) : 0 },
    daily,
    pages: (pages.rows || []).map((r) => ({ path: r.dimensionValues[0].value, views: num(r, 0), users: num(r, 1) })),
    sources: (sources.rows || []).map((r) => ({ channel: r.dimensionValues[0].value, sessions: num(r, 0) }))
  };
}

module.exports = { status, searchConsole, sitemaps, submitSitemap, analytics, signedAssertion };
