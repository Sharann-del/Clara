import { createHash, randomBytes } from 'node:crypto';
import { query } from '../db.js';
import { BadRequestError, NotFoundError } from './authz.js';

// Personal access tokens (PRD 4.11): how an MCP client authenticates as a Clara
// user. A token carries no permissions of its own — every request resolves the
// owning user's *current* workspace roles, so demoting or removing someone
// immediately limits their tokens too.

const PREFIX = 'clara_pat_';
const MAX_ACTIVE_TOKENS_PER_USER = 20;
export const DEFAULT_TOKEN_TTL_DAYS = 90;

const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

export interface TokenRow {
  id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

const PUBLIC_COLS = 'id, name, token_prefix, created_at, expires_at, last_used_at, revoked_at';

/** Returns the plaintext token exactly once — only its sha256 is stored. */
export async function createToken(userId: string, name: string, expiresInDays: number | null) {
  const { rows: active } = await query<{ n: string }>(
    `select count(*) as n from personal_access_tokens
      where user_id = $1 and revoked_at is null and (expires_at is null or expires_at > now())`,
    [userId],
  );
  if (Number(active[0].n) >= MAX_ACTIVE_TOKENS_PER_USER) {
    throw new BadRequestError(`At most ${MAX_ACTIVE_TOKENS_PER_USER} active tokens; revoke one first`);
  }

  const token = PREFIX + randomBytes(32).toString('base64url');
  const { rows } = await query<TokenRow>(
    `insert into personal_access_tokens (user_id, name, token_prefix, token_hash, expires_at)
     values ($1, $2, $3, $4, case when $5::int is null then null else now() + make_interval(days => $5::int) end)
     returning ${PUBLIC_COLS}`,
    [userId, name, token.slice(0, PREFIX.length + 6), hashToken(token), expiresInDays],
  );
  return { token, ...rows[0] };
}

export async function listTokens(userId: string) {
  const { rows } = await query<TokenRow>(
    `select ${PUBLIC_COLS} from personal_access_tokens where user_id = $1 order by created_at desc`,
    [userId],
  );
  return rows;
}

export async function revokeToken(userId: string, id: string) {
  const { rowCount } = await query(
    'update personal_access_tokens set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null',
    [id, userId],
  );
  if (!rowCount) throw new NotFoundError('Token not found');
}

/** Resolves a presented bearer token to its owner, or undefined if unknown/revoked/expired. */
export async function authenticateToken(raw: string): Promise<{ userId: string; tokenId: string } | undefined> {
  if (!raw.startsWith(PREFIX)) return undefined;
  const { rows } = await query<{ id: string; user_id: string; last_used_at: string | null }>(
    `select id, user_id, last_used_at from personal_access_tokens
      where token_hash = $1 and revoked_at is null and (expires_at is null or expires_at > now())`,
    [hashToken(raw)],
  );
  const row = rows[0];
  if (!row) return undefined;
  // Best-effort, throttled to once a minute so busy MCP sessions don't write on every call.
  await query(
    `update personal_access_tokens set last_used_at = now()
      where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')`,
    [row.id],
  ).catch(() => undefined);
  return { userId: row.user_id, tokenId: row.id };
}
