import { z } from 'zod';
import type { AuthConfig } from '../auth/config.js';

export const spotifyScopes = [
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-modify-private',
];
export class SpotifyError extends Error {
  constructor(
    public readonly kind:
      'reauthenticate' | 'rate_limited' | 'unavailable' | 'permissions',
    public readonly retryAfter?: number,
  ) {
    super(
      kind === 'reauthenticate'
        ? 'Reconnect Spotify to continue.'
        : kind === 'permissions'
          ? 'Spotify permissions are missing. Please reconnect.'
          : kind === 'rate_limited'
            ? 'Spotify is busy. Please try again shortly.'
            : 'Spotify is unavailable. Please try again.',
    );
  }
}
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
  constructor(
    private readonly config: Pick<
      AuthConfig,
      'clientId' | 'clientSecret' | 'redirectUri'
    >,
    private readonly fetcher: SpotifyFetch = fetch,
  ) {}
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
}
