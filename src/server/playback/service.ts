import { NightlyPlaylists } from './playlists.js';
import type { PoolClient } from 'pg';
import type { AuthService } from '../auth/service.js';
import { SpotifyError } from '../spotify/client.js';
import { SpotifyMutationError } from '../spotify/playback.js';
import { RequestError } from '../requests/contracts.js';
import { PlaybackStore, type Session } from './store.js';
import { type playbackActionSchema } from './contracts.js';
import { fillBackupBuffer } from './scheduling.js';
import { upcoming } from './ordering.js';
import type { z } from 'zod';
import type { SearchResult } from '../search/contracts.js';
export type PlaybackProvider = Pick<
  AuthService,
  | 'createPlaylist'
  | 'findPlaylist'
  | 'backupTracks'
  | 'playlistUris'
  | 'writeItems'
  | 'removePlaylist'
  | 'player'
  | 'queueState'
  | 'enqueue'
  | 'startPlaylist'
>;
export class PlaybackService {
  private readonly playlists: NightlyPlaylists;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private backupCache = new Map<
    string,
    { expires: number; tracks: SearchResult['tracks'] }
  >();
  constructor(
    readonly store: PlaybackStore,
    private readonly spotify: PlaybackProvider,
    private readonly onError: () => void = () => {},
  ) {
    this.playlists = new NightlyPlaylists(spotify);
  }
  start() {
    this.stopped = false;
    const run = () => {
      this.running = this.tick()
        .catch(() => this.onError())
        .finally(() => {
          if (!this.stopped) this.timer = setTimeout(run, 5000);
        });
    };
    run();
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
  async tick() {
    const parties = (
      await this.store.pool.query<{ party_id: string }>(
        `SELECT b.party_id FROM party_playback b JOIN parties p ON p.id=b.party_id WHERE NOT b.playlist_removed AND NOT b.completed AND (b.retry_at IS NULL OR b.retry_at<=now()) ORDER BY b.updated_at,b.party_id LIMIT 100`,
      )
    ).rows;
    for (const p of parties) {
      if (this.stopped) break;
      await this.withLock(p.party_id, async (client, s) => {
        try {
          await this.process(client, s);
        } catch (error) {
          const state = await this.store.session(client, s.party_id);
          const unknown = (
            await client.query(
              "SELECT 1 FROM playback_entries WHERE party_id=$1 AND delivery='UNKNOWN' LIMIT 1",
              [s.party_id],
            )
          ).rowCount;
          const code = ['UNKNOWN', 'CREATING'].includes(state.playlist_creation)
            ? 'creation_unknown'
            : unknown
              ? 'queue_unknown'
              : error instanceof SpotifyError
                ? error.kind
                : 'unavailable';
          await client.query(
            'UPDATE party_playback SET error_code=$2,retry_at=now()+make_interval(secs=>$3),updated_at=now() WHERE party_id=$1',
            [
              s.party_id,
              code,
              error instanceof SpotifyError ? (error.retryAfter ?? 30) : 30,
            ],
          );
        }
      });
    }
  }
  private async withLock<T>(
    id: string,
    work: (client: PoolClient, s: Session) => Promise<T>,
  ): Promise<T | undefined> {
    const client = await this.store.pool.connect();
    let locked = false,
      discard = false;
    let owner: string | undefined;
    const disconnected = () => {
      discard = true;
    };
    client.on('error', disconnected);
    try {
      const s = await this.store.session(client, id);
      owner = s.host_account_id;
      locked = (
        await client.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock(713285,hashtext($1)) AS locked',
          [s.host_account_id],
        )
      ).rows[0].locked;
      if (!locked) return;
      return await work(client, await this.store.session(client, id));
    } finally {
      if (locked)
        try {
          await client.query('SELECT pg_advisory_unlock(713285,hashtext($1))', [
            owner,
          ]);
        } catch {
          discard = true;
        }
      client.removeListener('error', disconnected);
      client.release(discard);
    }
  }
  private async backup(s: Session, force = false) {
    if (!s.backup_source_id) return [];
    const key = `${s.host_account_id}:${s.backup_source_id}:${s.allow_explicit_tracks}`;
    const cached = this.backupCache.get(key);
    if (!force && cached && cached.expires > Date.now()) return cached.tracks;
    const tracks = await this.spotify.backupTracks(
      s.host_account_id,
      s.backup_source_id,
      s.allow_explicit_tracks,
    );
    if (this.backupCache.size > 100) this.backupCache.clear();
    this.backupCache.set(key, { tracks, expires: Date.now() + 60000 });
    return tracks;
  }
  private async process(client: PoolClient, s: Session) {
    let player: Awaited<ReturnType<PlaybackProvider['player']>> = null;
    let observationError: unknown;
    if (s.status === 'ACTIVE') {
      try {
        player = await this.spotify.player(s.host_account_id);
        await this.store.observe(s.party_id, player);
      } catch (error) {
        observationError = error;
        await client.query(
          "UPDATE party_playback SET display_state='UNAVAILABLE' WHERE party_id=$1",
          [s.party_id],
        );
      }
    }
    if (
      s.status === 'ENDED' &&
      s.close_decided &&
      !s.save_at_creation &&
      !s.save_at_close &&
      s.playlist_creation === 'NEW'
    ) {
      await client.query(
        'UPDATE party_playback SET playlist_removed=true,error_code=null,updated_at=now() WHERE party_id=$1',
        [s.party_id],
      );
      return;
    }
    const playlistId = await this.playlists.ensure(client, s);
    if (!playlistId) return;
    if (
      s.status === 'ENDED' &&
      s.close_decided &&
      !s.save_at_creation &&
      !s.save_at_close
    ) {
      // Spotify has no permanent-delete endpoint. Clear the private playlist and remove it from the host library.
      await this.spotify.writeItems(s.host_account_id, playlistId, [], true);
      await this.spotify.removePlaylist(s.host_account_id, playlistId);
      await client.query(
        'UPDATE party_playback SET playlist_removed=true,error_code=null,retry_at=null,updated_at=now() WHERE party_id=$1',
        [s.party_id],
      );
      return;
    }
    if (!s.enabled || s.status !== 'ACTIVE') {
      if (!(await this.playlists.sync(client, s, playlistId))) return;
      if (observationError) throw observationError;
      if (
        s.status === 'ENDED' &&
        s.close_decided &&
        (s.save_at_creation || s.save_at_close)
      )
        await client.query(
          'UPDATE party_playback SET completed=true WHERE party_id=$1',
          [s.party_id],
        );
      await client.query(
        'UPDATE party_playback SET error_code=null,retry_at=null,updated_at=now() WHERE party_id=$1',
        [s.party_id],
      );
      return;
    }
    if (!s.backup_source_id) {
      await client.query(
        "UPDATE party_playback SET error_code='backup_required',updated_at=now() WHERE party_id=$1",
        [s.party_id],
      );
      return;
    }
    const tracks = await this.backup(s);
    if (!tracks.length) {
      await client.query(
        "UPDATE party_playback SET error_code='backup_empty',updated_at=now() WHERE party_id=$1",
        [s.party_id],
      );
      return;
    }
    if (observationError) throw observationError;
    const queue =
      s.mode === 'QUEUE'
        ? await this.spotify.queueState(s.host_account_id)
        : null;
    if (queue)
      await this.store.change(s.party_id, async (c, state) => {
        if (!state.enabled || state.status !== 'ACTIVE') return;
        const locked = (
          await c.query<{
            id: string;
            request_id: string | null;
            track: { id: string };
            delivery_seen: boolean;
          }>(
            "SELECT id,request_id,track,delivery_seen FROM playback_entries WHERE party_id=$1 AND status='LOCKED' AND delivery='SENT'",
            [s.party_id],
          )
        ).rows[0];
        if (!locked) return;
        if (queue.queue.some((t) => t.id === locked.track.id))
          await c.query(
            'UPDATE playback_entries SET delivery_seen=true WHERE id=$1',
            [locked.id],
          );
        else if (
          locked.delivery_seen &&
          player?.item?.id &&
          player.item.id !== locked.track.id
        ) {
          await c.query(
            "UPDATE playback_entries SET status='PLAYED' WHERE id=$1",
            [locked.id],
          );
          if (locked.request_id)
            await c.query(
              "UPDATE song_requests SET status='PLAYED' WHERE id=$1",
              [locked.request_id],
            );
        }
      });
    const scheduled = await this.store.schedule(
      s.party_id,
      tracks,
      player?.item?.id,
      player?.progress_ms,
      player?.context?.uri === `spotify:playlist:${playlistId}`,
      { sourceId: s.backup_source_id, allowExplicit: s.allow_explicit_tracks },
    );
    if (!scheduled) return;
    s = await this.store.session(client, s.party_id);
    if (!s.enabled || s.status !== 'ACTIVE') return;
    if (!(await this.playlists.sync(client, s, playlistId))) return;
    if (!player?.is_playing || player.device?.is_restricted) {
      await client.query(
        "UPDATE party_playback SET error_code='no_active_device',updated_at=now() WHERE party_id=$1",
        [s.party_id],
      );
      return;
    }
    const next = (await upcoming(client, s.party_id, s.voting_enabled)).find(
      (e) => e.status === 'LOCKED',
    );
    if (s.mode === 'QUEUE' && next) {
      if (next.delivery === 'UNKNOWN') {
        await client.query(
          "UPDATE party_playback SET error_code='queue_unknown',updated_at=now() WHERE party_id=$1",
          [s.party_id],
        );
        return;
      }
      if (next.delivery === 'PENDING') {
        // The row remains durable if the process exits between sending and receiving Spotify's acknowledgement.
        const claimed = await this.store.change(
          s.party_id,
          async (c, current) => {
            if (
              !current.enabled ||
              current.status !== 'ACTIVE' ||
              current.mode !== 'QUEUE'
            )
              return false;
            await c.query(
              "UPDATE playback_entries SET delivery='SENDING' WHERE id=$1 AND delivery='PENDING'",
              [next.id],
            );
            return true;
          },
        );
        if (!claimed) return;
        try {
          await this.spotify.enqueue(s.host_account_id, next.track.id);
        } catch (error) {
          await client.query(
            'UPDATE playback_entries SET delivery=$2 WHERE id=$1',
            [
              next.id,
              error instanceof SpotifyMutationError && error.uncertain
                ? 'UNKNOWN'
                : 'PENDING',
            ],
          );
          throw error;
        }
        await client.query(
          "UPDATE playback_entries SET delivery='SENT' WHERE id=$1",
          [next.id],
        );
      }
    }
    await client.query(
      'UPDATE party_playback SET error_code=null,retry_at=null,updated_at=now() WHERE party_id=$1',
      [s.party_id],
    );
  }
  async action(
    hostId: string,
    token: string,
    input: z.infer<typeof playbackActionSchema>,
  ) {
    const id = await this.store.owned(hostId, token);
    const result = await this.withLock(id, async (client, s) => {
      if (input.action === 'close') {
        if (s.status !== 'ENDED')
          throw new RequestError(
            409,
            'End the session before choosing whether to save the playlist.',
          );
        await this.store.change(id, async (c, current) => {
          if (current.close_decided && current.save_at_close !== input.save)
            throw new RequestError(
              409,
              'The summary choice has already been saved.',
            );
          await c.query(
            'UPDATE party_playback SET save_at_close=$2,close_decided=true,retry_at=null,updated_at=now() WHERE party_id=$1',
            [id, input.save],
          );
        });
        return true;
      }
      if (s.status !== 'ACTIVE')
        throw new RequestError(409, 'This party has ended.');
      if (input.action === 'refresh-backup') {
        if (!s.backup_source_id)
          throw new RequestError(
            400,
            'Add a backup Spotify playlist in party settings first.',
          );
        const tracks = await this.backup(s, true);
        await this.store.change(id, async (c, current) => {
          if (
            current.status !== 'ACTIVE' ||
            current.backup_source_id !== s.backup_source_id ||
            current.allow_explicit_tracks !== s.allow_explicit_tracks
          )
            throw new RequestError(
              409,
              'Backup settings changed. Check the playlist again.',
            );
          await c.query(
            `UPDATE party_playback SET backup_tracks=$2,retry_at=NULL,
             error_code=CASE WHEN error_code IS NULL OR error_code IN ('backup_empty','backup_required') THEN CASE WHEN $3 THEN 'backup_empty' ELSE NULL END ELSE error_code END,updated_at=now() WHERE party_id=$1`,
            [id, JSON.stringify(tracks), !tracks.length],
          );
          await fillBackupBuffer(c, id);
        });
        return true;
      }
      if (input.action === 'recreate') {
        if (!['UNKNOWN', 'CREATING'].includes(s.playlist_creation))
          throw new RequestError(
            409,
            'The playlist does not need replacement.',
          );
        await client.query(
          "UPDATE party_playback SET playlist_creation='NEW',error_code=null,retry_at=null WHERE party_id=$1",
          [id],
        );
        return true;
      }
      if (input.action === 'retry') {
        await client.query(
          'UPDATE party_playback SET retry_at=null WHERE party_id=$1',
          [id],
        );
        return true;
      }
      if (input.action === 'start') {
        if (!s.backup_source_id)
          throw new RequestError(
            400,
            'Add a backup Spotify playlist in party settings first.',
          );
        const tracks = await this.backup(s);
        if (!tracks.length)
          throw new RequestError(
            400,
            'Choose a backup playlist with playable songs.',
          );
        await this.store.change(id, async (c, current) => {
          if (current.status !== 'ACTIVE')
            throw new RequestError(409, 'This party has ended.');
          if (
            current.backup_source_id !== s.backup_source_id ||
            current.allow_explicit_tracks !== s.allow_explicit_tracks
          )
            throw new RequestError(
              409,
              'Backup settings changed. Check the playlist again.',
            );
          const other = await c.query(
            'SELECT party_id FROM party_playback WHERE host_account_id=$1 AND enabled AND party_id!=$2',
            [hostId, id],
          );
          if (other.rowCount)
            throw new RequestError(
              409,
              'End the other active queue on this Spotify account first.',
            );
          await c.query(
            'UPDATE party_playback SET enabled=true,retry_at=null WHERE party_id=$1',
            [id],
          );
        });
        return true;
      }
      if (!s.playlist_id)
        throw new RequestError(
          409,
          'Wait for the nightly playlist to be created first.',
        );
      if (!s.enabled)
        throw new RequestError(409, 'Start this session queue first.');
      // Switch first so a retry/restart cannot also deliver the same waiting song through the queue API.
      await this.store.change(id, async (c, current) => {
        if (current.status !== 'ACTIVE')
          throw new RequestError(409, 'This party has ended.');
        await c.query(
          "UPDATE party_playback SET mode='PLAYLIST',retry_at=null WHERE party_id=$1",
          [id],
        );
      });
      s = await this.store.session(client, id);
      await this.playlists.sync(client, s, s.playlist_id!);
      const count = (
        await client.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM playback_entries WHERE party_id=$1 AND locked_at IS NOT NULL',
          [id],
        )
      ).rows[0].count;
      await this.spotify.startPlaylist(
        hostId,
        s.playlist_id!,
        Math.max(0, count - 1),
      );
      return true;
    });
    if (!result)
      throw new RequestError(
        409,
        'Spotify synchronization is in progress. Try again shortly.',
      );
    return this.store.status(hostId, token);
  }
}
