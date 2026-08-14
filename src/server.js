/**
 * Application entry point — the file `npm run dev` and `npm start` execute.
 *
 * Its single responsibility is the STARTUP SEQUENCE, in this exact order:
 *
 *   1. Load + validate environment config   (requiring ./config/env does this)
 *   2. Connect to MongoDB Atlas
 *   3. Only then, start accepting HTTP requests
 *
 * Step 3 happens last on purpose. If we started listening first, the API
 * would accept requests during the seconds before the database was ready,
 * and those requests would fail in confusing ways.
 */
const env = require('./config/env');
const app = require('./app');
const { connectDatabase, disconnectDatabase } = require('./config/database');

async function startServer() {
  try {
    await connectDatabase();

    const server = app.listen(env.port, () => {
      console.log(`[server] SuperOffer API running in ${env.nodeEnv} mode`);
      console.log(`[server] Health check: http://localhost:${env.port}/api/v1/health`);
    });

    /**
     * Graceful shutdown.
     *
     * When you press Ctrl+C (SIGINT), or a host like Render stops the app
     * (SIGTERM), we finish in-flight requests and close the database
     * connection instead of vanishing mid-request.
     */
    const shutdown = async (signal) => {
      console.log(`\n[server] ${signal} received. Shutting down gracefully...`);

      server.close(async () => {
        await disconnectDatabase();
        console.log('[server] Shutdown complete.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    // Reached if config is invalid or MongoDB is unreachable.
    // Exit code 1 tells the operating system (and any host/process manager)
    // that this was a failure, not a normal exit.
    console.error(`[server] Startup failed: ${error.message}`);
    process.exit(1);
  }
}

startServer();
