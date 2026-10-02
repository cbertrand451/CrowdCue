import type { FastifyInstance, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { Pool } from 'pg';
import { hashToken } from '../auth/crypto.js';
import { validToken, type AuthService } from '../auth/service.js';
import { SpotifyError } from '../spotify/error.js';
import { RealtimeHub } from './hub.js';

export async function realtimeRoutes(
  app: FastifyInstance,
  options: { pool?: Pool; auth?: AuthService },
) {
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const hub = options.pool
    ? new RealtimeHub(options.pool, () =>
        app.log.error('Live updates interrupted'),
      )
    : undefined;
  app.addHook('onReady', async () => {
    await hub?.start();
  });
  app.addHook('preClose', async () => {
    await hub?.stop();
  });
  type Params = { role: string; token: string };
  async function authorize(request: FastifyRequest<{ Params: Params }>) {
    const { role, token } = request.params;
    if (!options.pool || !options.auth) throw new AccessError(503);
    if (
      !['guest', 'admin', 'display'].includes(role) ||
      !(role === 'guest'
        ? /^[A-Za-z0-9_-]{32,128}$/.test(token)
        : validToken(token))
    )
      throw new AccessError(404);
    let host: string | undefined;
    if (role === 'admin') {
      try {
        host = (
          await options.auth.requireHost(
            request.cookies[
              `${options.auth.config.secureCookies ? '__Host-' : ''}crowdcue_host`
            ],
          )
        ).accountId;
      } catch (error) {
        if (error instanceof SpotifyError && error.kind === 'reauthenticate')
          throw new AccessError(401);
        throw error;
      }
    }
    const column =
      role === 'guest'
        ? 'guest_join_token'
        : role === 'admin'
          ? 'admin_token_hash'
          : 'display_token_hash';
    const result = await options.pool.query<{ id: string }>(
      `SELECT id FROM parties WHERE ${column}=$1${role === 'admin' ? ' AND host_account_id=$2' : ''}`,
      role === 'admin'
        ? [hashToken(token), host]
        : [role === 'guest' ? token : hashToken(token)],
    );
    if (!result.rows[0]) throw new AccessError(404);
    return result.rows[0].id;
  }
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(
        error instanceof AccessError
          ? error.status
          : (error as { statusCode?: number }).statusCode === 429
            ? 429
            : 503,
      )
      .send({ error: 'Live updates unavailable.' }),
  );
  app.get<{ Params: Params }>(
    '/api/party-links/:role/:token/live',
    {
      websocket: true,
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
      preValidation: async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        reply.header('Referrer-Policy', 'no-referrer');
        reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
        if (!options.auth || !hub) throw new AccessError(503);
        if (request.headers.origin !== options.auth.config.appOrigin)
          throw new AccessError(403);
        await authorize(request);
      },
    },
    (socket, request) => {
      // Attach synchronously: fast client messages must never be lost during async authorization.
      socket.on('message', () => socket.close(1008, 'Read-only connection'));
      socket.on('error', () => socket.terminate());
      void authorize(request)
        .then((party) => {
          if (socket.readyState === 1)
            hub!.add(socket, party, request.ip, () => authorize(request));
        })
        .catch(() => socket.close(1008, 'Access expired'));
    },
  );
}
class AccessError extends Error {
  constructor(readonly status: number) {
    super('Live updates unavailable');
  }
}
