import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { inTransaction } from '../db/index.js';
import { hashToken, newToken, TokenCipher } from '../auth/crypto.js';
import {
  type CreatePartyInput,
  type PartyDetails,
  type PublicParty,
  PartyError,
} from './contracts.js';

interface PartyRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'ENDED';
  created_at: Date;
  ended_at: Date | null;
  guest_join_token: string;
  require_guest_names: boolean;
  voting_enabled: boolean;
  approval_required: boolean;
  max_active_requests_per_guest: number | null;
  allow_explicit_tracks: boolean;
  request_cooldown_seconds: number;
  queue_behavior: 'SPOTIFY_QUEUE' | 'BACKUP_PLAYLIST';
  backup_source_id: string | null;
  save_recap_playlist: boolean;
  tokens_ciphertext?: Buffer | null;
  encryption_key_id?: string | null;
}
const columns = `p.id, p.name, p.status, p.created_at, p.ended_at, p.guest_join_token,
 s.require_guest_names, s.voting_enabled, s.approval_required, s.max_active_requests_per_guest,
 s.allow_explicit_tracks, s.request_cooldown_seconds, s.queue_behavior, s.backup_source_id, s.save_recap_playlist`;
function publicDetails(row: PartyRow): PublicParty {
  return {
    name: row.name,
    status: row.status,
    settings: {
      requireGuestNames: row.require_guest_names,
      votingEnabled: row.voting_enabled,
      approvalRequired: row.approval_required,
      maxActiveRequestsPerGuest: row.max_active_requests_per_guest,
      allowExplicitTracks: row.allow_explicit_tracks,
      requestCooldownSeconds: row.request_cooldown_seconds,
      queueBehavior: row.queue_behavior,
      backupSourceId: row.backup_source_id,
      saveRecapPlaylist: row.save_recap_playlist,
    },
  };
}
const linkTokensSchema = z
  .object({
    admin: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    display: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export interface PartyStore {
  create(
    hostId: string,
    input: CreatePartyInput,
    idempotencyKey: string,
    cover?: Buffer,
  ): Promise<{ party: PartyDetails; created: boolean }>;
  list(
    hostId: string,
    offset: number,
  ): Promise<{ parties: PartyDetails[]; nextOffset: number | null }>;
  archive(
    hostId: string,
    offset: number,
  ): Promise<{
    parties: import('./contracts.js').ArchiveItem[];
    nextOffset: number | null;
  }>;
  removeFromArchive(
    hostId: string,
    partyId: string,
  ): Promise<{ removed: boolean }>;
  cover(hostId: string, partyId: string): Promise<Buffer>;
  saveCover(
    hostId: string,
    partyId: string,
    image: Buffer,
  ): Promise<{ saved: boolean }>;
  close(hostId: string, partyId: string): Promise<{ closed: boolean }>;
  owned(hostId: string, partyId: string): Promise<PartyDetails>;
  admin(hostId: string, token: string): Promise<PartyDetails>;
  update(
    hostId: string,
    token: string,
    input: CreatePartyInput,
  ): Promise<PartyDetails>;
  end(hostId: string, token: string): Promise<PartyDetails>;
  public(
    token: string,
    role: 'guest' | 'display',
  ): Promise<PublicParty & { guestUrl?: string }>;
}

export class PostgresPartyStore implements PartyStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly cipher: TokenCipher,
    private readonly appOrigin: string,
  ) {}
  private details(row: PartyRow): PartyDetails {
    const tokens =
      row.tokens_ciphertext && row.encryption_key_id
        ? linkTokensSchema.parse(
            JSON.parse(
              this.cipher.decrypt(
                row.tokens_ciphertext,
                row.encryption_key_id,
                `party:${row.id}:links`,
              ),
            ),
          )
        : null;
    return {
      ...publicDetails(row),
      id: row.id,
      createdAt: row.created_at.toISOString(),
      endedAt: row.ended_at?.toISOString() || null,
      links: {
        guest: `${this.appOrigin}/join/${row.guest_join_token}`,
        admin: tokens ? `${this.appOrigin}/admin/${tokens.admin}` : null,
        display: tokens ? `${this.appOrigin}/display/${tokens.display}` : null,
      },
    };
  }
  private async readOwned(
    client: PoolClient | pg.Pool,
    hostId: string,
    predicate: string,
    value: string,
  ) {
    const result = await client.query<PartyRow>(
      `SELECT ${columns}, l.tokens_ciphertext, l.encryption_key_id
       FROM parties p JOIN party_settings s ON s.party_id = p.id
       LEFT JOIN party_link_secrets l ON l.party_id = p.id
       WHERE p.host_account_id = $1 AND ${predicate} = $2`,
      [hostId, value],
    );
    if (!result.rows[0]) throw new PartyError(404, 'Party not found.');
    return this.details(result.rows[0]);
  }
  async create(
    hostId: string,
    input: CreatePartyInput,
    idempotencyKey: string,
    cover?: Buffer,
  ) {
    idempotencyKey = idempotencyKey.toLowerCase();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(input))
      .update(cover ?? Buffer.alloc(0))
      .digest('hex');
    return inTransaction(this.pool, async (client) => {
      // Serialize concurrent retries for the same host/key across processes.
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        [hostId, idempotencyKey],
      );
      const existing = await client.query<{
        party_id: string;
        payload_hash: string;
      }>(
        'SELECT party_id, payload_hash FROM party_creation_requests WHERE host_account_id = $1 AND idempotency_key = $2',
        [hostId, idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].payload_hash !== fingerprint) {
          throw new PartyError(
            409,
            'This creation attempt already has different party details. Start a new attempt.',
          );
        }
        return {
          party: await this.readOwned(
            client,
            hostId,
            'p.id',
            existing.rows[0].party_id,
          ),
          created: false,
        };
      }
      const id = randomUUID();
      const guestToken = newToken();
      const adminToken = newToken();
      const displayToken = newToken();
      await client.query(
        `INSERT INTO parties (id, host_account_id, name, guest_join_token, admin_token_hash, display_token_hash)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          hostId,
          input.name,
          guestToken,
          hashToken(adminToken),
          hashToken(displayToken),
        ],
      );
      if (cover)
        await client.query(
          'INSERT INTO party_covers (party_id,image) VALUES ($1,$2)',
          [id, cover],
        );
      const settings = input.settings;
      await client.query(
        `INSERT INTO party_settings
         (party_id, require_guest_names, voting_enabled, approval_required, max_active_requests_per_guest,
          allow_explicit_tracks, request_cooldown_seconds, queue_behavior, backup_source_id, save_recap_playlist)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          settings.requireGuestNames,
          settings.votingEnabled,
          settings.approvalRequired,
          settings.maxActiveRequestsPerGuest,
          settings.allowExplicitTracks,
          settings.requestCooldownSeconds,
          'BACKUP_PLAYLIST',
          settings.backupSourceId,
          true,
        ],
      );
      await client.query(
        'INSERT INTO party_playback (party_id,host_account_id,save_at_creation) VALUES ($1,$2,$3)',
        [id, hostId, true],
      );
      const encrypted = this.cipher.encrypt(
        JSON.stringify({ admin: adminToken, display: displayToken }),
        `party:${id}:links`,
      );
      await client.query(
        'INSERT INTO party_link_secrets (party_id, tokens_ciphertext, encryption_key_id) VALUES ($1, $2, $3)',
        [id, encrypted.data, encrypted.keyId],
      );
      await client.query(
        'INSERT INTO party_creation_requests (host_account_id, idempotency_key, payload_hash, party_id) VALUES ($1, $2, $3, $4)',
        [hostId, idempotencyKey, fingerprint, id],
      );
      return {
        party: await this.readOwned(client, hostId, 'p.id', id),
        created: true,
      };
    });
  }
  async list(hostId: string, offset: number) {
    const result = await this.pool.query<PartyRow>(
      `SELECT ${columns}, l.tokens_ciphertext, l.encryption_key_id
       FROM parties p JOIN party_settings s ON s.party_id = p.id
       LEFT JOIN party_link_secrets l ON l.party_id = p.id
       WHERE p.host_account_id = $1 AND p.closed_at IS NULL ORDER BY p.created_at DESC, p.id DESC LIMIT 21 OFFSET $2`,
      [hostId, offset],
    );
    return {
      parties: result.rows.slice(0, 20).map((row) => this.details(row)),
      nextOffset: result.rows.length > 20 ? offset + 20 : null,
    };
  }
  async archive(hostId: string, offset: number) {
    const rows = (
      await this.pool.query<{
        id: string;
        name: string;
        created_at: Date;
        ended_at: Date | null;
        playlist_id: string | null;
        has_cover: boolean;
        track_count: number;
      }>(
        `SELECT p.id,p.name,p.created_at,p.ended_at,
       CASE WHEN b.playlist_removed THEN NULL ELSE b.playlist_id END AS playlist_id,
       c.party_id IS NOT NULL AS has_cover,
       (SELECT count(*)::int FROM playback_entries e WHERE e.party_id=p.id AND COALESCE(e.legacy_committed_at,e.locked_at) IS NOT NULL) AS track_count
       FROM parties p LEFT JOIN party_playback b ON b.party_id=p.id LEFT JOIN party_covers c ON c.party_id=p.id
       WHERE p.host_account_id=$1 AND p.status='ENDED' AND p.archive_hidden_at IS NULL
       ORDER BY p.created_at DESC,p.id DESC LIMIT 21 OFFSET $2`,
        [hostId, offset],
      )
    ).rows;
    return {
      parties: rows.slice(0, 20).map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.created_at.toISOString(),
        endedAt: p.ended_at?.toISOString() ?? null,
        playlistUrl: p.playlist_id
          ? `https://open.spotify.com/playlist/${p.playlist_id}`
          : null,
        coverUrl: p.has_cover ? `/api/parties/${p.id}/cover` : null,
        trackCount: p.track_count,
      })),
      nextOffset: rows.length > 20 ? offset + 20 : null,
    };
  }
  async removeFromArchive(hostId: string, partyId: string) {
    const result = await this.pool.query(
      "UPDATE parties SET archive_hidden_at=COALESCE(archive_hidden_at,now()) WHERE id=$1 AND host_account_id=$2 AND status='ENDED' RETURNING id",
      [partyId, hostId],
    );
    if (!result.rowCount)
      throw new PartyError(404, 'Archived party not found.');
    return { removed: true };
  }
  async cover(hostId: string, partyId: string) {
    const row = (
      await this.pool.query<{ image: Buffer }>(
        'SELECT c.image FROM party_covers c JOIN parties p ON p.id=c.party_id WHERE p.id=$1 AND p.host_account_id=$2',
        [partyId, hostId],
      )
    ).rows[0];
    if (!row) throw new PartyError(404, 'Cover not found.');
    return row.image;
  }
  async saveCover(hostId: string, partyId: string, image: Buffer) {
    return inTransaction(this.pool, async (client) => {
      const row = (
        await client.query<{ status: string }>(
          'SELECT status FROM parties WHERE id=$1 AND host_account_id=$2 FOR UPDATE',
          [partyId, hostId],
        )
      ).rows[0];
      if (!row) throw new PartyError(404, 'Party not found.');
      if (row.status !== 'ACTIVE')
        throw new PartyError(409, 'This party has ended.');
      await client.query(
        `INSERT INTO party_covers(party_id,image) VALUES($1,$2)
       ON CONFLICT(party_id) DO UPDATE SET image=EXCLUDED.image,revision=party_covers.revision+1,error_code=NULL,retry_at=NULL`,
        [partyId, image],
      );
      return { saved: true };
    });
  }
  async close(hostId: string, partyId: string) {
    return inTransaction(this.pool, async (client) => {
      const party = (
        await client.query<{ status: string }>(
          'SELECT status FROM parties WHERE id=$1 AND host_account_id=$2 FOR UPDATE',
          [partyId, hostId],
        )
      ).rows[0];
      if (!party) throw new PartyError(404, 'Party not found.');
      if (party.status !== 'ENDED')
        throw new PartyError(409, 'End the party before closing it.');
      await client.query(
        'UPDATE parties SET closed_at=COALESCE(closed_at,now()) WHERE id=$1',
        [partyId],
      );
      return { closed: true };
    });
  }
  owned(hostId: string, partyId: string) {
    return this.readOwned(this.pool, hostId, 'p.id', partyId);
  }
  admin(hostId: string, token: string) {
    return this.readOwned(
      this.pool,
      hostId,
      'p.admin_token_hash',
      hashToken(token),
    );
  }
  async public(token: string, role: 'guest' | 'display') {
    const column =
      role === 'guest' ? 'p.guest_join_token' : 'p.display_token_hash';
    const result = await this.pool.query<PartyRow>(
      `SELECT ${columns} FROM parties p JOIN party_settings s ON s.party_id = p.id WHERE ${column} = $1`,
      [role === 'guest' ? token : hashToken(token)],
    );
    if (!result.rows[0]) throw new PartyError(404, 'Party not found.');
    const row = result.rows[0];
    return {
      ...publicDetails(row),
      ...(role === 'display'
        ? { guestUrl: `${this.appOrigin}/join/${row.guest_join_token}` }
        : {}),
    };
  }
  private async change(
    hostId: string,
    token: string,
    input?: CreatePartyInput,
  ) {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query<{ id: string; status: string }>(
        'SELECT id, status FROM parties WHERE host_account_id = $1 AND admin_token_hash = $2 FOR UPDATE',
        [hostId, hashToken(token)],
      );
      const party = result.rows[0];
      if (!party) throw new PartyError(404, 'Party not found.');
      if (input) {
        if (party.status !== 'ACTIVE')
          throw new PartyError(409, 'This party has ended.');
        await client.query('UPDATE parties SET name = $2 WHERE id = $1', [
          party.id,
          input.name,
        ]);
        const s = input.settings;
        // Never replenish from a cache belonging to the previous source/policy.
        // Existing reserved and locked playback entries intentionally stay intact.
        await client.query(
          `UPDATE party_playback b SET backup_tracks='[]'::jsonb,source_cursor=0,retry_at=NULL
           FROM party_settings old WHERE b.party_id=$1 AND old.party_id=b.party_id
           AND (old.backup_source_id IS DISTINCT FROM $2 OR old.allow_explicit_tracks IS DISTINCT FROM $3)`,
          [party.id, s.backupSourceId, s.allowExplicitTracks],
        );
        await client.query(
          `UPDATE party_settings SET require_guest_names = $2, voting_enabled = $3,
          approval_required = $4, max_active_requests_per_guest = $5, allow_explicit_tracks = $6,
          request_cooldown_seconds = $7, queue_behavior = $8, backup_source_id = $9 WHERE party_id = $1`,
          [
            party.id,
            s.requireGuestNames,
            s.votingEnabled,
            s.approvalRequired,
            s.maxActiveRequestsPerGuest,
            s.allowExplicitTracks,
            s.requestCooldownSeconds,
            'BACKUP_PLAYLIST',
            s.backupSourceId,
          ],
        );
      } else if (party.status === 'ACTIVE') {
        await client.query(
          "UPDATE parties SET status = 'ENDED', ended_at = now() WHERE id = $1",
          [party.id],
        );
      }
      if (!input)
        await client.query(
          'UPDATE party_playback SET enabled=false WHERE party_id=$1',
          [party.id],
        );
      return this.readOwned(client, hostId, 'p.id', party.id);
    });
  }
  update(hostId: string, token: string, input: CreatePartyInput) {
    return this.change(hostId, token, input);
  }
  end(hostId: string, token: string) {
    return this.change(hostId, token);
  }
}
