/**
 * Health-check controller.
 *
 * A controller's job is narrow: read the request, call a service if needed,
 * send a response. No database queries, no business rules — those belong in
 * src/services/ and src/models/ as the app grows.
 *
 * This one has no service to call, because "is the server awake?" needs no
 * business logic at all.
 */
const { sendSuccess } = require('../utils/apiResponse');

function getHealth(req, res) {
  sendSuccess(res, { message: 'SuperOffer API is running' });
}

module.exports = { getHealth };
