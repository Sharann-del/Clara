import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ClaraStack } from '../lib/clara-stack';
import { resolveConfig } from '../lib/config';

function synth(context: Record<string, unknown> = {}): Template {
  const app = new App({ context });
  const stack = new ClaraStack(app, 'TestStack', {
    config: resolveConfig(app.node),
    env: { account: '123456789012', region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

describe('ClaraStack with default settings', () => {
  const template = synth();

  it('creates one VPC whose private subnets egress through a single NAT instance, not a NAT gateway', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
    template.resourceCountIs('AWS::EC2::Instance', 1);
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't4g.nano',
      SourceDestCheck: false,
      CreditSpecification: { CPUCredits: 'standard' },
    });
    template.hasResourceProperties('AWS::EC2::Route', {
      DestinationCidrBlock: '0.0.0.0/0',
      InstanceId: Match.anyValue(),
    });
  });

  it('only lets traffic from inside the VPC into the NAT instance, and requires IMDSv2', () => {
    const groups = template.findResources('AWS::EC2::SecurityGroup', {
      Properties: { GroupDescription: 'Security Group for NAT instances' },
    });
    expect(Object.keys(groups)).toHaveLength(1);
    const ingress = (Object.values(groups)[0] as { Properties: { SecurityGroupIngress: { CidrIp: unknown }[] } })
      .Properties.SecurityGroupIngress;
    expect(ingress).toHaveLength(1);
    expect(ingress[0].CidrIp).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/^NetworkVpc/), 'CidrBlock'] });
    template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
      LaunchTemplateData: { MetadataOptions: { HttpTokens: 'required' } },
    });
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

  it('creates a Cognito user pool and client with open sign-up and no pre-sign-up trigger', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: Match.absent(),
    });
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
    const mcpFns = Object.values(fns).filter(
      (f) => JSON.stringify(f).includes('DB_SECRET_ARN') && !JSON.stringify(f).includes('USER_POOL_ID'),
    );
    // The MCP function and the migration runner both have a DB secret but no user pool; the REST API has both.
    expect(mcpFns.length).toBeGreaterThanOrEqual(2);
  });

  it('throttles the HTTP API stage', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      DefaultRouteSettings: { ThrottlingRateLimit: 50, ThrottlingBurstLimit: 100 },
    });
  });

  it('throttles the WebSocket stage and limits connections per user and per item', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: 'prod',
      DefaultRouteSettings: { ThrottlingRateLimit: 100, ThrottlingBurstLimit: 200 },
    });
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'UserIndex' })]),
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({ WS_MAX_CONNECTIONS_PER_USER: '10', WS_MAX_CONNECTIONS_PER_ROOM: '25' }),
      },
    });
  });
});

describe('ClaraStack context flags', () => {
  it('natMode=gateway uses one managed NAT gateway and no instance', () => {
    const template = synth({ natMode: 'gateway' });
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
    template.resourceCountIs('AWS::EC2::Instance', 0);
  });

  it('signupMode=invite attaches a pre-sign-up trigger outside the VPC with the codes', () => {
    const template = synth({ signupMode: 'invite', signupInviteCodes: 'spring-cohort-7,design-review' });
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: { PreSignUp: Match.anyValue() },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      VpcConfig: Match.absent(),
      Environment: {
        Variables: {
          SIGNUP_MODE: 'invite',
          SIGNUP_ALLOWLIST: '',
          SIGNUP_INVITE_CODES: 'spring-cohort-7,design-review',
        },
      },
    });
  });

  it('signupMode=allowlist passes the lower-cased allowlist to the trigger', () => {
    const template = synth({ signupMode: 'allowlist', signupAllowlist: ['Ada@Example.com', '@team.example.net'] });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          SIGNUP_MODE: 'allowlist',
          SIGNUP_ALLOWLIST: 'ada@example.com,@team.example.net',
        }),
      },
    });
  });

  it('rejects a restricted sign-up mode with nothing to check against', () => {
    expect(() => synth({ signupMode: 'invite' })).toThrow(/signupInviteCodes/);
    expect(() => synth({ signupMode: 'allowlist' })).toThrow(/signupAllowlist/);
    expect(() => synth({ signupMode: 'closed' })).toThrow(/signupMode/);
  });

  it('applies custom throttling and connection limits', () => {
    const template = synth({ apiThrottleRate: 10, apiThrottleBurst: 20, wsMaxConnectionsPerUser: 3 });
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ WS_MAX_CONNECTIONS_PER_USER: '3' }) },
    });
  });

  it('adds extra origins to CORS', () => {
    const template = synth({ extraOrigins: 'https://clara.example.com/' });
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: { AllowOrigins: Match.arrayWith(['https://clara.example.com']) },
    });
  });
});
