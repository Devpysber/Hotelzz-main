/**
 * Hotelzz.in — cross-page session indicator.
 *
 * The login session itself already survives every page (httpOnly cookie,
 * 7-day expiry, same-origin — see server/lib/auth.js). What was missing is
 * the *header* reflecting it: public pages always showed a static "Login"
 * link even when the visitor already had a valid session. This script fixes
 * that — drop `<script src="api-client.js"></script>` then
 * `<script src="session-nav.js"></script>` near the end of `<body>` on any
 * public page and it will, once `/api/auth/me` resolves to a real user:
 *   - swap the primary "Traveler Login" CTA (or dashboard-login link) for
 *     an account pill with the visitor's name, linking to their portal
 *   - add a Logout action
 * Logged-out visitors see no change at all — nothing here invents state,
 * it only ever reflects what the server's session actually says. Styling is
 * fully self-contained (inline styles + one injected <style> block) since
 * not every page that needs this defines dropdown/pill CSS.
 */
(function () {
  function portalFor(role) {
    if (role === 'admin') return 'admin.html';
    if (role === 'owner') return 'owner.html';
    return 'user-portal.html';
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function injectStyle() {
    if (document.getElementById('hzSessNavStyle')) return;
    var style = document.createElement('style');
    style.id = 'hzSessNavStyle';
    style.textContent =
      '.hz-sessnav{position:relative;display:inline-flex;}' +
      '.hz-sessnav-btn{display:inline-flex;align-items:center;gap:6px;background:#EFF6FF;color:#2563EB;font-weight:700;font-size:14px;border:1px solid #BFDBFE;border-radius:8px;padding:8px 12px;cursor:pointer;font-family:inherit;}' +
      '.hz-sessnav-avatar{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#2563EB;color:#fff;font-size:11px;font-weight:800;}' +
      '.hz-sessnav-menu{display:none;position:absolute;top:calc(100% + 6px);right:0;background:#fff;border:1px solid #E2E8F0;border-radius:10px;box-shadow:0 12px 28px rgba(15,23,42,0.14);min-width:170px;overflow:hidden;z-index:1000;}' +
      '.hz-sessnav-menu.open{display:block;}' +
      '.hz-sessnav-menu a{display:block;padding:10px 14px;font-size:13.5px;font-weight:600;color:#0F172A;text-decoration:none;}' +
      '.hz-sessnav-menu a:hover{background:#F8FAFC;}';
    document.head.appendChild(style);
  }

  onReady(function () {
    if (!window.HotelzzAPI || !window.HotelzzAPI.auth) return;

    window.HotelzzAPI.auth.me().then(function (r) {
      var user = r && r.user;
      if (!user) return;

      var header = document.querySelector('.header-inner');
      if (!header) return;

      injectStyle();

      // The primary "log in as me" CTA — leave every other header link
      // (register, claim business, admin login for a *different* account,
      // WhatsApp CTA, search) untouched.
      var loginLink = header.querySelector(
        'a[href^="login.html?type=traveler"], a[href^="login.html?type=owner"]:not([href*="register"]), a[href^="dashboard-login.html"]'
      );

      var wrap = document.createElement('div');
      wrap.className = 'hz-sessnav';
      wrap.innerHTML =
        '<button type="button" class="hz-sessnav-btn" id="hzSessNavBtn">' +
          '<span class="hz-sessnav-avatar">' + escapeHtml(user.avatar || (user.name || '?').charAt(0).toUpperCase()) + '</span>' +
          '<span>' + escapeHtml(user.name) + '</span>' +
          '<span style="font-size:10px;">▾</span>' +
        '</button>' +
        '<div class="hz-sessnav-menu" id="hzSessNavMenu">' +
          '<a href="' + portalFor(user.role) + '">👤 My Portal</a>' +
          '<a href="#" id="hzSessNavLogout">🚪 Logout</a>' +
        '</div>';

      if (loginLink) loginLink.replaceWith(wrap);
      else header.appendChild(wrap);

      var btn = document.getElementById('hzSessNavBtn');
      var menu = document.getElementById('hzSessNavMenu');
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        menu.classList.toggle('open');
      });
      document.addEventListener('click', function () { menu.classList.remove('open'); });

      document.getElementById('hzSessNavLogout').addEventListener('click', function (ev) {
        ev.preventDefault();
        window.HotelzzAPI.auth.logout().then(function () { window.location.reload(); })
          .catch(function () { window.location.reload(); });
      });
    }).catch(function () { /* no session — leave the page as-is */ });
  });
})();
