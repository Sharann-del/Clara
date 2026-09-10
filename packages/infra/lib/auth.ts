import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  AccountRecovery,
  OAuthScope,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';
import { config } from './config';

/**
 * Amazon Cognito User Pool (PRD section 4.1 / 6).
 *
 * v1 is email + password only. Google is listed as an OAuth IdP in the PRD but
 * wiring it needs real OAuth client secrets, so that's deferred — add a
 * `UserPoolIdentityProviderGoogle` here once the secret exists in Secrets
 * Manager, then append `UserPoolClientIdentityProvider.GOOGLE` to the client.
 */
export interface AuthProps {
  /** Extra callback/logout URLs beyond localhost — the deployed CloudFront URL, typically. */
  readonly additionalUrls?: string[];
}

export class Auth extends Construct {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthProps = {}) {
    super(scope, id);

    const urls = ['http://localhost:5173', ...(props.additionalUrls ?? [])];

    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: 'clara',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 10,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(7),
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      removalPolicy: config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    this.userPoolClient = new UserPoolClient(this, 'WebClient', {
      userPool: this.userPool,
      userPoolClientName: 'clara-web',
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE],
        callbackUrls: urls,
        logoutUrls: urls,
      },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });
  }
}
