/**
 * Optimization folder management routes
 * Handles backup and removal of optimization data
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { exec } = require('child_process');
const { createResponse, validatePath, sanitizeError } = require('../utils/helpers');
const { HTTP_STATUS } = require('../config/constants');
const logger = require('../config/logger');

/**
 * POST /api/matlab/manage-optimization-folder
 * Manage optimization folder (backup and/or removal)
 */
router.post('/manage-optimization-folder', async (req, res) => {
    try {
        const { projectPath, action } = req.body;
        
        // Validate projectPath
        if (!projectPath || typeof projectPath !== 'string') {
            logger.error('Invalid projectPath provided');
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'projectPath string is required')
            );
        }

        // Validate action
        if (!action || (action !== 'backup-only' && action !== 'backup-and-remove')) {
            logger.error('Invalid action provided', { action });
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'action must be "backup-only" or "backup-and-remove"')
            );
        }

        // Extract project root directory from project path
        const projectRoot = path.dirname(projectPath);
        
        logger.info('Managing optimization data', {
            projectPath,
            projectRoot,
            action
        });

        // Load setup config for Python path
        let setupConfig;
        try {
            setupConfig = require(path.join(__dirname, '..', '..', 'OPEN_THIS', 'SETUP', 'setup_loader'));
        } catch (error) {
            logger.warn('Setup config not found, using default python', { error: error.message });
        }

        // Execute Python script for optimization data management
        const pythonScriptPath = path.join(__dirname, '..', '..', 'scripts', 'manage_optimization_data.py');
        const pythonExecutable = setupConfig ? setupConfig.getPythonExecutable() : 'python';
        const pythonCommand = `"${pythonExecutable}" "${pythonScriptPath}" "${action}" "${projectRoot}"`;
        
        logger.info('Executing Python script', {
            script: pythonScriptPath,
            action,
            projectRoot,
            pythonExecutable
        });
        
        exec(pythonCommand, (error, stdout, stderr) => {
            if (error) {
                logger.error('Python script execution error', {
                    error: error.message,
                    stderr,
                    stdout
                });
                
                // Try to parse any JSON output from the error
                try {
                    const lines = stdout.split('\n');
                    const jsonLine = lines.find(line => line.trim().startsWith('{'));
                    if (jsonLine) {
                        const errorResult = JSON.parse(jsonLine);
                        return res.status(HTTP_STATUS.INTERNAL_ERROR).json({
                            success: false,
                            message: errorResult.message || 'Python script execution failed',
                            action: action,
                            error: error.message,
                            pythonOutput: stdout,
                            pythonErrors: stderr,
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (parseError) {
                    // Ignore parse error and fall back to generic response
                }
                
                return res.status(HTTP_STATUS.INTERNAL_ERROR).json({
                    success: false,
                    message: 'Failed to execute optimization management script',
                    action: action,
                    error: error.message,
                    pythonOutput: stdout,
                    pythonErrors: stderr,
                    timestamp: new Date().toISOString()
                });
            }
            
            logger.info('Python script executed successfully', { stdout });
            
            if (stderr) {
                logger.warn('Python script stderr', { stderr });
            }
            
            try {
                // Parse JSON output from Python script
                const lines = stdout.split('\n');
                const jsonStartIndex = lines.findIndex(line => line.trim() === 'JSON OUTPUT:');
                
                if (jsonStartIndex === -1) {
                    throw new Error('No JSON output found from Python script');
                }
                
                const jsonLines = lines.slice(jsonStartIndex + 1).filter(line => line.trim());
                const jsonOutput = jsonLines.join('\n');
                const pythonResult = JSON.parse(jsonOutput);
                
                // Convert Python result format to expected API response format
                const apiResponse = {
                    success: pythonResult.success,
                    message: pythonResult.message,
                    action: pythonResult.action,
                    optimizationExists: pythonResult.optimization_exists,
                    backupCreated: pythonResult.backup_created,
                    optimizationRemoved: pythonResult.optimization_removed,
                    fModelRemoved: pythonResult.fmodel_removed,
                    fModelBackupCreated: pythonResult.fmodel_backup_created,
                    paths: {
                        optimizationPath: path.join(projectRoot, 'Optimization'),
                        backupPath: pythonResult.backup_path,
                        projectRoot: projectRoot
                    },
                    stats: pythonResult.stats,
                    errors: pythonResult.errors || [],
                    pythonOutput: stdout,
                    timestamp: pythonResult.timestamp
                };
                
                logger.info('Optimization management completed successfully', {
                    action: apiResponse.action,
                    optimizationExists: apiResponse.optimizationExists,
                    backupCreated: apiResponse.backupCreated,
                    optimizationRemoved: apiResponse.optimizationRemoved
                });
                
                res.json(apiResponse);
                
            } catch (parseError) {
                logger.error('Failed to parse Python script output', {
                    error: parseError.message,
                    stdout
                });
                
                return res.status(HTTP_STATUS.INTERNAL_ERROR).json({
                    success: false,
                    message: 'Failed to parse optimization management script output',
                    action: action,
                    error: parseError.message,
                    pythonOutput: stdout,
                    pythonErrors: stderr,
                    timestamp: new Date().toISOString()
                });
            }
        });

    } catch (error) {
        logger.error('Error in manage-optimization-folder endpoint', {
            error: error.message,
            stack: error.stack
        });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            message: 'Failed to manage optimization folder',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;
