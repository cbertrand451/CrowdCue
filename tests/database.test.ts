import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, inTransaction } from '../src/server/db/index.js';
import { migrate } from '../src/server/db/migrate.js';
import { initialSchema } from '../src/server/db/migrations/001-initial.js';

const url = process.env.TEST_DATABASE_URL;
if (process.env.npm_lifecycle_event === 'test:db' && !url) {
  throw new Error(
    'TEST_DATABASE_URL is required for database integration tests',
  );
}
const hash = () => randomBytes(32).toString('hex');

describe.skipIf(!url)('PostgreSQL persistence', () => {
  const schema = `crowdcue_test_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = createDatabase(url!);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
      connectionTimeoutMillis: 5_000,
    });
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  async function party() {
    const account = await pool.query<{ id: string }>(
      'INSERT INTO spotify_accounts (spotify_user_id) VALUES ($1) RETURNING id',
      [randomUUID()],
    );
    const result = await pool.query<{ id: string }>(
      `INSERT INTO parties (host_account_id, name, guest_join_token, admin_token_hash, display_token_hash)
       VALUES ($1, 'Test party', $2, $3, $4) RETURNING id`,
      [account.rows[0].id, hash(), hash(), hash()],
    );
    return result.rows[0].id;
  }
  async function guest(partyId: string) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO guests (party_id, session_token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 day') RETURNING id`,
      [partyId, hash()],
    );
    return result.rows[0].id;
  }
  async function request(
    partyId: string,
    guestId: string,
    track = 'A'.repeat(22),
  ) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO song_requests (party_id, requested_by, spotify_track_id, track_name, artist_name, album_name, duration_ms)
       VALUES ($1, $2, $3, 'Track', 'Artist', 'Album', 180000) RETURNING id`,
      [partyId, guestId, track],
    );
    return result.rows[0].id;
  }

  it('serializes concurrent migrations and supports repeat runs', async () => {
    const results = await Promise.all([migrate(pool), migrate(pool)]);
    expect(results.flat()).toEqual([1, 2, 3, 4]);
    expect(await migrate(pool)).toEqual([]);
    expect((await pool.query('SELECT * FROM schema_migrations')).rowCount).toBe(
      4,
    );
  });

  it('upgrades a version-one database while preserving an existing party', async () => {
    const isolated = `${schema}_upgrade`;
    await admin.query(`CREATE SCHEMA "${isolated}"`);
    const oldPool = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${isolated}`,
    });
    try {
      await oldPool.query(initialSchema);
      await oldPool.query(`CREATE TABLE schema_migrations (
        version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      await oldPool.query(
        "INSERT INTO schema_migrations (version, name, checksum) VALUES (1, 'initial', $1)",
        [createHash('sha256').update(initialSchema).digest('hex')],
      );
      const account = (
        await oldPool.query(
          "INSERT INTO spotify_accounts (spotify_user_id) VALUES ('existing-host') RETURNING id",
        )
      ).rows[0].id;
      const existing = (
        await oldPool.query(
          `INSERT INTO parties (host_account_id, name, guest_join_token, admin_token_hash, display_token_hash)
         VALUES ($1, 'Existing party', $2, $3, $4) RETURNING id`,
          [account, hash(), hash(), hash()],
        )
      ).rows[0].id;
      await oldPool.query(
        'INSERT INTO party_settings (party_id, voting_enabled, approval_required) VALUES ($1, false, true)',
        [existing],
      );
      const missingSettings = (
        await oldPool.query(
          `INSERT INTO parties (host_account_id, name, guest_join_token, admin_token_hash, display_token_hash)
           VALUES ($1, 'Older party without settings', $2, $3, $4) RETURNING id`,
          [account, hash(), hash(), hash()],
        )
      ).rows[0].id;
      expect(await migrate(oldPool)).toEqual([2, 3, 4]);
      expect(
        (
          await oldPool.query(
            'SELECT voting_enabled, approval_required FROM party_settings WHERE party_id = $1',
            [existing],
          )
        ).rows[0],
      ).toEqual({ voting_enabled: false, approval_required: true });
      expect(
        (
          await oldPool.query(
            'SELECT voting_enabled, approval_required FROM party_settings WHERE party_id = $1',
            [missingSettings],
          )
        ).rows[0],
      ).toEqual({ voting_enabled: true, approval_required: false });
      expect(
        (
          await oldPool.query('SELECT name FROM parties WHERE id = $1', [
            existing,
          ])
        ).rows[0].name,
      ).toBe('Existing party');
      expect(
        (
          await oldPool.query(
            'SELECT display_name FROM spotify_accounts WHERE id = $1',
            [account],
          )
        ).rows[0].display_name,
      ).toBeNull();
    } finally {
      await oldPool.end();
      await admin.query(`DROP SCHEMA "${isolated}" CASCADE`);
    }
  });

  it('rolls back a failed migration atomically and can retry', async () => {
    const isolated = `${schema}_failure`;
    await admin.query(`CREATE SCHEMA "${isolated}"`);
    const failingPool = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${isolated}`,
    });
    try {
      await failingPool.query('CREATE TABLE parties (id integer)');
      await expect(migrate(failingPool)).rejects.toMatchObject({
        code: '42P07',
      });
      const tables = await failingPool.query<{ tablename: string }>(
        'SELECT tablename FROM pg_tables WHERE schemaname = $1',
        [isolated],
      );
      expect(tables.rows.map((row) => row.tablename)).toEqual(['parties']);
      await failingPool.query('DROP TABLE parties');
      expect(await migrate(failingPool)).toEqual([1, 2, 3, 4]);
    } finally {
      await failingPool.end();
      await admin.query(`DROP SCHEMA "${isolated}" CASCADE`);
    }
  });

  it('enforces settings defaults and valid lifecycle values', async () => {
    const id = await party();
    const settings = await pool.query(
      'INSERT INTO party_settings (party_id) VALUES ($1) RETURNING *',
      [id],
    );
    expect(settings.rows[0]).toMatchObject({
      voting_enabled: true,
      approval_required: false,
      request_cooldown_seconds: 0,
    });
    await expect(
      pool.query(
        'UPDATE party_settings SET max_active_requests_per_guest = 0 WHERE party_id = $1',
        [id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("UPDATE parties SET status = 'ENDED' WHERE id = $1", [id]),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query(
      "UPDATE parties SET status = 'ENDED', ended_at = now() WHERE id = $1",
      [id],
    );
  });

  it('prevents duplicate active tracks under concurrency and allows later requests', async () => {
    const id = await party();
    const who = await guest(id);
    const results = await Promise.allSettled([
      request(id, who),
      request(id, who),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.find((item) => item.status === 'rejected')).toMatchObject({
      reason: { code: '23505' },
    });
    await pool.query(
      "UPDATE song_requests SET status = 'PLAYED' WHERE party_id = $1",
      [id],
    );
    await expect(request(id, who)).resolves.toBeTypeOf('string');
    const other = await party();
    await expect(request(other, await guest(other))).resolves.toBeTypeOf(
      'string',
    );
  });

  it('prevents duplicate votes and references across parties', async () => {
    const id = await party();
    const who = await guest(id);
    const song = await request(id, who);
    const other = await party();
    const outsider = await guest(other);
    const vote = () =>
      pool.query(
        'INSERT INTO votes (party_id, request_id, guest_id) VALUES ($1, $2, $3)',
        [id, song, who],
      );
    const results = await Promise.allSettled([vote(), vote()]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.find((item) => item.status === 'rejected')).toMatchObject({
      reason: { code: '23505' },
    });
    await expect(
      pool.query(
        'INSERT INTO votes (party_id, request_id, guest_id) VALUES ($1, $2, $3)',
        [id, song, outsider],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(request(id, outsider, 'B'.repeat(22))).rejects.toMatchObject({
      code: '23503',
    });
    await expect(guest(randomUUID())).rejects.toMatchObject({ code: '23503' });
  });

  it('rolls back failed work and keeps connections usable', async () => {
    const spotifyId = randomUUID();
    await expect(
      inTransaction(pool, async (client) => {
        await client.query(
          'INSERT INTO spotify_accounts (spotify_user_id) VALUES ($1)',
          [spotifyId],
        );
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(
      (
        await pool.query(
          'SELECT id FROM spotify_accounts WHERE spotify_user_id = $1',
          [spotifyId],
        )
      ).rowCount,
    ).toBe(0);
    await inTransaction(pool, async (client) => {
      await client.query(
        'INSERT INTO spotify_accounts (spotify_user_id) VALUES ($1)',
        [spotifyId],
      );
    });
    expect(
      (
        await pool.query(
          'SELECT id FROM spotify_accounts WHERE spotify_user_id = $1',
          [spotifyId],
        )
      ).rowCount,
    ).toBe(1);
  });

  it('stores one queue operation per request and cascades party deletion', async () => {
    const id = await party();
    const who = await guest(id);
    const song = await request(id, who);
    await pool.query(
      'INSERT INTO votes (party_id, request_id, guest_id) VALUES ($1, $2, $3)',
      [id, song, who],
    );
    await pool.query(
      'INSERT INTO spotify_queue_operations (request_id) VALUES ($1)',
      [song],
    );
    await expect(
      pool.query(
        'INSERT INTO spotify_queue_operations (request_id) VALUES ($1)',
        [song],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await pool.query('DELETE FROM parties WHERE id = $1', [id]);
    expect(
      (await pool.query('SELECT * FROM song_requests WHERE id = $1', [song]))
        .rowCount,
    ).toBe(0);
    expect(
      (await pool.query('SELECT * FROM votes WHERE request_id = $1', [song]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          'SELECT * FROM spotify_queue_operations WHERE request_id = $1',
          [song],
        )
      ).rowCount,
    ).toBe(0);
  });

  it('detects migration drift without changing existing data', async () => {
    await pool.query(
      "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1",
    );
    await expect(migrate(pool)).rejects.toThrow('migration history');
    expect((await pool.query('SELECT * FROM schema_migrations')).rowCount).toBe(
      4,
    );
  });
});
