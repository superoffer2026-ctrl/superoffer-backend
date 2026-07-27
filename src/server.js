import { createApp } from './app.js';
import { MongoUserStore } from './mongo-user-store.js';
import { InMemoryUserStore } from './user-store.js';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const userStore = process.env.MONGODB_URI
  ? await new MongoUserStore(
      process.env.MONGODB_URI,
      process.env.MONGODB_DATABASE || 'superoffer'
    ).connect()
  : new InMemoryUserStore();
const { app } = createApp({ userStore });

const server = app.listen(port, host, () => {
  console.info(JSON.stringify({
    level: 'info',
    event: 'server_started',
    service: 'superoffer-auth',
    persistence: process.env.MONGODB_URI ? 'mongodb' : 'memory',
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
