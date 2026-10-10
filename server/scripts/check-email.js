#!/usr/bin/env node
'use strict';
/**
 * Email health check — run on the server:
 *
 *   node server/scripts/check-email.js                 # check only, sends nothing
 *   node server/scripts/check-email.js you@gmail.com   # also send one test per mailbox
 *
 * Checks: SMTP login for each mailbox (info / support / admin), the domain's
 * MX / SPF / DKIM / DMARC records (what decides inbox vs spam), and recent
 * failures in the app's own email log. Passwords are never printed.
 */
const dns = require('dns').promises;
const nodemailer = require('nodemailer');
const env = require('../lib/env');

const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); problems++; };
const info = (m) => console.log('    ' + m);
let problems = 0;

const mask = (s) => (s ? s.replace(/^(.).*(@.*)$/, '$1***$2') : '(not set)');

async function checkAccounts() {
  console.log('\nSMTP mailboxes  (' + (env.SMTP_HOST || 'no SMTP_HOST') + ':' + env.SMTP_PORT + (env.SMTP_SECURE ? ' SSL' : ' STARTTLS') + ')');
  if (!env.SMTP_HOST) { bad('SMTP_HOST is not set in .env — emails are only printed to the log, never sent.'); return; }
  const seen = new Map();
  for (const key of ['info', 'support', 'admin']) {
    const a = env.SMTP_ACCOUNTS[key];
    if (!a.user || !a.pass) { bad(`${key}: no username/password in .env`); continue; }
    const id = a.user + '|' + a.pass;
    if (seen.has(id)) { ok(`${key}: uses the same login as ${seen.get(id)} (${mask(a.user)}), From: ${a.from}`); continue; }
    seen.set(id, key);
    const t = nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
      auth: { user: a.user, pass: a.pass }, connectionTimeout: 15000
    });
    try {
      await t.verify();
      ok(`${key}: login OK as ${mask(a.user)}, From: ${a.from}`);
      const fromAddr = (a.from.match(/<([^>]+)>/) || [, a.from])[1];
      if (fromAddr && fromAddr.toLowerCase() !== a.user.toLowerCase()) {
        info(`note: From address ${fromAddr} differs from the login ${mask(a.user)} — Hostinger may reject or rewrite it.`);
      }
    } catch (e) {
      bad(`${key}: login FAILED for ${mask(a.user)} — ${e.message}`);
      if (/535|auth/i.test(e.message)) info('→ wrong mailbox password, or the mailbox does not exist in Hostinger Email.');
      if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(e.message)) info('→ cannot reach the mail server: check SMTP_HOST/SMTP_PORT, or the VPS firewall blocks outgoing port ' + env.SMTP_PORT + '.');
    }
  }
}

async function txt(name) {
  try { return (await dns.resolveTxt(name)).map((r) => r.join('')); } catch (_) { return []; }
}

async function checkDns() {
  const domain = ((env.SMTP_ACCOUNTS.info.user || 'x@hotelzz.in').split('@')[1] || 'hotelzz.in').toLowerCase();
  console.log('\nDNS for ' + domain + '  (decides inbox vs spam)');
  try {
    const mx = await dns.resolveMx(domain);
    mx.length ? ok('MX: ' + mx.map((m) => m.exchange).join(', ')) : bad('MX: none — nobody can reply to your emails.');
  } catch (_) { bad('MX: none found'); }

  const spf = (await txt(domain)).filter((t) => /^v=spf1/i.test(t));
  if (!spf.length) bad('SPF: missing — add TXT "v=spf1 include:_spf.mail.hostinger.com ~all" at ' + domain);
  else if (spf.length > 1) bad('SPF: ' + spf.length + ' SPF records — there must be exactly one; merge them.');
  else {
    ok('SPF: ' + spf[0]);
    if (/smtp\.hostinger|hostinger/i.test(env.SMTP_HOST) && !/hostinger/i.test(spf[0])) bad('SPF does not include Hostinger — add include:_spf.mail.hostinger.com');
  }

  const dkimFound = [];
  for (const sel of ['hostingermail1', 'hostingermail2', 'hostingermail3', 'hostingermail-a', 'hostingermail-b', 'hostingermail-c', 'default', 'mail']) {
    const r = await txt(sel + '._domainkey.' + domain);
    const cname = await dns.resolveCname(sel + '._domainkey.' + domain).catch(() => []);
    if (r.some((t) => /v=DKIM1|p=/i.test(t)) || cname.length) dkimFound.push(sel);
  }
  dkimFound.length ? ok('DKIM: found (' + dkimFound.join(', ') + ')')
    : bad('DKIM: not found — in Hostinger hPanel → Emails → DNS settings, add the DKIM records it lists.');

  const dmarc = (await txt('_dmarc.' + domain)).filter((t) => /^v=DMARC1/i.test(t));
  dmarc.length ? ok('DMARC: ' + dmarc[0]) : bad('DMARC: missing — add TXT at _dmarc.' + domain + ': "v=DMARC1; p=none; rua=mailto:' + (env.ADMIN_EMAIL || 'admin@' + domain) + '"');
}

function checkLog() {
  console.log('\nApp email log (last 7 days)');
  let db;
  try { ({ db } = require('../lib/db')); } catch (e) { info('could not open the database: ' + e.message); return; }
  const rows = db.prepare(
    "SELECT status, COUNT(*) c FROM email_log WHERE created_at >= datetime('now','-7 days') GROUP BY status"
  ).all();
  if (!rows.length) { info('no emails logged in the last 7 days'); return; }
  rows.forEach((r) => (r.status === 'failed' ? bad : ok)(`${r.status}: ${r.c}`));
  const fails = db.prepare(
    "SELECT created_at, to_addr, template, account, error FROM email_log WHERE status = 'failed' ORDER BY created_at DESC LIMIT 5"
  ).all();
  fails.forEach((f) => info(`${f.created_at}  ${f.template || 'manual'} via ${f.account} → ${mask(f.to_addr)}: ${String(f.error).slice(0, 140)}`));
  const dev = db.prepare("SELECT COUNT(*) c FROM email_log WHERE status = 'dev-logged' AND created_at >= datetime('now','-1 day')").get().c;
  if (dev) bad(`${dev} email(s) in the last day were only logged, not sent — the server ran without working SMTP settings.`);
}

async function sendTests(to) {
  console.log('\nSending test emails to ' + to);
  const { sendCustomMail, sendMail } = require('../lib/mailer');
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  for (const account of ['info', 'support', 'admin']) {
    const r = await sendCustomMail(to, {
      subject: `Hotelzz email test — ${account}@ mailbox (${stamp})`,
      text: `This is a test from the Hotelzz server, sent through the ${account} mailbox at ${stamp}.\nIf you can read this, that mailbox works.`
    }, { account });
    r.ok ? ok(`${account}: sent`) : bad(`${account}: FAILED — ${r.error}`);
  }
  // One real template end to end, as a customer would receive it.
  const r = await sendMail(to, 'purchaseConfirmation', {
    name: 'Email Test', planName: 'OTA Starter — 1 OTA (TEST, no charge)', amount: 999, currency: 'INR',
    orderId: 'test-' + Date.now(), paymentRef: 'TEST', status: 'Paid', hotelName: 'Test Hotel'
  });
  r.ok ? ok('template "purchaseConfirmation": sent') : bad('template "purchaseConfirmation": FAILED — ' + r.error);
  info('Check the inbox AND the spam folder of ' + to + ' in a minute.');
}

(async () => {
  console.log('Hotelzz email check — NODE_ENV=' + env.NODE_ENV);
  await checkAccounts();
  await checkDns();
  checkLog();
  const to = process.argv[2];
  if (to) await sendTests(to);
  console.log('\n' + (problems ? problems + ' problem(s) found — see ✗ lines above.' : 'All checks passed.'));
  process.exit(problems ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
