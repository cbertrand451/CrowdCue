import { SpotifyError } from './spotify/error.js';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryAfter?: number;

  constructor(
    statusCode: number,
    message: string,
    options: { code?: string; retryAfter?: number } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = options.code ?? 'api_error';
    this.retryAfter = options.retryAfter;
  }
}

export function serializeApiError(error: unknown): {
  statusCode: number;
  body: { error: string };
  retryAfter?: number;
  logCategory: string;
  shouldLog: boolean;
} {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message },
      retryAfter: error.retryAfter,
      logCategory: error.code,
      shouldLog: error.statusCode >= 500,
    };
  }

  if (error instanceof SpotifyError) {
    return {
      statusCode:
        error.kind === 'rate_limited'
          ? 429
          : error.kind === 'reauthenticate'
            ? 401
            : error.kind === 'permissions'
              ? 403
              : error.kind === 'no_active_device'
                ? 409
                : 503,
      body: { error: error.message },
      retryAfter: error.retryAfter,
      logCategory: `spotify_${error.kind}`,
      shouldLog: error.kind === 'unavailable' || error.kind === 'no_active_device',
    };
  }

  const statusCode = statusFromError(error);
  if (statusCode !== undefined) {
    return {
      statusCode,
      body: { error: safeHttpErrorMessage(statusCode) },
      logCategory: `http_${statusCode}`,
      shouldLog: statusCode >= 500,
    };
  }

  return {
    statusCode: 500,
    body: { error: 'Internal server error' },
    logCategory: 'internal_error',
    shouldLog: true,
  };
}

function statusFromError(error: unknown) {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) return;
  const statusCode = Number((error as { statusCode?: unknown }).statusCode);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : undefined;
}

function safeHttpErrorMessage(statusCode: number) {
  if (statusCode === 413) return 'Request body is too large.';
  if (statusCode === 429) return 'Too many attempts. Please try again shortly.';
  if (statusCode === 404) return 'Page not found.';
  if (statusCode >= 400 && statusCode < 500) return 'Send a valid, bounded request.';
  return 'Internal server error';
}
