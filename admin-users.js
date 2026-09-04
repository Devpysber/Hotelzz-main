/**
 * Hotelzz Admin — User Management.
 * Every account, any role (traveler/owner/admin) — the rest of the panel
 * only ever surfaced owners (Hotel Owners) and admins (Admin Users);
 * travelers had no admin view at all. Self-contained: fetches its own data
 * from /api/admin/users rather than riding the main bootstrap payload.
 */
(function () {
  var API = window.HotelzzAPI;

  var ROLE_LABEL = { traveler: 'Traveler', owner: 'Owner', admin: 'Admin' };
  var ROLE_BADGE = { traveler: 'badge-info', owner: 'badge-success', admin: 'badge-gray' };
  var STATUS_BADGE = { active: 'badge-success', pending: 'badge-warning', suspended: 'badge-danger' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
    });
  }

  /** Called every time the User Management view opens — cheap query, always fresh. */
  window.initUsersView = function () {
    window.loadUsersTable();
  };

  window.loadUsersTable = function () {
    var tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    var q = (document.getElementById('userSearchInput') || {}).value || '';
    var role = (document.getElementById('userRoleFilter') || {}).value || '';
    var status = (document.getElementById('userStatusFilter') || {}).value || '';

    var params = new URLSearchParams({ limit: '300' });
    if (q.trim()) params.set('q', q.trim());
    if (role) params.set('role', role);
    if (status) params.set('status', status);

    API.get('/admin/users?' + params.toString()).then(function (r) {
      var c = r.counts || {};
      var setCount = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = (v == null ? '—' : v); };
      setCount('userCountTraveler', c.traveler);
      setCount('userCountOwner', c.owner);
      setCount('userCountAdmin', c.admin);

      tbody.innerHTML = (r.users || []).map(function (u) {
        var nextStatus = u.status === 'suspended' ? 'active' : 'suspended';
        var actionLabel = u.status === 'suspended' ? 'Reactivate' : 'Suspend';
        return '<tr>' +
          '<td style="font-weight:700;">' + esc(u.name) + '</td>' +
          '<td><span class="badge ' + (ROLE_BADGE[u.role] || 'badge-gray') + '">' + (ROLE_LABEL[u.role] || u.role) + '</span></td>' +
          '<td>' + esc(u.email) + '</td>' +
          '<td>' + esc(u.phone || '—') + '</td>' +
          '<td>' + esc(u.city || '—') + '</td>' +
          '<td>' + (u.properties == null ? '—' : u.properties) + '</td>' +
          '<td>' + (u.emailVerified ? '<span class="badge badge-success">Verified</span>' : '<span class="badge badge-warning">Pending</span>') + '</td>' +
          '<td>' + window.hzFormatDate(u.createdAt) + '</td>' +
          '<td>' + (u.lastActive ? window.hzFormatDate(u.lastActive) : '—') + '</td>' +
          '<td><span class="badge ' + (STATUS_BADGE[u.status] || 'badge-gray') + '">' + u.status + '</span></td>' +
          '<td><button class="btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="toggleUserStatus(\'' + u.id + '\', \'' + nextStatus + '\', \'' + esc(u.name).replace(/'/g, "\\'") + '\')">' + actionLabel + '</button></td>' +
          '</tr>';
      }).join('') || '<tr><td colspan="11" style="text-align:center; color:var(--admin-text-muted);">No accounts match.</td></tr>';
    }).catch(function (err) { showToast(err.message || 'Could not load users.', 'danger'); });
  };

  window.toggleUserStatus = function (userId, nextStatus, name) {
    var verb = nextStatus === 'suspended' ? 'suspend' : 'reactivate';
    if (!window.confirm('Really ' + verb + ' ' + name + '\'s account?')) return;
    window.HotelzzAdminData.updateUserStatus(userId, nextStatus).then(function () {
      showToast(name + '\'s account is now ' + nextStatus + '.');
      window.loadUsersTable();
    }).catch(function (err) { showToast(err.message || 'Could not update that account.', 'danger'); });
  };
})();
