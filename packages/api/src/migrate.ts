import { getPool } from './db.js';
import { migrations } from './migrations/index.js';

export async function runMigrations(): Promise<{ applied: string[] }> {
  const pool = await getPool();

  await pool.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows } = await pool.query<{ name: string }>('select name from schema_migrations');
  const already = new Set(rows.map((r) => r.name));

  const applied: string[] = [];
  for (const migration of migrations) {
    if (already.has(migration.name)) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(migration.sql);
      await client.query('insert into schema_migrations (name) values ($1)', [migration.name]);
      await client.query('commit');
      applied.push(migration.name);
    } catch (err) {
      await client.query('rollback');
      throw new Error(`Migration ${migration.name} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
  }

  return { applied };
}
