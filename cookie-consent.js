/**
 * Hotelzz.in — cookie consent banner.
 *
 * Self-contained: drop `<script src="cookie-consent.js"></script>` near the
 * end of <body> on any public page. Shows once per browser (localStorage,
 * not a cookie itself — no point setting a cookie to ask permission for
 * cookies) until the visitor accepts or declines, then never again unless
 * they clear site data. Styling is fully inline so it works on any page
 * without depending on that page's CSS.
 *
 * What this site actually uses:
 *   - a session cookie (httpOnly, login only) — strictly necessary, not
 *     covered by this banner regardless of the visitor's choice, same as
 *     every "necessary cookies" carve-out.
 *   - localStorage for cart/catalogue caching (hotelzz_catalog_v2) and this
 *     banner's own choice — not third-party, not tracking.
 * There is no third-party analytics/ads script on this site today, so
 * "Decline" and "Accept" currently behave the same functionally — the
 * banner exists for transparency and to have the hook ready (window.hzCookieConsent)
 * the moment a real analytics/ads pixel is added, without a second rollout.
 */
(function () {
  var KEY = 'hotelzz_cookie_consent'; // 'accepted' | 'declined'

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function getChoice() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function setChoice(v) {
    try { window.localStorage.setItem(KEY, v); } catch (e) { /* private mode etc — banner just won't persist */ }
  }

  // Exposed so future analytics/ads scripts can gate themselves on real
  // consent instead of loading unconditionally: if (window.hzCookieConsent.get() === 'accepted') { ... }
  window.hzCookieConsent = { get: getChoice };

  onReady(function () {
    if (getChoice()) return; // already decided, on this browser

    var style = document.createElement('style');
    style.textContent =
      '#hzCookieBanner{position:fixed;left:0;right:0;bottom:0;z-index:9999;' +
      'background:#0F172A;color:#fff;padding:16px 20px;box-shadow:0 -8px 24px rgba(0,0,0,0.18);' +
      'font-family:Inter,-apple-system,sans-serif;display:flex;flex-wrap:wrap;gap:14px 20px;' +
      'align-items:center;justify-content:space-between;}' +
      '#hzCookieBanner p{margin:0;font-size:13px;line-height:1.5;color:#E2E8F0;max-width:640px;flex:1 1 320px;}' +
      '#hzCookieBanner a{color:#93C5FD;text-decoration:underline;}' +
      '#hzCookieBanner .hz-cc-actions{display:flex;gap:10px;flex:0 0 auto;}' +
      '#hzCookieBanner button{border:none;border-radius:8px;padding:10px 18px;font-weight:700;' +
      'font-size:13px;cursor:pointer;font-family:inherit;}' +
      '#hzCookieBanner .hz-cc-accept{background:#2563EB;color:#fff;}' +
      '#hzCookieBanner .hz-cc-accept:hover{background:#1D4ED8;}' +
      '#hzCookieBanner .hz-cc-decline{background:transparent;color:#CBD5E1;border:1px solid #475569;}' +
      '#hzCookieBanner .hz-cc-decline:hover{background:#1E293B;}' +
      '@media (max-width:520px){#hzCookieBanner{flex-direction:column;align-items:stretch;}' +
      '#hzCookieBanner .hz-cc-actions{justify-content:flex-end;}}';
    document.head.appendChild(style);

    var el = document.createElement('div');
    el.id = 'hzCookieBanner';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Cookie notice');
    el.innerHTML =
      '<p>We use essential cookies to keep you signed in, and local storage to load listings faster. ' +
      'No third-party tracking today — see our <a href="privacy.html">Privacy Policy</a>.</p>' +
      '<div class="hz-cc-actions">' +
      '<button type="button" class="hz-cc-decline">Decline</button>' +
      '<button type="button" class="hz-cc-accept">Accept</button>' +
      '</div>';
    document.body.appendChild(el);

    function dismiss(choice) {
      setChoice(choice);
      el.remove();
    }
    el.querySelector('.hz-cc-accept').addEventListener('click', function () { dismiss('accepted'); });
    el.querySelector('.hz-cc-decline').addEventListener('click', function () { dismiss('declined'); });
  });
})();
