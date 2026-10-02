import type pg from 'pg';
import { hashToken, newToken } from '../auth/crypto.js';
import { inTransaction } from '../db/index.js';
import { GuestError, type GuestSession } from './contracts.js';
interface GuestRow {
  id: string;
  display_name: string | null;
  expires_at: Date;
}
function details(row: GuestRow): GuestSession {
  return {
    id: row.id,
    displayName: row.display_name,
    expiresAt: row.expires_at.toISOString(),
  };
}
export class PostgresGuestStore {
  constructor(private readonly pool: pg.Pool) {}
  async session(
    joinToken: string,
    sessionToken?: string,
  ): Promise<GuestSession | null> {
    const party = await this.pool.query<{ id: string }>(
      'SELECT id FROM parties WHERE guest_join_token = $1',
      [joinToken],
    );
    if (!party.rows[0]) throw new GuestError(404, 'Party not found.');
    if (!sessionToken) return null;
    const result = await this.pool.query<GuestRow>(
      'SELECT id, display_name, expires_at FROM guests WHERE party_id = $1 AND session_token_hash = $2 AND expires_at > now()',
      [party.rows[0].id, hashToken(sessionToken)],
    );
    return result.rows[0] ? details(result.rows[0]) : null;
  }
  async join(
    joinToken: string,
    sessionToken: string | undefined,
    displayName?: string | null,
  ) {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query<{
        id: string;
        status: string;
        require_guest_names: boolean;
      }>(
        `SELECT p.id, p.status, s.require_guest_names FROM parties p JOIN party_settings s ON s.party_id = p.id WHERE p.guest_join_token = $1 FOR UPDATE OF p`,
        [joinToken],
      );
      const party = result.rows[0];
      if (!party) throw new GuestError(404, 'Party not found.');
      if (party.status !== 'ACTIVE')
        throw new GuestError(409, 'This party has ended.');
      const existing = sessionToken
        ? await client.query<GuestRow>(
            'SELECT id, display_name, expires_at FROM guests WHERE party_id = $1 AND session_token_hash = $2 AND expires_at > now() FOR UPDATE',
            [party.id, hashToken(sessionToken)],
          )
        : undefined;
      const guest = existing?.rows[0];
      const name =
        displayName === undefined ? (guest?.display_name ?? null) : displayName;
      if (party.require_guest_names && !name)
        throw new GuestError(400, 'Enter your name to join this party.');
      if (guest) {
        const saved = await client.query<GuestRow>(
          'UPDATE guests SET display_name = $2, last_seen_at = now() WHERE id = $1 RETURNING id, display_name, expires_at',
          [guest.id, name],
        );
        return {
          guest: details(saved.rows[0]),
          token: sessionToken!,
          created: false,
        };
      }
      const token = newToken();
      const saved = await client.query<GuestRow>(
        `INSERT INTO guests (party_id, session_token_hash, display_name, expires_at) VALUES ($1, $2, $3, now() + interval '30 days') RETURNING id, display_name, expires_at`,
        [party.id, hashToken(token), name],
      );
      return { guest: details(saved.rows[0]), token, created: true };
    });
  }
  async searchContext(joinToken: string, sessionToken?: string) {
    const result = await this.pool.query<{
      host_account_id: string;
      status: string;
      require_guest_names: boolean;
      allow_explicit_tracks: boolean;
      guest_id: string | null;
      display_name: string | null;
    }>(
      `SELECT p.host_account_id, p.status, s.require_guest_names, s.allow_explicit_tracks, g.id AS guest_id, g.display_name
       FROM parties p JOIN party_settings s ON s.party_id = p.id
       LEFT JOIN guests g ON g.party_id = p.id AND g.session_token_hash = $2 AND g.expires_at > now()
       WHERE p.guest_join_token = $1`,
      [joinToken, sessionToken ? hashToken(sessionToken) : null],
    );
    const party = result.rows[0];
    if (!party) throw new GuestError(404, 'Party not found.');
    if (party.status !== 'ACTIVE')
      throw new GuestError(409, 'This party has ended.');
    if (!party.guest_id)
      throw new GuestError(401, 'Join this party again to search for songs.');
    if (party.require_guest_names && !party.display_name)
      throw new GuestError(400, 'Add your guest name before searching.');
    return {
      hostId: party.host_account_id,
      allowExplicit: party.allow_explicit_tracks,
    };
  }
}
