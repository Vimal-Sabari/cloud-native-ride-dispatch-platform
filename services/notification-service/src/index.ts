export const NOTIFICATION_SERVICE_NAME = '@ride-dispatch/notification-service';

export { ConnectionManager, ApiGatewayConnectionManager } from './connection-manager';
export { handleConnect, ConnectResult } from './handlers/connect';
export { handleDisconnect, DisconnectResult } from './handlers/disconnect';
export { handleFanoutEvent, FanoutMessage } from './handlers/sns-fanout';
export { handler as connectHandler } from './handlers/connect-entry';
export { handler as disconnectHandler } from './handlers/disconnect-entry';
export { handler as fanoutHandler } from './handlers/sns-fanout-entry';
