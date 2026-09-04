'use strict';
/**
 * Outgoing mail — 3 real Hostinger mailboxes, one per audience, and a
 * catalogue of every transactional template the platform sends.
 *
 *   info@hotelzz.in    — traveller/guest + marketing mail
 *   support@hotelzz.in — hotel-partner mail (also used for owner -> guest
 *                        messages, since those are a partner action)
 *   admin@hotelzz.in   — internal ops alerts + admin manual/broadcast sends
 *
 * Each template is registered once via define(name, meta, build) — meta
 * carries which mailbox it sends from, its category/label for the admin
 * panel's template gallery, and sample data so a template can be rendered
 * with no real record on hand (preview, docs). build(data) returns the
 * actual { subject, text, html }.
 */
const nodemailer = require('nodemailer');
const env = require('./env');
const { db, uid } = require('./db');

/* ------------------------------------------------------------ transports */

const transporters = {};

function getTransport(accountKey) {
  const key = env.SMTP_ACCOUNTS[accountKey] ? accountKey : 'info';
  if (transporters[key]) return transporters[key];
  const acct = env.SMTP_ACCOUNTS[key];

  const t = (acct && acct.user && acct.pass)
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: { user: acct.user, pass: acct.pass }
      })
    : {
        // Dev fallback: that mailbox has no credentials. Messages are
        // logged + stored, never sent.
        sendMail: async (msg) => {
          console.log(`\n--- [DEV MAIL:${key}] -------------------------------------`);
          console.log('To:      ', msg.to);
          console.log('Subject: ', msg.subject);
          console.log(msg.text || '(html only)');
          console.log('----------------------------------------------------\n');
          return { messageId: 'dev-' + uid() };
        }
      };
  transporters[key] = t;
  return t;
}

/** True once at least one real account has credentials for `key`. */
function accountConfigured(key) {
  const acct = env.SMTP_ACCOUNTS[key];
  return Boolean(acct && acct.user && acct.pass);
}

/* --------------------------------------------------------------- layout */

function layout(title, bodyHtml, footerNote) {
  return `<!doctype html><html><body style="margin:0;background:#F8FAFC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0F172A">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="font-size:22px;font-weight:800;color:#2563EB;margin-bottom:20px">Hotelzz<span style="color:#0F172A">.in</span></div>
    <div style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:28px">
      <h1 style="margin:0 0 14px;font-size:19px">${title}</h1>
      ${bodyHtml}
    </div>
    <p style="color:#64748B;font-size:12px;margin-top:20px;line-height:1.6">
      Hotelzz.in — India's hotel marketplace &amp; marketing platform.<br/>
      ${footerNote || 'This is an automated message. Need help? Reply to this email.'}
    </p>
  </div></body></html>`;
}

const button = (href, label) =>
  `<p style="margin:22px 0"><a href="${href}" style="background:#2563EB;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">${label}</a></p>`;

const codeBox = (code) =>
  `<div style="font-size:30px;letter-spacing:8px;font-weight:800;background:#EFF6FF;color:#1D4ED8;padding:16px;border-radius:10px;text-align:center;margin:18px 0">${code}</div>`;

const infoTable = (rows) =>
  `<table style="font-size:14px;line-height:1.9">${rows
    .filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== '')
    .map(([k, v]) => `<tr><td style="color:#64748B;padding-right:14px">${k}</td><td><b>${v}</b></td></tr>`)
    .join('')}</table>`;

const quote = (text, color) =>
  `<p style="line-height:1.6;background:#F8FAFC;border-left:3px solid ${color || '#2563EB'};padding:12px;margin-top:16px">${text}</p>`;

const badge = (label, color, bg) =>
  `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;color:${color};background:${bg}">${label}</span>`;

/* ---------------------------------------------------------- registration */

const T = {}; // name -> { account, category, label, description, sample, build }

function define(name, meta, build) {
  T[name] = Object.assign({ name, build }, meta);
}

/* =========================================================================
   AUTH / ACCOUNT — info@ (account-security mail is kept on one mailbox
   regardless of role, so travellers/owners/admins get consistent sending)
   ========================================================================= */

define('otp',
  { account: 'info', category: 'Auth', label: 'OTP / verification code',
    description: 'One-time code for sign-in, property claim, or verification.',
    sample: { name: 'Aarav Shah', code: '482913', purpose: 'sign in' } },
  ({ name, code, purpose }) => ({
    subject: `${code} is your Hotelzz verification code`,
    text: `Hi ${name || 'there'},\n\nYour Hotelzz ${purpose} code is ${code}. It expires in ${env.OTP_TTL_MIN} minutes.\n\nIf you didn't request this, ignore this email.`,
    html: layout('Your verification code',
      `<p style="line-height:1.6">Hi ${name || 'there'}, use this code to continue your ${purpose}.</p>
       ${codeBox(code)}
       <p style="color:#64748B;font-size:13px">Expires in ${env.OTP_TTL_MIN} minutes. If you didn't request it, ignore this email.</p>`)
  }));

define('welcomeTraveler',
  { account: 'info', category: 'Traveler', label: 'Traveler welcome',
    description: 'Sent right after a traveller creates an account.',
    sample: { name: 'Aarav Shah' } },
  ({ name }) => ({
    subject: 'Welcome to Hotelzz — your traveler account is ready',
    text: `Hi ${name}, your Hotelzz traveler account is live. Browse 3,000+ verified properties and enquire directly with hotels — no commission, no middlemen.\n${env.PUBLIC_URL}/user-portal.html`,
    html: layout(`Welcome aboard, ${name} 👋`,
      `<p style="line-height:1.6">Your traveler account is live. Browse 3,000+ verified Indian properties and enquire <b>directly with hotels</b> — no commission, no middlemen.</p>
       ${button(env.PUBLIC_URL + '/user-portal.html', 'Open your portal')}`)
  }));

define('welcomeOwner',
  { account: 'support', category: 'Partner', label: 'Partner welcome',
    description: 'Sent right after a hotel registers as a partner.',
    sample: { name: 'Rohan Mehta', hotelName: 'The Grand Palace' } },
  ({ name, hotelName }) => ({
    subject: 'Hotelzz partner registration received',
    text: `Hi ${name}, we received the registration for ${hotelName}. Our team verifies new properties within 24 hours. You can already sign in to the owner dashboard.\n${env.PUBLIC_URL}/owner.html`,
    html: layout('Registration received',
      `<p style="line-height:1.6">Hi ${name}, we received the partner registration for <b>${hotelName}</b>. Our team verifies new properties within 24 hours — you can sign in to the dashboard right away.</p>
       ${button(env.PUBLIC_URL + '/owner.html', 'Open owner dashboard')}`)
  }));

define('passwordReset',
  { account: 'info', category: 'Auth', label: 'Password reset link',
    description: 'A time-limited link to set a new password.',
    sample: { name: 'Aarav Shah', link: env.PUBLIC_URL + '/reset-password.html?token=sample&email=aarav%40example.com&role=traveler' } },
  ({ name, link }) => ({
    subject: 'Reset your Hotelzz password',
    text: `Hi ${name || 'there'}, reset your Hotelzz password here (valid 60 minutes): ${link}`,
    html: layout('Reset your password',
      `<p style="line-height:1.6">Hi ${name || 'there'}, click below to set a new password. The link is valid for 60 minutes.</p>
       ${button(link, 'Set a new password')}
       <p style="color:#64748B;font-size:12px;word-break:break-all">${link}</p>`)
  }));

define('passwordChanged',
  { account: 'info', category: 'Auth', label: 'Password changed',
    description: 'Confirms a password was just changed.',
    sample: { name: 'Aarav Shah' } },
  ({ name }) => ({
    subject: 'Your Hotelzz password was changed',
    text: `Hi ${name || 'there'}, your Hotelzz password was just changed. If this wasn't you, contact support immediately.`,
    html: layout('Password changed',
      `<p style="line-height:1.6">Hi ${name || 'there'}, your password was just changed. If this wasn't you, contact us immediately.</p>`)
  }));

/* =========================================================================
   ENQUIRIES — guest side on info@, partner side on support@
   ========================================================================= */

define('enquiryToOwner',
  { account: 'support', category: 'Enquiries', label: 'New enquiry (to hotel)',
    description: 'Notifies the hotel owner of a new direct guest enquiry.',
    sample: { hotelName: 'The Grand Palace', guestName: 'Priya Nair', guestEmail: 'priya@example.com',
      guestPhone: '+91 98200 12345', checkIn: '2026-10-04', checkOut: '2026-10-07', guests: 2,
      message: 'Do you have a sea-facing room available?', enquiryId: 'HZ-ENQ-58231' } },
  ({ hotelName, guestName, guestEmail, guestPhone, checkIn, checkOut, guests, message, enquiryId }) => ({
    subject: `New guest enquiry for ${hotelName} — ${guestName}`,
    text: `New enquiry ${enquiryId} for ${hotelName}.
Guest: ${guestName}
Email: ${guestEmail}
Phone: ${guestPhone}
Stay: ${checkIn} to ${checkOut} (${guests} guests)
Message: ${message}

Respond here: ${env.PUBLIC_URL}/owner.html`,
    html: layout('New guest enquiry',
      `<p style="line-height:1.6">You have a direct enquiry for <b>${hotelName}</b> — no commission, contact the guest directly.</p>
       ${infoTable([['Guest', guestName], ['Email', guestEmail], ['Phone', guestPhone || '—'],
                    ['Stay', `${checkIn || '—'} → ${checkOut || '—'}`], ['Guests', guests]])}
       ${quote(message || 'No message.')}
       ${button(env.PUBLIC_URL + '/owner.html', 'Respond in your dashboard')}`)
  }));

define('enquiryReceipt',
  { account: 'info', category: 'Enquiries', label: 'Enquiry sent (receipt)',
    description: 'Confirms to the guest that their enquiry reached the hotel.',
    sample: { guestName: 'Priya Nair', hotelName: 'The Grand Palace', checkIn: '2026-10-04', checkOut: '2026-10-07', enquiryId: 'HZ-ENQ-58231' } },
  ({ guestName, hotelName, checkIn, checkOut, enquiryId }) => ({
    subject: `Enquiry sent to ${hotelName}`,
    text: `Hi ${guestName}, your enquiry (${enquiryId}) has been delivered to ${hotelName} for ${checkIn} to ${checkOut}. The hotel replies directly — you can track the status in your portal: ${env.PUBLIC_URL}/user-portal.html`,
    html: layout('Your enquiry is on its way',
      `<p style="line-height:1.6">Hi ${guestName}, we delivered your enquiry to <b>${hotelName}</b> for ${checkIn || '—'} → ${checkOut || '—'}. The hotel responds directly, so you get their best direct rate.</p>
       <p style="color:#64748B;font-size:13px">Reference: ${enquiryId}</p>
       ${button(env.PUBLIC_URL + '/user-portal.html#enquiries', 'Track this enquiry')}`)
  }));

define('enquiryResponse',
  { account: 'info', category: 'Enquiries', label: 'Hotel replied to enquiry',
    description: 'Forwards the hotel\'s reply to the guest.',
    sample: { guestName: 'Priya Nair', hotelName: 'The Grand Palace', response: 'Yes, we have a sea-facing deluxe room for those dates at ₹6,500/night.', enquiryId: 'HZ-ENQ-58231' } },
  ({ guestName, hotelName, response, enquiryId }) => ({
    subject: `${hotelName} replied to your enquiry`,
    text: `Hi ${guestName}, ${hotelName} replied to enquiry ${enquiryId}:

${response}

View it: ${env.PUBLIC_URL}/user-portal.html#enquiries`,
    html: layout(`${hotelName} replied`,
      `<p style="line-height:1.6">Hi ${guestName}, the hotel has responded to your enquiry.</p>
       ${quote(response, '#10B981')}
       ${button(env.PUBLIC_URL + '/user-portal.html#enquiries', 'Open your portal')}`)
  }));

define('enquiryClosed',
  { account: 'info', category: 'Enquiries', label: 'Enquiry closed / converted',
    description: 'Tells the guest their enquiry status changed to Closed or Converted.',
    sample: { guestName: 'Priya Nair', hotelName: 'The Grand Palace', status: 'Converted', enquiryId: 'HZ-ENQ-58231' } },
  ({ guestName, hotelName, status, enquiryId }) => ({
    subject: status === 'Converted' ? `Booked! Your stay at ${hotelName} is confirmed` : `Your enquiry at ${hotelName} is closed`,
    text: `Hi ${guestName}, your enquiry ${enquiryId} at ${hotelName} is now ${status}.\n${env.PUBLIC_URL}/user-portal.html#enquiries`,
    html: layout(status === 'Converted' ? 'Your stay is confirmed' : 'Enquiry closed',
      `<p style="line-height:1.6">Hi ${guestName}, your enquiry at <b>${hotelName}</b> (${enquiryId}) is now ${badge(status, status === 'Converted' ? '#047857' : '#475569', status === 'Converted' ? '#ECFDF5' : '#F1F5F9')}.</p>
       ${status === 'Converted' ? '<p style="line-height:1.6">Have a great stay — we would love a short review afterwards.</p>' : ''}
       ${button(env.PUBLIC_URL + '/user-portal.html#enquiries', 'View in your portal')}`)
  }));

define('enquiryReminder',
  { account: 'support', category: 'Enquiries', label: 'Unanswered enquiry reminder',
    description: 'Automated nudge to the hotel when an enquiry sits unanswered 24h+.',
    sample: { name: 'Rohan Mehta', hotelName: 'The Grand Palace', guestName: 'Priya Nair', hours: 26, enquiryId: 'HZ-ENQ-58231' } },
  ({ name, hotelName, guestName, hours, enquiryId }) => ({
    subject: `Reminder: ${guestName}'s enquiry for ${hotelName} is still unanswered`,
    text: `Hi ${name}, ${guestName} enquired about ${hotelName} ${hours} hours ago and is still waiting. Hotels that reply within an hour convert far more direct bookings. Reply here: ${env.PUBLIC_URL}/owner.html`,
    html: layout('A guest is still waiting',
      `<p style="line-height:1.6">Hi ${name}, <b>${guestName}</b> enquired about <b>${hotelName}</b> ${hours} hours ago and has had no reply yet (${enquiryId}).</p>
       <p style="line-height:1.6;color:#64748B">Hotels that answer within the hour win noticeably more direct bookings.</p>
       ${button(env.PUBLIC_URL + '/owner.html', 'Reply now')}`)
  }));

/* =========================================================================
   VENDOR -> GUEST — the owner's own mail service to their own buyer only
   ========================================================================= */

define('vendorToGuest',
  { account: 'support', category: 'Partner', label: 'Message from hotel to guest',
    description: 'A free-form message a hotel owner sends to a guest who enquired with them — scoped server-side to that one enquiry, never a free address.',
    sample: { guestName: 'Priya Nair', hotelName: 'The Grand Palace', ownerName: 'Rohan Mehta',
      subject: 'Your room is ready early', message: 'Good news — your deluxe room will be ready by 11 AM instead of 2 PM on check-in day.', enquiryId: 'HZ-ENQ-58231' } },
  ({ guestName, hotelName, ownerName, subject, message, enquiryId }) => ({
    subject: subject || `A message from ${hotelName}`,
    text: `Hi ${guestName},\n\n${message}\n\n— ${ownerName || hotelName}\n\nRe: enquiry ${enquiryId}. Reply to this email to reach the hotel directly.`,
    html: layout(subject || `A message from ${hotelName}`,
      `<p style="line-height:1.6">Hi ${guestName},</p>
       ${quote(String(message || '').replace(/\n/g, '<br/>'))}
       <p style="line-height:1.6">— <b>${ownerName || hotelName}</b>, ${hotelName}</p>
       <p style="color:#64748B;font-size:12px">Re: enquiry ${enquiryId}. Reply to this email to reach the hotel directly.</p>`,
      'Sent by a Hotelzz partner about your enquiry. Reply goes straight to the hotel.')
  }));

/* =========================================================================
   REVIEWS
   ========================================================================= */

define('newReviewToOwner',
  { account: 'support', category: 'Reviews', label: 'New review (to hotel)',
    description: 'Notifies the hotel of a new guest review.',
    sample: { hotelName: 'The Grand Palace', userName: 'Priya Nair', rating: 5, comment: 'Loved the stay, staff was excellent!' } },
  ({ hotelName, userName, rating, comment }) => ({
    subject: `New ${rating}★ review for ${hotelName}`,
    text: `${userName} left a ${rating}-star review for ${hotelName}:

${comment}

Reply from your dashboard: ${env.PUBLIC_URL}/owner.html`,
    html: layout(`New ${rating}★ review`,
      `<p style="line-height:1.6"><b>${userName}</b> reviewed <b>${hotelName}</b>.</p>
       ${quote(comment || 'No comment.', '#F59E0B')}
       ${button(env.PUBLIC_URL + '/owner.html', 'Reply to this review')}`)
  }));

define('reviewReplyNotice',
  { account: 'info', category: 'Reviews', label: 'Hotel replied to your review',
    description: 'Tells the guest the hotel replied to the review they left.',
    sample: { guestName: 'Priya Nair', hotelName: 'The Grand Palace', reply: 'Thank you so much for the kind words — we hope to host you again!', rating: 5 } },
  ({ guestName, hotelName, reply, rating }) => ({
    subject: `${hotelName} replied to your review`,
    text: `Hi ${guestName}, ${hotelName} replied to your ${rating}★ review:\n\n${reply}\n\n${env.PUBLIC_URL}/user-portal.html`,
    html: layout('The hotel replied to your review',
      `<p style="line-height:1.6">Hi ${guestName}, <b>${hotelName}</b> replied to your ${rating}★ review.</p>
       ${quote(reply, '#10B981')}
       ${button(env.PUBLIC_URL + '/user-portal.html', 'Open your portal')}`)
  }));

define('reviewRequest',
  { account: 'info', category: 'Traveler', label: 'Ask guest for a review',
    description: 'Automated ask, sent a few days after a responded enquiry.',
    sample: { name: 'Priya Nair', hotelName: 'The Grand Palace', enquiryId: 'HZ-ENQ-58231' } },
  ({ name, hotelName, enquiryId }) => ({
    subject: `How was ${hotelName}?`,
    text: `Hi ${name}, you enquired at ${hotelName} recently. A short review helps other travellers pick well: ${env.PUBLIC_URL}/user-portal.html#enquiries`,
    html: layout('How did it go?',
      `<p style="line-height:1.6">Hi ${name}, you enquired at <b>${hotelName}</b> recently (${enquiryId}). A short, honest review helps the next traveller choose well.</p>
       ${button(env.PUBLIC_URL + '/user-portal.html#enquiries', 'Write a review')}`)
  }));

/* =========================================================================
   CLAIMS
   ========================================================================= */

define('claimSubmitted',
  { account: 'support', category: 'Claims', label: 'Claim submitted',
    description: 'Confirms a property claim was received and is under review.',
    sample: { name: 'Rohan Mehta', hotelName: 'The Grand Palace' } },
  ({ name, hotelName }) => ({
    subject: `Claim received for ${hotelName}`,
    text: `Hi ${name}, we received your claim for ${hotelName}. Our team verifies ownership within 24 hours and emails you once the listing is yours.`,
    html: layout('Claim received',
      `<p style="line-height:1.6">Hi ${name}, we received your ownership claim for <b>${hotelName}</b>. Our team verifies within 24 hours and emails you once the listing is transferred.</p>`)
  }));

define('claimApproved',
  { account: 'support', category: 'Claims', label: 'Claim approved',
    description: 'Tells the owner their claim was verified and approved.',
    sample: { name: 'Rohan Mehta', hotelName: 'The Grand Palace' } },
  ({ name, hotelName }) => ({
    subject: `${hotelName} is now yours on Hotelzz`,
    text: `Hi ${name}, your claim for ${hotelName} is approved. Manage the listing here: ${env.PUBLIC_URL}/owner.html`,
    html: layout('Your listing is verified',
      `<p style="line-height:1.6">Hi ${name}, your claim for <b>${hotelName}</b> is approved. You can now edit the listing and answer guest enquiries.</p>
       ${button(env.PUBLIC_URL + '/owner.html', 'Open owner dashboard')}`)
  }));

define('claimRejected',
  { account: 'support', category: 'Claims', label: 'Claim rejected',
    description: 'Tells the claimant their ownership claim was not approved.',
    sample: { name: 'Rohan Mehta', hotelName: 'The Grand Palace', reason: 'We could not verify a phone or GST match for this property.' } },
  ({ name, hotelName, reason }) => ({
    subject: `Your claim for ${hotelName} was not approved`,
    text: `Hi ${name}, we could not verify your claim for ${hotelName}.${reason ? ' Reason: ' + reason : ''} Reply to this email if you'd like to resubmit with more proof of ownership.`,
    html: layout('Claim not approved',
      `<p style="line-height:1.6">Hi ${name}, we were not able to verify your ownership claim for <b>${hotelName}</b>.</p>
       ${reason ? quote(reason, '#B91C1C') : ''}
       <p style="line-height:1.6">Reply to this email with more proof of ownership (utility bill, GST certificate, business email) and we'll take another look.</p>`)
  }));

/* =========================================================================
   SUBSCRIPTIONS / BILLING — support@
   ========================================================================= */

define('subscriptionChanged',
  { account: 'support', category: 'Billing', label: 'Plan changed',
    description: 'Confirms an owner\'s subscription plan just changed.',
    sample: { name: 'Rohan Mehta', hotelName: 'The Grand Palace', planName: 'Professional Plan', price: '₹2,499' } },
  ({ name, hotelName, planName, price }) => ({
    subject: `${hotelName} is now on the ${planName}`,
    text: `Hi ${name}, ${hotelName} has moved to the ${planName} (${price}). Manage it any time: ${env.PUBLIC_URL}/owner.html#billing`,
    html: layout('Plan updated',
      `<p style="line-height:1.6">Hi ${name}, <b>${hotelName}</b> is now on the <b>${planName}</b>${price ? ' (' + price + ')' : ''}.</p>
       ${button(env.PUBLIC_URL + '/owner.html#billing', 'Manage billing')}`)
  }));

define('invoiceIssued',
  { account: 'support', category: 'Billing', label: 'Invoice issued',
    description: 'A new invoice was raised for a subscription or campaign.',
    sample: { name: 'Rohan Mehta', hotelName: 'The Grand Palace', invoiceNumber: 'HZ-20261004', amount: '₹2,499', planName: 'Professional Plan' } },
  ({ name, hotelName, invoiceNumber, amount, planName }) => ({
    subject: `Invoice ${invoiceNumber} for ${hotelName}`,
    text: `Hi ${name}, invoice ${invoiceNumber} (${amount}) for ${planName} on ${hotelName} is ready. View and pay: ${env.PUBLIC_URL}/owner.html#billing`,
    html: layout('New invoice',
      `<p style="line-height:1.6">Hi ${name}, a new invoice is ready for <b>${hotelName}</b>.</p>
       ${infoTable([['Invoice', invoiceNumber], ['Plan', planName], ['Amount', amount]])}
       ${button(env.PUBLIC_URL + '/owner.html#billing', 'View invoice')}`)
  }));

define('paymentReceipt',
  { account: 'info', category: 'Billing', label: 'Payment receipt',
    description: 'Confirms a payment was received.',
    sample: { name: 'Rohan Mehta', amount: 2499, currency: 'INR', purpose: 'subscription', reference: 'HZ-20261004' } },
  ({ name, amount, currency, purpose, reference }) => ({
    subject: `Payment received — ${currency} ${amount}`,
    text: `Hi ${name}, we received ${currency} ${amount} for your Hotelzz ${purpose} (${reference}). Your invoice is marked paid.`,
    html: layout('Payment received',
      `<p style="line-height:1.6">Hi ${name}, we received <b>${currency} ${Number(amount).toLocaleString('en-IN')}</b> for your Hotelzz ${purpose}.</p>
       <p style="color:#64748B;font-size:13px">Reference: ${reference}</p>
       ${button(env.PUBLIC_URL + '/owner.html#billing', 'View invoices')}`)
  }));

/* =========================================================================
   MARKETING / CAMPAIGNS
   ========================================================================= */

define('leadReceipt',
  { account: 'info', category: 'Marketing', label: 'Marketing lead receipt',
    description: 'Acknowledges a public marketing/pricing enquiry.',
    sample: { name: 'Rohan Mehta', plan: 'Professional Plan' } },
  ({ name, plan }) => ({
    subject: 'We received your Hotelzz marketing enquiry',
    text: `Hi ${name}, thanks for your interest in the ${plan || 'Hotelzz'} plan. Our team calls you back within one business day.`,
    html: layout('Thanks — we have your request',
      `<p style="line-height:1.6">Hi ${name}, thanks for your interest in the <b>${plan || 'Hotelzz'}</b> plan. Our team will call you back within one business day.</p>`)
  }));

define('leadFollowUp',
  { account: 'info', category: 'Marketing', label: 'Lead follow-up',
    description: 'Automated nudge to a marketing lead that has gone quiet 3+ days.',
    sample: { name: 'Rohan Mehta', plan: 'Professional Plan' } },
  ({ name, plan }) => ({
    subject: 'Still interested in growing direct bookings?',
    text: `Hi ${name}, you asked about the ${plan || 'Hotelzz'} plan a few days ago. Reply to this email and we will set it up, or call +91 99300 90487.`,
    html: layout('Shall we pick this up?',
      `<p style="line-height:1.6">Hi ${name}, you asked about the <b>${plan || 'Hotelzz'}</b> plan a few days back. Reply to this email and our team will set it up — or call <b>+91 99300 90487</b>.</p>
       ${button(env.PUBLIC_URL + '/marketing.html#pricing', 'See the plans again')}`)
  }));

define('campaignCreated',
  { account: 'support', category: 'Marketing', label: 'Campaign submitted',
    description: 'Confirms an owner\'s ad campaign request was submitted.',
    sample: { name: 'Rohan Mehta', hotelName: 'The Grand Palace', campaignId: 'HZ-CMP-20261004-102', packageName: 'Growth Boost', amount: '₹8,850' } },
  ({ name, hotelName, campaignId, packageName, amount }) => ({
    subject: `Campaign ${campaignId} submitted for ${hotelName}`,
    text: `Hi ${name}, your ${packageName} campaign (${campaignId}) for ${hotelName} — ${amount} incl. GST — is submitted for review. Track it: ${env.PUBLIC_URL}/owner.html#grow-business`,
    html: layout('Campaign submitted',
      `<p style="line-height:1.6">Hi ${name}, your <b>${packageName}</b> campaign for <b>${hotelName}</b> is submitted to the Hotelzz marketing team.</p>
       ${infoTable([['Campaign', campaignId], ['Amount', amount]])}
       ${button(env.PUBLIC_URL + '/owner.html#grow-business', 'Track this campaign')}`)
  }));

define('campaignStatus',
  { account: 'support', category: 'Marketing', label: 'Campaign status change',
    description: 'Tells the owner their campaign status changed (Active, Paused, Completed...).',
    sample: { name: 'Rohan Mehta', campaignId: 'HZ-CMP-20261004-102', campaign: 'Growth Boost — The Grand Palace', status: 'Active', note: 'Live on Meta and Google.' } },
  ({ name, campaignId, campaign, status, note }) => ({
    subject: `Campaign ${campaignId} is now ${status}`,
    text: `Hi ${name}, your campaign "${campaign}" (${campaignId}) is now ${status}.` +
          (note ? '\n\n' + note : '') +
          `\n\nTrack it: ${env.PUBLIC_URL}/owner.html#grow-business`,
    html: layout(`Campaign ${status}`,
      `<p style="line-height:1.6">Hi ${name}, your campaign <b>${campaign}</b> (${campaignId}) is now <b>${status}</b>.</p>
       ${note ? quote(note) : ''}
       ${button(env.PUBLIC_URL + '/owner.html#grow-business', 'Open campaign dashboard')}`)
  }));

/* =========================================================================
   OWNER ACCOUNT — support@
   ========================================================================= */

define('partnerAccountActivated',
  { account: 'support', category: 'Partner', label: 'Partner account activated',
    description: 'An admin reactivated a suspended partner account.',
    sample: { name: 'Rohan Mehta' } },
  ({ name }) => ({
    subject: 'Your Hotelzz partner account is active again',
    text: `Hi ${name}, your Hotelzz partner account has been reactivated. Sign in: ${env.PUBLIC_URL}/owner.html`,
    html: layout('Account reactivated',
      `<p style="line-height:1.6">Hi ${name}, your Hotelzz partner account is active again — you can sign back in and manage your listing.</p>
       ${button(env.PUBLIC_URL + '/owner.html', 'Open owner dashboard')}`)
  }));

define('partnerAccountSuspended',
  { account: 'support', category: 'Partner', label: 'Partner account suspended',
    description: 'An admin suspended a partner account.',
    sample: { name: 'Rohan Mehta', reason: 'Repeated guest complaints under review.' } },
  ({ name, reason }) => ({
    subject: 'Your Hotelzz partner account has been suspended',
    text: `Hi ${name}, your Hotelzz partner account has been suspended.${reason ? ' Reason: ' + reason : ''} Reply to this email if you believe this is a mistake.`,
    html: layout('Account suspended',
      `<p style="line-height:1.6">Hi ${name}, your Hotelzz partner account has been suspended.</p>
       ${reason ? quote(reason, '#B91C1C') : ''}
       <p style="line-height:1.6">Reply to this email if you believe this is a mistake.</p>`)
  }));

define('ownerDigest',
  { account: 'support', category: 'Partner', label: 'Weekly owner digest',
    description: 'Automated weekly performance summary for an active listing.',
    sample: { name: 'Rohan Mehta', hotelName: 'The Grand Palace', enquiries: 14, unanswered: 2, reviews: 3, views: 812, favourites: 27 } },
  ({ name, hotelName, enquiries, unanswered, reviews, views, favourites }) => ({
    subject: `Your Hotelzz week: ${enquiries} enquiries for ${hotelName}`,
    text: `Hi ${name}, last 7 days for ${hotelName}: ${enquiries} enquiries (${unanswered} still unanswered), ${reviews} new reviews, ${views} listing views, ${favourites} saves.

Dashboard: ${env.PUBLIC_URL}/owner.html`,
    html: layout('Your week on Hotelzz',
      `<p style="line-height:1.6">Hi ${name}, here is how <b>${hotelName}</b> performed over the last 7 days.</p>
       <table style="font-size:14px;line-height:2;width:100%">
        <tr><td style="color:#64748B">Enquiries</td><td align="right"><b>${enquiries}</b></td></tr>
        <tr><td style="color:#64748B">Still unanswered</td><td align="right"><b style="color:${unanswered ? '#B91C1C' : '#047857'}">${unanswered}</b></td></tr>
        <tr><td style="color:#64748B">New reviews</td><td align="right"><b>${reviews}</b></td></tr>
        <tr><td style="color:#64748B">Listing views</td><td align="right"><b>${views}</b></td></tr>
        <tr><td style="color:#64748B">Saved by travellers</td><td align="right"><b>${favourites}</b></td></tr>
       </table>
       ${button(env.PUBLIC_URL + '/owner.html', 'Open dashboard')}`)
  }));

/* =========================================================================
   ADMIN OPS — admin@
   ========================================================================= */

define('adminNewEnquiry',
  { account: 'admin', category: 'Admin', label: 'New enquiry (ops copy)',
    description: 'Internal copy of every new guest enquiry.',
    sample: { hotelName: 'The Grand Palace', guestName: 'Priya Nair', guestEmail: 'priya@example.com', guestPhone: '+91 98200 12345', enquiryId: 'HZ-ENQ-58231', city: 'Mumbai' } },
  ({ hotelName, guestName, guestEmail, guestPhone, enquiryId, city }) => ({
    subject: `Enquiry ${enquiryId} — ${hotelName} (${city || 'n/a'})`,
    text: `Enquiry ${enquiryId}
Hotel: ${hotelName}
City: ${city}
Guest: ${guestName} / ${guestEmail} / ${guestPhone}`,
    html: layout('New enquiry on the platform',
      infoTable([['Reference', enquiryId], ['Hotel', hotelName], ['City', city || '—'],
                 ['Guest', `${guestName} · ${guestEmail} · ${guestPhone || '—'}`]]))
  }));

define('adminNewLead',
  { account: 'admin', category: 'Admin', label: 'New marketing lead (ops copy)',
    description: 'Internal copy of a new marketing/pricing lead or campaign request.',
    sample: { name: 'Rohan Mehta', email: 'rohan@example.com', phone: '+91 98200 12345', hotelName: 'The Grand Palace', city: 'Mumbai', plan: 'Professional Plan', message: 'Interested in the growth package.' } },
  ({ name, email, phone, hotelName, city, plan, message }) => ({
    subject: `New marketing lead: ${hotelName || name}${plan ? ' — ' + plan : ''}`,
    text: `New lead.
Name: ${name}
Hotel: ${hotelName}
City: ${city}
Plan: ${plan}
Email: ${email}
Phone: ${phone}
Message: ${message}`,
    html: layout('New marketing lead',
      infoTable([['Name', name], ['Hotel', hotelName || '—'], ['City', city || '—'],
                 ['Plan', plan || '—'], ['Email', email || '—'], ['Phone', phone || '—']]) +
      quote(message || 'No message.'))
  }));

define('adminNewOwner',
  { account: 'admin', category: 'Admin', label: 'New partner registration (ops copy)',
    description: 'Internal copy of every new hotel partner registration.',
    sample: { name: 'Rohan Mehta', hotelName: 'The Grand Palace', city: 'Mumbai', email: 'rohan@example.com', phone: '+91 98200 12345' } },
  ({ name, hotelName, city, email, phone }) => ({
    subject: `New hotel partner: ${hotelName} (${city})`,
    text: `New owner registration.\nHotel: ${hotelName}\nCity: ${city}\nOwner: ${name}\nEmail: ${email}\nPhone: ${phone}`,
    html: layout('New hotel partner registration',
      infoTable([['Hotel', hotelName], ['City', city], ['Owner', name], ['Email', email], ['Phone', phone]]))
  }));

define('adminDigest',
  { account: 'admin', category: 'Admin', label: 'Daily ops digest',
    description: 'Automated once-daily platform health summary.',
    sample: { enquiries: 42, unanswered: 5, leads: 9, claims: 3, newOwners: 4, failedEmails: 0 } },
  ({ enquiries, unanswered, leads, claims, newOwners, failedEmails }) => ({
    subject: `Hotelzz daily ops: ${enquiries} enquiries, ${claims} claims waiting`,
    text: `Last 24h — enquiries ${enquiries} (${unanswered} unanswered >24h), marketing leads ${leads}, claims awaiting approval ${claims}, new partners ${newOwners}, failed emails ${failedEmails}.`,
    html: layout('Daily operations digest',
      `<table style="font-size:14px;line-height:2;width:100%">
        <tr><td style="color:#64748B">New enquiries (24h)</td><td align="right"><b>${enquiries}</b></td></tr>
        <tr><td style="color:#64748B">Unanswered over 24h</td><td align="right"><b style="color:${unanswered ? '#B91C1C' : '#047857'}">${unanswered}</b></td></tr>
        <tr><td style="color:#64748B">Marketing leads (24h)</td><td align="right"><b>${leads}</b></td></tr>
        <tr><td style="color:#64748B">Claims awaiting approval</td><td align="right"><b>${claims}</b></td></tr>
        <tr><td style="color:#64748B">New partners (24h)</td><td align="right"><b>${newOwners}</b></td></tr>
        <tr><td style="color:#64748B">Failed emails (24h)</td><td align="right"><b style="color:${failedEmails ? '#B91C1C' : '#047857'}">${failedEmails}</b></td></tr>
       </table>
       ${button(env.PUBLIC_URL + '/admin.html', 'Open admin panel')}`)
  }));

/* ------------------------------------------------------------- catalogue */

/** Public listing for the admin panel's template gallery — no build fn. */
function listTemplates() {
  return Object.values(T).map(({ name, account, category, label, description, sample }) =>
    ({ name, account, category, label, description, sample }));
}

/** Pure render — merges sample data with overrides, no send, no DB write. */
function renderTemplate(name, data) {
  const t = T[name];
  if (!t) throw new Error('Unknown email template: ' + name);
  const merged = Object.assign({}, t.sample, data || {});
  const msg = t.build(merged);
  return Object.assign({ account: t.account, from: (env.SMTP_ACCOUNTS[t.account] || env.SMTP_ACCOUNTS.info).from }, msg);
}

/* ------------------------------------------------------------------ send */

function logEmail({ to, subject, template, account, from, status, error, text, html, kind, senderUserId }) {
  const id = uid('eml');
  db.prepare(
    `INSERT INTO email_log (id,to_addr,subject,template,status,error,preview,account,from_addr,body_html,kind,sender_user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, to, subject, template || null, status, error || null, (text || '').slice(0, 400),
        account || null, from || null, html || null, kind || 'auto', senderUserId || null);
  return id;
}

/**
 * Sends a registered template. opts:
 *   account   — override which mailbox sends it (defaults to the template's own)
 *   from      — override the From header
 *   replyTo   — set Reply-To
 *   kind      — 'auto' | 'manual' | 'vendor' (defaults to 'auto'), just for the log
 *   senderUserId — who triggered a manual/vendor send, for the log
 */
async function sendMail(to, templateName, data, opts) {
  opts = opts || {};
  const t = T[templateName];
  if (!t) throw new Error('Unknown email template: ' + templateName);
  const account = opts.account || t.account;
  const acctCfg = env.SMTP_ACCOUNTS[account] || env.SMTP_ACCOUNTS.info;
  const from = opts.from || acctCfg.from;
  const msg = t.build(Object.assign({}, t.sample, data || {}));

  try {
    await getTransport(account).sendMail({ from, to, replyTo: opts.replyTo, ...msg });
    const id = logEmail({
      to, subject: msg.subject, template: templateName, account, from,
      status: accountConfigured(account) ? 'sent' : 'dev-logged',
      text: msg.text, html: msg.html, kind: opts.kind, senderUserId: opts.senderUserId
    });
    return { ok: true, id };
  } catch (err) {
    console.error('[mail] send failed:', err.message);
    const id = logEmail({
      to, subject: msg.subject, template: templateName, account, from, status: 'failed',
      error: String(err.message).slice(0, 500), text: msg.text, html: msg.html,
      kind: opts.kind, senderUserId: opts.senderUserId
    });
    return { ok: false, id, error: err.message };
  }
}

// Fire-and-forget: email failures must never break the API response.
function sendMailAsync(to, templateName, data, opts) {
  sendMail(to, templateName, data, opts).catch((e) => console.error('[mail]', e.message));
}

/** Free-form send (admin manual/broadcast) — not a registered template. */
async function sendCustomMail(to, { subject, text, html }, opts) {
  opts = opts || {};
  const account = opts.account || 'admin';
  const acctCfg = env.SMTP_ACCOUNTS[account] || env.SMTP_ACCOUNTS.info;
  const from = opts.from || acctCfg.from;
  const msg = { subject, text: text || '', html: html || `<p>${String(text || '').replace(/\n/g, '<br/>')}</p>` };

  try {
    await getTransport(account).sendMail({ from, to, replyTo: opts.replyTo, ...msg });
    const id = logEmail({
      to, subject, template: null, account, from,
      status: accountConfigured(account) ? 'sent' : 'dev-logged',
      text: msg.text, html: msg.html, kind: 'manual', senderUserId: opts.senderUserId
    });
    return { ok: true, id };
  } catch (err) {
    console.error('[mail] custom send failed:', err.message);
    const id = logEmail({
      to, subject, template: null, account, from, status: 'failed',
      error: String(err.message).slice(0, 500), text: msg.text, html: msg.html,
      kind: 'manual', senderUserId: opts.senderUserId
    });
    return { ok: false, id, error: err.message };
  }
}

module.exports = { sendMail, sendMailAsync, sendCustomMail, renderTemplate, listTemplates, templates: T };
