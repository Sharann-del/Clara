import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  ISecurityGroup,
  IVpc,
  Port,
  SecurityGroup,
  SubnetType,
} from 'aws-cdk-lib/aws-ec2';
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  StorageType,
} from 'aws-cdk-lib/aws-rds';
import type { ClaraInfraConfig } from './config';

export interface DatabaseProps {
  readonly config: ClaraInfraConfig;
  readonly vpc: IVpc;
  /** Compute that should be allowed to connect to Postgres on 5432. */
  readonly clientSecurityGroup: ISecurityGroup;
}

/**
 * Amazon RDS for PostgreSQL (PRD section 5 / 6).
 *
 * Single-AZ db.t4g.micro, not publicly accessible, sitting in the private
 * subnets. Master credentials are generated into a Secrets Manager secret
 * (PRD: "AWS Secrets Manager for DB creds").
 *
 * The schema is applied by the migration Trigger in the Api construct.
 */
export class Database extends Construct {
  readonly instance: DatabaseInstance;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);
    const { config } = props;

    const securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Clara RDS PostgreSQL security group',
      allowAllOutbound: false,
    });
    securityGroup.addIngressRule(
      props.clientSecurityGroup,
      Port.tcp(5432),
      'Allow Clara application compute to reach PostgreSQL',
    );

    this.instance = new DatabaseInstance(this, 'Postgres', {
      engine: DatabaseInstanceEngine.postgres({
        // Major version only ("16") — RDS picks the latest available 16.x minor
        // in whatever region we deploy to. Pinning a specific minor (e.g. 16.4)
        // breaks in regions that don't carry that exact build (e.g. eu-north-1).
        version: PostgresEngineVersion.VER_16,
      }),
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: config.dbInstanceType,
      securityGroups: [securityGroup],
      credentials: Credentials.fromGeneratedSecret('clara_admin', {
        secretName: 'clara/rds/admin',
      }),
      databaseName: 'clara',
      allocatedStorage: config.dbAllocatedStorageGb,
      maxAllocatedStorage: config.dbAllocatedStorageGb,
      storageType: StorageType.GP3,
      storageEncrypted: true,
      multiAz: config.dbMultiAz,
      publiclyAccessible: false,
      deletionProtection: config.retainData,
      removalPolicy: config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      // Keep it cheap: no Performance Insights, minimal backup retention.
      backupRetention: Duration.days(config.retainData ? 7 : 1),
    });
  }

  /** Secrets Manager secret ARN holding the master credentials. */
  get credentialsSecretArn(): string {
    return this.instance.secret!.secretArn;
  }
}
