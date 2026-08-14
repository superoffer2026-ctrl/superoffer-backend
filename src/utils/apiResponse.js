/**
 * The single place that builds SUCCESS responses.
 * (Errors are formatted in src/middleware/error.middleware.js, because every
 * error in the app funnels through that one middleware.)
 *
 * Every successful response in SuperOffer looks like this:
 *
 *   { "success": true, "message": "...", "data": { ... } }
 *
 * Keeping that shape in one function means the frontend can rely on it, and
 * we can't accidentally send `{ ok: true }` from one controller and
 * `{ success: true }` from another.
 */

/**
 * @param {object} res       Express response object
 * @param {object} options
 * @param {number} [options.statusCode=200]  HTTP status (201 for "created", etc.)
 * @param {string} [options.message='Success']
 * @param {*}      [options.data=null]       Omitted from the JSON when null
 */
function sendSuccess(res, { statusCode = 200, message = 'Success', data = null } = {}) {
  const body = { success: true, message };

  // Only include `data` when there is actually something to send, so simple
  // responses stay clean instead of carrying a pointless "data": null.
  if (data !== null) {
    body.data = data;
  }

  return res.status(statusCode).json(body);
}

module.exports = { sendSuccess };
