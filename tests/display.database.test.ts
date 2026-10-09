import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/server/db/index.js';
import { migrate } from '../src/server/db/migrate.js';
import { hashToken, newToken, TokenCipher } from '../src/server/auth/crypto.js';
import { PostgresPartyStore } from '../src/server/parties/store.js';
import {
  createPartySchema,
  type PartyDetails,
} from '../src/server/parties/contracts.js';
import { PostgresDisplayStore } from '../src/server/display/store.js';
import { displaySnapshotSchema } from '../src/server/display/contracts.js';
import { PlaybackStore } from '../src/server/playback/store.js';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
const database = process.env.TEST_DATABASE_URL;
const origin = 'https://crowdcue.example';
const token = (url: string) => new URL(url).pathname.split('/').at(-1)!;
const track = (letter: string) => ({
  id: letter.repeat(22),
  title: `Song ${letter}`,
  artists: ['Artist'],
  album: 'Album',
  artworkUrl: null,
  durationMs: 120000,
  explicit: false,
  spotifyUrl: `https://open.spotify.com/track/${letter.repeat(22)}`,
});
describe.skipIf(!database)('read-only TV display snapshots', () => {
  const schema = `crowdcue_display_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool,
    pool: pg.Pool,
    parties: PostgresPartyStore,
    display: PostgresDisplayStore,
    playback: PlaybackStore;
  let party: PartyDetails,
    app: ReturnType<typeof buildApp>,
    host: string,
    guest: string;
  beforeAll(async () => {
    admin = createDatabase(database!);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({
      connectionString: database,
      options: `-c search_path=${schema}`,
      connectionTimeoutMillis: 5000,
    });
    await migrate(pool);
    parties = new PostgresPartyStore(
      pool,
      new TokenCipher('test', { test: randomBytes(32) }),
      origin,
    );
    display = new PostgresDisplayStore(pool, origin);
    playback = new PlaybackStore(pool);
    app = buildApp(readConfig({ NODE_ENV: 'test' }), {
      logger: false,
      parties,
      display,
    });
    await app.ready();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE spotify_accounts CASCADE');
    host = (
      await pool.query<{ id: string }>(
        'INSERT INTO spotify_accounts(spotify_user_id) VALUES($1) RETURNING id',
        [randomUUID()],
      )
    ).rows[0].id;
    party = (
      await parties.create(
        host,
        createPartySchema.parse({ name: 'TV party' }),
        randomUUID(),
      )
    ).party;
    guest = (
      await pool.query<{ id: string }>(
        `INSERT INTO guests(party_id,session_token_hash,display_name,expires_at) VALUES($1,$2,'Private guest name',now()+interval '1 day') RETURNING id`,
        [party.id, hashToken(newToken())],
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
  const snapshot = () => display.snapshot(token(party.links.display!));
  async function request(letter: string, status = 'APPROVED') {
    return (
      await pool.query<{ id: string }>(
        `INSERT INTO song_requests(party_id,requested_by,spotify_track_id,track_name,artist_name,album_name,duration_ms,status) VALUES($1,$2,$3,$4,'Artist','Album',120000,$5) RETURNING id`,
        [party.id, guest, letter.repeat(22), `Song ${letter}`, status],
      )
    ).rows[0].id;
  }
  it('accepts only the display token and exposes no identifiers, personalized flags, private links, or mutations', async () => {
    const url = `/api/party-links/display/${token(party.links.display!)}/snapshot`;
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(200);
    expect(displaySnapshotSchema.safeParse(response.json()).success).toBe(true);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    for (const bad of [
      token(party.links.guest),
      token(party.links.admin!),
      'z'.repeat(43),
      'short',
    ])
      expect(
        (await app.inject({ url: `/api/party-links/display/${bad}/snapshot` }))
          .statusCode,
      ).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url, payload: { action: 'skip' } }))
        .statusCode,
    ).toBe(404);
    const body = JSON.stringify(response.json());
    for (const hidden of [
      party.id,
      host,
      guest,
      token(party.links.admin!),
      token(party.links.display!),
      'playlistUrl',
      'backupSourceId',
      'hasVoted',
      'isOwn',
    ])
      expect(body).not.toContain(hidden);
  });
  it('shows six approved songs in shared vote order and counts pending requests without revealing titles', async () => {
    let voted = '';
    for (const letter of ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
      voted = await request(letter);
    await pool.query(
      'INSERT INTO votes(party_id,request_id,guest_id) VALUES($1,$2,$3)',
      [
        party.id,
        voted,
        (
          await pool.query<{ id: string }>(
            "INSERT INTO guests(party_id,session_token_hash,expires_at) VALUES($1,$2,now()+interval '1 day') RETURNING id",
            [party.id, hashToken(newToken())],
          )
        ).rows[0].id,
      ],
    );
    await request('p', 'REQUESTED');
    const result = await snapshot();
    expect(result.queue).toHaveLength(6);
    expect(result.hasMore).toBe(true);
    expect(result.queue[0]).toMatchObject({
      position: 1,
      track: { title: 'Song g' },
      voteCount: 1,
      source: 'GUEST',
      requestedBy: 'Private guest name',
      locked: false,
    });
    expect(result.pendingCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain('Song p');
    await pool.query(
      'UPDATE party_settings SET voting_enabled=false WHERE party_id=$1',
      [party.id],
    );
    expect((await snapshot()).queue[0].track.title).toBe('Song a');
  });
  it('keeps locked upcoming songs separate from the observed playing song', async () => {
    await pool.query(
      'UPDATE party_playback SET initialized=true WHERE party_id=$1',
      [party.id],
    );
    await pool.query(
      `INSERT INTO playback_entries(party_id,source,track,status,locked_at,delivery) VALUES($1,'BACKUP',$2,'LOCKED',now(),'SENT')`,
      [party.id, JSON.stringify(track('b'))],
    );
    await pool.query(
      `INSERT INTO playback_entries(party_id,source,track) VALUES($1,'BACKUP',$2)`,
      [party.id, JSON.stringify(track('c'))],
    );
    await playback.observe(party.id, {
      is_playing: true,
      progress_ms: 10000,
      item: { id: track('a').id, uri: `spotify:track:${track('a').id}` },
      track: track('a'),
    });
    const result = await snapshot();
    expect(result.nowPlaying).toMatchObject({
      state: 'PLAYING',
      track: { title: 'Song a' },
      progressMs: 10000,
    });
    expect(result.nowPlaying.observedAt).not.toBeNull();
    expect(result.queue.map((x) => x.track.title)).toEqual([
      'Song b',
      'Song c',
    ]);
    expect(result.queue[0]).toMatchObject({ source: 'BACKUP', locked: true });
  });
  it('handles paused, idle, unavailable, and ended playback without claiming an ongoing listen', async () => {
    const observation = {
      is_playing: false,
      progress_ms: 25000,
      item: { id: track('a').id, uri: `spotify:track:${track('a').id}` },
      track: track('a'),
    };
    await playback.observe(party.id, observation);
    expect((await snapshot()).nowPlaying).toMatchObject({
      state: 'PAUSED',
      progressMs: 25000,
    });
    await pool.query(
      "UPDATE party_playback SET display_state='UNAVAILABLE' WHERE party_id=$1",
      [party.id],
    );
    expect((await snapshot()).nowPlaying).toMatchObject({
      state: 'UNAVAILABLE',
      track: { title: 'Song a' },
    });
    await playback.observe(party.id, null);
    expect((await snapshot()).nowPlaying).toMatchObject({
      state: 'IDLE',
      track: null,
      progressMs: null,
    });
    await playback.observe(party.id, observation);
    await parties.end(host, token(party.links.admin!));
    expect((await snapshot()).nowPlaying).toEqual({
      state: 'UNKNOWN',
      source: null,
      requestedBy: null,
      track: null,
      progressMs: null,
      observedAt: null,
    });
    expect((await snapshot()).party.status).toBe('ENDED');
  });
  it('returns not found after the party is deleted', async () => {
    await pool.query('DELETE FROM parties WHERE id=$1', [party.id]);
    const response = await app.inject({
      url: `/api/party-links/display/${token(party.links.display!)}/snapshot`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Party not found.' });
  });
  it('includes requester names for queued and matched playing songs without exposing guest IDs', async () => {
    const playing = await request('a');
    const next = await request('b');
    await pool.query(
      'UPDATE party_playback SET initialized=true WHERE party_id=$1',
      [party.id],
    );
    await pool.query(
      "INSERT INTO playback_entries(party_id,request_id,source,track,status,locked_at,delivery) VALUES($1,$2,'GUEST',$3,'PLAYING',now(),'SENT'),($1,$4,'GUEST',$5,'LOCKED',now(),'SENT')",
      [
        party.id,
        playing,
        JSON.stringify(track('a')),
        next,
        JSON.stringify(track('b')),
      ],
    );
    await playback.observe(party.id, {
      is_playing: true,
      progress_ms: 1000,
      item: { id: track('a').id, uri: `spotify:track:${track('a').id}` },
      track: track('a'),
    });
    let result = await snapshot();
    expect(result.nowPlaying).toMatchObject({
      source: 'GUEST',
      requestedBy: 'Private guest name',
    });
    expect(result.queue[0]).toMatchObject({
      source: 'GUEST',
      requestedBy: 'Private guest name',
    });
    expect(JSON.stringify(result)).not.toContain(guest);
    await pool.query('UPDATE guests SET display_name=null WHERE id=$1', [
      guest,
    ]);
    result = await snapshot();
    expect(result.queue[0].requestedBy).toBeNull();
    expect(result.nowPlaying.requestedBy).toBeNull();
    await playback.observe(party.id, {
      is_playing: true,
      progress_ms: 1000,
      item: { id: track('z').id, uri: `spotify:track:${track('z').id}` },
      track: track('z'),
    });
    expect((await snapshot()).nowPlaying).toMatchObject({
      source: null,
      requestedBy: null,
      locked: false,
    });
  });
});
