import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

function resolveEndpoint(endpoint?: string): string | undefined {
  if (process.env.SNS_ENDPOINT && process.env.SNS_ENDPOINT.trim() !== '') {
    return process.env.SNS_ENDPOINT;
  }
  if (process.env.AWS_ENDPOINT_URL && process.env.AWS_ENDPOINT_URL.trim() !== '') {
    return process.env.AWS_ENDPOINT_URL;
  }
  if (process.env.LOCALSTACK_HOSTNAME && process.env.LOCALSTACK_HOSTNAME.trim() !== '') {
    return `http://${process.env.LOCALSTACK_HOSTNAME}:4566`;
  }
  if (endpoint && endpoint.trim() !== '') {
    if (
      process.env.AWS_LAMBDA_FUNCTION_NAME &&
      endpoint.includes('localhost') &&
      process.env.LOCALSTACK_HOSTNAME
    ) {
      return `http://${process.env.LOCALSTACK_HOSTNAME}:4566`;
    }
    return endpoint;
  }
  return undefined;
}

export interface SnsPublisher {
  publish(topicArn: string, message: Record<string, unknown>): Promise<void>;
}

export class SnsClient implements SnsPublisher {
  private readonly client: SNSClient;

  constructor(endpoint?: string, customClient?: SNSClient) {
    if (customClient) {
      this.client = customClient;
      return;
    }

    const resolvedEndpoint = resolveEndpoint(endpoint);
    if (resolvedEndpoint) {
      this.client = new SNSClient({
        endpoint: resolvedEndpoint,
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
        },
      });
    } else {
      this.client = new SNSClient({
        region: process.env.AWS_REGION || 'us-east-1',
      });
    }
  }

  async publish(topicArn: string, message: Record<string, unknown>): Promise<void> {
    const stringifiedMessage = JSON.stringify(message);
    await this.client.send(
      new PublishCommand({
        TopicArn: topicArn,
        Message: stringifiedMessage,
      }),
    );
  }
}
