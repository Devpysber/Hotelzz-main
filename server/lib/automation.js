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

const today = () => new Date().toISOString().slice(0, 10);
const isoWeek = () => {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  return d.getFullYear() + '-W' + Math.ceil(((d - onejan) / 864e5 + onejan.getDay() + 1) / 7);
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
    await sendMail(e.owner_email, 'enquiryReminder', {
      name: e.owner_name, hotelName: e.property_name, guestName: e.guest_name,
      hours, enquiryId: e.id
    });
    sent++;
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
    await sendMail(e.user_email, 'reviewRequest', {
      name: e.user_name, hotelName: e.property_name, enquiryId: e.id
    });
    sent++;
  }
  return sent;
}

/* ------------------------------------------------ 3. weekly owner digest */

async function sendOwnerDigests() {
  // Mondays only, once per property per ISO week.
  if (new Date().getDay() !== 1) return 0;

  const props = db.prepare(
    `SELECT p.*, u.name AS owner_name, u.email AS owner_email
       FROM properties p JOIN users u ON u.id = p.owner_id
      WHERE u.status = 'active'`
  ).all();

  let sent = 0;
  for (const p of props) {
    if (!p.owner_email || !claim('owner-digest', p.id + ':' + isoWeek())) continue;

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

    await sendMail(p.owner_email, 'ownerDigest', {
      name: p.owner_name, hotelName: p.name, enquiries, unanswered, reviews, views, favourites
    });
    sent++;
  }
  return sent;
}

/* --------------------------------------------------- 4. daily admin digest */

async function sendAdminDigest() {
  const hour = new Date().getHours();
  if (hour < 8 || hour > 10) return 0; // morning window
  if (!claim('admin-digest', today())) return 0;

  const c = (sql) => db.prepare(sql).get().c;
  await sendMail(env.ADMIN_EMAIL, 'adminDigest', {
    enquiries: c("SELECT COUNT(*) c FROM enquiries WHERE sent_at >= datetime('now','-1 day')"),
    unanswered: c("SELECT COUNT(*) c FROM enquiries WHERE status IN ('Sent','Opened') AND sent_at <= datetime('now','-1 day')"),
    leads: c("SELECT COUNT(*) c FROM leads WHERE created_at >= datetime('now','-1 day')"),
    claims: c("SELECT COUNT(*) c FROM properties WHERE claim_status = 'pending'"),
    newOwners: c("SELECT COUNT(*) c FROM users WHERE role='owner' AND created_at >= datetime('now','-1 day')"),
    failedEmails: c("SELECT COUNT(*) c FROM email_log WHERE status='failed' AND created_at >= datetime('now','-1 day')")
  });
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
    await sendMail(l.email, 'leadFollowUp', { name: l.name, plan: l.plan });
    sent++;
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
