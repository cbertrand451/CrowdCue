import { createDatabase } from './index.js';
import { migrate } from './migrate.js';
import { databaseFailure } from './diagnostics.js';

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error('Set DATABASE_URL to a PostgreSQL connection URL.');
  process.exitCode = 1;
} else {
  let pool: ReturnType<typeof createDatabase> | undefined;
  try {
    pool = createDatabase(url);
    const completed = await migrate(pool);
    console.log(
      completed.length
        ? `Applied migrations: ${completed.join(', ')}`
        : 'Database is up to date.',
    );
  } catch (error) {
    // Driver errors and connection URLs may contain credentials.
    console.error(`Database migration failed: ${databaseFailure(error)}`);
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
