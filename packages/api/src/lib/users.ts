import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { config } from '../config.js';
import { NotFoundError } from './authz.js';

// Cognito is the identity source (there is no users table), so people are resolved by email
// for invites/shares and back to emails for display. Small per-container cache.
const cognito = new CognitoIdentityProviderClient({ region: config.awsRegion });
const emailCache = new Map<string, string | undefined>();

const quote = (v: string) => v.replace(/["\\\\]/g, '');

export async function findUserIdByEmail(email: string): Promise<string> {
  const result = await cognito.send(
    new ListUsersCommand({
      UserPoolId: config.userPoolId,
      Filter: `email = "${quote(email.trim().toLowerCase())}"`,
      Limit: 1,
    }),
  );
  const sub = result.Users?.[0]?.Attributes?.find((a) => a.Name === 'sub')?.Value;
  if (!sub) throw new NotFoundError(`No Clara account uses ${email}. Ask them to sign up first.`);
  emailCache.set(sub, email.trim().toLowerCase());
  return sub;
}

export async function emailForUser(sub: string): Promise<string | undefined> {
  if (emailCache.has(sub)) return emailCache.get(sub);
  try {
    const r = await cognito.send(
      new ListUsersCommand({ UserPoolId: config.userPoolId, Filter: `sub = "${quote(sub)}"`, Limit: 1 }),
    );
    const email = r.Users?.[0]?.Attributes?.find((a) => a.Name === 'email')?.Value;
    emailCache.set(sub, email);
    return email;
  } catch {
    return undefined;
  }
}
