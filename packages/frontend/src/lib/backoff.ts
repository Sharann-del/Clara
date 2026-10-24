const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

/** Full-jitter exponential backoff: random in [0, min(max, base * 2^attempt)], floored at base/2. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.max(BACKOFF_BASE_MS / 2, Math.round(random() * cap));
}
