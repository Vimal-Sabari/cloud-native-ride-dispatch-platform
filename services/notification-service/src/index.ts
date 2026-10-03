export const NOTIFICATION_SERVICE_NAME = '@ride-dispatch/notification-service';

export { handleConnect, ConnectResult } from './handlers/connect';
export { handleDisconnect, DisconnectResult } from './handlers/disconnect';
export { handler as connectHandler } from './handlers/connect-entry';
export { handler as disconnectHandler } from './handlers/disconnect-entry';
