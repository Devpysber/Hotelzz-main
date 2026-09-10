/**
 * Hotelzz Hotel Owner Dashboard — Main Application Script
 * Interactive state manager supporting multi-property switching, room editors, photo galleries, leads, reviews, offers, and subscriptions.
 */

(function () {
  const data = window.HotelzzOwnerData;
  let activePropId = null;
  let currentProp = null;
  let currentView = 'dashboard';

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

  // Init App
  document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupPdTabs();
    setupPerfRange();
    setupOwnerFilters();
    setupPropertySelector();
    setupTimeframeButtons();
    setupModals();

    Promise.all([data.load(), window.HotelzzMarketingStore.ready()]).then((out) => {
      const state = out[0];
      activePropId = state.activePropertyId;
      renderPropertySelectorList();
      if (!activePropId) {
        showToast('No property is linked to this account yet. Register or claim one first.', 'warning');
        return;
      }
      loadPropertyData(activePropId);
      handleUrlHash();
    }).catch((err) => {
      if (err.status === 401 || err.status === 403) {
        // A stale or invalid session cookie can otherwise survive the
        // redirect and reject the very next login attempt too, bouncing
        // the browser between here and login.html on repeat — clear it
        // first so the login form actually starts from a clean slate.
        const dest = 'login.html?type=owner&next=' +
          encodeURIComponent(window.location.pathname + window.location.hash);
        window.HotelzzAPI.auth.logout().catch(() => {}).then(() => { window.location.href = dest; });
        return;
      }
      fail(err);
    });
  });

  /** Fills the property switcher with the owner's real properties. */
  function renderPropertySelectorList() {
    const dropdown = document.getElementById('propertySelectorDropdown');
    if (!dropdown) return;
    const ids = Object.keys(data.properties);
    dropdown.innerHTML = ids.map((id) => {
      const p = data.properties[id];
      return `<div class="selector-item${id === activePropId ? ' selected' : ''}" onclick="switchProperty('${id}')">
                <div class="selector-item-title">${p.name}</div>
                <div class="selector-item-city">${p.city || ''} • ${p.claimedStatus}</div>
              </div>`;
    }).join('') || '<div style="padding:12px; font-size:12.5px;">No properties yet</div>';
  }

  window.hzLogout = function () {
    window.HotelzzAPI.auth.logout().then(() => { window.location.href = 'login.html?type=owner'; });
  };

  // URL Hash Handler
  const OWNER_VIEWS = [
    'dashboard', 'property-details', 'leads', 'reviews', 'offers',
    'grow-business', 'performance', 'visibility', 'subscription', 'billing'
  ];

  function handleUrlHash() {
    const hash = window.location.hash.replace('#', '');
    switchView(OWNER_VIEWS.includes(hash) ? hash : 'dashboard');
  }

  /* Without this the phone's back button changes the address bar while the
     visible view stays put. */
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (OWNER_VIEWS.includes(hash) && hash !== currentView) switchView(hash);
  });

  // View Switcher
  window.switchView = function (viewName) {
    currentView = viewName;
    window.location.hash = viewName;

    // Active nav class
    document.querySelectorAll('.owner-nav-item, .obar-item').forEach(el => {
      const match = el.getAttribute('data-view') === viewName;
      el.classList.toggle('active', match);
      if (el.classList.contains('obar-item')) {
        el.setAttribute('aria-current', match ? 'page' : 'false');
      }
    });

    // Active view container
    document.querySelectorAll('.owner-page-view').forEach(el => {
      if (el.id === `view-${viewName}`) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    // Close mobile drawer
    document.getElementById('sidebar').classList.remove('mobile-open');

    if (window.matchMedia('(max-width: 1024px)').matches) window.scrollTo({ top: 0 });

    // A detail drawer or modal left open would overlay — and block — the new view.
    document.querySelectorAll('[id$="Drawer"].open').forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.owner-modal-overlay.show').forEach(el => el.classList.remove('show'));

    // Trigger views
    if (viewName === 'dashboard' || viewName === 'performance') {
      setTimeout(() => renderPerformanceChart('30d'), 50);
    }
    if (viewName === 'grow-business') {
      renderGrowBusinessView();
    }
  };

  // Multi-Property Selector Logic
  function setupPropertySelector() {
    const btn = document.getElementById('propertySelectorBtn');
    const dropdown = document.getElementById('propertySelectorDropdown');
    if (!btn || !dropdown) return;

    btn.addEventListener('click', () => {
      dropdown.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('show');
      }
    });
  }

  window.switchProperty = function (propId) {
    if (!data.properties[propId]) return;
    activePropId = propId;
    data.activePropertyId = propId;
    currentProp = data.properties[propId];

    document.getElementById('propertySelectorDropdown').classList.remove('show');
    showToast(`Switched active property to ${currentProp.name}`);
    loadPropertyData(propId);
  };

  // Reload all UI components when property changes
  function loadPropertyData(propId) {
    const p = data.properties[propId];
    currentProp = p;

    // Header & Sidebar
    document.getElementById('headerPropNameDisplay').textContent = p.name;
    document.getElementById('sidebarPropName').textContent = p.name;
    document.getElementById('sidebarPropCity').textContent = `${p.city}, ${p.state}`;
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    document.getElementById('welcomeHeaderTitle').textContent = `${greeting}, ${data.ownerProfile.name} 👋`;

    const profName = document.getElementById('ownerProfileName');
    const profEmail = document.getElementById('ownerProfileEmail');
    if (profName) profName.textContent = data.ownerProfile.name;
    if (profEmail) profEmail.textContent = data.ownerProfile.email;
    document.getElementById('welcomePropName').textContent = p.name;

    // Status & Completeness Card
    document.getElementById('statusPropName').textContent = p.name;
    document.getElementById('statusPropCity').textContent = `${p.city}, ${p.state}`;
    document.getElementById('completenessPctText').textContent = `${p.completeness}% Complete`;
    document.getElementById('completenessProgressBar').style.width = `${p.completeness}%`;

    // KPI Cards — value + real 30-day-vs-prior-30-day growth (never a
    // fabricated percentage; the backend computes this from actual
    // property_stats rows).
    const setKpi = (valueId, growthId, value, growthText) => {
      const valueEl = document.getElementById(valueId);
      if (valueEl) valueEl.textContent = (value || 0).toLocaleString('en-IN');
      const growthEl = document.getElementById(growthId);
      if (growthEl) growthEl.textContent = growthText ? (growthText.startsWith('+') ? '↑ ' : growthText.startsWith('-') ? '↓ ' : '') + growthText + ' this month' : '—';
    };
    setKpi('kpiViews', 'kpiViewsGrowth', p.kpis.views, p.kpis.viewsGrowth);
    setKpi('kpiPhoneClicks', 'kpiPhoneClicksGrowth', p.kpis.phoneClicks, p.kpis.phoneClicksGrowth);
    document.getElementById('kpiLeads').textContent = (p.kpis.leads || 0).toLocaleString('en-IN');
    document.getElementById('kpiLeadsGrowth').textContent = p.kpis.leadsGrowth || '—';
    document.getElementById('kpiFavorites').textContent = (p.kpis.favorites || 0).toLocaleString('en-IN');
    document.getElementById('kpiFavoritesGrowth').textContent = p.kpis.favoritesGrowth != null
      ? p.kpis.favoritesGrowth + (p.kpis.favoritesGrowth === '0' ? ' saves' : ' total saves')
      : '—';

    // Populate Sub-views
    renderDashboardView();
    renderPropertyDetailsView();
    renderLeadsView();
    renderReviewsView();
    renderOffersView();
    renderVisibilityView();
    renderSubscriptionView();
    renderBillingView();
    renderActivityTimeline();
  }

  // Navigation Event Listeners
  function setupNavigation() {
    document.querySelectorAll('.owner-nav-item, .obar-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.getAttribute('data-view');
        if (view) switchView(view);
      });
    });

    const mobileBtn = document.getElementById('mobileToggleBtn');
    if (mobileBtn) {
      mobileBtn.addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('mobile-open');
      });
    }
  }

  function setupTimeframeButtons() {
    document.querySelectorAll('.tf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tf = btn.getAttribute('data-tf');
        renderPerformanceChart(tf);
      });
    });
  }

  // 1. Dashboard View Render
  function renderDashboardView() {
    renderPerformanceChart('30d');
  }

  // SVG Chart: Performance
  /* Performance used to draw a hardcoded polyline. It now reads the real
     series from /performance and falls back to an empty state. */
  let perfDays = 30;
  let perfSeries = null;

  function renderPerformanceChart(tf) {
    if (tf) {
      const parsed = parseInt(String(tf), 10);
      if (!isNaN(parsed)) perfDays = parsed;
    }
    if (!activePropId) return;

    data.performance(activePropId, perfDays)
      .then((res) => {
        perfSeries = res.series || [];
        paintPerformance();
      })
      .catch(() => {
        perfSeries = [];
        paintPerformance();
      });
  }

  function sum(list, key) {
    return list.reduce((n, r) => n + (Number(r[key]) || 0), 0);
  }

  function paintPerformance() {
    const series = perfSeries || [];
    const totals = {
      views: sum(series, 'views'),
      phone: sum(series, 'phoneClicks'),
      web: sum(series, 'websiteClicks'),
      leads: sum(series, 'leads')
    };

    const label = `Last ${perfDays} days`;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('perfViews', totals.views);
    set('perfPhone', totals.phone);
    set('perfWeb', totals.web);
    set('perfLeads', totals.leads);
    set('perfViewsSub', label);
    set('perfPhoneSub', label);
    set('perfWebSub', label);
    set('perfLeadsSub', label);

    const sub = document.getElementById('perfChartSub');
    if (sub) sub.textContent = `Daily listing views, last ${perfDays} days.`;

    paintPerformanceChart(series);
    paintPerformanceFunnel(totals);
  }

  function paintPerformanceChart(series) {
    // Dashboard and the Performance page each show the same curve.
    ['performanceChartContainer', 'perfChartContainer'].forEach((id) => {
      const container = document.getElementById(id);
      if (container) paintChartInto(container, series);
    });
  }

  function paintChartInto(container, series) {

    if (!series.length || !series.some((r) => Number(r.views) > 0)) {
      container.innerHTML = `
        <div class="perf-empty">
          <div class="perf-empty-icon">\u{1F4C8}</div>
          <div class="perf-empty-title">No views recorded yet</div>
          <p>Once travellers open your listing, daily views appear here.</p>
        </div>`;
      return;
    }

    const width = container.clientWidth || 640;
    const height = 240;
    const padL = 38;
    const padR = 14;
    const padT = 16;
    const padB = 30;

    const values = series.map((r) => Number(r.views) || 0);
    const peak = Math.max.apply(null, values) || 1;
    const stepX = series.length > 1 ? (width - padL - padR) / (series.length - 1) : 0;
    const x = (i) => padL + i * stepX;
    const y = (v) => padT + (height - padT - padB) * (1 - v / peak);

    const line = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    const area = `${x(0)},${height - padB} ${line} ${x(values.length - 1)},${height - padB}`;

    // Four gridlines keep the eye on magnitude without a full axis.
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const gy = padT + (height - padT - padB) * f;
      const val = Math.round(peak * (1 - f));
      return `<line x1="${padL}" y1="${gy}" x2="${width - padR}" y2="${gy}" stroke="#E2E8F0" stroke-width="1" />
              <text x="${padL - 8}" y="${gy + 4}" text-anchor="end" font-size="10" fill="#94A3B8">${val}</text>`;
    }).join('');

    // Label at most six dates so they never collide.
    const every = Math.ceil(series.length / 6);
    const ticks = series.map((r, i) => {
      if (i % every !== 0 && i !== series.length - 1) return '';
      const d = new Date(r.day);
      const txt = isNaN(d) ? r.day : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      return `<text x="${x(i)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#64748B" font-weight="600">${txt}</text>`;
    }).join('');

    const dots = values.map((v, i) =>
      `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="#2563EB"><title>${series[i].day}: ${v} views</title></circle>`
    ).join('');

    container.innerHTML = `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily listing views">
      ${grid}
      <polygon points="${area}" fill="rgba(37,99,235,0.12)" />
      <polyline points="${line}" fill="none" stroke="#2563EB" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${dots}
      ${ticks}
    </svg>`;
  }

  function paintPerformanceFunnel(totals) {
    const el = document.getElementById('perfFunnel');
    if (!el) return;

    const contacts = totals.phone + totals.web;
    const rate = totals.views ? Math.round((totals.leads / totals.views) * 1000) / 10 : 0;
    const steps = [
      { label: 'Listing views', value: totals.views },
      { label: 'Contact clicks', value: contacts },
      { label: 'Enquiries sent', value: totals.leads }
    ];
    const peak = Math.max(1, totals.views);

    el.innerHTML = steps.map((st) => `
      <div class="perf-funnel-row">
        <div class="perf-funnel-label">${st.label}</div>
        <div class="perf-funnel-track"><div class="perf-funnel-fill" style="width:${Math.max(2, (st.value / peak) * 100)}%"></div></div>
        <div class="perf-funnel-value">${st.value}</div>
      </div>`).join('')
      + `<div class="perf-funnel-note">${totals.views
            ? `${rate}% of viewers sent an enquiry.`
            : 'Conversion appears once your listing starts getting views.'}</div>`;
  }

  function setupPerfRange() {
    const wrap = document.getElementById('perfRange');
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.perf-range-btn');
      if (!btn) return;
      wrap.querySelectorAll('.perf-range-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderPerformanceChart(btn.getAttribute('data-days'));
    });
  }

  // 2. Property Details View Render — basics, photos and amenities in one page
  const MAX_LISTING_PHOTOS = 5;

  function renderPropertyDetailsView() {
    const p = currentProp;
    document.getElementById('editPropName').value = p.name || '';
    document.getElementById('editPropType').value = p.category || 'Hotel';
    document.getElementById('editPropDesc').value = p.description || '';
    document.getElementById('editPropPhone').value = p.phoneFull || p.phone || '';
    document.getElementById('editPropEmail').value = p.email || '';
    document.getElementById('editPropWebsite').value = p.website || '';
    document.getElementById('editPropAddress').value = p.address || '';
    document.getElementById('editPropCity').value = p.city || '';
    document.getElementById('editPropPincode').value = p.pincode || '';

    renderListingPhotos();
    renderAmenitiesView();
    updateDescCount();
    renderPdProgress();
  }

  function updateDescCount() {
    const box = document.getElementById('editPropDesc');
    const out = document.getElementById('pdDescCount');
    if (box && out) out.textContent = (box.value || '').length;
  }

  /* ------------------------------------------------------------- photos */

  /* Five slots, always drawn: filled ones show the photo, the next empty one
     is the upload button, the rest are placeholders. An owner can see at a
     glance how many they have left. */
  function renderListingPhotos() {
    const grid = document.getElementById('pdPhotoGrid');
    if (!grid) return;

    const photos = (currentProp.photos || []).slice(0, MAX_LISTING_PHOTOS);
    const counter = document.getElementById('pdPhotoCount');
    if (counter) counter.textContent = `${photos.length} / ${MAX_LISTING_PHOTOS}`;

    const cells = photos.map((ph, i) => `
      <div class="pd-photo ${ph.isCover || i === 0 ? 'is-cover' : ''}">
        <img src="${ph.url}" alt="${ph.title || 'Listing photo'}" loading="lazy" />
        ${ph.isCover || i === 0 ? '<span class="pd-photo-badge">Cover</span>' : ''}
        <div class="pd-photo-actions">
          ${ph.isCover || i === 0 ? '' : `<button type="button" class="pd-photo-btn" onclick="setCoverPhoto('${ph.id}')">Make cover</button>`}
          <button type="button" class="pd-photo-btn is-danger" onclick="deletePhoto('${ph.id}')">Remove</button>
        </div>
      </div>`);

    if (photos.length < MAX_LISTING_PHOTOS) {
      cells.push(`
        <button type="button" class="pd-photo pd-photo-add" onclick="openPhotoUpload()">
          <span class="pd-photo-add-icon">+</span>
          <span class="pd-photo-add-text">Add photo</span>
          <span class="pd-photo-add-sub">${MAX_LISTING_PHOTOS - photos.length} slot${MAX_LISTING_PHOTOS - photos.length === 1 ? '' : 's'} left</span>
        </button>`);
    }

    while (cells.length < MAX_LISTING_PHOTOS) {
      cells.push('<div class="pd-photo pd-photo-empty" aria-hidden="true"></div>');
    }

    grid.innerHTML = cells.join('');
  }

  window.setCoverPhoto = function (photoId) {
    data.setCoverPhoto(activePropId, photoId).then(() => {
      loadPropertyData(activePropId);
      showToast('Cover photo updated.');
    }).catch(fail);
  };

  window.deletePhoto = function (id) {
    data.deletePhoto(activePropId, id).then(() => {
      loadPropertyData(activePropId);
      showToast('Photo removed.');
    }).catch(fail);
  };

  window.openPhotoUpload = function () {
    if ((currentProp.photos || []).length >= MAX_LISTING_PHOTOS) {
      showToast(`Listings are limited to ${MAX_LISTING_PHOTOS} photos. Remove one first.`, 'warning');
      return;
    }
    const input = document.getElementById('ownerPhotoInput');
    if (input) input.click();
  };
  window.simulatePhotoUpload = window.openPhotoUpload;

  window.uploadSelectedPhotos = function (files) {
    if (!files || !files.length) return;
    const input = document.getElementById('ownerPhotoInput');
    const clear = () => { if (input) input.value = ''; };

    const room = MAX_LISTING_PHOTOS - (currentProp.photos || []).length;
    if (room <= 0) {
      showToast(`Listings are limited to ${MAX_LISTING_PHOTOS} photos. Remove one first.`, 'warning');
      clear();
      return;
    }

    // Picking six when one slot is free should upload the one, not fail.
    let list = Array.prototype.slice.call(files);
    if (list.length > room) {
      showToast(`Only ${room} slot${room === 1 ? '' : 's'} left — uploading the first ${room}.`, 'warning');
      list = list.slice(0, room);
    }

    showToast(`Uploading ${list.length} photo${list.length > 1 ? 's' : ''}\u2026`);
    data.uploadPhotos(activePropId, list, 'General')
      .then((res) => data.load().then(() => res))
      .then((res) => {
        loadPropertyData(activePropId);
        showToast(`${res.photos.length} photo${res.photos.length > 1 ? 's' : ''} added.`);
      })
      .catch(fail)
      .then(clear);
  };

  /* ----------------------------------------------------------- progress */

  /* The score is the server's to decide. shapeProperty defaults `category` to
     "Hotel" and falls back to the Google summary for `description`, so
     recomputing from the shaped property would read as complete when it is
     not. Consume the server's per-field breakdown instead. */
  const CHECK_LABELS = {
    name: 'Property name',
    category: 'Property category',
    description: 'Description',
    photos: 'At least one photo',
    cover: 'Cover image',
    amenities: 'Amenities',
    phone: 'Phone number',
    email: 'Contact email',
    website: 'Website',
    address: 'Street address',
    location: 'City',
    pincode: 'PIN code'
  };

  const CHECK_ORDER = [
    'name', 'category', 'description', 'photos', 'cover', 'amenities',
    'phone', 'email', 'website', 'address', 'location', 'pincode'
  ];

  function listingChecks() {
    const server = currentProp.visibilityChecks || {};
    return CHECK_ORDER.map((key) => ({
      key: key,
      label: CHECK_LABELS[key],
      ok: !!server[key]
    }));
  }

  function renderPdProgress() {
    const checks = listingChecks();
    // Same number the Visibility page shows, straight from the server.
    const pct = Number(currentProp.visibilityScore) || 0;

    const fill = document.getElementById('pdProgressFill');
    const out = document.getElementById('pdProgressPct');
    const hint = document.getElementById('pdProgressHint');
    const chips = document.getElementById('pdProgressChips');
    if (fill) fill.style.width = pct + '%';
    if (out) out.textContent = pct + '%';

    const missing = checks.filter((c) => !c.ok);
    if (hint) {
      hint.textContent = missing.length
        ? `${missing.length} field${missing.length === 1 ? '' : 's'} still empty.`
        : 'Your listing is complete.';
    }
    if (chips) {
      chips.innerHTML = missing.length
        ? missing.map((m) => `<span class="pd-progress-chip">${m.label}</span>`).join('')
        : '<span class="pd-progress-chip is-done">All done</span>';
    }

    const amenityOut = document.getElementById('pdAmenityCount');
    if (amenityOut) {
      const n = Object.values(currentProp.amenities || {})
        .reduce((t, l) => t + (Array.isArray(l) ? l.length : 0), 0);
      amenityOut.textContent = `${n} selected`;
    }
  }

  window.savePropertyDetails = function () {
    data.saveProperty(activePropId, {
      name: document.getElementById('editPropName').value,
      email: document.getElementById('editPropEmail').value,
      website: document.getElementById('editPropWebsite').value,
      address: document.getElementById('editPropAddress').value,
      city: document.getElementById('editPropCity').value,
      pincode: document.getElementById('editPropPincode').value,
      details: {
        category: document.getElementById('editPropType').value,
        description: document.getElementById('editPropDesc').value
      }
    })
      // Amenities live on their own endpoint, so one Save covers both.
      .then(() => data.saveAmenities(activePropId, currentProp.amenities))
      .then(() => {
        showToast('Listing saved.');
        loadPropertyData(activePropId);
      })
      .catch(fail);
  };

  // Section jump links on the Property Details page.
  function setupPdTabs() {
    const tabs = document.querySelectorAll('.pd-tab');
    if (!tabs.length) return;
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = document.getElementById(tab.getAttribute('data-pd-section'));
        if (!target) return;
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    const desc = document.getElementById('editPropDesc');
    if (desc) desc.addEventListener('input', updateDescCount);
  }

  // 4. Amenities View Render
  function renderAmenitiesView() {
    const p = currentProp;
    const categories = [
      { key: "general", title: "General Amenities", items: ["Free High-Speed Wi-Fi", "Air Conditioning", "Free Valet Parking", "24-hour Front Desk", "Elevator / Lift", "Power Backup"] },
      { key: "recreation", title: "Recreation & Wellness", items: ["Swimming Pool", "Fitness Gym & Spa", "Rooftop Lounge", "Garden Lounge"] },
      { key: "dining", title: "Food & Dining", items: ["Multi-cuisine Restaurant", "24h Room Service", "Coffee Shop & Bar", "Breakfast Included"] },
      { key: "business", title: "Business Facilities", items: ["Conference Hall", "High-speed Business Center", "Banquet Facilities"] }
    ];

    const container = document.getElementById('amenitiesCategoryContainer');
    if (!container) return;

    container.innerHTML = categories.map(cat => {
      const activeList = p.amenities[cat.key] || [];
      return `
        <div class="amenity-category-group">
          <div class="amenity-category-title">${cat.title}</div>
          <div class="amenity-chips-grid">
            ${cat.items.map(item => {
              const isSelected = activeList.includes(item);
              return `<div class="amenity-chip ${isSelected ? 'selected' : ''}" onclick="toggleAmenityChip(this, '${cat.key}', '${item}')">
                <span>${isSelected ? '✓' : '+'}</span>
                <span>${item}</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  window.toggleAmenityChip = function (el, catKey, item) {
    el.classList.toggle('selected');
    const isSel = el.classList.contains('selected');
    el.querySelector('span').textContent = isSel ? '✓' : '+';

    let list = currentProp.amenities[catKey] || [];
    if (isSel) {
      if (!list.includes(item)) list.push(item);
    } else {
      list = list.filter(x => x !== item);
    }
    currentProp.amenities[catKey] = list;
    renderPdProgress();
  };

  window.saveAmenities = function () {
    data.saveAmenities(activePropId, currentProp.amenities)
      .then(() => showToast('Amenities saved.'))
      .catch(fail);
  };

  // The amenities markup lives inside Property Details now, so give its
  // container the heading the standalone page used to provide.
  function amenitiesHeading() { return document.getElementById('amenitiesCategoryContainer'); }

  // 6. Leads View Render
  /* ---------------------------------------------------- shared page parts */

  /* Every list page used to render an empty <tbody> when there was nothing to
     show, which read as a broken page rather than an empty one. */
  function emptyState(opts) {
    return `
      <div class="owner-empty">
        <div class="owner-empty-icon">${opts.icon}</div>
        <div class="owner-empty-title">${opts.title}</div>
        <p class="owner-empty-text">${opts.text}</p>
        ${opts.action ? `<button class="btn-primary owner-empty-action" onclick="${opts.action.onclick}">${opts.action.label}</button>` : ''}
      </div>`;
  }

  function emptyRow(cols, opts) {
    return `<tr class="owner-empty-row"><td colspan="${cols}">${emptyState(opts)}</td></tr>`;
  }

  function statStrip(el, stats) {
    const node = typeof el === 'string' ? document.getElementById(el) : el;
    if (!node) return;
    node.innerHTML = stats.map((st) => `
      <div class="stat-tile${st.tone ? ' is-' + st.tone : ''}">
        <div class="stat-tile-label">${st.label}</div>
        <div class="stat-tile-value">${st.value}</div>
        ${st.sub ? `<div class="stat-tile-sub">${st.sub}</div>` : ''}
      </div>`).join('');
  }

  /* Segmented filters behave the same on all three pages. */
  function setupSegFilter(wrapId, attr, onPick) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      wrap.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      onPick(btn.getAttribute(attr));
    });
  }

  function setupOwnerFilters() {
    setupSegFilter('leadsFilter', 'data-lead-status', (v) => { leadStatusFilter = v; renderLeadsView(); });
    setupSegFilter('reviewsFilter', 'data-review-filter', (v) => { reviewFilter = v; renderReviewsView(); });
  }

  function csvCell(v) {
    const t = String(v == null ? '' : v).replace(/"/g, '""');
    return `"${t}"`;
  }

  /* Matches the admin panel's export, so an owner can pull their own rows. */
  window.exportOwnerCsv = function (kind) {
    let rows = [];
    if (kind === 'leads') {
      rows = [['Guest', 'Phone', 'Email', 'Enquiry', 'Received', 'Status']].concat(
        (currentProp.leads || []).map((l) => [l.guestName, l.phone, l.email, l.inquiry, l.date, l.status])
      );
    } else if (kind === 'offers') {
      rows = [['Offer', 'Discount', 'From', 'Until', 'Views', 'Clicks', 'Status']].concat(
        (currentProp.offers || []).map((o) => [o.title, o.discount, o.validFrom, o.validUntil, o.views, o.clicks, o.status])
      );
    }
    if (rows.length <= 1) {
      showToast('Nothing to export yet.', 'warning');
      return;
    }
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hotelzz-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  let leadStatusFilter = 'All';

  function renderLeadsView() {
    const tbody = document.getElementById('leadsTableBody');
    if (!tbody) return;

    const all = currentProp.leads || [];
    const responded = all.filter((l) => l.status === 'Responded' || l.status === 'Converted');
    const converted = all.filter((l) => l.status === 'Converted');
    const isNew = (l) => l.status !== 'Responded' && l.status !== 'Converted';

    statStrip('leadsStats', [
      { label: 'Total enquiries', value: all.length },
      { label: 'Awaiting reply', value: all.filter(isNew).length, tone: all.filter(isNew).length ? 'warn' : null },
      { label: 'Responded', value: responded.length, tone: 'good' },
      { label: 'Response rate', value: all.length ? Math.round((responded.length / all.length) * 100) + '%' : '\u2014',
        sub: converted.length ? converted.length + ' converted' : null }
    ]);

    let list = all;
    if (leadStatusFilter === 'New') list = all.filter(isNew);
    else if (leadStatusFilter === 'Responded') list = all.filter((l) => l.status === 'Responded');
    else if (leadStatusFilter === 'Converted') list = converted;

    if (!list.length) {
      tbody.innerHTML = emptyRow(6, all.length ? {
        icon: '\u{1F50E}',
        title: 'No enquiries in this filter',
        text: 'Switch back to All to see every enquiry you have received.'
      } : {
        icon: '\u{1F4E9}',
        title: 'No guest enquiries yet',
        text: 'Enquiries land here the moment a traveller contacts you from your listing. A complete listing gets found more often.',
        action: { label: 'Improve your listing', onclick: "switchView('property-details')" }
      });
      return;
    }

    tbody.innerHTML = list.map((l) => `
      <tr onclick="openLeadDrawer('${l.id}')" style="cursor:pointer;">
        <td data-label="Guest" style="font-weight:700;">${l.guestName}</td>
        <td data-label="Contact">${l.phone}<br/><small style="color:var(--owner-text-muted);">${l.email}</small></td>
        <td data-label="Enquiry" class="cell-wrap">${l.inquiry}</td>
        <td data-label="Received">${fmt(l.date)}</td>
        <td data-label="Status"><span class="badge ${l.status === 'Converted' ? 'badge-success' : l.status === 'Responded' ? 'badge-info' : 'badge-warning'}">${l.status}</span></td>
        <td data-label="Action"><button class="btn-secondary btn-tiny" onclick="event.stopPropagation(); openLeadDrawer('${l.id}')">View</button></td>
      </tr>
    `).join('');
  }

  window.openLeadDrawer = function (id) {
    const l = currentProp.leads.find(x => x.id === id) || currentProp.leads[0];
    const drawer = document.getElementById('leadDrawer');
    const body = document.getElementById('leadDrawerBody');
    if (!drawer || !body) return;

    // Opening the lead is what marks it read for the traveler.
    window.HotelzzAPI.post('/enquiries/' + encodeURIComponent(id) + '/open').catch(() => {});

    body.innerHTML = `
      <div style="margin-bottom: 16px;">
        <span class="badge badge-success">${l.status}</span>
        <h3 style="font-size:18px; font-weight:800; margin-top:6px;">${l.guestName}</h3>
        <p style="font-size:12.5px; color:var(--owner-text-muted);">${fmt(l.date)}</p>
      </div>

      <div style="background:var(--owner-bg); padding:14px; border-radius:8px; margin-bottom:16px; font-size:13px;">
        <div><strong>Phone:</strong> <a href="tel:${l.phone}">${l.phone}</a></div>
        <div><strong>Email:</strong> ${l.email}</div>
      </div>

      <div style="margin-bottom: 20px;">
        <h4 style="font-size:13px; font-weight:700; text-transform:uppercase; margin-bottom:6px; color:var(--owner-text-muted);">Guest Message Inquiry</h4>
        <div style="padding:12px; background:#FFF; border:1px solid var(--owner-border); border-radius:8px; font-size:13.5px;">
          "${l.inquiry}"
        </div>
      </div>

      ${l.response ? `
        <div style="background:#F0FDF4; border-left:3px solid #10B981; padding:12px; border-radius:8px; margin-bottom:16px; font-size:13px;">
          <strong>Your response:</strong> ${l.response}
          <div style="font-size:11px; color:var(--owner-text-muted); margin-top:4px;">Sent ${fmt(l.respondedAt)}</div>
        </div>
      ` : `
        <div style="margin-bottom:16px;">
          <h4 style="font-size:13px; font-weight:700; text-transform:uppercase; margin-bottom:6px; color:var(--owner-text-muted);">Reply to the guest</h4>
          <textarea id="leadReplyText" class="form-control" placeholder="Yes, we have availability. Our direct rate is ..." style="height:80px; width:100%; margin-bottom:8px;"></textarea>
          <button class="btn-primary" style="width:100%;" onclick="respondToLead('${l.id}')">Send response by email →</button>
        </div>
      `}

      <div style="margin-bottom:16px;">
        <h4 style="font-size:13px; font-weight:700; text-transform:uppercase; margin-bottom:6px; color:var(--owner-text-muted);">Email this guest</h4>
        <p style="font-size:12px; color:var(--owner-text-muted); margin:0 0 8px;">Goes to ${l.email} only — from Hotelzz Partner Support, reply-to this hotel.</p>
        <input id="guestMsgSubject" class="form-control" placeholder="Subject (optional)" style="margin-bottom:8px;" />
        <textarea id="guestMsgText" class="form-control" placeholder="Write a message for this guest…" style="height:70px; width:100%; margin-bottom:8px;"></textarea>
        <button class="btn-secondary" style="width:100%;" onclick="messageGuest('${l.id}')">Send email →</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px;">
        <a href="https://wa.me/${(l.phone || '').replace(/[^0-9]/g,'')}" target="_blank" class="btn-success" style="text-align:center; text-decoration:none;">WhatsApp Guest →</a>
        <button class="btn-primary" onclick="updateLeadStatus('${l.id}', 'Contacted')">Mark as Contacted</button>
        <button class="btn-secondary" onclick="updateLeadStatus('${l.id}', 'Converted')">Mark as Converted</button>
      </div>
    `;

    drawer.classList.add('open');
  };

  window.closeLeadDrawer = function () {
    document.getElementById('leadDrawer').classList.remove('open');
  };

  window.updateLeadStatus = function (id, status) {
    window.HotelzzAPI.patch('/enquiries/' + encodeURIComponent(id), { status: status })
      .then(() => data.load())
      .then(() => {
        loadPropertyData(activePropId);
        showToast(`Lead status updated to ${status}.`);
        closeLeadDrawer();
      }).catch(fail);
  };

  /** Free-form email to this one guest — recipient is fixed server-side to the enquiry's own guest. */
  window.messageGuest = function (id) {
    const subject = (document.getElementById('guestMsgSubject') || {}).value || '';
    const box = document.getElementById('guestMsgText');
    const text = box ? box.value.trim() : '';
    if (!text) return showToast('Write a message first.', 'warning');
    window.HotelzzAPI.post('/enquiries/' + encodeURIComponent(id) + '/message', { subject: subject.trim(), message: text })
      .then(() => {
        showToast('Message emailed to the guest.');
        if (box) box.value = '';
        const subjectBox = document.getElementById('guestMsgSubject');
        if (subjectBox) subjectBox.value = '';
      }).catch(fail);
  };

  /** Sends the owner's written reply — the guest receives it by email. */
  window.respondToLead = function (id) {
    const box = document.getElementById('leadReplyText');
    const text = box ? box.value.trim() : '';
    if (!text) return showToast('Write a response first.', 'warning');
    window.HotelzzAPI.post('/enquiries/' + encodeURIComponent(id) + '/respond', { response: text })
      .then(() => data.load())
      .then(() => {
        loadPropertyData(activePropId);
        showToast('Response sent to the guest by email.');
        closeLeadDrawer();
      }).catch(fail);
  };

  // 7. Reviews View Render
  let reviewFilter = 'All';

  function renderReviewsView() {
    const container = document.getElementById('reviewsContainer');
    if (!container) return;

    const all = currentProp.reviews || [];
    const unanswered = all.filter((r) => !r.ownerReply);

    // Rating summary: average plus a 5-to-1 histogram, so an owner can see
    // the shape of their feedback, not only the mean.
    const summary = document.getElementById('ratingSummary');
    if (summary) {
      if (!all.length) {
        summary.innerHTML = emptyState({
          icon: '\u2B50',
          title: 'No reviews yet',
          text: 'Guests can review your property after their enquiry is answered. Replying quickly is the fastest way to earn them.'
        });
      } else {
        const avg = all.reduce((n, r) => n + (Number(r.rating) || 0), 0) / all.length;
        const buckets = [5, 4, 3, 2, 1].map((star) => ({
          star: star,
          count: all.filter((r) => Math.round(Number(r.rating) || 0) === star).length
        }));
        summary.innerHTML = `
          <div class="rating-score">
            <div class="rating-score-value">${avg.toFixed(1)}</div>
            <div class="rating-score-stars">${'\u2605'.repeat(Math.round(avg))}${'\u2606'.repeat(5 - Math.round(avg))}</div>
            <div class="rating-score-count">${all.length} review${all.length === 1 ? '' : 's'}</div>
          </div>
          <div class="rating-bars">
            ${buckets.map((b) => `
              <div class="rating-bar-row">
                <span class="rating-bar-star">${b.star}\u2605</span>
                <span class="rating-bar-track"><span class="rating-bar-fill" style="width:${all.length ? (b.count / all.length) * 100 : 0}%"></span></span>
                <span class="rating-bar-count">${b.count}</span>
              </div>`).join('')}
          </div>
          <div class="rating-reply-stat">
            <div class="rating-reply-value">${all.length ? Math.round(((all.length - unanswered.length) / all.length) * 100) : 0}%</div>
            <div class="rating-reply-label">replied${unanswered.length ? ` \u00B7 ${unanswered.length} waiting` : ''}</div>
          </div>`;
      }
    }

    let list = all;
    if (reviewFilter === 'Unanswered') list = unanswered;
    else if (reviewFilter === 'Answered') list = all.filter((r) => r.ownerReply);

    if (!list.length) {
      container.innerHTML = emptyState(all.length ? {
        icon: '\u2705',
        title: reviewFilter === 'Unanswered' ? 'Every review has a reply' : 'Nothing here yet',
        text: reviewFilter === 'Unanswered'
          ? 'You are fully caught up. New reviews will appear here when they need an answer.'
          : 'Switch back to All to see every review.'
      } : {
        icon: '\u2B50',
        title: 'No reviews yet',
        text: 'Once guests stay and review you, their ratings show up here for you to reply to.'
      });
      return;
    }

    container.innerHTML = list.map((r) => `
      <article class="review-item">
        <div class="review-head">
          <div class="review-guest">
            <span class="review-avatar">${(r.guestName || '?').charAt(0).toUpperCase()}</span>
            <div>
              <div class="review-name">${r.guestName}</div>
              <div class="review-date">${r.date ? fmt(r.date) : ''}</div>
            </div>
          </div>
          <span class="review-rating">${'\u2605'.repeat(Math.round(Number(r.rating) || 0))}<em>${r.rating}</em></span>
        </div>
        <p class="review-comment">${r.comment}</p>
        ${r.ownerReply ? `
          <div class="review-reply">
            <strong>Your reply</strong>
            <span>${r.ownerReply}</span>
          </div>
        ` : `
          <button class="btn-secondary btn-tiny" onclick="toggleReplyBox('${r.id}')">Reply to guest</button>
          <div id="replyBox-${r.id}" class="review-reply-box" hidden>
            <textarea id="replyText-${r.id}" class="form-control" placeholder="Thank them, and answer anything they raised\u2026" style="height:80px; margin-bottom:8px;"></textarea>
            <button class="btn-primary btn-tiny" onclick="submitOwnerReply('${r.id}')">Post reply</button>
          </div>
        `}
      </article>
    `).join('');
  }

  window.toggleReplyBox = function (id) {
    const el = document.getElementById(`replyBox-${id}`);
    if (!el) return;
    el.hidden = !el.hidden;
    if (!el.hidden) {
      const box = document.getElementById(`replyText-${id}`);
      if (box) box.focus();
    }
  };

  window.submitOwnerReply = function (id) {
    const txt = document.getElementById(`replyText-${id}`).value.trim();
    if (!txt) return showToast('Write a reply first.', 'warning');
    window.HotelzzAPI.post('/reviews/' + encodeURIComponent(id) + '/reply', { reply: txt })
      .then(() => data.load())
      .then(() => {
        loadPropertyData(activePropId);
        showToast('Reply posted to the guest review.');
      }).catch(fail);
  };

  // 8. Offers View Render
  function renderOffersView() {
    const tbody = document.getElementById('offersTableBody');
    if (!tbody) return;

    const all = currentProp.offers || [];
    const active = all.filter((o) => o.status === 'Active');
    const views = all.reduce((n, o) => n + (Number(o.views) || 0), 0);
    const clicks = all.reduce((n, o) => n + (Number(o.clicks) || 0), 0);

    statStrip('offersStats', [
      { label: 'Live offers', value: active.length, tone: active.length ? 'good' : null },
      { label: 'Total offers', value: all.length },
      { label: 'Views', value: views },
      { label: 'Click rate', value: views ? Math.round((clicks / views) * 100) + '%' : '\u2014', sub: clicks + ' clicks' }
    ]);

    if (!all.length) {
      tbody.innerHTML = emptyRow(7, {
        icon: '\u{1F3F7}',
        title: 'No offers yet',
        text: 'A seasonal discount or a weekend package gives travellers a reason to pick you over a neighbouring hotel.',
        action: { label: '+ Create your first offer', onclick: 'openCreateOfferModal()' }
      });
      return;
    }

    tbody.innerHTML = all.map((o) => `
      <tr>
        <td data-label="Offer" style="font-weight:700;">${o.title}</td>
        <td data-label="Discount"><span class="badge badge-info">${o.discount}</span></td>
        <td data-label="Validity">${o.validFrom} \u2013 ${o.validUntil}</td>
        <td data-label="Views">${o.views}</td>
        <td data-label="Clicks">${o.clicks}</td>
        <td data-label="Status"><span class="badge ${o.status === 'Active' ? 'badge-success' : 'badge-warning'}">${o.status}</span></td>
        <td data-label="Actions">
          <button class="btn-secondary btn-tiny" onclick="openEditOfferModal('${o.id}')">Edit</button>
          <button class="btn-secondary btn-tiny" onclick="deleteOffer('${o.id}')">Delete</button>
        </td>
      </tr>
    `).join('');
  }

  window.openCreateOfferModal = function () {
    editingOfferId = null;
    document.getElementById('offerTitleInput').value = '';
    document.getElementById('offerDiscInput').value = '';
    document.getElementById('offerModal').classList.add('show');
  };

  let editingOfferId = null;

  window.openEditOfferModal = function (id) {
    const offer = currentProp.offers.find(o => o.id === id);
    if (!offer) return;
    editingOfferId = id;
    document.getElementById('offerTitleInput').value = offer.title;
    document.getElementById('offerDiscInput').value = offer.discount === '—' ? '' : offer.discount;
    document.getElementById('offerModal').classList.add('show');
  };

  window.deleteOffer = function (id) {
    if (!window.confirm('Delete this offer? Guests will no longer see it.')) return;
    data.deleteOffer(activePropId, id).then(() => {
      loadPropertyData(activePropId);
      showToast('Offer deleted.');
    }).catch(fail);
  };

  window.saveOfferForm = function () {
    const title = (document.getElementById('offerTitleInput').value || '').trim();
    const disc = (document.getElementById('offerDiscInput').value || '').trim();
    if (!title) return showToast('Enter an offer title.', 'warning');

    const payload = {
      title: title,
      discount: disc || '15% OFF',
      validFrom: new Date().toISOString().slice(0, 10),
      validTo: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
      status: 'Active'
    };
    const call = editingOfferId
      ? data.updateOffer(activePropId, editingOfferId, payload)
      : data.addOffer(activePropId, payload);

    call.then(() => {
      const wasEditing = !!editingOfferId;
      editingOfferId = null;
      loadPropertyData(activePropId);
      closeModal('offerModal');
      showToast(wasEditing ? `Updated offer "${title}".` : `Published offer "${title}".`);
    }).catch(fail);
  };

  // 9. Visibility & Performance View Render
  function renderVisibilityView() {
    const score = Number(currentProp.visibilityScore) || 0;

    const el = document.getElementById('visibilityScoreText');
    if (el) el.textContent = score;

    // The ring is one stroked circle; dash offset carries the value.
    const ring = document.getElementById('visRingFill');
    if (ring) {
      const r = 52;
      const circ = 2 * Math.PI * r;
      ring.style.strokeDasharray = String(circ);
      ring.style.strokeDashoffset = String(circ * (1 - score / 100));
      ring.style.stroke = score >= 80 ? '#10B981' : score >= 50 ? '#F59E0B' : '#EF4444';
    }

    const verdict = document.getElementById('visVerdict');
    if (verdict) {
      verdict.textContent = score >= 90
        ? 'Your listing is complete and ranking at full strength.'
        : score >= 60
          ? 'Solid listing. Finishing the fields below pushes you higher in search.'
          : 'Guests skip half-filled listings. Complete the fields below first.';
    }

    const checks = listingChecks();
    const missing = checks.filter((c) => !c.ok);
    const countEl = document.getElementById('visChecksCount');
    if (countEl) {
      countEl.textContent = `${checks.length - missing.length} of ${checks.length} done`;
    }

    const list = document.getElementById('visCheckList');
    if (!list) return;
    list.innerHTML = checks.map((c) => `
      <li class="vis-check ${c.ok ? 'is-ok' : 'is-missing'}">
        <span class="vis-check-mark">${c.ok ? '\u2713' : '\u25CB'}</span>
        <span class="vis-check-label">${c.label}</span>
        ${c.ok ? '<span class="vis-check-state">Added</span>'
               : '<button type="button" class="vis-check-action" onclick="switchView(\'property-details\')">Add</button>'}
      </li>`).join('');
  }

  // 10. Subscriptions & Upgrade Checkout Modal
  let livePlans = null; // fetched once — admin-editable catalogue, not a hardcoded copy

  function renderSubscriptionView() {
    const s = currentProp.subscription;
    document.getElementById('subPlanName').textContent = s.planName;
    document.getElementById('subPlanPrice').textContent = `${s.price} / ${s.billingCycle}`;
    document.getElementById('subRenewalDate').textContent = s.renewalDate;

    const list = document.getElementById('subFeaturesList');
    if (list) {
      list.innerHTML = (s.features || []).map(f => `<li>✓ ${f}</li>`).join('');
    }

    if (livePlans) return renderPlansComparisonGrid(s.planName);
    window.HotelzzAPI.get('/marketing/plans').then((r) => {
      livePlans = r.plans || [];
      renderPlansComparisonGrid(s.planName);
    }).catch(() => { /* comparison grid stays as last render on failure */ });
  }

  // Upgrade cards, built from the real (admin-editable) plan catalogue — this
  // used to be 3 hardcoded prices, so an admin price change here never
  // reached the page the owner actually sees.
  function renderPlansComparisonGrid(currentPlanName) {
    const grid = document.getElementById('plansComparisonGrid');
    if (!grid || !livePlans) return;
    grid.innerHTML = livePlans.filter((p) => p.price > 0).map((p) => {
      const isCurrent = p.name === currentPlanName;
      const priceLabel = `₹${p.price.toLocaleString('en-IN')} / month`;
      const btn = isCurrent
        ? '<button class="btn-primary" disabled>Current Active Plan</button>'
        : `<button class="${p.id === 'premium' ? 'btn-primary' : 'btn-secondary'}" onclick="openUpgradeModal('${p.name.replace(/'/g, "\\'")}', '${priceLabel}')">${p.id === 'premium' ? 'Upgrade to Premium →' : 'Select Plan'}</button>`;
      return `<div class="room-card" style="padding:20px; ${isCurrent ? 'border-color:var(--owner-primary);' : ''}" data-plan-card="${p.name}">
          <h3>${p.name}</h3>
          <div style="font-size:22px; font-weight:800; color:var(--owner-primary); margin:8px 0;">₹${p.price.toLocaleString('en-IN')} / mo</div>
          <ul style="font-size:12.5px; color:var(--owner-text-muted); list-style:none; margin:0 0 12px; padding:0;">${(p.features || []).slice(0, 3).map(f => `<li>✓ ${f}</li>`).join('')}</ul>
          ${btn}
        </div>`;
    }).join('');
  }

  let pendingPlan = null;

  window.openUpgradeModal = function (planName, price) {
    pendingPlan = { planName: planName, price: price };
    const modal = document.getElementById('upgradeModal');
    const nameEl = document.getElementById('checkoutPlanName');
    const priceEl = document.getElementById('checkoutPlanPrice');
    if (nameEl) nameEl.textContent = planName;
    if (priceEl) priceEl.textContent = price;
    if (modal) { modal.classList.add('show'); return; }
    // No checkout modal on this page — confirm straight away.
    if (window.confirm(`Request the ${planName} plan at ${price}?`)) confirmPlanUpgrade();
  };

  window.confirmPlanUpgrade = function () {
    if (!pendingPlan) return;
    const plan = pendingPlan;
    // Without this, the subscription row was saved with features: [] every
    // time — "My Subscription Plan" then showed zero feature bullets even
    // for a paying Premium customer. Pull the real list from the same
    // catalogue the comparison cards render from.
    const catalogueMatch = (livePlans || []).find((p) => p.name === plan.planName);
    const features = catalogueMatch ? catalogueMatch.features : [];

    data.changePlan(activePropId, { planName: plan.planName, price: plan.price, billingCycle: 'Monthly', features: features })
      .then(() => window.HotelzzAPI.payments.checkout({
        purpose: 'subscription', referenceId: activePropId, propertyId: activePropId
      }))
      .then((result) => data.load().then(() => result))
      .then((result) => {
        loadPropertyData(activePropId);
        if (document.getElementById('upgradeModal')) closeModal('upgradeModal');
        showToast(result.mode === 'paid'
          ? `${plan.planName} is active — payment received.`
          : `${plan.planName} requested. ${result.message || 'Our team will invoice you.'}`);
        pendingPlan = null;
      })
      .catch((err) => {
        // The plan change is saved either way; only the payment step failed.
        loadPropertyData(activePropId);
        fail(err);
      });
  };

  // 11. Public Property Preview Modal (`Preview Listing`)
  window.openPublicPreviewModal = function () {
    const p = currentProp;
    const modal = document.getElementById('previewModal');
    const body = document.getElementById('previewModalBody');
    if (!modal || !body) return;

    body.innerHTML = `
      <div style="position:relative; height:240px; border-radius:12px; overflow:hidden; margin-bottom:20px;">
        <img src="${p.coverPhoto}" style="width:100%; height:100%; object-fit:cover;" />
        <div style="position:absolute; bottom:16px; left:20px; color:#FFF; text-shadow:0 2px 4px rgba(0,0,0,0.6);">
          <h2 style="font-size:24px; font-weight:800;">${p.name}</h2>
          <div>${p.city}, ${p.state} • ⭐ ${p.rating} (${p.reviewCount} reviews)</div>
        </div>
      </div>

      <div style="margin-bottom:20px;">
        <h4 style="font-size:14px; font-weight:700; margin-bottom:6px;">About Property</h4>
        <p style="font-size:13.5px; color:var(--owner-text-muted);">${p.description}</p>
      </div>

      <div style="margin-bottom:20px;">
        <h4 style="font-size:14px; font-weight:700; margin-bottom:10px;">Available Accommodation</h4>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          ${p.rooms.map(r => `
            <div style="border:1px solid var(--owner-border); border-radius:8px; padding:12px;">
              <strong style="font-size:14px;">${r.name}</strong>
              <div style="font-size:16px; font-weight:800; color:var(--owner-primary);">₹${r.priceBase.toLocaleString('en-IN')} <small style="font-size:11px;">/ night</small></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    modal.classList.add('show');
  };

  // Billing & Invoices
  function renderBillingView() {
    const tbody = document.getElementById('invoicesTableBody');
    if (!tbody) return;

    const sub = currentProp.subscription || {};
    const invoices = sub.invoices || [];
    const paid = invoices.filter((i) => String(i.status).toLowerCase() === 'paid');

    statStrip('billingStats', [
      { label: 'Current plan', value: sub.planName || 'Free Listing' },
      { label: 'Billing', value: sub.price || '\u20B90' , sub: sub.billingCycle || 'monthly' },
      { label: 'Invoices', value: invoices.length },
      { label: 'Next renewal', value: sub.renewalDate ? fmt(sub.renewalDate) : '\u2014' }
    ]);

    if (!invoices.length) {
      tbody.innerHTML = emptyRow(5, {
        icon: '\u{1F9FE}',
        title: 'No invoices yet',
        text: 'You are on the free listing, so there is nothing to bill. Invoices appear here once you upgrade.',
        action: { label: 'See plans', onclick: "switchView('subscription')" }
      });
      return;
    }

    tbody.innerHTML = invoices.map((inv) => `
      <tr>
        <td data-label="Invoice" style="font-weight:700;">${inv.number || inv.id}</td>
        <td data-label="Billed on">${fmt(inv.date)}</td>
        <td data-label="Amount">${inv.amount}</td>
        <td data-label="Status"><span class="badge ${String(inv.status).toLowerCase() === 'paid' ? 'badge-success' : 'badge-warning'}">${inv.status}</span></td>
        <td data-label="Download"><a class="btn-secondary btn-tiny" target="_blank" rel="noopener" href="/api/owner/invoices/${encodeURIComponent(inv.number)}">Download</a></td>
      </tr>
    `).join('');
  }

  // Scoped to the currently selected property only — data.recentActivity is
  // a combined feed across every property this account can see (real for an
  // admin browsing owner.html, but wrong here: this dashboard's header and
  // KPI cards all talk about the one selected property, so its activity feed
  // showing another property's guests/reviews was confusing, not a bug in
  // the data itself. currentProp.leads/reviews are already per-property.
  function renderActivityTimeline() {
    const container = document.getElementById('activityTimelineContainer');
    if (!container || !currentProp) return;

    const activity = (currentProp.leads || []).map(l => ({
      title: 'New enquiry from ' + l.guestName, desc: currentProp.name, time: l.date
    })).concat((currentProp.reviews || []).map(r => ({
      title: r.rating + '★ review from ' + r.guestName, desc: currentProp.name, time: r.date
    }))).sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, 8);

    container.innerHTML = activity.length ? activity.map(a => `
      <div style="display:flex; gap:12px; margin-bottom:14px;">
        <div style="width:8px; height:8px; border-radius:50%; background:var(--owner-primary); margin-top:6px;"></div>
        <div>
          <div style="font-weight:700; font-size:13px;">${a.title}</div>
          <div style="font-size:12px; color:var(--owner-text-muted);">${a.desc}</div>
          <div style="font-size:11px; color:var(--owner-text-light);">${fmt(a.time)}</div>
        </div>
      </div>
    `).join('') : '<p style="font-size:13px; color:var(--owner-text-muted);">No enquiries or reviews yet — activity shows up here as guests reach out.</p>';
  }

  function setupModals() {
    window.closeModal = function (modalId) {
      const el = document.getElementById(modalId);
      if (el) el.classList.remove('show');
    };

    document.querySelectorAll('.owner-modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('show');
      });
    });
  }

  // GROW BUSINESS & MARKETING LOGIC
  let currentPurchasePkg = null;
  let currentPurchaseDuration = 30;
  let currentPurchasePrice = 13999;
  let currentTargetLocations = ["Mumbai", "Pune"];
  let currentAudienceList = ["Families", "Couples", "Business Travelers"];

  function renderGrowBusinessView() {
    renderOwnerPackagesGrid();
    renderOwnerCampaignsList();
    renderOwnerMarketingLeads();
  }

  window.switchGrowSubTab = function (tabName) {
    const tabs = ['packages', 'campaigns', 'leads'];
    tabs.forEach(t => {
      const btn = document.getElementById(`tabGrow${t.charAt(0).toUpperCase() + t.slice(1)}`);
      const sec = document.getElementById(`growSubTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
      if (btn) btn.className = (t === tabName) ? 'btn-secondary active-grow-tab' : 'btn-secondary';
      if (sec) sec.style.display = (t === tabName) ? 'block' : 'none';
    });

    if (tabName === 'campaigns') renderOwnerCampaignsList();
    if (tabName === 'leads') renderOwnerMarketingLeads();
  };

  function renderOwnerPackagesGrid() {
    const container = document.getElementById('ownerPackagesGrid');
    if (!container) return;
    const pkgs = window.HotelzzMarketingStore.getPackages();

    container.innerHTML = pkgs.map((p, idx) => `
      <div class="mkt-package-card ${p.recommended ? 'recommended' : ''}">
        ${p.recommended ? '<div class="mkt-recommended-badge">RECOMMENDED</div>' : ''}
        <div>
          <div class="pkg-header-num">PACKAGE ${idx + 1}</div>
          <div class="pkg-header-title">${p.name}</div>
          <div class="pkg-header-desc">${p.description}</div>

          <div class="pkg-kpis-box">
            <div class="pkg-kpi-row"><span>Est. Reach:</span> <span>${p.estimatedReach}</span></div>
            <div class="pkg-kpi-row"><span>Est. Leads:</span> <span>${p.estimatedLeads}</span></div>
            <div class="pkg-kpi-row"><span>WhatsApp Enquiries:</span> <span>${p.estimatedWhatsAppEnquiries}</span></div>
            <div class="pkg-kpi-row"><span>Platforms:</span> <span>${p.platforms.join(', ')}</span></div>
          </div>
        </div>

        <div>
          <div class="pkg-price-tag">₹${p.startingPrice.toLocaleString('en-IN')} <small>/ campaign</small></div>
          <button class="btn-primary" style="width:100%; justify-content:center;" onclick="openCampaignPurchaseModal('${p.id}')">Choose Package →</button>
        </div>
      </div>
    `).join('');
  }

  window.openCampaignPurchaseModal = function (pkgId) {
    const pkgs = window.HotelzzMarketingStore.getPackages();
    currentPurchasePkg = pkgs.find(p => p.id === pkgId) || pkgs[0];
    currentPurchaseDuration = 30;
    currentPurchasePrice = 13999;
    currentTargetLocations = [currentProp.city || "Mumbai", "Pune"];
    currentAudienceList = ["Families", "Couples", "Business Travelers"];

    document.getElementById('campSelectedPkgName').textContent = currentPurchasePkg.name;
    document.getElementById('campSelectedPkgDesc').textContent = currentPurchasePkg.description;

    renderLocationChips();
    goToCampStep(1);

    document.getElementById('paymentFormState').style.display = 'block';
    document.getElementById('paymentSuccessState').style.display = 'none';
    document.getElementById('campaignPurchaseModal').classList.add('show');
  };

  window.selectDurationOption = function (el, days, price) {
    document.querySelectorAll('.duration-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    currentPurchaseDuration = days;
    currentPurchasePrice = price;

    // Recalculate estimates
    const mult = days / 30;
    document.getElementById('estReach').textContent = `${Math.round(100000 * mult).toLocaleString('en-IN')}+`;
    document.getElementById('estImpressions').textContent = `${Math.round(400000 * mult).toLocaleString('en-IN')}+`;
    document.getElementById('estLeads').textContent = `${Math.round(150 * mult)}–${Math.round(250 * mult)}`;
    document.getElementById('estWhatsapp').textContent = `${Math.round(100 * mult)}–${Math.round(200 * mult)}`;
  };

  window.addLocationChip = function () {
    const input = document.getElementById('targetLocationInput');
    const val = input.value.trim();
    if (!val) return;
    if (!currentTargetLocations.includes(val)) {
      currentTargetLocations.push(val);
      renderLocationChips();
    }
    input.value = '';
    document.getElementById('locationErr').style.display = 'none';
  };

  window.removeLocationChip = function (loc) {
    currentTargetLocations = currentTargetLocations.filter(x => x !== loc);
    renderLocationChips();
  };

  function renderLocationChips() {
    const container = document.getElementById('locationChipsContainer');
    if (!container) return;
    container.innerHTML = currentTargetLocations.map(l => `
      <div class="location-chip">
        <span>📍 ${l}</span>
        <span class="location-chip-remove" onclick="removeLocationChip('${l}')">×</span>
      </div>
    `).join('');
  }

  window.toggleAudienceChip = function (el, guestType) {
    el.classList.toggle('selected');
    const isSel = el.classList.contains('selected');
    el.querySelector('span').textContent = isSel ? '✓' : '+';

    if (isSel) {
      if (!currentAudienceList.includes(guestType)) currentAudienceList.push(guestType);
    } else {
      currentAudienceList = currentAudienceList.filter(x => x !== guestType);
    }
  };

  window.goToCampStep = function (stepNum) {
    if (stepNum === 2 && currentTargetLocations.length === 0) {
      document.getElementById('locationErr').style.display = 'block';
      return;
    }

    for (let i = 1; i <= 3; i++) {
      const pill = document.getElementById(`campStepPill${i}`);
      const content = document.getElementById(`campStep${i}Content`);
      if (pill) pill.className = (i === stepNum) ? 'modal-step-pill active' : 'modal-step-pill';
      if (content) content.style.display = (i === stepNum) ? 'block' : 'none';
    }

    if (stepNum === 2) {
      document.getElementById('sumPropName').textContent = currentProp.name;
      document.getElementById('sumPkgName').textContent = currentPurchasePkg.name;
      document.getElementById('sumDuration').textContent = `${currentPurchaseDuration} Days`;
      document.getElementById('sumPrice').textContent = `₹${currentPurchasePrice.toLocaleString('en-IN')}`;
      const gst = Math.round(currentPurchasePrice * 0.18);
      document.getElementById('sumGst').textContent = `₹${gst.toLocaleString('en-IN')}`;
      document.getElementById('sumTotal').textContent = `₹${(currentPurchasePrice + gst).toLocaleString('en-IN')}`;
    }

    if (stepNum === 3) {
      document.getElementById('payPkgName').textContent = currentPurchasePkg.name;
      document.getElementById('payDuration').textContent = `${currentPurchaseDuration} Days`;
      document.getElementById('payLocations').textContent = currentTargetLocations.join(', ');
      document.getElementById('payAmount').textContent = `₹${currentPurchasePrice.toLocaleString('en-IN')}`;
      const gst = Math.round(currentPurchasePrice * 0.18);
      document.getElementById('payGst').textContent = `₹${gst.toLocaleString('en-IN')}`;
      document.getElementById('payTotal').textContent = `₹${(currentPurchasePrice + gst).toLocaleString('en-IN')}`;
    }
  };

  window.selectPayMethod = function (el) {
    document.querySelectorAll('.payment-method-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
  };

  window.simulateLaunchCampaign = function () {
    const btn = document.querySelector('#paymentFormState .btn-primary');
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    window.HotelzzMarketingStore.createCampaign({
      propertyId: currentProp.id,
      packageId: currentPurchasePkg.id,
      durationDays: currentPurchaseDuration,
      durationLabel: currentPurchaseDuration + ' Days',
      amount: currentPurchasePrice,
      targetLocations: currentTargetLocations.slice(),
      audience: currentAudienceList.slice(),
      gender: (document.getElementById('genderSelect') || {}).value || 'All',
      targetingNotes: (document.getElementById('targetingNotesInput') || {}).value || ''
    }).then((camp) => window.HotelzzAPI.payments.checkout({
      purpose: 'campaign', referenceId: camp.id, propertyId: currentProp.id
    }).then((result) => ({ camp: camp, result: result }))
      .catch((err) => {
        // Campaign is recorded; surface the payment problem without losing it.
        showToast(err.message, 'warning');
        return { camp: camp, result: { mode: 'unpaid' } };
      })
    ).then((out) => {
      const camp = out.camp;
      if (btn) { btn.disabled = false; btn.textContent = label; }
      const idEl = document.getElementById('successCampId');
      if (idEl) idEl.textContent = camp.id;
      const form = document.getElementById('paymentFormState');
      const success = document.getElementById('paymentSuccessState');
      if (form) form.style.display = 'none';
      if (success) success.style.display = 'block';
      showToast(out.result.mode === 'paid'
        ? `Campaign ${camp.id} paid and submitted — we email you when the ads go live.`
        : `Campaign ${camp.id} submitted. ${out.result.message || 'Our marketing team will confirm payment.'}`);
      window.HotelzzMarketingStore.refresh().then(renderOwnerCampaignsList);
    }).catch((err) => {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      fail(err);
    });
  };

  function renderOwnerCampaignsList() {
    const container = document.getElementById('ownerCampaignsContainer');
    if (!container) return;
    const list = window.HotelzzMarketingStore.getCampaignsForProperty(currentProp.id);

    if (list.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:36px; color:var(--owner-text-muted);">
          <div style="font-size:32px; margin-bottom:8px;">🚀</div>
          <h4 style="font-size:16px; font-weight:700;">No active marketing campaigns yet</h4>
          <p style="font-size:13px; margin-bottom:16px;">Select a marketing package to attract more guests to your property.</p>
          <button class="btn-primary" onclick="switchGrowSubTab('packages')">Browse Packages →</button>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(c => `
      <div style="background:#FFF; border:1px solid var(--owner-border); border-radius:10px; padding:20px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
          <div>
            <span class="badge ${c.campaignStatus === 'Active' ? 'badge-success' : 'badge-warning'}">${c.campaignStatus}</span>
            <h3 style="font-size:17px; font-weight:800; margin-top:4px;">${c.packageName} (${c.duration})</h3>
            <div style="font-size:12px; color:var(--owner-text-muted);">ID: ${c.id} • Target Locations: ${c.targetLocations.join(', ')}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:18px; font-weight:800; color:var(--owner-primary);">₹${c.total.toLocaleString('en-IN')}</div>
            <div style="font-size:11px; color:#10B981; font-weight:700;">✓ Payment Verified</div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; background:#F8FAFC; padding:12px; border-radius:8px; margin-bottom:14px; text-align:center;">
          <div><div style="font-size:11px; color:#64748B;">Reach</div><div style="font-size:16px; font-weight:800;">${c.kpis.reach.toLocaleString('en-IN')}</div></div>
          <div><div style="font-size:11px; color:#64748B;">Impressions</div><div style="font-size:16px; font-weight:800;">${c.kpis.impressions.toLocaleString('en-IN')}</div></div>
          <div><div style="font-size:11px; color:#64748B;">Leads</div><div style="font-size:16px; font-weight:800; color:#10B981;">${c.kpis.leads}</div></div>
          <div><div style="font-size:11px; color:#64748B;">WhatsApp</div><div style="font-size:16px; font-weight:800; color:#2563EB;">${c.kpis.whatsappEnquiries}</div></div>
        </div>

        <h4 style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--owner-text-muted); margin-bottom:6px;">Campaign Lifecycle Progress Timeline</h4>
        <div style="display:flex; flex-direction:column; gap:6px;">
          ${(c.timeline || []).map(t => `
            <div style="font-size:12px; display:flex; gap:8px;">
              <span style="color:#10B981; font-weight:700;">✓</span>
              <span><strong>${t.title}:</strong> ${t.desc} <small style="color:#94A3B8;">(${t.time})</small></span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  function renderOwnerMarketingLeads() {
    const tbody = document.getElementById('mktLeadsTableBody');
    if (!tbody) return;
    const leads = window.HotelzzMarketingStore.getLeadsForProperty(currentProp.id);

    if (!leads.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--owner-text-muted);">
        No enquiries for this property yet. Guest enquiries and campaign leads land here.</td></tr>`;
      return;
    }

    tbody.innerHTML = leads.map(l => {
      const phone = String(l.phone || '').replace(/[^0-9]/g, '');
      return `
      <tr>
        <td style="font-weight:700;">${l.name}</td>
        <td>${l.phone || '—'}<br/><small style="color:var(--owner-text-muted);">${l.email || ''}</small></td>
        <td><span class="badge badge-info">${l.source || 'website'}</span></td>
        <td>${l.propertyName || '—'}</td>
        <td>${fmt(l.date)}</td>
        <td>
          <select class="form-control" style="padding:4px 8px; font-size:12px; width:130px;" onchange="updateMktLeadStatus('${l.id}', this.value)">
            ${['Sent', 'Opened', 'Responded', 'Contacted', 'Converted', 'Closed']
              .map(st => `<option value="${st}" ${l.status === st ? 'selected' : ''}>${st}</option>`).join('')}
          </select>
        </td>
        <td>${phone
          ? `<a href="https://wa.me/${phone}" target="_blank" rel="noopener" class="btn-success" style="padding:4px 8px; font-size:11px; text-decoration:none;">WhatsApp Guest</a>`
          : '<span style="font-size:11px; color:var(--owner-text-muted);">No number</span>'}</td>
      </tr>`;
    }).join('');
  }

  window.updateMktLeadStatus = function (id, status) {
    window.HotelzzMarketingStore.updateLeadStatus(id, status).then(() => {
      showToast(`Lead marked ${status}.`);
      renderOwnerMarketingLeads();
    }).catch(fail);
  };

})();

