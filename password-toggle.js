/**
 * Hotelzz — show/hide password toggle.
 *
 * Adds an eye button inside every <input type="password"> on the page,
 * including ones rendered later by page scripts (watched with a
 * MutationObserver). Include it once per page; no markup changes needed.
 */
(function () {
  var EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function injectStyles() {
    if (document.getElementById('hz-pw-toggle-css')) return;
    var css = document.createElement('style');
    css.id = 'hz-pw-toggle-css';
    css.textContent =
      '.hz-pw-wrap{position:relative;display:block;width:100%;}' +
      '.hz-pw-wrap>input{width:100%;padding-right:44px !important;box-sizing:border-box;}' +
      '.hz-pw-toggle{position:absolute;top:50%;right:6px;transform:translateY(-50%);width:34px;height:34px;' +
        'display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;' +
        'color:#64748B;border-radius:6px;cursor:pointer;padding:0;margin:0;}' +
      '.hz-pw-toggle:hover{color:#0F172A;background:rgba(15,23,42,0.06);}' +
      '.hz-pw-toggle:focus-visible{outline:2px solid #2563EB;outline-offset:1px;}' +
      /* Edge/IE add their own reveal button — hide it so there is only one. */
      'input::-ms-reveal,input::-ms-clear{display:none;}';
    document.head.appendChild(css);
  }

  function enhance(input) {
    if (!input || input.dataset.hzPwToggle) return;
    input.dataset.hzPwToggle = '1';

    var wrap = document.createElement('span');
    wrap.className = 'hz-pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hz-pw-toggle';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Show password';
    btn.innerHTML = EYE;
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.title = show ? 'Hide password' : 'Show password';
      // Keep typing where the user left off.
      var end = input.value.length;
      input.focus();
      try { input.setSelectionRange(end, end); } catch (e) { /* not supported for this type */ }
    });
    wrap.appendChild(btn);

    // A form reset or successful submit should never leave a password visible.
    if (input.form) {
      input.form.addEventListener('reset', function () {
        input.type = 'password';
        btn.innerHTML = EYE;
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', 'Show password');
        btn.title = 'Show password';
      });
    }
  }

  function scan(root) {
    (root || document).querySelectorAll('input[type="password"]').forEach(enhance);
  }

  function init() {
    injectStyles();
    scan(document);
    new MutationObserver(function (records) {
      records.forEach(function (r) {
        r.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('input[type="password"]')) enhance(n);
          else if (n.querySelectorAll) scan(n);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
