import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  Distribution,
  PriceClass,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
} from 'aws-cdk-lib/aws-s3';
import type { ClaraInfraConfig } from './config';

export interface FrontendProps {
  readonly config: ClaraInfraConfig;
}

/**
 * Static frontend hosting (PRD section 6, "Frontend").
 *
 * Private S3 bucket + CloudFront distribution reading it through an Origin
 * Access Control. The React bundle is uploaded by the frontend package's own
 * deploy step (out of scope here) — this construct just provisions the target.
 *
 * SPA routing: 403/404 from S3 are rewritten to /index.html so client-side
 * routes resolve.
 */
export class Frontend extends Construct {
  readonly bucket: Bucket;
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: FrontendProps) {
    super(scope, id);
    const { config } = props;

    this.bucket = new Bucket(this, 'SiteBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.retainData,
    });

    this.distribution = new Distribution(this, 'Distribution', {
      comment: 'Clara frontend',
      defaultRootObject: 'index.html',
      // PRICE_CLASS_100 = North America + Europe edges only; cheapest.
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
      ],
    });
  }
}
