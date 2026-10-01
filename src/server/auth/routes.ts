import type { FastifyInstance, FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { AuthService, validToken } from './service.js';
import { SpotifyError } from '../spotify/client.js';

const callbackQuery = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code: z.string().min(1).max(2048).optional(),
    error: z.string().min(1).max(128).optional(),
  })
  .refine((query) => Boolean(query.code) !== Boolean(query.error));

export async function authRoutes(
  app: FastifyInstance,
  options: { service?: AuthService },
) {
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const service = options.service;
  const secure = service?.config.secureCookies ?? false;
  const prefix = secure ? '__Host-' : '';
  const oauthCookie = `${prefix}crowdcue_oauth`;
  const hostCookie = `${prefix}crowdcue_host`;
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
  };
  const limited = (max: number) => ({
    config: { rateLimit: { max, timeWindow: '1 minute' } },
  });
  const redirectOutcome = (reply: FastifyReply, outcome: string) =>
    reply.redirect(`${service!.config.appOrigin}/?spotify=${outcome}`, 303);
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof SpotifyError) {
      if (error.retryAfter) reply.header('Retry-After', error.retryAfter);
      return reply
        .code(
          error.kind === 'rate_limited'
            ? 429
            : error.kind === 'reauthenticate'
              ? 401
              : 503,
        )
        .send({ error: error.message });
    }
    if (
      error instanceof Error &&
      'statusCode' in error &&
      error.statusCode === 429
    )
      return reply
        .code(429)
        .send({ error: 'Too many attempts. Please try again shortly.' });
    request.log.error(
      { requestId: request.id },
      'Authentication request failed',
    );
    return reply
      .code(503)
      .send({ error: 'Authentication is unavailable. Please try again.' });
  });

  // HTML forms use this POST without JavaScript and include the browser Origin.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 1024 },
    (_request, _body, done) => done(null, {}),
  );
  app.post('/api/auth/spotify/login', limited(10), async (request, reply) => {
    if (!service)
      return reply
        .code(503)
        .send({ error: 'Spotify connection is not configured.' });
    if (request.headers.origin !== service.config.appOrigin) {
      return reply
        .code(403)
        .send({ error: 'Open CrowdCue to connect Spotify.' });
    }
    const attempt = await service.start();
    reply.setCookie(oauthCookie, attempt.browserToken, {
      ...cookieOptions,
      maxAge: 600,
    });
    return reply.redirect(attempt.url, 303);
  });

  app.get('/api/auth/spotify/callback', limited(30), async (request, reply) => {
    if (!service)
      return reply
        .code(503)
        .send({ error: 'Spotify connection is not configured.' });
    const query = callbackQuery.safeParse(request.query);
    const browserToken = request.cookies[oauthCookie];
    reply.clearCookie(oauthCookie, cookieOptions);
    if (!query.success || !validToken(browserToken))
      return redirectOutcome(reply, 'invalid_state');
    try {
      const completed = await service.complete(
        query.data.state,
        browserToken,
        query.data.code,
        Boolean(query.data.error),
        request.cookies[hostCookie],
      );
      if (completed.sessionToken) {
        reply.setCookie(hostCookie, completed.sessionToken, {
          ...cookieOptions,
          maxAge: 30 * 24 * 60 * 60,
        });
      }
      return redirectOutcome(reply, completed.outcome);
    } catch (error) {
      request.log.warn(
        {
          category: error instanceof SpotifyError ? error.kind : 'unavailable',
        },
        'Spotify connection failed',
      );
      return redirectOutcome(
        reply,
        error instanceof SpotifyError ? error.kind : 'unavailable',
      );
    }
  });
  app.get('/api/auth/spotify/status', limited(60), async (request) => {
    return service
      ? service.status(request.cookies[hostCookie])
      : { enabled: false, authenticated: false, connected: false };
  });
  app.post('/api/auth/logout', limited(30), async (request, reply) => {
    if (!service)
      return reply
        .code(503)
        .send({ error: 'Spotify connection is not configured.' });
    if (request.headers.origin !== service.config.appOrigin)
      return reply.code(403).send({ error: 'Open CrowdCue to sign out.' });
    await service.logout(request.cookies[hostCookie]);
    reply.clearCookie(hostCookie, cookieOptions);
    return reply.code(204).send();
  });
}
