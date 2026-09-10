/**
 * Hotelzz Traveler Portal — Main Application Script
 * Interactive state manager for consumer enquiries, tracking status, reviews, and saved hotels.
 */

(function () {
  const store = window.HotelzzEnquiryStore;
  let currentUser = store.getUser();
  let currentView = 'overview';

  window.showToast = function (message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = '✓';
    if (type === 'warning') icon = '⚠️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  };

  /** Server timestamps arrive as "YYYY-MM-DD HH:MM:SS" in UTC. */
  window.hzFormatDate = function (value) {
    if (!value) return '—';
    const iso = /^\d{4}-\d{2}-\d{2} /.test(value) ? value.replace(' ', 'T') + 'Z' : value;
    const d = new Date(iso);
    if (isNaN(d)) return value;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ', ' +
           d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };
  const fmt = window.hzFormatDate;

  /** Date-only formatter for stay dates (no time component). */
  const fmtDay = function (value) {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d)) return value;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupModals();
    setupTsearchCollapse();
    store.ready().then((state) => {
      if (!state.user.isLoggedIn) {
        window.location.href = 'login.html?type=traveler&next=' +
          encodeURIComponent(window.location.pathname + window.location.hash);
        return;
      }
      currentUser = state.user;
      loadUserData();
      primeSearchDates();
      loadCityPills();
      handleUrlHash();
    });
  });

  window.hzLogout = function () {
    store.logout().then(() => { window.location.href = 'login.html?type=traveler'; });
  };

  const MOBILE_QUERY = '(max-width: 1024px)';

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  const VIEWS = ['overview', 'search', 'enquiries', 'reviews', 'saved', 'profile'];

  function handleUrlHash() {
    // On a phone the portal opens on Search: a traveller arrives to book, and
    // the KPI overview is a desktop-dashboard idea. Desktop keeps Overview.
    const fallback = isMobile() ? 'search' : 'overview';
    const hash = window.location.hash.replace('#', '');
    switchView(VIEWS.includes(hash) ? hash : fallback);
  }

  /* Without this the phone's back button leaves the address bar and the
     visible view disagreeing — the hash changes but nothing re-renders. */
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (VIEWS.includes(hash) && hash !== currentView) switchView(hash);
  });

  window.switchView = function (viewName) {
    currentView = viewName;
    window.location.hash = viewName;

    document.querySelectorAll('.user-nav-item, .tbar-item').forEach(el => {
      const match = el.getAttribute('data-view') === viewName;
      el.classList.toggle('active', match);
      if (el.classList.contains('tbar-item')) {
        el.setAttribute('aria-current', match ? 'page' : 'false');
      }
    });

    document.querySelectorAll('.user-page-view').forEach(el => {
      if (el.id === `view-${viewName}`) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    document.getElementById('sidebar').classList.remove('mobile-open');

    // Trigger renderers
    if (viewName === 'overview') renderOverviewView();
    if (viewName === 'search') renderSearchView();
    if (viewName === 'enquiries') renderEnquiriesView();
    if (viewName === 'reviews') renderReviewsView();
    if (viewName === 'saved') renderSavedHotelsView();
    if (viewName === 'profile') renderProfileView();

    // A drawer or modal left open would overlay — and block — the new view.
    const drawer = document.getElementById('enquiryDrawer');
    if (drawer) drawer.classList.remove('open');
    document.querySelectorAll('.user-modal-overlay.show').forEach(el => el.classList.remove('show'));

    // Tapping a tab should land at the top of that tab, the way a native app
    // behaves — otherwise the new view inherits the old view's scroll depth.
    if (isMobile()) window.scrollTo({ top: 0, behavior: 'auto' });
  };

  /* Unanswered enquiries are the one thing worth pulling someone back to, so
     the Enquiries tab carries a count of them. */
  function updateTabBarBadge() {
    const badge = document.getElementById('tbarEnqBadge');
    if (!badge) return;
    if (!currentUser) { badge.hidden = true; return; }
    const open = (store.getEnquiriesForUser(currentUser.id) || []).filter(
      e => e.status && e.status !== 'Responded' && e.status !== 'Converted'
    ).length;
    badge.textContent = open > 9 ? '9+' : String(open);
    badge.hidden = open === 0;
  }

  function setupNavigation() {
    document.querySelectorAll('.user-nav-item, .tbar-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const view = item.getAttribute('data-view');
        if (view) {
          e.preventDefault();
          switchView(view);
        }
      });
    });

    const mobileBtn = document.getElementById('mobileToggleBtn');
    if (mobileBtn) {
      mobileBtn.addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('mobile-open');
      });
    }
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  /** Default the stay dates to tonight and tomorrow. */
  function primeSearchDates() {
    const ci = document.getElementById('portalSearchCheckIn');
    const co = document.getElementById('portalSearchCheckOut');
    if (!ci || !co) return;
    const iso = (d) => d.toISOString().slice(0, 10);
    const today = new Date();
    const tomorrow = new Date(Date.now() + 864e5);
    ci.min = iso(today);
    co.min = iso(tomorrow);
    if (!ci.value) ci.value = iso(today);
    if (!co.value) co.value = iso(tomorrow);
    ci.addEventListener('change', () => {
      const next = new Date(new Date(ci.value).getTime() + 864e5);
      co.min = iso(next);
      if (!co.value || new Date(co.value) <= new Date(ci.value)) co.value = iso(next);
    });
  }

  /** Popular-city pills come from the cities that actually hold listings. */
  function loadCityPills() {
    const holder = document.getElementById('portalCityPills');
    if (!holder) return;
    window.HotelzzAPI.get('/properties/cities').then((r) => {
      holder.innerHTML = (r.cities || []).slice(0, 6).map((c) =>
        `<button class="btn-secondary portal-city-pill" onclick="selectPortalCityPill('${c.slug}', this)">${c.name} (${c.count})</button>`
      ).join('');
    }).catch(() => { holder.innerHTML = ''; });
  }

  function loadUserData() {
    currentUser = store.getUser();
    document.getElementById('userAvatarDisplay').textContent = currentUser.avatar || 'R';
    document.getElementById('userNameDisplay').textContent = currentUser.name;
    document.getElementById('welcomeHeaderTitle').textContent = `${greeting()}, ${currentUser.name} 👋`;
    updateTabBarBadge();
  }

  // 1. Overview View Render
  function renderOverviewView() {
    const enquiries = store.getEnquiriesForUser(currentUser.id);
    const reviews = store.getReviews();

    document.getElementById('kpiSent').textContent = enquiries.length;
    document.getElementById('kpiOpened').textContent = enquiries.filter(e => e.status === 'Opened' || e.status === 'Responded').length;
    document.getElementById('kpiResponses').textContent = enquiries.filter(e => e.status === 'Responded').length;
    document.getElementById('kpiReviews').textContent = reviews.length;

    const tbody = document.getElementById('recentEnquiriesTableBody');
    if (!tbody) return;

    tbody.innerHTML = enquiries.slice(0, 5).map(e => `
      <tr onclick="openEnquiryDrawer('${e.id}')" style="cursor:pointer;">
        <td style="font-weight:700;">${e.propertyName}<br/><small style="color:var(--user-text-muted);">${e.propertyCity}</small></td>
        <td>${fmtDay(e.checkIn)} → ${fmtDay(e.checkOut)}</td>
        <td>${fmt(e.sentAt)}</td>
        <td><span class="badge ${getStatusBadgeClass(e.status)}">${e.status}</span></td>
        <td><button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;">View Status</button></td>
      </tr>
    `).join('');
  }

  function getStatusBadgeClass(status) {
    if (status === 'Sent') return 'badge-blue';
    if (status === 'Opened') return 'badge-amber';
    if (status === 'Responded' || status === 'Converted') return 'badge-green';
    return 'badge-blue';
  }

  // 2. My Enquiries View Render
  function renderEnquiriesView(filterStatus = 'All', searchQuery = '') {
    const container = document.getElementById('enquiriesContainer');
    if (!container) return;

    let list = store.getEnquiriesForUser(currentUser.id);
    if (filterStatus !== 'All') {
      list = list.filter(e => e.status === filterStatus);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e => e.propertyName.toLowerCase().includes(q) || e.propertyCity.toLowerCase().includes(q));
    }

    if (list.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:36px; color:var(--user-text-muted);">
          <div style="font-size:32px; margin-bottom:8px;">📩</div>
          <h4 style="font-size:16px; font-weight:700;">No enquiries found</h4>
          <p style="font-size:13px; margin-bottom:16px;">Search hotels and send an enquiry to track availability.</p>
          <a href="index.html" class="btn-primary" style="text-decoration:none; display:inline-block;">Search Hotels →</a>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(e => `
      <div class="enquiry-card">
        <div class="enquiry-card-header">
          <div>
            <span class="badge ${getStatusBadgeClass(e.status)}" style="margin-bottom:4px;">${e.status}</span>
            <div class="enquiry-hotel-title">${e.propertyName}</div>
            <div class="enquiry-stay-dates">📍 ${e.propertyCity} • Dates: ${fmtDay(e.checkIn)} → ${fmtDay(e.checkOut)} • ${e.guests} Guests</div>
          </div>
          <button class="btn-secondary" onclick="openEnquiryDrawer('${e.id}')">Track Status →</button>
        </div>

        <p style="font-size:13px; color:var(--user-text-muted); margin-bottom:10px;">"${e.message}"</p>

        <div class="status-timeline">
          ${(e.timeline || []).map(t => `
            <div class="timeline-step completed">
              <div class="timeline-dot"></div>
              <span><strong>${t.title}:</strong> ${t.desc} <small style="color:var(--user-text-muted);">(${fmt(t.time)})</small></span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  window.filterEnquiriesStatus = function (status) {
    document.querySelectorAll('.enq-filter-btn').forEach(btn => btn.classList.remove('active'));
    renderEnquiriesView(status);
  };

  // Enquiry Detail Drawer
  window.openEnquiryDrawer = function (id) {
    const enqs = store.getEnquiries();
    const e = enqs.find(x => x.id === id) || enqs[0];
    const drawer = document.getElementById('enquiryDrawer');
    const body = document.getElementById('enquiryDrawerBody');
    if (!drawer || !body) return;

    body.innerHTML = `
      <div style="margin-bottom:16px;">
        <span class="badge ${getStatusBadgeClass(e.status)}">${e.status}</span>
        <h3 style="font-size:18px; font-weight:800; margin-top:6px;">${e.propertyName}</h3>
        <p style="font-size:12.5px; color:var(--user-text-muted);">Enquiry ID: ${e.id} • Sent: ${fmt(e.sentAt)}</p>
      </div>

      <div style="background:var(--user-bg); padding:14px; border-radius:8px; margin-bottom:16px; font-size:13px;">
        <div><strong>Requested Stay:</strong> ${fmtDay(e.checkIn)} → ${fmtDay(e.checkOut)}</div>
        <div><strong>Guests:</strong> ${e.guests} Guest(s)</div>
        <div><strong>Contact Details Sent:</strong> ${e.guestName} (${e.guestPhone})</div>
      </div>

      <div style="margin-bottom:16px;">
        <h4 style="font-size:13px; font-weight:700; text-transform:uppercase; margin-bottom:6px; color:var(--user-text-muted);">Your Message</h4>
        <div style="padding:12px; background:#FFF; border:1px solid var(--user-border); border-radius:8px; font-size:13px;">
          "${e.message}"
        </div>
      </div>

      ${e.hotelResponse ? `
        <div style="background:#F0FDF4; border-left:4px solid #10B981; padding:14px; border-radius:8px; margin-bottom:20px;">
          <div style="font-weight:700; color:#166534; margin-bottom:4px;">Hotel Response:</div>
          <div style="font-size:13px; color:#0F172A;">"${e.hotelResponse}"</div>
          <div style="font-size:11px; color:#64748B; margin-top:6px;">Received: ${fmt(e.respondedAt)}</div>
        </div>
      ` : ''}

      <h4 style="font-size:13px; font-weight:700; text-transform:uppercase; margin-bottom:10px; color:var(--user-text-muted);">Live Status Timeline</h4>
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:20px;">
        ${(e.timeline || []).map(t => `
          <div style="font-size:12.5px; display:flex; gap:8px;">
            <span style="color:#10B981; font-weight:700;">✓</span>
            <span><strong>${t.title}:</strong> ${t.desc} <small style="color:#94A3B8;">(${fmt(t.time)})</small></span>
          </div>
        `).join('')}
      </div>

      ${e.isEligibleForReview ? `
        <div style="background:#FAF5FF; border:1px solid #E9D5FF; padding:14px; border-radius:8px; margin-bottom:20px;">
          <h4 style="font-size:14px; font-weight:700; color:#6B21A8; margin-bottom:4px;">Stayed at this hotel?</h4>
          <p style="font-size:12px; color:#64748B; margin-bottom:10px;">Share your stay experience to help other travelers.</p>
          <button class="btn-primary" onclick="openReviewModal('${e.propertyId}', '${e.propertyName.replace(/'/g, "\'")}', '${e.id}')">Write a Review ⭐</button>
        </div>
      ` : ''}

      ${e.propertyPhone ? `
        <div style="display:flex; gap:10px;">
          <a href="tel:${e.propertyPhone}" class="btn-secondary" style="flex:1; justify-content:center; text-decoration:none;">Call ${e.propertyName}</a>
          <a href="https://wa.me/${String(e.propertyPhone).replace(/[^0-9]/g, '').replace(/^0/, '91')}" target="_blank" rel="noopener" class="btn-primary" style="flex:1; justify-content:center; text-decoration:none;">WhatsApp Hotel</a>
        </div>
      ` : `
        <div style="font-size:12.5px; color:var(--user-text-muted); text-align:center;">
          This hotel has not published a phone number. They reply to your enquiry by email.
        </div>
      `}
    `;

    drawer.classList.add('open');
  };

  window.closeUserDrawer = function () {
    document.getElementById('enquiryDrawer').classList.remove('open');
  };

  // 3. My Reviews View Render
  function renderReviewsView() {
    const container = document.getElementById('userReviewsContainer');
    if (!container) return;
    const list = store.getReviews();

    if (!list.length) {
      container.innerHTML = `
        <div style="text-align:center; padding:36px; color:var(--user-text-muted);">
          <div style="font-size:32px; margin-bottom:8px;">⭐</div>
          <h4 style="font-size:16px; font-weight:700;">No reviews yet</h4>
          <p style="font-size:13px;">Once a hotel replies to your enquiry, you can review your stay from My Enquiries.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(r => `
      <div class="enquiry-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size:16px;">${r.propertyName}</strong>
          <span style="font-weight:700; color:#D97706;">⭐ ${r.rating} / 5</span>
        </div>
        <p style="font-size:13.5px; color:var(--user-text-main); margin-bottom:10px;">"${r.comment}"</p>
        <div style="font-size:12px; color:var(--user-text-muted);">Published: ${fmt(r.date)} • <span class="badge badge-green">Verified Review</span></div>
      </div>
    `).join('');
  }

  let reviewEnquiryId = null;
  window.openReviewModal = function (propId, propName, enquiryId) {
    reviewEnquiryId = enquiryId || null;
    document.getElementById('reviewPropId').value = propId;
    document.getElementById('reviewPropName').textContent = propName;
    document.getElementById('reviewModal').classList.add('show');
  };

  window.saveUserReviewForm = function () {
    const propId = document.getElementById('reviewPropId').value;
    const propName = document.getElementById('reviewPropName').textContent;
    const rating = parseInt(document.getElementById('reviewRatingSelect').value) || 5;
    const comment = document.getElementById('reviewCommentInput').value.trim() || 'Great experience!';

    store.submitReview({
      propertyId: propId, propertyName: propName, enquiryId: reviewEnquiryId,
      rating: rating, comment: comment
    }).then(() => {
      showToast('Review submitted successfully!');
      closeModal('reviewModal');
      renderReviewsView();
      renderEnquiriesView();
      closeUserDrawer();
    }).catch((err) => showToast(err.message, 'warning'));
  };

  // 4. Saved Hotels View Render
  function renderSavedHotelsView() {
    const container = document.getElementById('savedHotelsContainer');
    if (!container) return;
    const list = store.getSavedHotelDetails();

    if (!list.length) {
      container.innerHTML = `
        <div style="text-align:center; padding:36px; color:var(--user-text-muted);">
          <div style="font-size:32px; margin-bottom:8px;">🤍</div>
          <h4 style="font-size:16px; font-weight:700;">No saved hotels yet</h4>
          <p style="font-size:13px; margin-bottom:16px;">Tap the heart on any property to keep it here.</p>
          <button class="btn-primary" onclick="switchView('search')">Search Hotels →</button>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(h => `
      <div class="enquiry-card" style="display:flex; gap:16px; align-items:center;">
        <img src="${h.image_url || 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=500&h=300&fit=crop&q=80'}" style="width:120px; height:80px; object-fit:cover; border-radius:8px;" />
        <div style="flex:1;">
          <h4 style="font-size:16px; font-weight:800;">${h.name || h.id}</h4>
          <div style="font-size:12.5px; color:var(--user-text-muted);">📍 ${h.location || '—'} • ★ ${h.rating || '—'}</div>
        </div>
        <div style="display:flex; gap:8px;">
          <a href="property.html?id=${encodeURIComponent(h.id)}" class="btn-primary" style="text-decoration:none; font-size:12.5px;">View &amp; Enquire</a>
          <button class="btn-secondary" onclick="toggleSaved('${h.id}')">Remove ❤️</button>
        </div>
      </div>
    `).join('');
  }

  window.toggleSaved = function (propId) {
    store.toggleSavedHotel(propId).then((saved) => {
      showToast(saved ? 'Added to saved hotels' : 'Removed from saved hotels');
      renderSavedHotelsView();
      if (currentView === 'search') filterPortalSearchHotels();
    }).catch((err) => showToast(err.message, 'warning'));
  };

  // 5. My Profile Render & Save
  function renderProfileView() {
    document.getElementById('profNameInput').value = currentUser.name;
    document.getElementById('profEmailInput').value = currentUser.email;
    document.getElementById('profPhoneInput').value = currentUser.phone || '';
    const cityEl = document.getElementById('profCityInput');
    if (cityEl) cityEl.value = currentUser.city || '';
  }

  window.changePasswordForm = function () {
    const current = document.getElementById('pwCurrentInput').value;
    const next = document.getElementById('pwNewInput').value;
    if (!current || next.length < 8) return showToast('Enter your current password and a new one of 8+ characters.', 'warning');
    window.HotelzzAPI.auth.changePassword(current, next).then(() => {
      document.getElementById('pwCurrentInput').value = '';
      document.getElementById('pwNewInput').value = '';
      showToast('Password updated.');
    }).catch((err) => showToast(err.message, 'warning'));
  };

  window.saveProfileForm = function () {
    currentUser.name = document.getElementById('profNameInput').value;
    currentUser.email = document.getElementById('profEmailInput').value;
    currentUser.phone = document.getElementById('profPhoneInput').value;
    const cityInput = document.getElementById('profCityInput');
    if (cityInput) currentUser.city = cityInput.value;
    store.saveUser(currentUser).then((u) => {
      currentUser = u;
      showToast('Profile saved. Details auto-fill on future enquiries.');
      loadUserData();
    }).catch((err) => showToast(err.message, 'warning'));
  };

  function setupModals() {
    window.closeModal = function (modalId) {
      const el = document.getElementById(modalId);
      if (el) el.classList.remove('show');
    };

    document.querySelectorAll('.user-modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('show');
      });
    });
  }

  // SEARCH HOTELS INSIDE PORTAL LOGIC — live results from the properties API
  let currentPortalCityFilter = 'all';
  let portalSearchTimer = null;
  let portalResults = [];

  /* --- Collapsible mobile search -------------------------------------- */

  /* The expanded form is most of a phone screen. Once a search has run it
     folds into a summary line that stays pinned while results scroll. */
  function tsearchSummaryText() {
    const where = (document.getElementById('portalSearchCityInput').value || '').trim();
    const ci = document.getElementById('portalSearchCheckIn');
    const co = document.getElementById('portalSearchCheckOut');
    const guests = document.getElementById('portalSearchGuests');

    const cityLabel = currentPortalCityFilter !== 'all'
      ? currentPortalCityFilter.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : '';
    const whereText = where || cityLabel || 'Anywhere in India';

    const short = (v) => {
      if (!v) return null;
      const d = new Date(v);
      return isNaN(d) ? null : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };
    const from = short(ci && ci.value);
    const to = short(co && co.value);
    const dates = from && to ? `${from} \u2013 ${to}` : 'Add dates';
    const g = guests ? guests.options[guests.selectedIndex].text : '2 Guests';

    return { where: whereText, meta: `${dates} \u00B7 ${g}` };
  }

  function refreshTsearchSummary() {
    const whereEl = document.getElementById('tsearchSummaryWhere');
    const metaEl = document.getElementById('tsearchSummaryMeta');
    if (!whereEl || !metaEl) return;
    const t = tsearchSummaryText();
    whereEl.textContent = t.where;
    metaEl.textContent = t.meta;
  }

  function setTsearchCollapsed(collapsed) {
    const card = document.getElementById('tsearchCard');
    const btn = document.getElementById('tsearchSummary');
    if (!card || !btn) return;
    card.classList.toggle('is-collapsed', collapsed);
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (collapsed) refreshTsearchSummary();
  }

  function setupTsearchCollapse() {
    const btn = document.getElementById('tsearchSummary');
    if (!btn) return;
    btn.addEventListener('click', () => {
      setTsearchCollapsed(false);
      const input = document.getElementById('portalSearchCityInput');
      if (input) input.focus({ preventScroll: true });
    });

    // Keep the summary honest while the form is open.
    ['portalSearchCityInput', 'portalSearchCheckIn', 'portalSearchCheckOut', 'portalSearchGuests']
      .forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', refreshTsearchSummary);
      });

    // Widening past the breakpoint must not leave the desktop form folded.
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => { if (!mq.matches) setTsearchCollapsed(false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  function renderSearchView() {
    // Arriving with an empty box means the traveller still has to say where,
    // so the form opens; a standing query stays folded behind its summary.
    const q = (document.getElementById('portalSearchCityInput') || {}).value || '';
    if (!q.trim() && currentPortalCityFilter === 'all') setTsearchCollapsed(false);
    filterPortalSearchHotels();
  }

  window.filterPortalSearchHotels = function () {
    // Debounced: this runs on every keystroke of the search box.
    clearTimeout(portalSearchTimer);
    portalSearchTimer = setTimeout(runPortalSearch, 220);
  };

  function runPortalSearch() {
    const container = document.getElementById('portalSearchResultsContainer');
    if (!container) return;
    const query = (document.getElementById('portalSearchCityInput').value || '').trim();

    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:36px;color:var(--user-text-muted);">Searching properties…</div>';

    store.searchProperties({
      q: query || undefined,
      city: currentPortalCityFilter !== 'all' ? currentPortalCityFilter : undefined,
      limit: 24
    }).then((res) => {
      portalResults = res.properties || [];
      paintPortalResults(container, res.total);
    }).catch((err) => {
      container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:36px;color:#B91C1C;">${err.message}</div>`;
    });
  }

  function paintPortalResults(container, total) {
    if (!portalResults.length) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align:center; padding:36px; background:#FFF; border-radius:12px; border:1px solid var(--user-border);">
          <div style="font-size:32px; margin-bottom:8px;">🔍</div>
          <h4 style="font-size:16px; font-weight:700;">No properties found</h4>
          <p style="font-size:13px; color:var(--user-text-muted);">Try another city — Mumbai, Panaji, Pune, Jaipur…</p>
        </div>
      `;
      return;
    }

    const saved = store.getSavedHotels();
    const fallbackImg = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=450&fit=crop&q=70';

    if (isMobile()) setTsearchCollapsed(true);

    container.innerHTML = portalResults.map(h => {
      const name = (h.name || '').replace(/'/g, "\'");
      const city = (h.location || '').replace(/'/g, "\'");
      const rating = h.rating ? Number(h.rating).toFixed(1) : null;
      const reviews = h.google_review_count
        ? `<small>${h.google_review_count} reviews</small>` : '';
      const isSaved = saved.includes(h.id);
      return `
      <article class="thotel-card">
        <div class="thotel-media">
          <img src="${h.image_url || fallbackImg}" alt="${h.name}" loading="lazy" />
          ${h.claimStatus === 'verified' ? '<span class="thotel-verified">Verified</span>' : ''}
          <button class="thotel-fav" onclick="toggleSaved('${h.id}')"
                  aria-pressed="${isSaved}"
                  aria-label="${isSaved ? 'Remove from saved' : 'Save this hotel'}">${isSaved ? '\u2764\uFE0F' : '\u{1F90D}'}</button>
          ${rating ? `<span class="thotel-rating">\u2605 ${rating} ${reviews}</span>` : ''}
        </div>
        <div class="thotel-body">
          <h3 class="thotel-name">${h.name}</h3>
          <div class="thotel-loc">${h.address || h.location || ''}</div>
          ${h.google_summary ? `<p class="thotel-summary">${h.google_summary}</p>` : ''}
        </div>
        <div class="thotel-actions">
          <a href="property.html?id=${encodeURIComponent(h.id)}" class="btn-secondary">Details</a>
          <button class="btn-primary" onclick="sendPortalEnquiryDirect('${h.id}', '${name}', '${city}')">Send Enquiry \u2192</button>
        </div>
      </article>`;
    }).join('') + (total > portalResults.length
      ? `<div style="grid-column:1/-1;text-align:center;font-size:12.5px;padding:4px 0 8px;color:var(--user-text-muted);">Showing ${portalResults.length} of ${total} matching properties — refine your search to narrow it down.</div>`
      : '');
  }

  window.selectPortalCityPill = function (city, btn) {
    currentPortalCityFilter = city;
    document.querySelectorAll('.portal-city-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    runPortalSearch();
  };

  window.sendPortalEnquiryDirect = function (propId, propName, propCity) {
    const checkIn = document.getElementById('portalSearchCheckIn').value || '2026-10-12';
    const checkOut = document.getElementById('portalSearchCheckOut').value || '2026-10-14';
    const guests = parseInt(document.getElementById('portalSearchGuests').value) || 2;

    store.sendEnquiry({
      propertyId: propId,
      propertyName: propName,
      propertyCity: propCity,
      checkIn: checkIn,
      checkOut: checkOut,
      guests: guests,
      message: `Hi! I am interested in booking ${propName} for ${guests} guests from ${checkIn} to ${checkOut}. Please confirm best rate.`
    }).then(() => {
      showToast(`Enquiry sent to ${propName}! Tracked in My Enquiries.`);
      switchView('enquiries');
    }).catch((err) => showToast(err.message, 'warning'));
  };

})();

