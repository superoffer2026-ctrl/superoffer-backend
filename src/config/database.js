/**
 * MongoDB Atlas connection (via Mongoose).
 *
 * This file knows how to open and close a database connection — nothing else.
 * It deliberately defines NO data models (no students, no universities).
 * Models arrive in later steps, one feature at a time.
 */
const mongoose = require('mongoose');
const env = require('./env');

/**
 * Opens the connection. Called once, from src/server.js, before the HTTP
 * server starts listening.
 *
 * Throws if the connection fails, so the caller can decide what to do.
 * (server.js chooses to log and exit — better to crash loudly at startup
 * than to run a server whose every database call will fail.)
 */
async function connectDatabase() {
  try {
    await mongoose.connect(env.mongodbUri);

    // Log the database NAME only. We never log env.mongodbUri itself,
    // because the connection string contains your username and password.
    console.log(`[database] Connected to MongoDB. Database: "${mongoose.connection.name}"`);
  } catch (error) {
    console.error('[database] Could not connect to MongoDB.');

    // Mongoose connection errors sometimes include the full connection string
    // (and therefore your password) in the message. Safe to show while you're
    // developing on your own machine; never in production logs, which are
    // often stored or shipped to third-party services.
    if (!env.isProduction) {
      console.error(`[database] Reason: ${error.message}`);
      console.error(
        '[database] Common causes: wrong password in MONGODB_URI, or your ' +
          'current IP address is not allowed in Atlas -> Network Access.'
      );
    }

    throw error;
  }

  // The two listeners below handle problems that happen AFTER a successful
  // connect — for example, losing wifi. Without them these events are silent.
  mongoose.connection.on('error', (error) => {
    console.error(`[database] Connection error: ${error.message}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[database] Disconnected from MongoDB.');
  });
}

/**
 * Closes the connection cleanly. Used during shutdown, and later by tests.
 */
async function disconnectDatabase() {
  await mongoose.disconnect();
}

module.exports = { connectDatabase, disconnectDatabase };
