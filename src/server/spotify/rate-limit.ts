import { SpotifyError } from './error.js';
import type { SpotifyFetch } from './client.js';

// CrowdCue's conservative ceiling, not a published Spotify quota.
// https://developer.spotify.com/documentation/web-api/concepts/rate-limits
export const SPOTIFY_REQUEST_POLICY = Object.freeze({
  windowMs: 30_000,
  maxRequests: 60,
  spacingMs: 500,
  maxWaitMs: 2_000,
});

export class SpotifyRequestDeferred extends SpotifyError {
  constructor(retryAfter: number) {
    super('unavailable', retryAfter);
    this.message =
      'Spotify requests are temporarily paused. Please wait before retrying.';
  }
}

export class SpotifyRequestCancelled extends DOMException {
  constructor() {
    super('Queued Spotify request cancelled.', 'AbortError');
  }
}

export class SpotifyRequestLimiter {
  private starts: number[] = [];
  private nextStart = 0;
  private cooldownUntil = 0;

  async acquire(signal?: AbortSignal | null) {
    const deadline = Date.now() + SPOTIFY_REQUEST_POLICY.maxWaitMs;
    while (true) {
      signal?.throwIfAborted();
      const now = Date.now();
      this.starts = this.starts.filter(
        (time) => time > now - SPOTIFY_REQUEST_POLICY.windowMs,
      );
      const windowReady =
        this.starts.length >= SPOTIFY_REQUEST_POLICY.maxRequests
          ? this.starts[0] + SPOTIFY_REQUEST_POLICY.windowMs
          : now;
      const ready = Math.max(this.nextStart, this.cooldownUntil, windowReady);
      if (ready > deadline || now > deadline) {
        throw new SpotifyRequestDeferred(
          Math.max(1, Math.ceil((ready - now) / 1000)),
        );
      }
      if (ready <= now) {
        this.starts.push(now);
        this.nextStart = now + SPOTIFY_REQUEST_POLICY.spacingMs;
        return;
      }
      // Recheck after waking: other callers or a Spotify response may change admission.
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          reject(signal?.reason);
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', abort);
          resolve();
        }, ready - now);
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
  }

  cooldown(retryAfter: string | null) {
    const seconds = Number(retryAfter);
    const delay =
      Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 30;
    this.cooldownUntil = Math.max(
      this.cooldownUntil,
      Date.now() + delay * 1000,
    );
  }
}

export function createSpotifyFetch(
  fetcher: SpotifyFetch = fetch,
  limiter = new SpotifyRequestLimiter(),
): SpotifyFetch {
  return async (input, init) => {
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    try {
      await limiter.acquire(signal);
    } catch (error) {
      if (signal?.aborted) throw new SpotifyRequestCancelled();
      throw error;
    }
    const response = await fetcher(input, init);
    if (response.status === 429)
      limiter.cooldown(response.headers.get('retry-after'));
    // Do not replay mutations or uncertain network failures. Existing recovery owns retries.
    return response;
  };
}
