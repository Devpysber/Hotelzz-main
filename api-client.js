/**
 * Hotelzz — shared browser API client.
 * Talks to the Express backend on the same origin; the session lives in an
 * httpOnly cookie, so nothing sensitive is kept in localStorage.
 */
(function () {
  var BASE = '/api';

  function request(method, path, body) {
    return fetch(BASE + path, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.ok === false) {
          var err = new Error(data.error || 'Request failed (' + res.status + ')');
          err.status = res.status;
          err.field = data.field;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  var API = {
    get: function (p) { return request('GET', p); },
    post: function (p, b) { return request('POST', p, b); },
    patch: function (p, b) { return request('PATCH', p, b); },
    put: function (p, b) { return request('PUT', p, b); },
    del: function (p) { return request('DELETE', p); },

    /** Multipart POST — used for image uploads. Do not set Content-Type. */
    postForm: function (path, formData) {
      return fetch(BASE + path, { method: 'POST', credentials: 'same-origin', body: formData })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok || data.ok === false) {
              var err = new Error(data.error || 'Upload failed (' + res.status + ')');
              err.status = res.status;
              throw err;
            }
            return data;
          });
        });
    },

    auth: {
      me: function () { return request('GET', '/auth/me'); },
      login: function (role, identifier, password) {
        return request('POST', '/auth/login', { role: role, identifier: identifier, password: password });
      },
      registerTraveler: function (payload) { return request('POST', '/auth/register/traveler', payload); },
      registerOwner: function (payload) { return request('POST', '/auth/register/owner', payload); },
      requestOtp: function (identifier, role) { return request('POST', '/auth/otp/request', { identifier: identifier, role: role || 'owner' }); },
      verifyOtp: function (identifier, code, role) { return request('POST', '/auth/otp/verify', { identifier: identifier, code: code, role: role || 'owner' }); },
      forgotPassword: function (email, role) { return request('POST', '/auth/password/forgot', { email: email, role: role || 'traveler' }); },
      resetPassword: function (payload) { return request('POST', '/auth/password/reset', payload); },
      changePassword: function (currentPassword, password) { return request('POST', '/auth/password/change', { currentPassword: currentPassword, password: password }); },
      updateProfile: function (payload) { return request('PATCH', '/auth/me', payload); },
      logout: function () { return request('POST', '/auth/logout'); }
    },

    payments: {
      config: function () { return request('GET', '/payments/config'); },
      createOrder: function (payload) { return request('POST', '/payments/orders', payload); },
      verify: function (payload) { return request('POST', '/payments/verify', payload); },
      mine: function () { return request('GET', '/payments/mine'); },

      /**
       * Runs the whole purchase: creates the order, opens Razorpay checkout when
       * a gateway is configured, and verifies the result. In manual mode it
       * resolves immediately with what the customer should expect next.
       */
      checkout: function (payload) {
        return API.payments.createOrder(payload).then(function (res) {
          var order = res.order;
          if (order.mode === 'manual') return { mode: 'manual', message: order.message, order: order };

          return new Promise(function (resolve, reject) {
            if (!window.Razorpay) return reject(new Error('Payment library did not load. Refresh and try again.'));
            var rzp = new window.Razorpay({
              key: order.keyId,
              order_id: order.orderId,
              amount: order.amountMinor,
              currency: order.currency,
              name: 'Hotelzz.in',
              description: payload.purpose === 'campaign' ? 'Marketing campaign' : 'Subscription',
              handler: function (response) {
                API.payments.verify({
                  orderId: response.razorpay_order_id,
                  paymentId: response.razorpay_payment_id,
                  signature: response.razorpay_signature
                }).then(function (v) { resolve({ mode: 'paid', payment: v.payment }); }).catch(reject);
              },
              modal: { ondismiss: function () { reject(new Error('Payment cancelled.')); } }
            });
            rzp.open();
          });
        });
      }
    },

    /**
     * Guard a portal page. Redirects to the login page when the visitor is not
     * signed in with one of the allowed roles. Resolves with the user.
     */
    requireRole: function (roles, loginType) {
      var allowed = [].concat(roles);
      return API.auth.me().then(function (r) {
        if (!r.user || allowed.indexOf(r.user.role) === -1) {
          window.location.href = 'login.html?type=' + (loginType || allowed[0]) + '&next=' +
            encodeURIComponent(window.location.pathname + window.location.search);
          return null;
        }
        window.HZ_USER = r.user;
        return r.user;
      }).catch(function () {
        window.location.href = 'login.html?type=' + (loginType || allowed[0]);
        return null;
      });
    }
  };

  window.HotelzzAPI = API;
})();
