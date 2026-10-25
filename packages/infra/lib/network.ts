import { Construct } from 'constructs';
import { Aspects, Stack } from 'aws-cdk-lib';
import {
  CfnInstance,
  CpuCredits,
  InstanceRequireImdsv2Aspect,
  IpAddresses,
  NatProvider,
  NatTrafficDirection,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  UserData,
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
 * single t4g.micro NAT instance (Amazon Linux 2023, launched by CDK's
 * NatProvider.instanceV2 with our own user data, below) instead of a managed NAT gateway: about $6/month of
 * compute against about $34. t4g.micro rather than t4g.nano because accounts
 * on the AWS Free plan may only launch Free Tier eligible types; override it
 * with the `natInstanceType` context value. The instance has no SSH key, requires IMDSv2,
 * runs on standard (capped) CPU credits, and only accepts traffic from inside
 * the VPC. Set the `natMode` context value to `gateway` for the managed
 * option. Interface endpoints were rejected: three services across two AZs
 * cost more than the NAT gateway, and a private-DNS execute-api endpoint
 * would break calls to the public WebSocket management API.
 */
/**
 * User data that turns an Amazon Linux 2023 instance into a NAT, replacing
 * CDK's default. The default finds the outbound interface with
 * `$(route | awk ...)`, but `route` comes from net-tools, which AL2023 doesn't
 * install, so the MASQUERADE rule can end up with no interface and fail:
 * forwarding on, NAT off. This uses `ip route` (iproute is always present),
 * stops on any error, and checks the result before reporting success.
 */
export function natInstanceCommands(region: string): string[] {
  return [
    'set -euxo pipefail',
    // cfn-signal (sent by the exit trap) comes from this package.
    'dnf install -y aws-cfn-bootstrap iptables-services',
    "echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/90-clara-nat.conf",
    'sysctl -p /etc/sysctl.d/90-clara-nat.conf',
    // Start the service first: starting it loads the saved ruleset over anything added before.
    'systemctl enable --now iptables',
    "IFACE=$(ip -4 route show default | awk '{print $5; exit}')",
    'test -n "$IFACE"',
    'iptables -t nat -C POSTROUTING -o "$IFACE" -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE',
    // The stock ruleset REJECTs forwarded packets.
    'iptables -F FORWARD',
    'iptables -P FORWARD ACCEPT',
    'service iptables save',
    // Verify before signalling success: forwarding on, the rule present, and our own egress working.
    'test "$(sysctl -n net.ipv4.ip_forward)" = 1',
    'iptables -t nat -C POSTROUTING -o "$IFACE" -j MASQUERADE',
    `curl -sS -o /dev/null --max-time 15 https://secretsmanager.${region}.amazonaws.com/`,
  ];
}

export class Network extends Construct {
  readonly vpc: Vpc;
  /** Shared SG for application compute (every VPC Lambda attaches to it). */
  readonly appSecurityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkProps) {
    super(scope, id);
    const { config } = props;

    const natUserData = UserData.forLinux();
    natUserData.addCommands(...natInstanceCommands(Stack.of(this).region));
    const natInstanceProvider =
      config.natMode === 'instance'
        ? NatProvider.instanceV2({
            instanceType: config.natInstanceType,
            associatePublicIpAddress: true,
            creditSpecification: CpuCredits.STANDARD,
            defaultAllowedTraffic: NatTrafficDirection.OUTBOUND_ONLY,
            userData: natUserData,
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
      natInstanceProvider.connections.allowFrom(
        Peer.ipv4(this.vpc.vpcCidrBlock),
        Port.allTraffic(),
        'NAT for the private subnets',
      );
      Aspects.of(this).add(new InstanceRequireImdsv2Aspect());

      // EC2 reports an instance created as soon as it's running, long before
      // user data has set up NAT, and the private routes switch to it right
      // away. Make CloudFormation wait for the instance to signal that NAT
      // works; a failed or missing signal fails the deploy before any route
      // changes, instead of Lambdas timing out behind a dead NAT.
      for (const instance of natInstanceProvider.gatewayInstances) {
        natUserData.addSignalOnExitCommand(instance);
        (instance.node.defaultChild as CfnInstance).cfnOptions.creationPolicy = {
          resourceSignal: { count: 1, timeout: 'PT10M' },
        };
      }
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
