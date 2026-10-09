import type { Pool } from 'pg';
import { hashToken } from '../auth/crypto.js';
import { inTransaction } from '../db/index.js';
import { RequestError } from '../requests/contracts.js';
import { partyStatisticsSchema, type PartyStatistics } from './contracts.js';

export async function readPartyStatistics(
  pool: Pool,
  hostId: string,
  token: string,
): Promise<PartyStatistics> {
  return inTransaction(pool, async (client) => {
    // One consistent snapshot for counts, ranking and the ended-session clock.
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const party = (
      await client.query<{ id: string; status: string; duration: number }>(
        `SELECT id,status,floor(greatest(0,extract(epoch FROM (coalesce(ended_at,now())-created_at))))::int AS duration
       FROM parties WHERE host_account_id=$1 AND admin_token_hash=$2`,
        [hostId, hashToken(token)],
      )
    ).rows[0];
    if (!party) throw new RequestError(404, 'Party not found.');
    const requests = (
      await client.query(
        `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status='REQUESTED')::int AS pending,
      count(*) FILTER (WHERE status='APPROVED')::int AS approved,
      count(*) FILTER (WHERE status='QUEUED')::int AS queued,
      count(*) FILTER (WHERE status='PLAYED')::int AS played,
      count(*) FILTER (WHERE status='REJECTED')::int AS rejected,
      count(*) FILTER (WHERE status='REMOVED')::int AS removed
      FROM song_requests WHERE party_id=$1`,
        [party.id],
      )
    ).rows[0];
    const participation = (
      await client.query(
        `SELECT
      (SELECT count(*)::int FROM guests WHERE party_id=$1) AS guests,
      count(*)::int AS votes, count(DISTINCT v.guest_id)::int AS voters
      FROM votes v JOIN song_requests r ON r.id=v.request_id WHERE v.party_id=$1 AND v.guest_id<>r.requested_by`,
        [party.id],
      )
    ).rows[0];
    const committed = (
      await client.query(
        `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE source='GUEST')::int AS guest,
      count(*) FILTER (WHERE source='BACKUP')::int AS backup,
      count(observed_at)::int AS observed
      FROM playback_entries WHERE party_id=$1 AND COALESCE(legacy_committed_at,locked_at) IS NOT NULL`,
        [party.id],
      )
    ).rows[0];
    const topSongs = (
      await client.query(
        `SELECT r.spotify_track_id AS "spotifyTrackId",
      min(r.track_name) AS title,min(r.artist_name) AS artist,count(*)::int AS votes
      FROM song_requests r JOIN votes v ON v.request_id=r.id AND v.party_id=r.party_id
      WHERE r.party_id=$1 AND v.guest_id<>r.requested_by GROUP BY r.spotify_track_id
      ORDER BY votes DESC,min(r.created_at),r.spotify_track_id LIMIT 5`,
        [party.id],
      )
    ).rows;
    return partyStatisticsSchema.parse({
      status: party.status,
      durationSeconds: party.duration,
      guestSessions: participation.guests,
      requests,
      votes: participation.votes,
      voters: participation.voters,
      committed,
      topSongs,
    });
  });
}
