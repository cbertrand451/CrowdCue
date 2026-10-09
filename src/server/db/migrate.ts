import { createHash } from 'node:crypto';
import { MigrationHistoryError } from './diagnostics.js';
import type pg from 'pg';
import { inTransaction } from './index.js';
import { initialSchema } from './migrations/001-initial.js';
import { spotifyAuthSchema } from './migrations/002-spotify-auth.js';
import { songRequestsSchema } from './migrations/004-song-requests.js';
import { partyCreationSchema } from './migrations/003-party-creation.js';

import { playbackSchema } from './migrations/005-playback.js';
import { realtimeSchema } from './migrations/006-realtime.js';
import { eventHistorySchema } from './migrations/008-event-history.js';
import { displaySchema } from './migrations/007-display.js';

import { sessionPlaylistSchema } from './migrations/009-session-playlist.js';

const migrations = [
  { version: 1, name: 'initial', sql: initialSchema },
  { version: 2, name: 'spotify-auth', sql: spotifyAuthSchema },
  { version: 3, name: 'party-creation', sql: partyCreationSchema },
  { version: 4, name: 'song-requests', sql: songRequestsSchema },
  { version: 5, name: 'playback', sql: playbackSchema },
  { version: 6, name: 'realtime', sql: realtimeSchema },
  { version: 7, name: 'display', sql: displaySchema },
  { version: 8, name: 'event-history', sql: eventHistorySchema },
  { version: 9, name: 'session-playlist', sql: sessionPlaylistSchema },
];

export async function migrate(pool: pg.Pool) {
  return inTransaction(pool, async (client) => {
    // Serialize migration runners across processes, releasing on commit/rollback.
    await client.query('SELECT pg_advisory_xact_lock(713284, 1)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = await client.query<{
      version: number;
      name: string;
      checksum: string;
    }>(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    );
    for (const row of applied.rows) {
      const migration = migrations.find((item) => item.version === row.version);
      if (
        !migration ||
        migration.name !== row.name ||
        createHash('sha256').update(migration.sql).digest('hex') !==
          row.checksum
      ) {
        throw new MigrationHistoryError();
      }
    }
    const completed: number[] = [];
    for (const migration of migrations) {
      if (applied.rows.some((row) => row.version === migration.version))
        continue;
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [
          migration.version,
          migration.name,
          createHash('sha256').update(migration.sql).digest('hex'),
        ],
      );
      completed.push(migration.version);
    }
    return completed;
  });
}
