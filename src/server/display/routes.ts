import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { validToken } from '../auth/service.js';
import { DisplayError, type PostgresDisplayStore } from './store.js';
export async function displayRoutes(
  app: FastifyInstance,
  options: { store?: PostgresDisplayStore },
) {
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
  });
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(
        error instanceof DisplayError
          ? 404
          : error instanceof Error &&
              'statusCode' in error &&
              error.statusCode === 429
            ? 429
            : 503,
      )
      .send({
        error:
          error instanceof DisplayError
            ? 'Party not found.'
            : 'Display updates unavailable.',
      }),
  );
  app.get<{ Params: { token: string } }>(
    '/api/party-links/display/:token/snapshot',
    {
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!validToken(request.params.token)) throw new DisplayError();
      if (!options.store)
        return reply.code(503).send({ error: 'Display updates unavailable.' });
      return options.store.snapshot(request.params.token);
    },
  );
}
