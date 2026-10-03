import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { SnsClient } from '../src/client';

describe('SnsClient', () => {
  it('constructs and sends a PublishCommand with correct TopicArn and stringified Message', async () => {
    let capturedCommand: PublishCommand | null = null;
    const fakeClient = {
      send: jest.fn().mockImplementation((command) => {
        capturedCommand = command;
        return Promise.resolve({ MessageId: 'msg-12345' });
      }),
    } as unknown as SNSClient;

    const snsClient = new SnsClient(undefined, fakeClient);
    const topicArn = 'arn:aws:sns:us-east-1:000000000000:match-events';
    const message = {
      eventType: 'ride-matched',
      rideId: 'ride-abc-123',
      riderId: 'rider-456',
      driverId: 'driver-789',
    };

    await snsClient.publish(topicArn, message);

    expect(fakeClient.send).toHaveBeenCalledTimes(1);
    expect(capturedCommand).toBeInstanceOf(PublishCommand);
    expect((capturedCommand as unknown as { input: { TopicArn: string; Message: string } }).input).toEqual({
      TopicArn: topicArn,
      Message: JSON.stringify(message),
    });
  });

  it('can be constructed with custom endpoint or env vars without throwing', () => {
    expect(() => new SnsClient('http://localhost:4566')).not.toThrow();
    expect(() => new SnsClient()).not.toThrow();
  });
});
