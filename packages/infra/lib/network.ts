import { Construct } from 'constructs';
import { Aspects } from 'aws-cdk-lib';
import {
  CpuCredits,
  InstanceRequireImdsv2Aspect,
  IpAddresses,
  NatProvider,
  NatTrafficDirection,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import type { ClaraInfraConfig } from './config';

export interface NetworkProps {
  readonly config: ClaraInfraConfig;
}

/**
 * The single VPC for Clara (PRD section 6, "Networking").
 *
 * - Public subnets: the NAT (instance or gateway) and nothing else.
 * - Private subnets (with egress): every Lambda and RDS.
 *
 * The private Lambdas need outbound access to Secrets Manager, Cognito (JWKS,
 * ListUsers) and the WebSocket management API. By default that goes through a
 * single t4g.nano NAT instance (Amazon Linux 2023, configured by CDK's
 * NatProvider.instanceV2) instead of a managed NAT gateway: about $3/month of
 * compute against about $34. The instance has no SSH key, requires IMDSv2,
 * runs on standard (capped) CPU credits, and only accepts traffic from inside
 * the VPC. Set the `natMode` context value to `gateway` for the managed
 * option. Interface endpoints were rejected: three services across two AZs
 * cost more than the NAT gateway, and a private-DNS execute-api endpoint
 * would break calls to the public WebSocket management API.
 */
export class Network extends Construct {
  readonly vpc: Vpc;
  /** Shared SG for application compute (every VPC Lambda attaches to it). */
  readonly appSecurityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkProps) {
    super(scope, id);
    const { config } = props;

    const natInstanceProvider =
      config.natMode === 'instance'
        ? NatProvider.instanceV2({
            instanceType: config.natInstanceType,
            associatePublicIpAddress: true,
            creditSpecification: CpuCredits.STANDARD,
            defaultAllowedTraffic: NatTrafficDirection.OUTBOUND_ONLY,
          })
        : undefined;

    this.vpc = new Vpc(this, 'Vpc', {
      ipAddresses: IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: config.maxAzs,
      natGateways: 1,
      natGatewayProvider: natInstanceProvider ?? NatProvider.gateway(),
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    if (natInstanceProvider) {
      // Forward traffic that originates inside the VPC; nothing from the internet gets in.
      natInstanceProvider.connections.allowFrom(Peer.ipv4(this.vpc.vpcCidrBlock), Port.allTraffic(), 'NAT for the private subnets');
      Aspects.of(this).add(new InstanceRequireImdsv2Aspect());
    }

    // The description is the deployed one: changing it would replace the group
    // and detach every Lambda and the RDS ingress rule during the deploy.
    this.appSecurityGroup = new SecurityGroup(this, 'AppSecurityGroup', {
      vpc: this.vpc,
      description: 'Shared security group for Clara application compute (Fargate)',
      allowAllOutbound: true,
    });
  }
}
