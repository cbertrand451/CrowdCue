import { cloudEnvironment } from './cloud.js';

try {
  Object.assign(process.env, cloudEnvironment(process.env));
  // Free Render services have no pre-deploy step. The migration runner already
  // serializes concurrent starts with a PostgreSQL transaction advisory lock.
  await import('./db/cli.js');
  if (process.exitCode) throw new Error('Migration failed');
  await import('./index.js');
} catch {
  // Configuration/driver errors can contain secrets. Never print raw errors.
  console.error(
    'Cloud startup failed. Check hosting environment settings, database TLS/connectivity and migration history.',
  );
  process.exitCode = 1;
}
