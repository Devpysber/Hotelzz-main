/**
 * Hotelzz — public plan checkout.
 *
 * Any element with data-buy-plan="<plan id>" opens a short buyer-details form,
 * then pays through Razorpay (or records a manual order when no gateway is
 * configured). Plan ids and prices live on the server (server/lib/public-plans.json);
 * the page never decides what is charged. Needs api-client.js on the page.
 */
(function () {
  var plans = null;
  var current = null;

  function loadRazorpay() {
    if (window.Razorpay || document.getElementById('rzpCheckoutJs')) return;
    var s = document.createElement('script');
    s.id = 'rzpCheckoutJs';
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    document.head.appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function injectUi() {
    if (document.getElementById('hzBuyModal')) return;
    var css = document.createElement('style');
    css.textContent =
      '#hzBuyModal{position:fixed;inset:0;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;z-index:10000;padding:16px}' +
      '#hzBuyModal.open{display:flex}' +
      '#hzBuyModal .hzb{background:#fff;border-radius:16px;max-width:460px;width:100%;max-height:92vh;overflow:auto;padding:26px 24px;position:relative;font-family:Inter,system-ui,sans-serif;color:#1F2937;box-shadow:0 24px 60px rgba(0,0,0,.25)}' +
      '#hzBuyModal h3{font-size:20px;font-weight:800;margin:0 0 4px}' +
      '#hzBuyModal .hzb-sub{color:#6B7280;font-size:14px;margin:0 0 16px}' +
      '#hzBuyModal .hzb-plan{display:flex;justify-content:space-between;align-items:center;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px 14px;margin-bottom:16px;font-weight:700}' +
      '#hzBuyModal .hzb-plan b{font-size:20px;color:#1D4ED8}' +
      '#hzBuyModal label{display:block;font-size:12.5px;font-weight:700;margin:10px 0 4px}' +
      '#hzBuyModal input{width:100%;padding:11px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:15px;font-family:inherit;box-sizing:border-box}' +
      '#hzBuyModal input:focus{outline:2px solid #93C5FD;border-color:#2563EB}' +
      '#hzBuyModal .hzb-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      '@media(max-width:480px){#hzBuyModal .hzb-row{grid-template-columns:1fr}}' +
      '#hzBuyModal .hzb-err{color:#B91C1C;font-size:13px;font-weight:600;min-height:18px;margin-top:10px}' +
      '#hzBuyModal .hzb-pay{width:100%;margin-top:8px;background:#2563EB;color:#fff;border:0;border-radius:10px;padding:14px;font-size:16px;font-weight:800;cursor:pointer}' +
      '#hzBuyModal .hzb-pay[disabled]{opacity:.6;cursor:wait}' +
      '#hzBuyModal .hzb-close{position:absolute;top:10px;right:12px;font-size:26px;line-height:1;background:none;border:0;cursor:pointer;color:#6B7280}' +
      '#hzBuyModal .hzb-note{font-size:12px;color:#6B7280;text-align:center;margin-top:10px}' +
      '#hzBuyModal .hzb-done{text-align:center;padding:10px 0}' +
      '#hzBuyModal .hzb-done .big{font-size:44px}';
    document.head.appendChild(css);

    var wrap = document.createElement('div');
    wrap.id = 'hzBuyModal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML =
      '<div class="hzb">' +
      '<button type="button" class="hzb-close" aria-label="Close">×</button>' +
      '<div id="hzbForm">' +
      '<h3>Complete your purchase</h3>' +
      '<p class="hzb-sub">Your confirmation and receipt are emailed to you right after payment.</p>' +
      '<div class="hzb-plan"><span id="hzbPlanName">—</span><b id="hzbPlanPrice">—</b></div>' +
      '<form novalidate id="hzbFormEl">' +
      '<label for="hzbName">Full name *</label><input id="hzbName" autocomplete="name" required>' +
      '<div class="hzb-row"><div><label for="hzbEmail">Email *</label><input id="hzbEmail" type="email" autocomplete="email" required></div>' +
      '<div><label for="hzbPhone">Phone / WhatsApp *</label><input id="hzbPhone" type="tel" autocomplete="tel" required></div></div>' +
      '<div class="hzb-row"><div><label for="hzbHotel">Hotel name</label><input id="hzbHotel"></div>' +
      '<div><label for="hzbCity">City</label><input id="hzbCity"></div></div>' +
      '<div class="hzb-err" id="hzbErr"></div>' +
      '<button type="submit" class="hzb-pay" id="hzbPay">Pay securely</button>' +
      '<div class="hzb-note">🔒 Payments by Razorpay — UPI, cards, net banking &amp; wallets.</div>' +
      '</form></div>' +
      '<div id="hzbDone" class="hzb-done" hidden><div class="big">🎉</div><h3 id="hzbDoneTitle">Thank you!</h3><p class="hzb-sub" id="hzbDoneMsg"></p>' +
      '<button type="button" class="hzb-pay" id="hzbDoneBtn">Done</button></div>' +
      '</div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    wrap.querySelector('.hzb-close').addEventListener('click', close);
    document.getElementById('hzbDoneBtn').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    document.getElementById('hzbFormEl').addEventListener('submit', submit);
  }

  function close() {
    var m = document.getElementById('hzBuyModal');
    if (m) m.classList.remove('open');
  }

  function open(planId) {
    injectUi();
    loadRazorpay();
    var plan = (plans || []).filter(function (p) { return p.id === planId; })[0];
    if (!plan) { alert('This plan is not available right now. Please contact us on WhatsApp.'); return; }
    current = plan;
    document.getElementById('hzbForm').hidden = false;
    document.getElementById('hzbDone').hidden = true;
    document.getElementById('hzbPlanName').textContent = plan.name;
    document.getElementById('hzbPlanPrice').textContent = '₹' + Number(plan.price).toLocaleString('en-IN');
    document.getElementById('hzbErr').textContent = '';
    var u = window.HZ_USER;
    if (u) {
      ['hzbName', 'hzbEmail', 'hzbPhone'].forEach(function (id, i) {
        var el = document.getElementById(id);
        if (!el.value) el.value = [u.name, u.email, u.phone][i] || '';
      });
    }
    document.getElementById('hzBuyModal').classList.add('open');
    document.getElementById('hzbName').focus();
  }

  function val(id) { return document.getElementById(id).value.trim(); }

  function submit(e) {
    e.preventDefault();
    var err = document.getElementById('hzbErr');
    err.textContent = '';
    var payload = {
      planId: current.id, name: val('hzbName'), email: val('hzbEmail'), phone: val('hzbPhone'),
      hotelName: val('hzbHotel') || undefined, city: val('hzbCity') || undefined
    };
    if (payload.name.length < 2) { err.textContent = 'Enter your name.'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) { err.textContent = 'Enter a valid email address.'; return; }
    if (payload.phone.replace(/\D/g, '').length < 10) { err.textContent = 'Enter a 10-digit phone number.'; return; }

    var btn = document.getElementById('hzbPay');
    btn.disabled = true;
    btn.textContent = 'Opening secure payment…';
    window.HotelzzAPI.payments.buyPlan(payload).then(function (r) {
      document.getElementById('hzbForm').hidden = true;
      document.getElementById('hzbDone').hidden = false;
      document.getElementById('hzbDoneTitle').textContent = r.mode === 'paid' ? 'Payment successful!' : 'Order received!';
      document.getElementById('hzbDoneMsg').innerHTML = r.mode === 'paid'
        ? 'Your <b>' + esc(current.name) + '</b> is confirmed. A confirmation has been emailed to <b>' + esc(payload.email) + '</b>. Our team will contact you within 24 hours.'
        : esc(r.message) + ' We have emailed the order details to <b>' + esc(payload.email) + '</b>.';
      if (typeof window.gtag === 'function') {
        window.gtag('event', r.mode === 'paid' ? 'purchase' : 'begin_checkout',
          { currency: 'INR', value: current.price, items: [{ item_id: current.id, item_name: current.name }] });
      }
    }).catch(function (e2) {
      err.textContent = e2.message || 'Payment could not be started. Please try again.';
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Pay securely';
    });
  }

  function init() {
    if (!window.HotelzzAPI) return;
    window.HotelzzAPI.get('/payments/plans').then(function (r) {
      plans = r.plans || [];
      document.querySelectorAll('[data-buy-plan]').forEach(function (el) {
        var plan = plans.filter(function (p) { return p.id === el.getAttribute('data-buy-plan'); })[0];
        if (!plan) { el.style.display = 'none'; return; }
        el.addEventListener('click', function (ev) { ev.preventDefault(); open(plan.id); });
      });
    }).catch(function () {
      document.querySelectorAll('[data-buy-plan]').forEach(function (el) { el.style.display = 'none'; });
    });
  }

  window.HotelzzPlanCheckout = { open: open };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
