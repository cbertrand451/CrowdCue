import { requestRoutes } from './requests/routes.js';
import type { PostgresRequestStore } from './requests/store.js';
import { guestRoutes } from './guests/routes.js';
import type { PostgresGuestStore } from './guests/store.js';
import Fastify, { LogController } from 'fastify';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import type { Config } from './config.js';
import { authRoutes } from './auth/routes.js';
import type { AuthService } from './auth/service.js';
import { partyRoutes } from './parties/routes.js';
import type { PartyStore } from './parties/store.js';

export function buildApp(
  config: Config,
  options: {
    serveFrontend?: boolean;
    frontendRoot?: string;
    logger?: boolean;
    auth?: AuthService;
    parties?: PartyStore;
    guests?: PostgresGuestStore;
    requests?: PostgresRequestStore;
  } = {},
) {
  const app = Fastify({
    routerOptions: { maxParamLength: 128 },
    // Request URLs may eventually contain private party identifiers or OAuth codes.
    logController: new LogController({ disableRequestLogging: true }),
    logger:
      options.logger === false
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
          },
  });
  app.register(helmet);
  app.register(requestRoutes, { auth: options.auth, store: options.requests });
  app.register(guestRoutes, {
    store: options.guests,
    auth: options.auth,
    appOrigin: options.auth?.config.appOrigin,
    secureCookies: options.auth?.config.secureCookies,
  });
  app.register(authRoutes, { service: options.auth });
  app.register(partyRoutes, { auth: options.auth, store: options.parties });
  app.get('/api/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', service: 'crowdcue' };
  });
  if (options.serveFrontend) {
    app.register(fastifyStatic, {
      root:
        options.frontendRoot ??
        fileURLToPath(new URL('../client/', import.meta.url)),
    });
    for (const route of ['/join/:token', '/admin/:token', '/display/:token']) {
      app.get<{ Params: { token: string } }>(route, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        reply.header('Referrer-Policy', 'no-referrer');
        reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
        const pattern = route.startsWith('/join/')
          ? /^[A-Za-z0-9_-]{32,128}$/
          : /^[A-Za-z0-9_-]{43}$/;
        if (!pattern.test(request.params.token))
          return reply.code(404).send({ error: 'Party not found.' });
        return reply.sendFile('index.html', { cacheControl: false });
      });
    }
  }
  app.setErrorHandler((_error, request, reply) => {
    // Do not log raw exceptions: future integration errors may contain credentials.
    request.log.error({ requestId: request.id }, 'Request failed');
    reply.code(500).send({ error: 'Internal server error' });
  });
  app.setNotFoundHandler((_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return reply.code(404).send({ error: 'Page not found.' });
  });
  return app;
}
