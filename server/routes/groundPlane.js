/**
 * Ground plane configuration routes
 * Handles ground plane parameter updates and custom GND import generation
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { exec } = require('child_process');
const { createResponse, validatePath, sanitizeError } = require('../utils/helpers');
const { HTTP_STATUS } = require('../config/constants');
const logger = require('../config/logger');

/**
 * POST /api/matlab/update-ground-plane
 * Update ground plane parameters in F_Model_Element.m
 */
router.post('/update-ground-plane', async (req, res) => {
    try {
        logger.info('UPDATE GROUND PLANE REQUEST', { body: req.body });
        
        const { projectPath, Lgx, Lgy, GND_xPos, GND_yPos, groundPlaneLg, groundPlaneThick } = req.body;

        // Support both old and new parameter names for backward compatibility
        const lgxValue = Lgx !== undefined ? parseFloat(Lgx) : (groundPlaneLg !== undefined ? parseFloat(groundPlaneLg) : null);
        const lgyValue = Lgy !== undefined ? parseFloat(Lgy) : (groundPlaneLg !== undefined ? parseFloat(groundPlaneLg) : null);
        const xPosValue = GND_xPos !== undefined ? parseFloat(GND_xPos) : 0;
        const yPosValue = GND_yPos !== undefined ? parseFloat(GND_yPos) : 0;
        
        logger.info('Parsed ground plane values', {
            Lgx: lgxValue,
            Lgy: lgyValue,
            GND_xPos: xPosValue,
            GND_yPos: yPosValue
        });

        // Validate required parameters
        if (!projectPath || typeof projectPath !== 'string') {
            logger.error('Invalid projectPath provided');
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'projectPath string is required')
            );
        }
        
        // Validate and sanitize projectPath
        const pathValidation = validatePath(projectPath);
        if (!pathValidation.valid) {
            logger.error('Path validation failed', { error: pathValidation.error });
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'Invalid project path', pathValidation.error)
            );
        }

        if (lgxValue === null || isNaN(lgxValue)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'Lgx parameter is required')
            );
        }

        if (lgyValue === null || isNaN(lgyValue)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'Lgy parameter is required')
            );
        }

        // Validate parameter ranges
        if (lgxValue < 25) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'Lgx must be >= 25mm (antenna size)')
            );
        }

        if (lgyValue < 25) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'Lgy must be >= 25mm (antenna size)')
            );
        }

        if (xPosValue < 0 || isNaN(xPosValue)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'GND_xPos must be >= 0')
            );
        }

        if (yPosValue < 0 || isNaN(yPosValue)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'GND_yPos must be >= 0')
            );
        }

        // Validate antenna stays within ground plane (25mm antenna size)
        const ANTENNA_SIZE = 25;
        const halfAntenna = ANTENNA_SIZE / 2;
        
        if (xPosValue - halfAntenna < 0 || xPosValue + halfAntenna > lgxValue) {
            logger.error('Antenna X position exceeds ground plane', {
                xPos: xPosValue,
                lgx: lgxValue,
                antennaSize: ANTENNA_SIZE
            });
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 
                    `Antenna position would exceed ground plane X dimension. Center at ${xPosValue}mm with 25mm antenna needs ground plane X >= ${xPosValue + halfAntenna}mm`
                )
            );
        }

        if (yPosValue - halfAntenna < 0 || yPosValue + halfAntenna > lgyValue) {
            logger.error('Antenna Y position exceeds ground plane', {
                yPos: yPosValue,
                lgy: lgyValue,
                antennaSize: ANTENNA_SIZE
            });
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null,
                    `Antenna position would exceed ground plane Y dimension. Center at ${yPosValue}mm with 25mm antenna needs ground plane Y >= ${yPosValue + halfAntenna}mm`
                )
            );
        }

        logger.info('Updating ground plane parameters', {
            projectPath,
            size: `${lgxValue}mm × ${lgyValue}mm`,
            position: `(${xPosValue}, ${yPosValue})`
        });

        // Extract project root directory from project path
        const projectRoot = path.dirname(projectPath);
        const fModelPath = path.join(projectRoot, 'Function', 'HFSS', 'F_Model_Element.m');

        logger.info('Target F_Model_Element.m path', { fModelPath });

        // Check if F_Model_Element.m exists
        const fileExists = fs.existsSync(fModelPath);
        
        if (!fileExists) {
            logger.error('F_Model_Element.m not found', { fModelPath });
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                message: 'F_Model_Element.m file not found. Please generate the F_Model first.',
                fModelPath: fModelPath,
                timestamp: new Date().toISOString()
            });
        }
        
        logger.info('F_Model_Element.m file found, proceeding with update');

        try {
            // Read the current F_Model_Element.m file
            let fModelContent = await fsPromises.readFile(fModelPath, 'utf-8');
            logger.info(`Read F_Model_Element.m (${fModelContent.length} characters)`);
            
            // Extract current values for comparison
            const currentLgx = fModelContent.match(/^Lgx = ([\d.]+);/m);
            const currentLgy = fModelContent.match(/^Lgy = ([\d.]+);/m);
            const currentXPos = fModelContent.match(/^GND_xPos = ([\d.]+);/m);
            const currentYPos = fModelContent.match(/^GND_yPos = ([\d.]+);/m);
            
            logger.info('Current values in file', {
                Lgx: currentLgx ? currentLgx[1] : 'NOT FOUND',
                Lgy: currentLgy ? currentLgy[1] : 'NOT FOUND',
                GND_xPos: currentXPos ? currentXPos[1] : 'NOT FOUND',
                GND_yPos: currentYPos ? currentYPos[1] : 'NOT FOUND'
            });

            // Check if ground plane variables exist
            const hasLgx = currentLgx !== null;
            const hasLgy = currentLgy !== null;
            const hasXPos = currentXPos !== null;
            const hasYPos = currentYPos !== null;
            const hasGroundPlane = hasLgx && hasLgy && hasXPos && hasYPos;

            if (!hasGroundPlane) {
                // Ground plane variables don't exist - ADD them
                logger.info('Ground plane variables not found - adding them to file');
                
                // Find the 'end' statement and insert ground plane variables before it
                const endPattern = /^end\s*$/m;
                const endMatch = fModelContent.match(endPattern);
                
                if (endMatch) {
                    const groundPlaneCode = `
% Custom variable: Lgx - Custom value
Lgx = ${lgxValue};  % Ground plane length X (mm) - user configured
hfssChangeVar(fid,'Lgx',Lgx,'mm');

% Custom variable: Lgy - Custom value
Lgy = ${lgyValue};  % Ground plane length Y (mm) - user configured
hfssChangeVar(fid,'Lgy',Lgy,'mm');

% Custom variable: GND_xPos - Custom value
GND_xPos = ${xPosValue};  % Antenna X center position (mm) - user configured
hfssChangeVar(fid,'GND_xPos',GND_xPos,'mm');

% Custom variable: GND_yPos - Custom value
GND_yPos = ${yPosValue};  % Antenna Y center position (mm) - user configured
hfssChangeVar(fid,'GND_yPos',GND_yPos,'mm');

`;
                    fModelContent = fModelContent.replace(endPattern, groundPlaneCode + 'end');
                    logger.info('Added all ground plane variables with user values');
                } else {
                    logger.error('Could not find end statement in file');
                    return res.status(HTTP_STATUS.INTERNAL_ERROR).json(
                        createResponse(false, null, 'Could not add ground plane variables - file structure unexpected')
                    );
                }
            } else {
                // Ground plane variables exist - UPDATE them
                logger.info('Ground plane variables found - updating values');

                // Update Lgx value
                const lgxRegex = /^Lgx = \d+(\.\d+)?;/m;
                const lgRegex = /^Lg = \d+(\.\d+)?;/m;
                if (lgxRegex.test(fModelContent)) {
                    fModelContent = fModelContent.replace(lgxRegex, `Lgx = ${lgxValue};`);
                    logger.info(`Updated Lgx: ${currentLgx[1]} -> ${lgxValue}`);
                } else if (lgRegex.test(fModelContent)) {
                    fModelContent = fModelContent.replace(lgRegex, `Lg = ${lgxValue};`);
                    logger.info(`Updated Lg (legacy) to ${lgxValue}`);
                }

                // Update Lgy value
                const lgyRegex = /^Lgy = \d+(\.\d+)?;/m;
                if (lgyRegex.test(fModelContent)) {
                    fModelContent = fModelContent.replace(lgyRegex, `Lgy = ${lgyValue};`);
                    logger.info(`Updated Lgy: ${currentLgy[1]} -> ${lgyValue}`);
                }

                // Update GND_xPos value
                const xPosRegex = /^GND_xPos = \d+(\.\d+)?;/m;
                if (xPosRegex.test(fModelContent)) {
                    fModelContent = fModelContent.replace(xPosRegex, `GND_xPos = ${xPosValue};`);
                    logger.info(`Updated GND_xPos: ${currentXPos[1]} -> ${xPosValue}`);
                }

                // Update GND_yPos value
                const yPosRegex = /^GND_yPos = \d+(\.\d+)?;/m;
                if (yPosRegex.test(fModelContent)) {
                    fModelContent = fModelContent.replace(yPosRegex, `GND_yPos = ${yPosValue};`);
                    logger.info(`Updated GND_yPos: ${currentYPos[1]} -> ${yPosValue}`);
                }
            }

            // Write the updated content back to the file
            await fsPromises.writeFile(fModelPath, fModelContent, 'utf-8');
            logger.info('Successfully updated F_Model_Element.m');

            res.json({
                success: true,
                message: 'Ground plane parameters updated successfully in F_Model_Element.m',
                parameters: {
                    Lgx: lgxValue,
                    Lgy: lgyValue,
                    GND_xPos: xPosValue,
                    GND_yPos: yPosValue
                },
                fModelPath: fModelPath,
                timestamp: new Date().toISOString()
            });

        } catch (fileError) {
            logger.error('Error updating F_Model_Element.m', { error: fileError.message, stack: fileError.stack });
            return res.status(HTTP_STATUS.INTERNAL_ERROR).json({
                success: false,
                message: 'Failed to update F_Model_Element.m file',
                error: fileError.message,
                fModelPath: fModelPath,
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        logger.error('Error in update-ground-plane endpoint', {
            error: error.message,
            stack: error.stack
        });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            message: 'Failed to update ground plane parameters',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /api/matlab/generate-gnd-import
 * Generate F_GND_Import.m for custom DXF ground planes
 */
router.post('/generate-gnd-import', async (req, res) => {
    try {
        const { dxfPath, gndXPos, gndYPos, projectPath, mode } = req.body;

        // Validate projectPath (always required)
        if (!projectPath || typeof projectPath !== 'string') {
            logger.error('Invalid projectPath provided');
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'projectPath string is required')
            );
        }
        
        // Validate and sanitize projectPath
        const pathValidation = validatePath(projectPath);
        if (!pathValidation.valid) {
            logger.error('Path validation failed', { error: pathValidation.error });
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'Invalid project path', pathValidation.error)
            );
        }

        // Extract project root directory
        const projectRoot = path.dirname(projectPath);
        
        // Load setup config for Python path
        let setupConfig;
        try {
            setupConfig = require(path.join(__dirname, '..', '..', 'OPEN_THIS', 'SETUP', 'setup_loader'));
        } catch (error) {
            logger.warn('Setup config not found, using default python', { error: error.message });
        }
        
        const pythonExecutable = setupConfig ? setupConfig.getPythonExecutable() : 'python';
        const pythonScriptPath = path.join(__dirname, '..', '..', 'scripts', 'generate_gnd_import.py');

        // Mode: 'clear' or 'import'
        if (mode === 'clear' || !dxfPath || dxfPath === '' || dxfPath === 'none') {
            // CLEAR MODE: Generate empty F_GND_Import.m
            logger.info('Generating empty F_GND_Import.m (no custom GND)', { projectRoot });
            
            const pythonCommand = `"${pythonExecutable}" "${pythonScriptPath}" "${projectRoot}"`;
            logger.info('Executing Python command', { command: pythonCommand });
            
            exec(pythonCommand, (error, stdout, stderr) => {
                if (error) {
                    logger.error('Python script execution failed', {
                        error: error.message,
                        stderr,
                        stdout
                    });
                    
                    return res.status(HTTP_STATUS.INTERNAL_ERROR).json({
                        success: false,
                        message: 'Failed to generate empty ground plane file',
                        error: stderr || error.message,
                        timestamp: new Date().toISOString()
                    });
                }

                logger.info('Empty F_GND_Import.m generated successfully', { stdout });

                const outputPath = path.join(projectRoot, 'Function', 'HFSS', 'F_GND_Import.m');

                res.json({
                    success: true,
                    message: 'F_GND_Import.m cleared (no custom GND)',
                    mode: 'clear',
                    outputFile: outputPath,
                    pythonOutput: stdout,
                    timestamp: new Date().toISOString()
                });
            });
            
        } else {
            // IMPORT MODE: Generate F_GND_Import.m with custom DXF
            
            // Validate required parameters for import mode
            if (typeof dxfPath !== 'string') {
                logger.error('Invalid dxfPath provided');
                return res.status(HTTP_STATUS.BAD_REQUEST).json(
                    createResponse(false, null, 'dxfPath string is required for import mode')
                );
            }

            if (gndXPos === undefined || gndXPos === null || isNaN(Number(gndXPos))) {
                logger.error('Invalid gndXPos provided');
                return res.status(HTTP_STATUS.BAD_REQUEST).json(
                    createResponse(false, null, 'gndXPos numeric value is required for import mode')
                );
            }

            if (gndYPos === undefined || gndYPos === null || isNaN(Number(gndYPos))) {
                logger.error('Invalid gndYPos provided');
                return res.status(HTTP_STATUS.BAD_REQUEST).json(
                    createResponse(false, null, 'gndYPos numeric value is required for import mode')
                );
            }
            
            logger.info('Generating F_GND_Import.m for custom DXF ground plane', {
                dxfPath,
                position: `X=${gndXPos}, Y=${gndYPos}`,
                projectRoot
            });

            // Execute Python script to generate F_GND_Import.m with DXF import
            const pythonCommand = `"${pythonExecutable}" "${pythonScriptPath}" "${dxfPath}" ${gndXPos} ${gndYPos} "${projectRoot}"`;
            
            logger.info('Executing Python command', { command: pythonCommand });
            
            exec(pythonCommand, (error, stdout, stderr) => {
                if (error) {
                    logger.error('Python script execution failed', {
                        error: error.message,
                        stderr,
                        stdout
                    });
                    
                    return res.status(HTTP_STATUS.INTERNAL_ERROR).json({
                        success: false,
                        message: 'Ground plane generation failed',
                        error: stderr || error.message,
                        timestamp: new Date().toISOString()
                    });
                }

                logger.info('Python script executed successfully', { stdout });

                // Expected output path
                const outputPath = path.join(projectRoot, 'Function', 'HFSS', 'F_GND_Import.m');

                res.json({
                    success: true,
                    message: 'F_GND_Import.m generated successfully',
                    mode: 'import',
                    parameters: {
                        dxfPath: dxfPath,
                        gndXPos: Number(gndXPos),
                        gndYPos: Number(gndYPos)
                    },
                    outputFile: outputPath,
                    pythonOutput: stdout,
                    timestamp: new Date().toISOString()
                });
            });
        }

    } catch (error) {
        logger.error('Error in generate-gnd-import endpoint', {
            error: error.message,
            stack: error.stack
        });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            message: 'Failed to generate custom GND import',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;
