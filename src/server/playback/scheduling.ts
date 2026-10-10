import { randomInt } from 'node:crypto';
import type { PoolClient } from 'pg';
import { trackSchema } from '../search/contracts.js';
export interface GuestEntryRow {
  id: string;
  status: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string;
  album_art_url: string | null;
  duration_ms: number;
  is_explicit: boolean;
  created_at: Date;
}
export async function insertGuestEntry(
  client: PoolClient,
  partyId: string,
  r: GuestEntryRow,
) {
  if (r.status !== 'APPROVED') return;
  const active = (
    await client.query<{ enabled: boolean; initialized: boolean }>(
      'SELECT enabled,initialized FROM party_playback WHERE party_id=$1',
      [partyId],
    )
  ).rows[0];
  if (!active?.enabled || !active.initialized) return;
  await client.query(
    `INSERT INTO playback_entries (party_id,request_id,source,track,created_at) VALUES ($1,$2,'GUEST',$3,$4) ON CONFLICT(request_id) DO NOTHING`,
    [
      partyId,
      r.id,
      JSON.stringify({
        id: r.spotify_track_id,
        title: r.track_name,
        artists: [r.artist_name],
        album: r.album_name,
        artworkUrl: r.album_art_url,
        durationMs: r.duration_ms,
        explicit: r.is_explicit,
        spotifyUrl: `https://open.spotify.com/track/${r.spotify_track_id}`,
      }),
      r.created_at,
    ],
  );
  await fillBackupBuffer(client, partyId);
}
// Called only while holding the party row lock. No provider calls in this transaction.
export async function fillBackupBuffer(client: PoolClient, partyId: string) {
  const state = (
    await client.query<{
      enabled: boolean;
      backup_tracks: unknown[];
      source_cursor: number;
      initialized: boolean;
      allow_explicit_tracks: boolean;
    }>(
      `SELECT b.enabled,b.initialized,b.backup_tracks,b.source_cursor,s.allow_explicit_tracks FROM party_playback b JOIN party_settings s ON s.party_id=b.party_id WHERE b.party_id=$1`,
      [partyId],
    )
  ).rows[0];
  if (!state?.enabled) return;
  const tracks = [
    ...new Map(
      state.backup_tracks
        .map((t) => trackSchema.parse(t))
        .filter((t) => state.allow_explicit_tracks || !t.explicit)
        .map((t) => [t.id, t]),
    ).values(),
  ];
  if (!tracks.length) return;
  const playing = (
    await client.query(
      "SELECT 1 FROM playback_entries WHERE party_id=$1 AND status='PLAYING'",
      [partyId],
    )
  ).rowCount;
  const minimum = playing ? 2 : 3;
  const guests = (
    await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM playback_entries WHERE party_id=$1 AND status IN ('WAITING','LOCKED') AND (source='GUEST' OR locked_at IS NOT NULL)",
      [partyId],
    )
  ).rows[0].count;
  const needed = Math.max(0, minimum - guests);
  // Guests replace only unlocked filler. Locked current/next never change.
  await client.query(
    `UPDATE playback_entries SET status='REMOVED' WHERE id IN (
    SELECT id FROM playback_entries WHERE party_id=$1 AND source='BACKUP' AND status='WAITING' AND locked_at IS NULL ORDER BY sequence OFFSET $2)`,
    [partyId, needed],
  );
  const count = (
    await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM playback_entries WHERE party_id=$1 AND status IN ('WAITING','LOCKED')",
      [partyId],
    )
  ).rows[0].count;
  // Durable usage survives restarts and source refreshes. Removed unlocked
  // filler can be selected again. Include guest occurrences
  // so backup selection does not repeat a song already requested by a guest.
  const usage = new Map(
    (
      await client.query<{ id: string; count: number }>(
        "SELECT track->>'id' AS id,count(*)::int AS count FROM playback_entries WHERE party_id=$1 AND status!='REMOVED' GROUP BY track->>'id'",
        [partyId],
      )
    ).rows.map((row) => [row.id, row.count]),
  );
  for (let n = count; n < minimum; n++) {
    const previous = (
      await client.query<{ track: { id: string } }>(
        "SELECT track FROM playback_entries WHERE party_id=$1 AND status!='REMOVED' ORDER BY sequence DESC LIMIT 1",
        [partyId],
      )
    ).rows[0]?.track.id;
    // Use every fresh track before repeating; subsequent cycles also use the
    // least-used tracks first, without immediate repeats when an alternative exists.
    const leastUsed = Math.min(...tracks.map((t) => usage.get(t.id) ?? 0));
    const cycle = tracks.filter((t) => (usage.get(t.id) ?? 0) === leastUsed);
    const candidates = cycle.filter((t) => t.id !== previous);
    const choices = candidates.length ? candidates : cycle;
    const t = choices[randomInt(choices.length)];
    await client.query(
      "INSERT INTO playback_entries (party_id,source,track) VALUES ($1,'BACKUP',$2)",
      [partyId, JSON.stringify(t)],
    );
    usage.set(t.id, (usage.get(t.id) ?? 0) + 1);
  }
}
