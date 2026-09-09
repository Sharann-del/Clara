#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ClaraStack } from '../lib/clara-stack';
import { config } from '../lib/config';

const app = new cdk.App();

new ClaraStack(app, 'ClaraStack', {
  env: {
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
