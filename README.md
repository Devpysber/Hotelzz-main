# Hotelzz.in

India's hotel marketplace + marketing platform. Static front end backed by a Node/Express API and SQLite.

**Live:** [hotelzz.in](https://hotelzz.in)

## Stack

- Static HTML/CSS/vanilla JS (no build step) served by the API process, same origin
- Node 20+ / Express — REST API under `/api`
- SQLite (better-sqlite3, WAL) — single file at `data/hotelzz.db`
- Auth: bcrypt passwords + email OTP, JWT in an httpOnly cookie, role-scoped (`traveler` / `owner` / `admin`)
- Email: nodemailer over SMTP, with a dev transport that prints to the console
- Scheduled email automation inside the web process (`server/lib/automation.js`)

## Run it

```bash
npm install
cp .env.example .env          # fill in SMTP + JWT_SECRET for production
npm start                     # http://localhost:3000
npm run dev                   # same, with --watch

npm run import:hotels         # load hotels.csv into the properties table
npm test                      # browser smoke tests (needs the server running)
```

Seeded accounts in development (`NODE_ENV=development`):

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@hotelzz.in` | `admin123` |
| Owner | `owner@grandpalace.com` | `owner12345` |
| Traveler | `rahul@example.com` | `password123` |

Change `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` before deploying; the owner and
traveler accounts are only created outside production.

## Structure

```
server/
  index.js               Express app: middleware, routes, static hosting, startup
  lib/env.js             Config from .env
  lib/db.js              Schema, migrations, uid(), audit()
  lib/auth.js            Passwords, JWT cookies, role guards, OTP/reset tokens
  lib/mailer.js          SMTP transport + every email template
  lib/automation.js      Scheduled email jobs (idempotent)
  lib/seed.js            Admin user, dev fixtures, marketing packages
  lib/http.js            Validation, rate limits, helpers
  routes/auth.js         Register, login, OTP, password reset, profile
  routes/properties.js   Catalogue, search, listing CRUD, claim flow, view tracking
  routes/enquiries.js    Guest enquiries, owner open/respond, status
  routes/reviews.js      Reviews, owner replies, admin moderation
  routes/saved.js        Traveler saved hotels
  routes/owner.js        Owner dashboard bootstrap, rooms, photos, offers, plans
  routes/leads.js        Marketing leads + admin CRM
  routes/marketing.js    Campaign packages and campaigns
  routes/admin.js        Admin bootstrap, moderation, CSV import, email log
  scripts/import-hotels.js  CSV → properties (re-runnable)

api-client.js            Browser API client (window.HotelzzAPI)
enquiry-store.js         Traveler/enquiry store, server backed
owner-data.js            Owner dashboard data layer
admin-data.js            Admin panel data layer
marketing-store.js       Campaign packages/campaigns store
hotels-loader.js         Refreshes window.HOTELS from /api/properties/catalog

index.html               Homepage (hero search, destinations)
city.html                City listings (?city=<slug>)
property.html            Property detail + enquiry form
login.html               Traveler / owner / admin sign-in and registration
dashboard-login.html     Partner OTP login
reset-password.html      Password reset landing page
user-portal.html         Traveler portal
owner.html               Hotel owner dashboard
admin.html               Admin panel
claim.html               Guided listing claim
marketing.html           Marketing plans + lead capture
ota-listing.html         OTA listing service + lead capture
tests/                   Playwright smoke and flow tests
```

## Data flow

```
Browser page ──► api-client.js ──► /api/* ──► SQLite
                                     └─────► nodemailer ──► hotel / guest / admin

Enquiry:  guest submits on property.html
          → stored, hotel + guest + admin emailed
          → owner replies in owner.html  → guest emailed
          → 3 days later the traveler is asked for a review (automation)
```

## Email

Transactional mail fires on the event: OTP codes, welcome, enquiry to hotel,
enquiry receipt, hotel response, claim submitted/approved, new review, campaign
status, password reset/changed, and admin notifications.

Scheduled jobs run every 15 minutes and are idempotent (`automation_log` holds a
unique `(job, entity)` row):

| Job | When | To |
|-----|------|----|
| `enquiry-reminder` | enquiry unanswered after 24h | hotel owner |
| `review-request` | 3 days after the hotel replied | traveler |
| `owner-digest` | Mondays | hotel owner |
| `admin-digest` | daily, 08:00–10:00 | admin |
| `lead-followup` | 3 days after a new marketing lead | hotelier |

Admins can trigger a pass immediately with `POST /api/admin/automation/run`.
Without SMTP configured, messages are printed to the server console and recorded
in `email_log` with status `dev-logged` — nothing leaves the machine.

## Payments

Plan upgrades and campaign purchases run through `/api/payments`. With
`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` set, the owner dashboard opens Razorpay
checkout, the browser result is signature-verified server-side, and the
`/api/payments/webhook` endpoint (raw-body HMAC, `RAZORPAY_WEBHOOK_SECRET`)
confirms it independently. Amounts always come from the server's own invoice or
campaign record — never from the client.

Without those keys the same calls return a `manual` order: the amount is recorded
in `payments`, the customer is told the team will invoice, and an admin settles it
in **Admin → Payments**. Paying activates the subscription or campaign and emails
a receipt either way.

## Ad platforms

A paid campaign is handed to `server/lib/ads.js`, which creates it **paused** on
Meta (or Google Ads for the website-sales package) and syncs
impressions/clicks/spend back hourly into the owner and admin dashboards.

With no ad credentials configured the campaign simply stays `Pending` with an
"Awaiting manual setup" timeline entry — the manual workflow is the default, not
an error. Admin → Marketing states which mode is active.

## Uploads

Owners upload listing photos straight from the dashboard (JPG/PNG/WebP/AVIF, up
to `UPLOAD_MAX_MB`, 10 per request). Files are stored under `data/uploads/<month>/`
with generated names and served read-only from `/uploads/...`; the first image on
an empty listing becomes its cover automatically.

## Deployment notes

- Set `NODE_ENV=production`, a strong `JWT_SECRET`, `PUBLIC_URL`, and SMTP credentials.
- Run behind a TLS terminator; session cookies switch to `Secure` in production.
- `data/` holds the database and uploaded photos — back both up, keep them out of the web root.
- Point the Razorpay webhook at `https://<host>/api/payments/webhook` and set `RAZORPAY_WEBHOOK_SECRET`.
- The `.htaccess` file is only relevant to the legacy static-only hosting setup.
