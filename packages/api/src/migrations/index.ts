import { sql as m0001 } from './0001_init.js';
import { sql as m0002 } from './0002_mcp.js';
import { sql as m0003 } from './0003_sharing.js';

// Ordered list of migrations, embedded as plain TS modules (not read from disk
// at runtime) so the exact same list works identically under tsx locally, in
// a bundled Lambda, and in the one-shot migration-trigger Lambda — no asset
// bundling of loose .sql files required.
export const migrations: { name: string; sql: string }[] = [
  { name: '0001_init', sql: m0001 },
  { name: '0002_mcp', sql: m0002 },
  { name: '0003_sharing', sql: m0003 },
];
