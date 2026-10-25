import * as path from 'node:path';
import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  AccountRecovery,
  OAuthScope,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolOperation,
} from 'aws-cdk-lib/aws-cognito';
import type { ClaraInfraConfig } from './config';

/**
 * Amazon Cognito User Pool (PRD section 4.1 / 6).
 *
 * v1 is email + password only. Google is listed as an OAuth IdP in the PRD but
 * wiring it needs real OAuth client secrets, so that's deferred — add a
 * `UserPoolIdentityProviderGoogle` here once the secret exists in Secrets
 * Manager, then append `UserPoolClientIdentityProvider.GOOGLE` to the client.
 */
export interface AuthProps {
  readonly config: ClaraInfraConfig;
  /** Extra callback/logout URLs beyond localhost — the deployed CloudFront URL, typically. */
  readonly additionalUrls?: string[];
}

export class Auth extends Construct {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;

  /** Pre-sign-up trigger; only present when signupMode is `allowlist` or `invite`. */
  readonly preSignUpFn?: NodejsFunction;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);
    const { config } = props;

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

    // Abuse control: with signupMode `allowlist` or `invite`, a pre-sign-up
    // trigger rejects anyone not on the list or without a valid code. It needs
    // no VPC and no permissions beyond logging. Off (no trigger) by default.
    if (config.signupMode !== 'open') {
      this.preSignUpFn = new NodejsFunction(this, 'PreSignUpFn', {
        entry: path.join(__dirname, '../../api/src/signup/pre-signup-lambda.ts'),
        handler: 'handler',
        runtime: Runtime.NODEJS_22_X,
        timeout: Duration.seconds(5),
        memorySize: 128,
        environment: {
          SIGNUP_MODE: config.signupMode,
          SIGNUP_ALLOWLIST: config.signupAllowlist.join(','),
          SIGNUP_INVITE_CODES: config.signupInviteCodes.join(','),
        },
        bundling: { minify: true, sourceMap: true, target: 'node22' },
      });
      this.userPool.addTrigger(UserPoolOperation.PRE_SIGN_UP, this.preSignUpFn);
    }

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
