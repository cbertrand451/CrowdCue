import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

export async function availablePort(port, host = '127.0.0.1') {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Choose a local port between 1024 and 65535.');
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(
        new Error(
          `Port ${port} is already in use. Stop the other app or change the local port.`,
        ),
      ),
    );
    server.listen(port, host, () => server.close(resolvePromise));
  });
}

export async function startLocalDatabase({
  directory = 'data/local',
  port = 55432,
} = {}) {
  await availablePort(port);
  directory = resolve(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const credentialFile = join(directory, 'database.json');
  try {
    await writeFile(
      credentialFile,
      JSON.stringify({ password: randomBytes(32).toString('hex') }),
      {
        flag: 'wx',
        mode: 0o600,
      },
    );
  } catch (error) {
    if (error.code !== 'EEXIST')
      throw new Error('Cannot create private local database settings.', {
        cause: error,
      });
  }
  let password;
  try {
    ({ password } = JSON.parse(await readFile(credentialFile, 'utf8')));
    if (typeof password !== 'string' || !/^[a-f0-9]{64}$/.test(password))
      throw new Error();
  } catch {
    throw new Error(
      'Local database settings are damaged. Restore data/local/database.json from your backup.',
    );
  }
  const databaseDir = join(directory, 'postgres');
  const database = new EmbeddedPostgres({
    databaseDir,
    port,
    user: 'crowdcue',
    password,
    persistent: true,
    authMethod: 'scram-sha-256',
    createPostgresUser: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // Loopback only; no global service, admin account, or database installation.
    postgresFlags: ['-h', '127.0.0.1', '-c', 'unix_socket_directories='],
    onLog: () => {},
    onError: () => {},
  });
  try {
    await access(join(databaseDir, 'PG_VERSION'));
  } catch {
    console.log('Preparing the bundled local database (first run only)…');
    await database.initialise();
  }
  await database.start();
  const admin = database.getPgClient('postgres', '127.0.0.1');
  try {
    await admin.connect();
    for (const name of ['crowdcue', 'crowdcue_test']) {
      if (
        !(
          await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [
            name,
          ])
        ).rowCount
      )
        await admin.query(`CREATE DATABASE ${name}`);
    }
  } catch {
    await database.stop();
    throw new Error(
      'Cannot prepare the local databases. Keep your data folder and check local port access.',
    );
  } finally {
    await admin.end();
  }
  const prefix = `postgresql://crowdcue:${password}@127.0.0.1:${port}/`;
  return {
    databaseUrl: prefix + 'crowdcue',
    testDatabaseUrl: prefix + 'crowdcue_test',
    stop: () => database.stop(),
  };
}
