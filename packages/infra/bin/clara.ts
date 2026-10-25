#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ClaraStack } from '../lib/clara-stack';
import { resolveConfig } from '../lib/config';

const app = new cdk.App();
const config = resolveConfig(app.node);

new ClaraStack(app, 'ClaraStack', {
  config,
  env: {
    // Both come from the active AWS credentials and profile, so the same code
    // deploys to any account. Nothing account-specific is committed.
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: config.region,
  },
  description: 'Clara infrastructure skeleton — VPC, S3+CloudFront, ECS Fargate, RDS Postgres, Cognito',
  tags: {
    Project: 'Clara',
    ManagedBy: 'cdk',
  },
});

app.synth();
