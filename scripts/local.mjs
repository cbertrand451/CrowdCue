// Cross-platform launcher: Node is the only prerequisite. Never print secrets.
import { randomBytes } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { writeFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { startLocalDatabase, availablePort } from './local-database.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const testing = process.argv.includes('--test');
const setupOnly = process.argv.includes('--setup');
const children = new Set();
let database;
let closing = false;

function launch(args) {
  const child = spawn(process.execPath, args, {
    env: process.env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

async function run(args) {
  const child = launch(args);
  const [code] = await once(child, 'exit');
  if (code !== 0)
    throw new Error(
      'A startup check failed. Review the safe error message above.',
    );
}

async function cleanup(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  const stops = [...children].map(async (child) => {
    const exited = once(child, 'exit');
    if (process.platform === 'win32') {
      const killer = spawn(
        'taskkill',
        ['/pid', String(child.pid), '/t', '/f'],
        { stdio: 'ignore' },
      );
      await once(killer, 'exit');
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* Already exited. */
      }
    }
    await exited;
  });
  await Promise.all(stops);
  await database?.stop();
  // embedded-postgres hooks beforeExit with status 0; preserve actual failures.
  process.exit(code);
}

// The bundled database library also stops its own process on exit.
process.on('SIGINT', () => {
  void cleanup();
});
process.on('SIGTERM', () => {
  void cleanup();
});

try {
  try {
    await access('.env');
    loadEnvFile('.env');
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error('Cannot read .env. Check its syntax and permissions.', {
        cause: error,
      });
  }
  if (!testing) {
    try {
      await writeFile(
        '.env.token-key',
        `TOKEN_ENCRYPTION_KEY_ID=v1\nTOKEN_ENCRYPTION_KEYS='${JSON.stringify({ v1: randomBytes(32).toString('base64') })}'\n`,
        { flag: 'wx', mode: 0o600 },
      );
      console.log(
        'Created a private local encryption key. Keep .env.token-key with your data.',
      );
    } catch (error) {
      if (error.code !== 'EEXIST')
        throw new Error('Cannot create the local encryption key file.', {
          cause: error,
        });
    }
    loadEnvFile('.env.token-key');
    process.env.NODE_ENV = 'development';
    process.env.HOST ||= '127.0.0.1';
    process.env.PORT ||= '3000';
    process.env.APP_ORIGIN ||= 'http://127.0.0.1:5173';
    process.env.SPOTIFY_REDIRECT_URI ||=
      process.env.SPOTIFY_REDIRECT_URL ||
      `${process.env.APP_ORIGIN}/api/auth/spotify/callback`;
    process.env.SPOTIFY_AUTH_ENABLED ||=
      process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET
        ? 'true'
        : 'false';
    process.env.API_PROXY_TARGET ||= `http://127.0.0.1:${process.env.PORT}`;
    if (!setupOnly) {
      await availablePort(Number(process.env.PORT), process.env.HOST);
      await availablePort(5173);
    }
  }
  if (testing ? !process.env.TEST_DATABASE_URL : !process.env.DATABASE_URL) {
    database = await startLocalDatabase({
      directory: testing ? 'data/tests' : 'data/local',
      port: Number(
        process.env.LOCAL_DATABASE_PORT || (testing ? 55433 : 55432),
      ),
    });
    process.env.DATABASE_URL = database.databaseUrl;
    process.env.TEST_DATABASE_URL = database.testDatabaseUrl;
    console.log(
      'Bundled database ready. No separate PostgreSQL install needed.',
    );
  }
  if (testing) {
    await run(['node_modules/vitest/vitest.mjs', 'run']);
    await cleanup();
  } else {
    await run(['node_modules/tsx/dist/cli.mjs', 'src/server/db/cli.ts']);
    if (setupOnly) {
      console.log(
        'Local database and encryption key are ready. Run npm run local to open the app.',
      );
      await cleanup();
    } else {
      if (process.env.SPOTIFY_AUTH_ENABLED !== 'true')
        console.log(
          'Spotify is not configured. Add your app credentials to .env for party creation and live music requests.',
        );
      console.log(
        'Starting CrowdCue at http://127.0.0.1:5173 — press Ctrl+C to stop.',
      );
      for (const args of [
        ['node_modules/tsx/dist/cli.mjs', 'src/server/index.ts'],
        ['node_modules/vite/bin/vite.js'],
      ]) {
        const child = launch(args);
        child.once('exit', (code) => {
          if (!closing) void cleanup(code || 0);
        });
        child.once('error', () => {
          console.error('Could not start a local app process.');
          void cleanup(1);
        });
      }
    }
  }
} catch (error) {
  // Do not print provider/driver messages or environment values.
  const safe =
    error instanceof Error &&
    (error.message.startsWith('Port ') ||
      error.message.startsWith('Choose a local port') ||
      error.message.startsWith('Cannot ') ||
      error.message.startsWith('Local database settings') ||
      error.message.startsWith('A startup check'))
      ? error.message
      : 'Local startup failed. Use Node 24 as a normal user, enable npm install scripts, and check that the data folder is writable. Preserve existing data and encryption keys.';
  console.error(safe);
  await cleanup(1);
}
