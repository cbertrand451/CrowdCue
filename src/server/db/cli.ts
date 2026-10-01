import { createDatabase } from './index.js';
import { migrate } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error('Set DATABASE_URL to a PostgreSQL connection URL.');
  process.exitCode = 1;
} else {
  const pool = createDatabase(url);
  try {
    const completed = await migrate(pool);
    console.log(
      completed.length
        ? `Applied migrations: ${completed.join(', ')}`
        : 'Database is up to date.',
    );
  } catch {
    // Driver errors and connection URLs may contain credentials.
    console.error(
      'Database migration failed; check connectivity and migration history.',
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
