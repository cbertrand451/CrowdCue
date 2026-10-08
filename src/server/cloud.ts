import { readAuthConfig } from './auth/config.js';
import { readConfig } from './config.js';

/** Resolve hosting defaults without accepting browser-controlled Host headers. */
export function cloudEnvironment(env: NodeJS.ProcessEnv) {
  const origin = env.APP_ORIGIN || env.RENDER_EXTERNAL_URL;
  const result = {
    ...env,
    NODE_ENV: 'production',
    HOST: env.HOST || '0.0.0.0',
    SPOTIFY_AUTH_ENABLED: env.SPOTIFY_AUTH_ENABLED || 'true',
    APP_ORIGIN: origin,
    SPOTIFY_REDIRECT_URI:
      env.SPOTIFY_REDIRECT_URI ||
      env.SPOTIFY_REDIRECT_URL ||
      (origin ? `${origin}/api/auth/spotify/callback` : undefined),
  };
  readConfig(result);
  if (!readAuthConfig(result))
    throw new Error('Cloud hosting requires SPOTIFY_AUTH_ENABLED=true');
  return result;
}
