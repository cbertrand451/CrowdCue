import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';

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
