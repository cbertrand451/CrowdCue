import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { hashToken } from '../auth/crypto.js';
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
}
