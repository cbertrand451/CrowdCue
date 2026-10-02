import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server/app.js';
import { ApiError } from '../src/server/errors.js';
import { readConfig } from '../src/server/config.js';
import type { AuthService } from '../src/server/auth/service.js';
import { SpotifyError } from '../src/server/spotify/error.js';

const auth = {
  config: { appOrigin: 'https://crowdcue.example' },
} as AuthService;

describe('application', () => {
  it('serves refreshed party pages without caching or referring private links', async () => {
    const app = buildApp(readConfig({ NODE_ENV: 'production' }), {
      logger: false,
      serveFrontend: true,
      frontendRoot: fileURLToPath(new URL('../', import.meta.url)),
    });
    try {
      for (const role of ['join', 'admin', 'display']) {
        const response = await app.inject(`/${role}/${'x'.repeat(43)}`);
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/html');
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['referrer-policy']).toBe('no-referrer');
        expect(response.headers['content-security-policy']).toContain(
          'https://i.scdn.co',
        );
        expect(response.headers['content-security-policy']).toContain(
          'https://*.spotifycdn.com',
        );
        expect(response.headers['content-security-policy']).toContain(
          "default-src 'self'",
        );
        expect(response.headers['x-robots-tag']).toBe(
          'noindex, nofollow, noarchive',
        );
        for (const token of ['short', 'x'.repeat(129), 'invalid%3Ctoken%3E']) {
          const invalid = await app.inject(`/${role}/${token}`);
          expect(invalid.statusCode).toBe(404);
          expect(invalid.json()).toEqual({
            error: token.length > 128 ? 'Page not found.' : 'Party not found.',
          });
          expect(invalid.headers['cache-control']).toBe('no-store');
        }
      }
      expect((await app.inject('/api/missing')).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
  it('provides a public, uncached health check without configuration details', async () => {
    const app = buildApp(readConfig({ NODE_ENV: 'test' }), { logger: false });
    try {
      const response = await app.inject('/api/health');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok', service: 'crowdcue' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect((await app.inject('/api/missing')).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
  it('does not expose internal exceptions to clients', async () => {
    const app = buildApp(readConfig({ NODE_ENV: 'test' }), { logger: false });
    app.get('/api/failure', async () => {
      throw new Error('private internal details');
    });
    try {
      const response = await app.inject('/api/failure');
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal server error' });
      expect(response.body).not.toContain('private internal details');
    } finally {
      await app.close();
    }
  });
  it('serializes expected app and Spotify errors without internals', async () => {
    const app = buildApp(readConfig({ NODE_ENV: 'test' }), { logger: false });
    app.get('/api/expected-conflict', async () => {
      throw new ApiError(409, 'The queue changed. Refresh and try again.', {
        code: 'queue_conflict',
      });
    });
    app.get('/api/provider-busy', async () => {
      throw new SpotifyError('rate_limited', 27);
    });
    try {
      const conflict = await app.inject('/api/expected-conflict');
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toEqual({
        error: 'The queue changed. Refresh and try again.',
      });
      expect(conflict.body).not.toContain('queue_conflict');

      const rateLimited = await app.inject('/api/provider-busy');
      expect(rateLimited.statusCode).toBe(429);
      expect(rateLimited.headers['retry-after']).toBe('27');
      expect(rateLimited.json()).toEqual({
        error: 'Spotify is busy. Please try again shortly.',
      });
      expect(rateLimited.body).not.toContain('access_token');
    } finally {
      await app.close();
    }
  });
  it('rejects unsafe cross-origin API writes before route handlers run', async () => {
    const app = buildApp(readConfig({ NODE_ENV: 'test' }), {
      logger: false,
      auth,
    });
    let reached = false;
    app.post('/api/custom-mutation', async () => {
      reached = true;
      return { ok: true };
    });
    try {
      for (const headers of [
        {},
        { origin: 'https://attacker.example' },
        { origin: 'null' },
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/custom-mutation',
          headers,
          payload: {},
        });
        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({
          error: 'Open CrowdCue before making changes.',
        });
      }
      const allowed = await app.inject({
        method: 'POST',
        url: '/api/custom-mutation',
        headers: { origin: 'https://crowdcue.example' },
        payload: {},
      });
      expect(allowed.statusCode).toBe(200);
      expect(reached).toBe(true);
    } finally {
      await app.close();
    }
  });
  it('caps default API request bodies without exposing parser internals', async () => {
    const app = buildApp(readConfig({ NODE_ENV: 'test' }), { logger: false });
    app.post('/api/large-payload', async () => ({ ok: true }));
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/large-payload',
        headers: { 'content-type': 'application/json' },
        payload: { value: 'x'.repeat(17 * 1024) },
      });
      expect(response.statusCode).toBe(413);
      expect(response.json()).toEqual({ error: 'Request body is too large.' });
      expect(response.body).not.toContain('BodyLimitError');
    } finally {
      await app.close();
    }
  });
  it('rejects malformed JSON without exposing parser internals', async () => {
    const app = buildApp(readConfig({ NODE_ENV: 'test' }), { logger: false });
    app.post('/api/json-payload', async () => ({ ok: true }));
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/json-payload',
        headers: { 'content-type': 'application/json' },
        payload: '{broken-json',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'Send a valid, bounded request.',
      });
      expect(response.body).not.toContain('Unexpected token');
    } finally {
      await app.close();
    }
  });
  it('uses defaults for absent or blank optional configuration', () => {
    expect(readConfig({ PORT: '', NODE_ENV: '' }).PORT).toBe(3000);
  });
  it('rejects invalid configuration without disclosing values', () => {
    expect(() => readConfig({ PORT: 'sensitive-value' })).toThrow(
      'Invalid environment configuration: PORT',
    );
    expect(() => readConfig({ PORT: '0' })).toThrow();
    expect(() => readConfig({ NODE_ENV: 'invalid' })).toThrow();
  });
});
