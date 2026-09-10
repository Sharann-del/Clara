import { runMigrations } from './migrate.js';

// Entry point for the CDK `TriggerFunction` (see @clara/infra lib/api.ts) —
// invoked once per `cdk deploy` after the DB is up, from inside the VPC.
export async function handler(): Promise<void> {
  const { applied } = await runMigrations();
  console.log(applied.length === 0 ? 'No pending migrations.' : `Applied: ${applied.join(', ')}`);
}
