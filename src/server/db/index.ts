import pg from 'pg';
import type { PoolClient } from 'pg';
import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { DatabaseConfigurationError } from './diagnostics.js';

export function databaseOptions(
  connectionString: string,
  env: NodeJS.ProcessEnv = process.env,
): pg.PoolConfig {
  if (env.DATABASE_SSL && !['true', 'false'].includes(env.DATABASE_SSL))
    throw new DatabaseConfigurationError('DATABASE_SSL');
  const tls = env.DATABASE_SSL === 'true' || !!env.DATABASE_SSL_CA;
  let ssl: pg.PoolConfig['ssl'];
  if (tls) {
    const ca = env.DATABASE_SSL_CA?.replaceAll('\\n', '\n').trim();
    if (ca) {
      try {
        new X509Certificate(ca);
      } catch {
        throw new DatabaseConfigurationError('DATABASE_SSL_CA');
      }
    }
    try {
      const url = new URL(connectionString);
      if (!['postgres:', 'postgresql:'].includes(url.protocol))
        throw new Error();
      if (
        ['disable', 'no-verify'].includes(url.searchParams.get('sslmode') || '')
      )
        throw new Error();
      // pg connection-string SSL parameters otherwise override the explicit CA
      // and verification settings below. Cloud TLS always verifies the server.
      for (const key of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey'])
        url.searchParams.delete(key);
      connectionString = url.toString();
      ssl = {
        rejectUnauthorized: true,
        // Keep public roots for shared poolers alongside a provider-specific CA.
        ...(ca ? { ca: [...rootCertificates, ca] } : {}),
      };
    } catch {
      throw new DatabaseConfigurationError('DATABASE_URL');
    }
  }
  return {
    connectionString,
    ...(ssl ? { ssl } : {}),
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  };
}

export function createDatabase(connectionString: string) {
  return new pg.Pool(databaseOptions(connectionString));
}

export async function inTransaction<T>(
  pool: pg.Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
