/**
 * Hotelzz shared store — server backed.
 *
 * Keeps the synchronous getter API the portal pages were written against
 * (getUser / getEnquiries / getReviews / getSavedHotels) by holding a local
 * cache, while every read and write actually goes to the Express API.
 *
 * Pages must wait for hydration before their first render:
 *     HotelzzEnquiryStore.ready().then(renderEverything)
 *
 * Mutators return promises and refresh the cache, then fire a
 * `hotelzz:store-updated` event on window so open views can re-render.
 */
(function () {
  var API = window.HotelzzAPI;

  var cache = {
    user: { isLoggedIn: false },
    enquiries: [],
    reviews: [],
    saved: [],
    savedDetails: []
  };
  var readyPromise = null;

  function emit() {
    try { window.dispatchEvent(new CustomEvent('hotelzz:store-updated', { detail: cache })); } catch (e) {}
  }

  function shapeUser(u) {
    if (!u) return { isLoggedIn: false };
    return {
      id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone,
      city: u.city, avatar: u.avatar || (u.name || '?').charAt(0).toUpperCase(),
      isLoggedIn: true
    };
  }

  function loadEnquiries() {
    return API.get('/enquiries?limit=200')
      .then(function (r) { cache.enquiries = r.enquiries || []; })
      .catch(function () { cache.enquiries = []; });
  }

  function loadReviews() {
    var path = cache.user.role === 'traveler' ? '/reviews?mine=true&limit=200' : '/reviews?limit=200';
    return API.get(path)
      .then(function (r) { cache.reviews = r.reviews || []; })
      .catch(function () { cache.reviews = []; });
  }

  function loadSaved() {
    if (!cache.user.isLoggedIn) { cache.saved = []; cache.savedDetails = []; return Promise.resolve(); }
    return API.get('/saved')
      .then(function (r) { cache.saved = r.ids || []; cache.savedDetails = r.saved || []; })
      .catch(function () { cache.saved = []; cache.savedDetails = []; });
  }

  function hydrate() {
    return API.auth.me()
      .then(function (r) { cache.user = shapeUser(r.user); })
      .catch(function () { cache.user = { isLoggedIn: false }; })
      .then(function () {
        if (!cache.user.isLoggedIn) return null;
        return Promise.all([loadEnquiries(), loadReviews(), loadSaved()]);
      })
      .then(function () { emit(); return cache; });
  }

  var store = {
    /** Resolves once the cache holds live server data. Safe to call repeatedly. */
    ready: function () {
      if (!readyPromise) readyPromise = hydrate();
      return readyPromise;
    },
    refresh: function () {
      readyPromise = hydrate();
      return readyPromise;
    },

    /* ------------------------------------------------------------- user */
    getUser: function () { return cache.user; },
    isLoggedIn: function () { return !!cache.user.isLoggedIn; },
    saveUser: function (userObj) {
      return API.auth.updateProfile({ name: userObj.name, phone: userObj.phone, city: userObj.city })
        .then(function (r) { cache.user = shapeUser(r.user); emit(); return cache.user; });
    },
    login: function (name, email, phone) {
      // Kept for backwards compatibility — real sign-in happens on login.html.
      console.warn('[Hotelzz] store.login() is deprecated; use login.html / HotelzzAPI.auth.login().');
      return cache.user;
    },
    logout: function () {
      return API.auth.logout().then(function () {
        cache.user = { isLoggedIn: false };
        cache.enquiries = []; cache.reviews = []; cache.saved = [];
        emit();
      });
    },

    /* -------------------------------------------------------- enquiries */
    getEnquiries: function () { return cache.enquiries; },
    getEnquiriesForUser: function (userId) {
      return cache.enquiries.filter(function (e) { return !userId || e.userId === userId; });
    },
    getEnquiriesForProperty: function (propId) {
      return cache.enquiries.filter(function (e) { return e.propertyId === propId; });
    },
    getEnquiry: function (id) {
      return API.get('/enquiries/' + encodeURIComponent(id)).then(function (r) {
        var i = cache.enquiries.findIndex(function (e) { return e.id === r.enquiry.id; });
        if (i !== -1) cache.enquiries[i] = r.enquiry;
        return r.enquiry;
      });
    },

    sendEnquiry: function (data) {
      var user = cache.user;
      return API.post('/enquiries', {
        propertyId: data.propertyId,
        propertyName: data.propertyName,
        propertyCity: data.propertyCity,
        name: data.name || user.name,
        email: data.email || user.email,
        phone: data.phone || user.phone,
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        guests: data.guests || 2,
        message: data.message,
        source: data.source || 'portal'
      }).then(function (r) {
        cache.enquiries.unshift(r.enquiry);
        emit();
        return r.enquiry;
      });
    },

    markOpenedByOwner: function (enqId) {
      return API.post('/enquiries/' + encodeURIComponent(enqId) + '/open')
        .then(function (r) { return replaceEnquiry(r.enquiry); });
    },

    markRespondedByOwner: function (enqId, responseText) {
      return API.post('/enquiries/' + encodeURIComponent(enqId) + '/respond', { response: responseText })
        .then(function (r) { return replaceEnquiry(r.enquiry); });
    },

    setEnquiryStatus: function (enqId, status) {
      return API.patch('/enquiries/' + encodeURIComponent(enqId), { status: status })
        .then(function (r) { return replaceEnquiry(r.enquiry); });
    },

    /* ---------------------------------------------------------- reviews */
    getReviews: function () { return cache.reviews; },
    getReviewsForProperty: function (propId) {
      return API.get('/reviews?propertyId=' + encodeURIComponent(propId)).then(function (r) { return r; });
    },
    submitReview: function (reviewObj) {
      return API.post('/reviews', {
        propertyId: reviewObj.propertyId,
        propertyName: reviewObj.propertyName,
        enquiryId: reviewObj.enquiryId,
        rating: reviewObj.rating,
        comment: reviewObj.comment,
        cleanliness: reviewObj.cleanliness,
        service: reviewObj.service,
        location: reviewObj.location,
        amenities: reviewObj.amenities,
        value: reviewObj.value
      }).then(function (r) {
        cache.reviews.unshift(r.review);
        if (reviewObj.enquiryId) {
          var e = cache.enquiries.find(function (x) { return x.id === reviewObj.enquiryId; });
          if (e) { e.reviewId = r.review.id; e.isEligibleForReview = false; }
        }
        emit();
        return r.review;
      });
    },
    replyToReview: function (reviewId, reply) {
      return API.post('/reviews/' + encodeURIComponent(reviewId) + '/reply', { reply: reply })
        .then(function (r) {
          var i = cache.reviews.findIndex(function (x) { return x.id === r.review.id; });
          if (i !== -1) cache.reviews[i] = r.review;
          emit();
          return r.review;
        });
    },

    /* ----------------------------------------------------- saved hotels */
    getSavedHotels: function () { return cache.saved; },
    getSavedHotelDetails: function () { return cache.savedDetails; },
    isSaved: function (propId) { return cache.saved.indexOf(propId) !== -1; },
    toggleSavedHotel: function (propId) {
      // Optimistic so a heart button flips instantly; reconciled from the response.
      var i = cache.saved.indexOf(propId);
      if (i === -1) cache.saved.push(propId); else cache.saved.splice(i, 1);
      emit();
      return API.post('/saved/' + encodeURIComponent(propId) + '/toggle')
        .then(function (r) { return loadSaved().then(function () { emit(); return r.saved; }); })
        .catch(function (err) { return loadSaved().then(function () { emit(); throw err; }); });
    },

    /* ------------------------------------------------------- properties */
    searchProperties: function (params) {
      var qs = Object.keys(params || {})
        .filter(function (k) { return params[k] !== undefined && params[k] !== ''; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
        .join('&');
      return API.get('/properties' + (qs ? '?' + qs : ''));
    },
    getProperty: function (id) {
      return API.get('/properties/' + encodeURIComponent(id));
    }
  };

  function replaceEnquiry(enq) {
    var i = cache.enquiries.findIndex(function (e) { return e.id === enq.id; });
    if (i !== -1) cache.enquiries[i] = enq; else cache.enquiries.unshift(enq);
    emit();
    return enq;
  }

  window.HotelzzEnquiryStore = store;
  window.HotelzzStore = store;
})();
