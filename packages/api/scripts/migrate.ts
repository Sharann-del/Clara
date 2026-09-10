import { runMigrations } from '../src/migrate.js';

const { applied } = await runMigrations();
if (applied.length === 0) {
  console.log('No pending migrations.');
} else {
  console.log(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
}
process.exit(0);
