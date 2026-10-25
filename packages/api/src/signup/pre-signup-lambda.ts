import { checkSignup, parsePolicy } from './policy.js';

interface PreSignUpEvent {
  triggerSource: string;
  request: {
    userAttributes: Record<string, string>;
    validationData?: Record<string, string> | null;
    clientMetadata?: Record<string, string> | null;
  };
  response: Record<string, unknown>;
}

const policy = parsePolicy(process.env);

/**
 * Cognito pre-sign-up trigger, attached only when the stack's signupMode is
 * `allowlist` or `invite`. Throwing rejects the sign-up; Cognito returns the
 * message to the client as "PreSignUp failed with error <message>".
 *
 * Users created by an administrator (AdminCreateUser) are always allowed, so
 * operators can still add people by hand.
 */
export async function handler(event: PreSignUpEvent): Promise<PreSignUpEvent> {
  if (event.triggerSource === 'PreSignUp_AdminCreateUser') return event;
  const inviteCode = event.request.validationData?.inviteCode ?? event.request.clientMetadata?.inviteCode;
  const decision = checkSignup(policy, event.request.userAttributes.email, inviteCode);
  if (!decision.ok) throw new Error(decision.reason);
  return event;
}
