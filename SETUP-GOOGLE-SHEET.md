# Hotelzz.in — Live Google Sheet Setup

This guide connects the website to a Google Sheet. Once set up, **any change you make in the Sheet automatically reflects on the live site** within 30 minutes (or instantly for new visitors).

## How it works

```
[ Google Sheet ]  →  [ Published CSV URL ]  →  [ hotels-loader.js ]  →  [ Live website ]
```

- Visitors see the **bundled snapshot** instantly (no waiting on the network).
- In the background, the loader fetches the latest CSV from your Sheet.
- Fresh data is cached for **30 minutes** in the browser, then refreshed.
- If the Sheet is ever unreachable, the bundled snapshot keeps the site running.

## One-time setup (5 minutes)

### Step 1 — Create the Sheet

1. Open [https://sheets.new](https://sheets.new) (creates a blank Google Sheet).
2. **File → Import → Upload → drop `hotels.csv`** (in this folder).
3. When prompted, choose **"Replace spreadsheet"** and click **Import data**.
4. Rename the sheet to something memorable like `Hotelzz Live Data`.

### Step 2 — Publish the Sheet as CSV

1. **File → Share → Publish to web**
2. Under "Link" tab:
   - Document: **Entire document**
   - Format: **Comma-separated values (.csv)**
3. Click **Publish** → confirm "OK".
4. **Copy the URL** that appears. It looks like:
   ```
   https://docs.google.com/spreadsheets/d/e/2PACX-1vXXXXXXXXXXXX/pub?output=csv
   ```

### Step 3 — Paste the URL into the loader

1. Open `hotels-loader.js` in a text editor.
2. Find this line near the top:
   ```js
   var CSV_URL = '';
   ```
3. Paste your published URL between the quotes:
   ```js
   var CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vXXXXXXXXXXXX/pub?output=csv';
   ```
4. Save the file. **Done.**

## Editing properties going forward

Just edit the Google Sheet — add rows, change phone numbers, swap photos. Changes reflect on the site within 30 minutes (or immediately for new visitors).

### Column reference

| Column | Required | Notes |
|---|---|---|
| `id` | yes | Unique slug. Don't reuse. Format: `lowercase-with-dashes-suffix` |
| `name` | yes | Property name shown to guests |
| `location` | yes | Area name (e.g. `Bandra`, `Calangute`) |
| `city_slug` | auto | URL slug — leave blank, system derives from `location` |
| `address` | recommended | Full address shown on listing |
| `phone` | recommended | Format: `09812345678` (display only) |
| `website` | optional | External link |
| `rating` | optional | 0.0 – 5.0. Defaults to 4.5 if blank |
| `pincode` | optional | Display only |
| `image_url` | optional | Direct URL to hero photo (Imgur, Cloudinary, your CDN). Falls back to a stock image if blank |
| `property_type` | optional | `Hotel` / `Villa` / `Homestay` / `Apartment` / `Resort`. Auto-detected from name if blank |
| `active` | optional | `yes` to show, `no` to hide. Defaults to `yes` |
| `google_cid` | optional | Google Maps Customer ID — when present, listings show a Google badge + link to live reviews. See "How to find a Google CID" below. |
| `google_review_count` | optional | Number to display next to the Google badge (e.g. `724`). |
| `google_summary` | optional | 1–2 sentence "AI-generated summary" shown on the property page review block. |
| `gmb_link` | optional | Direct URL to the property's Google My Business / Maps listing. Auto-derived from `google_cid` when blank. Also used for the "View on Google" buttons. |
| `hotelzz_link` | optional | Canonical URL of this property on hotelzz.in (e.g. `https://hotelzz.in/property.html?id=...`). Auto-derived from `id` if blank. Useful for sharing the listing externally and for SEO canonical tags. |

### How to find a Google CID

A CID is the unique numeric ID Google assigns to every business listing on Maps.

1. Open [google.com/maps](https://www.google.com/maps) and search for the hotel.
2. Click the listing → URL will look like `https://www.google.com/maps/place/Hotel+Name/@12.9,77.5,17z/data=!3m1!4b1!4m6!3m5!1s0x3bae...:0xCAFE1234DEADBEEF`
3. The CID is the **hex value after the colon in `0x...:0xCAFE...`** — convert to decimal.
4. Easiest tool: paste the Maps URL into [https://pleper.com/index.php?do=tools&sdo=cid_converter](https://pleper.com/index.php?do=tools&sdo=cid_converter) — it gives you the decimal CID.
5. Paste that decimal number into the `google_cid` column.

When a property has a `google_cid`:
- The listing card shows a Google rating badge (next to your own rating).
- The property page gets a full "Guest reviews" section with last-10 ratings, an AI summary, an embedded Google Map, and a "View on Google" link.
- Clicking the badge opens `https://www.google.com/maps?cid=<CID>` — Google's live review page for that property.

> **Tip:** All 114 Goa properties are pre-populated with real CIDs from your original CSV. The 208 Mumbai entries are blank — fill them in as you onboard real properties.

### Adding a new property

1. Open the Sheet → scroll to bottom → add a new row.
2. **Required:** unique `id`, `name`, `location` (use an existing area name to land in that city's listing page).
3. Save (Google Sheets auto-saves).

### Hiding a property without deleting it

Set `active` column to `no`. The property disappears from listings until you flip it back to `yes`.

### Adding a new city

1. Set `location` to the new area name (e.g. `Pune`).
2. Add at least one property with that location.
3. Add a destination tile manually in `index.html` if you want it on the homepage (search box & city pages already work generically).

## Cache & refresh

- The browser caches the CSV for **30 minutes** in `localStorage`.
- To force-refresh during testing: open browser console and run `localStorage.clear()` then reload.
- The cache key is `hotelzz_csv_v1`.

## Troubleshooting

**"My Sheet edits aren't showing up."**
- Wait up to a few minutes after publishing — Google takes time to update the published CSV (it's not real-time, usually 5-15 min lag).
- Hard-refresh the browser (Ctrl+Shift+R).
- Check the browser console — the loader logs `[Hotelzz] Live CSV loaded: N properties.` on success.

**"Console says 'Live CSV not configured'."**
- You forgot Step 3 — paste the URL into `hotels-loader.js`.

**"Console says 'Live CSV fetch failed'."**
- Make sure the Sheet is **published** (not just shared). Re-do Step 2.
- Check the URL ends with `?output=csv`.

**"Listings look broken after a Sheet edit."**
- You probably broke the header row. The first row of the Sheet must contain exactly these column names (any order, but spelled correctly):
  `id, name, location, city_slug, address, phone, website, rating, pincode, image_url, property_type, active`

---

# Part 2 — Capturing Leads in a Google Sheet

This is **separate** from the hotels Sheet above. It captures every form submission from the Marketing page **and** every property booking enquiry into one Sheet you can use for sales follow-ups.

## How it works

```
[ Form submit ]  ──►  [ WhatsApp opens with message ]   (you reply to guest)
                 └──►  [ Apps Script Web App ]  ──►  [ Leads Sheet new row ]   (permanent log)
```

Both happen at the same time. Even if the visitor closes WhatsApp without sending, you still have their details in the Sheet.

## Setup (10 minutes, one-time)

### Step 1 — Create the Leads Sheet

1. Open [https://sheets.new](https://sheets.new) — creates a fresh Sheet.
2. Rename it to something like **"Hotelzz Leads"**.
3. Rename the first tab to **"Leads"** (double-click the tab name at the bottom).

### Step 2 — Paste the Apps Script

1. **Extensions → Apps Script** (opens a new tab).
2. Delete any boilerplate `function myFunction() {}` code in `Code.gs`.
3. Open `LEADS-APPS-SCRIPT.gs` (in this folder) → copy the entire file → paste into `Code.gs`.
4. **Save** (Ctrl+S). Name the project anything (e.g. "Hotelzz Leads").

### Step 3 — Deploy as Web App

1. Click **Deploy → New deployment** (top right).
2. Click the gear icon ⚙️ next to "Select type" → choose **Web app**.
3. Fill in:
   - Description: `Hotelzz lead receiver`
   - Execute as: **Me (your email)**
   - Who has access: **Anyone**
4. Click **Deploy**.
5. **Authorize** when prompted:
   - Click "Authorize access" → choose your Google account.
   - You'll see a scary warning: "Google hasn't verified this app." This is normal for personal scripts.
   - Click **Advanced → Go to Hotelzz Leads (unsafe)** → **Allow**.
6. **Copy the Web app URL** (looks like: `https://script.google.com/macros/s/AKfy.../exec`).

### Step 4 — Paste the URL into the website

Open both files and paste the same URL in each:

- **`marketing.html`** — find `var LEADS_WEBAPP_URL = '';` (near the bottom `<script>` block) → paste between the quotes.
- **`property.html`** — find the same line near the bottom → paste the same URL.

Save. Done.

## Test it

1. Open `marketing.html` in your browser → click any "Get Started" / "Talk to Expert" / "Get Quote" button.
2. Fill the form → click "Send on WhatsApp".
3. WhatsApp opens (as before).
4. Open your Leads Sheet — a new row should appear within 5 seconds with all the form data.
5. Repeat with a property booking on `property.html` → also lands in the same Sheet.

## What the Sheet captures

| Column | What it logs |
|---|---|
| Timestamp | When the lead came in |
| Name | Guest / hotelier name |
| Hotel / Property | Their hotel name (marketing) or the booked property (booking) |
| Location | Their city |
| WhatsApp / Phone | For follow-up |
| Email | If they provided one |
| Service of Interest | Which CTA they clicked (Digital Marketing / Gold Plan / Booking Enquiry / etc.) |
| Property Size | Room count band (marketing) or `rooms / guests` (booking) |
| Notes | Their special requests + check-in/out dates for bookings |
| Source (CTA) | Exact button source for ad attribution (`hero_primary`, `plan_gold`, `property_form:xxx`) |
| Page | Which page they were on |
| User Agent | Device / browser (helpful for debugging) |

## Common issues

**"Nothing appears in the Sheet."**
- Did you Deploy (not just Save) the Apps Script? Step 3 is required.
- Did you set "Who has access" to **Anyone**? (Not "Anyone with a Google account")
- Did you paste the URL into both `marketing.html` AND `property.html`?
- Open browser DevTools → Network tab → submit a test lead → look for a POST to `script.google.com`. If missing, the URL isn't pasted right.

**"I edited the Apps Script — changes aren't taking effect."**
- Apps Script Web Apps require **redeploying** to publish changes. Use **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**.
- The Web App URL stays the same across redeployments — no need to re-paste.

**"How do I add fields to the Sheet later?"**
- Edit the `appendRow([...])` line in `LEADS-APPS-SCRIPT.gs` to add the new field.
- Edit the `pushLeadToSheet({...})` call in marketing.html / property.html to send the new field.
- Redeploy the Apps Script (see above).

---

# Part 3 — Every Admin Update, Mirrored to a Sheet

The Node backend (`server/`) is the real database now (Part 1's Sheet-as-catalogue
still works if you set `CSV_URL`, but claims, leads, users, payments etc. all
live in SQLite). This part makes the admin panel **also** write a row to a
Google Sheet every time something changes there — claim approved/rejected,
listing edited, review moderated, package price changed, campaign status
changed, CSV import run, settings saved, admin invited... anything that shows
up in **Admin → Activity** gets mirrored, automatically, no per-feature wiring.

## How it works

```
[ Any admin write ]  →  audit() in server/lib/db.js  →  Admin_Updates row in your Sheet
                                                       └→ audit_log table (still recorded, same as before)
```

## Setup (5 minutes, one-time)

You can reuse the **same Sheet and same Apps Script deployment** from Part 2
(Leads) — `handleLogUpdate_` and the `Admin_Updates` tab were added to
`LEADS-APPS-SCRIPT.gs` for you.

1. Open your existing "Hotelzz Leads" Sheet → **Extensions → Apps Script**.
2. Select all the code in `Code.gs`, delete it, paste the current
   `LEADS-APPS-SCRIPT.gs` from this folder (it now includes `handleLogUpdate_`
   alongside the existing lead/OTP/campaign handlers).
3. **Deploy → Manage deployments → pencil icon → Version: New version → Deploy.**
   The Web App URL stays the same — no need to touch `marketing.html` /
   `property.html` again.
4. Copy that Web App URL (same one from Part 2, `.../exec`).
5. Open `.env` in the project root (copy from `.env.example` if you don't have
   one yet) and set:
   ```
   GOOGLE_SHEET_WEBHOOK_URL=https://script.google.com/macros/s/AKfy.../exec
   ```
6. Restart the server (`npm start`). Nothing else to wire — every admin action
   already calls `audit()` internally.

No Sheet/tab pre-creation needed — `Admin_Updates` is created automatically on
the first mirrored action, same as `Leads` was.

## What lands in the Sheet

| Column | What it logs |
|---|---|
| Timestamp | When the action happened |
| Admin | Email of the admin who did it (falls back to their user id) |
| Change | Action code, e.g. `admin.property.update`, `admin.claim.approve`, `admin.import.csv` |
| Entity | What kind of record, e.g. `property`, `user`, `campaign` |
| Entity ID | The specific record's id |
| Details | JSON of what changed |
| IP | Request IP |

## Notes

- If `GOOGLE_SHEET_WEBHOOK_URL` is blank, this is a complete no-op — nothing
  changes, no delay, no error. Leave it blank if you don't want the mirror.
- The mirror is fire-and-forget: a slow or unreachable Sheet never blocks or
  fails the actual admin action. Failures are only logged to the server
  console (`[sheet-mirror] failed: ...`).
- The `audit_log` table in SQLite is still the source of truth for **Admin →
  Activity** in the panel itself — the Sheet is a convenience copy, not a
  replacement.
