import { NightlyPlaylists } from './playlists.js';
import type { PoolClient } from 'pg';
import type { AuthService } from '../auth/service.js';
import { SpotifyError } from '../spotify/client.js';
import { RequestError } from '../requests/contracts.js';
import { PlaybackStore, type Session } from './store.js';
import { type playbackActionSchema } from './contracts.js';
import { fillBackupBuffer } from './scheduling.js';
import type { z } from 'zod';
import type { SearchResult } from '../search/contracts.js';
export type PlaybackProvider = Pick<
  AuthService,
  | 'createPlaylist'
  | 'findPlaylist'
  | 'backupTracks'
  | 'playlistUris'
  | 'writeItems'
  | 'moveItem'
  | 'removeItems'
  | 'player'
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
          const code = ['UNKNOWN', 'CREATING'].includes(state.playlist_creation)
            ? 'creation_unknown'
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
    if (s.status === 'ENDED') {
      await client.query(
        'UPDATE party_playback SET completed=true,enabled=false WHERE party_id=$1',
        [s.party_id],
      );
      return;
    }
    if (!s.enabled) {
      if (observationError) throw observationError;
      return;
    }
    const playlistId = await this.playlists.ensure(client, s);
    if (!playlistId) return;
    if (!s.backup_source_id) {
      await client.query(
        "UPDATE party_playback SET error_code='backup_required',updated_at=now() WHERE party_id=$1",
        [s.party_id],
      );
      return;
    }
    const tracks = await this.backup(s);
    if (observationError) throw observationError;
    const scheduled = await this.store.schedule(
      s.party_id,
      tracks,
      player?.item?.id && player.item.uri === `spotify:track:${player.item.id}`
        ? player.item.id
        : null,
      player?.progress_ms,
      player?.context?.uri === `spotify:playlist:${playlistId}`,
      { sourceId: s.backup_source_id, allowExplicit: s.allow_explicit_tracks },
      !!player?.is_playing &&
        !!player.item?.id &&
        player.item.uri === `spotify:track:${player.item.id}`,
    );
    if (!scheduled) return;
    s = await this.store.session(client, s.party_id);
    if (!s.enabled || s.status !== 'ACTIVE') return;
    const synced = await this.store.change(s.party_id, async (c, state) => {
      if (!state.enabled || state.status !== 'ACTIVE') return false;
      return this.playlists.sync(c, state, playlistId);
    });
    if (!synced) return;
    await client.query(
      "UPDATE party_playback SET error_code=CASE WHEN $2 THEN 'backup_empty' ELSE NULL END,retry_at=null,updated_at=now() WHERE party_id=$1",
      [s.party_id, !tracks.length],
    );
  }
  async action(
    hostId: string,
    token: string,
    input: z.infer<typeof playbackActionSchema>,
  ) {
    const id = await this.store.owned(hostId, token);
    const result = await this.withLock(id, async (client, s) => {
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
            "UPDATE party_playback SET enabled=true,mode='PLAYLIST',playlist_name=COALESCE(playlist_name,$2),playlist_description=CASE WHEN enabled THEN playlist_description ELSE $3 END,retry_at=null WHERE party_id=$1",
            [id, input.name ?? s.name, input.description ?? ''],
          );
        });
        await this.process(client, await this.store.session(client, id));
        return true;
      }
    });
    if (!result)
      throw new RequestError(
        409,
        'Spotify synchronization is in progress. Try again shortly.',
      );
    return this.store.status(hostId, token);
  }
}
