/**
 * Sign-up restriction checked by the Cognito pre-sign-up trigger
 * (pre-signup-lambda.ts). The mode and its values come from CDK context
 * (signupMode, signupAllowlist, signupInviteCodes); see docs/configuration.md.
 */
export type SignupMode = 'open' | 'allowlist' | 'invite';

export interface SignupPolicy {
  mode: SignupMode;
  /** Lower-cased emails (`ada@example.com`) and domains (`@example.com`). */
  allowlist: string[];
  inviteCodes: string[];
}

export type SignupDecision = { ok: true } | { ok: false; reason: string };

export function parsePolicy(env: Record<string, string | undefined>): SignupPolicy {
  const split = (v: string | undefined) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const mode = env.SIGNUP_MODE === 'allowlist' || env.SIGNUP_MODE === 'invite' ? env.SIGNUP_MODE : 'open';
  return {
    mode,
    allowlist: split(env.SIGNUP_ALLOWLIST).map((s) => s.toLowerCase()),
    inviteCodes: split(env.SIGNUP_INVITE_CODES),
  };
}

export function checkSignup(
  policy: SignupPolicy,
  email: string | undefined,
  inviteCode: string | undefined,
): SignupDecision {
  if (policy.mode === 'open') return { ok: true };

  if (policy.mode === 'allowlist') {
    const normalized = (email ?? '').trim().toLowerCase();
    const at = normalized.lastIndexOf('@');
    if (at <= 0) return { ok: false, reason: 'Sign-ups are limited to approved email addresses.' };
    const domain = normalized.slice(at);
    const allowed = policy.allowlist.includes(normalized) || policy.allowlist.includes(domain);
    return allowed ? { ok: true } : { ok: false, reason: 'Sign-ups are limited to approved email addresses.' };
  }

  const code = (inviteCode ?? '').trim();
  if (!code) return { ok: false, reason: 'An invite code is required to create an account.' };
  return policy.inviteCodes.includes(code) ? { ok: true } : { ok: false, reason: 'That invite code isn’t valid.' };
}
