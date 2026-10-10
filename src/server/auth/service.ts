import { createHash } from 'node:crypto';
import type { AuthConfig } from './config.js';
import { hashToken, newToken } from './crypto.js';
import type { AuthStore } from './store.js';
import { SpotifyClient, SpotifyError } from '../spotify/client.js';

export const validToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export class AuthService {
  constructor(
    readonly config: AuthConfig,
    private readonly store: AuthStore,
    private readonly spotify: SpotifyClient,
  ) {}
  async start() {
    const state = newToken();
    const browserToken = newToken();
    const verifier = newToken();
    await this.store.createAttempt(
      hashToken(state),
      hashToken(browserToken),
      verifier,
    );
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return {
      browserToken,
      url: this.spotify.authorizationUrl(state, challenge),
    };
  }
  async complete(
    state: string,
    browserToken: string,
    code?: string,
    denied?: boolean,
    previousSession?: string,
  ) {
    const verifier = await this.store.consumeAttempt(
      hashToken(state),
      hashToken(browserToken),
    );
    if (!verifier) return { outcome: 'invalid_state' as const };
    if (denied) return { outcome: 'denied' as const };
    if (!code) return { outcome: 'failed' as const };
    const grant = await this.spotify.exchange(code, verifier);
    const profile = await this.spotify.profile(grant.accessToken);
    const sessionToken = newToken();
    await this.store.saveLogin(
      profile,
      grant,
      hashToken(sessionToken),
      validToken(previousSession) ? hashToken(previousSession) : undefined,
    );
    return { outcome: 'connected' as const, sessionToken };
  }
  async status(sessionToken?: string) {
    const session = validToken(sessionToken)
      ? await this.store.findSession(hashToken(sessionToken))
      : null;
    if (!session)
      return { enabled: true, authenticated: false, connected: false };
    try {
      await this.store.accessToken(session.accountId, this.spotify);
      return {
        enabled: true,
        authenticated: true,
        connected: true,
        displayName: session.displayName,
      };
    } catch (error) {
      if (error instanceof SpotifyError) {
        return {
          enabled: true,
          authenticated: true,
          connected: false,
          displayName: session.displayName,
          error: error.kind,
          retryAfter: error.retryAfter,
        };
      }
      throw error;
    }
  }
  async logout(sessionToken?: string) {
    if (validToken(sessionToken))
      await this.store.deleteSession(hashToken(sessionToken));
  }
  // Trusted backend callers must obtain the host from the cookie, never a client account ID.
  async requireHost(sessionToken?: string) {
    const session = validToken(sessionToken)
      ? await this.store.findSession(hashToken(sessionToken))
      : null;
    if (!session) throw new SpotifyError('reauthenticate');
    return session;
  }
  async hostProfile(sessionToken?: string) {
    const host = await this.requireHost(sessionToken);
    const token = await this.store.accessToken(host.accountId, this.spotify);
    try {
      return await this.spotify.profile(token);
    } catch (error) {
      if (!(error instanceof SpotifyError) || error.kind !== 'reauthenticate')
        throw error;
      const refreshed = await this.store.accessToken(
        host.accountId,
        this.spotify,
        token,
      );
      return this.spotify.profile(refreshed);
    }
  }
  // hostId must come from a server-verified party, never from browser input.
  async searchTracks(
    hostId: string,
    query: string,
    offset: number,
    allowExplicit: boolean,
  ) {
    const token = await this.store.accessToken(hostId, this.spotify);
    try {
      return await this.spotify.search(token, query, offset, allowExplicit);
    } catch (error) {
      if (!(error instanceof SpotifyError) || error.kind !== 'reauthenticate')
        throw error;
      const refreshed = await this.store.accessToken(
        hostId,
        this.spotify,
        token,
      );
      return this.spotify.search(refreshed, query, offset, allowExplicit);
    }
  }
  async requestTrack(hostId: string, id: string) {
    const token = await this.store.accessToken(hostId, this.spotify);
    try {
      return await this.spotify.track(token, id);
    } catch (error) {
      if (!(error instanceof SpotifyError) || error.kind !== 'reauthenticate')
        throw error;
      const refreshed = await this.store.accessToken(
        hostId,
        this.spotify,
        token,
      );
      return this.spotify.track(refreshed, id);
    }
  }
  // hostId comes only from a server-verified party, never browser input.
  private async playbackCall<T>(
    hostId: string,
    work: (token: string) => Promise<T>,
  ) {
    const token = await this.store.accessToken(hostId, this.spotify);
    try {
      return await work(token);
    } catch (error) {
      if (!(error instanceof SpotifyError) || error.kind !== 'reauthenticate')
        throw error;
      return work(await this.store.accessToken(hostId, this.spotify, token));
    }
  }
  uploadCover(hostId: string, id: string, base64: string) {
    return this.playbackCall(hostId, (t) =>
      this.spotify.playback.uploadCover(t, id, base64),
    );
  }
  createPlaylist(hostId: string, name: string, marker: string) {
    return this.playbackCall(hostId, (t) =>
      this.spotify.playback.createPlaylist(t, name, marker),
    );
  }
  findPlaylist(
    hostId: string,
    description: string,
    name?: string,
    excludedIds?: string[],
  ) {
    return this.playbackCall(hostId, (t) =>
      this.spotify.playback.findPlaylist(t, description, name, excludedIds),
    );
  }
  matchingPlaylistIds(hostId: string, description: string, name: string) {
    return this.playbackCall(hostId, (t) =>
      this.spotify.playback.matchingPlaylistIds(t, description, name),
    );
  }
  updatePlaylistDescription(hostId: string, id: string, description: string) {
    return this.playbackCall(hostId, (t) =>
      this.spotify.playback.updatePlaylistDescription(t, id, description),
    );
  }
  backupTracks(hostId: string, id: string, allowExplicit: boolean) {
    return this.playbackCall(hostId, (t) =>
      this.spotify.playback.backupTracks(t, id, allowExplicit),
    );
  }
  playlistUris(hostId: string, id: string) {
    return this.playbackCall(hostId, (t) =>
      this.spotify.playback.playlistUris(t, id),
    );
  }
  writeItems(
    hostId: string,
    id: string,
    uris: string[],
    replace: boolean,
    position?: number,
  ) {
    return this.playbackCall(hostId, (t) =>
      this.spotify.playback.writeItems(t, id, uris, replace, position),
    );
  }
  moveItem(hostId: string, id: string, from: number, to: number) {
    return this.playbackCall(hostId, (t) =>
      this.spotify.playback.moveItem(t, id, from, to),
    );
  }
  removeItems(
    hostId: string,
    id: string,
    items: { uri: string; positions: number[] }[],
  ) {
    return this.playbackCall(hostId, (t) =>
      this.spotify.playback.removeItems(t, id, items),
    );
  }
  player(hostId: string) {
    return this.playbackCall(hostId, (t) => this.spotify.playback.player(t));
  }
}
