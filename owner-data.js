/**
 * Hotelzz Owner Dashboard — data layer.
 *
 * Loads everything the dashboard renders (profile, properties, rooms, photos,
 * amenities, leads, reviews, offers, plan, invoices, activity) from the API in
 * one bootstrap call, and exposes write helpers that persist to the server and
 * return the refreshed property.
 */
(function () {
  var API = window.HotelzzAPI;

  var data = {
    activePropertyId: null,
    ownerProfile: { name: '', company: '', email: '', phoneMasked: '', role: 'Property Owner', avatar: '?' },
    properties: {},
    campaigns: [],
    recentActivity: [],
    loaded: false
  };

  function absorb(payload) {
    data.ownerProfile = payload.ownerProfile || data.ownerProfile;
    data.properties = payload.properties || {};
    data.campaigns = payload.campaigns || [];
    data.recentActivity = payload.recentActivity || [];
    if (!data.activePropertyId || !data.properties[data.activePropertyId]) {
      data.activePropertyId = payload.activePropertyId;
    }
    data.loaded = true;
    return data;
  }

  function absorbProperty(res) {
    if (res && res.property) data.properties[res.property.id] = res.property;
    return res && res.property;
  }

  data.load = function () {
    return API.get('/owner/bootstrap').then(absorb);
  };

  data.refresh = data.load;

  data.propertyPath = function (propId) {
    return '/owner/properties/' + encodeURIComponent(propId || data.activePropertyId);
  };

  /* --------------------------------------------------------------- writes */

  data.saveProperty = function (propId, patch) {
    return API.patch(data.propertyPath(propId), patch).then(absorbProperty);
  };

  data.saveAmenities = function (propId, amenities) {
    return API.put(data.propertyPath(propId) + '/amenities', { amenities: amenities });
  };

  data.addRoom = function (propId, room) {
    return API.post(data.propertyPath(propId) + '/rooms', room).then(absorbProperty);
  };
  data.updateRoom = function (propId, roomId, patch) {
    return API.patch(data.propertyPath(propId) + '/rooms/' + encodeURIComponent(roomId), patch).then(absorbProperty);
  };
  data.deleteRoom = function (propId, roomId) {
    return API.del(data.propertyPath(propId) + '/rooms/' + encodeURIComponent(roomId)).then(absorbProperty);
  };

  /** Uploads real image files; the server stores them and returns their URLs. */
  data.uploadPhotos = function (propId, files, category) {
    var form = new FormData();
    for (var i = 0; i < files.length; i++) form.append('photos', files[i]);
    if (category) form.append('category', category);
    return API.postForm('/uploads/properties/' + encodeURIComponent(propId || data.activePropertyId) + '/photos', form);
  };

  data.addPhoto = function (propId, photo) {
    return API.post(data.propertyPath(propId) + '/photos', photo).then(absorbProperty);
  };
  data.setCoverPhoto = function (propId, photoId) {
    return API.post(data.propertyPath(propId) + '/photos/' + encodeURIComponent(photoId) + '/cover').then(absorbProperty);
  };
  data.deletePhoto = function (propId, photoId) {
    return API.del(data.propertyPath(propId) + '/photos/' + encodeURIComponent(photoId)).then(absorbProperty);
  };

  data.addOffer = function (propId, offer) {
    return API.post(data.propertyPath(propId) + '/offers', offer).then(absorbProperty);
  };
  data.updateOffer = function (propId, offerId, patch) {
    return API.patch(data.propertyPath(propId) + '/offers/' + encodeURIComponent(offerId), patch).then(absorbProperty);
  };
  data.deleteOffer = function (propId, offerId) {
    return API.del(data.propertyPath(propId) + '/offers/' + encodeURIComponent(offerId)).then(absorbProperty);
  };

  data.changePlan = function (propId, plan) {
    return API.post(data.propertyPath(propId) + '/subscription', plan).then(absorbProperty);
  };

  data.performance = function (propId, days) {
    return API.get(data.propertyPath(propId) + '/performance?days=' + (days || 30));
  };

  window.HotelzzOwnerData = data;
})();
