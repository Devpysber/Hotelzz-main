/**
 * Hotelzz Admin Panel — Main Application Script
 * Updated with Phone-Based Claims Timeline & CSV Import Workflow Logic.
 */

(function () {
  const data = window.HotelzzAdminData;
  let currentView = 'dashboard';
  let filteredProperties = [];
  let filteredClaims = [];

  /** Server timestamps arrive as "YYYY-MM-DD HH:MM:SS" in UTC. */
  const fmt = function (value) {
    if (!value) return '—';
    const iso = /^\d{4}-\d{2}-\d{2} /.test(value) ? value.replace(' ', 'T') + 'Z' : value;
    const d = new Date(iso);
    if (isNaN(d)) return value;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
           d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };
  window.hzFormatDate = fmt;

  const fail = (err) => showToast(err.message || 'Something went wrong.', 'danger');
  let currentImportStep = 1;

  // Utility Toast
  window.showToast = function (message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = '✓';
    if (type === 'warning') icon = '⚠️';
    if (type === 'danger') icon = '✕';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  };

  // DOM Content Loaded Init
  document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupGlobalSearch();
    setupNotifications();
    setupUserProfile();
    setupTimeframeButtons();
    setupModals();

    Promise.all([data.load(), window.HotelzzMarketingStore.ready()]).then(() => {
      filteredProperties = data.properties.slice();
      filteredClaims = data.claims.slice();
      renderEverything();
      handleUrlHash();
    }).catch((err) => {
      if (err.status === 401 || err.status === 403) {
        // A stale or invalid session cookie can otherwise survive the
        // redirect and reject the very next login attempt too, bouncing
        // the browser between here and login.html on repeat — clear it
        // first so the login form actually starts from a clean slate.
        const dest = 'admin-login.html?next=' +
          encodeURIComponent(window.location.pathname + window.location.hash);
        window.HotelzzAPI.auth.logout().catch(() => {}).then(() => { window.location.href = dest; });
        return;
      }
      fail(err);
    });
  });

  /** Re-pulls everything from the server, then repaints every view. */
  function reload() {
    return data.load().then(() => {
      filteredProperties = data.properties.slice();
      filteredClaims = data.claims.slice();
      renderEverything();
    }).catch(fail);
  }

  window.hzLogout = function () {
    window.HotelzzAPI.auth.logout().then(() => { window.location.href = 'admin-login.html'; });
  };

  function renderEverything() {
    renderNotifications();
    renderDashboard();
    renderPropertiesTable();
    renderOwnersTable();
    renderClaimsTable();
    renderSubscriptionsTable();
    renderPlansGrid();
    renderRevenueView();
    renderCityAnalyticsTable();
    renderLeadsTable();
    renderActivityLogsTable();
    renderAdminUsersTable();
    renderReviewsTable();
    renderPaymentsTable();
    renderSettingsForm();
    renderImportDuplicatesTable();
    renderCityChips();
    renderColumnMapperTable();
    renderImportHistoryTable();
    if (window.renderEmailLogTable) window.renderEmailLogTable();
  }

  // URL Hash / Query Route Handler
  function handleUrlHash() {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    switchView(hash);
  }

  // View Switcher
  window.switchView = function (viewName) {
    currentView = viewName;
    window.location.hash = viewName;

    // Update active nav items
    document.querySelectorAll('.nav-item').forEach(el => {
      if (el.getAttribute('data-view') === viewName) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    // Show active page view
    document.querySelectorAll('.admin-page-view').forEach(el => {
      if (el.id === `view-${viewName}`) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    // Close mobile sidebar if open
    document.getElementById('sidebar').classList.remove('mobile-open');

    // Trigger charts or renderers based on view
    if (viewName === 'dashboard') {
      setTimeout(() => renderPropertyTrendChart('30d'), 50);
    }
    if (viewName === 'revenue') {
      setTimeout(() => renderRevenueChart(), 50);
    }
    if (viewName === 'admin-marketing') {
      renderAdminMarketingView();
    }
    if (viewName === 'emails' && window.initEmailsView) {
      window.initEmailsView();
    }
    if (viewName === 'users' && window.initUsersView) {
      window.initUsersView();
    }

    // A drawer or modal left open would overlay — and block — the new view.
    document.querySelectorAll('[id$="Drawer"].open').forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.admin-modal-overlay.show').forEach(el => el.classList.remove('show'));
  };

  // Navigation Event Listeners
  function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = item.getAttribute('data-view');
        if (targetView) switchView(targetView);
      });
    });

    // Sidebar Collapse
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    const sidebar = document.getElementById('sidebar');
    const shell = document.getElementById('adminShell');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        shell.classList.toggle('sidebar-collapsed');
      });
    }

    // Mobile Hamburger Toggle
    const mobileBtn = document.getElementById('mobileToggleBtn');
    if (mobileBtn) {
      mobileBtn.addEventListener('click', () => {
        sidebar.classList.toggle('mobile-open');
      });
    }
  }

  // Global Search Dropdown
  function setupGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const dropdown = document.getElementById('globalSearchDropdown');
    if (!input || !dropdown) return;

    input.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) {
        dropdown.classList.remove('show');
        return;
      }

      let html = '';
      // Search properties
      const propMatches = data.properties.filter(p => p.name.toLowerCase().includes(q) || p.city.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
      if (propMatches.length) {
        html += `<div class="search-category-title">Properties (${propMatches.length})</div>`;
        propMatches.slice(0, 3).forEach(p => {
          html += `<div class="search-result-item" onclick="openPropertyModal('${p.id}'); document.getElementById('globalSearchDropdown').classList.remove('show');">
            <div>
              <div class="search-result-title">${p.name}</div>
              <div class="search-result-subtitle">${p.city}${p.state ? ', ' + p.state : ''} • ${p.phoneMasked}</div>
            </div>
            <span class="badge badge-info">${p.id}</span>
          </div>`;
        });
      }

      // Search claims
      const claimMatches = data.claims.filter(c => c.propertyName.toLowerCase().includes(q) || c.claimantName.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
      if (claimMatches.length) {
        html += `<div class="search-category-title">Claims (${claimMatches.length})</div>`;
        claimMatches.slice(0, 3).forEach(c => {
          html += `<div class="search-result-item" onclick="openReviewClaimModal('${c.id}'); document.getElementById('globalSearchDropdown').classList.remove('show');">
            <div>
              <div class="search-result-title">${c.propertyName}</div>
              <div class="search-result-subtitle">Claimant: ${c.claimantName} • ${c.phoneMasked}</div>
            </div>
            <span class="badge badge-warning">${c.claimStatus}</span>
          </div>`;
        });
      }

      // Search owners
      const ownerMatches = data.owners.filter(o => o.name.toLowerCase().includes(q) || o.email.toLowerCase().includes(q) || o.company.toLowerCase().includes(q));
      if (ownerMatches.length) {
        html += `<div class="search-category-title">Owners (${ownerMatches.length})</div>`;
        ownerMatches.slice(0, 3).forEach(o => {
          html += `<div class="search-result-item" onclick="switchView('owners'); openOwnerModal('${o.id}'); document.getElementById('globalSearchDropdown').classList.remove('show');">
            <div>
              <div class="search-result-title">${o.name}</div>
              <div class="search-result-subtitle">${o.company} • ${o.email}</div>
            </div>
            <span class="badge ${o.status === 'Active' ? 'badge-success' : 'badge-warning'}">${o.status}</span>
          </div>`;
        });
      }

      // Search cities
      const cityMatches = data.cities.filter(c => (c.name || c.slug || '').toLowerCase().includes(q) || (c.slug || '').toLowerCase().includes(q));
      if (cityMatches.length) {
        html += `<div class="search-category-title">Cities (${cityMatches.length})</div>`;
        cityMatches.slice(0, 3).forEach(c => {
          html += `<div class="search-result-item" onclick="switchView('cities'); document.getElementById('globalSearchDropdown').classList.remove('show');">
            <div>
              <div class="search-result-title">${c.name || c.slug}</div>
              <div class="search-result-subtitle">${c.properties.toLocaleString('en-IN')} properties • ${c.claimed.toLocaleString('en-IN')} claimed</div>
            </div>
            <span class="badge badge-info">${c.slug}</span>
          </div>`;
        });
      }

      // Search import history
      const importMatches = data.importHistory.filter(i => i.importId.toLowerCase().includes(q) || i.filename.toLowerCase().includes(q));
      if (importMatches.length) {
        html += `<div class="search-category-title">Import Reports (${importMatches.length})</div>`;
        importMatches.slice(0, 3).forEach(i => {
          html += `<div class="search-result-item" onclick="switchView('import-history'); document.getElementById('globalSearchDropdown').classList.remove('show');">
            <div>
              <div class="search-result-title">${i.importId} — ${i.filename}</div>
              <div class="search-result-subtitle">${typeof i.imported === 'number' ? i.imported.toLocaleString('en-IN') : '—'} Imported • ${fmt(i.date)}</div>
            </div>
            <span class="badge badge-success">${i.status}</span>
          </div>`;
        });
      }

      if (!html) {
        html = `<div style="padding: 16px; text-align: center; color: var(--admin-text-muted);">No results found for "${q}"</div>`;
      }

      dropdown.innerHTML = html;
      dropdown.classList.add('show');
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('show');
      }
    });
  }

  // Notifications
  function setupNotifications() {
    const bellBtn = document.getElementById('notificationBellBtn');
    const dropdown = document.getElementById('notificationDropdown');
    const list = document.getElementById('notificationList');
    if (!bellBtn || !dropdown || !list) return;

    bellBtn.addEventListener('click', () => {
      dropdown.classList.toggle('show');
    });

    renderNotifications();

    document.addEventListener('click', (e) => {
      if (!bellBtn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('show');
      }
    });
  }

  function renderNotifications() {
    const list = document.getElementById('notificationList');
    if (!list) return;
    const badge = document.getElementById('notificationBadge');
    if (badge) badge.classList.toggle('show', data.notifications.some(n => !n.read));
    list.innerHTML = data.notifications.map(n => `
      <div class="notification-item ${n.read ? '' : 'unread'}" style="cursor:pointer;" onclick="openNotification('${n.id}')">
        <div class="notification-icon">🔔</div>
        <div class="notification-content">
          <div class="notification-title">${n.title}</div>
          <div class="notification-text">${n.message}</div>
          <div class="notification-time">${fmt(n.time)}</div>
        </div>
      </div>
    `).join('');
  }

  // Notification ids are "<type>-<realId>" — but the real id itself can
  // contain dashes (enquiry ids look like "HZ-ENQ-58231"), so match on the
  // known prefixes instead of a naive split('-').
  const NOTIF_PREFIXES = ['claim-', 'lead-', 'enq-', 'mail-'];
  function parseNotificationId(id) {
    const p = NOTIF_PREFIXES.find(pre => id.indexOf(pre) === 0);
    return p ? { type: p.slice(0, -1), realId: id.slice(p.length) } : { type: null, realId: id };
  }

  function highlightRow(tbodyId, rowId) {
    const tbody = document.getElementById(tbodyId);
    const row = tbody && tbody.querySelector(`[data-row-id="${rowId}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.style.transition = 'background-color 0.4s';
    row.style.backgroundColor = '#FEF3C7';
    setTimeout(() => { row.style.backgroundColor = ''; }, 2200);
  }

  // Clicking a notification used to only mark it read — it went nowhere,
  // so "Enquiry not yet opened" gave no way to actually go open it. Now it
  // switches to the right admin view and opens/highlights the real record.
  window.openNotification = function (id) {
    window.markNotificationRead(id);
    const dropdown = document.getElementById('notificationDropdown');
    if (dropdown) dropdown.classList.remove('show');

    const { type, realId } = parseNotificationId(id);
    if (type === 'claim') {
      switchView('claims');
      const c = (data.claims || []).find(x => x.propertyId === realId);
      if (c) setTimeout(() => openReviewClaimModal(c.id), 80);
    } else if (type === 'lead' || type === 'enq') {
      switchView('leads');
      setTimeout(() => highlightRow('leadsTableBody', realId), 80);
    } else if (type === 'mail') {
      switchView('emails');
      setTimeout(() => { if (window.viewEmailLogEntry) window.viewEmailLogEntry(realId); }, 200);
    }
  };

  window.markNotificationRead = function (id) {
    const n = data.notifications.find(x => x.id === id);
    if (!n || n.read) return;
    n.read = true;
    renderNotifications();
    // Persisted so the badge stays cleared across reloads and devices.
    data.markNotificationsRead([id]).catch(fail);
  };

  window.markAllNotificationsRead = function () {
    const unread = data.notifications.filter(n => !n.read).map(n => n.id);
    if (!unread.length) return showToast('Nothing unread.');
    data.notifications.forEach(n => { n.read = true; });
    renderNotifications();
    data.markNotificationsRead(unread)
      .then(() => showToast('All notifications marked as read.'))
      .catch(fail);
  };

  /* ------------------------------------------------------------ settings */

  function renderSettingsForm() {
    const cfg = data.settings || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    set('setPlatformTitle', cfg.platformTitle);
    set('setSupportEmail', cfg.supportEmail);
    set('setSupportPhone', cfg.supportPhone);
    set('setWhatsappNumber', cfg.whatsappNumber);
    set('setNotifyEmail', cfg.notifyEmail);
    set('setExcludedCities', cfg.excludedCities);
  }

  window.savePlatformSettings = function () {
    const val = (id) => (document.getElementById(id) || {}).value || '';
    data.saveSettings({
      platformTitle: val('setPlatformTitle'),
      supportEmail: val('setSupportEmail'),
      supportPhone: val('setSupportPhone'),
      whatsappNumber: val('setWhatsappNumber'),
      notifyEmail: val('setNotifyEmail'),
      excludedCities: val('setExcludedCities')
    }).then(() => {
      showToast('Platform settings saved.');
      renderSettingsForm();
    }).catch(fail);
  };

  /* --------------------------------------------------------- admin users */

  window.openInviteAdminModal = function () {
    document.getElementById('inviteAdminName').value = '';
    document.getElementById('inviteAdminEmail').value = '';
    document.getElementById('inviteAdminModal').classList.add('show');
  };

  window.sendAdminInvite = function () {
    const name = document.getElementById('inviteAdminName').value.trim();
    const email = document.getElementById('inviteAdminEmail').value.trim();
    if (name.length < 2 || email.indexOf('@') < 0) {
      return showToast('Enter a name and a valid email address.', 'warning');
    }
    data.inviteAdmin({ name, email }).then((r) => {
      closeModal('inviteAdminModal');
      showToast(r.message || 'Invite sent.');
      return reload();
    }).catch(fail);
  };

  window.resetUserPassword = function (id, email) {
    if (!window.confirm('Email a password reset link to ' + email + '?')) return;
    data.resetUserPassword(id)
      .then((r) => showToast(r.message || 'Reset link sent.'))
      .catch(fail);
  };

  // User Profile Menu
  function setupUserProfile() {
    const profileBtn = document.getElementById('adminProfileBtn');
    const menu = document.getElementById('userDropdownMenu');
    if (!profileBtn || !menu) return;

    profileBtn.addEventListener('click', () => {
      menu.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!profileBtn.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove('show');
      }
    });
  }

  // Timeframe switching for Property Overview Chart
  function setupTimeframeButtons() {
    document.querySelectorAll('.tf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tf = btn.getAttribute('data-tf');
        renderPropertyTrendChart(tf);
      });
    });
  }

  // Render Dashboard
  function renderDashboard() {
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    const admin = data.admin || {};
    const nameEl = document.getElementById('adminProfileName');
    const emailEl = document.getElementById('adminProfileEmail');
    if (nameEl) nameEl.textContent = admin.name || 'Admin';
    if (emailEl) emailEl.textContent = admin.email || '';

    setText('dashTotalProps', (data.kpis.totalProperties || 0).toLocaleString('en-IN'));
    setText('dashClaimedProps', (data.kpis.claimedProperties || 0).toLocaleString('en-IN'));
    setText('dashClaimsMonth', (data.kpis.claimsTotal || 0).toLocaleString('en-IN'));
    setText('dashImportedProps', (data.kpis.totalImportedProperties || 0).toLocaleString('en-IN'));
    setText('dashMRR', data.kpis.mrr || '₹0');
    setText('dashPendingClaims', data.kpis.pendingClaims || 0);

    // Real subtext everywhere this used to be static mockup copy.
    setText('dashTotalPropsGrowth', '↑ ' + (data.kpis.totalPropertiesGrowth || '—'));
    setText('dashClaimRateText', (data.kpis.claimedPercentage || '0%') + ' Claim Rate');
    setText('dashClaimsBreakdown', `${data.kpis.claimsSuccessful || 0} Successful • ${data.kpis.claimsFailed || 0} Failed`);
    setText('dashLastImportSize', data.kpis.lastImportSize != null
      ? 'Last size: ' + data.kpis.lastImportSize.toLocaleString('en-IN') + ' rows'
      : 'No imports run yet');
    setText('dashActiveSubsText', `${data.kpis.activeSubscriptions || 0} active subscriptions`);

    setText('navClaimsBadge', data.kpis.pendingClaims || 0);
    setText('quickClaimsCount', data.kpis.pendingClaims || 0);

    setText('opClaimsHeadline', `${data.kpis.claimsSuccessful || 0} Successful Claims`);
    setText('opClaimsSub', data.kpis.claimsSuccessRate
      ? data.kpis.claimsSuccessRate + ' verification success rate'
      : 'No claims decided yet');
    setText('opImportHeadline', data.kpis.importSuccessRate ? data.kpis.importSuccessRate + ' Success Rate' : 'No imports run yet');
    setText('opImportSub', data.kpis.importDuplicateRate
      ? data.kpis.importDuplicateRate + ' duplicate rate automatically excluded'
      : '—');

    setText('claimsKpiTotal', (data.kpis.claimsTotal || 0).toLocaleString('en-IN'));
    setText('claimsKpiVerified', (data.kpis.claimsSuccessful || 0).toLocaleString('en-IN'));
    setText('claimsKpiPending', (data.kpis.pendingClaims || 0).toLocaleString('en-IN'));
    setText('claimsKpiRejected', (data.kpis.claimsFailed || 0).toLocaleString('en-IN'));

    renderPropertyTrendChart('30d');
  }

  // SVG Chart: Property Growth
  function renderPropertyTrendChart(timeframe = '30d') {
    const container = document.getElementById('propertyTrendChart');
    if (!container) return;
    const trend = data.propertyTrends[timeframe] || data.propertyTrends['30d'];

    const width = container.clientWidth || 600;
    const height = 240;
    const padding = 40;

    // A brand-new database can yield a single data point or a flat line, so
    // guard both divisors before they reach the SVG.
    const rawMax = Math.max(...trend.total) * 1.05;
    const rawMin = Math.min(...trend.claimed) * 0.95;
    const minVal = rawMin;
    const maxVal = rawMax > rawMin ? rawMax : rawMin + 1;
    const span = Math.max(trend.labels.length - 1, 1);

    const getX = (i) => trend.labels.length === 1
      ? width / 2
      : padding + (i * (width - 2 * padding) / span);
    const getY = (val) => height - padding - ((val - minVal) / (maxVal - minVal)) * (height - 2 * padding);

    let totalPoints = trend.total.map((v, i) => `${getX(i)},${getY(v)}`).join(' ');
    let claimedPoints = trend.claimed.map((v, i) => `${getX(i)},${getY(v)}`).join(' ');

    let svg = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2563EB" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="#2563EB" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="claimedGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#10B981" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="#10B981" stop-opacity="0"/>
        </linearGradient>
      </defs>

      <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" stroke="#E2E8F0" stroke-dasharray="4"/>
      <line x1="${padding}" y1="${height / 2}" x2="${width - padding}" y2="${height / 2}" stroke="#E2E8F0" stroke-dasharray="4"/>
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#E2E8F0"/>

      <polygon points="${getX(0)},${height - padding} ${totalPoints} ${getX(trend.labels.length - 1)},${height - padding}" fill="url(#totalGrad)" />
      <polyline points="${totalPoints}" fill="none" stroke="#2563EB" stroke-width="3" stroke-linecap="round" />

      <polygon points="${getX(0)},${height - padding} ${claimedPoints} ${getX(trend.labels.length - 1)},${height - padding}" fill="url(#claimedGrad)" />
      <polyline points="${claimedPoints}" fill="none" stroke="#10B981" stroke-width="3" stroke-linecap="round" />

      ${trend.labels.map((lbl, i) => `<text x="${getX(i)}" y="${height - 12}" text-anchor="middle" font-size="11" fill="#64748B" font-weight="600">${lbl}</text>`).join('')}
    </svg>`;

    container.innerHTML = svg;
  }

  // All Properties Table & Filters
  function renderPropertiesTable() {
    const tbody = document.getElementById('propertiesTableBody');
    if (!tbody) return;

    tbody.innerHTML = filteredProperties.map(p => `
      <tr>
        <td>
          <div style="font-weight: 700;">${p.name}</div>
          <div style="font-size: 11.5px; color: var(--admin-text-muted);">${p.category}</div>
        </td>
        <td><code style="font-weight:700;">${p.id}</code></td>
        <td>${p.city}</td>
        <td><span class="phone-masked">${p.phoneMasked}</span></td>
        <td>${p.owner}</td>
        <td>
          <span class="badge ${p.claimStatus === 'Claimed' ? 'badge-success' : (p.claimStatus === 'Phone Verified' ? 'badge-info' : 'badge-gray')}">
            <span class="badge-dot"></span>${p.claimStatus}
          </span>
        </td>
        <td><span class="plan-tag ${String(p.subscription || 'free').toLowerCase()}">${p.subscription}</span></td>
        <td>
          <button class="btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="openPropertyModal('${p.id}')">Manage</button>
        </td>
      </tr>
    `).join('');
  }

  window.exportProperties = function () { exportAdminCsv('properties'); };

  window.exportAdminCsv = function (name) {
    window.location.href = name === 'payments'
      ? '/api/payments/export'
      : '/api/admin/' + name + '/export';
  };

  window.filterProperties = function () {
    const q = document.getElementById('propSearchInput').value.toLowerCase().trim();
    const city = document.getElementById('propCityFilter').value;
    const claim = document.getElementById('propClaimFilter').value;

    filteredProperties = data.properties.filter(p => {
      const matchQ = !q || p.name.toLowerCase().includes(q) || p.city.toLowerCase().includes(q) || p.owner.toLowerCase().includes(q);
      const matchCity = !city || p.city === city;
      const matchClaim = !claim || p.claimStatus === claim;
      return matchQ && matchCity && matchClaim;
    });

    renderPropertiesTable();
  };

  // Property Detail Modal
  window.openPropertyModal = function (id) {
    const p = data.properties.find(x => x.id === id) || data.properties[0];
    const modal = document.getElementById('propertyModal');
    const body = document.getElementById('propertyModalBody');
    if (!modal || !body) return;

    body.innerHTML = `
      <div style="display: flex; gap: 16px; margin-bottom: 20px; align-items: center;">
        <div style="width: 54px; height: 54px; border-radius: 12px; background: var(--admin-primary-light); color: var(--admin-primary); display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 800;">🏨</div>
        <div>
          <h2 style="font-size: 20px; font-weight: 800; margin-bottom: 2px;">${p.name}</h2>
          <p style="color: var(--admin-text-muted); font-size: 13px;">${p.address} • ${p.category}</p>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
        <div style="background: var(--admin-bg); padding: 14px; border-radius: 8px;">
          <div style="font-size: 12px; font-weight: 700; color: var(--admin-text-muted); text-transform: uppercase;">Claim Status</div>
          <div style="font-size: 16px; font-weight: 700; margin-top: 4px;">${p.claimStatus}</div>
          <div style="font-size: 12px; color: var(--admin-text-muted); margin-top: 4px;">Stored Phone: <span class="phone-masked">${p.phoneMasked}</span></div>
        </div>

        <div style="background: var(--admin-bg); padding: 14px; border-radius: 8px;">
          <div style="font-size: 12px; font-weight: 700; color: var(--admin-text-muted); text-transform: uppercase;">Current Subscription</div>
          <div style="font-size: 16px; font-weight: 700; margin-top: 4px;"><span class="plan-tag ${String(p.subscription || 'free').toLowerCase()}">${p.subscription}</span></div>
          <div style="font-size: 12px; color: var(--admin-text-muted);">${p.views.toLocaleString('en-IN')} views • ${p.leads} enquiries • ★ ${p.rating || '—'}</div>
        </div>
      </div>

      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn-secondary" onclick="toggleListingActive('${p.id}', ${p.status === 'Active' ? 'false' : 'true'})">
          ${p.status === 'Active' ? 'Hide listing' : 'Publish listing'}
        </button>
        <a class="btn-secondary" style="text-decoration:none;" target="_blank" rel="noopener" href="property.html?id=${encodeURIComponent(p.id)}">Open public page</a>
        ${p.claimStatus === 'Pending' ? `<button class="btn-primary" onclick="approveClaim('${p.id}')">Approve claim</button>` : ''}
      </div>
    `;

    modal.classList.add('show');
  };

  // REDESIGNED PROPERTY CLAIMS TABLE & TIMELINE MODAL
  function renderClaimsTable() {
    const tbody = document.getElementById('claimsTableBody');
    if (!tbody) return;

    tbody.innerHTML = filteredClaims.map(c => `
      <tr>
        <td><code style="font-weight:700;">${c.id}</code></td>
        <td style="font-weight: 700;">${c.propertyName}</td>
        <td>${c.city}</td>
        <td>${c.claimantName}<br/><small style="color:var(--admin-text-muted);">${c.email}</small></td>
        <td><span class="phone-masked">${c.phoneMasked}</span></td>
        <td><span class="badge ${c.phoneMatchStatus === 'Verified' ? 'badge-success' : 'badge-danger'}">${c.phoneMatchStatus}</span></td>
        <td><span class="badge ${c.claimStatus === 'Claimed' ? 'badge-success' : (c.claimStatus === 'Failed' ? 'badge-danger' : 'badge-warning')}">${c.claimStatus}</span></td>
        <td>${fmt(c.startedDate)}</td>
        <td>${c.completedDate ? fmt(c.completedDate) : '—'}</td>
        <td>
          <button class="btn-primary" style="padding: 4px 10px; font-size: 12px;" onclick="openReviewClaimModal('${c.id}')">Audit Claim</button>
        </td>
      </tr>
    `).join('');
  }

  window.openReviewClaimModal = function (id) {
    const c = data.claims.find(x => x.id === id) || data.claims[0];
    const modal = document.getElementById('claimModal');
    const body = document.getElementById('claimModalBody');
    if (!modal || !body) return;

    body.innerHTML = `
      <div style="margin-bottom: 20px;">
        <span class="badge ${c.claimStatus === 'Claimed' ? 'badge-success' : 'badge-warning'}">${c.claimStatus}</span>
        <h3 style="font-size: 18px; font-weight: 800; margin-top: 6px;">${c.propertyName} (${c.city})</h3>
        <p style="font-size: 12.5px; color: var(--admin-text-muted);">Claim ID: ${c.id} • Started: ${c.startedDate}</p>
      </div>

      <div style="background: var(--admin-bg); padding: 14px; border-radius: 8px; margin-bottom: 20px; font-size: 13px;">
        <div><strong>Claimant:</strong> ${c.claimantName} (${c.email})</div>
        <div><strong>Masked Phone Number:</strong> <span class="phone-masked">${c.phoneMasked}</span></div>
        <div><strong>Phone Verification Match:</strong> <span class="badge ${c.phoneMatchStatus === 'Verified' ? 'badge-success' : 'badge-warning'}">${c.phoneMatchStatus}</span></div>
      </div>

      <h4 style="font-size: 14px; font-weight: 700; margin-bottom: 12px;">Verification timeline</h4>
      <div class="claim-timeline">
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-time">${fmt(c.startedDate)}</div>
          <div class="timeline-title">Claim initiated</div>
          <div class="timeline-desc">${c.claimantName} selected ${c.propertyName}.</div>
        </div>
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-time">${fmt(c.startedDate)}</div>
          <div class="timeline-title">Email verified</div>
          <div class="timeline-desc">One-time code confirmed for ${c.email}.</div>
        </div>
        ${c.completedDate ? `
          <div class="timeline-item">
            <div class="timeline-dot"></div>
            <div class="timeline-time">${fmt(c.completedDate)}</div>
            <div class="timeline-title">Claim approved</div>
            <div class="timeline-desc">Listing transferred to the partner account.</div>
          </div>` : ''}
      </div>

      ${c.claimStatus === 'Pending' ? `
        <div style="display:flex; gap:10px; margin-top:20px;">
          <button class="btn-primary" onclick="approveClaim('${c.propertyId}')">Approve claim</button>
          <button class="btn-secondary" onclick="rejectClaim('${c.propertyId}')">Reject claim</button>
        </div>` : ''}
    `;

    modal.classList.add('show');
  };

  window.approveClaim = function (propertyId) {
    data.approveClaim(propertyId).then(() => {
      showToast('Claim approved — the partner has been emailed.');
      closeModal('claimModal');
      closeModal('propertyModal');
      return reload();
    }).catch(fail);
  };

  window.rejectClaim = function (propertyId) {
    if (!window.confirm('Reject this claim and detach the listing from the account?')) return;
    data.rejectClaim(propertyId).then(() => {
      showToast('Claim rejected.', 'warning');
      closeModal('claimModal');
      return reload();
    }).catch(fail);
  };

  window.toggleListingActive = function (propertyId, active) {
    data.updateProperty(propertyId, { active: active }).then(() => {
      showToast(active ? 'Listing published.' : 'Listing hidden.');
      closeModal('propertyModal');
      return reload();
    }).catch(fail);
  };

  window.setOwnerStatus = function (userId, status) {
    data.updateUserStatus(userId, status).then(() => {
      showToast('Owner account is now ' + status + '.');
      closeModal('ownerModal');
      return reload();
    }).catch(fail);
  };

  // IMPORT LISTINGS WORKFLOW LOGIC
  window.handleCsvFile = function (file) {
    if (!file) return;
    showToast('Reading ' + file.name + '…');
    const reader = new FileReader();
    reader.onload = function () {
      const parsed = data.parseCsv(String(reader.result));
      if (!parsed.records.length) return showToast('No usable rows found in that CSV.', 'danger');

      data.analyseImport(file, parsed);
      data.dryRunImport().then(() => {
        renderImportSummary();
        renderImportCalculators();
        renderImportDuplicatesTable();
        renderColumnMapperTable();
        goToImportStep(2);
        showToast(`${file.name}: ${data.importSession.totalRows.toLocaleString('en-IN')} rows read, ` +
                  `${data.importSession.newListings.toLocaleString('en-IN')} new.`);
      }).catch(fail);
    };
    reader.readAsText(file);
  };

  /** Recomputes the import screen's headline numbers from the parsed file. */
  function renderImportCalculators() {
    const sess = data.importSession;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const complete = sess.totalRows
      ? (((sess.totalRows - sess.invalidRows - sess.missingPhone) / sess.totalRows) * 100).toFixed(1) + '%'
      : '—';
    set('calcFilteredRows', (sess.newListings || sess.totalRows || 0).toLocaleString('en-IN'));
    set('calcCompleteness', complete);
    // Every new listing is a free listing that can convert to Starter (₹999/mo).
    set('calcPotentialMRR', '₹' + ((sess.newListings || 0) * 999).toLocaleString('en-IN'));
  }

  /** Fills whichever import summary counters exist on the page. */
  function renderImportSummary() {
    const sess = data.importSession;
    const map = {
      importFileName: sess.filename,
      importFileSize: sess.fileSize,
      importTotalRows: (sess.totalRows || 0).toLocaleString('en-IN'),
      importValidRows: (sess.validRows || 0).toLocaleString('en-IN'),
      importDuplicateRows: (sess.duplicateRows || 0).toLocaleString('en-IN'),
      importNewListings: (sess.newListings || 0).toLocaleString('en-IN'),
      importExistingListings: (sess.existingListings || 0).toLocaleString('en-IN'),
      importInvalidRows: (sess.invalidRows || 0).toLocaleString('en-IN'),
      importMissingPhone: (sess.missingPhone || 0).toLocaleString('en-IN'),
      importCitiesDetected: (sess.citiesDetected || 0).toLocaleString('en-IN'),
      importAnalysisFile: sess.filename || 'no file selected',
      // The visible "CSV Analysis Dashboard" cards — same numbers, ids the
      // markup there actually uses.
      kpiTotalRows: (sess.totalRows || 0).toLocaleString('en-IN'),
      kpiValidListings: (sess.validRows || 0).toLocaleString('en-IN'),
      kpiMissingPhone: (sess.missingPhone || 0).toLocaleString('en-IN'),
      kpiDuplicateRows: (sess.duplicateRows || 0).toLocaleString('en-IN'),
      kpiInvalidRows: (sess.invalidRows || 0).toLocaleString('en-IN'),
      kpiExisting: (sess.existingListings || 0).toLocaleString('en-IN'),
      kpiNewListings: (sess.newListings || 0).toLocaleString('en-IN'),
      kpiCitiesCount: (sess.citiesDetected || 0).toLocaleString('en-IN'),
      optHasPhone: 'With Phone Number (' + Math.max(0, (sess.totalRows || 0) - (sess.missingPhone || 0)).toLocaleString('en-IN') + ')',
      optMissingPhone: 'Missing Phone (' + (sess.missingPhone || 0).toLocaleString('en-IN') + ')'
    };
    Object.keys(map).forEach((id) => {
      const el = document.getElementById(id);
      if (el && map[id] != null) el.textContent = map[id];
    });
  }

  window.goToImportStep = function (stepNum) {
    currentImportStep = stepNum;

    // Update Pills
    for (let i = 1; i <= 6; i++) {
      const pill = document.getElementById(`pill${i}`);
      if (!pill) continue;
      if (i < stepNum) { pill.className = 'import-step-pill completed'; }
      else if (i === stepNum) { pill.className = 'import-step-pill active'; }
      else { pill.className = 'import-step-pill'; }
    }

    // Show Content
    for (let i = 1; i <= 6; i++) {
      const content = document.getElementById(`importStep${i}`);
      if (content) {
        content.style.display = (i === stepNum) ? 'block' : 'none';
      }
    }

    // Trigger Charts if Step 2
    if (stepNum === 2) {
      setTimeout(() => {
        renderCsvQualityDonutChart();
        renderCsvCitiesBarChart();
        renderCsvRatingBarChart();
      }, 50);
    }
    if (stepNum === 5) renderImportPreview();
  };

  /** Fills the "Final Import Preview" tiles from the real dry-run counts. */
  function renderImportPreview() {
    const sess = data.importSession;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('previewWillImport', (sess.newListings || 0).toLocaleString('en-IN') + ' Properties');
    const skip = (sess.duplicateRows || 0) + (sess.invalidRows || 0);
    set('previewWillSkip', skip.toLocaleString('en-IN') + ' Records');
    set('previewExcludedCities', (sess.excludedCitiesRows || 0).toLocaleString('en-IN') + ' Records');
  }

  // SVG Chart 1: Record Quality Donut Chart
  function renderCsvQualityDonutChart() {
    const container = document.getElementById('csvQualityDonutChart');
    if (!container) return;
    const items = data.importSession.qualityBreakdown;

    let svg = `<svg width="100%" height="100%" viewBox="0 0 440 220">
      <g transform="translate(110, 110)">
        <!-- Donut Slices -->
        <path d="M 0,-85 A 85,85 0 1,1 -78,34" fill="none" stroke="#2563EB" stroke-width="28" />
        <path d="M -78,34 A 85,85 0 0,1 -84,-12" fill="none" stroke="#64748B" stroke-width="28" />
        <path d="M -84,-12 A 85,85 0 0,1 -68,-51" fill="none" stroke="#F59E0B" stroke-width="28" />
        <path d="M -68,-51 A 85,85 0 0,1 -42,-74" fill="none" stroke="#3B82F6" stroke-width="28" />
        <path d="M -42,-74 A 85,85 0 0,1 0,-85" fill="none" stroke="#EF4444" stroke-width="28" />
        <text x="0" y="6" text-anchor="middle" font-size="18" font-weight="800" fill="#0F172A">${(data.importSession.totalRows || 0).toLocaleString('en-IN')}</text>
        <text x="0" y="24" text-anchor="middle" font-size="11" fill="#64748B" font-weight="600">Total Rows</text>
      </g>
      <!-- Legend -->
      <g transform="translate(240, 30)">
        ${items.slice(0, 5).map((item, i) => `
          <g transform="translate(0, ${i * 34})">
            <rect x="0" y="0" width="12" height="12" rx="3" fill="${item.color}" />
            <text x="20" y="10" font-size="12" font-weight="700" fill="#0F172A">${item.label}</text>
            <text x="20" y="24" font-size="11" fill="#64748B">${item.count.toLocaleString('en-IN')} (${item.percentage})</text>
          </g>
        `).join('')}
      </g>
    </svg>`;

    container.innerHTML = svg;
  }

  // SVG Chart 2: Top Cities Bar Chart
  function renderCsvCitiesBarChart() {
    const container = document.getElementById('csvCitiesBarChart');
    if (!container) return;
    const cities = data.importSession.cityAnalysis.slice(0, 5);

    const maxRecords = 2000;
    const width = container.clientWidth || 400;

    let svg = `<svg width="100%" height="100%" viewBox="0 0 ${width} 220">
      ${cities.map((c, i) => {
        const y = 20 + i * 40;
        const barW = Math.floor((c.records / maxRecords) * (width - 120));
        return `
          <text x="0" y="${y + 14}" font-size="12" font-weight="700" fill="#0F172A">${c.city}</text>
          <rect x="80" y="${y}" width="${barW}" height="20" rx="4" fill="#2563EB" />
          <text x="${85 + barW}" y="${y + 14}" font-size="11" font-weight="700" fill="#64748B">${c.records.toLocaleString('en-IN')}</text>
        `;
      }).join('')}
    </svg>`;

    container.innerHTML = svg;
  }

  // SVG Chart 3: Rating Distribution Vertical Bar Chart
  function renderCsvRatingBarChart() {
    const container = document.getElementById('csvRatingBarChart');
    if (!container) return;
    const ratings = data.importSession.ratingDistribution;

    const width = container.clientWidth || 600;
    const height = 180;
    const maxCount = 6000;

    let svg = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}">
      ${ratings.map((r, i) => {
        const barW = 80;
        const x = 50 + i * (width / ratings.length);
        const barH = (r.count / maxCount) * 120;
        const y = 140 - barH;
        return `
          <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="6" fill="#3B82F6" />
          <text x="${x + barW / 2}" y="${y - 8}" text-anchor="middle" font-size="12" font-weight="800" fill="#0F172A">${r.count.toLocaleString('en-IN')}</text>
          <text x="${x + barW / 2}" y="160" text-anchor="middle" font-size="11" font-weight="700" fill="#64748B">${r.rating}</text>
        `;
      }).join('')}
    </svg>`;

    container.innerHTML = svg;
  }

  // Flexible Data Filter Handlers
  window.applyFlexibleCsvFilters = function () {
    const phoneFilter = document.getElementById('csvPhoneFilter').value;
    const ratingFilter = document.getElementById('csvRatingFilter').value;
    const dupeFilter = document.getElementById('csvDupeFilter').value;

    let rows = 12540;
    let completeness = 94.8;
    let mrrLakhs = 49.2;
    let avgRatingVal = 4.38;

    if (phoneFilter === 'has_phone') rows = 12124;
    if (phoneFilter === 'missing_phone') { rows = 416; completeness = 72.1; mrrLakhs = 1.6; }

    if (ratingFilter === '4.5') { rows = Math.round(rows * 0.35); avgRatingVal = 4.75; mrrLakhs = Math.round(mrrLakhs * 0.45 * 10) / 10; }
    if (ratingFilter === '4.0') { rows = Math.round(rows * 0.75); avgRatingVal = 4.42; }

    if (dupeFilter === 'exact_only') { rows = 183; completeness = 100.0; }
    if (dupeFilter === 'possible_only') { rows = 247; completeness = 88.4; }
    if (dupeFilter === 'new_only') { rows = 9842; mrrLakhs = 42.1; }

    document.getElementById('calcFilteredRows').textContent = rows.toLocaleString('en-IN');
    document.getElementById('calcCompleteness').textContent = `${completeness}%`;
    document.getElementById('calcPotentialMRR').textContent = `₹${mrrLakhs} Lakhs`;
    document.getElementById('calcAvgRating').textContent = `${avgRatingVal} ★`;

    showToast(`Flexible filters applied: ${rows.toLocaleString('en-IN')} rows matching query`);
  };

  window.resetFlexibleCsvFilters = function () {
    document.getElementById('csvPhoneFilter').value = 'all';
    document.getElementById('csvRatingFilter').value = 'all';
    document.getElementById('csvDupeFilter').value = 'all';

    document.getElementById('calcFilteredRows').textContent = '12,540';
    document.getElementById('calcCompleteness').textContent = '94.8%';
    document.getElementById('calcPotentialMRR').textContent = '₹49.2 Lakhs';
    document.getElementById('calcAvgRating').textContent = '4.38 ★';

    showToast('Analytics filters reset to default dataset');
  };

  function renderImportDuplicatesTable() {
    const tbody = document.getElementById('duplicateTableBody');
    if (!tbody) return;

    tbody.innerHTML = data.importSession.duplicatesSample.map(d => `
      <tr>
        <td style="font-weight: 700;">${d.importedName}</td>
        <td>${d.existingName}</td>
        <td>${d.city}</td>
        <td><span class="phone-masked">${d.importedPhone}</span></td>
        <td><span class="phone-masked">${d.existingPhone}</span></td>
        <td><span class="badge ${d.matchType === 'Exact' ? 'badge-danger' : 'badge-warning'}">${d.matchType}</span></td>
        <td>
          <button class="btn-secondary" style="padding: 4px 8px; font-size: 11.5px;" onclick="showToast('Duplicate rule applied: ${d.action}');">${d.action}</button>
        </td>
      </tr>
    `).join('');
  }

  /** The real, persisted list — same string Settings → "Cities excluded from
   * CSV import" reads and writes, so this chip view is never out of sync
   * with what a fresh import will actually apply. */
  function excludedCitiesList() {
    return String((data.settings || {}).excludedCities || '')
      .split(',').map(c => c.trim()).filter(Boolean);
  }

  function renderCityChips() {
    const container = document.getElementById('cityChipsContainer');
    if (!container) return;
    const list = excludedCitiesList();

    container.innerHTML = list.length ? list.map(city => `
      <div class="chip">
        <span>${city}</span>
        <span class="chip-remove" onclick="removeExcludedCity('${city.replace(/'/g, "\\'")}')">×</span>
      </div>
    `).join('') : '<span style="font-size:12.5px;color:var(--admin-text-muted);">No cities excluded — every city is importable.</span>';
  }

  window.removeExcludedCity = function (city) {
    const next = excludedCitiesList().filter(c => c !== city).join(', ');
    data.saveSettings({ excludedCities: next }).then(() => {
      renderCityChips();
      showToast(`Removed ${city} from exclusion list.`);
    }).catch(fail);
  };

  function renderColumnMapperTable() {
    const tbody = document.getElementById('columnMapperBody');
    if (!tbody) return;

    tbody.innerHTML = data.importSession.columnMapping.map(m => `
      <tr>
        <td style="font-weight: 700;">${m.field}</td>
        <td>
          <select class="filter-select">
            <option selected>${m.csvHeader}</option>
            <option>property_name</option>
            <option>city_name</option>
            <option>contact_number</option>
          </select>
        </td>
        <td><span class="badge badge-success">Mapped</span></td>
      </tr>
    `).join('');
  }

  window.openImportConfirmModal = function () {
    const sess = data.importSession;
    const newCount = sess.newListings || 0;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('confirmNewCount', newCount.toLocaleString('en-IN') + ' new properties');
    const checklist = document.getElementById('confirmChecklist');
    if (checklist) {
      checklist.innerHTML = [
        `✓ ${newCount.toLocaleString('en-IN')} New listings will be created`,
        `✓ ${(sess.existingListings || 0).toLocaleString('en-IN')} Existing listings skipped`,
        `✓ ${(sess.invalidRows || 0).toLocaleString('en-IN')} Invalid rows excluded`,
        `✓ ${(sess.excludedCitiesRows || 0).toLocaleString('en-IN')} Listings from excluded cities skipped`
      ].join('<br/>');
    }
    document.getElementById('importConfirmModal').classList.add('show');
  };

  window.startLiveImport = function () {
    closeModal('importConfirmModal');
    goToImportStep(6);

    const progressFill = document.getElementById('importProgressBar');
    const pctText = document.getElementById('progressPctText');
    const stageText = document.getElementById('progressStageText');
    const progressBox = document.getElementById('importProgressBox');
    const completeBox = document.getElementById('importCompleteBox');

    if (progressBox) progressBox.style.display = 'block';
    if (completeBox) completeBox.style.display = 'none';

    const setProgress = (pct, stage) => {
      if (progressFill) progressFill.style.width = pct + '%';
      if (pctText) pctText.textContent = pct + '%';
      if (stageText) stageText.textContent = stage;
    };

    setProgress(15, `Uploading ${data.importSession.totalRows.toLocaleString('en-IN')} rows…`);

    data.commitImport((done, total) => {
      const pct = Math.max(15, Math.round((done / total) * 95));
      setProgress(pct, `Imported ${done.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} rows…`);
    }).then((res) => {
      setProgress(100, 'Import finished.');
      setTimeout(() => {
        if (progressBox) progressBox.style.display = 'none';
        if (completeBox) completeBox.style.display = 'block';
        const line = document.getElementById('importCompleteLine');
        if (line) {
          line.textContent = `${res.summary.imported.toLocaleString('en-IN')} listings imported from ` +
            `${data.importSession.filename} — ${res.summary.duplicates.toLocaleString('en-IN')} duplicates skipped.`;
        }
        showToast(`Imported ${res.summary.imported.toLocaleString('en-IN')} listings ` +
                  `(${res.summary.duplicates.toLocaleString('en-IN')} duplicates skipped). ` +
                  `Catalogue now holds ${res.totalProperties.toLocaleString('en-IN')}.`);
        reload();
      }, 400);
    }).catch((err) => {
      setProgress(0, 'Import failed.');
      fail(err);
    });
  };

  function renderImportHistoryTable() {
    const tbody = document.getElementById('importHistoryTableBody');
    if (!tbody) return;

    const n = (v) => typeof v === 'number' ? v.toLocaleString('en-IN') : (v == null ? '—' : v);
    tbody.innerHTML = data.importHistory.map(h => `
      <tr>
        <td><code style="font-weight:700;">${h.importId}</code></td>
        <td style="font-weight:700;">${h.filename}</td>
        <td>${fmt(h.date)}</td>
        <td>${n(h.rows)}</td>
        <td style="font-weight:700; color: #10B981;">${n(h.imported)}</td>
        <td>${n(h.skipped)}</td>
        <td>${n(h.duplicates)}</td>
        <td><span class="badge badge-success">${h.status}</span></td>
        <td>${h.admin}</td>
        <td><button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="showImportReport('${h.importId}')">Report</button></td>
      </tr>
    `).join('');
  }

  window.showImportReport = function (importId) {
    const h = data.importHistory.find((x) => x.importId === importId);
    if (!h) return;
    const n = (v) => typeof v === 'number' ? v.toLocaleString('en-IN') : (v == null ? '—' : v);
    window.alert(
      `Import ${h.importId}\n${h.filename}\n${fmt(h.date)} · by ${h.admin}\n\n` +
      `Total rows: ${n(h.rows)}\nImported: ${n(h.imported)}\nSkipped (invalid): ${n(h.skipped)}\n` +
      `Duplicates: ${n(h.duplicates)}\nExcluded-city rows: ${n(h.excludedCities)}`
    );
  };

  // Other Tables
  function renderOwnersTable() {
    const tbody = document.getElementById('ownersTableBody');
    if (!tbody) return;
    tbody.innerHTML = data.owners.map(o => `
      <tr>
        <td style="font-weight: 700;">${o.name}</td>
        <td>${o.company}</td>
        <td>${o.propertiesCount} Properties</td>
        <td><span class="badge ${o.verified ? 'badge-success' : 'badge-warning'}">${o.verified ? 'Verified' : 'Pending'}</span></td>
        <td><span class="plan-tag ${String(o.subscription || 'free').toLowerCase()}">${o.subscription}</span></td>
        <td style="font-weight: 600;">${o.email}</td>
        <td>${fmt(o.joinedDate)}</td>
        <td><span class="badge ${o.status === 'Active' ? 'badge-success' : 'badge-warning'}">${o.status}</span></td>
        <td><button class="btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="openOwnerModal('${o.id}')">Profile</button></td>
      </tr>
    `).join('');
  }

  window.openOwnerModal = function (id) {
    const o = data.owners.find(x => x.id === id) || data.owners[0];
    const modal = document.getElementById('ownerModal');
    const body = document.getElementById('ownerModalBody');
    if (!modal || !body) return;
    body.innerHTML = `
      <h2 style="font-size:18px; font-weight:800;">${o.name}</h2>
      <p style="color:var(--admin-text-muted); font-size:13px;">${o.company} • ${o.email} • <span class="phone-masked">${o.phoneMasked}</span></p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin:18px 0;">
        <div style="background:var(--admin-bg); padding:12px; border-radius:8px;">
          <div style="font-size:12px; color:var(--admin-text-muted); font-weight:700;">PROPERTIES</div>
          <div style="font-size:18px; font-weight:800;">${o.propertiesCount}</div>
        </div>
        <div style="background:var(--admin-bg); padding:12px; border-radius:8px;">
          <div style="font-size:12px; color:var(--admin-text-muted); font-weight:700;">LAST ACTIVE</div>
          <div style="font-size:14px; font-weight:700;">${fmt(o.lastActive)}</div>
        </div>
      </div>
      <div style="display:flex; gap:10px;">
        ${o.status === 'Suspended'
          ? `<button class="btn-primary" onclick="setOwnerStatus('${o.id}', 'active')">Reactivate account</button>`
          : `<button class="btn-secondary" onclick="setOwnerStatus('${o.id}', 'suspended')">Suspend account</button>`}
      </div>`;
    modal.classList.add('show');
  };

  function renderSubscriptionsTable() {
    const tbody = document.getElementById('subscriptionsTableBody');
    if (!tbody) return;
    tbody.innerHTML = data.subscriptions.map(s => `
      <tr>
        <td style="font-weight: 700;">${s.hotel}</td>
        <td>${s.owner || 'Unclaimed'}</td>
        <td><span class="plan-tag ${String(s.plan || 'free').toLowerCase()}">${s.plan}</span></td>
        <td style="font-weight: 600;">${s.amount}</td>
        <td>${s.billingCycle}</td>
        <td>${fmt(s.lastChanged) || '—'}</td>
        <td>${s.renewalDate || '—'}</td>
        <td><span class="badge badge-success">${s.status}</span></td>
        <td><span class="badge badge-success">${s.paymentStatus}</span></td>
      </tr>
    `).join('');
  }

  function renderPlansGrid() {
    const grid = document.getElementById('plansGrid');
    if (!grid) return;
    grid.innerHTML = data.plans.map(p => `
      <div class="plan-card ${p.id === 'professional' ? 'featured' : ''}">
        <div class="plan-title">${p.name}</div>
        <div class="plan-price">₹${p.price.toLocaleString('en-IN')} <span>/${p.period}</span></div>
        <ul class="plan-features-list">${p.features.map(f => `<li>✓ ${f}</li>`).join('')}</ul>
        <button class="btn-secondary" style="width:100%; margin-top:12px;" onclick="openPlanEditModal('${p.id}')">Edit plan</button>
      </div>
    `).join('');
  }

  window.openPlanEditModal = function (planId) {
    const p = (data.plans || []).find(x => x.id === planId);
    if (!p) return;
    document.getElementById('planEditTitle').textContent = 'Edit ' + p.name;
    document.getElementById('planEditName').value = p.name;
    document.getElementById('planEditPrice').value = p.price;
    document.getElementById('planEditPeriod').value = p.period;
    document.getElementById('planEditFeatures').value = (p.features || []).join('\n');
    document.getElementById('planEditModal').dataset.planId = planId;
    document.getElementById('planEditModal').classList.add('show');
  };

  var planSaving = false;
  window.savePlanEdit = function () {
    if (planSaving) return;
    const planId = document.getElementById('planEditModal').dataset.planId;
    const name = document.getElementById('planEditName').value.trim();
    const price = Number(document.getElementById('planEditPrice').value);
    const period = document.getElementById('planEditPeriod').value.trim();
    const features = document.getElementById('planEditFeatures').value.split('\n').map(f => f.trim()).filter(Boolean);
    if (!name) return showToast('Enter a plan name.', 'warning');
    if (isNaN(price) || price < 0) return showToast('Enter a valid price.', 'warning');
    if (!period) return showToast('Enter a billing period.', 'warning');

    const btn = document.getElementById('planEditSaveBtn');
    planSaving = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    data.updatePlan(planId, { name, price, period, features }).then(() => {
      showToast('Plan updated — live everywhere it\'s priced (owner upgrade cards, revenue chart).');
      window.closeModal('planEditModal');
      renderPlansGrid();
      renderRevenueChart();
    }).catch(err => showToast(err.message || 'Could not save that plan.', 'danger'))
      .then(() => {
        planSaving = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Save plan →'; }
      });
  };

  function renderRevenueView() { renderRevenueChart(); }
  /** Revenue by plan, drawn from live subscriptions. */
  function renderRevenueChart() {
    const container = document.getElementById('revenueChart');
    if (!container) return;

    const plans = (data.plans || []).filter(p => p.price > 0);
    const stats = data.revenueStats || {};
    const maxSubs = Math.max(1, ...plans.map(p => p.subscribers || 0));

    const bars = plans.map(p => {
      const width = Math.round(((p.subscribers || 0) / maxSubs) * 100);
      return `
        <div style="margin-bottom:14px;">
          <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:4px;">
            <span style="font-weight:700;">${p.name}</span>
            <span style="color:var(--admin-text-muted);">${p.subscribers || 0} × ₹${p.price.toLocaleString('en-IN')} = ${p.mrr}</span>
          </div>
          <div style="background:#E2E8F0; border-radius:6px; height:10px; overflow:hidden;">
            <div style="width:${width}%; height:100%; background:var(--admin-primary);"></div>
          </div>
        </div>`;
    }).join('');

    container.innerHTML = `
      <div style="display:flex; gap:24px; flex-wrap:wrap; margin-bottom:20px;">
        <div><div style="font-size:11.5px; font-weight:700; color:var(--admin-text-muted);">MRR</div>
             <div style="font-size:20px; font-weight:800;">${stats.mrr || '₹0'}</div></div>
        <div><div style="font-size:11.5px; font-weight:700; color:var(--admin-text-muted);">COLLECTED THIS MONTH</div>
             <div style="font-size:20px; font-weight:800;">${stats.thisMonth || '₹0'}</div></div>
        <div><div style="font-size:11.5px; font-weight:700; color:var(--admin-text-muted);">TOTAL INVOICED</div>
             <div style="font-size:20px; font-weight:800;">${stats.totalRevenue || '₹0'}</div></div>
        <div><div style="font-size:11.5px; font-weight:700; color:var(--admin-text-muted);">ARPU</div>
             <div style="font-size:20px; font-weight:800;">${stats.arpu || '₹0'}</div></div>
      </div>
      ${bars || '<p style="font-size:13px; color:var(--admin-text-muted);">No paid subscriptions yet.</p>'}`;
  }

  function renderCityAnalyticsTable() {
    const tbody = document.getElementById('citiesTableBody');
    if (!tbody) return;
    tbody.innerHTML = data.cities.map(c => {
      const unclaimed = c.properties - c.claimed;
      const rate = c.properties ? Math.round((c.claimed / c.properties) * 100) : 0;
      return `<tr>
        <td style="font-weight:700;">${c.name || c.slug}</td>
        <td><code>${c.slug}</code></td>
        <td>${c.properties.toLocaleString('en-IN')}</td>
        <td>${c.claimed.toLocaleString('en-IN')}</td>
        <td>${unclaimed.toLocaleString('en-IN')}</td>
        <td><span class="badge ${rate > 25 ? 'badge-success' : 'badge-warning'}">${rate}%</span></td>
        <td><a class="btn-secondary" style="padding:4px 8px; font-size:11.5px; text-decoration:none;" target="_blank" rel="noopener" href="city.html?city=${encodeURIComponent(c.slug)}">View city page</a></td>
      </tr>`;
    }).join('');
  }

  function renderLeadsTable() {
    const tbody = document.getElementById('leadsTableBody');
    if (!tbody) return;
    tbody.innerHTML = data.leads.map(l => `
      <tr data-row-id="${l.id}">
        <td style="font-weight:700;">${l.leadName}<br/><span class="phone-masked">${l.phoneMasked}</span></td>
        <td>${l.hotel}</td>
        <td>${l.owner}</td>
        <td>${l.source}</td>
        <td>${fmt(l.date)}</td>
        <td><span class="badge badge-info">${l.status}</span></td>
      </tr>`).join('') + data.marketingLeads.map(l => `
      <tr data-row-id="${l.id}">
        <td style="font-weight:700;">${l.name}<br/><span class="phone-masked">${l.phone || '—'}</span></td>
        <td>${l.hotel || '—'}${l.city ? ' <span style="color:var(--admin-text-muted);font-size:11.5px;">(' + l.city + ')</span>' : ''} ${l.plan ? '<span class="badge badge-info">' + l.plan + '</span>' : ''}</td>
        <td>—</td>
        <td>${l.source || 'marketing'}</td>
        <td>${fmt(l.date)}</td>
        <td>
          <select onchange="updateMarketingLead('${l.id}', this.value)" style="padding:4px 6px; border-radius:6px; border:1px solid var(--admin-border); font-size:12px;">
            ${['New', 'Contacted', 'Qualified', 'Won', 'Lost'].map(st =>
              `<option value="${st}" ${st === l.status ? 'selected' : ''}>${st}</option>`).join('')}
          </select>
        </td>
      </tr>`).join('');
  }

  window.updateMarketingLead = function (id, status) {
    data.updateMarketingLead(id, { status: status }).then(() => {
      showToast('Lead marked ' + status + '.');
      return reload();
    }).catch(fail);
  };

  window.moderateReview = function (id, status) {
    data.moderateReview(id, status).then(() => {
      showToast('Review ' + status.toLowerCase() + '.');
      return reload();
    }).catch(fail);
  };

  function renderPaymentsTable() {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;

    const line = document.getElementById('paymentsModeLine');
    if (line) {
      const manual = (data.payments || []).some(p => p.provider === 'manual');
      line.textContent = manual
        ? 'Subscription and campaign payments. Manual entries are settled here once the transfer lands.'
        : 'Subscription and campaign payments, settled through the payment gateway.';
    }

    tbody.innerHTML = (data.payments || []).map(p => `
      <tr>
        <td><code style="font-weight:700;">${p.id}</code></td>
        <td>${p.hotelName || p.propertyId || '—'}${p.referenceId && p.referenceId !== p.propertyId ? `<br/><small style="color:var(--admin-text-muted);">${p.referenceId}</small>` : ''}</td>
        <td>${p.purpose}</td>
        <td style="font-weight:700;">₹${Number(p.amount).toLocaleString('en-IN')}</td>
        <td>${p.provider}</td>
        <td><span class="badge ${p.status === 'paid' ? 'badge-success' : p.status === 'failed' ? 'badge-danger' : 'badge-warning'}">${p.status}</span></td>
        <td>${fmt(p.createdAt)}</td>
        <td>${p.status === 'paid' ? '' : `<button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="markPaymentPaid('${p.id}')">Mark paid</button>`}</td>
      </tr>`).join('') || '<tr><td colspan="8" style="text-align:center; padding:24px; color:var(--admin-text-muted);">No payments yet.</td></tr>';
  }

  window.markPaymentPaid = function (id) {
    if (!window.confirm('Mark this payment as received? It activates the plan or campaign immediately.')) return;
    data.markPaymentPaid(id).then(() => {
      showToast('Payment settled — the customer has been emailed a receipt.');
      return reload();
    }).catch(fail);
  };

  function renderReviewsTable() {
    const tbody = document.getElementById('reviewsTableBody');
    if (!tbody) return;
    tbody.innerHTML = data.reviews.map(r => `
      <tr>
        <td style="font-weight:700;">${r.hotel}</td>
        <td>${r.reviewer}</td>
        <td>⭐ ${r.rating}</td>
        <td style="max-width:320px;">${r.comment || '—'}</td>
        <td>${fmt(r.date)}</td>
        <td><span class="badge ${r.status === 'Published' ? 'badge-success' : r.status === 'Rejected' ? 'badge-danger' : 'badge-warning'}">${r.status}</span></td>
        <td>
          ${r.status !== 'Published' ? `<button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="moderateReview('${r.id}', 'Published')">Publish</button>` : ''}
          ${r.status !== 'Rejected' ? `<button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="moderateReview('${r.id}', 'Rejected')">Reject</button>` : ''}
        </td>
      </tr>`).join('');
  }

  function renderActivityLogsTable() {
    const tbody = document.getElementById('activityTableBody');
    if (!tbody) return;
    tbody.innerHTML = data.activityLogs.map(a => `<tr><td>${fmt(a.timestamp)}</td><td style="font-weight:700;">${a.admin}</td><td><span class="badge badge-info">${a.action}</span></td><td>${a.target}</td><td><code>${a.ip}</code></td><td><span class="badge badge-success">${a.result}</span></td></tr>`).join('');
  }

  function renderAdminUsersTable() {
    const tbody = document.getElementById('adminUsersTableBody');
    if (!tbody) return;
    tbody.innerHTML = data.adminUsers.map(u => `<tr><td style="font-weight:700;">${u.name}</td><td>${u.email}</td><td><span class="badge badge-info">${u.role}</span></td><td>${fmt(u.lastActive)}</td><td><span class="badge ${u.status === 'Active' ? 'badge-success' : 'badge-warning'}">${u.status}</span></td>
      <td>
        <button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="resetUserPassword('${u.id}', '${u.email}')">Send reset link</button>
        ${u.id === (data.admin || {}).id ? '' : `<button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="setOwnerStatus('${u.id}', '${u.status === 'Active' ? 'suspended' : 'active'}')">${u.status === 'Active' ? 'Suspend' : 'Reactivate'}</button>`}
      </td></tr>`).join('');
  }

  function setupModals() {
    window.closeModal = function (modalId) {
      const el = document.getElementById(modalId);
      if (el) el.classList.remove('show');
    };

    document.querySelectorAll('.admin-modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('show');
      });
    });
  }

  // ADMIN MARKETING SYSTEM LOGIC
  let selectedAdminCampId = null;
  let selectedAdminPkgId = null;

  function renderAdminMarketingView() {
    renderAdminCampaignsTable();
    renderAdminPackagesGrid();
    renderAdminMktLeadsTable();
  }

  window.switchAdminMktTab = function (tabName) {
    const tabs = ['camps', 'pkgs', 'leads'];
    tabs.forEach(t => {
      const btn = document.getElementById(`admTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
      const sec = document.getElementById(`admMktTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
      if (btn) btn.className = (t === tabName) ? 'btn-secondary active-mkt-tab' : 'btn-secondary';
      if (sec) sec.style.display = (t === tabName) ? 'block' : 'none';
    });

    if (tabName === 'camps') renderAdminCampaignsTable();
    if (tabName === 'pkgs') renderAdminPackagesGrid();
    if (tabName === 'leads') renderAdminMktLeadsTable();
  };

  /** Shows whether campaigns are fulfilled by API or by the marketing team. */
  function renderIntegrationBanner() {
    const el = document.getElementById('admMktModeLine');
    if (!el || !data.integrations) return;
    const ads = data.integrations.ads || {};
    el.textContent = ads.mode === 'api'
      ? `Campaigns are pushed automatically (Meta: ${ads.meta.configured ? 'connected' : 'off'}, Google: ${ads.google.configured ? 'connected' : 'off'}). Metrics sync hourly.`
      : 'No ad account connected — paid campaigns wait here for the marketing team to run them manually.';
  }

  function renderAdminCampaignsTable() {
    renderIntegrationBanner();
    const tbody = document.getElementById('adminCampaignsTableBody');
    if (!tbody) return;
    const camps = window.HotelzzMarketingStore.getCampaigns();

    // Update Admin KPIs
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('admTotalCamps', camps.length);
    set('admActiveCamps', camps.filter(c => c.campaignStatus === 'Active').length);
    const revTotal = camps.reduce((sum, c) => sum + (c.total || 0), 0);
    set('admMktRev', `₹${revTotal.toLocaleString('en-IN')}`);
    const leadsTotal = camps.reduce((sum, c) => sum + (c.leads || 0), 0);
    const spendTotal = camps.reduce((sum, c) => sum + (c.spend || 0), 0);
    set('admMktLeads', leadsTotal.toLocaleString('en-IN'));
    set('admCostPerLead', leadsTotal ? `₹${Math.round(spendTotal / leadsTotal).toLocaleString('en-IN')}` : '—');

    tbody.innerHTML = camps.map(c => `
      <tr>
        <td style="font-weight:700;">${c.id}</td>
        <td><strong>${c.propertyName}</strong></td>
        <td>${c.propertyCity}</td>
        <td>${c.packageName}</td>
        <td>${c.duration}</td>
        <td style="font-weight:700; color:var(--admin-primary);">₹${c.total.toLocaleString('en-IN')}</td>
        <td><span class="badge badge-success">${c.paymentStatus}</span></td>
        <td><span class="badge ${c.campaignStatus === 'Active' ? 'badge-success' : 'badge-warning'}">${c.campaignStatus}</span></td>
        <td>
          <button class="btn-primary" style="padding:4px 8px; font-size:11.5px;" onclick="openAdminStatusModal('${c.id}')">Update Status</button>
        </td>
      </tr>
    `).join('');
  }

  window.openAdminStatusModal = function (campId) {
    selectedAdminCampId = campId;
    const camps = window.HotelzzMarketingStore.getCampaigns();
    const c = camps.find(x => x.id === campId);
    if (!c) return;

    document.getElementById('admModCampId').textContent = c.id;
    document.getElementById('admModHotelName').textContent = `${c.propertyName} (${c.propertyCity})`;
    document.getElementById('admModStatusSelect').value = c.campaignStatus;

    document.getElementById('adminStatusModal').classList.add('show');
  };

  window.saveAdminCampaignStatus = function () {
    if (!selectedAdminCampId) return;
    const newStatus = document.getElementById('admModStatusSelect').value;

    const note = (document.getElementById('admModNoteInput') || {}).value || '';
    window.HotelzzMarketingStore.updateCampaignStatus(selectedAdminCampId, newStatus, note)
      .then(() => {
        showToast(`Campaign ${selectedAdminCampId} set to ${newStatus} — the partner has been emailed.`);
        closeModal('adminStatusModal');
        renderAdminCampaignsTable();
      }).catch(fail);
  };

  function renderAdminPackagesGrid() {
    const container = document.getElementById('adminPackagesGrid');
    if (!container) return;
    const pkgs = window.HotelzzMarketingStore.getPackages();

    container.innerHTML = pkgs.map(p => `
      <div class="admin-card" style="display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          ${p.recommended ? '<span class="badge badge-warning" style="float:right;">RECOMMENDED</span>' : ''}
          <h3 style="font-size:18px; font-weight:800; margin-bottom:6px;">${p.name}</h3>
          <p style="font-size:12.5px; color:var(--admin-text-muted); margin-bottom:14px;">${p.description}</p>
          <div style="font-size:22px; font-weight:800; color:var(--admin-primary); margin-bottom:14px;">Starting ₹${p.startingPrice.toLocaleString('en-IN')}</div>
          
          <div style="font-size:12px; color:var(--admin-text-muted); background:var(--admin-bg); padding:10px; border-radius:6px; margin-bottom:16px;">
            <div>Est. Reach: <strong>${p.estimatedReach}</strong></div>
            <div>Est. Leads: <strong>${p.estimatedLeads}</strong></div>
            <div>Platforms: <strong>${p.platforms.join(', ')}</strong></div>
          </div>
        </div>

        <button class="btn-secondary" style="width:100%; text-align:center;" onclick="openAdminEditPkgModal('${p.id}')">Edit Package Pricing & Details</button>
      </div>
    `).join('');
  }

  window.openAdminEditPkgModal = function (pkgId) {
    selectedAdminPkgId = pkgId;
    const pkgs = window.HotelzzMarketingStore.getPackages();
    const p = pkgs.find(x => x.id === pkgId);
    if (!p) return;

    document.getElementById('admPkgFormName').value = p.name;
    document.getElementById('admPkgFormPrice').value = p.startingPrice;
    document.getElementById('admPkgFormDesc').value = p.description;
    document.getElementById('admPkgFormRec').checked = !!p.recommended;

    document.getElementById('adminEditPkgModal').classList.add('show');
  };

  window.saveAdminPackageForm = function () {
    if (!selectedAdminPkgId) return;

    const name = document.getElementById('admPkgFormName').value;
    const price = parseInt(document.getElementById('admPkgFormPrice').value) || 4999;
    const desc = document.getElementById('admPkgFormDesc').value;
    const rec = document.getElementById('admPkgFormRec').checked;

    window.HotelzzMarketingStore.updatePackage(selectedAdminPkgId, {
      name: name,
      startingPrice: price,
      description: desc,
      recommended: rec
    }).then(() => {
      showToast(`Updated package "${name}". Owner dashboards now show the new pricing.`);
      closeModal('adminEditPkgModal');
      renderAdminPackagesGrid();
    }).catch(fail);
  };

  function renderAdminMktLeadsTable() {
    const tbody = document.getElementById('adminMktLeadsTableBody');
    if (!tbody) return;
    const leads = window.HotelzzMarketingStore.getLeads();

    tbody.innerHTML = leads.map(l => `
      <tr>
        <td style="font-weight:700;">${l.id}</td>
        <td>${l.name}</td>
        <td>${l.phone || '—'}<br/><small style="color:var(--admin-text-muted);">${l.email || ''}</small></td>
        <td>${l.propertyName || l.propertyId}</td>
        <td>${fmt(l.date)}</td>
        <td><span class="badge badge-info">${l.source || 'website'}</span></td>
        <td><span class="badge badge-success">${l.status}</span></td>
      </tr>
    `).join('');
  }

})();

