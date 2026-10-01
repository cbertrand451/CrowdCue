import { z } from 'zod';

const optionalValue = (value: unknown) => (value === '' ? undefined : value);
const schema = z.object({
  NODE_ENV: z.preprocess(
    optionalValue,
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  HOST: z.preprocess(optionalValue, z.string().min(1).default('127.0.0.1')),
  PORT: z.preprocess(
    optionalValue,
    z.coerce.number().int().min(1).max(65535).default(3000),
  ),
  LOG_LEVEL: z.preprocess(
    optionalValue,
    z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  ),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Report names only: configuration values may contain secrets.
    throw new Error(
      `Invalid environment configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  return result.data;
}
export type Config = ReturnType<typeof readConfig>;
