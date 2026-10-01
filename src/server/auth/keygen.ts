import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// A local-development helper. Never overwrite a key used for existing credentials.
try {
  await writeFile(
    '.env.token-key',
    `TOKEN_ENCRYPTION_KEY_ID=v1\nTOKEN_ENCRYPTION_KEYS='${JSON.stringify({ v1: randomBytes(32).toString('base64') })}'\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Created the ignored local token key file. Keep it private and preserve it across restarts.',
  );
} catch {
  console.error(
    'Token key file was not created. Check whether .env.token-key already exists; existing keys are never overwritten.',
  );
  process.exitCode = 1;
}
