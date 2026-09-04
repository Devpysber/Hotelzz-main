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
    + '@media (max-width:600px){.hz-search-overlay{padding:40px 10px 10px}.hz-search-input{font-size:16px}}';

  var HTML = ''
    + '<div class="hz-search-panel" role="dialog" aria-modal="true" aria-labelledby="hzSearchTitle">'
    + '  <div class="hz-search-head">'
    + '    <svg class="mag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'
    + '    <input id="hzSearchInput" class="hz-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Search 3,000+ hotels by name, city or area…" aria-label="Search hotels" />'
    + '    <button class="hz-search-close" id="hzSearchClose" aria-label="Close search">ESC</button>'
    + '  </div>'
    + '  <div class="hz-search-hint">'
    + '    <span>Type to search across name, city & address</span>'
    + '    <span><kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>/</kbd> to open search</span>'
    + '  </div>'
    + '  <div class="hz-search-results" id="hzSearchResults"></div>'
    + '</div>';

  function inject() {
    var style = document.createElement('style'); style.textContent = STYLES; document.head.appendChild(style);
    var overlay = document.createElement('div'); overlay.className = 'hz-search-overlay'; overlay.id = 'hzSearchOverlay';
    overlay.innerHTML = HTML;
    document.body.appendChild(overlay);

    var fab = document.createElement('button');
    fab.className = 'hz-search-fab'; fab.id = 'hzSearchFab'; fab.setAttribute('aria-label', 'Search hotels'); fab.setAttribute('data-search-trigger', '');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
    document.body.appendChild(fab);

    // FAB shown only on mobile-ish widths where header nav collapses
    var mq = window.matchMedia('(max-width: 900px)');
    var toggleFab = function () { fab.style.display = mq.matches ? 'flex' : 'none'; };
    toggleFab();
    if (mq.addEventListener) mq.addEventListener('change', toggleFab); else mq.addListener(toggleFab);
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

  function search(q, limit) {
    q = normalize(q).trim();
    if (!q) return [];
    var list = getHotels();
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

  // ─── Render ─────────────────────────────────────────────────────────────
  var activeIdx = -1;
  var currentResults = [];

  function renderResults(q) {
    var box = document.getElementById('hzSearchResults');
    var hotels = getHotels();

    if (!q || !q.trim()) {
      box.innerHTML = '<div class="hz-result-empty">'
        + '<strong>Search across ' + (hotels.length ? hotels.length.toLocaleString('en-IN') : '3,000') + '+ hotels</strong>'
        + 'Try <em>"Calangute"</em>, <em>"Bandra"</em>, <em>"Manali"</em> or type any hotel name.'
        + '</div>';
      currentResults = [];
      activeIdx = -1;
      return;
    }

    var results = search(q, 15);
    currentResults = results;
    activeIdx = results.length ? 0 : -1;

    if (!results.length) {
      box.innerHTML = '<div class="hz-result-empty">'
        + '<strong>No hotels found for "' + escHtml(q) + '"</strong>'
        + 'Try a shorter search or <a href="https://wa.me/919930090487?text=Hi%20Hotelzz!%20Looking%20for%20a%20hotel%20-%20' + encodeURIComponent(q) + '" target="_blank" rel="noopener">ask on WhatsApp →</a>'
        + '</div>';
      return;
    }

    var html = results.map(function (h, i) {
      var initials = (h.name || 'H').split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ''; }).join('');
      var meta = [h.location, (h.pincode || '').toString().trim()].filter(Boolean).join(' · ');
      return '<a class="hz-result' + (i === 0 ? ' active' : '') + '" href="property.html?id=' + encodeURIComponent(h.id) + '" data-idx="' + i + '">'
        + '<div class="hz-result-avatar">' + escHtml(initials) + '</div>'
        + '<div class="hz-result-body">'
        + '<div class="hz-result-name">' + highlight(h.name, q) + '</div>'
        + '<div class="hz-result-meta">' + escHtml(meta || 'India') + '</div>'
        + '</div>'
        + '<span class="hz-result-rating">★ ' + (h.rating || 4.5).toFixed(1) + '</span>'
        + '</a>';
    }).join('');

    if (results.length >= 15) {
      html += '<div class="hz-view-all">Showing top 15 · <a href="city.html?city=' + encodeURIComponent(normalize(q).replace(/\s+/g, '-')) + '">Try city page →</a></div>';
    }

    box.innerHTML = html;
  }

  // ─── Open / close ───────────────────────────────────────────────────────
  var overlayEl, inputEl;

  function open() {
    overlayEl = overlayEl || document.getElementById('hzSearchOverlay');
    inputEl = inputEl || document.getElementById('hzSearchInput');
    overlayEl.classList.add('show');
    document.body.style.overflow = 'hidden';
    // Clear browser autofill that Chrome injects into type=search fields
    inputEl.value = '';
    renderResults('');
    setTimeout(function () { inputEl.value = ''; inputEl.focus(); }, 20);
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
        location.href = 'property.html?id=' + encodeURIComponent(currentResults[activeIdx].id);
      }
    });

    document.getElementById('hzSearchClose').addEventListener('click', close);
    overlayEl.addEventListener('click', function (e) { if (e.target === overlayEl) close(); });
    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('change', onInput);   // catches paste + autofill
    inputEl.addEventListener('paste', function () { setTimeout(function () { renderResults(inputEl.value); }, 10); });

    // Re-render if live CSV replaces window.HOTELS mid-session
    window.addEventListener('hotelsUpdated', function () {
      if (overlayEl.classList.contains('show')) renderResults(inputEl.value);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { inject(); wire(); });
  } else {
    inject(); wire();
  }
})();
