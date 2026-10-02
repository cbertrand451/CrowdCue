import { z } from 'zod';
import { SpotifyError } from './error.js';
import type { SpotifyFetch } from './client.js';
import type { SearchResult } from '../search/contracts.js';
export class SpotifyMutationError extends SpotifyError {
  constructor(
    public readonly uncertain: boolean,
    kind: SpotifyError['kind'] = 'unavailable',
    retryAfter?: number,
  ) {
    super(kind, retryAfter);
  }
}
const idSchema = z.string().regex(/^[A-Za-z0-9]{22}$/);
const remoteTrack = z.object({
  id: idSchema,
  name: z.string(),
  artists: z.array(z.object({ name: z.string() })),
  album: z.object({
    name: z.string(),
    images: z.array(z.object({ url: z.string() })).default([]),
  }),
  duration_ms: z.number().int().positive(),
  explicit: z.boolean(),
  is_local: z.boolean().optional(),
  is_playable: z.boolean().optional(),
});
type Track = SearchResult['tracks'][number];
export interface SpotifyPlayer {
  is_playing: boolean;
  progress_ms?: number | null;
  item: { id: string | null; uri: string } | null;
  context?: { uri: string } | null;
  device?: { is_restricted?: boolean };
  track?: Track | null;
}
function normalizedTrack(item: unknown): Track | null {
  const result = remoteTrack.safeParse(item);
  if (
    !result.success ||
    result.data.is_local ||
    result.data.is_playable === false
  )
    return null;
  const t = result.data;
  const artwork =
    t.album.images.find((x) => {
      try {
        const u = new URL(x.url);
        return (
          u.protocol === 'https:' &&
          !u.username &&
          !u.password &&
          (u.hostname === 'i.scdn.co' || u.hostname.endsWith('.spotifycdn.com'))
        );
      } catch {
        return false;
      }
    })?.url ?? null;
  return {
    id: t.id,
    title: t.name,
    artists: t.artists.map((x) => x.name),
    album: t.album.name,
    artworkUrl: artwork,
    durationMs: t.duration_ms,
    explicit: t.explicit,
    spotifyUrl: `https://open.spotify.com/track/${t.id}`,
  };
}
export class SpotifyPlayback {
  constructor(private readonly fetcher: SpotifyFetch) {}
  private async call(
    path: string,
    token: string,
    method = 'GET',
    body?: unknown,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.spotify.com/v1/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new SpotifyMutationError(method !== 'GET');
    }
    if (response.status === 401)
      throw new SpotifyMutationError(false, 'reauthenticate');
    if (response.status === 403)
      throw new SpotifyMutationError(false, 'permissions');
    if (response.status === 429) {
      const delay = Number(response.headers.get('retry-after'));
      throw new SpotifyMutationError(
        false,
        'rate_limited',
        Number.isFinite(delay) && delay > 0
          ? Math.min(Math.ceil(delay), 3600)
          : 30,
      );
    }
    if (!response.ok)
      throw new SpotifyMutationError(
        method !== 'GET' && response.status >= 500,
        response.status === 404 && path.startsWith('me/player')
          ? 'no_active_device'
          : 'unavailable',
      );
    if (response.status === 204 || method === 'DELETE') return null;
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new SpotifyMutationError(method !== 'GET');
    }
  }
  async createPlaylist(token: string, name: string, description: string) {
    const parsed = z.object({ id: idSchema }).safeParse(
      await this.call('me/playlists', token, 'POST', {
        name: `CrowdCue · ${name}`.slice(0, 100),
        description,
        public: false,
        collaborative: false,
      }),
    );
    if (!parsed.success) throw new SpotifyMutationError(true);
    return parsed.data.id;
  }
  async findPlaylist(token: string, description: string) {
    const owner = z
      .object({ id: z.string() })
      .parse(await this.call('me', token)).id;
    for (let offset = 0; offset <= 100000; offset += 50) {
      const page = z
        .object({
          items: z.array(
            z.object({
              id: idSchema,
              owner: z.object({ id: z.string() }),
              description: z.string().nullable(),
              public: z.boolean().nullable(),
            }),
          ),
          next: z.string().nullable(),
        })
        .safeParse(
          await this.call(`me/playlists?limit=50&offset=${offset}`, token),
        );
      if (!page.success) throw new SpotifyError('unavailable');
      const found = page.data.items.find(
        (x) =>
          x.owner.id === owner &&
          x.public === false &&
          x.description === description,
      );
      if (found) return found.id;
      if (!page.data.next || !page.data.items.length) return null;
    }
    throw new SpotifyError('unavailable');
  }
  private async items(token: string, id: string): Promise<unknown[]> {
    idSchema.parse(id);
    const items: unknown[] = [];
    for (let offset = 0; offset <= 10000; offset += 50) {
      const page = z
        .object({
          items: z.array(
            z.object({
              item: z.unknown().optional(),
              track: z.unknown().optional(),
            }),
          ),
          next: z.string().nullable(),
        })
        .safeParse(
          await this.call(
            `playlists/${id}/items?limit=50&offset=${offset}`,
            token,
          ),
        );
      if (!page.success) throw new SpotifyError('unavailable');
      items.push(...page.data.items.map((x) => x.item ?? x.track));
      if (!page.data.next || !page.data.items.length) return items;
    }
    throw new SpotifyError('unavailable');
  }
  async backupTracks(
    token: string,
    id: string,
    allowExplicit: boolean,
  ): Promise<SearchResult['tracks']> {
    const tracks: SearchResult['tracks'] = [];
    for (const item of await this.items(token, id)) {
      const track = normalizedTrack(item);
      if (track && (allowExplicit || !track.explicit)) tracks.push(track);
    }
    return tracks;
  }
  async playlistUris(token: string, id: string) {
    return (await this.items(token, id))
      .map((x) => z.object({ uri: z.string() }).safeParse(x))
      .map((x) => (x.success ? x.data.uri : 'unavailable'));
  }
  async writeItems(
    token: string,
    id: string,
    uris: string[],
    replace: boolean,
  ) {
    idSchema.parse(id);
    z.array(z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/))
      .max(100)
      .parse(uris);
    const result = z
      .object({ snapshot_id: z.string().min(1) })
      .safeParse(
        await this.call(
          `playlists/${id}/items`,
          token,
          replace ? 'PUT' : 'POST',
          { uris },
        ),
      );
    if (!result.success) throw new SpotifyMutationError(true);
  }
  async removePlaylist(token: string, id: string) {
    idSchema.parse(id);
    await this.call(
      `me/library?uris=${encodeURIComponent(`spotify:playlist:${id}`)}`,
      token,
      'DELETE',
    );
  }
  async player(token: string): Promise<SpotifyPlayer | null> {
    const result = await this.call('me/player', token);
    if (result === null) return null;
    const parsed = z
      .object({
        is_playing: z.boolean(),
        progress_ms: z.number().nullable().optional(),
        item: z
          .object({ id: z.string().nullable(), uri: z.string() })
          .passthrough()
          .nullable(),
        context: z.object({ uri: z.string() }).nullable().optional(),
        device: z.object({ is_restricted: z.boolean().optional() }).optional(),
      })
      .safeParse(result);
    if (!parsed.success) throw new SpotifyError('unavailable');
    return { ...parsed.data, track: normalizedTrack(parsed.data.item) };
  }
  async queueState(token: string) {
    const result = z
      .object({
        currently_playing: z.object({ id: z.string().nullable() }).nullable(),
        queue: z.array(z.object({ id: z.string().nullable() })),
      })
      .safeParse(await this.call('me/player/queue', token));
    if (!result.success) throw new SpotifyError('unavailable');
    return result.data;
  }
  async enqueue(token: string, id: string) {
    idSchema.parse(id);
    await this.call(
      `me/player/queue?uri=${encodeURIComponent(`spotify:track:${id}`)}`,
      token,
      'POST',
    );
  }
  async startPlaylist(token: string, id: string, position: number) {
    idSchema.parse(id);
    await this.call('me/player/play', token, 'PUT', {
      context_uri: `spotify:playlist:${id}`,
      offset: { position },
    });
  }
}
