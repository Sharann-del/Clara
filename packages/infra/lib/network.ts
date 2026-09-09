import { Construct } from 'constructs';
import {
  IpAddresses,
  SecurityGroup,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import { config } from './config';

/**
 * The single VPC for Clara (PRD section 6, "Networking").
 *
 * - Public subnets: for the ALB (added with the API service in a later milestone).
 * - Private subnets (with egress): for Fargate tasks and RDS.
 *
 * Egress from the private subnets goes through one shared NAT gateway to keep
 * cost down.
 */
export class Network extends Construct {
  readonly vpc: Vpc;
  /** Shared SG for application compute (Fargate services attach to this later). */
  readonly appSecurityGroup: SecurityGroup;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.vpc = new Vpc(this, 'Vpc', {
      ipAddresses: IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: config.maxAzs,
      natGateways: config.natGateways,
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

    this.appSecurityGroup = new SecurityGroup(this, 'AppSecurityGroup', {
      vpc: this.vpc,
      description: 'Shared security group for Clara application compute (Fargate)',
      allowAllOutbound: true,
    });
  }
}
