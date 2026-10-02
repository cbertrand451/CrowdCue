import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { createDatabase } from '../src/server/db/index.js';
import { migrate } from '../src/server/db/migrate.js';
import { readAuthConfig } from '../src/server/auth/config.js';
import { hashToken, newToken, TokenCipher } from '../src/server/auth/crypto.js';
import { AuthService } from '../src/server/auth/service.js';
import { PostgresAuthStore } from '../src/server/auth/store.js';
import { SpotifyClient } from '../src/server/spotify/client.js';
import { PostgresPartyStore } from '../src/server/parties/store.js';
import {
  createPartySchema,
  type PartyDetails,
} from '../src/server/parties/contracts.js';

const database = process.env.TEST_DATABASE_URL;
const origin = 'https://crowdcue.example';
const token = (url: string) => new URL(url).pathname.split('/').at(-1)!;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
describe.skipIf(!database)(
  'WebSocket updates with committed PostgreSQL changes',
  () => {
    const schema = `crowdcue_live_${randomUUID().replaceAll('-', '')}`;
    let admin: pg.Pool,
      pool: pg.Pool,
      authStore: PostgresAuthStore,
      parties: PostgresPartyStore;
    let first: FastifyInstance, second: FastifyInstance;
    let host: string,
      ownerCookie: string,
      otherCookie: string,
      party: PartyDetails,
      otherParty: PartyDetails;
    const sockets: WebSocket[] = [];
    const config = readAuthConfig({
      NODE_ENV: 'test',
      SPOTIFY_AUTH_ENABLED: 'true',
      SPOTIFY_CLIENT_ID: 'fixture-client',
      SPOTIFY_CLIENT_SECRET: 'fixture-secret',
      SPOTIFY_REDIRECT_URI: `${origin}/api/auth/spotify/callback`,
      DATABASE_URL: 'postgresql://fixture@127.0.0.1/fixture',
      TOKEN_ENCRYPTION_KEYS: JSON.stringify({
        v1: randomBytes(32).toString('base64'),
      }),
    })!;
    async function login() {
      const cookie = newToken();
      await authStore.saveLogin(
        { id: randomUUID(), displayName: 'Host' },
        {
          accessToken: 'fixture-access',
          refreshToken: 'fixture-refresh',
          expiresAt: new Date(Date.now() + 3600000),
          scopes: [],
        },
        hashToken(cookie),
      );
      return {
        cookie,
        id: (await authStore.findSession(hashToken(cookie)))!.accountId,
      };
    }
    beforeAll(async () => {
      admin = createDatabase(database!);
      await admin.query(`CREATE SCHEMA "${schema}"`);
      pool = new pg.Pool({
        connectionString: database,
        options: `-c search_path=${schema}`,
        connectionTimeoutMillis: 5000,
      });
      await migrate(pool);
      const cipher = new TokenCipher(config.keyId, config.keys);
      authStore = new PostgresAuthStore(pool, cipher);
      const auth = new AuthService(
        config,
        authStore,
        new SpotifyClient(config),
      );
      parties = new PostgresPartyStore(pool, cipher, origin);
      const owner = await login();
      host = owner.id;
      ownerCookie = owner.cookie;
      otherCookie = (await login()).cookie;
      party = (
        await parties.create(
          host,
          createPartySchema.parse({ name: 'Live party' }),
          randomUUID(),
        )
      ).party;
      otherParty = (
        await parties.create(
          host,
          createPartySchema.parse({ name: 'Other party' }),
          randomUUID(),
        )
      ).party;
      first = buildApp(readConfig({ NODE_ENV: 'test' }), {
        logger: false,
        auth,
        parties,
        realtimePool: pool,
      });
      second = buildApp(readConfig({ NODE_ENV: 'test' }), {
        logger: false,
        auth,
        parties,
        realtimePool: pool,
      });
      await Promise.all([
        first.listen({ port: 0, host: '127.0.0.1' }),
        second.listen({ port: 0, host: '127.0.0.1' }),
      ]);
    });
    afterAll(async () => {
      for (const socket of sockets) socket.terminate();
      await Promise.all([first?.close(), second?.close()]);
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
      }
    });
    async function upgrade(
      app: FastifyInstance,
      path: string,
      context: { headers?: Record<string, string | undefined> } = {},
      options: { onInit?: (socket: WebSocket) => void } = {},
    ) {
      const address = app.server.address();
      if (!address || typeof address === 'string')
        throw Error('Test server unavailable');
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}${path}`, {
        headers: context.headers,
      });
      options.onInit?.(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      return socket;
    }
    async function connect(
      app: FastifyInstance,
      role: string,
      url: string,
      cookie?: string,
    ) {
      const messages: unknown[] = [];
      const socket = await upgrade(
        app,
        `/api/party-links/${role}/${token(url)}/live`,
        {
          headers: {
            origin,
            ...(cookie
              ? {
                  cookie: `${config.secureCookies ? '__Host-' : ''}crowdcue_host=${cookie}`,
                }
              : {}),
          },
        },
        {
          onInit: (ws) =>
            ws.on('message', (data) =>
              messages.push(JSON.parse(data.toString())),
            ),
        },
      );
      sockets.push(socket);
      await expect.poll(() => messages).toContainEqual({ type: 'ready' });
      messages.length = 0;
      return { socket, messages };
    }
    it('rejects missing/wrong origins, wrong roles, forged tokens, and non-owning admin sessions', async () => {
      const path = `/api/party-links/admin/${token(party.links.admin!)}/live`;
      for (const headers of [{}, { origin: 'https://attacker.example' }])
        await expect(upgrade(first, path, { headers })).rejects.toThrow('403');
      await expect(
        upgrade(first, path, { headers: { origin } }),
      ).rejects.toThrow('401');
      await expect(
        upgrade(first, path, {
          headers: {
            origin,
            cookie: `${config.secureCookies ? '__Host-' : ''}crowdcue_host=${otherCookie}`,
          },
        }),
      ).rejects.toThrow('404');
      await expect(
        upgrade(
          first,
          `/api/party-links/admin/${token(party.links.guest)}/live`,
          {
            headers: {
              origin,
              cookie: `${config.secureCookies ? '__Host-' : ''}crowdcue_host=${ownerCookie}`,
            },
          },
        ),
      ).rejects.toThrow('404');
      await expect(
        upgrade(first, `/api/party-links/display/${'z'.repeat(43)}/live`, {
          headers: { origin },
        }),
      ).rejects.toThrow('404');
      await expect(
        upgrade(
          first,
          `/api/party-links/display/${token(party.links.display!)}/live?room=other`,
          { headers: { origin } },
        ),
      ).rejects.toThrow('404');
    });
    it('broadcasts only committed changes to the matching room on both server instances', async () => {
      const guest = await connect(first, 'guest', party.links.guest);
      const hostView = await connect(
        second,
        'admin',
        party.links.admin!,
        ownerCookie,
      );
      const display = await connect(second, 'display', party.links.display!);
      const unrelated = await connect(
        first,
        'display',
        otherParty.links.display!,
      );
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE party_settings SET voting_enabled=false WHERE party_id=$1',
          [party.id],
        );
        await delay(200);
        expect(guest.messages).toEqual([]);
        await client.query('ROLLBACK');
        await delay(200);
        expect(hostView.messages).toEqual([]);
        await client.query('BEGIN');
        await client.query('UPDATE parties SET name=$2 WHERE id=$1', [
          party.id,
          'Updated live party',
        ]);
        await client.query(
          'UPDATE party_settings SET voting_enabled=false WHERE party_id=$1',
          [party.id],
        );
        await client.query('COMMIT');
        await expect.poll(() => guest.messages).toEqual([{ type: 'changed' }]);
        await expect
          .poll(() => hostView.messages)
          .toEqual([{ type: 'changed' }]);
        await expect
          .poll(() => display.messages)
          .toEqual([{ type: 'changed' }]);
        expect(unrelated.messages).toEqual([]);
        expect(JSON.stringify(guest.messages)).not.toContain(party.id);
        guest.messages.length = 0;
        await pool.query(
          'UPDATE party_settings SET updated_at=now() WHERE party_id=$1',
          [party.id],
        );
        await delay(200);
        expect(guest.messages).toEqual([]);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
    it('pushes requests, votes, moderation, playback, and party-end changes', async () => {
      const view = await connect(first, 'guest', party.links.guest);
      const guest = (
        await pool.query<{ id: string }>(
          `INSERT INTO guests (party_id,session_token_hash,expires_at) VALUES ($1,$2,now()+interval '1 day') RETURNING id`,
          [party.id, hashToken(newToken())],
        )
      ).rows[0].id;
      await expect.poll(() => view.messages.length).toBeGreaterThan(0);
      view.messages.length = 0;
      const request = (
        await pool.query<{ id: string }>(
          `INSERT INTO song_requests (party_id,requested_by,spotify_track_id,track_name,artist_name,album_name,duration_ms,status) VALUES ($1,$2,$3,'Live track','Artist','Album',120000,'APPROVED') RETURNING id`,
          [party.id, guest, 't'.repeat(22)],
        )
      ).rows[0].id;
      await expect.poll(() => view.messages.length).toBeGreaterThan(0);
      view.messages.length = 0;
      await pool.query(
        'INSERT INTO votes(party_id,request_id,guest_id) VALUES ($1,$2,$3)',
        [party.id, request, guest],
      );
      await expect.poll(() => view.messages.length).toBeGreaterThan(0);
      view.messages.length = 0;
      await pool.query(
        "UPDATE song_requests SET status='REMOVED' WHERE id=$1",
        [request],
      );
      await expect.poll(() => view.messages.length).toBeGreaterThan(0);
      view.messages.length = 0;
      await pool.query(
        "UPDATE party_playback SET error_code='no_active_device' WHERE party_id=$1",
        [party.id],
      );
      await expect.poll(() => view.messages.length).toBeGreaterThan(0);
      view.messages.length = 0;
      await pool.query(
        `INSERT INTO playback_entries(party_id,source,track) VALUES ($1,'BACKUP',$2)`,
        [party.id, JSON.stringify({ id: 'b'.repeat(22) })],
      );
      await expect.poll(() => view.messages.length).toBeGreaterThan(0);
      view.messages.length = 0;
      await parties.end(host, token(party.links.admin!));
      await expect.poll(() => view.messages.length).toBeGreaterThan(0);
      expect(
        (await parties.public(token(party.links.guest), 'guest')).status,
      ).toBe('ENDED');
    });
    it('closes client commands instead of accepting mutations or room switching', async () => {
      const { socket } = await connect(
        first,
        'display',
        otherParty.links.display!,
      );
      const closed = new Promise<number>((resolve) =>
        socket.once('close', resolve),
      );
      socket.send(JSON.stringify({ action: 'subscribe', room: party.id }));
      expect(await closed).toBe(1008);
    });
    it('rejects admin reconnection after its host session is logged out', async () => {
      const { cookie } = await login();
      // This different host cannot subscribe even with a valid session.
      await expect(
        upgrade(
          first,
          `/api/party-links/admin/${token(otherParty.links.admin!)}/live`,
          {
            headers: {
              origin,
              cookie: `${config.secureCookies ? '__Host-' : ''}crowdcue_host=${cookie}`,
            },
          },
        ),
      ).rejects.toThrow('404');
      const result = await connect(
        second,
        'admin',
        otherParty.links.admin!,
        ownerCookie,
      );
      await authStore.deleteSession(hashToken(ownerCookie));
      // Refreshing the connection must immediately recheck the session.
      await expect(
        upgrade(
          second,
          `/api/party-links/admin/${token(otherParty.links.admin!)}/live`,
          {
            headers: {
              origin,
              cookie: `${config.secureCookies ? '__Host-' : ''}crowdcue_host=${ownerCookie}`,
            },
          },
        ),
      ).rejects.toThrow('401');
      result.socket.close();
    });
  },
);
