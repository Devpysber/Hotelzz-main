/**
 * Hotelzz Admin — Email Center.
 * Template gallery + live preview + manual/custom send + delivery log.
 * Self-contained: fetches its own data from /api/admin/email-templates and
 * /api/admin/emails rather than riding the main bootstrap payload.
 */
(function () {
  var API = window.HotelzzAPI;

  var templates = [];
  var accounts = [];
  var selected = null;
  var loaded = false;

  var ACCOUNT_LABEL = { info: 'info@', support: 'support@', admin: 'admin@' };
  var ACCOUNT_BADGE = { info: 'badge-info', support: 'badge-success', admin: 'badge-gray' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
    });
  }

  /** Called once, the first time the Email Center view opens. */
  window.initEmailsView = function () {
    if (loaded) { renderEmailTemplateList(); return; }
    API.get('/admin/email-templates').then(function (r) {
      templates = r.templates || [];
      accounts = r.accounts || ['info', 'support', 'admin'];
      loaded = true;
      renderEmailTemplateList();
      if (templates.length) selectEmailTemplate(templates[0].name);
    }).catch(function (err) { showToast(err.message || 'Could not load email templates.', 'danger'); });
  };

  window.renderEmailTemplateList = function () {
    var el = document.getElementById('emailTemplateList');
    if (!el) return;
    var q = (document.getElementById('emailTemplateSearch') || {}).value || '';
    q = q.trim().toLowerCase();

    var byCategory = {};
    templates.forEach(function (t) {
      if (q && (t.label + ' ' + t.name + ' ' + t.description).toLowerCase().indexOf(q) < 0) return;
      (byCategory[t.category] = byCategory[t.category] || []).push(t);
    });

    var cats = Object.keys(byCategory).sort();
    if (!cats.length) { el.innerHTML = '<p style="font-size:12.5px; color:var(--admin-text-muted); padding:8px;">No templates match.</p>'; return; }

    el.innerHTML = cats.map(function (cat) {
      var items = byCategory[cat].map(function (t) {
        var active = t.name === selected;
        return '<div onclick="selectEmailTemplate(\'' + t.name + '\')" style="cursor:pointer; padding:8px 10px; border-radius:8px; margin-bottom:2px;' +
          (active ? ' background:var(--admin-primary); color:#fff;' : '') + '">' +
          '<div style="font-size:13px; font-weight:700;">' + esc(t.label) + '</div>' +
          '<div style="font-size:11px;' + (active ? ' color:#DBEAFE;' : ' color:var(--admin-text-muted);') + '">' + ACCOUNT_LABEL[t.account] + '</div>' +
          '</div>';
      }).join('');
      return '<div style="margin-bottom:10px;">' +
        '<div style="font-size:10.5px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:var(--admin-text-muted); padding:6px 10px;">' + esc(cat) + '</div>' +
        items + '</div>';
    }).join('');
  };

  window.selectEmailTemplate = function (name) {
    var t = templates.find(function (x) { return x.name === name; });
    if (!t) return;
    selected = name;
    renderEmailTemplateList();

    document.getElementById('emailPreviewLabel').textContent = t.label;
    document.getElementById('emailPreviewDesc').textContent = t.description || '';
    var badge = document.getElementById('emailPreviewAccountBadge');
    badge.style.display = 'inline-flex';
    badge.className = 'badge ' + (ACCOUNT_BADGE[t.account] || 'badge-gray');
    badge.textContent = 'from ' + ACCOUNT_LABEL[t.account];

    // A recipient is already typed — load their real data instead of the
    // generic sample. Otherwise fall back to the sample as a starting point.
    var to = (document.getElementById('emailPreviewSendTo').value || '').trim();
    if (to && to.indexOf('@') >= 0) {
      window.emailRecipientChanged();
    } else {
      document.getElementById('emailPreviewData').value = JSON.stringify(t.sample || {}, null, 2);
      refreshEmailPreview();
    }
  };

  /** Recipient address changed — swap the sample for that account's real data. */
  window.emailRecipientChanged = function () {
    if (!selected) return;
    var to = (document.getElementById('emailPreviewSendTo').value || '').trim();
    var t = templates.find(function (x) { return x.name === selected; });
    if (!to || to.indexOf('@') < 0) {
      document.getElementById('emailPreviewData').value = JSON.stringify((t && t.sample) || {}, null, 2);
      return refreshEmailPreview();
    }
    API.get('/admin/lookup?email=' + encodeURIComponent(to)).then(function (r) {
      var sample = (t && t.sample) || {};
      var context = r.context || {};
      var merged = Object.assign({}, sample, context);
      document.getElementById('emailPreviewData').value = JSON.stringify(merged, null, 2);

      // This account is real, but it may not have every field this specific
      // template needs (e.g. it has no enquiry, so hotelName/guestName/etc.
      // stay as sample placeholders) — say so plainly instead of silently
      // handing back a blend of real and made-up values with no distinction.
      var stillFake = Object.keys(sample).filter(function (k) { return !(k in context); });
      if (!r.found) {
        showToast('No account found for ' + to + ' — every field below is still sample data.', 'warning');
      } else if (stillFake.length) {
        showToast('Loaded real data for ' + to + ', but this account has no real value for: ' +
          stillFake.join(', ') + ' — those are still sample placeholders.', 'warning');
      } else {
        showToast('Loaded real data for ' + to + '.', 'success');
      }
      refreshEmailPreview();
    }).catch(function () { refreshEmailPreview(); });
  };

  window.refreshEmailPreview = function () {
    if (!selected) return;
    var box = document.getElementById('emailPreviewData');
    var data;
    try { data = box.value.trim() ? JSON.parse(box.value) : {}; }
    catch (e) { return showToast('Sample data is not valid JSON.', 'warning'); }

    API.post('/admin/email-templates/' + encodeURIComponent(selected) + '/preview', { data: data })
      .then(function (r) {
        document.getElementById('emailPreviewSubject').textContent = r.subject || '—';
        document.getElementById('emailPreviewFrame').srcdoc = r.html || '';
      }).catch(function (err) { showToast(err.message || 'Could not render preview.', 'danger'); });
  };

  // Real sends, not a form re-submit — a double-click or an impatient extra
  // click here means a real second/third email lands in someone's inbox
  // (this happened: the same manual send went out 3 times in one minute).
  // Disable the button for the length of the request so a click can never
  // queue up behind one already in flight.
  var previewSending = false;
  window.sendPreviewedTemplate = function () {
    if (previewSending) return;
    if (!selected) return showToast('Pick a template first.', 'warning');
    var to = (document.getElementById('emailPreviewSendTo').value || '').trim();
    if (!to || to.indexOf('@') < 0) return showToast('Enter a valid recipient address.', 'warning');
    var box = document.getElementById('emailPreviewData');
    var data;
    try { data = box.value.trim() ? JSON.parse(box.value) : {}; }
    catch (e) { return showToast('Sample data is not valid JSON.', 'warning'); }

    var btn = document.getElementById('emailPreviewSendBtn');
    previewSending = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    API.post('/admin/email-send', { to: to, template: selected, data: data })
      .then(function () {
        showToast('Sent to ' + to + '.');
        document.getElementById('emailPreviewSendTo').value = '';
        window.renderEmailLogTable();
      }).catch(function (err) { showToast(err.message || 'Send failed.', 'danger'); })
      .then(function () {
        previewSending = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Send email →'; }
      });
  };

  /* --------------------------------------------------------- custom send */

  window.openCustomEmailModal = function () {
    document.getElementById('customEmailTo').value = '';
    document.getElementById('customEmailSubject').value = '';
    document.getElementById('customEmailText').value = '';
    document.getElementById('customEmailAccount').value = 'admin';
    document.getElementById('customEmailModal').classList.add('show');
  };

  var customSending = false;
  window.sendCustomEmail = function () {
    if (customSending) return;
    var to = (document.getElementById('customEmailTo').value || '').trim();
    var subject = (document.getElementById('customEmailSubject').value || '').trim();
    var text = (document.getElementById('customEmailText').value || '').trim();
    var account = document.getElementById('customEmailAccount').value;
    if (!to || to.indexOf('@') < 0) return showToast('Enter a valid recipient address.', 'warning');
    if (!subject || !text) return showToast('Write a subject and a message.', 'warning');

    var btn = document.getElementById('customEmailSendBtn');
    customSending = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    API.post('/admin/email-send', { to: to, account: account, subject: subject, text: text })
      .then(function () {
        showToast('Sent to ' + to + '.');
        window.closeModal('customEmailModal');
        window.renderEmailLogTable();
      }).catch(function (err) { showToast(err.message || 'Send failed.', 'danger'); })
      .then(function () {
        customSending = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Send →'; }
      });
  };

  /* -------------------------------------------------------------------- log */

  var STATUS_BADGE = { sent: 'badge-success', 'dev-logged': 'badge-gray', failed: 'badge-danger' };

  window.renderEmailLogTable = function () {
    var tbody = document.getElementById('emailLogTableBody');
    if (!tbody) return;
    API.get('/admin/emails?limit=150').then(function (r) {
      tbody.innerHTML = (r.emails || []).map(function (e) {
        return '<tr>' +
          '<td>' + esc(e.to_addr) + '</td>' +
          '<td style="max-width:220px;">' + esc(e.subject) + '</td>' +
          '<td>' + esc(e.template || 'custom') + '</td>' +
          '<td>' + (e.account ? esc(ACCOUNT_LABEL[e.account] || e.account) : '—') + '</td>' +
          '<td>' + esc(e.kind || 'auto') + '</td>' +
          '<td><span class="badge ' + (STATUS_BADGE[e.status] || 'badge-gray') + '">' + esc(e.status) + '</span></td>' +
          '<td>' + window.hzFormatDate(e.created_at) + '</td>' +
          '<td><button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="viewEmailLogEntry(\'' + e.id + '\')">View</button></td>' +
          '</tr>';
      }).join('') || '<tr><td colspan="8" style="text-align:center; color:var(--admin-text-muted);">No emails sent yet.</td></tr>';
    }).catch(function () { /* the log is best-effort; leave the table as-is on failure */ });
  };

  window.viewEmailLogEntry = function (id) {
    API.get('/admin/emails/' + encodeURIComponent(id)).then(function (r) {
      var e = r.email;
      document.getElementById('emailLogPreviewSubject').textContent = e.subject || 'Email';
      document.getElementById('emailLogPreviewMeta').textContent =
        'To ' + e.to_addr + ' · ' + (e.account ? ACCOUNT_LABEL[e.account] || e.account : '—') +
        ' · ' + e.status + ' · ' + window.hzFormatDate(e.created_at);
      document.getElementById('emailLogPreviewFrame').srcdoc = e.body_html || ('<pre style="white-space:pre-wrap;font-family:inherit;padding:16px;">' + esc(e.preview || '') + '</pre>');
      document.getElementById('emailLogPreviewModal').classList.add('show');
    }).catch(function (err) { showToast(err.message || 'Could not load that email.', 'danger'); });
  };
})();
