import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const { app, repository } = createApp();
const server = app.listen(port, host, () => {
  console.info(JSON.stringify({
    level: 'info',
    event: 'server_started',
    framework: 'express',
    service: 'superoffer-backend',
    host,
    port,
    database_mode: repository.mode,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  }));
});

const shutdown = signal => {
  console.info(JSON.stringify({ level: 'info', event: 'server_stopping', signal, timestamp: new Date().toISOString() }));
  server.close(async () => {
    await repository.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
