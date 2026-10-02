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
}
// Called only while holding the party row lock. No provider calls in this transaction.
export async function fillBackupBuffer(client: PoolClient, partyId: string) {
  const state = (
    await client.query<{
      enabled: boolean;
      backup_tracks: unknown[];
      source_cursor: number;
      allow_explicit_tracks: boolean;
    }>(
      `SELECT b.enabled,b.backup_tracks,b.source_cursor,s.allow_explicit_tracks FROM party_playback b JOIN party_settings s ON s.party_id=b.party_id WHERE b.party_id=$1`,
      [partyId],
    )
  ).rows[0];
  if (!state?.enabled) return;
  const tracks = state.backup_tracks
    .map((t) => trackSchema.parse(t))
    .filter((t) => state.allow_explicit_tracks || !t.explicit);
  if (!tracks.length) return;
  const count = (
    await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM playback_entries WHERE party_id=$1 AND status IN ('WAITING','LOCKED')",
      [partyId],
    )
  ).rows[0].count;
  let cursor = state.source_cursor;
  for (let n = count; n < 3; n++) {
    const previous = (
      await client.query<{ track: { id: string } }>(
        "SELECT track FROM playback_entries WHERE party_id=$1 AND status!='REMOVED' ORDER BY sequence DESC LIMIT 1",
        [partyId],
      )
    ).rows[0]?.track.id;
    let t = tracks[cursor % tracks.length];
    cursor++;
    if (tracks.length > 1 && t.id === previous) {
      t = tracks[cursor % tracks.length];
      cursor++;
    }
    await client.query(
      "INSERT INTO playback_entries (party_id,source,track) VALUES ($1,'BACKUP',$2)",
      [partyId, JSON.stringify(t)],
    );
  }
  await client.query(
    'UPDATE party_playback SET source_cursor=$2 WHERE party_id=$1',
    [partyId, cursor],
  );
}
