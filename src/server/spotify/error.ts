export class SpotifyError extends Error {
  constructor(
    public readonly kind:
      | 'reauthenticate'
      | 'rate_limited'
      | 'unavailable'
      | 'permissions'
      | 'no_active_device',
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
