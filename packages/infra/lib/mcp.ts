import * as path from 'node:path';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { ISecurityGroup, IVpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Trigger } from 'aws-cdk-lib/triggers';

export interface McpProps {
  readonly vpc: IVpc;
  readonly securityGroup: ISecurityGroup;
  readonly dbSecret: ISecret;
  readonly dbName: string;
  /** The existing Clara HTTP API — the MCP server is added to it as `POST /mcp`. */
  readonly httpApi: HttpApi;
  /** Schema migrations must have run first: the MCP server reads personal_access_tokens. */
  readonly migrateTrigger: Trigger;
}

/**
 * The Clara MCP server (PRD 4.11), streamable HTTP over a Lambda.
 *
 * Hosted as a Lambda on the existing HTTP API rather than a Fargate service +
 * ALB (the PRD's other option): it adds no fixed monthly cost (no always-on task,
 * no ALB), reuses the NAT/VPC/DB access the REST API already has, and the
 * stateless transport (one JSON response per POST) fits Lambda directly.
 *
 * It authenticates callers with Clara personal access tokens looked up in RDS —
 * not Cognito — so it needs no Cognito permissions, only the DB secret.
 */
export class McpServer extends Construct {
  readonly fn: NodejsFunction;

  constructor(scope: Construct, id: string, props: McpProps) {
    super(scope, id);

    this.fn = new NodejsFunction(this, 'Fn', {
      entry: path.join(__dirname, '../../mcp-server/src/lambda.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      // HTTP API integrations time out at 30s; stay just under so Lambda reports its own error.
      timeout: Duration.seconds(25),
      memorySize: 512,
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.securityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        DB_NAME: props.dbName,
      },
      bundling: { minify: true, sourceMap: true, target: 'node22' },
    });
    props.dbSecret.grantRead(this.fn);
    this.fn.node.addDependency(props.migrateTrigger);

    props.httpApi.addRoutes({
      path: '/mcp',
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration('McpIntegration', this.fn),
    });
  }
}
