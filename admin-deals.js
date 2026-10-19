/**
 * Hotelzz Admin — Deals.
 * Every hotel offer that appears on the public Deals page: add/edit/feature/
 * pause/delete, bulk CSV import and the deal-lead list. Self-contained —
 * fetches /api/admin/deals each time the view opens.
 */
(function () {
  var API = window.HotelzzAPI;
  var state = { deals: [], grabs: [], categories: [], editing: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, type) { if (window.showToast) window.showToast(msg, type); }
  function fail(err) { toast(err.message || 'Something went wrong.', 'danger'); }
  function val(id) { return (document.getElementById(id).value || '').trim(); }
  function setVal(id, v) { document.getElementById(id).value = v == null ? '' : v; }

  window.initDealsView = function () { load(); };

  function load() {
    return API.get('/admin/deals').then(function (r) {
      state.deals = r.deals || [];
      state.grabs = r.grabs || [];
      state.categories = r.categories || [];
      var cat = document.getElementById('dealCategory');
      if (cat && !cat.options.length) {
        cat.innerHTML = state.categories.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
      }
      renderStats();
      window.renderDealsTable();
      renderGrabs();
    }).catch(fail);
  }

  function isLive(d) {
    var today = new Date().toISOString().slice(0, 10);
    return d.status === 'Active' && (!d.validFrom || d.validFrom <= today) && (!d.validTo || d.validTo >= today);
  }

  function renderStats() {
    var el = document.getElementById('dealsStats');
    if (!el) return;
    var live = state.deals.filter(isLive).length;
    var grabs = state.deals.reduce(function (n, d) { return n + (d.grabs || 0); }, 0);
    var views = state.deals.reduce(function (n, d) { return n + (d.views || 0); }, 0);
    var tiles = [['Live deals', live], ['Total deals', state.deals.length], ['Featured', state.deals.filter(function (d) { return d.featured; }).length],
                 ['Deal views', views], ['Deal leads', grabs]];
    el.innerHTML = tiles.map(function (t) {
      return '<div class="admin-card" style="padding:14px;"><div style="font-size:12px; color:var(--admin-text-muted); font-weight:700;">' + t[0] +
        '</div><div style="font-size:22px; font-weight:800;">' + t[1] + '</div></div>';
    }).join('');
  }

  window.renderDealsTable = function () {
    var tbody = document.getElementById('dealsTableBody');
    if (!tbody) return;
    var q = val('dealsSearch').toLowerCase();
    var st = val('dealsStatusFilter');
    var rows = state.deals.filter(function (d) {
      if (st && d.status !== st) return false;
      if (q && (d.title + ' ' + d.property.name + ' ' + (d.property.location || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    tbody.innerHTML = rows.map(function (d) {
      var live = isLive(d);
      return '<tr>' +
        '<td style="font-weight:700; max-width:260px;">' + (d.featured ? '★ ' : '') + esc(d.title) + '<br/><small style="color:var(--admin-text-muted);">' + esc(d.category) + '</small></td>' +
        '<td>' + esc(d.property.name) + '<br/><small style="color:var(--admin-text-muted);">' + esc(d.property.location || '') + '</small></td>' +
        '<td>' + (d.discount ? '<span class="badge badge-info">' + esc(d.discount) + '</span>' : '—') + (d.code ? '<br/><code>' + esc(d.code) + '</code>' : '') + '</td>' +
        '<td style="font-size:12.5px;">' + esc(d.validFrom || '—') + ' → ' + esc(d.validTo || 'no expiry') + '</td>' +
        '<td>' + (d.views || 0) + '</td><td>' + (d.grabs || 0) + '</td>' +
        '<td><span class="badge ' + (live ? 'badge-success' : 'badge-warning') + '">' + (live ? 'Live' : esc(d.status)) + '</span></td>' +
        '<td style="white-space:nowrap;">' +
          '<button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="openDealModal(\'' + esc(d.id) + '\')">Edit</button> ' +
          '<button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="patchDeal(\'' + esc(d.id) + '\', {featured: ' + !d.featured + '})">' + (d.featured ? 'Unfeature' : 'Feature') + '</button> ' +
          '<button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="patchDeal(\'' + esc(d.id) + '\', {status: \'' + (d.status === 'Active' ? 'Paused' : 'Active') + '\'})">' + (d.status === 'Active' ? 'Pause' : 'Activate') + '</button> ' +
          '<button class="btn-secondary" style="padding:4px 8px; font-size:11.5px; color:#B91C1C;" onclick="deleteDeal(\'' + esc(d.id) + '\')">Delete</button>' +
        '</td></tr>';
    }).join('') || '<tr><td colspan="8" style="text-align:center; padding:24px; color:var(--admin-text-muted);">No deals yet. Add one or import a CSV.</td></tr>';
  };

  function renderGrabs() {
    var tbody = document.getElementById('dealGrabsTableBody');
    if (!tbody) return;
    tbody.innerHTML = state.grabs.map(function (g) {
      return '<tr><td>' + esc(String(g.createdAt || '').slice(0, 16)) + '</td><td>' + esc(g.deal) + '</td><td>' + esc(g.hotel || '—') +
        '</td><td style="font-weight:700;">' + esc(g.name) + '</td><td><a href="mailto:' + esc(g.email) + '">' + esc(g.email) +
        '</a></td><td><a href="tel:' + esc(g.phone) + '">' + esc(g.phone || '') + '</a></td></tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--admin-text-muted);">No deal leads yet.</td></tr>';
  }

  /* ------------------------------------------------------------ edit */

  var searchTimer;
  window.searchDealProperty = function (selectedId, selectedName) {
    clearTimeout(searchTimer);
    var sel = document.getElementById('dealPropSelect');
    var q = val('dealPropSearch');
    searchTimer = setTimeout(function () {
      API.get('/properties?limit=20&q=' + encodeURIComponent(q)).then(function (r) {
        var props = r.properties || [];
        if (selectedId && !props.some(function (p) { return p.id === selectedId; })) {
          props.unshift({ id: selectedId, name: selectedName || selectedId, location: '' });
        }
        sel.innerHTML = props.map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (p.id === selectedId ? ' selected' : '') + '>' + esc(p.name) + (p.location ? ' — ' + esc(p.location) : '') + '</option>';
        }).join('') || '<option value="">No hotels match</option>';
      }).catch(fail);
    }, selectedId ? 0 : 250);
  };

  window.openDealModal = function (id) {
    var d = id ? state.deals.filter(function (x) { return x.id === id; })[0] : null;
    state.editing = d ? d.id : null;
    document.getElementById('dealModalTitle').textContent = d ? 'Edit Deal' : 'Add Deal';
    document.getElementById('dealError').textContent = '';
    setVal('dealPropSearch', d ? d.property.name : '');
    setVal('dealTitle', d ? d.title : '');
    setVal('dealDiscount', d ? d.discount : '');
    setVal('dealCode', d ? d.code : '');
    setVal('dealOrig', d ? d.originalPrice : '');
    setVal('dealPrice', d ? d.dealPrice : '');
    setVal('dealFrom', d ? d.validFrom : new Date().toISOString().slice(0, 10));
    setVal('dealTo', d ? d.validTo : new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
    setVal('dealCategory', d ? d.category : 'Stay');
    setVal('dealStatus', d ? d.status : 'Active');
    setVal('dealImage', d ? d.imageUrl : '');
    setVal('dealDesc', d ? d.description : '');
    setVal('dealTerms', d ? d.terms : '');
    document.getElementById('dealFeatured').checked = !!(d && d.featured);
    window.searchDealProperty(d ? d.property.id : null, d ? d.property.name : null);
    document.getElementById('dealModal').classList.add('show');
  };

  window.saveDeal = function (e) {
    e.preventDefault();
    var err = document.getElementById('dealError');
    err.textContent = '';
    var payload = {
      propertyId: val('dealPropSelect'), title: val('dealTitle'), discount: val('dealDiscount'),
      code: val('dealCode').toUpperCase(), category: val('dealCategory'), status: val('dealStatus'),
      validFrom: val('dealFrom'), validTo: val('dealTo'), imageUrl: val('dealImage'),
      description: val('dealDesc'), terms: val('dealTerms'), featured: document.getElementById('dealFeatured').checked
    };
    if (val('dealOrig')) payload.originalPrice = Number(val('dealOrig'));
    if (val('dealPrice')) payload.dealPrice = Number(val('dealPrice'));
    if (!payload.propertyId) { err.textContent = 'Choose a hotel.'; return; }
    if (payload.title.length < 2) { err.textContent = 'Enter a title.'; return; }
    if (payload.validFrom && payload.validTo && payload.validTo < payload.validFrom) { err.textContent = '"Valid until" must be after "Valid from".'; return; }

    var call = state.editing ? API.patch('/admin/deals/' + encodeURIComponent(state.editing), payload) : API.post('/admin/deals', payload);
    call.then(function () {
      window.closeModal('dealModal');
      toast(state.editing ? 'Deal updated.' : 'Deal published.');
      return load();
    }).catch(function (e2) { err.textContent = e2.message; });
  };

  window.patchDeal = function (id, patch) {
    API.patch('/admin/deals/' + encodeURIComponent(id), patch).then(function () {
      toast('Deal updated.');
      return load();
    }).catch(fail);
  };

  window.deleteDeal = function (id) {
    if (!window.confirm('Delete this deal? Travellers will no longer see it.')) return;
    API.del('/admin/deals/' + encodeURIComponent(id)).then(function () {
      toast('Deal deleted.');
      return load();
    }).catch(fail);
  };

  /* ------------------------------------------------------------- csv */

  var TEMPLATE_COLUMNS = ['property_id', 'property_name', 'title', 'description', 'discount', 'code', 'category',
                          'image_url', 'original_price', 'deal_price', 'terms', 'valid_from', 'valid_to', 'featured'];

  window.downloadDealsTemplate = function () {
    var csv = TEMPLATE_COLUMNS.join(',') + '\r\n' +
      ',The Grand Palace,Monsoon Staycation,Breakfast + late checkout included,20% OFF,MONSOON20,Weekend,,4000,3200,Min 2 nights,2026-10-01,2026-12-31,yes\r\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = 'hotelzz-deals-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    var rows = [], i = 0, field = '', row = [], q = false;
    while (i < text.length) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
        field += ch; i++; continue;
      }
      if (ch === '"') { q = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); field = ''; row = []; i++; continue; }
      field += ch; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    if (rows.length < 2) return [];
    var headers = rows[0].map(function (h) { return h.trim().toLowerCase().replace(/\s+/g, '_'); });
    return rows.slice(1).filter(function (r) { return r.some(function (c) { return c.trim(); }); }).map(function (r) {
      var o = {};
      headers.forEach(function (h, c) { o[h] = (r[c] || '').trim(); });
      return o;
    });
  }

  window.importDealsCsv = function (input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var rows = parseCsv(String(reader.result));
      if (!rows.length) return toast('That CSV has no rows.', 'warning');
      if (!window.confirm('Import ' + rows.length + ' deal' + (rows.length > 1 ? 's' : '') + ' from ' + file.name + '?')) return;
      API.post('/admin/deals/import', { rows: rows }).then(function (r) {
        var s = r.summary;
        var msg = 'Imported ' + s.imported + ' of ' + s.total + ' deals.';
        if (s.failed) msg += ' ' + s.failed + ' skipped (' + r.errors.slice(0, 3).map(function (e) { return 'row ' + e.row + ': ' + e.error; }).join('; ') + ').';
        toast(msg, s.failed ? 'warning' : 'success');
        return load();
      }).catch(fail);
    };
    reader.readAsText(file);
  };
})();
