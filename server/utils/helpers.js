/**
 * Utility functions for error handling and path validation
 */

const crypto = require('crypto');

/**
 * Generates a UUID v4 string
 * @returns {string} UUID string
 */
const uuidv4 = () => {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Fallback: reasonably unique id using timestamp + random
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
};

/**
 * Sanitizes error messages to prevent exposure of internal system details.
 * Removes file paths, stack traces, and sensitive system information.
 * @param {Error|string} error - The error object or message to sanitize
 * @returns {string} - Sanitized error message safe for client consumption
 */
const sanitizeError = (error) => {
    const message = typeof error === 'string' ? error : (error.message || 'Unknown error');
    
    // Remove file paths (Windows and Unix)
    let sanitized = message.replace(/[A-Za-z]:\\[\w\\\-\. ]+/g, '[path]');
    sanitized = sanitized.replace(/\/[\w\/\-\. ]+/g, '[path]');
    
    // Remove Python stack traces
    sanitized = sanitized.replace(/File ".*?", line \d+.*/g, '');
    sanitized = sanitized.replace(/Traceback \(most recent call last\):.*/s, '');
    
    // Remove node module paths
    sanitized = sanitized.replace(/node_modules[\\/][\w\\/\-\.]+/g, '[module]');
    
    // Trim excessive whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    
    // If the sanitized message is too generic, provide a helpful fallback
    if (sanitized === '' || sanitized === '[path]') {
        return 'An error occurred during processing';
    }
    
    return sanitized;
};

/**
 * Validates and sanitizes file paths to prevent path traversal attacks.
 * Ensures paths don't contain dangerous patterns like ../ or absolute paths to system directories.
 * @param {string} filePath - The file path to validate
 * @param {string} expectedBase - Optional expected base directory path
 * @returns {{valid: boolean, sanitized: string, error: string}} - Validation result
 */
const validatePath = (filePath, expectedBase = null) => {
    if (!filePath || typeof filePath !== 'string') {
        return { valid: false, sanitized: '', error: 'Invalid file path' };
    }

    // Normalize path separators
    let normalized = filePath.replace(/\\/g, '/');
    
    // Check for path traversal attempts
    if (normalized.includes('../') || normalized.includes('..\\')) {
        return { valid: false, sanitized: '', error: 'Path traversal detected' };
    }
    
    // Check for absolute paths to system directories
    const dangerousPaths = ['/etc/', '/sys/', '/proc/', 'C:/Windows/', 'C:/Program Files/'];
    if (dangerousPaths.some(dp => normalized.toLowerCase().includes(dp.toLowerCase()))) {
        return { valid: false, sanitized: '', error: 'Access to system directories not allowed' };
    }
    
    // If expectedBase is provided, verify the path is within it
    if (expectedBase) {
        const normalizedBase = expectedBase.replace(/\\/g, '/');
        if (!normalized.startsWith(normalizedBase)) {
            return { valid: false, sanitized: '', error: 'Path outside expected directory' };
        }
    }
    
    return { valid: true, sanitized: filePath, error: '' };
};

/**
 * Creates a standardized API response object
 * @param {boolean} success - Success status
 * @param {*} data - Response data
 * @param {string} message - Response message
 * @param {*} error - Error details
 * @returns {Object} Standardized response object
 */
const createResponse = (success, data = null, message = '', error = null) => {
    const response = { success };
    
    if (message) response.message = message;
    if (data !== null) response.data = data;
    if (error !== null) response.error = error;
    
    return response;
};

/**
 * Validates pagination parameters
 * @param {number} page - Page number
 * @param {number} pageSize - Page size
 * @param {number} maxPageSize - Maximum allowed page size
 * @returns {{valid: boolean, page: number, pageSize: number, error: string}}
 */
const validatePagination = (page, pageSize, maxPageSize = 500) => {
    const parsedPage = parseInt(page) || 1;
    const parsedPageSize = parseInt(pageSize) || 100;
    
    if (parsedPage < 1) {
        return { valid: false, page: 1, pageSize: parsedPageSize, error: 'Page must be >= 1' };
    }
    
    if (parsedPageSize < 1 || parsedPageSize > maxPageSize) {
        return { 
            valid: false, 
            page: parsedPage, 
            pageSize: 100, 
            error: `Page size must be between 1 and ${maxPageSize}` 
        };
    }
    
    return { valid: true, page: parsedPage, pageSize: parsedPageSize, error: '' };
};

module.exports = {
    uuidv4,
    sanitizeError,
    validatePath,
    createResponse,
    validatePagination,
};
