/**
 * Centralized error handling.
 *
 * This file exports two middlewares. Both are mounted LAST in src/app.js,
 * after every route — order matters in Express, because a request travels
 * through middleware top to bottom.
 *
 *   notFound     -> the request matched no route at all (404)
 *   errorHandler -> something threw, anywhere in the app
 *
 * The point of this file: future controllers and services should NEVER build
 * their own error responses. They just do:
 *
 *   throw new ApiError(400, 'Email is required');   // or next(error)
 *
 * ...and this file decides the status code, the JSON shape, and what is safe
 * to reveal. One format, one place to change it.
 */
const env = require('../config/env');

/**
 * Runs only if no route above it matched the URL.
 * Turns the miss into a normal error and hands it to errorHandler below,
 * so a wrong URL returns our JSON shape instead of Express's default HTML page.
 */
function notFound(req, res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

/**
 * The catch-all error formatter.
 *
 * IMPORTANT: this function takes FOUR arguments (err, req, res, next).
 * That is how Express recognises it as an error-handling middleware rather
 * than a normal one. It is a strict rule of Express, not a style preference —
 * removing the unused `next` parameter silently breaks error handling.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Anything without a sensible status code is treated as an unexpected
  // server-side failure.
  const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;

  // A 500 means we did not anticipate this — always worth a full server log
  // (stack trace included) so it can be debugged.
  if (statusCode === 500) {
    console.error('[error] Unhandled failure:', err);
  }

  // In production, never leak internal details of an unexpected crash to the
  // client (they can expose file paths, query structure, library versions).
  // Errors we threw deliberately (400/404/etc.) have safe, intentional messages.
  const isUnexpected = statusCode === 500;
  const body = {
    success: false,
    message: isUnexpected && env.isProduction ? 'Something went wrong' : err.message,
  };

  // Stack traces are a debugging aid for you, and a gift to attackers.
  // Development only.
  if (!env.isProduction) {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
}

module.exports = { notFound, errorHandler };
