/**
 * Builds and configures the Express application.
 *
 * This file describes WHAT the app is: which middleware runs, which routes
 * exist, how errors are handled.
 *
 * It deliberately does NOT:
 *   - connect to MongoDB
 *   - call app.listen()
 *
 * Both of those are startup actions, and they live in src/server.js.
 * See the README for why that separation matters.
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const env = require('./config/env');
const healthRoutes = require('./routes/health.routes');
const { notFound, errorHandler } = require('./middleware/error.middleware');

const app = express();

/* ------------------------------------------------------------------ *
 * Security
 * ------------------------------------------------------------------ */

// Sets a range of protective HTTP headers (blocks clickjacking, stops
// browsers guessing content types, etc.). Sensible defaults; no config needed.
app.use(helmet());

// CORS decides which websites are allowed to call this API from a browser.
// Without it, the Angular app on localhost:4200 cannot talk to this API on
// localhost:5000 — browsers block cross-origin requests by default.
//
// We list the development frontend explicitly rather than allowing every
// origin, because a wildcard would let ANY website on the internet call this
// API using a logged-in user's browser. Add your deployed frontend URL to
// this array when you deploy.
const allowedOrigins = ['http://localhost:4200', 'http://127.0.0.1:4200'];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true, // needed later, once auth cookies/tokens exist
  })
);

/* ------------------------------------------------------------------ *
 * Request parsing
 * ------------------------------------------------------------------ */

// Reads a JSON request body and puts it on req.body.
// The size limit stops someone sending a huge payload to exhaust memory.
app.use(express.json({ limit: '10kb' }));

// Reads HTML-form-style bodies (key=value&key2=value2).
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

/* ------------------------------------------------------------------ *
 * Request logging
 * ------------------------------------------------------------------ */

// Logs each request to the console. 'dev' format is short and colourful.
// Skipped in production, where noisy per-request logging is expensive and
// a proper logging service is used instead.
if (!env.isProduction) {
  app.use(morgan('dev'));
}

/* ------------------------------------------------------------------ *
 * Routes  (everything lives under /api/v1 — see README on versioning)
 * ------------------------------------------------------------------ */

app.use('/api/v1/health', healthRoutes);

/* ------------------------------------------------------------------ *
 * Error handling  — MUST be last, after all routes
 * ------------------------------------------------------------------ */

app.use(notFound); // no route matched -> 404
app.use(errorHandler); // anything threw -> consistent JSON error

module.exports = app;
