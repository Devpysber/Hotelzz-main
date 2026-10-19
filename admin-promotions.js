/**
 * Hotelzz Admin — Email Center → Promotions & scheduled email.
 * Promotional engine (server/lib/promotions.js): on/off, pacing, which
 * templates run, today's random send times, preview/run now, results and
 * unsubscribes. Plus the transactional automations (server/lib/automation.js).
 */
(function () {
  var API = window.HotelzzAPI;
  var state = { status: null, optouts: [], preview: null, open: false };

  var LABELS = {
    promoListingLive: 'Your listing is live', promoProfileGaps: 'Finish your listing', promoCollectReviews: 'Ask guests for reviews',
    promoPostDeal: 'Post a deal', promoBoostVisibility: 'Get more visibility (plans)', promoGrowCampaign: 'Run a campaign',
    promoClaimListing: 'Claim your free listing', promoTravelerDeals: 'Deals for travellers', promoSavedReminder: 'Saved stays reminder',
    promoTopStays: 'Top-rated stays'
  };
  var AUDIENCE = {
    promoListingLive: 'Owners', promoProfileGaps: 'Owners', promoCollectReviews: 'Owners', promoPostDeal: 'Owners',
    promoBoostVisibility: 'Owners', promoGrowCampaign: 'Owners', promoClaimListing: 'Unclaimed hotels',
    promoTravelerDeals: 'Travellers', promoSavedReminder: 'Travellers', promoTopStays: 'Travellers'
  };
  var AUTOMATIONS = [
    ['Enquiry reminder', 'Hotel owner, when a guest enquiry is unanswered for 24 hours'],
    ['Review request', 'Traveller, 3 days after the hotel replied'],
    ['Weekly owner digest', 'Hotel owner, Mondays (India time), only when there was activity'],
    ['Daily admin digest', 'Operations email, every morning 08:00–10:00 India time'],
    ['Lead follow-up', 'Marketing lead, 3 days after they asked about a plan']
  ];

  function plural(n, w) { return Number(n || 0).toLocaleString('en-IN') + ' ' + w + (n === 1 ? '' : 's'); }
  function esc(s) { return window.hz ? window.hz(s) : String(s == null ? '' : s); }
  function toast(m, t) { if (window.showToast) window.showToast(m, t); }
  function fail(e) { toast((e && e.message) || 'Something went wrong.', 'danger'); }
  function when(iso) { if (!iso) return '—'; var d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }

  window.initPromotionsPanel = function () {
    API.get('/admin/promotions').then(function (r) { state.status = r.status; state.optouts = r.optouts || []; render(); }).catch(fail);
  };

  window.promoToggleOpen = function () { state.open = !state.open; render(); };

  function render() {
    var el = document.getElementById('promoPanel');
    if (!el || !state.status) return;
    var s = state.status, c = s.config;
    var sent7 = Object.keys(s.sent7).reduce(function (n, k) { return n + s.sent7[k]; }, 0);
    var slots = (s.today.slots || []).map(function (x) {
      return '<span class="badge ' + (x.done ? 'badge-gray' : 'badge-info') + '" style="margin-right:4px;">' + esc(x.ist) + (x.done ? ' ✓' : '') + '</span>';
    }).join('');
    var html =
      '<div class="admin-card promo-card">' +
        '<div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">' +
          '<div><div class="card-title">📣 Promotions & scheduled email</div>' +
          '<div class="card-subtitle">Tips and offers to owners, unclaimed hotels and travellers — paced, personalised and with one-click unsubscribe.</div></div>' +
          '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">' +
            '<label class="sk-switch" title="Promotional emails on/off"><input type="checkbox" ' + (c.enabled ? 'checked' : '') + ' onchange="promoSave({enabled: this.checked})" /><span></span></label>' +
            '<b style="font-size:13px;">' + (c.enabled ? 'On' : 'Off') + '</b>' +
            '<button class="btn-secondary" onclick="promoPreview()">Preview next run</button>' +
            '<button class="btn-primary" onclick="promoRunNow()">Send run now</button>' +
          '</div>' +
        '</div>' +
        '<div class="promo-stats">' +
          stat('Sent, last 7 days', sent7) +
          stat('Today\'s send times (IST)', slots || '—', true) +
          stat('Audience', plural(s.audience.owners, 'owner') + ' · ' + plural(s.audience.travelers, 'traveller') + ' · ' + plural(s.audience.unclaimedWithEmail, 'unclaimed hotel') + ' with email') +
          stat('Unsubscribed', s.unsubscribed) +
        '</div>' +
        (s.schedulerOn ? '' : '<p class="sk-note">This is a development server: the daily schedule only runs on the live site (or with PROMOTIONS_IN_DEV=1). "Send run now" works here and is logged, not emailed.</p>') +
        (state.preview ? previewHtml(state.preview) : '') +
        '<button class="btn-secondary sk-mini" style="margin-top:12px;" onclick="promoToggleOpen()">' + (state.open ? 'Hide settings ▲' : 'Settings, templates, history & unsubscribes ▼') + '</button>' +
        (state.open ? detailsHtml(s) : '') +
      '</div>';
    el.innerHTML = html;
  }

  function stat(label, value, raw) {
    return '<div class="promo-stat"><div class="sk-tile-label">' + label + '</div><div class="promo-stat-v">' + (raw ? value : esc(value)) + '</div></div>';
  }

  function previewHtml(p) {
    var by = Object.keys(p.byTemplate || {});
    return '<div class="promo-preview"><b>' + (p.dryRun ? 'Preview — the next run would send ' : 'Run finished — sent ') + p.sent + ' email' + (p.sent === 1 ? '' : 's') + '</b>' +
      (by.length ? '<ul>' + by.map(function (k) { return '<li>' + esc(LABELS[k] || k) + ': ' + p.byTemplate[k] + '</li>'; }).join('') + '</ul>' : '<p class="sk-note">Nobody is due right now — everyone eligible heard from Hotelzz within the last ' + state.status.config.minGapDays + ' days.</p>') +
      ((p.sample || []).length ? '<div class="sk-note">e.g. ' + p.sample.slice(0, 5).map(function (x) { return esc(x.to) + ' → ' + esc(LABELS[x.template] || x.template); }).join(' · ') + '</div>' : '') +
      (p.suppressed ? '<div class="sk-note">' + p.suppressed + ' skipped (unsubscribed).</div>' : '') +
      (p.failed ? '<div class="sk-note" style="color:#B91C1C;">' + p.failed + ' failed — see Recent deliveries below.</div>' : '') +
      '</div>';
  }

  function detailsHtml(s) {
    var c = s.config;
    var num = function (id, label, value, min, max, help) {
      return '<div class="form-group"><label for="' + id + '">' + label + '</label><input type="number" id="' + id + '" class="form-control" min="' + min + '" max="' + max + '" value="' + value + '" />' +
        (help ? '<div class="sk-help">' + help + '</div>' : '') + '</div>';
    };
    return '<div class="promo-details">' +
      '<div class="sk-grid" style="margin-top:14px;">' +
        '<div><div class="sk-sub">Pacing</div>' +
          num('promoGap', 'Days between promotional emails to one person', c.minGapDays, 2, 60, 'Nobody gets more than one promotional email in this many days.') +
          num('promoMax', 'Most emails per run', c.maxPerSweep, 1, 2000, 'Protects the sender reputation of your mailbox.') +
          num('promoRuns', 'Runs per day (random times, 10:00–19:30 IST)', c.runsPerDay, 1, 4, '') +
          num('promoOutGap', 'Days between "claim your listing" emails to one hotel', c.outreachGapDays, 7, 180, '') +
          num('promoOutMax', '"Claim your listing" emails per hotel, ever', c.outreachMax, 0, 10, '') +
          '<button class="btn-primary" onclick="promoSaveNumbers()">Save pacing</button></div>' +
        '<div><div class="sk-sub">Templates</div><div class="table-responsive"><table class="admin-table"><thead><tr><th>Email</th><th>To</th><th>Sent 7d</th><th>On</th></tr></thead><tbody>' +
          s.templates.map(function (t) {
            return '<tr><td><a href="#" onclick="promoOpenTemplate(\'' + t + '\'); return false;">' + esc(LABELS[t] || t) + '</a></td><td>' + esc(AUDIENCE[t] || '') + '</td><td>' + (s.sent7[t] || 0) + '</td>' +
              '<td><label class="sk-switch"><input type="checkbox" ' + (c.templates[t] !== false ? 'checked' : '') + ' onchange="promoToggleTemplate(\'' + t + '\', this.checked)" /><span></span></label></td></tr>';
          }).join('') +
        '</tbody></table></div></div>' +
      '</div>' +
      '<div class="sk-grid">' +
        '<div><div class="sk-sub">Recent runs</div><div class="table-responsive"><table class="admin-table"><thead><tr><th>When</th><th>How</th><th>Sent</th><th>Skipped</th><th>Failed</th></tr></thead><tbody>' +
          ((s.runs || []).map(function (r) {
            return '<tr><td>' + esc(when(r.at)) + '</td><td>' + esc(r.trigger) + '</td><td>' + r.sent + '</td><td>' + (r.suppressed || 0) + '</td><td>' + (r.failed ? '<span class="badge badge-danger">' + r.failed + '</span>' : '0') + '</td></tr>';
          }).join('') || '<tr><td colspan="5" style="text-align:center; color:var(--admin-text-muted); padding:16px;">No runs yet.</td></tr>') +
        '</tbody></table></div></div>' +
        '<div><div class="sk-sub">Unsubscribed (' + s.unsubscribed + ')</div>' +
          '<div style="display:flex; gap:8px; margin-bottom:8px;"><input type="email" id="promoOptEmail" class="form-control" placeholder="email@example.com" />' +
          '<button class="btn-secondary" onclick="promoOptout(\'add\')">Unsubscribe</button></div>' +
          '<div class="table-responsive"><table class="admin-table"><tbody>' +
          (state.optouts.map(function (o) {
            return '<tr><td>' + esc(o.email) + '<br/><small style="color:var(--admin-text-muted);">' + esc(o.source) + ' · ' + esc(when(o.created_at.replace(' ', 'T') + 'Z')) + '</small></td>' +
              '<td style="text-align:right;"><button class="btn-secondary sk-mini" onclick="promoOptout(\'remove\', ' + window.hzArg(o.email) + ')">Resubscribe</button></td></tr>';
          }).join('') || '<tr><td style="color:var(--admin-text-muted); padding:12px;">Nobody has unsubscribed.</td></tr>') +
          '</tbody></table></div></div>' +
      '</div>' +
      '<div class="sk-sub">Scheduled account emails (always on — these are service messages, not promotions)</div>' +
      '<div class="table-responsive"><table class="admin-table"><thead><tr><th>Email</th><th>Who and when</th></tr></thead><tbody>' +
        AUTOMATIONS.map(function (a) { return '<tr><td><b>' + esc(a[0]) + '</b></td><td>' + esc(a[1]) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<button class="btn-secondary" style="margin-top:10px;" onclick="promoRunAutomations()">Run due account emails now</button>' +
      '</div>';
  }

  window.promoSave = function (patch) {
    return API.put('/admin/promotions', patch).then(function (r) { state.status = r.status; render(); toast('Saved.'); }).catch(fail);
  };
  window.promoToggleTemplate = function (t, on) { var p = {}; p[t] = on; window.promoSave({ templates: p }); };
  window.promoSaveNumbers = function () {
    var v = function (id) { return Number(document.getElementById(id).value); };
    window.promoSave({ minGapDays: v('promoGap'), maxPerSweep: v('promoMax'), runsPerDay: v('promoRuns'), outreachGapDays: v('promoOutGap'), outreachMax: v('promoOutMax') });
  };
  window.promoPreview = function () {
    API.post('/admin/promotions/run', { dryRun: true }).then(function (r) { state.preview = r; state.status = r.status; render(); }).catch(fail);
  };
  window.promoRunNow = function () {
    if (!window.confirm('Send the promotional run now? Only people who are due get an email.')) return;
    API.post('/admin/promotions/run', { dryRun: false }).then(function (r) {
      state.preview = r; state.status = r.status; render();
      toast(r.sent + ' promotional email' + (r.sent === 1 ? '' : 's') + ' sent.');
      if (window.HotelzzAdminData && window.HotelzzAdminData.load) window.HotelzzAdminData.load().then(function () { if (window.renderEmailLogTable) window.renderEmailLogTable(); });
    }).catch(fail);
  };
  window.promoRunAutomations = function () {
    API.post('/admin/automation/run', {}).then(function (r) {
      var total = Object.keys(r.summary || {}).reduce(function (n, k) { return n + (typeof r.summary[k] === 'number' ? r.summary[k] : 0); }, 0);
      toast(total ? total + ' due email' + (total === 1 ? '' : 's') + ' sent.' : 'Nothing was due — every scheduled email is up to date.');
    }).catch(fail);
  };
  window.promoOptout = function (action, email) {
    var e = email || (document.getElementById('promoOptEmail') || {}).value;
    if (!e) return toast('Enter an email address.', 'warning');
    API.post('/admin/promotions/optouts', { email: e, action: action }).then(function (r) {
      state.optouts = r.optouts; state.status.unsubscribed = r.count; render();
      toast(action === 'add' ? e + ' unsubscribed.' : e + ' will get promotions again.');
    }).catch(fail);
  };
  window.promoOpenTemplate = function (name) {
    if (window.selectEmailTemplate) window.selectEmailTemplate(name);
    var frame = document.getElementById('emailPreviewFrame');
    if (frame) frame.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
})();
