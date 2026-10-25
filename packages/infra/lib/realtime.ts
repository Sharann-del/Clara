import * as path from 'node:path';
import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { GatewayVpcEndpointAwsService, ISecurityGroup, IVpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import type { ClaraInfraConfig } from './config';

export interface RealtimeProps {
  readonly config: ClaraInfraConfig;
  readonly vpc: IVpc;
  readonly securityGroup: ISecurityGroup;
  readonly dbSecret: ISecret;
  readonly dbName: string;
  readonly userPoolId: string;
  readonly userPoolClientId: string;
}

/**
 * Real-time collaboration (PRD section 6 "Realtime" / 4.10, milestone 2).
 *
 * API Gateway WebSocket API + 3 Lambdas ($connect/$disconnect/$default), all
 * sharing @clara/api's DB pool and authz helpers. Active connections live in
 * a DynamoDB table keyed by connectionId, with a RoomIndex GSI
 * (`room = "<resourceType>#<resourceId>"`) used to fan out broadcasts to
 * everyone viewing the same document/diagram.
 *
 * Conflict resolution strategy for diagram_elements (per-element
 * last-write-wins, no CRDT) is documented in
 * @clara/api/src/ws/message-lambda.ts.
 */
export class Realtime extends Construct {
  readonly connectionsTable: Table;
  readonly webSocketApi: WebSocketApi;
  readonly webSocketStage: WebSocketStage;

  constructor(scope: Construct, id: string, props: RealtimeProps) {
    super(scope, id);
    const { config } = props;

    this.connectionsTable = new Table(this, 'Connections', {
      partitionKey: { name: 'connectionId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'RoomIndex',
      partitionKey: { name: 'room', type: AttributeType.STRING },
      sortKey: { name: 'connectionId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
    // Counts one user's open connections for wsMaxConnectionsPerUser.
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'UserIndex',
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'connectionId', type: AttributeType.STRING },
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: ['expiresAt'],
    });

    // Gateway endpoint: keeps DynamoDB traffic from these VPC Lambdas off the
    // NAT gateway (and off its per-GB charge) — DynamoDB gateway endpoints
    // are free.
    props.vpc.addGatewayEndpoint('DynamoDbEndpoint', {
      service: GatewayVpcEndpointAwsService.DYNAMODB,
    });

    const vpcSubnets = { subnetType: SubnetType.PRIVATE_WITH_EGRESS };
    const bundling = { minify: true, sourceMap: true, target: 'node22' };
    const commonEnv = {
      DB_SECRET_ARN: props.dbSecret.secretArn,
      DB_NAME: props.dbName,
      USER_POOL_ID: props.userPoolId,
      USER_POOL_CLIENT_ID: props.userPoolClientId,
      CONNECTIONS_TABLE: this.connectionsTable.tableName,
      WS_MAX_CONNECTIONS_PER_USER: String(config.wsMaxConnectionsPerUser),
      WS_MAX_CONNECTIONS_PER_ROOM: String(config.wsMaxConnectionsPerRoom),
    };

    const makeFn = (name: string, entry: string, timeoutSeconds = 15) => {
      const fn = new NodejsFunction(this, name, {
        entry: path.join(__dirname, entry),
        handler: 'handler',
        runtime: Runtime.NODEJS_22_X,
        timeout: Duration.seconds(timeoutSeconds),
        memorySize: 256,
        vpc: props.vpc,
        vpcSubnets,
        securityGroups: [props.securityGroup],
        environment: commonEnv,
        bundling,
      });
      props.dbSecret.grantRead(fn);
      this.connectionsTable.grantReadWriteData(fn);
      return fn;
    };

    const connectFn = makeFn('ConnectFn', '../../api/src/ws/connect-lambda.ts');
    const disconnectFn = makeFn('DisconnectFn', '../../api/src/ws/disconnect-lambda.ts');
    const defaultFn = makeFn('DefaultFn', '../../api/src/ws/message-lambda.ts', 20);

    this.webSocketApi = new WebSocketApi(this, 'WebSocketApi', {
      apiName: 'clara-realtime',
      connectRouteOptions: { integration: new WebSocketLambdaIntegration('ConnectIntegration', connectFn) },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('DisconnectIntegration', disconnectFn),
      },
      defaultRouteOptions: { integration: new WebSocketLambdaIntegration('DefaultIntegration', defaultFn) },
    });

    this.webSocketStage = new WebSocketStage(this, 'ProdStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
      // Abuse control: caps message throughput across the whole API.
      throttle: { rateLimit: config.wsThrottleRate, burstLimit: config.wsThrottleBurst },
    });

    // The $connect/$default Lambdas post messages back out over the same
    // connections (presence snapshots, broadcasts, error replies).
    this.webSocketApi.grantManageConnections(connectFn);
    this.webSocketApi.grantManageConnections(disconnectFn);
    this.webSocketApi.grantManageConnections(defaultFn);

    for (const fn of [connectFn, disconnectFn, defaultFn]) {
      fn.addEnvironment('WS_MANAGEMENT_ENDPOINT', this.webSocketStage.callbackUrl);
    }
  }
}
