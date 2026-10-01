import { buildApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig(
  process.argv.includes('--production')
    ? { ...process.env, NODE_ENV: 'production' }
    : process.env,
);
const app = buildApp(config, {
  serveFrontend: config.NODE_ENV === 'production',
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  });
}
try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch {
  app.log.fatal(
    'Unable to start CrowdCue; check the host, port and frontend build.',
  );
  process.exitCode = 1;
}
