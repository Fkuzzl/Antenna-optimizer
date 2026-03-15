/**
 * Logger configuration and setup
 * Centralized Winston logger with consistent formatting
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const os = require('os');

function ensureDirSafe(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        return true;
    } catch {
        return false;
    }
}

function resolveLogsDir() {
    const candidates = [];

    if (process.env.AO_LOG_DIR && process.env.AO_LOG_DIR.trim()) {
        candidates.push(path.resolve(process.env.AO_LOG_DIR.trim()));
    }

    const appDataBase = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    candidates.push(path.join(appDataBase, 'Antenna Optimizer', 'logs'));
    candidates.push(path.join(__dirname, '..', '..', 'logs'));
    candidates.push(path.join(os.tmpdir(), 'antenna-optimizer-logs'));

    for (const candidate of candidates) {
        if (ensureDirSafe(candidate)) {
            return candidate;
        }
    }

    return null;
}

const logsDir = resolveLogsDir();

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
        })
    ),
    transports: []
});

if (logsDir) {
    logger.add(new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
        maxsize: 10485760,
        maxFiles: 5
    }));

    logger.add(new winston.transports.File({
        filename: path.join(logsDir, 'combined.log'),
        maxsize: 10485760,
        maxFiles: 5
    }));
}

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message }) => {
                return `${timestamp} [${level}]: ${message}`;
            })
        )
    }));
} else if (!logsDir) {
    logger.add(new winston.transports.Console());
}

module.exports = logger;
