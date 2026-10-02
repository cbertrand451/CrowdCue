import type { PoolClient } from 'pg';
import { upcoming } from '../playback/ordering.js';
import { RequestError } from '../requests/contracts.js';
import type { QueueAction } from './contracts.js';
import { queueOrder } from './ordering.js';

// Caller holds the party's UPDATE lock, shared with votes, moderation and locking.
export async function changeQueueOrder(
  client: PoolClient,
  partyId: string,
  votingEnabled: boolean,
  action: QueueAction,
) {
  if (action.action === 'reset') {
    await client.query(
      "UPDATE song_requests SET manual_position=NULL,updated_at=now() WHERE party_id=$1 AND status='APPROVED' AND manual_position IS NOT NULL",
      [partyId],
    );
    return;
  }
  const initialized = (
    await client.query<{ initialized: boolean }>(
      'SELECT initialized FROM party_playback WHERE party_id=$1',
      [partyId],
    )
  ).rows[0]?.initialized;
  const ids = initialized
    ? (await upcoming(client, partyId, votingEnabled))
        .filter((e) => e.status === 'WAITING' && e.source === 'GUEST')
        .map((e) => e.request_id!)
    : (
        await client.query<{ id: string }>(
          `SELECT r.*, (SELECT count(*)::int FROM votes v WHERE v.request_id=r.id) AS vote_count FROM song_requests r WHERE party_id=$1 AND status='APPROVED' ORDER BY ${queueOrder(votingEnabled)}`,
          [partyId],
        )
      ).rows.map((r) => r.id);
  const from = ids.indexOf(action.requestId),
    neighbor = ids.indexOf(action.neighborId);
  if (from < 0 || neighbor < 0 || from === neighbor)
    throw new RequestError(
      409,
      'Only unlocked guest songs in this party can be moved. Refresh the queue.',
    );
  if (Math.abs(from - neighbor) !== 1)
    throw new RequestError(
      409,
      'The queue changed. Refresh it before moving this song.',
    );
  // Desired relative order makes a repeated submission safe, even after an
  // uncertain response. New votes can never undo an established host order.
  if (
    (action.direction === 'up' && from < neighbor) ||
    (action.direction === 'down' && from > neighbor)
  )
    return;
  [ids[from], ids[neighbor]] = [ids[neighbor], ids[from]];
  await client.query(
    `UPDATE song_requests r SET manual_position=o.rank::integer,updated_at=now()
     FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id,rank)
     WHERE r.party_id=$1 AND r.id=o.id AND r.status='APPROVED'`,
    [partyId, ids],
  );
}
