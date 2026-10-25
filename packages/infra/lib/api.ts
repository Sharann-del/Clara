import * as path from 'node:path';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { ISecurityGroup, IVpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { CfnStage, CorsHttpMethod, HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { DatabaseInstance } from 'aws-cdk-lib/aws-rds';
import { Trigger } from 'aws-cdk-lib/triggers';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

export interface ApiProps {
  readonly vpc: IVpc;
  readonly securityGroup: ISecurityGroup;
  readonly dbSecret: ISecret;
  readonly dbInstance: DatabaseInstance;
  readonly dbName: string;
  readonly userPool: IUserPool;
  readonly userPoolClientId: string;
  readonly corsOrigins: string[];
  /** Steady-state requests per second for the whole HTTP API. */
  readonly throttleRate: number;
  /** Burst capacity for the whole HTTP API. */
  readonly throttleBurst: number;
}

/**
 * The Clara REST API (PRD section 6 "API compute").
 *
 * Deployed as a Lambda (Node 20) behind an HTTP API Gateway, rather than the
 * Fargate option the PRD also allows — chosen because building/pushing a
 * Fargate container image needs Docker, which isn't available in this dev
 * environment; Lambda bundles via esbuild with no container runtime needed.
 * The Lambda sits in the private subnets on the shared app security group,
 * which `Database` already grants ingress to on 5432.
 *
 * A second, one-shot Lambda (`TriggerFunction`) runs the SQL migrations in
 * @clara/api/migrations against RDS on every `cdk deploy` — it's the only
 * thing in this VPC that can reach the DB from outside a running Lambda, so
 * it doubles as the migration runner.
 */
export class Api extends Construct {
  readonly httpApi: HttpApi;
  readonly fn: NodejsFunction;
  /** One-shot migration runner; anything reading the new tables must depend on it. */
  readonly migrateTrigger: Trigger;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    const apiEntry = path.join(__dirname, '../../api/src/lambda.ts');
    const migrateEntry = path.join(__dirname, '../../api/src/migrate-lambda.ts');

    const vpcSubnets = { subnetType: SubnetType.PRIVATE_WITH_EGRESS };
    const bundling = { minify: true, sourceMap: true, target: 'node22' };

    const migrateFn = new NodejsFunction(this, 'MigrateFn', {
      entry: migrateEntry,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(90),
      memorySize: 256,
      vpc: props.vpc,
      vpcSubnets,
      securityGroups: [props.securityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        DB_NAME: props.dbName,
      },
      bundling,
    });
    props.dbSecret.grantRead(migrateFn);

    this.migrateTrigger = new Trigger(this, 'MigrateTrigger', {
      handler: migrateFn,
      timeout: Duration.seconds(90),
      executeAfter: [props.dbInstance],
    });

    this.fn = new NodejsFunction(this, 'Fn', {
      entry: apiEntry,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(20),
      memorySize: 512,
      vpc: props.vpc,
      vpcSubnets,
      securityGroups: [props.securityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        DB_NAME: props.dbName,
        USER_POOL_ID: props.userPool.userPoolId,
        USER_POOL_CLIENT_ID: props.userPoolClientId,
        CORS_ORIGINS: props.corsOrigins.join(','),
      },
      bundling,
    });
    props.dbSecret.grantRead(this.fn);
    this.fn.node.addDependency(this.migrateTrigger);

    // routes/workspaces.ts resolves an invited member's email to a Cognito
    // sub via ListUsers — scoped to just this one user pool and action.
    this.fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['cognito-idp:ListUsers'],
        resources: [props.userPool.userPoolArn],
      }),
    );

    this.httpApi = new HttpApi(this, 'HttpApi', {
      apiName: 'clara-api',
      corsPreflight: {
        allowOrigins: props.corsOrigins,
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [CorsHttpMethod.ANY],
      },
      defaultIntegration: new HttpLambdaIntegration('DefaultIntegration', this.fn),
    });

    // Abuse control: stage-wide throttling, so a leaked token or a script
    // can't run up the Lambda bill or starve other users. Requests over the
    // limit get 429 from API Gateway without invoking a Lambda. Set on the
    // auto-created $default stage in place, so existing deployments keep
    // their stage and URL.
    const defaultStage = this.httpApi.defaultStage!.node.defaultChild as CfnStage;
    defaultStage.defaultRouteSettings = {
      throttlingRateLimit: props.throttleRate,
      throttlingBurstLimit: props.throttleBurst,
    };
  }
}
