/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_USER_POOL_ID: string;
  readonly VITE_USER_POOL_CLIENT_ID: string;
  readonly VITE_AWS_REGION: string;
  readonly VITE_SITE_URL: string;
  /** "true" when sign-ups need an invite code (CDK context signupMode=invite). */
  readonly VITE_SIGNUP_INVITE_REQUIRED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
