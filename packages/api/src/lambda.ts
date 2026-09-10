import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './app.js';

const appPromise = buildApp();

let proxyPromise: Promise<ReturnType<typeof awsLambdaFastify>> | undefined;
function getProxy() {
  if (!proxyPromise) {
    proxyPromise = appPromise.then((app) => awsLambdaFastify(app));
  }
  return proxyPromise;
}

export const handler = async (event: unknown, context: unknown) => {
  const proxy = await getProxy();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (proxy as any)(event, context);
};
