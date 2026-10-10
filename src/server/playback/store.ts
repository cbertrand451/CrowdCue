import { readEventHistory } from '../history/store.js';
import {
  fillBackupBuffer,
  insertGuestEntry,
  type GuestEntryRow,
} from './scheduling.js';
import type pg from 'pg';
import type { PoolClient } from 'pg';
import { hashToken } from '../auth/crypto.js';
import { inTransaction } from '../db/index.js';
import { RequestError } from '../requests/contracts.js';
import { playbackStatusSchema, type PlaybackStatus } from './contracts.js';
import { upcoming } from './ordering.js';
import type { SearchResult } from '../search/contracts.js';
import { trackSchema } from '../search/contracts.js';
import type { SpotifyPlayer } from '../spotify/playback.js';
export interface Session {
  party_id: string;
  host_account_id: string;
  enabled: boolean;
  mode: 'QUEUE' | 'PLAYLIST';
  initialized: boolean;
  playlist_id: string | null;
  playlist_creation: 'NEW' | 'CREATING' | 'UNKNOWN' | 'READY';
  playlist_removed: boolean;
  save_at_creation: boolean;
  save_at_close: boolean | null;
  close_decided: boolean;
  source_cursor: number;
  last_track_id: string | null;
  last_progress_ms: number | null;
  error_code: PlaybackStatus['error'];
  retry_at: Date | null;
  playlist_synced_at: Date | null;
  status: 'ACTIVE' | 'ENDED';
  name: string;
  playlist_name: string | null;
  playlist_description: string;
  playlist_creation_baseline: string[] | null;
  playlist_credit_updated: boolean;
  backup_source_id: string | null;
  backup_tracks: SearchResult['tracks'];
  allow_explicit_tracks: boolean;
  voting_enabled: boolean;
}
export class PlaybackStore {
  constructor(readonly pool: pg.Pool) {}
  async owned(hostId: string, token: string) {
    const row = (
      await this.pool.query<{ id: string }>(
        'SELECT id FROM parties WHERE host_account_id=$1 AND admin_token_hash=$2',
        [hostId, hashToken(token)],
      )
    ).rows[0];
    if (!row) throw new RequestError(404, 'Party not found.');
    return row.id;
  }
  async session(client: pg.Pool | PoolClient, id: string): Promise<Session> {
    const result = await client.query<Session>(
      `SELECT b.*,p.status,p.name,s.backup_source_id,s.allow_explicit_tracks,s.voting_enabled FROM party_playback b JOIN parties p ON p.id=b.party_id JOIN party_settings s ON s.party_id=p.id WHERE b.party_id=$1`,
      [id],
    );
    if (!result.rows[0]) throw new RequestError(404, 'Party not found.');
    return result.rows[0];
  }
  history(hostId: string, token: string, offset: number) {
    return readEventHistory(this.pool, hostId, token, offset);
  }
  async status(hostId: string, token: string): Promise<PlaybackStatus> {
    const id = await this.owned(hostId, token);
    const s = await this.session(this.pool, id);
    const counts = (
      await this.pool.query<{ locked: number; guest: number; backup: number }>(
        `SELECT count(*) FILTER (WHERE COALESCE(legacy_committed_at,locked_at) IS NOT NULL)::int AS locked,count(*) FILTER (WHERE COALESCE(legacy_committed_at,locked_at) IS NOT NULL AND source='GUEST')::int AS guest,count(*) FILTER (WHERE COALESCE(legacy_committed_at,locked_at) IS NOT NULL AND source='BACKUP')::int AS backup FROM playback_entries WHERE party_id=$1`,
        [id],
      )
    ).rows[0];
    const cover = (
      await this.pool.query<{
        revision: number;
        synced_revision: number;
        synced_playlist_id: string | null;
        error_code: string | null;
      }>(
        'SELECT revision,synced_revision,synced_playlist_id,error_code FROM party_covers WHERE party_id=$1',
        [id],
      )
    ).rows[0];
    return playbackStatusSchema.parse({
      coverState: !cover
        ? 'none'
        : cover.error_code
          ? 'error'
          : cover.synced_revision === cover.revision &&
              cover.synced_playlist_id === s.playlist_id
            ? 'synced'
            : 'pending',
      coverError: cover?.error_code ?? null,
      enabled: s.enabled,
      mode: s.mode,
      playlistUrl:
        s.playlist_id && !s.playlist_removed
          ? `https://open.spotify.com/playlist/${s.playlist_id}`
          : null,
      playlistRemoved: s.playlist_removed,
      creation: s.playlist_creation,
      error: s.error_code,
      retryAt: s.retry_at?.toISOString() ?? null,
      syncedAt: s.playlist_synced_at?.toISOString() ?? null,
      lockedCount: counts.locked,
      guestCount: counts.guest,
      backupCount: counts.backup,
      backupSourceUrl: s.backup_source_id
        ? `https://open.spotify.com/playlist/${s.backup_source_id}`
        : null,
      backupTrackCount: s.backup_tracks.filter(
        (t) => s.allow_explicit_tracks || !t.explicit,
      ).length,
      saveAtCreation: s.save_at_creation,
      saveAtClose: s.save_at_close,
      closeDecided: s.close_decided,
      ended: s.status === 'ENDED',
    });
  }
  async change<T>(
    id: string,
    work: (client: PoolClient, s: Session) => Promise<T>,
  ) {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT id FROM parties WHERE id=$1 FOR UPDATE', [id]);
      const s = await this.session(client, id);
      return work(client, s);
    });
  }
  async observe(id: string, player: SpotifyPlayer | null) {
    await this.change(id, async (client, s) => {
      if (s.status !== 'ACTIVE') return;
      let track = player?.track ?? null;
      if (
        !track &&
        player?.item?.id &&
        player.item.uri === `spotify:track:${player.item.id}`
      ) {
        const cached = (
          await client.query<{ track: unknown }>(
            "SELECT track FROM playback_entries WHERE party_id=$1 AND track->>'id'=$2 ORDER BY sequence DESC LIMIT 1",
            [id, player.item.id],
          )
        ).rows[0]?.track;
        const parsed = trackSchema.safeParse(cached);
        if (parsed.success) track = parsed.data;
      }
      if (
        player?.is_playing &&
        player.item?.id &&
        player.item.uri === `spotify:track:${player.item.id}`
      ) {
        const restarted =
          player.item.id !== s.last_track_id ||
          (player.progress_ms != null &&
            s.last_progress_ms != null &&
            player.progress_ms < s.last_progress_ms - 1000);
        // Prefer the newly locked occurrence on a repeat/restart; otherwise
        // keep the currently playing occurrence. Never mark two repeats at once.
        await client.query(
          `UPDATE playback_entries SET observed_at=now() WHERE observed_at IS NULL AND id=(
           SELECT id FROM playback_entries WHERE party_id=$1 AND locked_at IS NOT NULL
           AND status IN ('PLAYING','LOCKED') AND track->>'id'=$2
           ORDER BY (status=CASE WHEN $3 THEN 'LOCKED' ELSE 'PLAYING' END) DESC,sequence LIMIT 1)`,
          [id, player.item.id, restarted],
        );
      }
      const state =
        !player || (!player.item && !player.is_playing)
          ? 'IDLE'
          : player.is_playing
            ? 'PLAYING'
            : 'PAUSED';
      const progress = player?.progress_ms;
      await client.query(
        'UPDATE party_playback SET display_track=$2,display_state=$3,display_progress_ms=$4,display_observed_at=now() WHERE party_id=$1',
        [
          id,
          track ? JSON.stringify(track) : null,
          state,
          progress != null && Number.isFinite(progress)
            ? Math.max(0, Math.floor(progress))
            : null,
        ],
      );
    });
  }
  async schedule(
    id: string,
    backup: SearchResult['tracks'],
    currentId?: string | null,
    progressMs?: number | null,
    playlistContext = false,
    expectedBackup?: { sourceId: string | null; allowExplicit: boolean },
    isPlaying = false,
  ) {
    return this.change(id, async (client, s) => {
      if (!s.enabled || s.status !== 'ACTIVE') return false;
      if (
        expectedBackup &&
        (s.backup_source_id !== expectedBackup.sourceId ||
          s.allow_explicit_tracks !== expectedBackup.allowExplicit)
      )
        return false;
      const playing = (
        await client.query<{
          id: string;
          request_id: string | null;
          track: { id: string };
        }>(
          "SELECT id,request_id,track FROM playback_entries WHERE party_id=$1 AND status='PLAYING'",
          [id],
        )
      ).rows[0];
      let rows = await upcoming(client, id, s.voting_enabled);
      const restarted =
        !!currentId &&
        (currentId !== s.last_track_id ||
          (progressMs != null &&
            s.last_progress_ms != null &&
            progressMs < s.last_progress_ms - 1000));
      // Ignore unrelated playback and local tracks; a paused session still keeps its locks.
      const observed =
        playlistContext && currentId && (!playing || restarted)
          ? rows.find((e) => e.track.id === currentId)
          : undefined;
      if (observed) {
        const earlier = rows.slice(0, rows.indexOf(observed));
        for (const e of [...(playing ? [playing] : []), ...earlier]) {
          await client.query(
            "UPDATE playback_entries SET status='PLAYED',locked_at=COALESCE(locked_at,clock_timestamp()) WHERE id=$1",
            [e.id],
          );
          if (e.request_id)
            await client.query(
              "UPDATE song_requests SET status='PLAYED' WHERE id=$1",
              [e.request_id],
            );
        }
        await client.query(
          "UPDATE playback_entries SET status='PLAYING',locked_at=COALESCE(locked_at,clock_timestamp()),delivery='SENT',observed_at=CASE WHEN $2 THEN COALESCE(observed_at,now()) ELSE observed_at END WHERE id=$1",
          [observed.id, isPlaying],
        );
        if (observed.request_id)
          await client.query(
            "UPDATE song_requests SET status='QUEUED' WHERE id=$1",
            [observed.request_id],
          );
      }
      if (playlistContext && isPlaying && currentId) {
        await client.query(
          `UPDATE song_requests SET status='PLAYED' WHERE status='QUEUED' AND id IN (
          SELECT request_id FROM playback_entries WHERE party_id=$1 AND status='PLAYING' AND track->>'id'=$2
        )`,
          [id, currentId],
        );
      }
      if (playlistContext)
        await client.query(
          'UPDATE party_playback SET last_track_id=$2,last_progress_ms=$3 WHERE party_id=$1',
          [id, currentId ?? null, progressMs ?? null],
        );
      await client.query(
        'UPDATE party_playback SET backup_tracks=$2 WHERE party_id=$1',
        [id, JSON.stringify(backup)],
      );
      await fillBackupBuffer(client, id);
      if (backup.length)
        await client.query(
          'UPDATE party_playback SET initialized=true WHERE party_id=$1',
          [id],
        );
      if (!s.initialized) {
        const seed = (await upcoming(client, id, s.voting_enabled)).slice(0, 3);
        for (const e of seed)
          await client.query(
            "UPDATE playback_entries SET status='LOCKED',locked_at=clock_timestamp() WHERE id=$1",
            [e.id],
          );
      }
      const requests = (
        await client.query<GuestEntryRow>(
          `SELECT r.* FROM song_requests r WHERE party_id=$1 AND status='APPROVED' AND NOT EXISTS(SELECT 1 FROM playback_entries e WHERE e.request_id=r.id) ORDER BY r.created_at,r.id`,
          [id],
        )
      ).rows;
      for (const r of requests) await insertGuestEntry(client, id, r);
      rows = await upcoming(client, id, s.voting_enabled);
      const hasPlaying = (
        await client.query(
          "SELECT 1 FROM playback_entries WHERE party_id=$1 AND status='PLAYING'",
          [id],
        )
      ).rowCount;
      const locked = rows.filter((e) => e.locked_at !== null).length;
      for (const e of rows
        .filter((e) => e.locked_at === null)
        .slice(0, Math.max(0, (hasPlaying ? 2 : 3) - locked))) {
        await client.query(
          "UPDATE playback_entries SET status='LOCKED',locked_at=clock_timestamp() WHERE id=$1",
          [e.id],
        );
        if (e.request_id)
          await client.query(
            "UPDATE song_requests SET status='QUEUED' WHERE id=$1",
            [e.request_id],
          );
      }
      return true;
    });
  }
}
