import { Construct } from 'constructs';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { Cluster } from 'aws-cdk-lib/aws-ecs';

export interface ComputeProps {
  readonly vpc: IVpc;
}

/**
 * ECS Fargate cluster (PRD section 6, "API compute" / "MCP server").
 *
 * Just the cluster for now. The API service (behind an ALB) and the MCP server
 * service get added as separate Fargate services in milestones 1 and 4 — they
 * share this cluster and the VPC's private subnets.
 *
 * Container Insights is left off to avoid the CloudWatch cost on a student
 * project; turn it on when you need the metrics.
 */
export class Compute extends Construct {
  readonly cluster: Cluster;

  constructor(scope: Construct, id: string, props: ComputeProps) {
    super(scope, id);

    this.cluster = new Cluster(this, 'Cluster', {
      clusterName: 'clara',
      vpc: props.vpc,
    });
  }
}
