import type pg from 'pg';
import type { PoolClient } from 'pg';
import { inTransaction } from '../db/index.js';
import type { SpotifyCredentials } from '../db/models.js';
import {
  SpotifyClient,
  SpotifyError,
  type SpotifyProfile,
  type TokenGrant,
} from '../spotify/client.js';
import { TokenCipher } from './crypto.js';

export interface HostSession {
  accountId: string;
  displayName: string | null;
}
export interface AuthStore {
  createAttempt(
    stateHash: string,
    browserHash: string,
    verifier: string,
  ): Promise<void>;
  consumeAttempt(
    stateHash: string,
    browserHash: string,
  ): Promise<string | null>;
  saveLogin(
    profile: SpotifyProfile,
    grant: TokenGrant,
    sessionHash: string,
    previousSessionHash?: string,
  ): Promise<void>;
  findSession(sessionHash: string): Promise<HostSession | null>;
  deleteSession(sessionHash: string): Promise<void>;
  accessToken(
    accountId: string,
    spotify: SpotifyClient,
    rejectedToken?: string,
  ): Promise<string>;
}

export class PostgresAuthStore implements AuthStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly cipher: TokenCipher,
  ) {}

  async createAttempt(
    stateHash: string,
    browserHash: string,
    verifier: string,
  ) {
    const encrypted = this.cipher.encrypt(verifier, `oauth:${stateHash}`);
    await inTransaction(this.pool, async (client) => {
      await client.query(
        'DELETE FROM spotify_oauth_attempts WHERE expires_at <= now()',
      );
      await client.query(
        `INSERT INTO spotify_oauth_attempts (state_hash, browser_token_hash, verifier_ciphertext, encryption_key_id, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`,
        [stateHash, browserHash, encrypted.data, encrypted.keyId],
      );
    });
  }
  async consumeAttempt(stateHash: string, browserHash: string) {
    const result = await this.pool.query<{
      verifier_ciphertext: Buffer;
      encryption_key_id: string;
    }>(
      `DELETE FROM spotify_oauth_attempts WHERE state_hash = $1 AND browser_token_hash = $2 AND expires_at > now()
       RETURNING verifier_ciphertext, encryption_key_id`,
      [stateHash, browserHash],
    );
    const row = result.rows[0];
    return row
      ? this.cipher.decrypt(
          row.verifier_ciphertext,
          row.encryption_key_id,
          `oauth:${stateHash}`,
        )
      : null;
  }
  private async writeCredentials(
    client: PoolClient,
    accountId: string,
    grant: TokenGrant,
  ) {
    const access = this.cipher.encrypt(
      grant.accessToken,
      `account:${accountId}:access`,
    );
    const refresh = this.cipher.encrypt(
      grant.refreshToken,
      `account:${accountId}:refresh`,
    );
    await client.query(
      `INSERT INTO spotify_credentials
       (account_id, access_token_ciphertext, refresh_token_ciphertext, encryption_key_id, expires_at, scopes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id) DO UPDATE SET
         access_token_ciphertext = EXCLUDED.access_token_ciphertext,
         refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
         encryption_key_id = EXCLUDED.encryption_key_id,
         expires_at = EXCLUDED.expires_at,
         scopes = EXCLUDED.scopes,
         updated_at = now()`,
      [
        accountId,
        access.data,
        refresh.data,
        access.keyId,
        grant.expiresAt,
        grant.scopes,
      ],
    );
  }
  async saveLogin(
    profile: SpotifyProfile,
    grant: TokenGrant,
    sessionHash: string,
    previousSessionHash?: string,
  ) {
    await inTransaction(this.pool, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO spotify_accounts (spotify_user_id, display_name) VALUES ($1, $2)
         ON CONFLICT (spotify_user_id) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
        [profile.id, profile.displayName],
      );
      await this.writeCredentials(client, result.rows[0].id, grant);
      await client.query(
        'DELETE FROM host_sessions WHERE token_hash = $1 OR expires_at <= now()',
        [previousSessionHash || null],
      );
      await client.query(
        `INSERT INTO host_sessions (token_hash, account_id, expires_at) VALUES ($1, $2, now() + interval '30 days')`,
        [sessionHash, result.rows[0].id],
      );
    });
  }
  async findSession(sessionHash: string) {
    const result = await this.pool.query<{
      account_id: string;
      display_name: string | null;
    }>(
      `SELECT s.account_id, a.display_name FROM host_sessions s
       JOIN spotify_accounts a ON a.id = s.account_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sessionHash],
    );
    const row = result.rows[0];
    return row
      ? { accountId: row.account_id, displayName: row.display_name }
      : null;
  }
  async deleteSession(sessionHash: string) {
    await this.pool.query('DELETE FROM host_sessions WHERE token_hash = $1', [
      sessionHash,
    ]);
  }
  async accessToken(
    accountId: string,
    spotify: SpotifyClient,
    rejectedToken?: string,
  ) {
    const result = await inTransaction(this.pool, async (client) => {
      // Row locking prevents concurrent processes from refreshing/rotating the same token.
      const rows = await client.query<SpotifyCredentials>(
        'SELECT * FROM spotify_credentials WHERE account_id = $1 FOR UPDATE',
        [accountId],
      );
      const row = rows.rows[0];
      if (!row) return { error: new SpotifyError('reauthenticate') };
      const accessToken = this.cipher.decrypt(
        row.access_token_ciphertext,
        row.encryption_key_id,
        `account:${accountId}:access`,
      );
      if (
        row.expires_at.getTime() > Date.now() + 60_000 &&
        accessToken !== rejectedToken
      ) {
        return { token: accessToken };
      }
      const previous: TokenGrant = {
        accessToken,
        refreshToken: this.cipher.decrypt(
          row.refresh_token_ciphertext,
          row.encryption_key_id,
          `account:${accountId}:refresh`,
        ),
        expiresAt: row.expires_at,
        scopes: row.scopes,
      };
      try {
        const grant = await spotify.refresh(previous);
        await this.writeCredentials(client, accountId, grant);
        return { token: grant.accessToken };
      } catch (error) {
        if (error instanceof SpotifyError && error.kind === 'reauthenticate') {
          // Commit invalidation before reporting the failure, avoiding endless refresh attempts.
          await client.query(
            'DELETE FROM spotify_credentials WHERE account_id = $1',
            [accountId],
          );
          return { error };
        }
        throw error;
      }
    });
    if (result.error) throw result.error;
    return result.token!;
  }
}
