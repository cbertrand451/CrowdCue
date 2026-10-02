import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { setGlobalProxyFromEnv } from 'node:http';
import { readAuthConfig } from './auth/config.js';
import { TokenCipher } from './auth/crypto.js';
import { PostgresAuthStore } from './auth/store.js';
import { AuthService } from './auth/service.js';
import { SpotifyClient } from './spotify/client.js';
import { createDatabase } from './db/index.js';
import { PostgresPartyStore } from './parties/store.js';

const config = readConfig(
  process.argv.includes('--production')
    ? { ...process.env, NODE_ENV: 'production' }
    : process.env,
);
// Respect managed HTTPS proxies and their configured CA trust for Spotify fetches.
try {
  setGlobalProxyFromEnv();
} catch {
  throw new Error('Invalid outbound proxy configuration');
}
const authConfig = readAuthConfig({
  ...process.env,
  NODE_ENV: config.NODE_ENV,
});
const pool = authConfig ? createDatabase(authConfig.databaseUrl) : undefined;
const auth =
  authConfig && pool
    ? new AuthService(
        authConfig,
        new PostgresAuthStore(
          pool,
          new TokenCipher(authConfig.keyId, authConfig.keys),
        ),
        new SpotifyClient(authConfig),
      )
    : undefined;
const app = buildApp(config, {
  serveFrontend: config.NODE_ENV === 'production',
  auth,
  parties:
    authConfig && pool
      ? new PostgresPartyStore(
          pool,
          new TokenCipher(authConfig.keyId, authConfig.keys),
          authConfig.appOrigin,
        )
      : undefined,
});
if (pool) {
  pool.on('error', () => app.log.error('Database connection interrupted'));
  app.addHook('onClose', async () => {
    await pool.end();
  });
}
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
