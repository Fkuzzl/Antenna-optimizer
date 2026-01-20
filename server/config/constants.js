/**
 * Application-wide constants and configuration values
 * Centralized configuration to avoid magic numbers and hardcoded values
 */

module.exports = {
    // Server configuration
    SERVER: {
        PORT: 3001,
        DEFAULT_PAGE_SIZE: 100,
        MAX_PAGE_SIZE: 500,
    },

    // Timeout configurations (in milliseconds)
    TIMEOUTS: {
        PROCESS_TERMINATION_WAIT: 3000,
        PROCESS_VERIFICATION_WAIT: 2000,
        SOCKET_TIMEOUT: 10000,
        CACHE_CLEANUP_INTERVAL: 30000,
        CONNECTION_CLEANUP_INTERVAL: 5000,
        ITERATION_CHECK_INTERVAL: 5000,
        CONNECTION_MANAGER_INTERVAL: 3000,
        GRACEFUL_SHUTDOWN_DELAY: 1000,
        WEBSOCKET_HEARTBEAT: 2000,
        STATUS_POLLING_INTERVAL: 3000,
        EXCEL_READ_RETRY_DELAY: 500,
    },

    // Retry configurations
    RETRY: {
        MAX_ATTEMPTS: 3,
        EXCEL_READ_ATTEMPTS: 3,
    },

    // File and path configurations
    FILES: {
        EXCEL_FILENAME: 'Integrated_Results.xlsx',
        MAX_UPLOAD_SIZE: 10 * 1024 * 1024, // 10MB
        ALLOWED_DXF_EXTENSIONS: ['.dxf'],
        OPTIMIZATION_DATA_FOLDER: 'Optimization/data',
    },

    // Excel sheet names
    EXCEL_SHEETS: {
        S11: 'S11_Data',
        AR: 'AR_Data',
        GAIN: 'Gain_Data',
    },

    // WebSocket message types
    WS_EVENTS: {
        ITERATION_UPDATE: 'iterationUpdate',
        OPTIMIZATION_STATUS: 'optimizationStatus',
        ERROR: 'error',
        HEARTBEAT: 'heartbeat',
    },

    // Process states
    PROCESS_STATES: {
        IDLE: 'idle',
        RUNNING: 'running',
        PAUSED: 'paused',
        COMPLETED: 'completed',
        ERROR: 'error',
        TERMINATED: 'terminated',
    },

    // HTTP status codes
    HTTP_STATUS: {
        OK: 200,
        CREATED: 201,
        BAD_REQUEST: 400,
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
        INTERNAL_ERROR: 500,
        SERVICE_UNAVAILABLE: 503,
    },

    // Cache configurations
    CACHE: {
        TTL: 300000, // 5 minutes
        MAX_SIZE: 100,
    },

    // Rate limiting
    RATE_LIMIT: {
        WINDOW_MS: 15 * 60 * 1000, // 15 minutes
        MAX_REQUESTS: 100,
    },

    // Validation patterns
    PATTERNS: {
        S11_CSV: /S11_(\d+)\.csv$/,
        AR_CSV: /AR_(\d+)\.csv$/,
        GAIN_CSV: /Gain_(\d+)\.csv$/,
        ITERATION: /(\d+)/,
    },
};
