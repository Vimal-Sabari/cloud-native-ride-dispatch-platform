import jwt from 'jsonwebtoken';
import { handleConnect } from '../src/handlers/connect';
import { FakeDynamoAccessor } from './helpers/fake-dynamo';

describe('Notification Service - handleConnect', () => {
  const JWT_SECRET = 'test-secret-12345';
  let fakeDynamo: FakeDynamoAccessor;

  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  beforeEach(() => {
    fakeDynamo = new FakeDynamoAccessor();
  });

  it('successfully authenticates with valid token and writes both forward and reverse records', async () => {
    const token = jwt.sign({ sub: 'rider-abc-123', role: 'rider' }, JWT_SECRET, {
      expiresIn: '1h',
    });
    const connectionId = 'conn-xyz-987';

    const result = await handleConnect(connectionId, token, fakeDynamo);

    expect(result.statusCode).toBe(200);

    // Verify exactly two items written
    expect(fakeDynamo.putCalls).toHaveLength(2);

    // (a) Forward-lookup item
    const forwardItem = fakeDynamo.get('CONNECTION#conn-xyz-987', 'DETAILS');
    expect(forwardItem).toBeDefined();
    expect(forwardItem).toMatchObject({
      PK: 'CONNECTION#conn-xyz-987',
      SK: 'DETAILS',
      subjectId: 'rider-abc-123',
      role: 'rider',
    });
    expect(typeof forwardItem?.connectedAt).toBe('string');

    // (b) Reverse-lookup item
    const reverseItem = fakeDynamo.get('USER#rider-abc-123', 'CONNECTION#conn-xyz-987');
    expect(reverseItem).toBeDefined();
    expect(reverseItem).toMatchObject({
      PK: 'USER#rider-abc-123',
      SK: 'CONNECTION#conn-xyz-987',
    });
    expect(typeof reverseItem?.connectedAt).toBe('string');
  });

  it('rejects connection when token is undefined or empty without writing any items', async () => {
    const connectionId = 'conn-no-token';

    const resultUndefined = await handleConnect(connectionId, undefined, fakeDynamo);
    expect(resultUndefined.statusCode).toBe(401);
    expect(fakeDynamo.putCalls).toHaveLength(0);

    const resultEmpty = await handleConnect(connectionId, '   ', fakeDynamo);
    expect(resultEmpty.statusCode).toBe(401);
    expect(fakeDynamo.putCalls).toHaveLength(0);
  });

  it('rejects connection when token is invalid or has wrong signature without writing any items', async () => {
    const invalidToken = jwt.sign({ sub: 'user-hacker', role: 'driver' }, 'wrong-secret-signature');
    const connectionId = 'conn-invalid-sig';

    const result = await handleConnect(connectionId, invalidToken, fakeDynamo);
    expect(result.statusCode).toBe(401);
    expect(fakeDynamo.putCalls).toHaveLength(0);

    const malformedResult = await handleConnect(connectionId, 'not.a.valid.jwt', fakeDynamo);
    expect(malformedResult.statusCode).toBe(401);
    expect(fakeDynamo.putCalls).toHaveLength(0);
  });

  it('rejects connection when token is expired without writing any items', async () => {
    // Generate an already expired token (1 hour in the past)
    const expiredToken = jwt.sign(
      { sub: 'driver-expired', role: 'driver', iat: Math.floor(Date.now() / 1000) - 3600 },
      JWT_SECRET,
      { expiresIn: '10s' },
    );
    const connectionId = 'conn-expired-token';

    const result = await handleConnect(connectionId, expiredToken, fakeDynamo);
    expect(result.statusCode).toBe(401);
    expect(fakeDynamo.putCalls).toHaveLength(0);
  });
});
