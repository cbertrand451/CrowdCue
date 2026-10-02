import type { PoolClient } from 'pg';
import { trackSchema } from '../search/contracts.js';
import type { SongRequest } from '../requests/contracts.js';
export interface Entry {
  id: string;
  request_id: string | null;
  source: 'GUEST' | 'BACKUP';
  track: SongRequest['track'];
  sequence: string;
  status: 'WAITING' | 'LOCKED' | 'PLAYING' | 'PLAYED' | 'REMOVED';
  locked_at: Date | null;
  delivery: 'PENDING' | 'SENDING' | 'SENT' | 'UNKNOWN';
  created_at: Date;
  vote_count: number;
  has_voted: boolean;
  display_name: string | null;
  requested_by: string | null;
}
export async function upcoming(
  client: PoolClient,
  partyId: string,
  votingEnabled: boolean,
  guestId?: string | null,
): Promise<Entry[]> {
  const rows = (
    await client.query<Entry>(
      `SELECT e.*, COALESCE((SELECT count(*)::int FROM votes v WHERE v.request_id=e.request_id),0) AS vote_count,
 EXISTS(SELECT 1 FROM votes v WHERE v.request_id=e.request_id AND v.guest_id=$2) AS has_voted,g.display_name,r.requested_by
 FROM playback_entries e LEFT JOIN song_requests r ON r.id=e.request_id LEFT JOIN guests g ON g.id=r.requested_by
 WHERE e.party_id=$1 AND e.status IN ('WAITING','LOCKED') ORDER BY (e.status='LOCKED') DESC,e.sequence`,
      [partyId, guestId ?? null],
    )
  ).rows;
  const guests = rows
    .filter((e) => e.status === 'WAITING' && e.source === 'GUEST')
    .sort(
      (a, b) =>
        (votingEnabled ? b.vote_count - a.vote_count : 0) ||
        a.created_at.getTime() - b.created_at.getTime() ||
        (a.request_id ?? a.id).localeCompare(b.request_id ?? b.id),
    );
  let index = 0;
  return rows.map((e) =>
    e.status === 'WAITING' && e.source === 'GUEST' ? guests[index++] : e,
  );
}
export function entryRequest(e: Entry, guestId?: string | null): SongRequest {
  return {
    id: e.request_id ?? e.id,
    track: trackSchema.parse(e.track),
    status: e.status === 'WAITING' ? 'APPROVED' : 'QUEUED',
    requestedBy: e.source === 'BACKUP' ? 'Backup playlist' : e.display_name,
    isOwn: !!guestId && e.requested_by === guestId,
    voteCount: e.vote_count,
    hasVoted: e.has_voted,
    locked: e.locked_at !== null,
    createdAt: e.created_at.toISOString(),
  };
}
