/**
 * Hotelzz Marketing store — server backed.
 *
 * Keeps the synchronous getters the owner and admin dashboards were written
 * against by caching the server response, while every write goes to the API.
 * Call `ready()` (or `refresh()`) before the first render.
 */
(function () {
  var API = window.HotelzzAPI;

  var cache = { packages: [], campaigns: [], leads: [] };
  var readyPromise = null;

  function emit() {
    try { window.dispatchEvent(new CustomEvent('hotelzz:marketing-updated', { detail: cache })); } catch (e) {}
  }

  function loadPackages() {
    return API.get('/marketing/packages')
      .then(function (r) { cache.packages = r.packages || []; })
      .catch(function () { cache.packages = []; });
  }

  function loadCampaigns() {
    return API.get('/marketing/campaigns')
      .then(function (r) { cache.campaigns = r.campaigns || []; })
      .catch(function () { cache.campaigns = []; });
  }

  // Marketing leads are the enquiries generated for the owner's properties,
  // plus the plan enquiries the admin sees in the CRM.
  function loadLeads() {
    return API.get('/enquiries?limit=200')
      .then(function (r) {
        cache.leads = (r.enquiries || []).map(function (e) {
          return {
            id: e.id,
            propertyId: e.propertyId,
            propertyName: e.propertyName,
            name: e.guestName,
            phone: e.guestPhone,
            email: e.guestEmail,
            message: e.message,
            source: e.source,
            date: e.sentAt,
            status: e.status
          };
        });
      })
      .catch(function () { cache.leads = []; });
  }

  function hydrate() {
    return Promise.all([loadPackages(), loadCampaigns(), loadLeads()])
      .then(function () { emit(); return cache; });
  }

  var store = {
    ready: function () {
      if (!readyPromise) readyPromise = hydrate();
      return readyPromise;
    },
    refresh: function () {
      readyPromise = hydrate();
      return readyPromise;
    },

    /* -------------------------------------------------------- packages */
    getPackages: function () { return cache.packages; },
    getPackage: function (id) {
      return cache.packages.filter(function (p) { return p.id === id; })[0] || null;
    },
    updatePackage: function (pkgId, updatedData) {
      return API.patch('/marketing/packages/' + encodeURIComponent(pkgId), updatedData)
        .then(function (r) {
          var i = cache.packages.findIndex(function (p) { return p.id === pkgId; });
          if (i !== -1) cache.packages[i] = r.package;
          emit();
          return r.package;
        });
    },

    /* ------------------------------------------------------- campaigns */
    getCampaigns: function () { return cache.campaigns; },
    getCampaignsForProperty: function (propId) {
      return cache.campaigns.filter(function (c) { return c.propertyId === propId; });
    },
    getCampaign: function (id) {
      return cache.campaigns.filter(function (c) { return c.id === id; })[0] || null;
    },
    createCampaign: function (payload) {
      return API.post('/marketing/campaigns', payload).then(function (r) {
        cache.campaigns.unshift(r.campaign);
        emit();
        return r.campaign;
      });
    },
    updateCampaignStatus: function (campId, newStatus, note) {
      return API.patch('/marketing/campaigns/' + encodeURIComponent(campId), { status: newStatus, note: note })
        .then(function (r) {
          var i = cache.campaigns.findIndex(function (c) { return c.id === campId; });
          if (i !== -1) cache.campaigns[i] = r.campaign;
          emit();
          return r.campaign;
        });
    },
    updateCampaignMetrics: function (campId, metrics) {
      return API.patch('/marketing/campaigns/' + encodeURIComponent(campId), metrics)
        .then(function (r) {
          var i = cache.campaigns.findIndex(function (c) { return c.id === campId; });
          if (i !== -1) cache.campaigns[i] = r.campaign;
          emit();
          return r.campaign;
        });
    },

    /* ----------------------------------------------------------- leads */
    getLeads: function () { return cache.leads; },
    getLeadsForProperty: function (propId) {
      return cache.leads.filter(function (l) { return l.propertyId === propId; });
    },
    updateLeadStatus: function (leadId, newStatus) {
      return API.patch('/enquiries/' + encodeURIComponent(leadId), { status: newStatus })
        .then(function () { return loadLeads().then(emit); });
    }
  };

  window.HotelzzMarketingStore = store;
})();
