/**
 * Hotelzz.in — Unified Apps Script backend.
 *
 * Handles:
 *   1. Marketing/property form leads → Leads tab (existing behavior)
 *   2. Hotel dashboard auth (OTP send/verify) → Hotels tab
 *   3. Ad campaign submissions → Ad_Campaigns tab
 *   4. Hotel "me" call (fetch own campaigns + reports) → reads all 3 tabs
 *   5. Admin panel activity mirror → Admin_Updates tab (server-side, see
 *      GOOGLE_SHEET_WEBHOOK_URL in the Node app's .env)
 *
 * REDEPLOY AFTER EDITS:
 *   Deploy → Manage deployments → pencil → Version: New version → Deploy.
 *   The Web App URL stays the same.
 *
 * Required Sheet tabs (create if missing):
 *   - Leads             (already exists)
 *   - Hotels            (email, name, hotel_name, properties_owned, plan,
 *                        created_at, last_login, otp_code, otp_expires)
 *   - Ad_Campaigns      (campaign_id, hotel_email, property_id, goal,
 *                        target_cities, start_date, duration_days,
 *                        daily_budget, creative_brief, status, submitted_at,
 *                        admin_notes)
 *   - Campaign_Reports  (campaign_id, week_ending, impressions, clicks, ctr,
 *                        spend, leads, bookings, notes)
 *   - Admin_Updates     (timestamp, admin, change, entity, entity_id, meta, ip)
 */

// ─── Config ────────────────────────────────────────────────────────────────
var SHEET_LEADS     = 'Leads';
var SHEET_HOTELS    = 'Hotels';
var SHEET_CAMPAIGNS = 'Ad_Campaigns';
var SHEET_REPORTS   = 'Campaign_Reports';
var SHEET_UPDATES   = 'Admin_Updates';

var OTP_TTL_MIN  = 10;      // OTP valid for 10 minutes
var SESSION_DAYS = 30;      // Session token valid for 30 days

// Session secret — auto-generated on first run, stored in Script Properties.
function getSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SESSION_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', s);
  }
  return s;
}

// ─── HTTP entrypoint ───────────────────────────────────────────────────────
function doGet(e) {
  return jsonOut_({ ok: true, msg: 'Hotelzz.in API live. POST only.' });
}

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    var action = (p.action || '').trim();

    if (!action)              return handleLead_(p);          // legacy leads form
    if (action === 'sendOTP') return handleSendOTP_(p);
    if (action === 'verifyOTP') return handleVerifyOTP_(p);
    if (action === 'me')      return handleMe_(p);
    if (action === 'submitCampaign') return handleSubmitCampaign_(p);
    if (action === 'logUpdate')      return handleLogUpdate_(p);

    return jsonOut_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── 1. Legacy leads form (marketing.html + property.html) ────────────────
function handleLead_(p) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_LEADS) || ss.insertSheet(SHEET_LEADS);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Timestamp','Name','Hotel / Property','Location','WhatsApp / Phone',
      'Email','Service of Interest','Property Size','Notes',
      'Source (CTA)','Page','User Agent'
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold').setBackground('#EFF6FF');
  }

  sheet.appendRow([
    new Date(),
    p.name || '', p.hotel || '', p.location || '', p.phone || '',
    p.email || '', p.service || '', p.size || '', p.notes || '',
    p.source || '', p.page || '', (p.userAgent || '').substring(0, 200)
  ]);

  return jsonOut_({ ok: true });
}

// ─── 2. Auth: send OTP ─────────────────────────────────────────────────────
function handleSendOTP_(p) {
  var email = (p.email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') < 0) return jsonOut_({ ok: false, error: 'Invalid email' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_HOTELS);
  if (!sh) return jsonOut_({ ok: false, error: 'Hotels tab not set up. Contact admin.' });

  var row = findHotelRow_(sh, email);
  if (!row) return jsonOut_({ ok: false, error: 'Email not registered. Contact Hotelzz to set up your account.' });

  var otp = String(Math.floor(100000 + Math.random() * 900000));
  var expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

  // Write OTP + expiry into the row
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var otpCol = headers.indexOf('otp_code') + 1;
  var expCol = headers.indexOf('otp_expires') + 1;
  if (otpCol > 0) sh.getRange(row, otpCol).setValue(otp);
  if (expCol > 0) sh.getRange(row, expCol).setValue(expiresAt);

  // Send email
  MailApp.sendEmail({
    to: email,
    subject: 'Your Hotelzz.in login code: ' + otp,
    htmlBody:
      '<div style="font-family:-apple-system,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;">' +
      '<h2 style="color:#2563EB;margin:0 0 8px;">Hotelzz.in</h2>' +
      '<p style="color:#6B7280;font-size:13px;margin:0 0 24px;">Hotel Marketplace · Dashboard login</p>' +
      '<p style="font-size:15px;">Your one-time login code:</p>' +
      '<div style="font-size:32px;font-weight:800;letter-spacing:6px;color:#1F2937;background:#F9FAFB;padding:18px;border-radius:10px;text-align:center;margin:14px 0;">' + otp + '</div>' +
      '<p style="color:#6B7280;font-size:13px;">Valid for ' + OTP_TTL_MIN + ' minutes. Do not share this code with anyone.</p>' +
      '<p style="color:#9CA3AF;font-size:12px;margin-top:24px;">If you did not request this, ignore this email.</p>' +
      '</div>'
  });

  return jsonOut_({ ok: true, msg: 'OTP sent. Check email inbox & spam.' });
}

// ─── 3. Auth: verify OTP → return signed session token ────────────────────
function handleVerifyOTP_(p) {
  var email = (p.email || '').trim().toLowerCase();
  var code  = (p.code  || '').trim();
  if (!email || !code) return jsonOut_({ ok: false, error: 'Missing email or code' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_HOTELS);
  var row = findHotelRow_(sh, email);
  if (!row) return jsonOut_({ ok: false, error: 'Account not found' });

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var rowData = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = function (h) { return headers.indexOf(h); };

  var storedOtp = String(rowData[idx('otp_code')] || '').trim();
  var expRaw    = rowData[idx('otp_expires')];
  var expiresAt = expRaw instanceof Date ? expRaw : new Date(expRaw);

  if (!storedOtp || storedOtp !== code) return jsonOut_({ ok: false, error: 'Invalid code' });
  if (!expiresAt || isNaN(expiresAt) || expiresAt < new Date()) {
    return jsonOut_({ ok: false, error: 'Code expired. Request a new one.' });
  }

  // Burn the OTP + update last_login
  sh.getRange(row, idx('otp_code') + 1).setValue('');
  sh.getRange(row, idx('otp_expires') + 1).setValue('');
  var llCol = idx('last_login') + 1;
  if (llCol > 0) sh.getRange(row, llCol).setValue(new Date());

  var token = signToken_(email);
  var hotel = {
    email: email,
    name: rowData[idx('name')] || '',
    hotel_name: rowData[idx('hotel_name')] || '',
    plan: rowData[idx('plan')] || 'Starter',
    properties_owned: String(rowData[idx('properties_owned')] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
  };
  return jsonOut_({ ok: true, token: token, hotel: hotel });
}

// ─── 4. /me — fetch hotel + their campaigns + their reports ───────────────
function handleMe_(p) {
  var sess = verifyToken_(p.token);
  if (!sess) return jsonOut_({ ok: false, error: 'Invalid or expired session' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_HOTELS);
  var row = findHotelRow_(sh, sess.email);
  if (!row) return jsonOut_({ ok: false, error: 'Account removed' });

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var rowData = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = function (h) { return headers.indexOf(h); };

  var hotel = {
    email: sess.email,
    name: rowData[idx('name')] || '',
    hotel_name: rowData[idx('hotel_name')] || '',
    plan: rowData[idx('plan')] || 'Starter',
    properties_owned: String(rowData[idx('properties_owned')] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
  };

  return jsonOut_({
    ok: true,
    hotel: hotel,
    campaigns: getCampaignsFor_(sess.email),
    reports: getReportsFor_(sess.email)
  });
}

function getCampaignsFor_(email) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CAMPAIGNS);
  if (!sh || sh.getLastRow() < 2) return [];
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = rows[i][c];
    if (String(obj.hotel_email || '').toLowerCase() === email) out.push(obj);
  }
  return out;
}

function getReportsFor_(email) {
  // Reports link to campaigns; we filter by campaigns belonging to this email
  var camps = getCampaignsFor_(email);
  var allowed = {}; camps.forEach(function (c) { allowed[c.campaign_id] = true; });

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_REPORTS);
  if (!sh || sh.getLastRow() < 2) return [];
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = rows[i][c];
    if (allowed[obj.campaign_id]) out.push(obj);
  }
  return out;
}

// ─── 5. Submit ad campaign ────────────────────────────────────────────────
function handleSubmitCampaign_(p) {
  var sess = verifyToken_(p.token);
  if (!sess) return jsonOut_({ ok: false, error: 'Invalid or expired session' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_CAMPAIGNS) || ss.insertSheet(SHEET_CAMPAIGNS);

  if (sh.getLastRow() === 0) {
    sh.appendRow([
      'campaign_id','hotel_email','property_id','goal','target_cities',
      'start_date','duration_days','daily_budget','creative_brief','status',
      'submitted_at','admin_notes'
    ]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 12).setFontWeight('bold').setBackground('#EFF6FF');
  }

  var cid = 'cmp_' + Utilities.formatDate(new Date(), 'GMT', 'yyyyMMddHHmmss') +
            '_' + Math.floor(Math.random() * 9000 + 1000);
  sh.appendRow([
    cid, sess.email,
    p.property_id || '', p.goal || '', p.target_cities || '',
    p.start_date || '', p.duration_days || '', p.daily_budget || '',
    p.creative_brief || '', 'Pending Review', new Date(), ''
  ]);
  return jsonOut_({ ok: true, campaign_id: cid });
}

// ─── 5. Admin panel activity mirror (Node server → Sheet, no auth token) ──
function handleLogUpdate_(p) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_UPDATES) || ss.insertSheet(SHEET_UPDATES);

  if (sh.getLastRow() === 0) {
    sh.appendRow(['Timestamp', 'Admin', 'Change', 'Entity', 'Entity ID', 'Details', 'IP']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#EFF6FF');
  }

  sh.appendRow([
    new Date(), p.admin || '', p.change || '',
    p.entity || '', p.entityId || '', p.meta || '', p.ip || ''
  ]);
  return jsonOut_({ ok: true });
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function findHotelRow_(sh, email) {
  if (!sh || sh.getLastRow() < 2) return 0;
  var emails = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < emails.length; i++) {
    if (String(emails[i][0]).trim().toLowerCase() === email) return i + 2;
  }
  return 0;
}

function signToken_(email) {
  var exp = Date.now() + SESSION_DAYS * 86400 * 1000;
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ e: email, x: exp }));
  var sig = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(payload, getSecret_())
  );
  return payload + '.' + sig;
}

function verifyToken_(token) {
  if (!token || token.indexOf('.') < 0) return null;
  var parts = token.split('.');
  var expectedSig = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(parts[0], getSecret_())
  );
  if (parts[1] !== expectedSig) return null;
  try {
    var p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    if (!p.e || !p.x || p.x < Date.now()) return null;
    return { email: String(p.e).toLowerCase() };
  } catch (e) { return null; }
}
