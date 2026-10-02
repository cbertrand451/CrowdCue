import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { validToken } from '../auth/service.js';
import { guestCookieName } from '../guests/routes.js';
import { SpotifyError } from '../spotify/client.js';
import { queueActionSchema } from '../queue/contracts.js';
import { requestInputSchema, RequestError } from './contracts.js';
import type { PostgresRequestStore } from './store.js';
export async function requestRoutes(
  app: FastifyInstance,
  options: { auth?: AuthService; store?: PostgresRequestStore },
) {
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RequestError) {
      if (error.retryAfter) reply.header('Retry-After', error.retryAfter);
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error instanceof SpotifyError) {
      if (error.retryAfter) reply.header('Retry-After', error.retryAfter);
      return reply.code(error.kind === 'rate_limited' ? 429 : 503).send({
        error:
          'Spotify is unavailable for this request. Ask the host to check their connection, then retry.',
      });
    }
    if (
      error instanceof Error &&
      'statusCode' in error &&
      [400, 413, 415, 429].includes(Number(error.statusCode))
    )
      return reply.code(Number(error.statusCode)).send({
        error:
          error.statusCode === 429
            ? 'Too many attempts. Try again shortly.'
            : 'Send valid request details as JSON.',
      });
    request.log.error({ requestId: request.id }, 'Song request failed');
    return reply
      .code(503)
      .send({ error: 'Song requests are unavailable. Try again.' });
  });
  const limited = (max: number) => ({
    config: { rateLimit: { max, timeWindow: '1 minute' } },
  });
  const token = (value: string, role: 'guest' | 'admin') => {
    if (
      !(role === 'guest'
        ? /^[A-Za-z0-9_-]{32,128}$/.test(value)
        : validToken(value))
    )
      throw new RequestError(404, 'Party not found.');
    return value;
  };
  const session = (
    cookies: Record<string, string | undefined>,
    value: string,
  ) => {
    const raw =
      cookies[guestCookieName(value, !!options.auth?.config.secureCookies)];
    return validToken(raw) ? raw : undefined;
  };
  const page = (value: unknown) => {
    const parsed = z
      .object({ offset: z.coerce.number().int().min(0).max(100000).default(0) })
      .strict()
      .safeParse(value);
    if (!parsed.success)
      throw new RequestError(400, 'Invalid request list page.');
    return parsed.data.offset;
  };
  for (const role of ['guest', 'admin'] as const) {
    for (const view of ['requests', 'queue', 'leaderboard'] as const) {
      app.get<{ Params: { token: string } }>(
        `/api/party-links/${role}/:token/${view}`,
        limited(role === 'guest' ? 600 : 60),
        async (request, reply) => {
          if (!options.store || !options.auth)
            return reply
              .code(503)
              .send({ error: 'Song requests are not available yet.' });
          const value = token(request.params.token, role);
          if (
            view === 'leaderboard' &&
            Object.keys(request.query as object).length
          )
            throw new RequestError(
              400,
              'Leaderboard does not accept query parameters.',
            );
          const offset = page(request.query);
          if (role === 'guest')
            return (
              view === 'leaderboard'
                ? options.store.guestLeaderboard.bind(options.store)
                : view === 'queue'
                  ? options.store.guestQueue.bind(options.store)
                  : options.store.guestList.bind(options.store)
            )(value, session(request.cookies, value), offset);
          const host = await options.auth
            .requireHost(
              request.cookies[
                `${options.auth.config.secureCookies ? '__Host-' : ''}crowdcue_host`
              ],
            )
            .catch((error: unknown) => {
              if (
                error instanceof SpotifyError &&
                error.kind === 'reauthenticate'
              )
                throw new RequestError(401, 'Sign in as this party’s host.');
              throw error;
            });
          if (view === 'leaderboard')
            return options.store.adminLeaderboard(host.accountId, value);
          return view === 'queue'
            ? options.store.adminQueue(host.accountId, value, offset)
            : options.store.adminList(host.accountId, value, offset);
        },
      );
    }
  }
  app.post<{ Params: { token: string } }>(
    '/api/party-links/guest/:token/requests',
    { ...limited(20), bodyLimit: 1024 },
    async (request, reply) => {
      if (!options.store || !options.auth)
        return reply
          .code(503)
          .send({ error: 'Song requests are not available yet.' });
      if (request.headers.origin !== options.auth.config.appOrigin)
        return reply
          .code(403)
          .send({ error: 'Open the guest link to request a song.' });
      const value = token(request.params.token, 'guest');
      const input = requestInputSchema.safeParse(request.body);
      const key = z.uuid().safeParse(request.headers['idempotency-key']);
      if (!input.success || !key.success)
        throw new RequestError(
          400,
          'Choose a valid Spotify song and request key.',
        );
      const guest = session(request.cookies, value);
      const ready = await options.store.prepare(
        value,
        guest,
        input.data.trackId,
        key.data,
      );
      const result =
        ready.result ??
        (await options.store.create(
          value,
          guest,
          await options.auth.requestTrack(ready.hostId, input.data.trackId),
          key.data,
        ));
      return reply.code(result.created ? 201 : 200).send(result);
    },
  );
  app.post<{ Params: { token: string } }>(
    '/api/party-links/admin/:token/queue',
    { ...limited(30), bodyLimit: 1024 },
    async (request, reply) => {
      if (!options.store || !options.auth)
        return reply
          .code(503)
          .send({ error: 'Queue controls are unavailable.' });
      if (request.headers.origin !== options.auth.config.appOrigin)
        return reply
          .code(403)
          .send({ error: 'Open CrowdCue to manage the queue.' });
      const host = await options.auth
        .requireHost(
          request.cookies[
            `${options.auth.config.secureCookies ? '__Host-' : ''}crowdcue_host`
          ],
        )
        .catch((error: unknown) => {
          if (error instanceof SpotifyError && error.kind === 'reauthenticate')
            throw new RequestError(401, 'Sign in as this party’s host.');
          throw error;
        });
      const value = token(request.params.token, 'admin');
      const input = queueActionSchema.safeParse(request.body);
      if (!input.success)
        throw new RequestError(400, 'Choose a valid queue action.');
      return options.store.controlQueue(host.accountId, value, input.data);
    },
  );
  app.post<{ Params: { token: string; id: string } }>(
    '/api/party-links/admin/:token/requests/:id',
    { ...limited(30), bodyLimit: 1024 },
    async (request, reply) => {
      if (!options.store || !options.auth)
        return reply
          .code(503)
          .send({ error: 'Song requests are not available yet.' });
      if (request.headers.origin !== options.auth.config.appOrigin)
        return reply
          .code(403)
          .send({ error: 'Open CrowdCue to manage requests.' });
      const host = await options.auth
        .requireHost(
          request.cookies[
            `${options.auth.config.secureCookies ? '__Host-' : ''}crowdcue_host`
          ],
        )
        .catch((error: unknown) => {
          if (error instanceof SpotifyError && error.kind === 'reauthenticate')
            throw new RequestError(401, 'Sign in as this party’s host.');
          throw error;
        });
      const value = token(request.params.token, 'admin');
      if (!z.uuid().safeParse(request.params.id).success)
        throw new RequestError(404, 'Request not found.');
      const input = z
        .object({ action: z.enum(['approve', 'reject', 'remove']) })
        .strict()
        .safeParse(request.body);
      if (!input.success)
        throw new RequestError(400, 'Choose a valid request action.');
      return {
        request: await options.store.moderate(
          host.accountId,
          value,
          request.params.id,
          input.data.action,
        ),
      };
    },
  );
  app.post<{ Params: { token: string; id: string } }>(
    '/api/party-links/guest/:token/requests/:id/vote',
    { ...limited(120), bodyLimit: 1024 },
    async (request, reply) => {
      if (!options.store || !options.auth)
        return reply.code(503).send({ error: 'Voting is not available yet.' });
      if (request.headers.origin !== options.auth.config.appOrigin)
        return reply.code(403).send({ error: 'Open the guest link to vote.' });
      const value = token(request.params.token, 'guest');
      if (!z.uuid().safeParse(request.params.id).success)
        throw new RequestError(404, 'Request not found.');
      const input = z
        .object({ voted: z.boolean() })
        .strict()
        .safeParse(request.body);
      if (!input.success)
        throw new RequestError(
          400,
          'Choose whether to add or remove your vote.',
        );
      return {
        request: await options.store.vote(
          value,
          session(request.cookies, value),
          request.params.id,
          input.data.voted,
        ),
      };
    },
  );
}
