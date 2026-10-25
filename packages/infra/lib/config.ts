import { Node } from 'constructs';
import { InstanceClass, InstanceSize, InstanceType } from 'aws-cdk-lib/aws-ec2';

/**
 * Every deploy-time knob on the stack, resolved from CDK context.
 *
 * Defaults keep a fresh deployment cheap and open, so a fork deploys with no
 * configuration. Override any value with `-c key=value` on the command line or
 * in `cdk.context.json` (gitignored, so account-specific settings stay local).
 * docs/configuration.md lists them all.
 */
export type NatMode = 'instance' | 'gateway';
export type SignupMode = 'open' | 'allowlist' | 'invite';

export interface ClaraInfraConfig {
  /** Deployment region. The CDK CLI fills CDK_DEFAULT_REGION from the active AWS profile. */
  readonly region: string;

  /** AZs to spread the VPC across. 2 is the minimum for an RDS subnet group. */
  readonly maxAzs: number;

  /**
   * How the private subnets reach AWS APIs on the internet (Secrets Manager,
   * Cognito, the WebSocket management API).
   *   - `instance` (default): one t4g.nano NAT instance, about $3/month plus its public IPv4.
   *   - `gateway`: one managed NAT gateway, about $34/month plus its public IPv4.
   */
  readonly natMode: NatMode;

  /** Instance type for the NAT instance when natMode is `instance`. */
  readonly natInstanceType: InstanceType;

  /** RDS instance type. t4g.micro: 2 vCPU burstable / 1 GB RAM. */
  readonly dbInstanceType: InstanceType;

  /** RDS storage in GB. */
  readonly dbAllocatedStorageGb: number;

  /** Multi-AZ doubles the DB cost. */
  readonly dbMultiAz: boolean;

  /**
   * When true, stateful resources (RDS, S3, Cognito, DynamoDB) are retained on
   * `cdk destroy` and RDS gets deletion protection and 7-day backups. Turn on
   * before storing data you care about.
   */
  readonly retainData: boolean;

  /**
   * Who may create an account.
   *   - `open` (default): anyone with an email address.
   *   - `allowlist`: only emails in `signupAllowlist`.
   *   - `invite`: only sign-ups that present one of `signupInviteCodes`.
   */
  readonly signupMode: SignupMode;

  /** Allowed emails (`ada@example.com`) and whole domains (`@example.com`). */
  readonly signupAllowlist: string[];

  /** Accepted invite codes, compared case-sensitively. */
  readonly signupInviteCodes: string[];

  /** Steady-state requests per second across the whole HTTP API (REST + MCP). */
  readonly apiThrottleRate: number;

  /** Burst capacity for the HTTP API. */
  readonly apiThrottleBurst: number;

  /** Steady-state messages per second across the whole WebSocket API. */
  readonly wsThrottleRate: number;

  /** Burst capacity for the WebSocket API. */
  readonly wsThrottleBurst: number;

  /** Open WebSocket connections one user may hold at once (one per open tab and item). */
  readonly wsMaxConnectionsPerUser: number;

  /** Open WebSocket connections allowed on a single document or diagram. */
  readonly wsMaxConnectionsPerRoom: number;

  /** Extra browser origins allowed by CORS and Cognito callbacks, such as a custom domain. */
  readonly extraOrigins: string[];
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function positiveInt(node: Node, key: string, fallback: number): number {
  const raw = node.tryGetContext(key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Context "${key}" must be a positive integer, got ${JSON.stringify(raw)}`);
  return n;
}

function oneOf<T extends string>(node: Node, key: string, allowed: readonly T[], fallback: T): T {
  const raw = node.tryGetContext(key);
  if (raw === undefined) return fallback;
  if (!allowed.includes(raw)) throw new Error(`Context "${key}" must be one of ${allowed.join(', ')}, got ${JSON.stringify(raw)}`);
  return raw as T;
}

function instanceType(node: Node, key: string, fallback: InstanceType): InstanceType {
  const raw = node.tryGetContext(key);
  return raw === undefined ? fallback : new InstanceType(String(raw));
}

export function resolveConfig(node: Node): ClaraInfraConfig {
  const signupMode = oneOf(node, 'signupMode', ['open', 'allowlist', 'invite'] as const, 'open');
  const signupAllowlist = list(node.tryGetContext('signupAllowlist')).map((s) => s.toLowerCase());
  const signupInviteCodes = list(node.tryGetContext('signupInviteCodes'));
  if (signupMode === 'allowlist' && signupAllowlist.length === 0) {
    throw new Error('signupMode=allowlist needs at least one entry in the "signupAllowlist" context value');
  }
  if (signupMode === 'invite' && signupInviteCodes.length === 0) {
    throw new Error('signupMode=invite needs at least one code in the "signupInviteCodes" context value');
  }

  return {
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
    maxAzs: 2,
    natMode: oneOf(node, 'natMode', ['instance', 'gateway'] as const, 'instance'),
    natInstanceType: instanceType(node, 'natInstanceType', InstanceType.of(InstanceClass.BURSTABLE4_GRAVITON, InstanceSize.NANO)),
    dbInstanceType: instanceType(node, 'dbInstanceType', InstanceType.of(InstanceClass.BURSTABLE4_GRAVITON, InstanceSize.MICRO)),
    dbAllocatedStorageGb: positiveInt(node, 'dbAllocatedStorageGb', 20),
    dbMultiAz: bool(node.tryGetContext('dbMultiAz'), false),
    retainData: bool(node.tryGetContext('retainData'), false),
    signupMode,
    signupAllowlist,
    signupInviteCodes,
    apiThrottleRate: positiveInt(node, 'apiThrottleRate', 50),
    apiThrottleBurst: positiveInt(node, 'apiThrottleBurst', 100),
    wsThrottleRate: positiveInt(node, 'wsThrottleRate', 100),
    wsThrottleBurst: positiveInt(node, 'wsThrottleBurst', 200),
    wsMaxConnectionsPerUser: positiveInt(node, 'wsMaxConnectionsPerUser', 10),
    wsMaxConnectionsPerRoom: positiveInt(node, 'wsMaxConnectionsPerRoom', 25),
    extraOrigins: list(node.tryGetContext('extraOrigins')).map((o) => o.replace(/\/$/, '')),
  };
}
