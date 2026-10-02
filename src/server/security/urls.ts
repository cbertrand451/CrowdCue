/** Only approved HTTPS Spotify artwork origins may reach browser image elements. */
export function isSpotifyArtworkUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      (url.hostname === 'i.scdn.co' || url.hostname.endsWith('.spotifycdn.com'))
    );
  } catch {
    return false;
  }
}
