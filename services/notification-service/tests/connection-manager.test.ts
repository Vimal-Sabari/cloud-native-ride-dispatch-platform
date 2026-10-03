import { ApiGatewayConnectionManager } from '../src/connection-manager';
import { GoneException } from '@aws-sdk/client-apigatewaymanagementapi';

describe('ApiGatewayConnectionManager', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv, WEBSOCKET_API_ENDPOINT: 'https://test.execute-api.us-east-1.amazonaws.com/dev' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns { stale: false } on successful PostToConnectionCommand', async () => {
    const cm = new ApiGatewayConnectionManager();
    const sendSpy = jest.spyOn((cm as unknown as { client: { send: () => Promise<unknown> } }).client, 'send')
      .mockResolvedValueOnce({} as never);

    const result = await cm.postToConnection('conn-1', { message: 'hello' });
    expect(result).toEqual({ stale: false });
    expect(sendSpy).toHaveBeenCalledTimes(1);

    sendSpy.mockRestore();
  });

  it('returns { stale: true } when PostToConnectionCommand throws GoneException', async () => {
    const cm = new ApiGatewayConnectionManager();
    const goneError = new GoneException({ $metadata: { httpStatusCode: 410 }, message: 'Gone' });
    const sendSpy = jest.spyOn((cm as unknown as { client: { send: () => Promise<unknown> } }).client, 'send')
      .mockRejectedValueOnce(goneError as never);

    const result = await cm.postToConnection('conn-stale', { message: 'hello' });
    expect(result).toEqual({ stale: true });
    expect(sendSpy).toHaveBeenCalledTimes(1);

    sendSpy.mockRestore();
  });

  it('returns { stale: true } when error has name GoneException or status 410', async () => {
    const cm = new ApiGatewayConnectionManager();
    const customGone = { name: 'GoneException', $metadata: { httpStatusCode: 410 } };
    const sendSpy = jest.spyOn((cm as unknown as { client: { send: () => Promise<unknown> } }).client, 'send')
      .mockRejectedValueOnce(customGone as never);

    const result = await cm.postToConnection('conn-stale-2', { message: 'hello' });
    expect(result).toEqual({ stale: true });

    sendSpy.mockRestore();
  });

  it('propagates any non-410 / non-GoneException error', async () => {
    const cm = new ApiGatewayConnectionManager();
    const serverError = new Error('500 Internal Server Error');
    const sendSpy = jest.spyOn((cm as unknown as { client: { send: () => Promise<unknown> } }).client, 'send')
      .mockRejectedValueOnce(serverError as never);

    await expect(cm.postToConnection('conn-err', { message: 'hello' })).rejects.toThrow('500 Internal Server Error');

    sendSpy.mockRestore();
  });
});
