import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Api } from './api';
import { Auth } from './auth';
import type { ClaraInfraConfig } from './config';
import { Compute } from './compute';
import { Database } from './database';
import { Frontend } from './frontend';
import { McpServer } from './mcp';
import { Network } from './network';
import { Realtime } from './realtime';

/**
 * Clara's infrastructure (PRD section 6).
 *
 * One stack composing concern-scoped constructs:
 *   - Network   : VPC with public + private subnets, one NAT instance (or gateway)
 *   - Frontend  : private S3 bucket + CloudFront distribution
 *   - Compute   : ECS Fargate cluster (currently unused — the milestone-4 MCP
 *                 server runs as a Lambda instead, to avoid an always-on task + ALB)
 *   - Database  : RDS PostgreSQL (single-AZ db.t4g.micro)
 *   - Auth      : Cognito User Pool + web client (email/password), optional sign-up restriction
 *   - Api       : REST API (Lambda + HTTP API Gateway) — milestone 1
 *   - Realtime  : WebSocket API + DynamoDB connections table — milestone 2
 *   - Mcp       : MCP server (Lambda, POST /mcp on the REST API's HTTP API) — milestone 4
 */
export interface ClaraStackProps extends StackProps {
  /** Resolved deploy-time settings; see lib/config.ts and docs/configuration.md. */
  readonly config: ClaraInfraConfig;
}

export class ClaraStack extends Stack {
  constructor(scope: Construct, id: string, props: ClaraStackProps) {
    super(scope, id, props);
    const { config } = props;

    const network = new Network(this, 'Network', { config });

    const frontend = new Frontend(this, 'Frontend', { config });

    const compute = new Compute(this, 'Compute', {
      vpc: network.vpc,
    });

    const database = new Database(this, 'Database', {
      config,
      vpc: network.vpc,
      clientSecurityGroup: network.appSecurityGroup,
    });

    const frontendUrl = `https://${frontend.distribution.distributionDomainName}`;

    const auth = new Auth(this, 'Auth', {
      config,
      additionalUrls: [frontendUrl, ...config.extraOrigins],
    });

    const api = new Api(this, 'Api', {
      vpc: network.vpc,
      securityGroup: network.appSecurityGroup,
      dbSecret: database.instance.secret!,
      dbInstance: database.instance,
      dbName: 'clara',
      userPool: auth.userPool,
      userPoolClientId: auth.userPoolClient.userPoolClientId,
      corsOrigins: [frontendUrl, ...config.extraOrigins, 'http://localhost:5173'],
      throttleRate: config.apiThrottleRate,
      throttleBurst: config.apiThrottleBurst,
    });

    const realtime = new Realtime(this, 'Realtime', {
      config,
      vpc: network.vpc,
      securityGroup: network.appSecurityGroup,
      dbSecret: database.instance.secret!,
      dbName: 'clara',
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.userPoolClient.userPoolClientId,
    });

    new McpServer(this, 'Mcp', {
      vpc: network.vpc,
      securityGroup: network.appSecurityGroup,
      dbSecret: database.instance.secret!,
      dbName: 'clara',
      httpApi: api.httpApi,
      migrateTrigger: api.migrateTrigger,
    });

    // --- Outputs: everything the app packages need to wire themselves up ---
    new CfnOutput(this, 'VpcId', { value: network.vpc.vpcId });
    new CfnOutput(this, 'AppSecurityGroupId', {
      value: network.appSecurityGroup.securityGroupId,
    });

    new CfnOutput(this, 'FrontendBucketName', {
      value: frontend.bucket.bucketName,
    });
    new CfnOutput(this, 'FrontendDistributionId', {
      value: frontend.distribution.distributionId,
    });
    new CfnOutput(this, 'FrontendUrl', {
      value: `https://${frontend.distribution.distributionDomainName}`,
    });

    new CfnOutput(this, 'EcsClusterName', {
      value: compute.cluster.clusterName,
    });
    new CfnOutput(this, 'EcsClusterArn', {
      value: compute.cluster.clusterArn,
    });

    new CfnOutput(this, 'DbEndpoint', {
      value: database.instance.dbInstanceEndpointAddress,
    });
    new CfnOutput(this, 'DbPort', {
      value: database.instance.dbInstanceEndpointPort,
    });
    new CfnOutput(this, 'DbCredentialsSecretArn', {
      value: database.credentialsSecretArn,
    });

    new CfnOutput(this, 'UserPoolId', { value: auth.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', {
      value: auth.userPoolClient.userPoolClientId,
    });

    new CfnOutput(this, 'ApiUrl', { value: api.httpApi.url! });
    new CfnOutput(this, 'McpUrl', { value: `${api.httpApi.url!}mcp` });
    new CfnOutput(this, 'WebSocketUrl', { value: realtime.webSocketStage.url });
  }
}
