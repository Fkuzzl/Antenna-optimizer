/**
 * Enhanced MATLAB-HFSS Server v2
 * Modular architecture with separated concerns
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Configuration
const { SERVER, TIMEOUTS } = require('./config/constants');
const logger = require('./config/logger');

// Services
const websocketManager = require('./services/websocketManager');
const processManager = require('./services/processManager');

// Middleware
const { errorHandler } = require('./middleware/validation');

// Routes
const resultsRoutes = require('./routes/results');
const matlabRoutes = require('./routes/matlab');
const variablesRoutes = require('./routes/variables');
const groundPlaneRoutes = require('./routes/groundPlane');
const optimizationRoutes = require('./routes/optimization');
const gndRoutes = require('./routes/gnd');

// Initialize Express app
const app = express();

// Create HTTP server for WebSocket support
const httpServer = http.createServer(app);

// Configure CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`, {
        ip: req.ip,
        userAgent: req.get('user-agent')
    });
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Server config endpoint for settings page
app.get('/api/server/config', (req, res) => {
    res.json({
        success: true,
        version: '2.0.0',
        port: SERVER.PORT,
        environment: process.env.NODE_ENV || 'development',
        websocket: {
            enabled: true,
            url: `ws://localhost:${SERVER.PORT}`
        },
        matlab: {
            available: true
        },
        timestamp: new Date().toISOString()
    });
});

// API Routes
app.use('/api/integrated-results', resultsRoutes);
app.use('/api/simulation', resultsRoutes); // For /api/simulation/results endpoint
app.use('/api/matlab', matlabRoutes);
app.use('/api/variables', variablesRoutes);
app.use('/api/matlab', groundPlaneRoutes);
app.use('/api/matlab', optimizationRoutes);
app.use('/api/gnd', gndRoutes);

// Initialize WebSocket server
websocketManager.initialize(httpServer);

// WebSocket endpoint for backward compatibility
app.get('/ws', (req, res) => {
    res.status(426).json({
        success: false,
        message: 'Please use WebSocket protocol',
        upgrade: 'WebSocket'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found',
        path: req.url
    });
});

// Global error handler
app.use(errorHandler);

// Global error handlers for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
    logger.error('Unhandled Rejection:', { reason, promise });
});

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    // Stop WebSocket
    websocketManager.cleanup();
    
    // Stop MATLAB processes
    try {
        await processManager.stopMatlabProcess();
    } catch (error) {
        logger.error('Error stopping MATLAB during shutdown', { error: error.message });
    }
    
    // Close HTTP server
    httpServer.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
    
    // Force exit after timeout
    setTimeout(() => {
        logger.warn('Forced shutdown after timeout');
        process.exit(1);
    }, TIMEOUTS.GRACEFUL_SHUTDOWN_DELAY * 5);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start server
const PORT = SERVER.PORT;
httpServer.listen(PORT, () => {
    logger.info(`🚀 MATLAB-HFSS Server v2 running on port ${PORT}`);
    logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`🔧 Log level: ${logger.level}`);
    logger.info(`🔌 WebSocket: Enabled`);
});

module.exports = app;
