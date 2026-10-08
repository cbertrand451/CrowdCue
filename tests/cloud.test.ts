import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cloudEnvironment } from '../src/server/cloud.js';
import { readAuthConfig } from '../src/server/auth/config.js';
import { databaseOptions } from '../src/server/db/index.js';

const env = () => ({
  RENDER_EXTERNAL_URL: 'https://crowdcue-test.onrender.com',
  SPOTIFY_CLIENT_ID: 'test-client',
  SPOTIFY_CLIENT_SECRET: 'test-secret',
  DATABASE_URL: 'postgresql://test:test@database.example:5432/postgres',
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

describe('public cloud deployment', () => {
  it('uses the trusted public hosting URL for links, callback and secure cookies', () => {
    const values = env();
    const resolved = cloudEnvironment(values);
    const auth = readAuthConfig(resolved)!;
    expect(resolved.HOST).toBe('0.0.0.0');
    expect(resolved.NODE_ENV).toBe('production');
    expect(auth.appOrigin).toBe(values.RENDER_EXTERNAL_URL);
    expect(auth.redirectUri).toBe(
      `${values.RENDER_EXTERNAL_URL}/api/auth/spotify/callback`,
    );
    expect(auth.secureCookies).toBe(true);
    expect(auth.keys.v1.toString('base64')).toBe(values.TOKEN_ENCRYPTION_KEY);
    expect(readAuthConfig(cloudEnvironment(values))!.keys.v1).toEqual(
      auth.keys.v1,
    );
  });

  it('supports a custom domain and preserves an existing encryption key ring', () => {
    const key = randomBytes(32).toString('base64');
    const resolved = cloudEnvironment({
      ...env(),
      APP_ORIGIN: 'https://party.example',
      TOKEN_ENCRYPTION_KEY_ID: 'old',
      TOKEN_ENCRYPTION_KEYS: JSON.stringify({ old: key }),
    });
    const auth = readAuthConfig(resolved)!;
    expect(auth.appOrigin).toBe('https://party.example');
    expect(auth.redirectUri).toBe(
      'https://party.example/api/auth/spotify/callback',
    );
    expect(auth.keys.old.toString('base64')).toBe(key);
  });

  it('refuses local HTTP, missing credentials, disabled authentication and mismatched callbacks', () => {
    for (const overrides of [
      { RENDER_EXTERNAL_URL: 'http://127.0.0.1:5173' },
      { SPOTIFY_CLIENT_SECRET: '' },
      { TOKEN_ENCRYPTION_KEY: '' },
      { TOKEN_ENCRYPTION_KEY: 'private-invalid-key' },
      { SPOTIFY_AUTH_ENABLED: 'false' },
      {
        SPOTIFY_REDIRECT_URI: 'https://other.example/api/auth/spotify/callback',
      },
    ])
      expect(() => cloudEnvironment({ ...env(), ...overrides })).toThrow();
    try {
      cloudEnvironment({
        ...env(),
        TOKEN_ENCRYPTION_KEY: 'private-invalid-key',
      });
    } catch (error) {
      expect(String(error)).not.toContain('private-invalid-key');
    }
  });

  it('keeps local database defaults and enforces verified cloud TLS', () => {
    const url = env().DATABASE_URL;
    expect(databaseOptions(url, {}).ssl).toBeUndefined();
    const options = databaseOptions(
      `${url}?sslmode=require&application_name=crowdcue`,
      { DATABASE_SSL: 'true' },
    );
    expect(options.ssl).toEqual({ rejectUnauthorized: true });
    expect(new URL(options.connectionString!).searchParams.has('sslmode')).toBe(
      false,
    );
    expect(
      new URL(options.connectionString!).searchParams.get('application_name'),
    ).toBe('crowdcue');
    expect(() =>
      databaseOptions(`${url}?sslmode=no-verify`, { DATABASE_SSL: 'true' }),
    ).toThrow();
    expect(() =>
      databaseOptions(url, { DATABASE_SSL_CA: 'private-invalid-certificate' }),
    ).toThrow('Invalid database TLS configuration');
    expect(() => databaseOptions(url, { DATABASE_SSL: 'invalid' })).toThrow(
      'DATABASE_SSL',
    );
  });
});
