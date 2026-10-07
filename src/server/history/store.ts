import type { Pool } from 'pg';
import { hashToken } from '../auth/crypto.js';
import { inTransaction } from '../db/index.js';
import { RequestError } from '../requests/contracts.js';
import { eventHistorySchema, type EventHistory } from './contracts.js';

export async function readEventHistory(
  pool: Pool,
  hostId: string,
  token: string,
  offset: number,
): Promise<EventHistory> {
  return inTransaction(pool, async (client) => {
    const party = (
      await client.query<{ id: string; status: 'ACTIVE' | 'ENDED' }>(
        'SELECT id,status FROM parties WHERE host_account_id=$1 AND admin_token_hash=$2 FOR SHARE',
        [hostId, hashToken(token)],
      )
    ).rows[0];
    if (!party) throw new RequestError(404, 'Party not found.');
    const counts = (
      await client.query<{ committed: number; observed: number }>(
        'SELECT count(*)::int AS committed,count(observed_at)::int AS observed FROM playback_entries WHERE party_id=$1 AND COALESCE(legacy_committed_at,locked_at) IS NOT NULL',
        [party.id],
      )
    ).rows[0];
    const rows = (
      await client.query<{
        id: string;
        position: number;
        track: unknown;
        source: 'GUEST' | 'BACKUP';
        display_name: string | null;
        locked_at: Date;
        observed_at: Date | null;
        delivery: EventHistory['items'][number]['delivery'];
      }>(
        `SELECT e.id,e.track,e.source,COALESCE(e.legacy_committed_at,e.locked_at) AS locked_at,e.observed_at,e.delivery,g.display_name,
       row_number() OVER (ORDER BY COALESCE(e.legacy_committed_at,e.locked_at),e.sequence)::int AS position
       FROM playback_entries e LEFT JOIN song_requests r ON r.id=e.request_id LEFT JOIN guests g ON g.id=r.requested_by
       WHERE e.party_id=$1 AND COALESCE(e.legacy_committed_at,e.locked_at) IS NOT NULL
       ORDER BY COALESCE(e.legacy_committed_at,e.locked_at),e.sequence LIMIT 51 OFFSET $2`,
        [party.id, offset],
      )
    ).rows;
    return eventHistorySchema.parse({
      items: rows.slice(0, 50).map((r) => ({
        id: r.id,
        position: r.position,
        track: r.track,
        source: r.source,
        requestedBy: r.source === 'BACKUP' ? null : r.display_name,
        committedAt: r.locked_at.toISOString(),
        observedAt: r.observed_at?.toISOString() ?? null,
        delivery: r.delivery,
      })),
      committedCount: counts.committed,
      observedCount: counts.observed,
      nextOffset: rows.length > 50 ? offset + 50 : null,
      status: party.status,
    });
  });
}
