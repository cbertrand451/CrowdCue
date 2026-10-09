import { readLeaderboard } from '../leaderboard/store.js';
import { fillBackupBuffer, insertGuestEntry } from '../playback/scheduling.js';
import { upcoming, entryRequest, type Entry } from '../playback/ordering.js';
import { changeQueueOrder } from '../queue/controls.js';
import type { QueueAction } from '../queue/contracts.js';
import { queueOrder } from '../queue/ordering.js';
import type { QueueSnapshot } from '../queue/contracts.js';
import type pg from 'pg';
import type { PoolClient } from 'pg';
import { hashToken } from '../auth/crypto.js';
import { inTransaction } from '../db/index.js';
import type { SearchResult } from '../search/contracts.js';
import { RequestError, type SongRequest } from './contracts.js';
type Track = SearchResult['tracks'][number];
interface Context {
  id: string;
  host_account_id: string;
  status: string;
  require_guest_names: boolean;
  approval_required: boolean;
  voting_enabled: boolean;
  allow_explicit_tracks: boolean;
  max_active_requests_per_guest: number | null;
  request_cooldown_seconds: number;
  guest_id: string | null;
  display_name: string | null;
}
interface Row {
  id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string;
  album_art_url: string | null;
  duration_ms: number;
  is_explicit: boolean;
  status: SongRequest['status'];
  display_name: string | null;
  requested_by: string;
  created_at: Date;
  vote_count?: number;
  has_voted?: boolean;
  is_locked?: boolean;
}
const voteColumns = `(SELECT count(*)::int FROM votes v WHERE v.request_id = r.id AND v.guest_id <> r.requested_by) AS vote_count,
  EXISTS(SELECT 1 FROM votes v WHERE v.request_id = r.id AND v.guest_id = $3) AS has_voted,
  EXISTS(SELECT 1 FROM playback_entries pe WHERE pe.request_id=r.id AND pe.locked_at IS NOT NULL) AS is_locked`;
const active = "('REQUESTED', 'APPROVED', 'QUEUED')";
function details(row: Row, guestId?: string | null): SongRequest {
  return {
    id: row.id,
    status: row.status,
    requestedBy: row.display_name,
    isOwn: row.requested_by === guestId,
    voteCount: row.vote_count ?? 0,
    hasVoted: row.has_voted ?? false,
    locked: row.is_locked ?? false,
    createdAt: row.created_at.toISOString(),
    track: {
      id: row.spotify_track_id,
      title: row.track_name,
      artists: [row.artist_name],
      album: row.album_name,
      artworkUrl: row.album_art_url,
      durationMs: row.duration_ms,
      explicit: row.is_explicit,
      spotifyUrl: `https://open.spotify.com/track/${row.spotify_track_id}`,
    },
  };
}
export class PostgresRequestStore {
  constructor(private readonly pool: pg.Pool) {}
  private async context(
    client: pg.Pool | PoolClient,
    token: string,
    session?: string,
    lock: boolean | 'share' = false,
    mutation = true,
  ) {
    const result = await client.query<Context>(
      `SELECT p.id, p.host_account_id, p.status, s.require_guest_names, s.approval_required, s.voting_enabled, s.allow_explicit_tracks, s.max_active_requests_per_guest, s.request_cooldown_seconds,
      g.id AS guest_id, g.display_name FROM parties p JOIN party_settings s ON s.party_id = p.id
      LEFT JOIN guests g ON g.party_id = p.id AND g.session_token_hash = $2 AND g.expires_at > now()
      WHERE p.guest_join_token = $1 ${lock ? (lock === 'share' ? 'FOR SHARE OF p' : 'FOR UPDATE OF p') : ''}`,
      [token, session ? hashToken(session) : null],
    );
    const party = result.rows[0];
    if (!party) throw new RequestError(404, 'Party not found.');
    if (!party.guest_id)
      throw new RequestError(401, 'Join this party again to request songs.');
    if (mutation && party.status !== 'ACTIVE')
      throw new RequestError(409, 'This party has ended.');
    if (mutation && party.require_guest_names && !party.display_name)
      throw new RequestError(
        400,
        'Add your guest name before requesting songs.',
      );
    return party;
  }
  private async existing(
    client: pg.Pool | PoolClient,
    party: Context,
    id: string,
    key: string,
  ) {
    const attempt = await client.query<{
      request_id: string;
      spotify_track_id: string;
    }>(
      'SELECT request_id, spotify_track_id FROM song_request_attempts WHERE guest_id = $1 AND idempotency_key = $2',
      [party.guest_id, key],
    );
    if (attempt.rows[0] && attempt.rows[0].spotify_track_id !== id)
      throw new RequestError(
        409,
        'This request attempt already used a different song. Start a new attempt.',
      );
    const result = await client.query<Row>(
      `SELECT r.*, g.display_name, ${voteColumns} FROM song_requests r JOIN guests g ON g.id = r.requested_by WHERE r.party_id = $1 AND ${attempt.rows[0] ? 'r.id = $2' : `r.spotify_track_id = $2 AND r.status IN ${active}`}`,
      [party.id, attempt.rows[0]?.request_id ?? id, party.guest_id],
    );
    return result.rows[0];
  }
  private async played(
    client: pg.Pool | PoolClient,
    party: Context,
    id: string,
  ) {
    return (
      (
        await client.query(
          `SELECT 1 FROM song_requests WHERE party_id=$1 AND spotify_track_id=$2 AND status='PLAYED'
      UNION ALL SELECT 1 FROM playback_entries WHERE party_id=$1 AND track->>'id'=$2 AND (status='PLAYED' OR (status='PLAYING' AND observed_at IS NOT NULL)) LIMIT 1`,
          [party.id, id],
        )
      ).rowCount !== 0
    );
  }

  private async remember(
    client: PoolClient,
    party: Context,
    id: string,
    key: string,
    requestId: string,
  ) {
    await client.query(
      'INSERT INTO song_request_attempts (party_id, guest_id, idempotency_key, spotify_track_id, request_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (guest_id, idempotency_key) DO NOTHING',
      [party.id, party.guest_id, key, id, requestId],
    );
  }
  async prepare(
    token: string,
    session: string | undefined,
    id: string,
    key: string,
    confirmPlayedRepeat = false,
  ) {
    return inTransaction(this.pool, async (client) => {
      const party = await this.context(client, token, session, true);
      const row = await this.existing(client, party, id, key.toLowerCase());
      if (row) {
        await this.remember(client, party, id, key.toLowerCase(), row.id);
        return {
          result: { request: details(row, party.guest_id), created: false },
          hostId: party.host_account_id,
        };
      }
      if (!confirmPlayedRepeat && (await this.played(client, party, id)))
        return {
          result: {
            confirmationRequired: true,
            message: 'Song already played...proceed?' as const,
          },
          hostId: party.host_account_id,
        };
      return { result: null, hostId: party.host_account_id };
    });
  }
  async create(
    token: string,
    session: string | undefined,
    track: Track,
    key: string,
    confirmPlayedRepeat = false,
  ) {
    key = key.toLowerCase();
    return inTransaction(this.pool, async (client) => {
      const party = await this.context(client, token, session, true);
      const old = await this.existing(client, party, track.id, key);
      if (old) {
        await this.remember(client, party, track.id, key, old.id);
        return { request: details(old, party.guest_id), created: false };
      }
      if (!confirmPlayedRepeat && (await this.played(client, party, track.id)))
        return {
          confirmationRequired: true,
          message: 'Song already played...proceed?' as const,
        };
      if (track.explicit && !party.allow_explicit_tracks)
        throw new RequestError(
          400,
          'Explicit songs are turned off for this party.',
        );
      const usage = (
        await client.query<{ count: string; wait: number }>(
          `SELECT count(*) FILTER (WHERE status IN ${active}) AS count,
        greatest(0, ceil($3 - extract(epoch FROM (now() - max(created_at)))))::int AS wait FROM song_requests WHERE party_id = $1 AND requested_by = $2`,
          [party.id, party.guest_id, party.request_cooldown_seconds],
        )
      ).rows[0];
      if (
        party.max_active_requests_per_guest !== null &&
        Number(usage.count) >= party.max_active_requests_per_guest
      )
        throw new RequestError(
          409,
          'You have reached this party’s active request limit.',
        );
      if (usage.wait > 0)
        throw new RequestError(
          429,
          `Wait ${usage.wait} seconds before requesting another song.`,
          usage.wait,
        );
      const saved = await client.query<Row>(
        `INSERT INTO song_requests (party_id, requested_by, spotify_track_id, track_name, artist_name, album_name, album_art_url, duration_ms, is_explicit, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          party.id,
          party.guest_id,
          track.id,
          track.title,
          track.artists.join(', '),
          track.album,
          track.artworkUrl,
          track.durationMs,
          track.explicit,
          party.approval_required ? 'REQUESTED' : 'APPROVED',
        ],
      );
      const row = { ...saved.rows[0], display_name: party.display_name };
      await insertGuestEntry(client, party.id, row);
      await this.remember(client, party, track.id, key, row.id);
      return { request: details(row, party.guest_id), created: true };
    });
  }
  private async list(partyId: string, offset: number, guestId?: string | null) {
    const result = await this.pool.query<Row>(
      `SELECT r.*, g.display_name, ${voteColumns} FROM song_requests r JOIN guests g ON g.id = r.requested_by WHERE r.party_id = $1 ${guestId ? `AND (r.status IN ${active} OR r.requested_by = $3)` : ''} ORDER BY r.created_at DESC, r.id DESC LIMIT 51 OFFSET $2`,
      [partyId, offset, guestId ?? null],
    );
    return {
      requests: result.rows.slice(0, 50).map((row) => details(row, guestId)),
      nextOffset: result.rows.length > 50 ? offset + 50 : null,
    };
  }
  async guestLeaderboard(token: string, session: string | undefined) {
    return inTransaction(this.pool, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const party = await this.context(client, token, session, false, false);
      return readLeaderboard(client, party.id, party.status, party.guest_id);
    });
  }
  async adminLeaderboard(hostId: string, token: string) {
    return inTransaction(this.pool, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const party = await this.hostParty(client, hostId, token);
      return readLeaderboard(client, party.id, party.status);
    });
  }
  async guestList(token: string, session: string | undefined, offset: number) {
    const party = await this.context(this.pool, token, session, false, false);
    return this.list(party.id, offset, party.guest_id);
  }
  private async hostParty(
    client: pg.Pool | PoolClient,
    hostId: string,
    token: string,
    lock: boolean | 'share' = false,
  ) {
    const result = await client.query<{
      id: string;
      status: 'ACTIVE' | 'ENDED';
      voting_enabled: boolean;
    }>(
      `SELECT p.id, p.status, s.voting_enabled FROM parties p JOIN party_settings s ON s.party_id = p.id WHERE p.host_account_id = $1 AND p.admin_token_hash = $2 ${lock ? (lock === 'share' ? 'FOR SHARE OF p' : 'FOR UPDATE OF p') : ''}`,
      [hostId, hashToken(token)],
    );
    if (!result.rows[0]) throw new RequestError(404, 'Party not found.');
    return result.rows[0];
  }
  async adminList(hostId: string, token: string, offset: number) {
    const party = await this.hostParty(this.pool, hostId, token);
    return this.list(party.id, offset);
  }
  async moderate(
    hostId: string,
    token: string,
    id: string,
    action: 'approve' | 'reject' | 'remove',
  ) {
    return inTransaction(this.pool, async (client) => {
      const party = await this.hostParty(client, hostId, token, true);
      if (party.status !== 'ACTIVE')
        throw new RequestError(409, 'This party has ended.');
      const row = (
        await client.query<Row>(
          `SELECT r.*, g.display_name, ${voteColumns} FROM song_requests r JOIN guests g ON g.id = r.requested_by WHERE r.party_id = $1 AND r.id = $2 FOR UPDATE OF r`,
          [party.id, id, null],
        )
      ).rows[0];
      if (!row) throw new RequestError(404, 'Request not found.');
      const target =
        action === 'approve'
          ? 'APPROVED'
          : action === 'reject'
            ? 'REJECTED'
            : 'REMOVED';
      if (row.status === target) return details(row);
      if (
        !['REQUESTED', 'APPROVED'].includes(row.status) ||
        (action === 'approve' && row.status !== 'REQUESTED')
      )
        throw new RequestError(409, 'This request can no longer be changed.');
      await client.query(
        "UPDATE playback_entries SET status='REMOVED' WHERE request_id=$1 AND status='WAITING'",
        [id],
      );
      await client.query(
        'UPDATE song_requests SET status = $2, updated_at = now() WHERE id = $1',
        [id, target],
      );
      const changed: Row = { ...row, status: target };
      await fillBackupBuffer(client, party.id);
      await insertGuestEntry(client, party.id, changed);
      return details(changed);
    });
  }
  async trackStates(token: string, session: string | undefined, ids: string[]) {
    return inTransaction(this.pool, async (client) => {
      const party = await this.context(client, token, session, 'share', false);
      const result = await client.query<{
        track_id: string;
        requested: boolean;
        played: boolean;
      }>(
        `SELECT track_id,
          EXISTS(SELECT 1 FROM song_requests r WHERE r.party_id=$1 AND r.spotify_track_id=track_id AND r.status IN ('REQUESTED','APPROVED','QUEUED'))
          OR EXISTS(SELECT 1 FROM playback_entries e WHERE e.party_id=$1 AND e.track->>'id'=track_id AND e.status IN ('WAITING','LOCKED')) AS requested,
          EXISTS(SELECT 1 FROM song_requests r WHERE r.party_id=$1 AND r.spotify_track_id=track_id AND r.status='PLAYED')
          OR EXISTS(SELECT 1 FROM playback_entries e WHERE e.party_id=$1 AND e.track->>'id'=track_id AND (e.status='PLAYED' OR (e.status='PLAYING' AND e.observed_at IS NOT NULL))) AS played
         FROM unnest($2::text[]) AS track_id`,
        [party.id, ids],
      );
      return {
        tracks: result.rows.map((r) => ({
          id: r.track_id,
          requested: r.requested,
          played: r.played,
        })),
      };
    });
  }
  async vote(
    token: string,
    session: string | undefined,
    id: string,
    voted: boolean,
  ) {
    return inTransaction(this.pool, async (client) => {
      const party = await this.context(client, token, session, true);
      if (!party.voting_enabled)
        throw new RequestError(409, 'Voting is turned off for this party.');
      const row = (
        await client.query<Row>(
          'SELECT r.*, g.display_name FROM song_requests r JOIN guests g ON g.id = r.requested_by WHERE r.party_id = $1 AND r.id = $2 FOR UPDATE OF r',
          [party.id, id],
        )
      ).rows[0];
      if (!row) throw new RequestError(404, 'Request not found.');
      if (voted && row.requested_by === party.guest_id)
        throw new RequestError(409, 'You cannot vote for your own song.');
      if (!['REQUESTED', 'APPROVED'].includes(row.status))
        throw new RequestError(409, 'Voting is closed for this request.');
      if (voted)
        await client.query(
          'INSERT INTO votes (party_id, request_id, guest_id) VALUES ($1, $2, $3) ON CONFLICT (request_id, guest_id) DO NOTHING',
          [party.id, id, party.guest_id],
        );
      else
        await client.query(
          'DELETE FROM votes WHERE party_id = $1 AND request_id = $2 AND guest_id = $3',
          [party.id, id, party.guest_id],
        );
      const saved = (
        await client.query<Row>(
          `SELECT r.*, g.display_name, ${voteColumns} FROM song_requests r JOIN guests g ON g.id = r.requested_by WHERE r.party_id = $1 AND r.id = $2`,
          [party.id, id, party.guest_id],
        )
      ).rows[0];
      return details(saved, party.guest_id);
    });
  }
  private async queue(
    client: PoolClient,
    party: { id: string; status: string; voting_enabled: boolean },
    offset: number,
    guestId?: string | null,
  ): Promise<QueueSnapshot> {
    // A joined settings row can precede a wait for the party lock. Read it again
    // after acquiring the lock so the policy and ranked songs share one state.
    const settings = (
      await client.query<{ voting_enabled: boolean }>(
        'SELECT voting_enabled FROM party_settings WHERE party_id = $1',
        [party.id],
      )
    ).rows[0];
    const hostOrdered = (
      await client.query<{ present: boolean }>(
        "SELECT (EXISTS(SELECT 1 FROM song_requests WHERE party_id=$1 AND status='APPROVED' AND manual_position IS NOT NULL) OR EXISTS(SELECT 1 FROM playback_entries WHERE party_id=$1 AND status='WAITING' AND manual_position IS NOT NULL)) AS present",
        [party.id],
      )
    ).rows[0].present;
    const session = (
      await client.query<{ initialized: boolean }>(
        'SELECT initialized FROM party_playback WHERE party_id=$1',
        [party.id],
      )
    ).rows[0];
    if (session?.initialized) {
      const entries = await upcoming(
        client,
        party.id,
        settings.voting_enabled,
        guestId,
      );
      const current = (
        await client.query<Entry>(
          "SELECT e.*,g.display_name,r.requested_by,0 AS vote_count,false AS has_voted FROM playback_entries e LEFT JOIN song_requests r ON r.id=e.request_id LEFT JOIN guests g ON g.id=r.requested_by WHERE e.party_id=$1 AND e.status='PLAYING'",
          [party.id],
        )
      ).rows[0];
      return {
        current: current ? entryRequest(current, guestId) : null,
        currentSource: current?.source ?? null,
        items: entries.slice(offset, offset + 50).map((e, i) => ({
          position: offset + i + 1,
          source: e.source,
          locked: e.locked_at !== null,
          delivery: e.delivery,
          request: entryRequest(e, guestId),
        })),
        nextOffset: entries.length > offset + 50 ? offset + 50 : null,
        hostOrdered,
        votingEnabled: settings.voting_enabled,
        status: party.status as 'ACTIVE' | 'ENDED',
      };
    }
    const order = queueOrder(settings.voting_enabled);
    const result = await client.query<Row & { position: number }>(
      `WITH ranked AS (
      SELECT r.*, g.display_name, ${voteColumns} FROM song_requests r JOIN guests g ON g.id = r.requested_by
      WHERE r.party_id = $1 AND r.status = 'APPROVED'
    ) SELECT *, row_number() OVER (ORDER BY ${order})::int AS position FROM ranked
      ORDER BY ${order} LIMIT 51 OFFSET $2`,
      [party.id, offset, guestId ?? null],
    );
    return {
      current: null,
      currentSource: null,
      items: result.rows.slice(0, 50).map((row) => ({
        position: row.position,
        source: 'GUEST' as const,
        locked: false,
        delivery: 'PENDING' as const,
        request: details(row, guestId),
      })),
      nextOffset: result.rows.length > 50 ? offset + 50 : null,
      hostOrdered,
      votingEnabled: settings.voting_enabled,
      status: party.status as 'ACTIVE' | 'ENDED',
    };
  }
  async guestQueue(token: string, session: string | undefined, offset: number) {
    return inTransaction(this.pool, async (client) => {
      const party = await this.context(client, token, session, 'share', false);
      return this.queue(client, party, offset, party.guest_id);
    });
  }
  async controlQueue(hostId: string, token: string, action: QueueAction) {
    return inTransaction(this.pool, async (client) => {
      const party = await this.hostParty(client, hostId, token, true);
      if (party.status !== 'ACTIVE')
        throw new RequestError(409, 'This party has ended.');
      // Re-read settings after the party lock; another host may have saved them.
      const settings = (
        await client.query<{ voting_enabled: boolean }>(
          'SELECT voting_enabled FROM party_settings WHERE party_id=$1',
          [party.id],
        )
      ).rows[0];
      await changeQueueOrder(client, party.id, settings.voting_enabled, action);
      return { ok: true };
    });
  }
  async adminQueue(hostId: string, token: string, offset: number) {
    return inTransaction(this.pool, async (client) => {
      const party = await this.hostParty(client, hostId, token, 'share');
      return this.queue(client, party, offset);
    });
  }
}
