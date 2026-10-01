import Fastify, { LogController } from 'fastify';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import type { Config } from './config.js';
import { authRoutes } from './auth/routes.js';
import type { AuthService } from './auth/service.js';

export function buildApp(
  config: Config,
  options: {
    serveFrontend?: boolean;
    logger?: boolean;
    auth?: AuthService;
  } = {},
) {
  const app = Fastify({
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
  app.register(authRoutes, { service: options.auth });
  app.get('/api/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', service: 'crowdcue' };
  });
  if (options.serveFrontend) {
    app.register(fastifyStatic, {
      root: fileURLToPath(new URL('../client/', import.meta.url)),
    });
  }
  app.setErrorHandler((_error, request, reply) => {
    // Do not log raw exceptions: future integration errors may contain credentials.
    request.log.error({ requestId: request.id }, 'Request failed');
    reply.code(500).send({ error: 'Internal server error' });
  });
  return app;
}
