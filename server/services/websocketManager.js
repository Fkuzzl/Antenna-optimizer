/**
 * WebSocket service for real-time communication
 * Handles WebSocket connections, broadcasting, and heartbeat
 */

const WebSocket = require('ws');
const { TIMEOUTS, WS_EVENTS } = require('../config/constants');
const logger = require('../config/logger');
const { uuidv4 } = require('../utils/helpers');

class WebSocketManager {
    constructor() {
        this.wss = null;
        this.clients = new Map(); // Map<connectionId, {ws, metadata}>
        this.heartbeatInterval = null;
    }

    /**
     * Initializes WebSocket server
     * @param {Object} httpServer - HTTP server instance
     */
    initialize(httpServer) {
        this.wss = new WebSocket.Server({ server: httpServer });

        this.wss.on('connection', (ws, req) => {
            const connectionId = uuidv4();
            
            this.clients.set(connectionId, {
                ws,
                connectedAt: new Date(),
                lastHeartbeat: Date.now(),
                ip: req.socket.remoteAddress,
            });

            logger.info(`WebSocket client connected: ${connectionId}`, {
                totalClients: this.clients.size,
                ip: req.socket.remoteAddress,
            });

            ws.on('message', (message) => {
                this.handleMessage(connectionId, message);
            });

            ws.on('close', () => {
                this.clients.delete(connectionId);
                logger.info(`WebSocket client disconnected: ${connectionId}`, {
                    totalClients: this.clients.size,
                });
            });

            ws.on('error', (error) => {
                logger.error(`WebSocket error for ${connectionId}`, { error: error.message });
                this.clients.delete(connectionId);
            });

            // Send initial connection confirmation
            this.sendToClient(connectionId, {
                type: 'connected',
                connectionId,
                timestamp: new Date().toISOString(),
            });
        });

        // Start heartbeat
        this.startHeartbeat();

        logger.info('WebSocket server initialized');
    }

    /**
     * Handles incoming WebSocket messages
     * @param {string} connectionId - Client connection ID
     * @param {string} message - Raw message
     */
    handleMessage(connectionId, message) {
        try {
            const data = JSON.parse(message);
            
            // Update last heartbeat time
            const client = this.clients.get(connectionId);
            if (client) {
                client.lastHeartbeat = Date.now();
            }

            // Handle different message types
            switch (data.type) {
                case 'ping':
                    this.sendToClient(connectionId, { type: 'pong', timestamp: Date.now() });
                    break;
                case 'pong':
                    // Client responding to our heartbeat - already updated lastHeartbeat above
                    break;
                case 'subscribe':
                    // Handle subscription logic
                    break;
                default:
                    logger.warn(`Unknown message type: ${data.type}`);
            }
        } catch (error) {
            logger.error('Error handling WebSocket message', { error: error.message });
        }
    }

    /**
     * Sends message to specific client
     * @param {string} connectionId - Target client ID
     * @param {Object} data - Data to send
     */
    sendToClient(connectionId, data) {
        const client = this.clients.get(connectionId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify(data));
            } catch (error) {
                logger.error(`Error sending to client ${connectionId}`, { error: error.message });
            }
        }
    }

    /**
     * Broadcasts message to all connected clients
     * @param {Object} data - Data to broadcast
     */
    broadcast(data) {
        const message = JSON.stringify(data);
        let sentCount = 0;

        this.clients.forEach((client, connectionId) => {
            if (client.ws.readyState === WebSocket.OPEN) {
                try {
                    client.ws.send(message);
                    sentCount++;
                } catch (error) {
                    logger.error(`Error broadcasting to ${connectionId}`, { error: error.message });
                }
            }
        });

        logger.debug(`Broadcast sent to ${sentCount}/${this.clients.size} clients`);
    }

    /**
     * Broadcasts iteration update
     * @param {Object} iterationData - Iteration data
     */
    broadcastIterationUpdate(iterationData) {
        this.broadcast({
            type: WS_EVENTS.ITERATION_UPDATE,
            data: iterationData,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Broadcasts optimization status
     * @param {Object} status - Status data
     */
    broadcastStatus(status) {
        this.broadcast({
            type: WS_EVENTS.OPTIMIZATION_STATUS,
            data: status,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Starts heartbeat mechanism
     */
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            const now = Date.now();
            const timeout = 30000; // 30 seconds timeout - more lenient for network issues

            this.clients.forEach((client, connectionId) => {
                if (now - client.lastHeartbeat > timeout) {
                    logger.warn(`Client ${connectionId} heartbeat timeout, closing connection`);
                    client.ws.close();
                    this.clients.delete(connectionId);
                } else if (client.ws.readyState === WebSocket.OPEN) {
                    // Send heartbeat
                    this.sendToClient(connectionId, { type: WS_EVENTS.HEARTBEAT, timestamp: now });
                }
            });
        }, TIMEOUTS.WEBSOCKET_HEARTBEAT);
    }

    /**
     * Stops heartbeat mechanism
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Gets connected clients count
     * @returns {number}
     */
    getClientCount() {
        return this.clients.size;
    }

    /**
     * Closes all connections and cleans up
     */
    cleanup() {
        this.stopHeartbeat();
        
        this.clients.forEach((client, connectionId) => {
            try {
                client.ws.close(1000, 'Server shutting down');
            } catch (error) {
                logger.error(`Error closing client ${connectionId}`, { error: error.message });
            }
        });

        this.clients.clear();
        
        if (this.wss) {
            this.wss.close();
        }

        logger.info('WebSocket manager cleaned up');
    }
}

// Export singleton instance
module.exports = new WebSocketManager();
