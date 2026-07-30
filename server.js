import { createApp } from './app.js';
import { MongoUserStore } from './repositories/mongo-user-store.js';
import { InMemoryUserStore } from './repositories/user-store.js';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
let userStore = new InMemoryUserStore();
let persistence = 'memory';
const mongodbUri = process.env.MONGODB_ATLAS_URI || process.env.MONGODB_URI;

if (mongodbUri) {
  try {
    userStore = await new MongoUserStore(
      mongodbUri,
      process.env.MONGODB_DATABASE || 'superoffer'
    ).connect();
    persistence = 'mongodb';
  } catch (error) {
    if (process.env.MONGODB_REQUIRED === 'true') throw error;
    console.error(JSON.stringify({
      level: 'error',
      event: 'mongodb_connection_failed',
      message: error.message,
      fallback: 'memory',
      timestamp: new Date().toISOString()
    }));
  }
}

const { app } = createApp({ userStore });

const server = app.listen(port, host, () => {
  console.info(JSON.stringify({
    level: 'info',
    event: 'server_started',
    service: 'superoffer-auth',
    persistence,
    host,
    port,
    timestamp: new Date().toISOString()
  }));
});

const shutdown = signal => {
  console.info(JSON.stringify({ level: 'info', event: 'server_stopping', signal }));
  server.close(async () => {
    await userStore.close?.();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
