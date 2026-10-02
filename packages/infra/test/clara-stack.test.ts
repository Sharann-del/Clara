import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ClaraStack } from '../lib/clara-stack';

function synth(): Template {
  const app = new App();
  const stack = new ClaraStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

describe('ClaraStack skeleton', () => {
  const template = synth();

  it('creates one VPC with a single NAT gateway', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
  });

  it('creates a private S3 bucket and a CloudFront distribution', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  it('creates an ECS cluster', () => {
    template.resourceCountIs('AWS::ECS::Cluster', 1);
  });

  it('creates a single-AZ db.t4g.micro Postgres instance that is not public', () => {
    template.resourceCountIs('AWS::RDS::DBInstance', 1);
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      DBInstanceClass: 'db.t4g.micro',
      MultiAZ: false,
      PubliclyAccessible: false,
    });
  });

  it('creates a Cognito user pool and client', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
  });

  it('has no ECS services or load balancers (MCP runs on Lambda to avoid fixed cost)', () => {
    template.resourceCountIs('AWS::ECS::Service', 0);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
  });

  it('exposes the MCP server as a /mcp route on the existing HTTP API, in the VPC, without Cognito access', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 2); // REST HTTP API + realtime WebSocket API
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'ANY /mcp' });
    const fns = template.findResources('AWS::Lambda::Function', {
      Properties: { Handler: 'index.handler', VpcConfig: Match.anyValue() },
    });
    const mcpFns = Object.values(fns).filter((f) => JSON.stringify(f).includes('DB_SECRET_ARN') && !JSON.stringify(f).includes('USER_POOL_ID'));
    // The MCP function and the migration runner both have a DB secret but no user pool; the REST API has both.
    expect(mcpFns.length).toBeGreaterThanOrEqual(2);
  });
});
