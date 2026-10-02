import { randomBytes } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { readAuthConfig } from '../src/server/auth/config.js';
import { AuthService } from '../src/server/auth/service.js';
import type { AuthStore } from '../src/server/auth/store.js';
import { SpotifyClient } from '../src/server/spotify/client.js';
import { safeLogSerializers } from '../src/server/security/http.js';
import { trackSchema } from '../src/server/search/contracts.js';
const origin = 'https://crowdcue.example';
function setup() {
  const config = readAuthConfig({
    NODE_ENV: 'test',
    SPOTIFY_AUTH_ENABLED: 'true',
    SPOTIFY_CLIENT_ID: 'fixture-client',
    SPOTIFY_CLIENT_SECRET: 'fixture-secret',
    SPOTIFY_REDIRECT_URI: origin + '/api/auth/spotify/callback',
    DATABASE_URL: 'postgresql://fixture@127.0.0.1/fixture',
    TOKEN_ENCRYPTION_KEYS: JSON.stringify({
      v1: randomBytes(32).toString('base64'),
    }),
  })!;
  const store = {
    createAttempt: vi.fn(),
    consumeAttempt: vi.fn().mockResolvedValue(null),
    saveLogin: vi.fn(),
    findSession: vi.fn().mockResolvedValue(null),
    deleteSession: vi.fn(),
    accessToken: vi.fn(),
  } satisfies AuthStore;
  const provider = vi.fn<typeof fetch>();
  const auth = new AuthService(
    config,
    store,
    new SpotifyClient(config, provider),
  );
  const app = buildApp(readConfig({ NODE_ENV: 'test' }), {
    logger: false,
    auth,
  });
  return { app, store, provider };
}
it('blocks cross-site API requests before handlers and protects errors with private browser headers', async () => {
  const { app, provider } = setup();
  try {
    for (const path of [
      '/api/parties',
      '/api/auth/spotify/status',
      ...['guest', 'admin', 'display'].map(
        (role) => `/api/party-links/${role}/${'a'.repeat(43)}`,
      ),
      `/api/party-links/admin/${'a'.repeat(43)}/statistics`,
      `/api/party-links/guest/${'g'.repeat(43)}/leaderboard`,
    ]) {
      const response = await app.inject({
        url: path,
        headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['content-security-policy']).toContain(
        "frame-ancestors 'none'",
      );
      expect(response.headers['content-security-policy']).toContain(
        "form-action 'self' https://accounts.spotify.com",
      );
      expect(response.headers['permissions-policy']).toContain(
        'fullscreen=(self)',
      );
    }
    const unrelatedUpgrade = await app.inject({
      url: `/admin/${'p'.repeat(43)}`,
      headers: { upgrade: 'websocket', connection: 'upgrade' },
    });
    expect(unrelatedUpgrade.statusCode).toBe(404);
    expect(unrelatedUpgrade.headers['cache-control']).toBe('no-store');
    expect(unrelatedUpgrade.headers['x-frame-options']).toBe('DENY');
    expect(unrelatedUpgrade.body).not.toContain('p'.repeat(43));
    expect(provider).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          url: '/api/health',
          headers: { 'sec-fetch-site': 'cross-site' },
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
  }
});
it('permits Spotify callback navigation while retaining cookie-bound state validation', async () => {
  const { app, store } = setup();
  try {
    const url = `/api/auth/spotify/callback?state=${'s'.repeat(43)}&code=fixture-code`;
    const headers = {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    };
    const missing = await app.inject({ url, headers });
    expect(missing.statusCode).toBe(303);
    expect(missing.headers.location).toBe(origin + '/?spotify=invalid_state');
    expect(store.consumeAttempt).not.toHaveBeenCalled();
    const bound = await app.inject({
      url,
      headers,
      cookies: { '__Host-crowdcue_oauth': 'b'.repeat(43) },
    });
    expect(bound.statusCode).toBe(303);
    expect(store.consumeAttempt).toHaveBeenCalledOnce();
    expect(
      (
        await app.inject({
          url,
          headers: { ...headers, 'sec-fetch-mode': 'cors' },
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});
it('enforces exact mutation Origin before parsing and bounds authentication/general API bodies', async () => {
  const { app, store } = setup();
  const changed = vi.fn();
  app.post('/api/security-probe', changed);
  try {
    for (const supplied of [
      undefined,
      'null',
      'https://attacker.example',
      origin + '.attacker.example',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/security-probe',
        headers: {
          ...(supplied ? { origin: supplied } : {}),
          'content-type': 'application/json',
        },
        payload: 'x'.repeat(10000),
      });
      expect(response.statusCode).toBe(403);
    }
    expect(changed).not.toHaveBeenCalled();
    for (const url of ['/api/auth/spotify/login', '/api/auth/logout']) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { origin, 'content-type': 'application/json' },
            payload: JSON.stringify({ oversized: 'x'.repeat(1100) }),
          })
        ).statusCode,
      ).toBe(413);
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { origin, 'content-type': 'application/json' },
            payload: '{broken-json',
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(store.createAttempt).not.toHaveBeenCalled();
    expect(store.deleteSession).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/security-probe',
          headers: { origin },
          payload: { oversized: 'x'.repeat(5000) },
        })
      ).statusCode,
    ).toBe(413);
    expect(changed).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
it('starts browser OAuth through same-origin JSON without exposing grants or accepting null Origin', async () => {
  const { app } = setup();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/spotify/login',
      headers: { origin, accept: 'application/json' },
    });
    expect(response.statusCode).toBe(200);
    const url = new URL(response.json().authorizationUrl);
    expect(url.origin).toBe('https://accounts.spotify.com');
    expect(url.pathname).toBe('/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.body).not.toContain('fixture-secret');
    expect(response.json()).not.toHaveProperty('accessToken');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/spotify/login',
          headers: { origin: 'null', accept: 'application/json' },
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});
it('does not trust forwarded client addresses to evade rate limits', async () => {
  const { app } = setup();
  try {
    for (let i = 0; i < 10; i++)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/spotify/login',
            headers: { origin, 'x-forwarded-for': `192.0.2.${i}` },
            payload: {},
          })
        ).statusCode,
      ).toBe(303);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/spotify/login',
          headers: { origin, 'x-forwarded-for': '203.0.113.10' },
          payload: {},
        })
      ).statusCode,
    ).toBe(429);
  } finally {
    await app.close();
  }
});
it('omits private request material and raw error messages from log serialization', () => {
  const secret = 'fixture-private-material';
  expect(
    JSON.stringify(
      safeLogSerializers.req({
        id: 'safe-id',
        method: 'GET',
        url: `/admin/${secret}`,
        headers: { cookie: secret },
        body: { token: secret },
      } as Parameters<typeof safeLogSerializers.req>[0]),
    ),
  ).toBe('{"id":"safe-id","method":"GET"}');
  expect(
    JSON.stringify(safeLogSerializers.err(new Error(secret))),
  ).not.toContain(secret);
  expect(safeLogSerializers.res({ statusCode: 403 })).toEqual({
    statusCode: 403,
  });
});
it('rejects unsafe track links and drops unapproved or credential-bearing artwork', () => {
  const track = {
    id: 'a'.repeat(22),
    title: '<script>alert(1)</script>',
    artists: ['Artist'],
    album: 'Album',
    artworkUrl: null,
    durationMs: 120000,
    explicit: false,
    spotifyUrl: `https://open.spotify.com/track/${'a'.repeat(22)}`,
  };
  expect(trackSchema.safeParse(track).success).toBe(true);
  for (const spotifyUrl of [
    'javascript:alert(1)',
    'https://attacker.example/song',
    `https://open.spotify.com/track/${'b'.repeat(22)}`,
    `https://attacker@open.spotify.com/track/${track.id}`,
  ])
    expect(trackSchema.safeParse({ ...track, spotifyUrl }).success).toBe(false);
  for (const artworkUrl of [
    'javascript:alert(1)',
    'http://i.scdn.co/image/1',
    'https://i.scdn.co.attacker.example/image/1',
    'https://private@i.scdn.co/image/1',
    'https://i.scdn.co:8443/image/1',
  ])
    expect(trackSchema.parse({ ...track, artworkUrl }).artworkUrl).toBeNull();
  expect(
    trackSchema.safeParse({ ...track, artworkUrl: 'https://i.scdn.co/image/1' })
      .success,
  ).toBe(true);
});
