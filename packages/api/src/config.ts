export const config = {
  port: Number(process.env.PORT ?? 3001),
  awsRegion: process.env.AWS_REGION ?? 'eu-north-1',

  // Set for deployed environments (Lambda / migration trigger); the DB
  // connection is resolved from this secret at runtime, never from a
  // plaintext connection string checked into code.
  dbSecretArn: process.env.DB_SECRET_ARN,
  dbName: process.env.DB_NAME ?? 'clara',

  // Local-dev-only escape hatch: point straight at a local Postgres instead
  // of resolving a Secrets Manager secret. Never set in deployed environments.
  databaseUrl: process.env.DATABASE_URL,

  userPoolId: process.env.USER_POOL_ID ?? '',
  userPoolClientId: process.env.USER_POOL_CLIENT_ID ?? '',

  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
};
