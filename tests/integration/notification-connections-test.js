#!/usr/bin/env node

/**
 * ==============================================================================
 * Notification Service WebSocket Connection Management & Fan-Out Integration Test
 * ==============================================================================
 *
 * ARCHITECTURAL DESIGN NOTE: WHY NODE.JS INSTEAD OF BASH:
 * This integration test is deliberately written as a Node.js script using the `ws`
 * library rather than a bash/curl script. Standard command-line HTTP tools like
 * curl or netcat cannot manage the RFC 6455 WebSocket protocol handshake, persistent
 * frame-level duplex streaming, heartbeat frames, or event-driven connection lifecycle
 * events ('open', 'error', 'close', 'message'). Using Node.js with `ws` allows realistic,
 * event-driven verification of client connection establishment, real-time message delivery,
 * and abrupt socket loss cleanup against AWS API Gateway WebSocket stages.
 *
 * Test Coverage:
 * 1. Positive Connection: Valid rider JWT opens WebSocket connection & persists DynamoDB records.
 * 2. Negative Connection: Missing JWT rejected with 401.
 * 3. Fan-out Delivery: Triggering driver assignment publishes to SNS topic, which invokes
 *    Notification Fan-out Lambda to push `ride-matched` event over open WebSocket.
 * 4. Stale Connection Cleanup: Forcibly closing socket via `.terminate()` (simulating abrupt network loss
 *    without RFC 6455 close frame) and triggering a fan-out event causes API Gateway GoneException (410),
 *    which cleans up both forward and reverse DynamoDB records.
 * 5. Disconnect Cleanup: Normal disconnect deletes both connection records.
 * ==============================================================================
 */

const { execSync } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
const REGION = process.env.AWS_REGION || 'us-east-1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-for-ride-dispatch-local-testing';
const JWT_SECRET = process.env.JWT_SECRET;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'dev-internal-api-key-for-matching-service';

// Resolve WebSocket URL from environment or terraform output
function getWebSocketUrl() {
  if (process.env.WEBSOCKET_URL) {
    return process.env.WEBSOCKET_URL;
  }
  const infraDir = path.resolve(__dirname, '../../infra');
  try {
    const output = execSync('terraform output -raw websocket_api_invoke_url', {
      cwd: infraDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (output && !output.includes('No output') && output.length > 0) {
      return output;
    }
  } catch {
    // Fall back to empty if terraform output unavailable
  }
  return '';
}

function getApiGatewayUrl() {
  if (process.env.API_GATEWAY_URL) {
    return process.env.API_GATEWAY_URL.replace(/\/$/, '');
  }
  const infraDir = path.resolve(__dirname, '../../infra');
  try {
    const output = execSync('terraform output -raw api_gateway_invoke_url', {
      cwd: infraDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (output && !output.includes('No output') && output.length > 0) {
      return output.replace(/\/$/, '');
    }
  } catch {
    // Fall back
  }
  return '';
}

function getTableName() {
  if (process.env.TABLE_NAME) {
    return process.env.TABLE_NAME;
  }
  const infraDir = path.resolve(__dirname, '../../infra');
  try {
    const output = execSync('terraform output -raw dynamodb_table_name', {
      cwd: infraDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (output && !output.includes('No output')) {
      return output;
    }
  } catch {
    // fallback
  }
  return 'ride-dispatch-platform-local';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('========================================================');
  console.log('Notification Service WebSocket Connections & Fan-Out Test');
  console.log('AWS Endpoint:  ', ENDPOINT_URL);
  console.log('Region:        ', REGION);
  console.log('========================================================\n');

  const wssUrl = getWebSocketUrl();
  const apiBaseUrl = getApiGatewayUrl();
  const tableName = getTableName();
  console.log(`Resolved WebSocket URL:   ${wssUrl || '(none - LocalStack Community tier)'}`);
  console.log(`Resolved API Gateway URL: ${apiBaseUrl || '(none)'}`);
  console.log(`Resolved Table Name:      ${tableName}\n`);

  // Initialize DynamoDB Client
  const rawDdb = new DynamoDBClient({
    endpoint: ENDPOINT_URL,
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
    },
  });
  const docClient = DynamoDBDocumentClient.from(rawDdb);

  const testUserId = `rider-ws-test-${Date.now()}`;
  const validToken = jwt.sign({ sub: testUserId, role: 'rider' }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });

  // If WebSocket API Gateway is not provisioned (unsupported in LocalStack Community edition),
  // verify end-to-end handler persistence, fanout push, and stale connection cleanup directly against LocalStack.
  if (!wssUrl) {
    console.log('[INFO] API Gateway v2 (WebSocket) is unsupported in LocalStack Community tier.');
    console.log('[INFO] Verifying Notification Service handlers directly against LocalStack DynamoDB...\n');

    const fs = require('fs');
    const connectHandlerPath = path.resolve(
      __dirname,
      '../../services/notification-service/dist/handlers/connect.js',
    );
    if (!fs.existsSync(connectHandlerPath)) {
      console.log(
        '[INFO] dist/handlers/connect.js not found. Building @ride-dispatch/notification-service...',
      );
      execSync('npm run build --workspace=@ride-dispatch/notification-service', {
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'inherit',
      });
    }

    const { DynamoClient } = require('@ride-dispatch/dynamo-client');
    const { handleConnect } = require('../../services/notification-service/dist/handlers/connect');
    const { handleDisconnect } = require('../../services/notification-service/dist/handlers/disconnect');
    const { handleFanoutEvent } = require('../../services/notification-service/dist/handlers/sns-fanout');

    const dynamoAccessor = new DynamoClient(tableName, ENDPOINT_URL);
    const mockConnId = `conn-direct-${Date.now()}`;

    // Test Case A: Valid token persists records
    console.log('--- Direct Test Case A: Valid token persists forward and reverse records ---');
    const resA = await handleConnect(mockConnId, validToken, dynamoAccessor);
    if (resA.statusCode !== 200) {
      console.error(`[FAIL] Expected statusCode 200, got ${resA.statusCode}`);
      process.exit(1);
    }

    const reverseCheck = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `USER#${testUserId}`, SK: `CONNECTION#${mockConnId}` },
      }),
    );
    const forwardCheck = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `CONNECTION#${mockConnId}`, SK: 'DETAILS' },
      }),
    );

    if (!reverseCheck.Item || !forwardCheck.Item) {
      console.error('[FAIL] Expected records were not found in LocalStack DynamoDB!');
      process.exit(1);
    }
    console.log('[PASS] Forward and reverse lookup records verified in LocalStack DynamoDB.');

    // Test Case B: Missing/invalid token rejection
    console.log('\n--- Direct Test Case B: Missing/invalid token rejection ---');
    const resB = await handleConnect(`conn-no-token-${Date.now()}`, undefined, dynamoAccessor);
    if (resB.statusCode !== 401) {
      console.error(`[FAIL] Expected statusCode 401, got ${resB.statusCode}`);
      process.exit(1);
    }
    console.log('[PASS] Missing token rejected with 401.');

    // Test Case C: Fan-out event delivery
    console.log('\n--- Direct Test Case C: Fan-out event delivery to active connection ---');
    const directRideId = `ride-fanout-direct-${Date.now()}`;
    const directDriverId = `driver-fanout-direct-${Date.now()}`;
    const postedMessages = [];
    const mockConnectionManager = {
      postToConnection: async (connectionId, payload) => {
        postedMessages.push({ connectionId, payload });
        return { stale: false };
      },
    };

    const fanoutMessage = {
      eventType: 'ride-matched',
      rideId: directRideId,
      riderId: testUserId,
      driverId: directDriverId,
    };

    await handleFanoutEvent(fanoutMessage, {
      ...dynamoAccessor,
      connectionManager: mockConnectionManager,
    });

    if (postedMessages.length !== 1 || postedMessages[0].connectionId !== mockConnId) {
      console.error('[FAIL] Fan-out did not post to expected active connection!', postedMessages);
      process.exit(1);
    }
    if (postedMessages[0].payload.eventType !== 'ride-matched' || postedMessages[0].payload.rideId !== directRideId) {
      console.error('[FAIL] Fan-out payload mismatch:', postedMessages[0].payload);
      process.exit(1);
    }
    console.log('[PASS] Fan-out successfully posted ride-matched event to rider connection.');

    // Test Case D: Stale connection cleanup
    console.log('\n--- Direct Test Case D: Stale connection cleanup during fanout ---');
    const staleSubjectId = `rider-stale-${Date.now()}`;
    const staleConnId = `conn-stale-${Date.now()}`;
    const staleToken = jwt.sign({ sub: staleSubjectId, role: 'rider' }, JWT_SECRET, { expiresIn: '1h' });

    await handleConnect(staleConnId, staleToken, dynamoAccessor);

    // Verify stale records exist before fanout
    const stalePreCheck = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `CONNECTION#${staleConnId}`, SK: 'DETAILS' },
      }),
    );
    if (!stalePreCheck.Item) {
      console.error('[FAIL] Stale test connection was not seeded in DynamoDB');
      process.exit(1);
    }

    // Mock connection manager returning { stale: true } simulating GoneException (410)
    const staleConnectionManager = {
      postToConnection: async (connectionId) => {
        return { stale: connectionId === staleConnId };
      },
    };

    await handleFanoutEvent(
      {
        eventType: 'ride-cancelled',
        rideId: `ride-cancel-${Date.now()}`,
        riderId: staleSubjectId,
      },
      {
        ...dynamoAccessor,
        connectionManager: staleConnectionManager,
      },
    );

    // Confirm both records are deleted from DynamoDB
    const staleForwardPost = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `CONNECTION#${staleConnId}`, SK: 'DETAILS' },
      }),
    );
    const staleReversePost = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `USER#${staleSubjectId}`, SK: `CONNECTION#${staleConnId}` },
      }),
    );

    if (staleForwardPost.Item || staleReversePost.Item) {
      console.error('[FAIL] Stale connection records were not deleted from DynamoDB during fanout cleanup!');
      process.exit(1);
    }
    console.log('[PASS] Stale connection records cleanly purged from DynamoDB upon { stale: true }.');

    // Test Case E: Clean up original connection
    console.log('\n--- Direct Test Case E: Disconnect cleans up records ---');
    const resE = await handleDisconnect(mockConnId, dynamoAccessor);
    if (resE.statusCode !== 200) {
      console.error(`[FAIL] Expected statusCode 200, got ${resE.statusCode}`);
      process.exit(1);
    }

    const reverseAfter = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `USER#${testUserId}`, SK: `CONNECTION#${mockConnId}` },
      }),
    );
    const forwardAfter = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `CONNECTION#${mockConnId}`, SK: 'DETAILS' },
      }),
    );

    if (reverseAfter.Item || forwardAfter.Item) {
      console.error('[FAIL] Records were not removed from LocalStack DynamoDB!');
      process.exit(1);
    }
    console.log('[PASS] Both records cleanly removed from LocalStack DynamoDB on disconnect.');

    console.log('\n========================================================');
    console.log('NOTIFICATION SERVICE WEBSOCKET INTEGRATION TEST: PASSED');
    console.log('(Verified connection lifecycle, fan-out delivery, & stale cleanup)');
    console.log('========================================================');
    process.exit(0);
  }

  let passed = true;

  // ----------------------------------------------------------------------------
  // Case A: Positive Connection Test (Valid Token)
  // ----------------------------------------------------------------------------
  console.log('--- Test Case A: Valid Token Connection & DynamoDB Records ---');
  let validWs;
  let connectionId = null;

  try {
    const connectUrl = `${wssUrl}?token=${validToken}`;
    console.log(`Connecting to: ${connectUrl}`);

    validWs = await new Promise((resolve, reject) => {
      const ws = new WebSocket(connectUrl, {
        rejectUnauthorized: false,
        handshakeTimeout: 10000,
      });

      const timer = setTimeout(() => {
        reject(new Error('Connection timed out after 10000ms'));
      }, 10000);

      ws.on('open', () => {
        clearTimeout(timer);
        console.log('[PASS] WebSocket "open" event fired successfully with valid token.');
        resolve(ws);
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // Wait 1.5 seconds for DynamoDB records to settle
    await sleep(1500);

    // Query DynamoDB for reverse-lookup record: PK = "USER#" + testUserId
    console.log(`Querying DynamoDB for reverse lookup: PK = USER#${testUserId}...`);
    const reverseQueryResult = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${testUserId}`,
          ':skPrefix': 'CONNECTION#',
        },
      }),
    );

    if (!reverseQueryResult.Items || reverseQueryResult.Items.length === 0) {
      console.error(`[FAIL] No reverse-lookup record found for USER#${testUserId}`);
      passed = false;
    } else {
      const reverseRecord = reverseQueryResult.Items[0];
      connectionId = reverseRecord.SK.replace('CONNECTION#', '');
      console.log(
        `[PASS] Found reverse lookup record: SK=${reverseRecord.SK} (connectionId: ${connectionId})`,
      );

      // Query DynamoDB for forward-lookup record: PK = "CONNECTION#" + connectionId, SK = "DETAILS"
      console.log(`Verifying forward lookup record for CONNECTION#${connectionId}...`);
      const forwardResult = await docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            PK: `CONNECTION#${connectionId}`,
            SK: 'DETAILS',
          },
        }),
      );

      if (!forwardResult.Item) {
        console.error(`[FAIL] Forward-lookup record not found for CONNECTION#${connectionId}`);
        passed = false;
      } else {
        const item = forwardResult.Item;
        if (item.subjectId === testUserId && item.role === 'rider') {
          console.log('[PASS] Forward lookup record verified with correct subjectId and role.');
        } else {
          console.error(`[FAIL] Forward lookup record attributes mismatch:`, item);
          passed = false;
        }
      }
    }
  } catch (err) {
    console.error('[FAIL] Positive connection test failed:', err.message);
    passed = false;
  }

  // ----------------------------------------------------------------------------
  // Case B: Negative Connection Test (Missing Token)
  // ----------------------------------------------------------------------------
  console.log('\n--- Test Case B: Missing Token Connection Rejection ---');
  try {
    const unauthConnected = await new Promise((resolve) => {
      const ws = new WebSocket(wssUrl, {
        rejectUnauthorized: false,
        handshakeTimeout: 5000,
      });

      ws.on('open', () => {
        ws.close();
        resolve(true); // Should NOT happen
      });

      ws.on('error', (err) => {
        console.log(`[PASS] Missing-token connection emitted expected error: ${err.message}`);
        resolve(false);
      });

      ws.on('close', (code, reason) => {
        console.log(
          `[PASS] Missing-token connection closed with code ${code} (${reason || 'no reason'})`,
        );
        resolve(false);
      });
    });

    if (unauthConnected) {
      console.error('[FAIL] Connection without token unexpectedly succeeded!');
      passed = false;
    } else {
      console.log('[PASS] Connection without token was correctly refused.');
    }
  } catch (err) {
    console.log(`[PASS] Missing-token connection rejected as expected: ${err.message}`);
  }

  // ----------------------------------------------------------------------------
  // Case C: Real-time Fan-out Message Delivery on Match
  // ----------------------------------------------------------------------------
  console.log('\n--- Test Case C: Real-time Fan-out Push on Driver Assignment ---');
  if (validWs && validWs.readyState === WebSocket.OPEN && connectionId) {
    try {
      const fanoutRideId = `ride-live-fanout-${Date.now()}`;
      const fanoutDriverId = `driver-live-${Date.now()}`;

      // 1. Seed fresh REQUESTED-state ride in DynamoDB
      console.log(`Seeding REQUESTED ride ${fanoutRideId} for rider ${testUserId}...`);
      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: `RIDE#${fanoutRideId}`,
            SK: 'DETAILS',
            rideId: fanoutRideId,
            riderId: testUserId,
            state: 'REQUESTED',
            pickup: { lat: 37.77, lng: -122.41 },
            dropoff: { lat: 37.78, lng: -122.42 },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
      );

      // 2. Setup listener on open WebSocket for pushed message
      const messagePromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Timeout: Did not receive fan-out message on WebSocket within 10000ms'));
        }, 10000);

        validWs.once('message', (data) => {
          clearTimeout(timer);
          try {
            const parsed = JSON.parse(data.toString());
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse WebSocket message: ${e.message}`));
          }
        });
      });

      // 3. Trigger driver assignment via Trip Service REST API or assign-driver handler
      if (apiBaseUrl) {
        console.log(`Calling POST ${apiBaseUrl}/internal/rides/${fanoutRideId}/assign-driver...`);
        const response = await fetch(`${apiBaseUrl}/internal/rides/${fanoutRideId}/assign-driver`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-api-key': INTERNAL_API_KEY,
          },
          body: JSON.stringify({ driverId: fanoutDriverId }),
        });

        if (!response.ok) {
          throw new Error(`assign-driver API returned HTTP ${response.status}`);
        }
      } else {
        // Direct handler call if REST endpoint not accessible
        const { assignDriver } = require('../../services/trip-service/dist/handlers/internal-assign-driver');
        const { SnsClient } = require('@ride-dispatch/sns-client');
        const { DynamoClient } = require('@ride-dispatch/dynamo-client');
        const sns = new SnsClient(ENDPOINT_URL);
        const dynamo = new DynamoClient(tableName, ENDPOINT_URL);
        const topicArn = process.env.MATCH_EVENTS_TOPIC_ARN || '';
        await assignDriver(fanoutRideId, fanoutDriverId, dynamo, { 'x-internal-api-key': INTERNAL_API_KEY }, sns, topicArn);
      }

      console.log('Awaiting fan-out message on WebSocket connection...');
      const receivedMsg = await messagePromise;
      console.log('Received WebSocket message:', receivedMsg);

      if (
        receivedMsg.eventType === 'ride-matched' &&
        receivedMsg.rideId === fanoutRideId &&
        receivedMsg.riderId === testUserId &&
        receivedMsg.driverId === fanoutDriverId
      ) {
        console.log('[PASS] WebSocket received valid ride-matched event with expected fields.');
      } else {
        console.error('[FAIL] Received message did not match expected structure:', receivedMsg);
        passed = false;
      }
    } catch (err) {
      console.error('[FAIL] Fan-out message delivery test failed:', err.message);
      passed = false;
    }
  } else {
    console.log('[SKIP] Skipping fan-out test due to prior connection failure.');
  }

  // ----------------------------------------------------------------------------
  // Case D: Stale Connection Cleanup on Fan-Out
  // ----------------------------------------------------------------------------
  console.log('\n--- Test Case D: Stale Connection Cleanup on Fan-Out ---');
  try {
    const staleSubjectId = `rider-abrupt-loss-${Date.now()}`;
    const staleToken = jwt.sign({ sub: staleSubjectId, role: 'rider' }, JWT_SECRET, { expiresIn: '1h' });

    console.log(`Opening WebSocket for simulated abrupt loss subject (${staleSubjectId})...`);
    const staleWs = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wssUrl}?token=${staleToken}`, {
        rejectUnauthorized: false,
        handshakeTimeout: 10000,
      });
      const timer = setTimeout(() => reject(new Error('Stale WS connection timed out')), 10000);
      ws.on('open', () => {
        clearTimeout(timer);
        resolve(ws);
      });
      ws.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });

    await sleep(1500);

    // Retrieve the connection ID from DynamoDB
    const queryStale = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${staleSubjectId}`,
          ':skPrefix': 'CONNECTION#',
        },
      }),
    );

    if (!queryStale.Items || queryStale.Items.length === 0) {
      throw new Error(`No connection record found for ${staleSubjectId}`);
    }

    const staleConnId = queryStale.Items[0].SK.replace('CONNECTION#', '');
    console.log(`Connected with connectionId: ${staleConnId}`);

    /**
     * Technical Note on WebSocket Socket Closure:
     * In the `ws` client library, `.terminate()` immediately destroys the underlying TCP socket
     * without sending a RFC 6455 close control frame (unlike `.close()`, which initiates a graceful
     * handshake triggering API Gateway's $disconnect route). This accurately simulates an abrupt
     * network loss (e.g. mobile tunnel drop or device crash).
     */
    console.log('Forcibly terminating raw socket via .terminate() without close handshake...');
    staleWs.terminate();
    await sleep(1000);

    // Trigger fan-out notification targeting the stale connection
    console.log(`Triggering fan-out event for ${staleSubjectId}...`);
    const { handleFanoutEvent } = require('../../services/notification-service/dist/handlers/sns-fanout');
    const { ApiGatewayConnectionManager } = require('../../services/notification-service/dist/connection-manager');
    const { DynamoClient } = require('@ride-dispatch/dynamo-client');
    const dynamo = new DynamoClient(tableName, ENDPOINT_URL);
    const cm = new ApiGatewayConnectionManager(wssUrl);

    await handleFanoutEvent(
      {
        eventType: 'ride-cancelled',
        rideId: `ride-stale-${Date.now()}`,
        riderId: staleSubjectId,
      },
      {
        ...dynamo,
        connectionManager: cm,
      },
    );

    // Confirm that both records are deleted from DynamoDB
    const checkForward = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `CONNECTION#${staleConnId}`, SK: 'DETAILS' },
      }),
    );
    const checkReverse = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `USER#${staleSubjectId}`, SK: `CONNECTION#${staleConnId}` },
      }),
    );

    if (!checkForward.Item && !checkReverse.Item) {
      console.log('[PASS] Stale connection records cleanly deleted as side effect of fan-out attempt.');
    } else {
      console.error('[FAIL] Stale records still exist in DynamoDB after fan-out attempt!');
      passed = false;
    }
  } catch (err) {
    console.error('[FAIL] Stale connection cleanup test failed:', err.message);
    passed = false;
  }

  // ----------------------------------------------------------------------------
  // Case E: Disconnect & Record Cleanup
  // ----------------------------------------------------------------------------
  console.log('\n--- Test Case E: Graceful Disconnect & Record Cleanup ---');
  if (validWs && validWs.readyState === WebSocket.OPEN && connectionId) {
    console.log(`Closing valid WebSocket connection (${connectionId})...`);
    validWs.close();

    // Wait 2 seconds for $disconnect Lambda execution
    await sleep(2000);

    // Verify both records are deleted
    const forwardCheck = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `CONNECTION#${connectionId}`,
          SK: 'DETAILS',
        },
      }),
    );

    const reverseCheck = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `USER#${testUserId}`,
          SK: `CONNECTION#${connectionId}`,
        },
      }),
    );

    if (!forwardCheck.Item && !reverseCheck.Item) {
      console.log('[PASS] Both forward and reverse lookup records cleanly deleted on disconnect.');
    } else {
      if (forwardCheck.Item) {
        console.error(
          '[FAIL] Forward lookup record still exists after disconnect:',
          forwardCheck.Item,
        );
      }
      if (reverseCheck.Item) {
        console.error(
          '[FAIL] Reverse lookup record still exists after disconnect:',
          reverseCheck.Item,
        );
      }
      passed = false;
    }
  } else {
    console.log(
      '[SKIP] Skipping disconnect cleanup verification due to earlier connection failure.',
    );
  }

  console.log('\n========================================================');
  if (passed) {
    console.log('NOTIFICATION SERVICE WEBSOCKET INTEGRATION TEST: PASSED');
    console.log('========================================================');
    process.exit(0);
  } else {
    console.error('NOTIFICATION SERVICE WEBSOCKET INTEGRATION TEST: FAILED');
    console.log('========================================================');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled error in integration test:', err);
  process.exit(1);
});
