'use strict';
/**
 * Who may manage a listing.
 *
 * A partner who registered the hotel themselves (ids made by uid('prop')) runs
 * it straight away. A partner who *claimed* an existing listing can see it in
 * their dashboard but may not edit it, upload to it or receive its guest
 * enquiries until the Hotelzz team verifies the claim — otherwise anyone could
 * claim a hotel and take over its page and its guests' details.
 */
const selfRegistered = (row) => /^prop_/.test(String(row.id));

function canManage(row) {
  return !!row && (row.claim_status === 'verified' || selfRegistered(row));
}

/** A listing someone else already manages or has a claim pending on. */
function heldByAnother(row, userId) {
  return !!(row && row.owner_id && row.owner_id !== userId && row.claim_status !== 'rejected');
}

const PENDING_MESSAGE = 'Your claim on this listing is still being verified. You can edit it as soon as the Hotelzz team approves it (usually within 24 hours).';

module.exports = { canManage, heldByAnother, selfRegistered, PENDING_MESSAGE };
