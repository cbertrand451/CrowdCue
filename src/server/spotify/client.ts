import { z } from 'zod';
import { SpotifyPlayback } from './playback.js';
import type { SearchResult } from '../search/contracts.js';
import type { AuthConfig } from '../auth/config.js';

export const spotifyScopes = [
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-modify-private',
  'playlist-modify-public',
  'playlist-read-private',
  'playlist-read-collaborative',
];
import { SpotifyError } from './error.js';
export { SpotifyError } from './error.js';
const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().max(86400),
  token_type: z.string().refine((value) => value.toLowerCase() === 'bearer'),
  scope: z.string().optional(),
});
const profileResponse = z.object({
  id: z.string().min(1).max(256),
  display_name: z.string().nullable().optional(),
});
const searchResponse = z.object({
  tracks: z.object({
    items: z.array(
      z
        .object({
          id: z.string().regex(/^[A-Za-z0-9]{22}$/),
          name: z.string(),
          artists: z.array(z.object({ name: z.string() })),
          album: z.object({
            name: z.string(),
            images: z.array(z.object({ url: z.string() })),
          }),
          duration_ms: z.number().int().nonnegative(),
          explicit: z.boolean(),
          is_playable: z.boolean().optional(),
          is_local: z.boolean().optional(),
        })
        .nullable(),
    ),
    next: z.string().nullable(),
  }),
});
const providerTrackSchema =
  searchResponse.shape.tracks.shape.items.element.unwrap();
function normalizedTrack(
  track: z.infer<typeof providerTrackSchema>,
): SearchResult['tracks'][number] {
  const artwork = track.album.images.find((image) => {
    try {
      const value = new URL(image.url);
      return (
        value.protocol === 'https:' &&
        !value.username &&
        !value.password &&
        (value.hostname === 'i.scdn.co' ||
          value.hostname.endsWith('.spotifycdn.com'))
      );
    } catch {
      return false;
    }
  });
  return {
    id: track.id,
    title: track.name,
    artists: track.artists.map((artist) => artist.name),
    album: track.album.name,
    artworkUrl: artwork?.url ?? null,
    durationMs: track.duration_ms,
    explicit: track.explicit,
    spotifyUrl: `https://open.spotify.com/track/${track.id}`,
  };
}
export interface TokenGrant {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
}
export interface SpotifyProfile {
  id: string;
  displayName: string | null;
}
export type SpotifyFetch = typeof fetch;

export class SpotifyClient {
  readonly playback: SpotifyPlayback;
  constructor(
    private readonly config: Pick<
      AuthConfig,
      'clientId' | 'clientSecret' | 'redirectUri'
    >,
    private readonly fetcher: SpotifyFetch = fetch,
  ) {
    this.playback = new SpotifyPlayback(fetcher);
  }
  authorizationUrl(state: string, challenge: string) {
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: spotifyScopes.join(' '),
      state,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    }).toString();
    return url.toString();
  }
  private async request(url: string, options: RequestInit) {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new SpotifyError('unavailable');
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      throw new SpotifyError(
        'rate_limited',
        Number.isFinite(seconds) && seconds > 0
          ? Math.min(Math.ceil(seconds), 3600)
          : 30,
      );
    }
    if (response.status === 401)
      throw new SpotifyError(
        url === 'https://accounts.spotify.com/api/token'
          ? 'unavailable'
          : 'reauthenticate',
      );
    if (response.status === 403) throw new SpotifyError('permissions');
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new SpotifyError('unavailable');
    }
    if (!response.ok) {
      if (
        response.status === 400 &&
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        data.error === 'invalid_grant'
      )
        throw new SpotifyError('reauthenticate');
      throw new SpotifyError('unavailable');
    }
    return data;
  }
  private async tokens(
    body: URLSearchParams,
    previous?: TokenGrant,
  ): Promise<TokenGrant> {
    const data = await this.request('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
      },
      body: body.toString(),
    });
    const parsed = tokenResponse.safeParse(data);
    if (!parsed.success) throw new SpotifyError('unavailable');
    const token = parsed.data;
    const refreshToken = token.refresh_token || previous?.refreshToken;
    if (!refreshToken) throw new SpotifyError('unavailable');
    const scopes =
      token.scope === undefined && previous
        ? previous.scopes
        : (token.scope || '').split(' ').filter(Boolean);
    if (!spotifyScopes.every((scope) => scopes.includes(scope)))
      throw new SpotifyError('permissions');
    return {
      accessToken: token.access_token,
      refreshToken,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes,
    };
  }
  exchange(code: string, verifier: string) {
    return this.tokens(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
        code_verifier: verifier,
      }),
    );
  }
  refresh(previous: TokenGrant) {
    return this.tokens(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: previous.refreshToken,
      }),
      previous,
    );
  }
  async profile(accessToken: string): Promise<SpotifyProfile> {
    const parsed = profileResponse.safeParse(
      await this.request('https://api.spotify.com/v1/me', {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    if (!parsed.success) throw new SpotifyError('unavailable');
    return {
      id: parsed.data.id,
      displayName: parsed.data.display_name || null,
    };
  }
  async search(
    accessToken: string,
    query: string,
    offset: number,
    allowExplicit: boolean,
  ): Promise<SearchResult> {
    const url = new URL('https://api.spotify.com/v1/search');
    url.search = new URLSearchParams({
      q: query,
      type: 'track',
      limit: '10',
      offset: String(offset),
    }).toString();
    const parsed = searchResponse.safeParse(
      await this.request(url.toString(), {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    if (!parsed.success) throw new SpotifyError('unavailable');
    const page = parsed.data.tracks;
    return {
      tracks: page.items
        .filter((track) => track !== null)
        .filter(
          (track) =>
            track !== null &&
            track.is_playable !== false &&
            !track.is_local &&
            (allowExplicit || !track.explicit),
        )
        .map((track) => {
          return normalizedTrack(track);
        }),
      nextOffset:
        page.next && page.items.length > 0 && offset + 10 <= 990
          ? offset + 10
          : null,
    };
  }
  async track(accessToken: string, id: string) {
    const parsed = providerTrackSchema.safeParse(
      await this.request(`https://api.spotify.com/v1/tracks/${id}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    if (
      !parsed.success ||
      parsed.data.id !== id ||
      parsed.data.is_local ||
      parsed.data.is_playable === false ||
      !parsed.data.name.trim() ||
      !parsed.data.artists.some((artist) => artist.name.trim()) ||
      parsed.data.duration_ms <= 0
    )
      throw new SpotifyError('unavailable');
    return normalizedTrack(parsed.data);
  }
}
