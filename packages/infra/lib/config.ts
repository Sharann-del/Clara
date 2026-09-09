import { InstanceClass, InstanceSize, InstanceType } from 'aws-cdk-lib/aws-ec2';

/**
 * Central place for the cost-sensitive knobs on this stack.
 *
 * This is a student project for a cloud architecture course, so every default
 * here is chosen to keep the monthly bill as low as possible while still
 * exercising a real multi-service AWS architecture (VPC, RDS, ECS, Cognito,
 * S3 + CloudFront). Bump these values later if the app actually needs it.
 */
export interface ClaraInfraConfig {
  /** Deployment region. Fixed to us-east-1: cheapest, and CloudFront/ACM work is simplest there. */
  readonly region: string;

  /** AZs to spread the VPC across. 2 is the minimum for RDS / ALB. */
  readonly maxAzs: number;

  /**
   * NAT gateways for private-subnet egress. 1 shared gateway (~$32/mo + data)
   * instead of one-per-AZ. Single point of failure, fine for a course project.
   */
  readonly natGateways: number;

  /** RDS instance type. t4g.micro: 2 vCPU burstable / 1 GB RAM, RDS free-tier eligible. */
  readonly dbInstanceType: InstanceType;

  /** RDS storage in GB. 20 is the free-tier allowance. */
  readonly dbAllocatedStorageGb: number;

  /** Multi-AZ doubles the DB cost. Off. */
  readonly dbMultiAz: boolean;

  /**
   * When true, stateful resources (RDS, S3) are retained on `cdk destroy` and
   * deletion protection is enabled. Off for now so the stack tears down cleanly
   * while we iterate — turn on before putting real data in.
   */
  readonly retainData: boolean;
}

export const config: ClaraInfraConfig = {
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  maxAzs: 2,
  natGateways: 1,
  dbInstanceType: InstanceType.of(InstanceClass.BURSTABLE4_GRAVITON, InstanceSize.MICRO),
  dbAllocatedStorageGb: 20,
  dbMultiAz: false,
  retainData: false,
};
