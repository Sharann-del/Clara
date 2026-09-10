import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';
import { config } from './config.js';

interface RdsSecret {
  username: string;
  password: string;
  host: string;
  port: number;
  dbname?: string;
}

let poolPromise: Promise<pg.Pool> | undefined;

async function resolvePoolConfig(): Promise<pg.PoolConfig> {
  if (config.databaseUrl) {
    // Local dev only — see config.ts.
    return { connectionString: config.databaseUrl };
  }

  if (!config.dbSecretArn) {
    throw new Error('DB_SECRET_ARN is not set and no DATABASE_URL fallback was provided');
  }

  const client = new SecretsManagerClient({ region: config.awsRegion });
  const result = await client.send(new GetSecretValueCommand({ SecretId: config.dbSecretArn }));
  if (!result.SecretString) {
    throw new Error(`Secret ${config.dbSecretArn} has no SecretString`);
  }
  const secret = JSON.parse(result.SecretString) as RdsSecret;

  return {
    host: secret.host,
    port: secret.port,
    user: secret.username,
    password: secret.password,
    database: secret.dbname ?? config.dbName,
    max: 5,
    ssl: { rejectUnauthorized: false },
  };
}

/** Lazily-initialized, process-wide pool — resolved once, reused across requests/invocations. */
export function getPool(): Promise<pg.Pool> {
  if (!poolPromise) {
    poolPromise = resolvePoolConfig().then((poolConfig) => new pg.Pool(poolConfig));
  }
  return poolPromise;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const pool = await getPool();
  return pool.query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
