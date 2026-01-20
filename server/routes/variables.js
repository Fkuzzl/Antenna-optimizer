/**
 * Variables configuration routes
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { createResponse, sanitizeError } = require('../utils/helpers');
const { HTTP_STATUS } = require('../config/constants');
const logger = require('../config/logger');

/**
 * GET /api/variables
 * Get antenna variable configuration
 */
router.get('/', async (req, res) => {
    try {
        const configPath = path.join(__dirname, '..', '..', 'config', 'antenna_variables.json');

        if (!require('fs').existsSync(configPath)) {
            logger.warn(`Variable configuration file not found: ${configPath}`);
            return res.status(HTTP_STATUS.NOT_FOUND).json(
                createResponse(false, null, 'Variable configuration file not found')
            );
        }

        const configContent = await fs.readFile(configPath, 'utf-8');
        const configData = JSON.parse(configContent);

        logger.info('Variables loaded successfully');

        res.json({
            success: true,
            variables: configData.variables,
            metadata: configData.metadata
        });

    } catch (error) {
        logger.error('Error loading variable configuration', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, 'Error loading variables', sanitizeError(error))
        );
    }
});

/**
 * POST /api/variables/apply
 * Apply variable configuration to MATLAB project
 */
router.post('/apply', async (req, res) => {
    const { exec } = require('child_process');
    const { validatePath } = require('../utils/helpers');
    
    try {
        const { variableIds, projectPath } = req.body;
        
        // Validate variableIds
        if (!variableIds || !Array.isArray(variableIds)) {
            logger.error('Invalid variableIds provided');
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'variableIds array is required')
            );
        }

        // Validate projectPath
        if (!projectPath || typeof projectPath !== 'string') {
            logger.error('Invalid projectPath provided');
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'projectPath string is required')
            );
        }
        
        // Validate and sanitize projectPath to prevent path traversal
        const pathValidation = validatePath(projectPath);
        if (!pathValidation.valid) {
            logger.error('Path validation failed', { error: pathValidation.error });
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'Invalid project path', pathValidation.error)
            );
        }

        if (variableIds.length === 0) {
            logger.error('No variable IDs provided');
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'At least one variable ID is required')
            );
        }

        // Validate upper bound for variable count (security & performance)
        if (variableIds.length > 100) {
            logger.error(`Too many variables requested: ${variableIds.length}`);
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'Too many variables (maximum 100 supported)', 
                    { requested: variableIds.length, maximum: 100 }
                )
            );
        }

        logger.info(`Applying ${variableIds.length} variables`, { 
            variableIds,
            projectPath 
        });

        // Extract project root from project path
        const projectRoot = path.dirname(projectPath);

        // Load setup config for Python path
        let setupConfig;
        try {
            setupConfig = require(path.join(__dirname, '..', '..', 'OPEN_THIS', 'SETUP', 'setup_loader'));
        } catch (error) {
            logger.warn('Setup config not found, using default python', { error: error.message });
        }

        // Execute Python script to generate F_Model_Element.m
        const pythonScriptPath = path.join(__dirname, '..', '..', 'scripts', 'generate_f_model.py');
        const variableIdsStr = variableIds.join(',');
        const pythonExecutable = setupConfig ? setupConfig.getPythonExecutable() : 'python';
        
        logger.info('Executing Python script', {
            script: pythonScriptPath,
            variableIds: variableIdsStr,
            projectRoot,
            pythonExecutable
        });
        
        const pythonCommand = `"${pythonExecutable}" "${pythonScriptPath}" "${variableIdsStr}" "${projectRoot}"`;
        
        exec(pythonCommand, (error, stdout, stderr) => {
            if (error) {
                logger.error('Python script execution failed', {
                    error: error.message,
                    stderr,
                    stdout
                });
                return res.status(HTTP_STATUS.INTERNAL_ERROR).json(
                    createResponse(false, null, 'Failed to execute Python script')
                );
            }
            
            logger.info('F_Model_Element.m generated successfully', {
                variableCount: variableIds.length,
                stdout
            });
            
            if (stderr) {
                logger.warn('Python script stderr', { stderr });
            }
            
            res.json({
                success: true,
                message: `F_Model_Element.m updated with ${variableIds.length} variables (seeds 1-${variableIds.length})`,
                variableCount: variableIds.length,
                variableIds: variableIds,
                seedRange: `1-${variableIds.length}`
            });
        });

    } catch (error) {
        logger.error('Error in apply-variables endpoint', {
            error: error.message,
            stack: error.stack
        });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, 'Failed to apply variable changes', sanitizeError(error))
        );
    }
});

module.exports = router;
