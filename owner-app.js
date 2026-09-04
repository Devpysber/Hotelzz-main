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
  function handleUrlHash() {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    switchView(hash);
  }

  // View Switcher
  window.switchView = function (viewName) {
    currentView = viewName;
    window.location.hash = viewName;

    // Active nav class
    document.querySelectorAll('.owner-nav-item').forEach(el => {
      if (el.getAttribute('data-view') === viewName) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
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
    renderPhotoGallery();
    renderAmenitiesView();
    renderRoomsView();
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
    document.querySelectorAll('.owner-nav-item').forEach(item => {
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
  function renderPerformanceChart(tf = '30d') {
    const container = document.getElementById('performanceChartContainer');
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = 220;
    const padding = 35;
    const labels = ["Week 1", "Week 2", "Week 3", "Week 4"];
    const views = [2800, 3100, 3400, 3542];
    const leads = [18, 22, 21, 25];

    const getX = (i) => padding + (i * (width - 2 * padding) / (labels.length - 1));
    const getY = (val) => height - padding - ((val / 4000) * (height - 2 * padding));

    let points = views.map((v, i) => `${getX(i)},${getY(v)}`).join(' ');

    let svg = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}">
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#E2E8F0" />
      <polygon points="${getX(0)},${height - padding} ${points} ${getX(labels.length - 1)},${height - padding}" fill="rgba(37,99,235,0.12)" />
      <polyline points="${points}" fill="none" stroke="#2563EB" stroke-width="3" />
      ${labels.map((lbl, i) => `<text x="${getX(i)}" y="${height - 10}" text-anchor="middle" font-size="11" fill="#64748B" font-weight="600">${lbl}</text>`).join('')}
    </svg>`;

    container.innerHTML = svg;
  }

  // 2. Property Details View Render
  function renderPropertyDetailsView() {
    const p = currentProp;
    document.getElementById('editPropName').value = p.name;
    document.getElementById('editPropType').value = p.category;
    document.getElementById('editPropDesc').value = p.description;
    document.getElementById('editPropPhone').value = p.phoneFull || "+91 98201 44512";
    document.getElementById('editPropEmail').value = p.email;
    document.getElementById('editPropWebsite').value = p.website;
    document.getElementById('editPropAddress').value = p.address;
    document.getElementById('editPropCity').value = p.city;
    document.getElementById('editPropPincode').value = p.pincode;
  }

  window.savePropertyDetails = function () {
    data.saveProperty(activePropId, {
      name: document.getElementById('editPropName').value,
      email: document.getElementById('editPropEmail').value,
      website: document.getElementById('editPropWebsite').value,
      phone: document.getElementById('editPropPhone').value,
      address: document.getElementById('editPropAddress').value,
      city: document.getElementById('editPropCity').value,
      pincode: document.getElementById('editPropPincode').value,
      details: {
        category: document.getElementById('editPropType').value,
        description: document.getElementById('editPropDesc').value
      }
    }).then(() => {
      showToast('Property details saved.');
      loadPropertyData(activePropId);
    }).catch(fail);
  };

  // 3. Photo Gallery Render
  function renderPhotoGallery(category = 'All') {
    const p = currentProp;
    const coverContainer = document.getElementById('coverPhotoPreview');
    if (coverContainer) {
      coverContainer.src = p.coverPhoto;
    }

    const grid = document.getElementById('photoGalleryGrid');
    if (!grid) return;

    let list = p.photos;
    if (category !== 'All') {
      list = p.photos.filter(x => x.category === category);
    }

    grid.innerHTML = list.map(ph => `
      <div class="photo-card">
        <img src="${ph.url}" alt="${ph.title}" />
        <div class="photo-card-actions">
          <button class="photo-action-btn" onclick="setCoverPhoto('${ph.id}')">Cover</button>
          <button class="photo-action-btn" onclick="deletePhoto('${ph.id}')" style="color:#EF4444;">Delete</button>
        </div>
      </div>
    `).join('');
  }

  let currentPhotoCategory = 'All';
  window.filterPhotoCategory = function (cat) {
    currentPhotoCategory = cat;
    renderPhotoGallery(cat);
  };

  window.setCoverPhoto = function (photoId) {
    data.setCoverPhoto(activePropId, photoId).then(() => {
      loadPropertyData(activePropId);
      showToast('Cover photo updated.');
    }).catch(fail);
  };

  window.deletePhoto = function (id) {
    data.deletePhoto(activePropId, id).then(() => {
      loadPropertyData(activePropId);
      showToast('Photo removed from gallery.');
    }).catch(fail);
  };

  // Opens the file picker; the upload itself runs in uploadSelectedPhotos.
  window.simulatePhotoUpload = function () {
    const input = document.getElementById('ownerPhotoInput');
    if (input) input.click();
  };
  window.openPhotoUpload = window.simulatePhotoUpload;

  window.uploadSelectedPhotos = function (files) {
    if (!files || !files.length) return;
    const category = currentPhotoCategory === 'All' ? 'General' : currentPhotoCategory;
    showToast(`Uploading ${files.length} photo${files.length > 1 ? 's' : ''}…`);

    data.uploadPhotos(activePropId, files, category)
      .then((res) => data.load().then(() => res))
      .then((res) => {
        loadPropertyData(activePropId);
        showToast(`${res.photos.length} photo${res.photos.length > 1 ? 's' : ''} added to the gallery.`);
      })
      .catch(fail)
      .then(() => { document.getElementById('ownerPhotoInput').value = ''; });
  };

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
  };

  window.saveAmenities = function () {
    data.saveAmenities(activePropId, currentProp.amenities)
      .then(() => showToast('Amenities saved.'))
      .catch(fail);
  };

  // 5. Rooms View Render
  function renderRoomsView() {
    const grid = document.getElementById('roomsGrid');
    if (!grid) return;

    grid.innerHTML = currentProp.rooms.map(r => `
      <div class="room-card">
        <img class="room-card-img" src="${r.photo}" alt="${r.name}" />
        <div class="room-card-body">
          <div>
            <div class="room-card-title">${r.name}</div>
            <div style="font-size:12px; color:var(--owner-text-muted);">${r.type} • ${r.size} • ${r.bedType}</div>
            <div class="room-card-price">₹${r.priceBase.toLocaleString('en-IN')} <span style="font-size:12px; font-weight:500; color:var(--owner-text-muted);">/ night</span></div>
          </div>
          <div style="margin-top: 14px; display: flex; gap: 8px;">
            <button class="btn-secondary" style="flex:1; padding: 6px;" onclick="openEditRoomModal('${r.id}')">Edit Room</button>
            <button class="btn-secondary" style="padding: 6px 10px;" onclick="deleteRoom('${r.id}')">Delete</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  window.openAddRoomModal = function () {
    editingRoomId = null;
    document.getElementById('roomModalTitle').textContent = 'Add New Room';
    document.getElementById('roomFormName').value = '';
    document.getElementById('roomFormPrice').value = '4999';
    document.getElementById('roomModal').classList.add('show');
  };

  let editingRoomId = null;

  window.openEditRoomModal = function (id) {
    const room = currentProp.rooms.find(r => r.id === id);
    if (!room) return;
    editingRoomId = id;
    document.getElementById('roomModalTitle').textContent = 'Edit Room';
    document.getElementById('roomFormName').value = room.name;
    document.getElementById('roomFormPrice').value = room.priceBase;
    document.getElementById('roomModal').classList.add('show');
  };

  window.saveRoomForm = function () {
    const name = document.getElementById('roomFormName').value.trim();
    const price = parseInt(document.getElementById('roomFormPrice').value, 10);
    if (!name) return showToast('Enter a room name.', 'warning');

    const payload = { name: name, price: isNaN(price) ? 0 : price };
    const call = editingRoomId
      ? data.updateRoom(activePropId, editingRoomId, payload)
      : data.addRoom(activePropId, Object.assign({ type: 'Deluxe', capacity: 2, count: 1 }, payload));

    call.then(() => {
      const wasEditing = !!editingRoomId;
      editingRoomId = null;
      loadPropertyData(activePropId);
      closeModal('roomModal');
      showToast(wasEditing ? `Room "${name}" updated.` : `Room "${name}" added.`);
    }).catch(fail);
  };

  window.deleteRoom = function (id) {
    if (!window.confirm('Delete this room type? This cannot be undone.')) return;
    data.deleteRoom(activePropId, id).then(() => {
      loadPropertyData(activePropId);
      showToast('Room deleted.');
    }).catch(fail);
  };

  // 6. Leads View Render
  function renderLeadsView() {
    const tbody = document.getElementById('leadsTableBody');
    if (!tbody) return;

    tbody.innerHTML = currentProp.leads.map(l => `
      <tr onclick="openLeadDrawer('${l.id}')" style="cursor:pointer;">
        <td style="font-weight:700;">${l.guestName}</td>
        <td>${l.phone}<br/><small style="color:var(--owner-text-muted);">${l.email}</small></td>
        <td style="max-width:240px;">${l.inquiry}</td>
        <td>${fmt(l.date)}</td>
        <td><span class="badge ${l.status === 'Converted' ? 'badge-success' : 'badge-warning'}">${l.status}</span></td>
        <td><button class="btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="event.stopPropagation(); openLeadDrawer('${l.id}')">View</button></td>
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
  function renderReviewsView() {
    const container = document.getElementById('reviewsContainer');
    if (!container) return;

    container.innerHTML = currentProp.reviews.map(r => `
      <div class="owner-card" style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="font-size:15px;">${r.guestName}</strong>
          <span style="font-weight:700; color:#D97706;">⭐ ${r.rating} / 5</span>
        </div>
        <p style="font-size:13.5px; color:var(--owner-text-main); margin-bottom:12px;">"${r.comment}"</p>

        ${r.ownerReply ? `
          <div style="background:#F0FDF4; border-left:3px solid #10B981; padding:10px 14px; border-radius:6px; font-size:12.5px;">
            <strong>Your Reply:</strong> ${r.ownerReply}
          </div>
        ` : `
          <button class="btn-secondary" style="padding:4px 10px; font-size:12px;" onclick="toggleReplyBox('${r.id}')">Reply to Guest</button>
          <div id="replyBox-${r.id}" style="display:none; margin-top:10px;">
            <textarea id="replyText-${r.id}" class="form-control" placeholder="Write polite response..." style="height:70px; margin-bottom:6px;"></textarea>
            <button class="btn-primary" style="padding:6px 12px; font-size:12px;" onclick="submitOwnerReply('${r.id}')">Post Reply</button>
          </div>
        `}
      </div>
    `).join('');
  }

  window.toggleReplyBox = function (id) {
    const el = document.getElementById(`replyBox-${id}`);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
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

    tbody.innerHTML = currentProp.offers.map(o => `
      <tr>
        <td style="font-weight:700;">${o.title}</td>
        <td><span class="badge badge-info">${o.discount}</span></td>
        <td>${o.validFrom} → ${o.validUntil}</td>
        <td>${o.views} Views</td>
        <td>${o.clicks} Clicks</td>
        <td><span class="badge ${o.status === 'Active' ? 'badge-success' : 'badge-warning'}">${o.status}</span></td>
        <td>
          <button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="openEditOfferModal('${o.id}')">Edit</button>
          <button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="deleteOffer('${o.id}')">Delete</button>
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
    const el = document.getElementById('visibilityScoreText');
    if (el) el.textContent = `${currentProp.visibilityScore} / 100`;
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

    tbody.innerHTML = currentProp.subscription.invoices.map(inv => `
      <tr>
        <td style="font-weight:700;">${inv.id}</td>
        <td>${fmt(inv.date)}</td>
        <td>${inv.amount}</td>
        <td><span class="badge badge-success">${inv.status}</span></td>
        <td><a class="btn-secondary" style="padding:4px 8px; font-size:11.5px; text-decoration:none;" target="_blank" rel="noopener" href="/api/owner/invoices/${encodeURIComponent(inv.number)}">Download</a></td>
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

