/**
 * MATLAB execution and control routes
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const processManager = require('../services/processManager');
const websocketManager = require('../services/websocketManager');
const { createResponse } = require('../utils/helpers');
const { HTTP_STATUS } = require('../config/constants');
const logger = require('../config/logger');

/**
 * Helper: Get MATLAB processes
 */
async function getMatlabProcesses() {
    return new Promise((resolve) => {
        exec('tasklist /FI "IMAGENAME eq MATLAB.exe" /FO CSV /NH', (error, stdout) => {
            if (error || !stdout) {
                resolve([]);
                return;
            }
            const lines = stdout.trim().split('\n').filter(line => line.includes('MATLAB.exe'));
            const processes = lines.map(line => {
                const parts = line.replace(/"/g, '').split(',');
                return {
                    name: parts[0] || '',
                    pid: parts[1] || '',
                    sessionName: parts[2] || '',
                    memUsage: parts[4] || ''
                };
            });
            resolve(processes);
        });
    });
}

/**
 * Helper: Detect HFSS processes
 */
async function detectHFSSProcesses() {
    return new Promise((resolve) => {
        exec('tasklist /FI "IMAGENAME eq ansysedt.exe" /FO CSV /NH', (error, stdout) => {
            if (error || !stdout) {
                resolve([]);
                return;
            }
            const lines = stdout.trim().split('\n').filter(line => line.includes('ansysedt.exe'));
            const processes = lines.map(line => {
                const parts = line.replace(/"/g, '').split(',');
                return {
                    name: parts[0] || '',
                    pid: parts[1] || '',
                    sessionName: parts[2] || '',
                    memUsage: parts[4] || ''
                };
            });
            resolve(processes);
        });
    });
}

/**
 * Helper: Terminate a process by PID
 */
function terminateProcess(pid, processName, forceKill = false) {
    return new Promise((resolve) => {
        const killCommand = forceKill ? `taskkill /F /PID ${pid}` : `taskkill /PID ${pid}`;
        
        exec(killCommand, (error, stdout, stderr) => {
            if (error) {
                resolve({ success: false, pid, processName, error: error.message });
            } else {
                resolve({ success: true, pid, processName });
            }
        });
    });
}

/**
 * Helper: Terminate all HFSS processes
 */
async function terminateAllHFSSProcesses(forceKill = false) {
    const hfssProcesses = await detectHFSSProcesses();
    
    if (hfssProcesses.length === 0) {
        return { terminated: [], failed: [] };
    }
    
    const terminated = [];
    const failed = [];
    
    const terminationPromises = hfssProcesses.map(process => 
        terminateProcess(process.pid, process.name, forceKill)
    );
    
    const results = await Promise.all(terminationPromises);
    
    results.forEach(result => {
        if (result.success) {
            terminated.push(result);
        } else {
            failed.push(result);
        }
    });
    
    return { terminated, failed };
}

/**
 * GET /api/matlab/status
 * Get current MATLAB execution status with process details
 */
router.get('/status', async (req, res) => {
    try {
        const state = processManager.getState();
        const matlabProcesses = await getMatlabProcesses();
        const hfssProcesses = await detectHFSSProcesses();
        
        const matlabRunning = matlabProcesses.length > 0;
        
        // Update state based on actual processes
        if (state.isRunning && !matlabRunning) {
            processManager.updateState({ isRunning: false });
        } else if (!state.isRunning && matlabRunning && !state.fileName) {
            processManager.updateState({
                isRunning: true,
                fileName: 'MATLAB (external start)',
                startTime: new Date(),
                processId: matlabProcesses[0]?.pid || 'Unknown'
            });
        }

        const statusData = {
            success: true,
            execution: processManager.getState(),
            processDetails: {
                matlab: {
                    running: matlabRunning,
                    count: matlabProcesses.length,
                    processes: matlabProcesses.map(p => ({
                        pid: p.pid,
                        name: p.name,
                        memoryUsage: p.memUsage,
                        sessionName: p.sessionName
                    }))
                },
                hfss: {
                    running: hfssProcesses.length > 0,
                    count: hfssProcesses.length,
                    processes: hfssProcesses.map(p => ({
                        pid: p.pid,
                        name: p.name,
                        memoryUsage: p.memUsage,
                        sessionName: p.sessionName
                    }))
                }
            },
            hfssProcesses: hfssProcesses.map(p => p.name),
            matlabProcessRunning: matlabRunning,
            timestamp: new Date().toISOString()
        };

        // Broadcast status to WebSocket clients
        websocketManager.broadcastStatus(statusData);

        res.json(statusData);
    } catch (error) {
        logger.error('Error getting status', { error: error.message });
        
        // Return default state even on error to prevent app crashes
        const defaultState = {
            success: false,
            execution: {
                isRunning: false,
                fileName: null,
                startTime: null,
                processId: null,
                filePath: null,
                fileDir: null,
                hfssProcesses: [],
                status: 'idle'
            },
            processDetails: {
                matlab: { running: false, count: 0, processes: [] },
                hfss: { running: false, count: 0, processes: [] }
            },
            hfssProcesses: [],
            matlabProcessRunning: false,
            timestamp: new Date().toISOString(),
            error: error.message
        };
        
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(defaultState);
    }
});

/**
 * POST /api/matlab/run
 * Start MATLAB script execution
 */
router.post('/run', async (req, res) => {
    try {
        const { filePath } = req.body;

        if (!filePath) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'File path is required')
            );
        }

        // Check if already running
        if (processManager.isRunning()) {
            const state = processManager.getState();
            return res.status(HTTP_STATUS.CONFLICT).json(
                createResponse(false, { currentExecution: state }, 'MATLAB script is already running')
            );
        }

        // Extract file info
        const fileName = path.basename(filePath);
        const fileDir = path.dirname(filePath);
        const matlabDir = fileDir.replace(/\\/g, '/');
        const matlabFilePath = filePath.replace(/\\/g, '/');

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(HTTP_STATUS.NOT_FOUND).json(
                createResponse(false, null, `File not found: ${fileName}`)
            );
        }

        logger.info(`Starting MATLAB script: ${fileName}`);

        // MATLAB command
        const matlabCommand = `cd('${matlabDir}'); open('${matlabFilePath}'); pause(2); run('${matlabFilePath}'); disp('=== EXECUTION COMPLETED ===');`;

        // Start MATLAB process
        const processResult = await processManager.startMatlabProcess({
            command: 'matlab',
            args: ['-r', matlabCommand],
            cwd: fileDir,
            metadata: {
                fileName,
                filePath,
                fileDir
            }
        });

        // Set up periodic check to ensure MATLAB is still running
        const processCheckInterval = setInterval(async () => {
            if (processManager.isRunning()) {
                const matlabProcesses = await getMatlabProcesses();
                if (matlabProcesses.length === 0) {
                    logger.info('MATLAB process no longer detected in system, updating state');
                    processManager.reset();
                    clearInterval(processCheckInterval);
                    // Broadcast status change
                    websocketManager.broadcast({
                        type: 'status',
                        data: processManager.getState()
                    });
                }
            } else {
                clearInterval(processCheckInterval);
            }
        }, 5000); // Check every 5 seconds

        // Broadcast initial status change via WebSocket
        websocketManager.broadcast({
            type: 'status',
            data: processManager.getState()
        });

        // Return response matching V1 format (execution key instead of data key)
        res.json({
            success: true,
            message: 'MATLAB execution started',
            execution: processManager.getState()
        });

    } catch (error) {
        logger.error('Error starting MATLAB', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, 'Failed to start MATLAB execution')
        );
    }
});

/**
 * POST /api/matlab/stop
 * Stop MATLAB execution and terminate all related processes
 */
router.post('/stop', async (req, res) => {
    try {
        logger.info('Stop request - terminating processes...');
        
        // Get current MATLAB and HFSS processes
        const currentMatlabProcesses = await getMatlabProcesses();
        const currentHfssProcesses = await detectHFSSProcesses();
        
        logger.info(`Found: ${currentMatlabProcesses.length} MATLAB, ${currentHfssProcesses.length} HFSS`);
        
        if (currentMatlabProcesses.length === 0 && currentHfssProcesses.length === 0) {
            logger.info('No processes to terminate');
            processManager.reset();
            
            // Broadcast status change
            websocketManager.broadcast({
                type: 'status',
                data: processManager.getState()
            });
            
            return res.json({
                success: true,
                message: 'No MATLAB or HFSS processes running',
                terminated: { matlab: [], hfss: [] },
                failed: { matlab: [], hfss: [] }
            });
        }
        
        const matlabTerminationResults = [];
        const hfssTerminationResults = { terminated: [], failed: [] };
        
        // Graceful MATLAB termination
        if (currentMatlabProcesses.length > 0) {
            for (const matlabProc of currentMatlabProcesses) {
                const result = await terminateProcess(matlabProc.pid, 'MATLAB.exe', false);
                matlabTerminationResults.push(result);
            }
        }
        
        // Graceful HFSS termination
        if (currentHfssProcesses.length > 0) {
            logger.info(`Attempting graceful termination of ${currentHfssProcesses.length} HFSS process(es)`);
            const hfssResults = await terminateAllHFSSProcesses(false);
            hfssTerminationResults.terminated.push(...hfssResults.terminated);
            hfssTerminationResults.failed.push(...hfssResults.failed);
        }
        
        // Wait for graceful termination
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Check remaining processes and force kill if necessary
        const remainingMatlab = await getMatlabProcesses();
        const remainingHfss = await detectHFSSProcesses();
        
        // Force kill remaining processes
        if (remainingMatlab.length > 0) {
            logger.info(`Force killing ${remainingMatlab.length} remaining MATLAB process(es)`);
            for (const matlabProc of remainingMatlab) {
                const forceResult = await terminateProcess(matlabProc.pid, 'MATLAB.exe', true);
                matlabTerminationResults.push(forceResult);
            }
        }
        
        if (remainingHfss.length > 0) {
            logger.info(`Force killing ${remainingHfss.length} remaining HFSS process(es)`);
            const forceHfssResults = await terminateAllHFSSProcesses(true);
            hfssTerminationResults.terminated.push(...forceHfssResults.terminated);
            hfssTerminationResults.failed.push(...forceHfssResults.failed);
        }
        
        // Final verification
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const finalMatlab = await getMatlabProcesses();
        const finalHfss = await detectHFSSProcesses();
        
        const allTerminated = matlabTerminationResults.filter(r => r.success).length + hfssTerminationResults.terminated.length;
        if (allTerminated > 0) {
            logger.info(`Terminated ${allTerminated} processes`);
        }
        
        // Reset execution state
        processManager.reset();
        
        // Broadcast status change to all connected clients
        websocketManager.broadcast({
            type: 'status',
            data: processManager.getState()
        });
        
        // Prepare response
        const matlabTerminated = matlabTerminationResults.filter(r => r.success);
        const matlabFailed = matlabTerminationResults.filter(r => !r.success);
        
        const allTerminatedCount = matlabTerminated.length + hfssTerminationResults.terminated.length;
        const allFailedCount = matlabFailed.length + hfssTerminationResults.failed.length;
        
        const isSuccess = finalMatlab.length === 0 && finalHfss.length === 0;
        
        res.json({
            success: isSuccess,
            message: isSuccess 
                ? `All processes terminated successfully (${allTerminatedCount} total)`
                : `Some processes may still be running (${allFailedCount} failed)`,
            summary: {
                totalProcessesFound: currentMatlabProcesses.length + currentHfssProcesses.length,
                totalTerminated: allTerminatedCount,
                totalFailed: allFailedCount,
                remainingMatlab: finalMatlab.length,
                remainingHfss: finalHfss.length
            },
            terminated: {
                matlab: matlabTerminated.map(r => ({ pid: r.pid, name: r.processName })),
                hfss: hfssTerminationResults.terminated.map(r => ({ pid: r.pid, name: r.processName }))
            },
            failed: {
                matlab: matlabFailed.map(r => ({ pid: r.pid, name: r.processName, error: r.error })),
                hfss: hfssTerminationResults.failed.map(r => ({ pid: r.pid, name: r.processName, error: r.error }))
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('Termination error', { error: error.message });
        
        // Emergency reset
        processManager.reset();
        
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            message: 'Error during process termination',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/matlab/check
 * Check if MATLAB is installed and accessible
 */
router.get('/check', (req, res) => {
    exec('matlab -batch "disp(\'MATLAB available\')"', { timeout: 5000 }, (error, stdout, stderr) => {
        if (error) {
            return res.json(createResponse(false, null, 'MATLAB not found or not accessible'));
        }
        res.json(createResponse(true, { output: stdout }, 'MATLAB is available'));
    });
});

/**
 * POST /api/matlab/check-file
 * Check if MATLAB file exists (checks both .m and .mlx files)
 */
router.post('/check-file', (req, res) => {
    try {
        const { filePath } = req.body;

        if (!filePath) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                message: 'File path is required'
            });
        }

        logger.info(`Checking if file exists: ${filePath}`);

        // Check if directory exists first
        const dirExists = fs.existsSync(path.dirname(filePath));
        
        // Check for both .m and .mlx files
        let mFilePath, mlxFilePath;
        
        if (filePath.endsWith('.m')) {
            mFilePath = filePath;
            mlxFilePath = filePath.slice(0, -2) + '.mlx';
        } else if (filePath.endsWith('.mlx')) {
            mlxFilePath = filePath;
            mFilePath = filePath.slice(0, -4) + '.m';
        } else {
            // No extension, add both
            mFilePath = filePath + '.m';
            mlxFilePath = filePath + '.mlx';
        }
        
        const mExists = fs.existsSync(mFilePath);
        const mlxExists = fs.existsSync(mlxFilePath);
        const exists = mExists || mlxExists;
        
        const fileInfo = {
            exists: exists,
            mFile: mExists,
            mlxFile: mlxExists
        };
        
        if (exists) {
            try {
                if (mExists) {
                    const stats = fs.statSync(mFilePath);
                    fileInfo.mSize = stats.size;
                    fileInfo.mLastModified = stats.mtime.toISOString();
                    logger.info(`.m file found: ${mFilePath} (${stats.size} bytes)`);
                }
                if (mlxExists) {
                    const stats = fs.statSync(mlxFilePath);
                    fileInfo.mlxSize = stats.size;
                    fileInfo.mlxLastModified = stats.mtime.toISOString();
                    logger.info(`.mlx file found: ${mlxFilePath} (${stats.size} bytes)`);
                }
            } catch (statError) {
                logger.warn('File exists but could not get stats', { error: statError.message });
            }
        } else {
            logger.warn('Neither .m nor .mlx file found', { mFilePath, mlxFilePath });
            
            // Debug: List directory contents if directory exists
            if (dirExists) {
                try {
                    const dirContents = fs.readdirSync(path.dirname(filePath));
                    logger.info(`Directory contents (${dirContents.length} items)`, {
                        directory: path.dirname(filePath),
                        files: dirContents.slice(0, 20) // Log first 20 items
                    });
                } catch (dirError) {
                    logger.error('Could not list directory', { error: dirError.message });
                }
            }
        }
        
        // Return file info directly (not wrapped in createResponse) for V1 compatibility
        res.json(fileInfo);
    } catch (error) {
        logger.error('Error checking file', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/matlab/reset
 * Reset MATLAB execution state
 */
router.post('/reset', (req, res) => {
    try {
        processManager.reset();
        res.json(createResponse(true, null, 'Process state reset'));
    } catch (error) {
        logger.error('Error resetting state', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, 'Failed to reset state')
        );
    }
});

/**
 * GET /api/matlab/iteration-count
 * Get current iteration count from CSV files
 */
router.get('/iteration-count', (req, res) => {
    const { projectPath } = req.query;

    if (!projectPath) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
            createResponse(false, null, 'Project path is required')
        );
    }

    const dataPath = path.join(projectPath, 'Optimization', 'data');

    if (!fs.existsSync(dataPath)) {
        return res.json(createResponse(true, { count: 0 }, 'No data folder found'));
    }

    try {
        const files = fs.readdirSync(dataPath);
        const s11Files = files.filter(f => f.startsWith('S11_') && f.endsWith('.csv'));
        const count = s11Files.length;

        res.json(createResponse(true, { count }, `Found ${count} iterations`));
    } catch (error) {
        logger.error('Error counting iterations', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, 'Error counting iterations')
        );
    }
});

/**
 * POST /api/matlab/apply-variables
 * Apply selected variables by generating F_Model_Element.m
 * (Backward compatibility endpoint - same as /api/variables/apply)
 */
router.post('/apply-variables', async (req, res) => {
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
