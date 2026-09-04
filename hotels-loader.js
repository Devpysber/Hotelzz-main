/**
 * Hotelzz.in — catalogue loader.
 *
 * Pages paint instantly from the bundled snapshot in `hotels-data.js`, then this
 * script refreshes `window.HOTELS` from the real database (`/api/properties/catalog`)
 * — every claimed, booked, reviewed listing lives there — and, if CSV_URLS
 * below is non-empty, layers any Google Sheet rows on top as an editable
 * overlay (see SETUP-GOOGLE-SHEET.md Part 1): a sheet row with a matching id
 * overrides the database version, a new id adds a new listing, but nothing
 * in the database ever disappears just because it's absent from a sheet.
 * Fires a `hotelsUpdated` event once merged so open views re-render.
 *
 * Every sheet in CSV_URLS is fetched (later sheets win on matching id) — add
 * one entry per region/source as you grow the sheet set, no code change
 * needed. Two row shapes are understood automatically:
 *   - Hotelzz format: id,name,location,city_slug,address,phone,email,website,
 *     rating,pincode,image_url,property_type,active,google_cid,...
 *   - Raw Maps-scrape format: Keyword,Location,Company name,Website,Phone,
 *     Email 1,Email 2,Address,City,State,Pincode,Rating count,Review,Cid
 *     (id is derived from the name + Cid; rating parsed out of "Rated X out
 *     of 5" text; "No Email found" placeholders are dropped)
 *
 * The response is cached in localStorage for 30 minutes and revalidated with an
 * ETag when it came from the API (Sheet CSV always refetches — Google doesn't
 * hand out ETags for published Sheets), so a repeat visit costs one 304.
 */
(function () {
  // One entry per Google Sheet to pull the catalogue from. Each must be a
  // direct CSV link — either "Publish to web → CSV", or (if the Sheet is
  // just shared "Anyone with the link") the export URL:
  //   https://docs.google.com/spreadsheets/d/<SHEET_ID>/export?format=csv
  // Leave the array empty to keep using the API/database instead.
  var CSV_URLS = [
    'https://docs.google.com/spreadsheets/d/1lEc1qdoa5QiYIGam-LZ8SgnN1m0Dl2La/export?format=csv'
  ];

  var API_URL = '/api/properties/catalog';
  var CACHE_KEY = 'hotelzz_catalog_v2';
  var CACHE_TTL_MS = 30 * 60 * 1000;

  function slugify(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
  }

  function dispatchUpdate() {
    try {
      window.dispatchEvent(new CustomEvent('hotelsUpdated'));
    } catch (e) {
      var ev = document.createEvent('Event');
      ev.initEvent('hotelsUpdated', true, true);
      window.dispatchEvent(ev);
    }
  }

  function store(hotels, etag) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), e: etag || null, d: hotels }));
    } catch (e) { /* quota — the snapshot still works */ }
  }

  function read() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; }
  }

  function normalize(h) {
    h.rating = parseFloat(h.rating) || 4.5;
    if (!h.city_slug && h.location) h.city_slug = slugify(h.location);
    // Real amenities only — the API sends a flat array (possibly empty) when
    // the owner has set any; Sheet rows never carry this field at all. Pages
    // must never invent amenities for a listing that doesn't have real ones.
    h.realAmenities = Array.isArray(h.amenities) ? h.amenities.filter(Boolean) : [];
    return h;
  }

  // Raw Google-Maps-scrape row (Keyword,Location,Company name,Website,Phone,
  // Email 1,Email 2,Address,City,State,Pincode,Rating count,Review,Cid) → the
  // same shape the Hotelzz-format rows use.
  function mapScrapeRow(o) {
    var name = o['Company name'];
    if (!name) return null;
    var cid = (o['Cid'] || '').replace(/\D/g, '');

    var email = o['Email 1'];
    if (!email || /no email/i.test(email)) email = o['Email 2'];
    if (/no email/i.test(email || '')) email = '';

    var ratingText = o['Review'] || o['Rating count'] || '';
    var ratingMatch = String(ratingText).match(/([\d.]+)\s*(?:out of|\/)\s*5/i);
    var rating = ratingMatch ? ratingMatch[1] : (parseFloat(o['Rating count']) || '');

    return {
      id: slugify(name) + (cid ? '-' + cid.slice(-6) : ''),
      name: name,
      location: o['Location'] || o['City'] || '',
      address: o['Address'] || '',
      phone: o['Phone'] || '',
      email: email || '',
      website: o['Website'] || '',
      rating: rating,
      pincode: o['Pincode'] || '',
      google_cid: cid || '',
      active: 'yes'
    };
  }

  // Minimal RFC4180 CSV parser (quoted fields, embedded commas/newlines/"").
  // Understands both the Hotelzz row shape (id,name,... already present) and
  // the raw scrape shape (mapped via mapScrapeRow).
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    var rows = [], i = 0, field = '', row = [], inQuotes = false;
    while (i < text.length) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); field = ''; row = []; i++; continue; }
      field += ch; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    if (rows.length < 2) return [];

    var cols = rows[0].map(function (c) { return c.trim(); });
    return rows.slice(1)
      .filter(function (r) { return !(r.length === 1 && !r[0].trim()); })
      .map(function (r) {
        var o = {};
        cols.forEach(function (c, idx) { o[c] = (r[idx] || '').trim(); });
        return (o.id && o.name) ? o : mapScrapeRow(o);
      })
      .filter(function (o) { return o && o.id && o.name && String(o.active || 'yes').toLowerCase() !== 'no'; });
  }

  var cached = read();
  if (cached && Array.isArray(cached.d) && cached.d.length > 5 &&
      (Date.now() - cached.t) < CACHE_TTL_MS) {
    window.HOTELS = cached.d;
    dispatchUpdate();
  }

  function fetchSheets() {
    // One sheet failing doesn't sink the rest — it's just left out, logged
    // as a warning. Later sheets in the list win on a matching id.
    return Promise.all(CSV_URLS.map(function (url) {
      return fetch(url, { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then(function (text) { return parseCsv(text).map(normalize); })
        .catch(function (err) {
          console.warn('[Hotelzz] Sheet fetch failed, skipping: ' + url, err);
          return [];
        });
    })).then(function (batches) {
      var byId = {};
      batches.forEach(function (batch) {
        batch.forEach(function (h) { byId[h.id] = h; });
      });
      return byId;
    });
  }

  function fetchApi() {
    var headers = {};
    if (cached && cached.e) headers['If-None-Match'] = cached.e;
    return fetch(API_URL, { headers: headers, credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 304 && cached) return { hotels: cached.d, etag: cached.e, unchanged: true };
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var etag = res.headers.get('ETag');
        return res.json().then(function (body) {
          var hotels = (body.hotels || []).map(function (h) {
            h.active = 'yes';
            return normalize(h);
          });
          return { hotels: hotels, etag: etag };
        });
      })
      .catch(function (err) {
        console.warn('[Hotelzz] Catalogue API fetch failed.', err);
        return { hotels: [], etag: null };
      });
  }

  // The database (via the API) is always the base catalogue — every real
  // listing, claim, booking and review lives there. Any Sheet in CSV_URLS is
  // layered on top as an editable overlay: its rows add new properties or
  // override matching ids, but never remove what the database already has.
  Promise.all([fetchApi(), (CSV_URLS && CSV_URLS.length) ? fetchSheets() : {}])
    .then(function (results) {
      var apiResult = results[0];
      var sheetById = results[1];

      if (apiResult.unchanged && !Object.keys(sheetById).length) {
        window.HOTELS = apiResult.hotels;
        store(apiResult.hotels, apiResult.etag);
        dispatchUpdate();
        return;
      }

      var byId = {};
      apiResult.hotels.forEach(function (h) { byId[h.id] = h; });
      Object.keys(sheetById).forEach(function (id) { byId[id] = sheetById[id]; });
      var hotels = Object.keys(byId).map(function (id) { return byId[id]; });

      if (hotels.length < 1) throw new Error('Catalogue empty — API and every sheet unreachable');

      window.HOTELS = hotels;
      store(hotels, apiResult.etag);
      dispatchUpdate();
      var sheetCount = Object.keys(sheetById).length;
      console.info('[Hotelzz] Catalogue loaded: ' + hotels.length + ' properties (' +
        apiResult.hotels.length + ' from the database' + (sheetCount ? ', ' + sheetCount + ' from ' + CSV_URLS.length + ' Google Sheet(s) layered on top' : '') + ').');
    })
    .catch(function (err) {
      console.warn('[Hotelzz] Catalogue fetch failed; using the bundled snapshot.', err);
    });
})();
