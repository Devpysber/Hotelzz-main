'use strict';
/**
 * Scheduled email automation.
 *
 * Runs inside the web process on a fixed interval. Every job is idempotent:
 * before sending, it records (job, entity) in automation_log, and the unique
 * index there is what stops a message going out twice — including across
 * restarts. Digests use a date-stamped entity id so they fire once per period.
 */
const env = require('./env');
const { db, uid } = require('./db');
const { sendMail } = require('./mailer');

const TICK_MS = 15 * 60 * 1000;

/** Claims the (job, entity) slot. Returns false when it was already taken. */
function claim(job, entityId) {
  try {
    db.prepare('INSERT INTO automation_log (id, job, entity_id) VALUES (?,?,?)')
      .run(uid('aut'), job, String(entityId));
    return true;
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return false;
    throw err;
  }
}

// Schedules follow India time whatever the server's own time zone is (the
// VPS runs UTC, which put the "08:00–10:00" digest at 13:30 IST).
const ist = () => new Date(Date.now() + 5.5 * 3600 * 1000); // read with getUTC*()
/** Frees a slot whose email failed, so the next tick retries instead of dropping it. */
function release(job, entityId) {
  db.prepare('DELETE FROM automation_log WHERE job = ? AND entity_id = ?').run(job, String(entityId));
}
/** Sends and keeps the slot only when the email actually went out. */
async function deliver(job, entityId, to, template, data) {
  const r = await sendMail(to, template, data);
  if (!r.ok) { release(job, entityId); return false; }
  return true;
}

const today = () => ist().toISOString().slice(0, 10);
const isoWeek = () => {
  const d = ist();
  const onejan = Date.UTC(d.getUTCFullYear(), 0, 1);
  return d.getUTCFullYear() + '-W' + Math.ceil(((d - onejan) / 864e5 + new Date(onejan).getUTCDay() + 1) / 7);
};

/* ------------------------------------------------------- 1. nudge the hotel */

async function remindUnansweredEnquiries() {
  const rows = db.prepare(
    `SELECT e.*, u.name AS owner_name, u.email AS owner_email
       FROM enquiries e JOIN users u ON u.id = e.owner_id
      WHERE e.status IN ('Sent','Opened')
        AND e.sent_at <= datetime('now','-24 hours')
        AND e.sent_at >= datetime('now','-7 days')`
  ).all();

  let sent = 0;
  for (const e of rows) {
    if (!e.owner_email || !claim('enquiry-reminder', e.id)) continue;
    const hours = Math.round((Date.now() - new Date(e.sent_at.replace(' ', 'T') + 'Z')) / 36e5);
    if (await deliver('enquiry-reminder', e.id, e.owner_email, 'enquiryReminder', {
      name: e.owner_name, hotelName: e.property_name, guestName: e.guest_name,
      hours, enquiryId: e.id
    })) sent++;
  }
  return sent;
}

/* ------------------------------------------- 2. ask the traveller to review */

async function requestReviews() {
  const rows = db.prepare(
    `SELECT e.*, u.email AS user_email, u.name AS user_name
       FROM enquiries e JOIN users u ON u.id = e.user_id
      WHERE e.status IN ('Responded','Converted')
        AND e.review_id IS NULL
        AND e.responded_at <= datetime('now','-3 days')
        AND e.responded_at >= datetime('now','-30 days')`
  ).all();

  let sent = 0;
  for (const e of rows) {
    if (!e.user_email || !claim('review-request', e.id)) continue;
    if (await deliver('review-request', e.id, e.user_email, 'reviewRequest', {
      name: e.user_name, hotelName: e.property_name, enquiryId: e.id
    })) sent++;
  }
  return sent;
}

/* ------------------------------------------------ 3. weekly owner digest */

async function sendOwnerDigests() {
  // Mondays only, once per property per ISO week.
  if (ist().getUTCDay() !== 1) return 0;

  const props = db.prepare(
    `SELECT p.*, u.name AS owner_name, u.email AS owner_email
       FROM properties p JOIN users u ON u.id = p.owner_id
      WHERE u.status = 'active'`
  ).all();

  let sent = 0;
  for (const p of props) {
    if (!p.owner_email) continue;

    const enquiries = db.prepare(
      "SELECT COUNT(*) c FROM enquiries WHERE property_id = ? AND sent_at >= datetime('now','-7 days')"
    ).get(p.id).c;
    const unanswered = db.prepare(
      "SELECT COUNT(*) c FROM enquiries WHERE property_id = ? AND status IN ('Sent','Opened')"
    ).get(p.id).c;
    const reviews = db.prepare(
      "SELECT COUNT(*) c FROM reviews WHERE property_id = ? AND created_at >= datetime('now','-7 days')"
    ).get(p.id).c;
    const views = db.prepare(
      "SELECT COALESCE(SUM(views),0) v FROM property_stats WHERE property_id = ? AND day >= date('now','-7 days')"
    ).get(p.id).v;
    const favourites = db.prepare('SELECT COUNT(*) c FROM saved_hotels WHERE property_id = ?').get(p.id).c;

    // Nothing happened and nothing is pending — skip the empty email.
    if (!enquiries && !unanswered && !reviews && !views) continue;
    // Claimed only when there is something to send: a quiet start-of-day run
    // used to burn the whole week's slot before any activity arrived.
    if (!claim('owner-digest', p.id + ':' + isoWeek())) continue;

    if (await deliver('owner-digest', p.id + ':' + isoWeek(), p.owner_email, 'ownerDigest', {
      name: p.owner_name, hotelName: p.name, enquiries, unanswered, reviews, views, favourites
    })) sent++;
  }
  return sent;
}

/* --------------------------------------------------- 4. daily admin digest */

async function sendAdminDigest() {
  const hour = ist().getUTCHours();
  if (hour < 8 || hour > 10) return 0; // morning window, India time
  if (!claim('admin-digest', today())) return 0;

  const c = (sql) => db.prepare(sql).get().c;
  const r = await sendMail(require('./mailer').opsEmail(), 'adminDigest', {
    enquiries: c("SELECT COUNT(*) c FROM enquiries WHERE sent_at >= datetime('now','-1 day')"),
    unanswered: c("SELECT COUNT(*) c FROM enquiries WHERE status IN ('Sent','Opened') AND sent_at <= datetime('now','-1 day')"),
    leads: c("SELECT COUNT(*) c FROM leads WHERE created_at >= datetime('now','-1 day')"),
    claims: c("SELECT COUNT(*) c FROM properties WHERE claim_status = 'pending'"),
    newOwners: c("SELECT COUNT(*) c FROM users WHERE role='owner' AND created_at >= datetime('now','-1 day')"),
    failedEmails: c("SELECT COUNT(*) c FROM email_log WHERE status='failed' AND created_at >= datetime('now','-1 day')")
  });
  if (!r.ok) { release('admin-digest', today()); return 0; }
  return 1;
}

/* ------------------------------------------------- 5. marketing follow-up */

async function followUpLeads() {
  const rows = db.prepare(
    `SELECT * FROM leads
      WHERE status = 'New' AND email IS NOT NULL AND email <> ''
        AND created_at <= datetime('now','-3 days')
        AND created_at >= datetime('now','-30 days')`
  ).all();

  let sent = 0;
  for (const l of rows) {
    if (!claim('lead-followup', l.id)) continue;
    if (await deliver('lead-followup', l.id, l.email, 'leadFollowUp', { name: l.name, plan: l.plan })) sent++;
  }
  return sent;
}

const JOBS = [
  ['enquiry-reminder', remindUnansweredEnquiries],
  ['review-request', requestReviews],
  ['owner-digest', sendOwnerDigests],
  ['admin-digest', sendAdminDigest],
  ['lead-followup', followUpLeads]
];

async function runOnce() {
  const summary = {};
  for (const [name, job] of JOBS) {
    try {
      summary[name] = await job();
    } catch (err) {
      console.error('[automation] ' + name + ' failed:', err.message);
      summary[name] = 'error: ' + err.message;
    }
  }
  const total = Object.values(summary).filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0);
  if (total) console.log('[automation] sent', total, JSON.stringify(summary));
  return summary;
}

function start() {
  // A short delay keeps startup fast; then every TICK_MS.
  setTimeout(() => { runOnce(); }, 30 * 1000).unref();
  const timer = setInterval(runOnce, TICK_MS);
  timer.unref();
  console.log('  Automation: email jobs run every ' + (TICK_MS / 60000) + ' minutes');
  return timer;
}

module.exports = { start, runOnce, JOBS };
