import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Api } from './api';
import { Auth } from './auth';
import { Compute } from './compute';
import { Database } from './database';
import { Frontend } from './frontend';
import { Network } from './network';

/**
 * Clara's infrastructure skeleton (PRD section 6).
 *
 * One stack composing five concern-scoped constructs:
 *   - Network   : VPC with public + private subnets, one NAT gateway
 *   - Frontend  : private S3 bucket + CloudFront distribution
 *   - Compute   : ECS Fargate cluster (no services yet)
 *   - Database  : RDS PostgreSQL (single-AZ db.t4g.micro)
 *   - Auth      : Cognito User Pool + web client (email/password)
 *
 * No application logic — this is the empty target to deploy to from day one.
 */
export class ClaraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const network = new Network(this, 'Network');

    const frontend = new Frontend(this, 'Frontend');

    const compute = new Compute(this, 'Compute', {
      vpc: network.vpc,
    });

    const database = new Database(this, 'Database', {
      vpc: network.vpc,
      clientSecurityGroup: network.appSecurityGroup,
    });

    const frontendUrl = `https://${frontend.distribution.distributionDomainName}`;

    const auth = new Auth(this, 'Auth', {
      additionalUrls: [frontendUrl],
    });

    const api = new Api(this, 'Api', {
      vpc: network.vpc,
      securityGroup: network.appSecurityGroup,
      dbSecret: database.instance.secret!,
      dbInstance: database.instance,
      dbName: 'clara',
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.userPoolClient.userPoolClientId,
      corsOrigins: [frontendUrl, 'http://localhost:5173'],
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
  }
}
