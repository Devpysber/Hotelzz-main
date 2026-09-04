/**
 * Hotelzz Admin Panel — data layer.
 *
 * Everything the panel renders comes from /api/admin/bootstrap. This module
 * keeps the object shape the admin views were written against, derives the
 * chart series from real rows, and exposes the write helpers (claim approval,
 * listing status, lead/review moderation, CSV import).
 */
(function () {
  var API = window.HotelzzAPI;

  var data = {
    loaded: false,
    admin: {},
    kpis: {},
    revenueStats: {},
    propertyTrends: { '7d': empty(), '30d': empty(), '3m': empty(), '6m': empty(), '1y': empty() },
    cities: [],
    plans: [],
    properties: [],
    claims: [],
    owners: [],
    subscriptions: [],
    leads: [],
    marketingLeads: [],
    reviews: [],
    offers: [],
    campaigns: [],
    activityLogs: [],
    emailLog: [],
    adminUsers: [],
    notifications: [],
    payments: [],
    totalPaid: 0,
    settings: {},
    importHistory: [],
    importSession: emptyImportSession()
  };

  function empty() { return { labels: [], total: [], claimed: [] }; }

  function emptyImportSession() {
    return {
      filename: null, fileSize: null, uploadTime: null,
      totalRows: 0, validRows: 0, missingPhone: 0, duplicateRows: 0,
      existingListings: 0, newListings: 0, citiesDetected: 0, invalidRows: 0,
      rows: [], duplicatesSample: [], cityAnalysis: [], columnMapping: [],
      qualityBreakdown: [], ratingDistribution: []
    };
  }

  /** Turns the per-day counts from the API into cumulative chart series. */
  function buildTrends(payload) {
    var series = (payload.propertyTrends && payload.propertyTrends.series) || [];
    var total = payload.kpis.totalProperties || 0;
    var claimedNow = payload.kpis.claimedProperties || 0;

    // Walk backwards from today's totals so the line ends at the real number.
    var labels = [], totals = [], claimed = [];
    var runningTotal = total;
    for (var i = series.length - 1; i >= 0; i--) {
      labels.unshift(series[i].day.slice(5));
      totals.unshift(runningTotal);
      claimed.unshift(claimedNow);
      runningTotal -= series[i].added;
    }
    if (!labels.length) {
      labels = ['Today'];
      totals = [total];
      claimed = [claimedNow];
    }
    var trend = { labels: labels, total: totals, claimed: claimed };
    return { '7d': slice(trend, 7), '30d': trend, '3m': trend, '6m': trend, '1y': trend };
  }

  function slice(trend, n) {
    return {
      labels: trend.labels.slice(-n),
      total: trend.total.slice(-n),
      claimed: trend.claimed.slice(-n)
    };
  }

  function absorb(payload) {
    Object.keys(payload).forEach(function (k) {
      if (k !== 'ok' && k !== 'propertyTrends') data[k] = payload[k];
    });
    // Real count of properties brought in via the CSV Import feature — not
    // the whole catalogue. The two are different: most of this catalogue
    // (Google Sheet sync, seed data) never went through an import run.
    data.kpis.totalImportedProperties = payload.kpis.totalImportedProperties || 0;
    data.propertyTrends = buildTrends(payload);
    data.importHistory = (payload.activityLogs || [])
      .filter(function (a) { return a.action === 'admin.import'; })
      .map(function (a) {
        var m = a.meta || {};
        return {
          importId: a.id, filename: m.filename || 'CSV upload',
          rows: m.total != null ? m.total : '—',
          imported: m.imported != null ? m.imported : '—',
          skipped: m.invalid != null ? m.invalid : '—',
          duplicates: m.duplicates != null ? m.duplicates : '—',
          excludedCities: m.excludedCities || 0,
          date: a.timestamp, admin: a.admin, status: 'Completed'
        };
      });
    data.loaded = true;
    return data;
  }

  data.load = function () {
    return Promise.all([API.get('/admin/bootstrap'), API.get('/payments').catch(function () { return { payments: [], totalPaid: 0 }; })])
      .then(function (out) {
        var state = absorb(out[0]);
        state.payments = out[1].payments || [];
        state.totalPaid = out[1].totalPaid || 0;
        return state;
      });
  };

  data.saveSettings = function (payload) {
    return API.put('/admin/settings', payload).then(function (r) {
      data.settings = r.settings;
      return r.settings;
    });
  };

  data.updatePlan = function (planId, payload) {
    return API.patch('/admin/plans/' + encodeURIComponent(planId), payload).then(function (r) {
      // Re-derive subscriber/MRR counts per plan the same way bootstrap does
      // (a raw catalogue swap would lose those), then merge in the fresh copy.
      var byId = {};
      data.plans.forEach(function (p) { byId[p.id] = p; });
      data.plans = r.plans.map(function (p) {
        var prev = byId[p.id] || {};
        return Object.assign({ subscribers: prev.subscribers || 0, mrr: prev.mrr || '₹0', status: 'Active' }, p);
      });
      return data.plans;
    });
  };

  data.markNotificationsRead = function (ids) {
    return API.post('/admin/notifications/read', { ids: ids });
  };

  data.inviteAdmin = function (payload) {
    return API.post('/admin/users', payload);
  };

  data.resetUserPassword = function (userId) {
    return API.post('/admin/users/' + encodeURIComponent(userId) + '/reset');
  };

  data.markPaymentPaid = function (paymentId) {
    return API.post('/payments/' + encodeURIComponent(paymentId) + '/mark-paid');
  };
  data.refresh = data.load;

  /* --------------------------------------------------------------- writes */

  data.approveClaim = function (propertyId) {
    return API.post('/admin/claims/' + encodeURIComponent(propertyId) + '/approve');
  };
  data.rejectClaim = function (propertyId) {
    return API.post('/admin/claims/' + encodeURIComponent(propertyId) + '/reject');
  };
  data.updateProperty = function (propertyId, patch) {
    return API.patch('/admin/properties/' + encodeURIComponent(propertyId), patch);
  };
  data.updateUserStatus = function (userId, status) {
    return API.patch('/admin/users/' + encodeURIComponent(userId), { status: status });
  };
  data.updateMarketingLead = function (leadId, patch) {
    return API.patch('/leads/' + encodeURIComponent(leadId), patch);
  };
  data.moderateReview = function (reviewId, status) {
    return API.patch('/reviews/' + encodeURIComponent(reviewId), { status: status });
  };
  data.updateEnquiryStatus = function (enquiryId, status) {
    return API.patch('/enquiries/' + encodeURIComponent(enquiryId), { status: status });
  };

  /* ---------------------------------------------------------- CSV import */

  data.parseCsv = function (text) {
    text = text.replace(/^﻿/, '');
    var rows = [], i = 0, field = '', row = [], inQuotes = false;
    while (i < text.length) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); field = ''; row = []; i++; continue; }
      field += ch; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    if (rows.length < 2) return { headers: [], records: [] };

    var headers = rows[0].map(function (h) { return h.trim(); });
    var records = rows.slice(1)
      .filter(function (r) { return !(r.length === 1 && !r[0].trim()); })
      .map(function (r) {
        var o = {};
        headers.forEach(function (h, c) { o[h] = (r[c] || '').trim(); });
        return o;
      })
      .filter(function (o) { return o.id || o.name; });
    return { headers: headers, records: records };
  };

  /** Builds the review screens (quality, cities, ratings, duplicates) locally. */
  data.analyseImport = function (file, parsed) {
    var records = parsed.records;
    var missingPhone = records.filter(function (r) { return !r.phone; }).length;
    var invalid = records.filter(function (r) { return !r.name; }).length;

    var byCity = {};
    records.forEach(function (r) {
      var city = r.location || r.city_slug || 'Unknown';
      byCity[city] = (byCity[city] || 0) + 1;
    });
    var cityAnalysis = Object.keys(byCity).map(function (c) {
      return { city: c, count: byCity[c] };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 12);

    var buckets = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
    records.forEach(function (r) {
      var v = Math.round(parseFloat(r.rating) || 0);
      if (buckets[v] !== undefined) buckets[v]++;
    });

    var session = emptyImportSession();
    session.filename = file.name;
    session.fileSize = (file.size / 1048576).toFixed(1) + ' MB';
    session.uploadTime = new Date().toLocaleString('en-IN');
    session.totalRows = records.length;
    session.validRows = records.length - invalid;
    session.invalidRows = invalid;
    session.missingPhone = missingPhone;
    session.citiesDetected = Object.keys(byCity).length;
    session.rows = records;
    session.cityAnalysis = cityAnalysis;
    session.columnMapping = parsed.headers.map(function (h) {
      return { csvColumn: h, mappedTo: h, status: 'Mapped' };
    });
    session.qualityBreakdown = [
      { label: 'Complete rows', count: records.length - invalid - missingPhone, color: '#10B981' },
      { label: 'Missing phone', count: missingPhone, color: '#F59E0B' },
      { label: 'Invalid rows', count: invalid, color: '#EF4444' }
    ];
    session.ratingDistribution = ['5', '4', '3', '2', '1'].map(function (k) {
      return { label: k + '★', count: buckets[k] };
    });

    data.importSession = session;
    return session;
  };

  /** Asks the server which rows are new; fills in the duplicate counters. */
  data.dryRunImport = function () {
    // Only the ids matter for duplicate detection, so send just those.
    var probe = data.importSession.rows.map(function (r) { return { id: r.id, name: r.name }; });
    return API.post('/admin/import', { rows: probe, dryRun: true })
      .then(function (r) {
        data.importSession.duplicateRows = r.summary.duplicates;
        data.importSession.existingListings = r.summary.duplicates;
        data.importSession.newListings = r.summary.importable;
        data.importSession.invalidRows = r.summary.invalid;
        data.importSession.excludedCitiesRows = r.summary.excludedCities;
        data.importSession.duplicatesSample = r.duplicates || [];
        return r;
      });
  };

  /**
   * Sends the rows in batches so progress is visible and no single request
   * carries the whole file. Resolves with the combined summary.
   */
  data.commitImport = function (onProgress) {
    var rows = data.importSession.rows;
    var CHUNK = 1000;
    var total = { total: rows.length, imported: 0, duplicates: 0, invalid: 0 };
    var totalProperties = 0;

    var sendChunk = function (index) {
      if (index >= rows.length) {
        return Promise.resolve({ ok: true, summary: total, totalProperties: totalProperties });
      }
      var slice = rows.slice(index, index + CHUNK);
      return API.post('/admin/import', { rows: slice }).then(function (r) {
        total.imported += r.summary.imported;
        total.duplicates += r.summary.duplicates;
        total.invalid += r.summary.invalid;
        totalProperties = r.totalProperties;
        if (onProgress) onProgress(Math.min(index + CHUNK, rows.length), rows.length);
        return sendChunk(index + CHUNK);
      });
    };
    return sendChunk(0);
  };

  window.HotelzzAdminData = data;
})();
