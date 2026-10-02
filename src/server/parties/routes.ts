import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { validToken } from '../auth/service.js';
import { SpotifyError } from '../spotify/client.js';
import { createPartySchema, PartyError } from './contracts.js';
import type { PartyStore } from './store.js';

export async function partyRoutes(
  app: FastifyInstance,
  options: { auth?: AuthService; store?: PartyStore },
) {
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const { auth, store } = options;
  const hostCookie = `${auth?.config.secureCookies ? '__Host-' : ''}crowdcue_host`;
  const limited = (max: number) => ({
    config: { rateLimit: { max, timeWindow: '1 minute' } },
  });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof PartyError)
      return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof SpotifyError && error.kind === 'reauthenticate') {
      return reply
        .code(401)
        .send({ error: 'Sign in with Spotify to manage your parties.' });
    }
    if (error instanceof Error && 'statusCode' in error) {
      if (error.statusCode === 429)
        return reply
          .code(429)
          .send({ error: 'Too many requests. Please try again shortly.' });
      if ([400, 413, 415].includes(Number(error.statusCode)))
        return reply
          .code(Number(error.statusCode))
          .send({ error: 'Send valid party details as JSON.' });
    }
    request.log.error({ requestId: request.id }, 'Party request failed');
    return reply
      .code(503)
      .send({ error: 'Parties are unavailable. Please try again.' });
  });

  app.post(
    '/api/parties',
    { ...limited(10), bodyLimit: 4096 },
    async (request, reply) => {
      if (!auth || !store)
        return reply
          .code(503)
          .send({ error: 'Party creation is not available yet.' });
      if (request.headers.origin !== auth.config.appOrigin)
        return reply
          .code(403)
          .send({ error: 'Open CrowdCue to create a party.' });
      const host = await auth.requireHost(request.cookies[hostCookie]);
      const parsed = createPartySchema.safeParse(request.body);
      const key = z.uuid().safeParse(request.headers['idempotency-key']);
      if (!parsed.success || !key.success)
        return reply.code(400).send({
          error:
            'Enter a party name (1–120 characters), valid settings, and a creation key.',
        });
      const result = await store.create(host.accountId, parsed.data, key.data);
      reply.header('Location', `/api/parties/${result.party.id}`);
      return reply
        .code(result.created ? 201 : 200)
        .send({ party: result.party });
    },
  );
  app.get('/api/parties', limited(60), async (request, reply) => {
    if (!auth || !store)
      return reply.code(503).send({ error: 'Parties are not available yet.' });
    const host = await auth.requireHost(request.cookies[hostCookie]);
    const query = z
      .object({
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .strict()
      .safeParse(request.query);
    if (!query.success)
      return reply.code(400).send({ error: 'Invalid party list page.' });
    return store.list(host.accountId, query.data.offset);
  });
  app.get<{ Params: { id: string } }>(
    '/api/parties/:id',
    limited(60),
    async (request, reply) => {
      if (!auth || !store)
        return reply
          .code(503)
          .send({ error: 'Parties are not available yet.' });
      const host = await auth.requireHost(request.cookies[hostCookie]);
      if (!z.uuid().safeParse(request.params.id).success)
        throw new PartyError(404, 'Party not found.');
      return { party: await store.owned(host.accountId, request.params.id) };
    },
  );
  app.get<{ Params: { token: string } }>(
    '/api/party-links/admin/:token',
    limited(60),
    async (request, reply) => {
      if (!auth || !store)
        return reply
          .code(503)
          .send({ error: 'Parties are not available yet.' });
      const host = await auth.requireHost(request.cookies[hostCookie]);
      if (!validToken(request.params.token))
        throw new PartyError(404, 'Party not found.');
      return { party: await store.admin(host.accountId, request.params.token) };
    },
  );
  for (const role of ['guest', 'display'] as const) {
    app.get<{ Params: { token: string } }>(
      `/api/party-links/${role}/:token`,
      limited(300),
      async (request, reply) => {
        if (!store)
          return reply
            .code(503)
            .send({ error: 'Parties are not available yet.' });
        if (
          role === 'guest'
            ? !/^[A-Za-z0-9_-]{32,128}$/.test(request.params.token)
            : !validToken(request.params.token)
        )
          throw new PartyError(404, 'Party not found.');
        return { party: await store.public(request.params.token, role) };
      },
    );
  }
  for (const action of ['settings', 'end'] as const) {
    app.post<{ Params: { token: string } }>(
      `/api/party-links/admin/:token/${action}`,
      { ...limited(30), bodyLimit: 4096 },
      async (request, reply) => {
        if (!auth || !store)
          return reply
            .code(503)
            .send({ error: 'Parties are not available yet.' });
        if (request.headers.origin !== auth.config.appOrigin)
          return reply
            .code(403)
            .send({ error: 'Open CrowdCue to manage this party.' });
        const host = await auth.requireHost(request.cookies[hostCookie]);
        if (!validToken(request.params.token))
          throw new PartyError(404, 'Party not found.');
        if (action === 'end') {
          if (!z.object({}).strict().safeParse(request.body).success)
            return reply
              .code(400)
              .send({ error: 'Send an empty JSON object to end a party.' });
          return {
            party: await store.end(host.accountId, request.params.token),
          };
        }
        const input = createPartySchema.safeParse(request.body);
        if (!input.success)
          return reply
            .code(400)
            .send({ error: 'Check the party name and settings.' });
        return {
          party: await store.update(
            host.accountId,
            request.params.token,
            input.data,
          ),
        };
      },
    );
  }
}
