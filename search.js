/**
 * Hotelzz.in — Global hotel search overlay.
 *
 * Reads window.HOTELS (populated by hotels-data.js bundled snapshot,
 * refreshed live by hotels-loader.js from Google Sheet).
 *
 * Auto-mounts on DOMContentLoaded.
 * Triggers:
 *   - Any element with [data-search-trigger] click
 *   - `/` key (unless focused in an input/textarea)
 * Close:
 *   - Escape
 *   - Backdrop click
 *   - × button
 *
 * Requires hotels-data.js + hotels-loader.js loaded on the page.
 */

(function () {
  var STYLES = ''
    + '.hz-search-fab{position:fixed;bottom:88px;right:20px;z-index:98;background:#2563EB;color:#fff;width:52px;height:52px;border-radius:50%;box-shadow:0 8px 22px rgba(37,99,235,0.4);display:none;align-items:center;justify-content:center;cursor:pointer;border:0;font-size:22px;transition:all .2s}'
    + '.hz-search-fab:hover{background:#1D4ED8;transform:scale(1.08)}'
    + '.hz-search-overlay{position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:9999;display:none;align-items:flex-start;justify-content:center;padding:60px 16px 16px;overflow-y:auto;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}'
    + '.hz-search-overlay.show{display:flex;animation:hzFade .18s ease}'
    + '@keyframes hzFade{from{opacity:0}to{opacity:1}}'
    + '.hz-search-panel{background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.24);width:100%;max-width:640px;overflow:hidden;font-family:Inter,-apple-system,sans-serif;animation:hzSlide .22s ease}'
    + '@keyframes hzSlide{from{transform:translateY(-14px);opacity:0}to{transform:translateY(0);opacity:1}}'
    + '.hz-search-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #E5E7EB}'
    + '.hz-search-head svg.mag{width:20px;height:20px;color:#9CA3AF;flex-shrink:0}'
    + '.hz-search-input{flex:1;border:0;outline:0;font-size:17px;font-weight:600;color:#1F2937;background:transparent;padding:6px 0;font-family:inherit}'
    + '.hz-search-input::placeholder{color:#9CA3AF;font-weight:500}'
    + '.hz-search-close{background:#F9FAFB;border:0;width:32px;height:32px;border-radius:8px;font-size:14px;color:#6B7280;cursor:pointer;font-weight:600;font-family:inherit}'
    + '.hz-search-close:hover{background:#EFF6FF;color:#2563EB}'
    + '.hz-search-hint{padding:8px 18px;font-size:11px;color:#9CA3AF;background:#F9FAFB;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}'
    + '.hz-search-hint kbd{background:#fff;border:1px solid #E5E7EB;border-radius:4px;padding:1px 6px;font-family:ui-monospace,monospace;font-size:11px;color:#374151;font-weight:600}'
    + '.hz-search-results{max-height:60vh;overflow-y:auto;padding:6px 0}'
    + '.hz-result{display:flex;align-items:center;gap:12px;padding:11px 18px;text-decoration:none;color:inherit;border-left:3px solid transparent;transition:background .1s}'
    + '.hz-result:hover,.hz-result.active{background:#EFF6FF;border-left-color:#2563EB}'
    + '.hz-result-avatar{width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,#DBEAFE,#93C5FD);color:#1E3A8A;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0;text-transform:uppercase}'
    + '.hz-result-body{flex:1;min-width:0}'
    + '.hz-result-name{font-size:14.5px;font-weight:700;color:#1F2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}'
    + '.hz-result-name mark{background:#FEF3C7;color:#92400E;padding:0 2px;border-radius:2px;font-weight:800}'
    + '.hz-result-meta{font-size:12px;color:#6B7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.hz-result-rating{display:inline-flex;align-items:center;gap:3px;background:#10B981;color:#fff;padding:2px 6px;border-radius:5px;font-size:11px;font-weight:700;flex-shrink:0;margin-left:8px}'
    + '.hz-result-empty{padding:30px 22px;text-align:center;color:#6B7280;font-size:14px;line-height:1.6}'
    + '.hz-result-empty strong{color:#1F2937;display:block;font-size:15px;margin-bottom:4px}'
    + '.hz-result-empty a{color:#2563EB;font-weight:600;text-decoration:none}'
    + '.hz-result-empty a:hover{text-decoration:underline}'
    + '.hz-view-all{padding:12px 18px;background:#F9FAFB;border-top:1px solid #E5E7EB;font-size:13px;text-align:center;color:#6B7280}'
    + '.hz-view-all a{color:#2563EB;font-weight:700;text-decoration:none}'
    + '.hz-view-all a:hover{text-decoration:underline}'
    + '.hz-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 18px;border-bottom:1px solid #E5E7EB;background:#fff}'
    + '.hz-city-select{border:1px solid #E5E7EB;border-radius:8px;padding:7px 10px;font:inherit;font-size:13px;font-weight:600;color:#1F2937;background:#F9FAFB;max-width:100%;flex:1 1 180px}'
    + '.hz-chip{border:1px solid #E5E7EB;background:#fff;color:#374151;border-radius:999px;padding:6px 12px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap}'
    + '.hz-chip.on{background:#2563EB;border-color:#2563EB;color:#fff}'
    + '.hz-popular{display:flex;gap:6px;overflow-x:auto;padding:8px 18px 10px;border-bottom:1px solid #E5E7EB;scrollbar-width:none}'
    + '.hz-popular::-webkit-scrollbar{display:none}'
    + '.hz-popular .hz-chip{font-weight:600}'
    + '.hz-section-label{padding:10px 18px 4px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#9CA3AF}'
    + '.hz-result-avatar.city{background:linear-gradient(135deg,#DCFCE7,#86EFAC);color:#14532D;font-size:18px}'
    + '@media (max-width:600px){.hz-search-overlay{padding:12px 8px 8px}.hz-search-input{font-size:16px}.hz-search-hint{display:none}.hz-search-results{max-height:calc(100vh - 230px)}}';

  var HTML = ''
    + '<div class="hz-search-panel" role="dialog" aria-modal="true" aria-labelledby="hzSearchTitle">'
    + '  <div class="hz-search-head">'
    + '    <svg class="mag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'
    + '    <input id="hzSearchInput" class="hz-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Hotel name, city or area…" aria-label="Search hotels" />'
    + '    <button class="hz-search-close" id="hzSearchClose" aria-label="Close search">ESC</button>'
    + '  </div>'
    + '  <div class="hz-filters">'
    + '    <select id="hzCityFilter" class="hz-city-select" aria-label="Filter by city"><option value="">All cities</option></select>'
    + '    <button type="button" class="hz-chip" id="hzTopRated" aria-pressed="false">★ 4.5+</button>'
    + '    <button type="button" class="hz-chip" id="hzVerified" aria-pressed="false">✓ Verified</button>'
    + '  </div>'
    + '  <div class="hz-popular" id="hzPopular" aria-label="Popular cities"></div>'
    + '  <div class="hz-search-hint">'
    + '    <span>Search hotel names, cities & areas</span>'
    + '    <span><kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>/</kbd> to open search</span>'
    + '  </div>'
    + '  <div class="hz-search-results" id="hzSearchResults"></div>'
    + '</div>';

  function inject() {
    var style = document.createElement('style'); style.textContent = STYLES; document.head.appendChild(style);
    var overlay = document.createElement('div'); overlay.className = 'hz-search-overlay'; overlay.id = 'hzSearchOverlay';
    overlay.innerHTML = HTML;
    document.body.appendChild(overlay);
    // No floating search button: it sat on top of the page's own search
    // form and the WhatsApp button on phones. The header search icon and the
    // phone menu's search box open this overlay instead.
  }

  // ─── Search index ───────────────────────────────────────────────────────
  function getHotels() {
    var list = (window.HOTELS || []).filter(function (h) {
      var a = String(h.active || 'yes').trim().toLowerCase();
      return !a || a === 'yes' || a === 'y' || a === 'true' || a === '1';
    });
    return list;
  }

  function normalize(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, ''); }
  function escHtml(s) { return String(s || '').replace(/[<>&"]/g, function (c) { return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; }); }
  function highlight(text, q) {
    if (!q) return escHtml(text);
    var lower = normalize(text), qn = normalize(q);
    var idx = lower.indexOf(qn);
    if (idx < 0) return escHtml(text);
    var pre = text.substring(0, idx), hit = text.substring(idx, idx + q.length), post = text.substring(idx + q.length);
    return escHtml(pre) + '<mark>' + escHtml(hit) + '</mark>' + escHtml(post);
  }

  function score(h, q) {
    var name = normalize(h.name || ''), loc = normalize(h.location || ''), addr = normalize(h.address || '');
    if (name.indexOf(q) === 0) return 1000;
    if (name.indexOf(' ' + q) > -1) return 900;
    if (name.indexOf(q) > -1) return 800;
    if (loc.indexOf(q) === 0) return 700;
    if (loc.indexOf(q) > -1) return 600;
    if (addr.indexOf(q) > -1) return 400;
    return 0;
  }

  // ─── Filters ────────────────────────────────────────────────────────────
  var filters = { city: '', topRated: false, verified: false };

  function citySlug(h) { return h.city_slug || normalize(h.location).replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-'); }
  function passes(h) {
    if (filters.city && citySlug(h) !== filters.city) return false;
    if (filters.topRated && !((parseFloat(h.rating) || 0) >= 4.5)) return false;
    if (filters.verified && h.claim_status !== 'verified') return false;
    return true;
  }

  /** Every city with its hotel count, biggest first. */
  function cityIndex() {
    var map = {};
    getHotels().forEach(function (h) {
      var slug = citySlug(h); if (!slug) return;
      if (!map[slug]) map[slug] = { slug: slug, name: h.location || slug, count: 0 };
      map[slug].count++;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (x, y) { return y.count - x.count || x.name.localeCompare(y.name); });
  }

  function fillCityFilter() {
    var sel = document.getElementById('hzCityFilter');
    var pop = document.getElementById('hzPopular');
    if (!sel) return;
    var cities = cityIndex();
    var current = filters.city;
    sel.innerHTML = '<option value="">All cities</option>' + cities.slice().sort(function (x, y) { return x.name.localeCompare(y.name); })
      .map(function (c) { return '<option value="' + escHtml(c.slug) + '">' + escHtml(c.name) + ' (' + c.count + ')</option>'; }).join('');
    sel.value = current;
    if (pop) {
      pop.innerHTML = cities.slice(0, 10).map(function (c) {
        return '<button type="button" class="hz-chip' + (c.slug === current ? ' on' : '') + '" data-city="' + escHtml(c.slug) + '">' + escHtml(c.name) + '</button>';
      }).join('');
    }
  }

  function search(q, limit) {
    q = normalize(q).trim();
    var list = getHotels().filter(passes);
    if (!q) {
      // No text but a filter is on → best-rated matches.
      return list.slice().sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); }).slice(0, limit || 15);
    }
    var scored = [];
    for (var i = 0; i < list.length; i++) {
      var s = score(list[i], q);
      if (s > 0) scored.push({ h: list[i], s: s });
    }
    scored.sort(function (a, b) {
      if (b.s !== a.s) return b.s - a.s;
      return (b.h.rating || 0) - (a.h.rating || 0);
    });
    return scored.slice(0, limit || 15).map(function (x) { return x.h; });
  }

  function matchingCities(q) {
    q = normalize(q).trim();
    if (!q || filters.city) return [];
    return cityIndex().filter(function (c) { return normalize(c.name).indexOf(q) > -1; })
      .sort(function (x, y) { return (normalize(y.name).indexOf(q) === 0) - (normalize(x.name).indexOf(q) === 0) || y.count - x.count; })
      .slice(0, 4);
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  var activeIdx = -1;
  var currentResults = [];   // [{ href }] in on-screen order, for keyboard nav

  function anyFilter() { return !!(filters.city || filters.topRated || filters.verified); }

  function renderResults(q) {
    var box = document.getElementById('hzSearchResults');
    var hotels = getHotels();
    q = q || '';

    if (!q.trim() && !anyFilter()) {
      box.innerHTML = '<div class="hz-result-empty">'
        + '<strong>Search across ' + (hotels.length ? hotels.length.toLocaleString('en-IN') : '3,000') + '+ hotels</strong>'
        + 'Type a hotel name or city — or pick a city above.'
        + '</div>';
      currentResults = [];
      activeIdx = -1;
      return;
    }

    var cities = matchingCities(q);
    var results = search(q, 15);
    currentResults = [];

    var html = '';
    if (cities.length) {
      html += '<div class="hz-section-label">Cities</div>';
      html += cities.map(function (c) {
        var href = 'city.html?city=' + encodeURIComponent(c.slug);
        currentResults.push({ href: href });
        return '<a class="hz-result" href="' + href + '" data-idx="' + (currentResults.length - 1) + '">'
          + '<div class="hz-result-avatar city">📍</div>'
          + '<div class="hz-result-body"><div class="hz-result-name">' + highlight(c.name, q) + '</div>'
          + '<div class="hz-result-meta">' + c.count + ' hotels · see all</div></div>'
          + '</a>';
      }).join('');
    }

    if (results.length) {
      if (cities.length || anyFilter()) html += '<div class="hz-section-label">Hotels</div>';
      html += results.map(function (h) {
        var href = 'property.html?id=' + encodeURIComponent(h.id);
        currentResults.push({ href: href });
        var initials = (h.name || 'H').split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ''; }).join('');
        var meta = [h.location, (h.pincode || '').toString().trim()].filter(Boolean).join(' · ');
        return '<a class="hz-result" href="' + href + '" data-idx="' + (currentResults.length - 1) + '">'
          + '<div class="hz-result-avatar">' + escHtml(initials) + '</div>'
          + '<div class="hz-result-body">'
          + '<div class="hz-result-name">' + highlight(h.name, q) + '</div>'
          + '<div class="hz-result-meta">' + escHtml(meta || 'India') + (h.claim_status === 'verified' ? ' · ✓ Verified' : '') + '</div>'
          + '</div>'
          + '<span class="hz-result-rating">★ ' + (parseFloat(h.rating) || 4.5).toFixed(1) + '</span>'
          + '</a>';
      }).join('');
    }

    if (!html) {
      box.innerHTML = '<div class="hz-result-empty">'
        + '<strong>No hotels found' + (q.trim() ? ' for "' + escHtml(q) + '"' : '') + '</strong>'
        + (anyFilter() ? 'Try removing a filter, or ' : 'Try a shorter search, or ')
        + '<a href="https://wa.me/919930090487?text=Hi%20Hotelzz!%20Looking%20for%20a%20hotel%20-%20' + encodeURIComponent(q) + '" target="_blank" rel="noopener">ask on WhatsApp →</a>'
        + '</div>';
      activeIdx = -1;
      return;
    }

    if (filters.city) {
      var c = cityIndex().filter(function (x) { return x.slug === filters.city; })[0];
      if (c) html += '<div class="hz-view-all"><a href="city.html?city=' + encodeURIComponent(c.slug) + '">See all ' + c.count + ' hotels in ' + escHtml(c.name) + ' →</a></div>';
    } else if (results.length >= 15) {
      html += '<div class="hz-view-all">Showing top 15 — pick a city above to narrow it down.</div>';
    }

    box.innerHTML = html;
    activeIdx = 0;
    var first = box.querySelector('.hz-result');
    if (first) first.classList.add('active');
  }

  // ─── Open / close ───────────────────────────────────────────────────────
  var overlayEl, inputEl;

  function open(initial) {
    overlayEl = overlayEl || document.getElementById('hzSearchOverlay');
    inputEl = inputEl || document.getElementById('hzSearchInput');
    overlayEl.classList.add('show');
    document.body.style.overflow = 'hidden';
    fillCityFilter();
    // Clear browser autofill that Chrome injects into type=search fields
    var q = typeof initial === 'string' ? initial : '';
    inputEl.value = q;
    renderResults(q);
    setTimeout(function () { inputEl.value = q; inputEl.focus(); }, 20);
  }
  function close() {
    if (!overlayEl) return;
    overlayEl.classList.remove('show');
    document.body.style.overflow = '';
  }

  // ─── Debounce ───────────────────────────────────────────────────────────
  var t = null;
  function onInput(e) {
    clearTimeout(t);
    var v = e.target.value;
    t = setTimeout(function () { renderResults(v); }, 90);
  }

  function updateActive(delta) {
    if (!currentResults.length) return;
    var next = activeIdx + delta;
    if (next < 0) next = currentResults.length - 1;
    if (next >= currentResults.length) next = 0;
    activeIdx = next;
    var links = document.querySelectorAll('#hzSearchResults .hz-result');
    links.forEach(function (a) { a.classList.remove('active'); });
    if (links[next]) {
      links[next].classList.add('active');
      links[next].scrollIntoView({ block: 'nearest' });
    }
  }

  // ─── Wire ───────────────────────────────────────────────────────────────
  function wire() {
    // Cache element refs up-front — MUST happen before any addEventListener
    // that references overlayEl / inputEl below.
    overlayEl = document.getElementById('hzSearchOverlay');
    inputEl = document.getElementById('hzSearchInput');

    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-search-trigger]');
      if (t) { e.preventDefault(); open(); }
    });

    document.addEventListener('keydown', function (e) {
      // '/' anywhere except in inputs
      if (e.key === '/' && !overlayEl.classList.contains('show')) {
        var tag = (document.activeElement && document.activeElement.tagName || '').toUpperCase();
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          e.preventDefault(); open();
        }
      }
      if (!overlayEl.classList.contains('show')) return;
      if (e.key === 'Escape') { close(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); updateActive(1); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); updateActive(-1); }
      if (e.key === 'Enter' && activeIdx >= 0 && currentResults[activeIdx]) {
        e.preventDefault();
        location.href = currentResults[activeIdx].href;
      }
    });

    document.getElementById('hzSearchClose').addEventListener('click', close);
    overlayEl.addEventListener('click', function (e) { if (e.target === overlayEl) close(); });
    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('change', onInput);   // catches paste + autofill
    inputEl.addEventListener('paste', function () { setTimeout(function () { renderResults(inputEl.value); }, 10); });

    // Filters
    var rerender = function () { renderResults(inputEl.value); };
    document.getElementById('hzCityFilter').addEventListener('change', function (e) {
      filters.city = e.target.value; fillCityFilter(); rerender();
    });
    document.getElementById('hzPopular').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-city]'); if (!chip) return;
      var slug = chip.getAttribute('data-city');
      filters.city = filters.city === slug ? '' : slug;
      fillCityFilter(); rerender();
    });
    [['hzTopRated', 'topRated'], ['hzVerified', 'verified']].forEach(function (pair) {
      var btn = document.getElementById(pair[0]);
      btn.addEventListener('click', function () {
        filters[pair[1]] = !filters[pair[1]];
        btn.classList.toggle('on', filters[pair[1]]);
        btn.setAttribute('aria-pressed', filters[pair[1]] ? 'true' : 'false');
        rerender();
      });
    });

    // Lets other scripts (the phone menu's search box) open it with text.
    window.HZSearch = {
      open: open,
      close: close,
      /** Live suggestions for an inline search bar (homepage hero). */
      suggest: function (q, limit) {
        return { cities: matchingCities(q), hotels: normalize(q).trim() ? search(q, limit || 6) : [] };
      },
      topCities: function (n) { return cityIndex().slice(0, n || 8); }
    };

    // Re-render if live CSV replaces window.HOTELS mid-session
    window.addEventListener('hotelsUpdated', function () {
      if (overlayEl.classList.contains('show')) { fillCityFilter(); renderResults(inputEl.value); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { inject(); wire(); });
  } else {
    inject(); wire();
  }
})();
