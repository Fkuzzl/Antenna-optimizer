/**
 * MATLAB execution and control routes
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const processManager = require('../services/processManager');
const progressiveTuningManager = require('../services/progressiveTuningManager');
const websocketManager = require('../services/websocketManager');
const { createMoeaProfile } = require('../services/moeaProfileManager');
const { getVerificationRuntimeState } = require('../services/moeaVerificationManager');
const { syncHfssPathForProject } = require('../services/hfssPathSync');
const { createResponse } = require('../utils/helpers');
const { HTTP_STATUS } = require('../config/constants');
const logger = require('../config/logger');

const setupConfigPath = path.join(__dirname, '..', '..', 'OPEN_THIS', 'SETUP', 'setup_loader');

function loadSetupConfig() {
    try {
        return require(setupConfigPath);
    } catch (error) {
        logger.warn('Setup config not found, using runtime defaults', { error: error.message });
        return null;
    }
}

function getConfiguredMatlabExecutable() {
    const setupConfig = loadSetupConfig();
    if (!setupConfig) return 'matlab';

    try {
        const matlabPaths = setupConfig.getMatlabPaths?.() || [];
        if (Array.isArray(matlabPaths) && matlabPaths.length > 0 && matlabPaths[0]) {
            return matlabPaths[0];
        }
    } catch {
        // fallback below
    }
    return 'matlab';
}

function normalizeProfileName(value) {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ');
    return normalized || null;
}

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
 * GET /api/matlab/runtime-state
 * Unified runtime detector used by UI to auto-navigate user to the correct page.
 * stage values:
 *  - progressive_tuning_running
 *  - final_simulation_running
 *  - final_simulation_finished
 *  - moea_tuning_running
 *  - idle
 */
router.get('/runtime-state', async (req, res) => {
    try {
        const matlabState = processManager.getState();
        const tuningState = progressiveTuningManager.getState();
        const tuningStatus = await progressiveTuningManager.getStatus();
        const verificationRuntime = await getVerificationRuntimeState(tuningState.projectPath || matlabState.projectPath || null);

        const tuningManagerStatus = tuningState.status || tuningStatus?.status;
        const progressiveRunning = tuningManagerStatus === 'running' || tuningManagerStatus === 'paused' || tuningManagerStatus === 'stopping';

        let stage = 'idle';
        let context = null;

        if (progressiveRunning) {
            stage = 'progressive_tuning_running';
            context = {
                projectPath: tuningState.projectPath,
                status: tuningManagerStatus,
                currentPhase: tuningStatus?.current_phase || 0,
            };
        } else if (verificationRuntime?.hasActiveVerification && verificationRuntime?.activeVerification) {
            stage = 'final_simulation_running';
            context = verificationRuntime.activeVerification;
        } else if (verificationRuntime?.latestFinishedVerification) {
            stage = 'final_simulation_finished';
            context = verificationRuntime.latestFinishedVerification;
        } else if (matlabState?.isRunning) {
            stage = 'moea_tuning_running';
            context = {
                projectPath: matlabState.projectPath || matlabState.fileDir || matlabState.filePath || null,
                fileName: matlabState.fileName || null,
                startTime: matlabState.startTime || null,
                processId: matlabState.processId || null,
            };
        }

        return res.json({
            success: true,
            stage,
            context,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        logger.error('[runtime-state] Failed to determine runtime state', { error: error.message });
        return res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            stage: 'idle',
            context: null,
            message: error.message,
        });
    }
});

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
            try {
                const projectPathForSnapshot = state.projectPath || state.fileDir || state.filePath;
                if (projectPathForSnapshot) {
                    await createMoeaProfile(projectPathForSnapshot, {
                        status: 'completed',
                        reason: 'normal-finish',
                        trigger: 'status-transition',
                        profileName: normalizeProfileName(state.profileName),
                    });
                    logger.info('[MOEAProfile] Completion profile snapshot created on status transition', {
                        projectPath: projectPathForSnapshot,
                    });
                }
            } catch (profileError) {
                logger.warn('[MOEAProfile] Failed to create completion snapshot', {
                    error: profileError.message,
                    projectPath: state.projectPath || state.fileDir || state.filePath,
                });
            }
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
        const { projectPath, filePath: legacyFilePath, profileName: requestedProfileName } = req.body;
            const normalizedProfileName = normalizeProfileName(requestedProfileName);

        const rawInput = projectPath || legacyFilePath;
        const inputPath = rawInput ? path.normalize(rawInput.trim()) : null;

        if (!inputPath) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'Project path is required')
            );
        }

        // Check if already running
        if (processManager.isRunning()) {
            const state = processManager.getState();
            return res.status(HTTP_STATUS.CONFLICT).json(
                createResponse(false, { currentExecution: state }, 'MATLAB script is already running')
            );
        }

        if (!fs.existsSync(inputPath)) {
            logger.warn(`[matlab/run] Path not found. Raw: "${path.normalize((projectPath||legacyFilePath||'').trim())}", Normalized: "${inputPath}"`);
            return res.status(HTTP_STATUS.NOT_FOUND).json(
                createResponse(false, null, `Path not found: ${inputPath}`)
            );
        }

        // Resolve script file: if directory, scan for .m or .mlx
        // Priority: Main_*.m > any *.m > Main_*.mlx > any *.mlx
        let scriptFile;
        const inputStat = fs.statSync(inputPath);
        if (inputStat.isDirectory()) {
            const entries = fs.readdirSync(inputPath);
            const mlxFiles = entries.filter(f => f.toLowerCase().endsWith('.mlx'));
            const mFiles   = entries.filter(f => f.toLowerCase().endsWith('.m') && !f.startsWith('.'));

            const mainM   = mFiles.find(f => f.toLowerCase().startsWith('main_'));
            const mainMlx = mlxFiles.find(f => f.toLowerCase().startsWith('main_'));
            const found   = mainM || mFiles[0] || mainMlx || mlxFiles[0];

            if (!found) {
                return res.status(HTTP_STATUS.NOT_FOUND).json(
                    createResponse(false, null, 'No .mlx or .m script file found in project directory')
                );
            }
            scriptFile = path.join(inputPath, found);
            logger.info(`[matlab/run] Selected script: ${found} (from ${mlxFiles.length} .mlx, ${mFiles.length} .m files)`);
        } else {
            scriptFile = inputPath;
        }

        const resolvedProjectPath = inputStat.isDirectory() ? inputPath : path.dirname(inputPath);

        // Extract file info
        const fileName = path.basename(scriptFile);
        const fileDir  = path.dirname(scriptFile);
        const matlabDir      = fileDir.replace(/\\/g, '/');
        const matlabFilePath = scriptFile.replace(/\\/g, '/');

        logger.info(`Starting MATLAB script: ${fileName} from ${resolvedProjectPath}`);

        // MATLAB command
        const matlabCommand = `cd('${matlabDir}'); open('${matlabFilePath}'); pause(2); run('${matlabFilePath}'); disp('=== EXECUTION COMPLETED ===');`;

        // Start MATLAB process
        const processResult = await processManager.startMatlabProcess({
            command: getConfiguredMatlabExecutable(),
            args: ['-r', matlabCommand],
            cwd: fileDir,
            metadata: {
                fileName,
                profileName: normalizedProfileName,
                filePath: scriptFile,
                fileDir,
                projectPath: resolvedProjectPath
            }
        });

        // Set up periodic check to ensure MATLAB is still running
        const processCheckInterval = setInterval(async () => {
            if (processManager.isRunning()) {
                const matlabProcesses = await getMatlabProcesses();
                if (matlabProcesses.length === 0) {
                    logger.info('MATLAB process no longer detected in system, updating state');
                    try {
                        const runningState = processManager.getState();
                        const projectPathForSnapshot = runningState.projectPath || runningState.fileDir || runningState.filePath;
                        if (projectPathForSnapshot) {
                            await createMoeaProfile(projectPathForSnapshot, {
                                status: 'completed',
                                reason: 'normal-finish',
                                trigger: 'process-watchdog',
                                profileName: normalizeProfileName(runningState.profileName),
                            });
                            logger.info('[MOEAProfile] Completion profile snapshot created from process watchdog', {
                                projectPath: projectPathForSnapshot,
                            });
                        }
                    } catch (profileError) {
                        logger.warn('[MOEAProfile] Failed to create completion snapshot from watchdog', {
                            error: profileError.message,
                        });
                    }
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
 * Unified stop endpoint for both MOEA tuning and Progressive Tuning.
 * Force-terminates all MATLAB and HFSS processes, then resets both
 * the MOEA process manager and the Progressive Tuning manager.
 */
router.post('/stop', async (req, res) => {
    try {
        const state = processManager.getState();
        const projectPathForSnapshot = state.projectPath || state.fileDir || state.filePath;
        if (state.isRunning && projectPathForSnapshot) {
            try {
                const snapshot = await createMoeaProfile(projectPathForSnapshot, {
                    status: 'stopped',
                    reason: 'manual-stop',
                    trigger: 'stop-endpoint',
                    profileName: normalizeProfileName(state.profileName),
                });
                logger.info('[MOEAProfile] Manual stop profile snapshot created', {
                    projectPath: projectPathForSnapshot,
                    profileId: snapshot.profileId,
                });
            } catch (profileError) {
                logger.warn('[MOEAProfile] Failed to create manual stop snapshot', {
                    error: profileError.message,
                    projectPath: projectPathForSnapshot,
                });
            }
        }

        // Hard kill for both MOEA and Progressive Tuning
        logger.info('Stop request - terminating processes...');
        if (progressiveTuningManager.isRunning()) {
            logger.info('[Stop] Progressive Tuning was active — will hard-kill and reset manager');
        }
        
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
        progressiveTuningManager.reset();

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
    const matlabExecutable = getConfiguredMatlabExecutable();
    exec(`"${matlabExecutable}" -batch "disp('MATLAB available')"`, { timeout: 5000 }, (error, stdout, stderr) => {
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
        const { projectPath, filePath: legacyFilePath } = req.body;
        const inputPathRaw = projectPath || legacyFilePath;
        const inputPath = String(inputPathRaw || '').trim().replace(/^"+|"+$/g, '');

        if (!inputPath) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                message: 'Project path or file path is required'
            });
        }

        logger.info(`Checking project files in: ${inputPath}`);

        // Determine if input is a directory or a file path
        let mFilePath, mlxFilePath;
        let dirExists = false;

        if (fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory()) {
            // Directory mode: scan for any .mlx / .m file
            dirExists = true;
            const entries = fs.readdirSync(inputPath);
            const foundMlx = entries.find(f => f.toLowerCase().endsWith('.mlx'));
            const foundM   = entries.find(f => f.toLowerCase().endsWith('.m') && !f.startsWith('.'));
            mlxFilePath = foundMlx ? path.join(inputPath, foundMlx) : null;
            mFilePath   = foundM   ? path.join(inputPath, foundM)   : null;
        } else {
            // Legacy file-path mode
            dirExists = fs.existsSync(path.dirname(inputPath));
            if (inputPath.endsWith('.m')) {
                mFilePath   = inputPath;
                mlxFilePath = inputPath.slice(0, -2) + '.mlx';
            } else if (inputPath.endsWith('.mlx')) {
                mlxFilePath = inputPath;
                mFilePath   = inputPath.slice(0, -4) + '.m';
            } else {
                mFilePath   = inputPath + '.m';
                mlxFilePath = inputPath + '.mlx';
            }
        }

        const projectDir = (fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory())
            ? inputPath
            : path.dirname(inputPath);
        const hfssPathSync = syncHfssPathForProject(projectDir);

        const mExists   = mFilePath   ? fs.existsSync(mFilePath)   : false;
        const mlxExists = mlxFilePath ? fs.existsSync(mlxFilePath) : false;
        const exists = mExists || mlxExists;
        
        const fileInfo = {
            exists: exists,
            mFile: mExists,
            mlxFile: mlxExists,
            hfssPathSync: {
                updated: !!hfssPathSync.updated,
                reason: hfssPathSync.reason,
                epConfigPath: hfssPathSync.epConfigPath || null,
                verificationConfigPath: hfssPathSync.verificationConfigPath || null,
            }
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
                    const debugDir = fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory()
                        ? inputPath : path.dirname(inputPath);
                    const dirContents = fs.readdirSync(debugDir);
                    logger.info(`Directory contents (${dirContents.length} items)`, {
                        directory: debugDir,
                        files: dirContents.slice(0, 20)
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

/**
 * POST /api/matlab/apply-tightened-variables
 * Prepares the MOEA project for a run using tightened ranges from progressive tuning:
 *   1. Backs up the existing Optimization/ directory if present.
 *   2. Regenerates F_Model_Element.m with the tightened variable ranges.
 *   3. Regenerates F_GND_Import.m (DXF mode) or patches GND parameters into
 *      F_Model_Element.m (parametric mode) using the profile's GND_config.
 *
 * Body: {
 *   projectPath: string,
 *   tightenedRanges: { varName: [min, max], ... },
 *   gndConfig: { use_DXF: bool, Lgx, Lgy, xPos, yPos, dxf_file_path? } | null
 * }
 */
router.post('/apply-tightened-variables', async (req, res) => {
    const { promisify } = require('util');
    const execAsync = promisify(require('child_process').exec);
    const os = require('os');
    try {
        let { projectPath, tightenedRanges, gndConfig } = req.body;

        // Fallback: if client didn't supply a path use the path the progressive
        // tuning manager already knows about.
        if (!projectPath || !projectPath.trim()) {
            projectPath = progressiveTuningManager.getState().projectPath || '';
        }

        if (!projectPath || typeof projectPath !== 'string') {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'projectPath string is required')
            );
        }
        if (!tightenedRanges || typeof tightenedRanges !== 'object' ||
            Object.keys(tightenedRanges).length === 0) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'tightenedRanges object with at least one variable is required')
            );
        }
        if (!fs.existsSync(projectPath)) {
            return res.status(HTTP_STATUS.NOT_FOUND).json(
                createResponse(false, null, `Project path not found: ${projectPath}`)
            );
        }

        const varNames = Object.keys(tightenedRanges);
        logger.info('apply-tightened-variables: starting', { projectPath, variables: varNames, gndConfig });

        let setupConfig;
        try {
            setupConfig = require(path.join(__dirname, '..', '..', 'OPEN_THIS', 'SETUP', 'setup_loader'));
        } catch {
            logger.warn('Setup config not found, using default python');
        }
        const pythonExecutable = setupConfig ? setupConfig.getPythonExecutable() : 'python';

        // ── Step 1: Backup existing Optimization/ directory ──────────────────
        const optimizationDir = path.join(projectPath, 'Optimization');
        if (fs.existsSync(optimizationDir)) {
            const backupScript = path.join(__dirname, '..', '..', 'scripts', 'manage_optimization_data.py');
            try {
                const { stdout: bkOut } = await execAsync(
                    `"${pythonExecutable}" "${backupScript}" "backup-and-remove" "${projectPath}"`
                );
                logger.info('Optimization directory backed up', { stdout: bkOut.trim() });
            } catch (bkErr) {
                // Non-fatal: log and continue
                logger.warn('Optimization backup warning (continuing)', { error: bkErr.message });
            }
        }

        // ── Step 1b: Clear old Integrated_Results.xlsx so MOEA/D starts fresh ──
        const excelPath = path.join(projectPath, 'Integrated_Results.xlsx');
        if (fs.existsSync(excelPath)) {
            try {
                fs.unlinkSync(excelPath);
                logger.info('Integrated_Results.xlsx cleared for fresh MOEA/D run');
            } catch (xlErr) {
                // Non-fatal: log and continue
                logger.warn('Could not delete Integrated_Results.xlsx (continuing)', { error: xlErr.message });
            }
        }

        // ── Step 2: Generate F_Model_Element.m with tightened ranges ─────────
        const tmpFile = path.join(os.tmpdir(), `tightened_${Date.now()}.json`);
        fs.writeFileSync(tmpFile, JSON.stringify(tightenedRanges));
        const fModelScript = path.join(__dirname, '..', '..', 'scripts', 'generate_f_model.py');
        try {
            const { stdout, stderr } = await execAsync(
                `"${pythonExecutable}" "${fModelScript}" --tightened-file "${tmpFile}" "${projectPath}"`
            );
            if (stderr) logger.warn('Python stderr (F_Model)', { stderr });
            logger.info('F_Model_Element.m (tightened) generated', { variables: varNames, stdout: stdout.trim() });
        } finally {
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        }

        // ── Step 3: Apply GND config ──────────────────────────────────────────
        if (gndConfig && typeof gndConfig === 'object') {
            const { use_DXF, Lgx, Lgy, xPos, yPos, dxf_file_path } = gndConfig;

            if (use_DXF) {
                // DXF mode: regenerate F_GND_Import.m for this profile's DXF file
                if (!dxf_file_path) {
                    logger.warn('GND config has use_DXF=true but no dxf_file_path, skipping GND step');
                } else {
                    const gndScript = path.join(__dirname, '..', '..', 'scripts', 'generate_gnd_import.py');
                    try {
                        const { stdout: gndOut, stderr: gndErr } = await execAsync(
                            `"${pythonExecutable}" "${gndScript}" "${dxf_file_path}" "${parseFloat(xPos)}" "${parseFloat(yPos)}" "${projectPath}"`
                        );
                        if (gndErr) logger.warn('Python stderr (GND import)', { gndErr });
                        logger.info('F_GND_Import.m regenerated (DXF mode)', { dxf: dxf_file_path, stdout: gndOut.trim() });
                    } catch (gndErr) {
                        logger.warn('F_GND_Import.m generation failed (continuing)', { error: gndErr.message });
                    }
                }
            } else {
                // Parametric mode: patch Lgx/Lgy/GND_xPos/GND_yPos into F_Model_Element.m
                const fModelPath = path.join(projectPath, 'Function', 'HFSS', 'F_Model_Element.m');
                if (fs.existsSync(fModelPath)) {
                    try {
                        let content = fs.readFileSync(fModelPath, 'utf8');
                        const lgxVal  = parseFloat(Lgx);
                        const lgyVal  = parseFloat(Lgy);
                        const xPosVal = parseFloat(xPos);
                        const yPosVal = parseFloat(yPos);

                        // Update existing var or insert before 'end'
                        // Update existing vars first
                        const pairs = [
                            ['Lgx',     lgxVal],
                            ['Lgy',     lgyVal],
                            ['GND_xPos', xPosVal],
                            ['GND_yPos', yPosVal],
                        ];
                        const toInsert = [];
                        for (const [varName, val] of pairs) {
                            const rx = new RegExp(`^${varName} = [\\d.]+;`, 'm');
                            if (rx.test(content)) {
                                content = content.replace(rx, `${varName} = ${val};`);
                            } else {
                                toInsert.push({ varName, val });
                            }
                        }
                        // Insert all missing vars as a single block before 'end'
                        if (toInsert.length > 0) {
                            const block = [
                                '',
                                '% Ground plane parameters (from progressive tuning profile)',
                                ...toInsert.flatMap(({ varName, val }) => [
                                    `${varName} = ${val};`,
                                    `hfssChangeVar(fid,'${varName}',${varName},'mm');`,
                                    '',
                                ]),
                            ].join('\n');
                            content = content.replace(/^end\s*$/m, `${block}\nend`);
                        }

                        fs.writeFileSync(fModelPath, content, 'utf8');
                        logger.info('Parametric GND vars patched into F_Model_Element.m',
                            { Lgx: lgxVal, Lgy: lgyVal, GND_xPos: xPosVal, GND_yPos: yPosVal });
                    } catch (gndErr) {
                        logger.warn('Parametric GND patch failed (continuing)', { error: gndErr.message });
                    }
                } else {
                    logger.warn('F_Model_Element.m not found for GND parametric patch', { fModelPath });
                }
            }
        } else {
            logger.info('No GND config provided — F_GND_Import.m left untouched');
        }

        res.json({
            success: true,
            message: `F_Model_Element.m generated with ${varNames.length} tightened variables`,
            variables: varNames,
            projectPath,  // return resolved path so client can sync its state
        });
    } catch (error) {
        logger.error('Error in apply-tightened-variables', { error: error.message, stack: error.stack });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, `Failed to apply tightened variables: ${error.message}`)
        );
    }
});

module.exports = router;
