import type { FastifyInstance } from 'fastify';

// Request URLs, bodies and raw integration errors can contain private links or tokens.
export const safeLogSerializers = {
  req: (request: { id?: unknown; method?: string }) => ({
    id: request.id,
    method: request.method,
  }),
  res: (response: { statusCode?: number }) => ({
    statusCode: response.statusCode,
  }),
  err: (error: unknown) => {
    // Discard raw messages and stacks, including accidental provider credentials.
    void error;
    return { type: 'Error', message: 'Operation failed', stack: '' };
  },
};

export function protectHttp(app: FastifyInstance, appOrigin?: string) {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)',
    );
    // Reject unrelated upgrades before plugin fallback handling can log a private path.
    if (
      request.headers.upgrade?.toLowerCase() === 'websocket' &&
      !/^\/api\/party-links\/(guest|admin|display)\/[A-Za-z0-9_-]{32,128}\/live$/.test(
        request.url,
      )
    ) {
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
      return reply.code(404).send({ error: 'Live updates unavailable.' });
    }
    const path = request.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    // Spotify returns via top-level navigation; OAuth state remains cookie-bound.
    const callbackNavigation =
      path === '/api/auth/spotify/callback' &&
      request.method === 'GET' &&
      request.headers['sec-fetch-mode'] === 'navigate' &&
      request.headers['sec-fetch-dest'] === 'document';
    if (
      request.headers['sec-fetch-site'] === 'cross-site' &&
      path !== '/api/health' &&
      !callbackNavigation
    )
      return reply
        .code(403)
        .send({ error: 'Open CrowdCue to access this party.' });
    // Defense in depth for every current and future cookie-authenticated mutation.
    if (
      appOrigin &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin !== appOrigin
    )
      return reply
        .code(403)
        .send({ error: 'Open CrowdCue before making changes.' });
  });
}
