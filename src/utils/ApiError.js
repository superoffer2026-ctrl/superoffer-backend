/**
 * An Error that also carries an HTTP status code.
 *
 * Plain JavaScript errors only have a message. That leaves controllers with a
 * problem: how does the error handler know whether a failure should be a 404
 * ("student not found") or a 400 ("email is invalid") or a 500 (a real bug)?
 *
 * With this class, any file anywhere can write:
 *
 *   throw new ApiError(404, 'Student not found');
 *
 * ...and the central error middleware turns it into the correct HTTP status
 * and the standard JSON shape. The controller never builds a response itself.
 */
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);

    this.statusCode = statusCode;

    // Marks this as an error WE threw on purpose, as opposed to an unexpected
    // crash (a typo, a null reference). The error middleware uses this to
    // decide whether the message is safe to show the client in production.
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
