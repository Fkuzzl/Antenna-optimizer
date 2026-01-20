/**
 * Validation middleware for request data
 */

const { validatePath, validatePagination, createResponse } = require('../utils/helpers');
const { HTTP_STATUS, SERVER } = require('../config/constants');

/**
 * Validates project path in request body
 */
const validateProjectPath = (req, res, next) => {
    const { projectPath } = req.body;
    
    if (!projectPath) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
            createResponse(false, null, 'Missing required parameter: projectPath')
        );
    }

    const validation = validatePath(projectPath);
    if (!validation.valid) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
            createResponse(false, null, validation.error)
        );
    }

    // Store validated path in request
    req.validatedProjectPath = validation.sanitized;
    next();
};

/**
 * Validates pagination parameters in request body or query
 */
const validatePaginationParams = (req, res, next) => {
    const page = req.body.page || req.query.page || 1;
    const pageSize = req.body.pageSize || req.query.pageSize || SERVER.DEFAULT_PAGE_SIZE;
    
    const validation = validatePagination(page, pageSize, SERVER.MAX_PAGE_SIZE);
    
    if (!validation.valid) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
            createResponse(false, null, validation.error)
        );
    }

    // Store validated pagination in request
    req.pagination = {
        page: validation.page,
        pageSize: validation.pageSize
    };
    
    next();
};

/**
 * Validates iteration number parameter
 */
const validateIteration = (req, res, next) => {
    const iteration = parseInt(req.body.iteration || req.query.iteration || req.params.iteration);
    
    if (isNaN(iteration) || iteration < 1) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
            createResponse(false, null, 'Invalid iteration number. Must be a positive integer.')
        );
    }

    req.validatedIteration = iteration;
    next();
};

/**
 * Validates file upload parameters
 */
const validateFileUpload = (req, res, next) => {
    if (!req.file) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
            createResponse(false, null, 'No file uploaded')
        );
    }

    // Additional file validation can be added here
    next();
};

/**
 * Generic error handler middleware
 */
const errorHandler = (err, req, res, next) => {
    const logger = require('../config/logger');
    logger.error(`Error processing request: ${err.message}`, { stack: err.stack });

    const { sanitizeError } = require('../utils/helpers');
    const sanitizedMessage = sanitizeError(err);

    res.status(err.status || HTTP_STATUS.INTERNAL_ERROR).json(
        createResponse(false, null, sanitizedMessage, process.env.NODE_ENV === 'development' ? err.stack : undefined)
    );
};

module.exports = {
    validateProjectPath,
    validatePaginationParams,
    validateIteration,
    validateFileUpload,
    errorHandler,
};
