import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { AuthService } from '../auth/service.js';
import { validToken } from '../auth/service.js';
import { SpotifyError } from '../spotify/client.js';
import { RequestError } from '../requests/contracts.js';
import { playbackActionSchema } from './contracts.js';
import type { PlaybackService } from './service.js';
export async function playbackRoutes(
  app: FastifyInstance,
  options: { auth?: AuthService; playback?: PlaybackService },
) {
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RequestError)
      return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof SpotifyError) {
      if (error.retryAfter) reply.header('Retry-After', error.retryAfter);
      return reply.code(error.kind === 'rate_limited' ? 429 : 503).send({
        error:
          'Spotify could not confirm the change. Check the session status before retrying.',
      });
    }
    if (
      error instanceof Error &&
      'statusCode' in error &&
      [400, 413, 415, 429].includes(Number(error.statusCode))
    )
      return reply
        .code(Number(error.statusCode))
        .send({ error: 'Send valid session details or wait before retrying.' });
    request.log.error({ requestId: request.id }, 'Playback operation failed');
    return reply
      .code(503)
      .send({ error: 'Session playback is unavailable. Try again shortly.' });
  });
  for (const method of ['GET', 'POST'] as const)
    app.route<{ Params: { token: string } }>({
      method,
      url: '/api/party-links/admin/:token/playback',
      bodyLimit: 1024,
      config: {
        rateLimit: { max: method === 'GET' ? 120 : 30, timeWindow: '1 minute' },
      },
      handler: async (request, reply) => {
        if (!options.auth || !options.playback)
          return reply
            .code(503)
            .send({ error: 'Spotify session playback is not configured.' });
        if (!validToken(request.params.token))
          throw new RequestError(404, 'Party not found.');
        if (
          method === 'POST' &&
          request.headers.origin !== options.auth.config.appOrigin
        )
          return reply
            .code(403)
            .send({ error: 'Open the host dashboard to manage playback.' });
        const host = await options.auth
          .requireHost(
            request.cookies[
              `${options.auth.config.secureCookies ? '__Host-' : ''}crowdcue_host`
            ],
          )
          .catch(() => {
            throw new RequestError(401, 'Sign in as this session’s host.');
          });
        if (method === 'GET')
          return options.playback.store.status(
            host.accountId,
            request.params.token,
          );
        const input = playbackActionSchema.safeParse(request.body);
        if (!input.success)
          throw new RequestError(400, 'Choose a valid session action.');
        return options.playback.action(
          host.accountId,
          request.params.token,
          input.data,
        );
      },
    });
}
