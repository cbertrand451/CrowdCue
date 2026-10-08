import { z } from 'zod';

const redirectUri = z
  .string()
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/api/auth/spotify/callback' &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  });
const origin = z
  .string()
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      value === url.origin &&
      !url.username &&
      !url.password &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  });
const schema = z.object({
  SPOTIFY_CLIENT_ID: z.string().min(1),
  SPOTIFY_CLIENT_SECRET: z.string().min(1),
  SPOTIFY_REDIRECT_URI: redirectUri,
  APP_ORIGIN: origin,
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  TOKEN_ENCRYPTION_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  TOKEN_ENCRYPTION_KEYS: z.string().min(1),
});

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  if (!env.SPOTIFY_AUTH_ENABLED || env.SPOTIFY_AUTH_ENABLED === 'false')
    return undefined;
  if (env.SPOTIFY_AUTH_ENABLED !== 'true') {
    throw new Error('Invalid environment configuration: SPOTIFY_AUTH_ENABLED');
  }
  const redirect = env.SPOTIFY_REDIRECT_URI || env.SPOTIFY_REDIRECT_URL;
  // Render generates a persistent base64-encoded 256-bit secret. Keep the
  // existing key-ring format available for imports and future key rotation.
  const keyId = env.TOKEN_ENCRYPTION_KEY_ID || 'v1';
  const keyRing =
    env.TOKEN_ENCRYPTION_KEYS ||
    (env.TOKEN_ENCRYPTION_KEY
      ? JSON.stringify({ [keyId]: env.TOKEN_ENCRYPTION_KEY })
      : undefined);
  let defaultOrigin: string | undefined;
  try {
    defaultOrigin = new URL(redirect || '').origin;
  } catch {
    /* validated below */
  }
  const result = schema.safeParse({
    ...env,
    SPOTIFY_REDIRECT_URI: redirect,
    APP_ORIGIN: env.APP_ORIGIN || defaultOrigin,
    TOKEN_ENCRYPTION_KEY_ID: keyId,
    TOKEN_ENCRYPTION_KEYS: keyRing,
  });
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  const config = result.data;
  if (new URL(config.SPOTIFY_REDIRECT_URI).origin !== config.APP_ORIGIN) {
    throw new Error(
      'SPOTIFY_REDIRECT_URI must use APP_ORIGIN for browser session cookies',
    );
  }
  let keys: unknown;
  try {
    keys = JSON.parse(config.TOKEN_ENCRYPTION_KEYS);
  } catch {
    /* validated below */
  }
  const keySchema = z.record(
    z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    z.string().refine((value) => {
      const decoded = Buffer.from(value, 'base64');
      return decoded.length === 32 && decoded.toString('base64') === value;
    }),
  );
  const parsed = keySchema.safeParse(keys);
  if (
    !parsed.success ||
    !Object.hasOwn(parsed.data, config.TOKEN_ENCRYPTION_KEY_ID)
  ) {
    throw new Error('Invalid environment configuration: TOKEN_ENCRYPTION_KEYS');
  }
  const production = env.NODE_ENV === 'production';
  if (
    production &&
    (!config.SPOTIFY_REDIRECT_URI.startsWith('https:') ||
      !config.APP_ORIGIN.startsWith('https:'))
  ) {
    throw new Error('Production Spotify authentication requires HTTPS');
  }
  return {
    clientId: config.SPOTIFY_CLIENT_ID,
    clientSecret: config.SPOTIFY_CLIENT_SECRET,
    redirectUri: config.SPOTIFY_REDIRECT_URI,
    appOrigin: config.APP_ORIGIN,
    databaseUrl: config.DATABASE_URL,
    keyId: config.TOKEN_ENCRYPTION_KEY_ID,
    keys: Object.fromEntries(
      Object.entries(parsed.data).map(([id, value]) => [
        id,
        Buffer.from(value, 'base64'),
      ]),
    ),
    secureCookies: production || config.APP_ORIGIN.startsWith('https:'),
  };
}
export type AuthConfig = NonNullable<ReturnType<typeof readAuthConfig>>;
