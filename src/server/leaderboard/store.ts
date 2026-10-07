import type { PoolClient } from 'pg';
import { leaderboardSchema } from './contracts.js';
export async function readLeaderboard(
  client: PoolClient,
  partyId: string,
  status: string,
  guestId: string | null = null,
) {
  const rows = (
    await client.query(
      `WITH scores AS (
 SELECT g.id,g.created_at,g.display_name,
 row_number() OVER (ORDER BY g.created_at,g.id) AS guest_number,
 (SELECT count(*)::int FROM playback_entries e JOIN song_requests r ON r.id=e.request_id
 WHERE e.party_id=g.party_id AND r.requested_by=g.id AND COALESCE(e.legacy_committed_at,e.locked_at) IS NOT NULL AND e.observed_at IS NOT NULL) AS songs,
 (SELECT count(*)::int FROM votes v JOIN song_requests r ON r.id=v.request_id
 WHERE r.party_id=g.party_id AND r.requested_by=g.id AND v.guest_id<>g.id AND r.status IN ('APPROVED','QUEUED','PLAYED')) AS votes
 FROM guests g WHERE g.party_id=$1
 ), ranked AS (
 SELECT *, (songs*5+votes)::int AS points,
 rank() OVER (ORDER BY songs*5+votes DESC)::int AS rank FROM scores
 ), numbered AS (
 SELECT *,row_number() OVER (ORDER BY points DESC,created_at,id) AS position,
 count(*) OVER ()::int AS participants FROM ranked
 ) SELECT rank,coalesce(display_name,'Guest '||guest_number) AS name,points,
 songs AS "songsObserved",votes AS "votesReceived",id=$2::uuid AS "isYou",participants,position
 FROM numbered WHERE position<=50 OR id=$2::uuid ORDER BY position`,
      [partyId, guestId],
    )
  ).rows;
  const clean = (r: Record<string, unknown>) => ({
    rank: r.rank,
    name: r.name,
    points: r.points,
    songsObserved: r.songsObserved,
    votesReceived: r.votesReceived,
    isYou: r.isYou === true,
  });
  return leaderboardSchema.parse({
    status,
    entries: rows.filter((r) => Number(r.position) <= 50).map(clean),
    yourEntry: rows.find((r) => r.isYou)
      ? clean(rows.find((r) => r.isYou)!)
      : null,
    participants: rows[0]?.participants ?? 0,
  });
}
