import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { hashToken } from '../auth/crypto.js';
import { searchQuerySchema } from '../search/contracts.js';
import { SpotifyError } from '../spotify/client.js';
import type { AuthService } from '../auth/service.js';
import { validToken } from '../auth/service.js';
import { guestInputSchema, GuestError } from './contracts.js';
import type { PostgresGuestStore } from './store.js';
export function guestCookieName(token: string, secure: boolean) {
  return `${secure ? '__Host-' : ''}crowdcue_guest_${hashToken(token).slice(0, 32)}`;
}
export async function guestRoutes(
  app: FastifyInstance,
  options: {
    store?: PostgresGuestStore;
    auth?: AuthService;
    appOrigin?: string;
    secureCookies?: boolean;
  },
) {
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof SpotifyError) {
      if (error.retryAfter) reply.header('Retry-After', error.retryAfter);
      return reply.code(error.kind === 'rate_limited' ? 429 : 503).send({
        error:
          error.kind === 'reauthenticate' || error.kind === 'permissions'
            ? 'The host needs to reconnect Spotify before searching is available.'
            : error.message,
      });
    }
    if (error instanceof GuestError)
      return reply.code(error.statusCode).send({ error: error.message });
    if (
      error instanceof Error &&
      'statusCode' in error &&
      [400, 413, 415, 429].includes(Number(error.statusCode))
    )
      return reply.code(Number(error.statusCode)).send({
        error:
          error.statusCode === 429
            ? 'Too many attempts. Try again shortly.'
            : 'Send a valid guest name as JSON.',
      });
    request.log.error({ requestId: request.id }, 'Guest request failed');
    return reply
      .code(503)
      .send({ error: 'Unable to join this party. Try again.' });
  });
  for (const method of ['GET', 'POST'] as const) {
    app.route<{ Params: { token: string } }>({
      method,
      url: '/api/party-links/guest/:token/session',
      bodyLimit: 1024,
      config: {
        rateLimit: { max: method === 'GET' ? 300 : 30, timeWindow: '1 minute' },
      },
      handler: async (request, reply) => {
        if (!options.store || !options.appOrigin)
          return reply
            .code(503)
            .send({ error: 'Guest access is not available yet.' });
        const token = request.params.token;
        if (!/^[A-Za-z0-9_-]{32,128}$/.test(token))
          throw new GuestError(404, 'Party not found.');
        const name = guestCookieName(token, !!options.secureCookies);
        const raw = request.cookies[name];
        const session = raw && validToken(raw) ? raw : undefined;
        if (method === 'GET')
          return { guest: await options.store.session(token, session) };
        if (request.headers.origin !== options.appOrigin)
          return reply
            .code(403)
            .send({ error: 'Open the guest link to join this party.' });
        const input = guestInputSchema.safeParse(request.body);
        if (!input.success)
          return reply.code(400).send({
            error:
              'Enter a name between 1 and 80 characters, or join without a name.',
          });
        const result = await options.store.join(
          token,
          session,
          input.data.displayName,
        );
        reply.setCookie(name, result.token, {
          path: '/',
          httpOnly: true,
          secure: !!options.secureCookies,
          sameSite: 'lax',
          expires: new Date(result.guest.expiresAt),
        });
        return reply
          .code(result.created ? 201 : 200)
          .send({ guest: result.guest });
      },
    });
  }
  app.get<{ Params: { token: string } }>(
    '/api/party-links/guest/:token/search',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!options.store || !options.auth)
        return reply
          .code(503)
          .send({ error: 'Song search is not available yet.' });
      const token = request.params.token;
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(token))
        throw new GuestError(404, 'Party not found.');
      const query = searchQuerySchema.safeParse(request.query);
      if (!query.success)
        return reply.code(400).send({
          error: 'Use a search between 2 and 200 characters and a valid page.',
        });
      const session =
        request.cookies[guestCookieName(token, !!options.secureCookies)];
      const context = await options.store.searchContext(
        token,
        validToken(session) ? session : undefined,
      );
      return options.auth.searchTracks(
        context.hostId,
        query.data.q,
        query.data.offset,
        context.allowExplicit,
      );
    },
  );
}
