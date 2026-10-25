import {
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  CognitoUserSession,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js';

const userPool = new CognitoUserPool({
  UserPoolId: import.meta.env.VITE_USER_POOL_ID,
  ClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
});

/** True when the deployment only accepts sign-ups with an invite code (CDK `signupMode=invite`). */
export const inviteCodeRequired = import.meta.env.VITE_SIGNUP_INVITE_REQUIRED === 'true';

export function signUp(email: string, password: string, inviteCode?: string): Promise<void> {
  // Validation data reaches the pre-sign-up trigger only; Cognito doesn't store it.
  const validationData = inviteCode ? [new CognitoUserAttribute({ Name: 'inviteCode', Value: inviteCode })] : [];
  return new Promise((resolve, reject) => {
    userPool.signUp(email, password, [], validationData, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function resendConfirmationCode(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  return new Promise((resolve, reject) => {
    user.resendConfirmationCode((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function signIn(email: string, password: string): Promise<CognitoUserSession> {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  const authDetails = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
    });
  });
}

export function signOut(): void {
  userPool.getCurrentUser()?.signOut();
}

export function getCurrentSession(): Promise<CognitoUserSession | null> {
  const user = userPool.getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err) reject(err);
      else resolve(session);
    });
  });
}

export function getCurrentUserEmail(): string | null {
  return userPool.getCurrentUser()?.getUsername() ?? null;
}

export function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const user = userPool.getCurrentUser();
  if (!user) return Promise.reject(new Error('You’re signed out. Sign in again first.'));
  return new Promise((resolve, reject) => {
    user.getSession((err: Error | null) => {
      if (err) return reject(err);
      user.changePassword(oldPassword, newPassword, (e) => (e ? reject(e) : resolve()));
    });
  });
}
