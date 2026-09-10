/**
 * Hotelzz mobile navigation.
 *
 * Every public page ships its own header markup — some use .header-nav, some
 * .header-right, some .nav-links, and city.html drops bare anchors straight
 * into .header-inner. Before this, the narrow-viewport CSS simply hid those
 * links, so phone users lost Search Hotels, Sign in and the marketing
 * pages entirely. This script collects whatever nav a page actually has and
 * re-exposes it through a single hamburger drawer.
 *
 * Nothing here changes the desktop header; the drawer is CSS-hidden above the
 * breakpoint and the toggle only appears below it.
 */
(function () {
  'use strict';

  var BREAKPOINT = 900;
  var mq = window.matchMedia('(max-width: ' + BREAKPOINT + 'px)');

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function isBrand(el) {
    return !!(el.closest && el.closest('.brand, .sidebar-brand'));
  }

  function labelOf(el) {
    // Drop the decorative caret that dropdown triggers render alongside their
    // label, so the drawer heading does not read "For Hotel Owners ▼".
    return (el.textContent || '')
      .replace(/[▲▼▴▾⌃⌄]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Flatten the page's navigation into {kind, label, href} entries. The
   * "For Hotel Owners" dropdown becomes a heading plus its items, since a
   * hover-triggered menu is unusable on touch.
   */
  function collectItems(header) {
    var items = [];
    var seen = {};

    function push(entry) {
      if (!entry.label) return;
      var key = entry.kind + '|' + (entry.href || entry.label);
      if (seen[key]) return;
      seen[key] = true;
      items.push(entry);
    }

    var scopes = Array.prototype.slice.call(
      header.querySelectorAll('.header-nav, .header-right, .nav-links')
    );
    var inner = header.querySelector('.header-inner');
    if (inner) scopes.push(inner);

    scopes.forEach(function (scope) {
      Array.prototype.forEach.call(scope.children, function (child) {
        if (isBrand(child) || child.classList.contains('brand')) return;

        if (child.classList.contains('nav-dropdown')) {
          var trigger = child.querySelector('.dropdown-trigger');
          if (trigger) push({ kind: 'group', label: labelOf(trigger) });
          Array.prototype.forEach.call(child.querySelectorAll('.dropdown-item'), function (a) {
            push({ kind: 'link', label: labelOf(a), href: a.getAttribute('href'), sub: true });
          });
          return;
        }

        if (child.tagName === 'A') {
          if (!child.getAttribute('href')) return;
          push({
            kind: 'link',
            label: labelOf(child),
            href: child.getAttribute('href'),
            target: child.getAttribute('target'),
            cta: child.classList.contains('header-cta') || child.classList.contains('btn-claim-nav')
          });
          return;
        }

        if (child.tagName === 'BUTTON') {
          if (child.hasAttribute('data-search-trigger')) {
            push({ kind: 'search', label: 'Search hotels' });
          } else if (child.hasAttribute('data-form-trigger') || child.classList.contains('header-cta')) {
            push({
              kind: 'button',
              label: labelOf(child),
              node: child,
              cta: child.classList.contains('header-cta')
            });
          }
          return;
        }

        // Wrappers such as .header-right nest their links one level deeper.
        if (child.querySelector && child.querySelector('a')) {
          Array.prototype.forEach.call(child.querySelectorAll('a'), function (a) {
            if (isBrand(a) || !a.getAttribute('href')) return;
            push({
              kind: 'link',
              label: labelOf(a),
              href: a.getAttribute('href'),
              target: a.getAttribute('target'),
              cta: a.classList.contains('header-cta')
            });
          });
        }
      });
    });

    return items;
  }

  function buildDrawer(items) {
    var panel = document.createElement('div');
    panel.className = 'hz-mnav-panel';
    panel.id = 'hzMobileNav';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Menu');
    panel.hidden = true;

    var head = document.createElement('div');
    head.className = 'hz-mnav-head';

    var title = document.createElement('span');
    title.className = 'hz-mnav-title';
    title.textContent = 'Menu';
    head.appendChild(title);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'hz-mnav-close';
    close.setAttribute('aria-label', 'Close menu');
    close.innerHTML = '&times;';
    head.appendChild(close);
    panel.appendChild(head);

    var list = document.createElement('nav');
    list.className = 'hz-mnav-list';

    items.forEach(function (item) {
      if (item.kind === 'group') {
        var g = document.createElement('div');
        g.className = 'hz-mnav-group';
        g.textContent = item.label;
        list.appendChild(g);
        return;
      }

      if (item.kind === 'link') {
        var a = document.createElement('a');
        a.className = 'hz-mnav-item' + (item.sub ? ' is-sub' : '') + (item.cta ? ' is-cta' : '');
        a.href = item.href;
        a.textContent = item.label;
        if (item.target) {
          a.target = item.target;
          a.rel = 'noopener';
        }
        list.appendChild(a);
        return;
      }

      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'hz-mnav-item' + (item.cta ? ' is-cta' : '');
      b.textContent = item.label;
      b.addEventListener('click', function () {
        closeNav();
        if (item.kind === 'search') {
          var t = document.querySelector('[data-search-trigger]');
          if (t) t.click();
        } else if (item.node) {
          item.node.click();
        }
      });
      list.appendChild(b);
    });

    panel.appendChild(list);
    return panel;
  }

  var backdrop, panel, toggle, lastFocus, closeTimer;

  function openNav() {
    if (!panel) return;
    clearTimeout(closeTimer);
    lastFocus = document.activeElement;
    panel.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(function () {
      document.documentElement.classList.add('hz-mnav-open');
    });
    toggle.setAttribute('aria-expanded', 'true');
    var first = panel.querySelector('.hz-mnav-close');
    if (first) first.focus();
    document.addEventListener('keydown', onKeydown);
  }

  function closeNav() {
    if (!panel || panel.hidden) return;
    document.documentElement.classList.remove('hz-mnav-open');
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKeydown);
    closeTimer = setTimeout(function () {
      panel.hidden = true;
      backdrop.hidden = true;
    }, 240);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      closeNav();
      return;
    }
    if (e.key !== 'Tab' || panel.hidden) return;
    var f = panel.querySelectorAll('a[href], button:not([disabled])');
    if (!f.length) return;
    var first = f[0];
    var last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  onReady(function () {
    var header = document.querySelector('header.header, header');
    if (!header) return;
    var inner = header.querySelector('.header-inner');
    if (!inner) return;
    if (document.getElementById('hzMobileNav')) return;

    var items = collectItems(header);
    if (!items.length) return;

    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'hz-mnav-toggle';
    toggle.setAttribute('aria-label', 'Open menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'hzMobileNav');
    toggle.innerHTML = '<span></span><span></span><span></span>';
    inner.appendChild(toggle);

    backdrop = document.createElement('div');
    backdrop.className = 'hz-mnav-backdrop';
    backdrop.hidden = true;
    document.body.appendChild(backdrop);

    panel = buildDrawer(items);
    document.body.appendChild(panel);

    toggle.addEventListener('click', function () {
      if (panel.hidden) { openNav(); } else { closeNav(); }
    });
    backdrop.addEventListener('click', closeNav);
    panel.querySelector('.hz-mnav-close').addEventListener('click', closeNav);

    // Rotating back to desktop width must not leave a drawer hanging open.
    var onChange = function () { if (!mq.matches) closeNav(); };
    if (mq.addEventListener) { mq.addEventListener('change', onChange); }
    else if (mq.addListener) { mq.addListener(onChange); }
  });

  /**
   * Search results filter toggle (city.html).
   *
   * Below 1024px the filter panel dropped out of its sidebar column and sat
   * full-width above the results — roughly 720px of checkboxes before the
   * first hotel. It now collapses behind a button and starts closed.
   */
  onReady(function () {
    var filters = document.querySelector('.layout > .filters');
    if (!filters || document.querySelector('.hz-filter-toggle')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hz-filter-toggle';
    btn.setAttribute('aria-controls', 'hzFilters');
    btn.setAttribute('aria-expanded', 'false');

    var label = document.createElement('span');
    label.textContent = 'Filters';

    var caret = document.createElement('span');
    caret.className = 'hz-filter-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▼';

    btn.appendChild(label);
    btn.appendChild(caret);

    if (!filters.id) filters.id = 'hzFilters';
    filters.parentNode.insertBefore(btn, filters);

    /* Reflect how many filters the visitor has actually changed, so a
       collapsed panel never hides the reason a result list looks short.
       The page ships with every checkbox ticked and the "all" radios
       selected, so the baseline is the state at load rather than "checked". */
    var controls = Array.prototype.slice.call(
      filters.querySelectorAll('input[type="checkbox"], input[type="radio"], select')
    );
    var baseline = controls.map(function (el) {
      return el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
    });

    function changedCount() {
      var n = 0;
      controls.forEach(function (el, i) {
        var now = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
        // A radio group reports two changes per switch; count only the newly
        // selected option.
        if (now !== baseline[i] && !(el.type === 'radio' && !el.checked)) n++;
      });
      return n;
    }

    function syncLabel() {
      var n = changedCount();
      label.textContent = n ? 'Filters (' + n + ')' : 'Filters';
    }

    btn.addEventListener('click', function () {
      var open = filters.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    filters.addEventListener('change', syncLabel);
    syncLabel();
  });
})();
