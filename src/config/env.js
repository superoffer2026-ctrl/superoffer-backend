/**
 * Environment configuration.
 *
 * This file is the ONLY place in the app that reads `process.env` directly.
 * Everywhere else does `const env = require('./config/env')` and reads
 * `env.port`, `env.mongodbUri`, etc.
 *
 * Why bother? Two reasons:
 *
 * 1. Fail fast. If MONGODB_URI is missing, we find out the instant the app
 *    starts, with a message that tells you how to fix it. The alternative is
 *    a confusing crash later, deep inside Mongoose, saying something like
 *    "uri must be a string".
 *
 * 2. One source of truth. If we ever rename a variable, we change it here
 *    and nowhere else.
 */
const dotenv = require('dotenv');

// Reads the .env file (if present) and copies its values into process.env.
// In production (e.g. Render, Railway, AWS) there is usually no .env file —
// the host sets real environment variables instead, and this line simply
// does nothing. That is intentional and correct.
dotenv.config();

// Variables the app genuinely cannot run without.
// PORT and NODE_ENV are NOT here because they have safe defaults below.
const REQUIRED_VARS = ['MONGODB_URI'];

const missing = REQUIRED_VARS.filter(
  (key) => !process.env[key] || process.env[key].trim() === ''
);

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variable(s): ${missing.join(', ')}.\n` +
      'Fix: copy .env.example to .env and fill in real values.'
  );
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  mongodbUri: process.env.MONGODB_URI,
  isProduction: process.env.NODE_ENV === 'production',
};

// Object.freeze prevents any other file from accidentally overwriting config
// at runtime (e.g. `env.port = 3000`). Config should be read-only after startup.
module.exports = Object.freeze(env);
