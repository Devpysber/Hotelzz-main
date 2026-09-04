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

  function handleUrlHash() {
    const hash = window.location.hash.replace('#', '') || 'overview';
    switchView(hash);
  }

  window.switchView = function (viewName) {
    currentView = viewName;
    window.location.hash = viewName;

    document.querySelectorAll('.user-nav-item').forEach(el => {
      if (el.getAttribute('data-view') === viewName) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
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
  };

  function setupNavigation() {
    document.querySelectorAll('.user-nav-item').forEach(item => {
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

  function renderSearchView() {
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

    container.innerHTML = portalResults.map(h => {
      const name = (h.name || '').replace(/'/g, "\'");
      const city = (h.location || '').replace(/'/g, "\'");
      return `
      <div style="background:#FFF; border:1px solid var(--user-border); border-radius:12px; overflow:hidden; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          <div style="position:relative; height:160px; overflow:hidden;">
            <img src="${h.image_url || fallbackImg}" style="width:100%; height:100%; object-fit:cover;" />
            ${h.claimStatus === 'verified' ? '<span class="badge badge-green" style="position:absolute; top:10px; left:10px;">🟢 Claimed &amp; Verified</span>' : ''}
            <button onclick="toggleSaved('${h.id}')" style="position:absolute; top:10px; right:10px; background:#FFF; border:none; border-radius:50%; width:32px; height:32px; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(0,0,0,0.15);">
              ${saved.includes(h.id) ? '❤️' : '🤍'}
            </button>
          </div>
          <div style="padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
              <h3 style="font-size:16px; font-weight:800; color:var(--user-text-main);">${h.name}</h3>
              <span style="font-size:12px; font-weight:700; background:#FEF3C7; color:#D97706; padding:2px 6px; border-radius:4px; flex-shrink:0;">★ ${h.rating || '—'}</span>
            </div>
            <div style="font-size:12.5px; color:var(--user-text-muted); margin-bottom:10px;">📍 ${h.address || h.location || ''} ${h.google_review_count ? '• ' + h.google_review_count + ' Google reviews' : ''}</div>
            ${h.google_summary ? `<p style="font-size:12.5px; color:var(--user-text-muted); margin-bottom:12px;">${h.google_summary}</p>` : ''}
          </div>
        </div>
        <div style="padding:16px; border-top:1px solid var(--user-border); background:#FAFAFA; display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <a href="property.html?id=${encodeURIComponent(h.id)}" class="btn-secondary" style="text-decoration:none; font-size:12.5px;">Details</a>
          <button class="btn-primary" style="padding:8px 14px; font-size:12.5px;" onclick="sendPortalEnquiryDirect('${h.id}', '${name}', '${city}')">Send Enquiry →</button>
        </div>
      </div>`;
    }).join('') + (total > portalResults.length
      ? `<div style="grid-column:1/-1;text-align:center;font-size:12.5px;color:var(--user-text-muted);">Showing ${portalResults.length} of ${total} matching properties — refine your search to narrow it down.</div>`
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

