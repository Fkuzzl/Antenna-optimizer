/**
 * Progressive Tuning Manager Service
 * Handles the progressive GPS CP antenna tuning process lifecycle.
 * 
 * This pre-optimization phase runs 3 sequential phases:
 *   Phase 1: Resonant frequency tuning → 1.575 GHz
 *   Phase 2: Impedance matching → VSWR < 1.5
 *   Phase 3: CP loop optimization → AR < 2 dB
 * 
 * Communication with MATLAB is via:
 *   - status.json  (MATLAB writes, app reads)
 *   - control.json (app writes, MATLAB reads)
 *   - tightened_ranges.mat/.csv (final output)
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { spawn, exec } = require('child_process');
const logger = require('../config/logger');
const { PROCESS_STATES } = require('../config/constants');

// Default tuning variable configuration
const DEFAULT_TUNING_VARIABLES = {
    probex: { value: 2.1,   unit: 'mm',  min: 1.5,   max: 4.5,   description: 'Feed probe position' },
    purple: { value: 1.2,   unit: 'mm',  min: 0.5,   max: 3.0,   description: 'Impedance matching strip' },
    ngreen: { value: 0.2,   unit: 'mm',  min: 0.1,   max: 0.4,   description: 'Half-sphere cut size' },
    orange: { value: 30,    unit: 'deg', min: 10,    max: 90,    description: 'L3 arm angle (CP loop)' },
    orange2:{ value: 55,    unit: 'deg', min: 10,    max: 90,    description: 'L4 arm angle (CP loop)' },
    brown:  { value: 1.6,   unit: 'mm',  min: 0.5,   max: 1.7,   description: 'T-strip gap' },
    bluel:  { value: 10.54, unit: 'mm',  min: 10.39, max: 10.60, description: 'Blue-L patch length' },
};

const TERMINAL_STATUSES = new Set(['completed', 'error', 'cancelled', 'stopped', 'invalid', 'invalid_initial']);

// Phase definitions
const PHASES = [
    { id: 1, name: 'Resonant Frequency',    target: '1.575 GHz',   variables: ['brown', 'ngreen', 'bluel'], estimatedSims: '5-8' },
    { id: 2, name: 'Impedance Matching',     target: 'VSWR < 1.5',  variables: ['probex', 'purple'],         estimatedSims: '6-12' },
    { id: 3, name: 'CP Loop Optimization',   target: 'AR < 2 dB',   variables: ['orange', 'orange2'],        estimatedSims: '10-15' },
];

class ProgressiveTuningManager {
    constructor() {
        this.state = {
            status: 'idle',          // idle | running | paused | completed | error | cancelled
            projectPath: null,
            earlyPhaseDir: null,
            startTime: null,
            matlabProcess: null,
            matlabPid: null,
            lastStatusUpdate: null,
            gndConfig: null,
            initialVariables: null,
            cachedStatus: null,
            cachedResults: null,
            launcherExited: false,   // True when the matlab launcher process exits (normal on Windows)
            matlabAlive: false,      // True when actual MATLAB.exe is detected running
            lastMatlabCheck: null,   // Timestamp of last MATLAB process check
            lastErrorOutput: '',     // Last stderr text captured from MATLAB
        };
        
        this._statusPollInterval = null;
    }

    /**
     * Gets the current tuning state
     */
    getState() {
        return { ...this.state, matlabProcess: undefined }; // Don't expose process object
    }

    /**
     * Checks if tuning is currently running
     */
    isRunning() {
        return this.state.status === 'running' || this.state.status === 'paused';
    }

    /**
     * Returns default tuning variable definitions
     */
    static getDefaultVariables() {
        return JSON.parse(JSON.stringify(DEFAULT_TUNING_VARIABLES));
    }

    /**
     * Returns phase definitions
     */
    static getPhases() {
        return [...PHASES];
    }

    /**
     * Validates GND configuration
     */
    validateGndConfig(gndConfig) {
        if (!gndConfig) {
            return { valid: false, error: 'GND configuration is required' };
        }

        if (gndConfig.use_DXF) {
            if (!gndConfig.dxf_file_path || typeof gndConfig.dxf_file_path !== 'string') {
                return { valid: false, error: 'DXF file path is required when use_DXF is true' };
            }
            if (!gndConfig.dxf_file_path.toLowerCase().endsWith('.dxf')) {
                return { valid: false, error: 'File must be a .dxf file' };
            }
        } else {
            // Parametric mode
            const { Lgx, Lgy, xPos, yPos } = gndConfig;

            if (Lgx === undefined || Lgx === null || isNaN(parseFloat(Lgx)) || parseFloat(Lgx) <= 0) {
                return { valid: false, error: 'Lgx must be a positive number' };
            }
            if (Lgy === undefined || Lgy === null || isNaN(parseFloat(Lgy)) || parseFloat(Lgy) <= 0) {
                return { valid: false, error: 'Lgy must be a positive number' };
            }
            if (xPos === undefined || xPos === null || isNaN(parseFloat(xPos)) || parseFloat(xPos) <= 0) {
                return { valid: false, error: 'xPos must be a positive number' };
            }
            if (yPos === undefined || yPos === null || isNaN(parseFloat(yPos)) || parseFloat(yPos) <= 0) {
                return { valid: false, error: 'yPos must be a positive number' };
            }
            if (parseFloat(xPos) >= parseFloat(Lgx)) {
                return { valid: false, error: 'xPos must be less than Lgx' };
            }
            if (parseFloat(yPos) >= parseFloat(Lgy)) {
                return { valid: false, error: 'yPos must be less than Lgy' };
            }
        }

        return { valid: true };
    }

    /**
     * Validates optional starting variables
     */
    validateInitialVariables(vars) {
        if (!vars) return { valid: true }; // null = use defaults

        const errors = [];
        for (const [key, value] of Object.entries(vars)) {
            const def = DEFAULT_TUNING_VARIABLES[key];
            if (!def) {
                errors.push(`Unknown variable: ${key}`);
                continue;
            }
            const num = parseFloat(value);
            if (isNaN(num)) {
                errors.push(`${key} must be a number`);
            } else if (num < def.min || num > def.max) {
                errors.push(`${key} must be between ${def.min} and ${def.max} (got ${num})`);
            }
        }

        return errors.length > 0
            ? { valid: false, error: errors.join('; ') }
            : { valid: true };
    }

    /**
     * Resolves the EARLY_PHASE directory from the project path
     */
    _resolveEarlyPhaseDir(projectPath) {
        return path.join(projectPath, 'Function', 'EARLY_PHASE');
    }

    /**
     * Resolves paths for status.json and control.json
     */
    _resolveStatusPath(projectPath) {
        return path.join(this._resolveEarlyPhaseDir(projectPath), 'status.json');
    }

    _resolveControlPath(projectPath) {
        return path.join(this._resolveEarlyPhaseDir(projectPath), 'control.json');
    }

    _resolveResultsDir(projectPath, antennaName) {
        const folderName = antennaName || `run_${Date.now()}`;
        return path.join(this._resolveEarlyPhaseDir(projectPath), 'Results', folderName);
    }

    _classifyErrorText(text) {
        const raw = String(text || '').toLowerCase();
        if (!raw) return null;

        const hfssLicensePatterns = [
            /hfss[^\n]{0,80}license/,
            /license[^\n]{0,80}hfss/,
            /ansys[^\n]{0,80}license/,
            /license checkout failed/,
            /all licenses? (are )?in use/,
            /no licenses? available/,
            /failed to check out license/,
        ];

        if (hfssLicensePatterns.some((p) => p.test(raw))) {
            return 'hfss_license';
        }

        return null;
    }

    _withErrorClassification(status) {
        if (!status || typeof status !== 'object') return status;

        const statusName = status.status;
        if (statusName === 'invalid' || statusName === 'invalid_initial') {
            return { ...status, error_type: 'invalid' };
        }

        if (statusName === 'error') {
            const inferred = this._classifyErrorText(
                [
                    status.status_message,
                    status.phase_step,
                    status.error,
                    this.state.lastErrorOutput,
                ].filter(Boolean).join(' | ')
            ) || 'matlab_crash';
            return { ...status, error_type: status.error_type || inferred };
        }

        return status;
    }

    /**
     * Scans the Results/ folder for previous runs and their status.
     * Each run subfolder may contain:
     *   - profile.json  (MATLAB writes: status, GND_config, results summary)
     *   - checkpoint.mat (resumable checkpoint data)
     *   - status.json   (per-run status, written by MATLAB during execution)
     *
     * A run is "completed" if profile.json exists with status === "completed".
     * A run is "incomplete" if checkpoint.mat exists but profile says running/error or no profile.
     *
     * @param {string} projectPath
     * @returns {Array<{name, status, path, phase, timestamp, gnd_config, current_phase, total_simulations}>}
     */
    async scanRuns(projectPath) {
        const resultsDir = path.join(this._resolveEarlyPhaseDir(projectPath), 'Results');
        
        if (!fs.existsSync(resultsDir)) {
            return [];
        }

        const runs = [];
        try {
            const entries = await fsPromises.readdir(resultsDir, { withFileTypes: true });
            
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                
                const runPath = path.join(resultsDir, entry.name);
                const profilePath = path.join(runPath, 'profile.json');
                const checkpointPath = path.join(runPath, 'checkpoint.mat');
                const statusPath = path.join(runPath, 'status.json');
                
                const hasProfile = fs.existsSync(profilePath);
                const hasCheckpoint = fs.existsSync(checkpointPath);
                const hasStatus = fs.existsSync(statusPath);
                
                // Skip folders that have no recognisable files
                if (!hasProfile && !hasCheckpoint && !hasStatus) continue;
                
                let runStatus = 'incomplete';
                let phase = null;
                let currentPhase = null;
                let timestamp = null;
                let gndConfig = null;
                let totalSimulations = null;
                
                // Primary source: profile.json (written by MATLAB)
                if (hasProfile) {
                    try {
                        const profile = JSON.parse(await fsPromises.readFile(profilePath, 'utf8'));
                        runStatus = profile.status === 'completed' ? 'complete'
                                  : profile.status === 'invalid' ? 'invalid'
                                  : 'incomplete';
                        gndConfig = profile.GND_config || null;
                        timestamp = profile.timestamp || profile.created || null;
                        currentPhase = profile.current_phase ?? profile.phase ?? null;
                        totalSimulations = profile.total_simulations ?? null;
                        phase = currentPhase;
                    } catch (e) { /* ignore corrupt profile */ }
                }
                
                // Fallback: per-run status.json for phase info
                if (hasStatus && phase == null) {
                    try {
                        const statusData = JSON.parse(await fsPromises.readFile(statusPath, 'utf8'));
                        phase = statusData.current_phase ?? statusData.phase ?? null;
                        currentPhase = phase;
                        if (!timestamp) timestamp = statusData.timestamp || null;
                        if (totalSimulations == null) totalSimulations = statusData.total_simulations ?? null;
                        // If profile didn't exist, infer completion from status file
                        if (!hasProfile && statusData.status === 'completed') {
                            runStatus = 'complete';
                        }
                    } catch (e) { /* ignore */ }
                }
                
                // Get folder modification time as fallback timestamp
                if (!timestamp) {
                    try {
                        const stat = await fsPromises.stat(runPath);
                        timestamp = stat.mtime.toISOString();
                    } catch (e) { /* ignore */ }
                }
                
                runs.push({
                    name: entry.name,
                    status: runStatus,
                    path: runPath,
                    phase,
                    current_phase: currentPhase,
                    timestamp,
                    gnd_config: gndConfig,
                    total_simulations: totalSimulations,
                    has_checkpoint: hasCheckpoint,
                });
            }
        } catch (err) {
            logger.warn('[ProgressiveTuning] Error scanning runs', { error: err.message });
        }
        
        // Sort by timestamp descending (newest first)
        runs.sort((a, b) => {
            if (!a.timestamp) return 1;
            if (!b.timestamp) return -1;
            return new Date(b.timestamp) - new Date(a.timestamp);
        });
        
        return runs;
    }

    /**
     * Starts progressive tuning process
     * @param {Object} params - { projectPath, gndConfig, initialVariables, antennaName, resumeDir, mode }
     *   mode: 'create' (default) | 'resume'
     *   For 'resume', only projectPath and antennaName are needed.
     */
    /**
     * @param {boolean} [silent=false]
     *   false (default) → matlab -r  : visible MATLAB window, for debugging
     *   true            → matlab -batch: fully headless, no window, for production
     */
    async start({ projectPath, gndConfig, initialVariables, antennaName, resumeDir, mode, silent = false }) {
        if (this.isRunning()) {
            throw new Error('Progressive tuning is already running');
        }

        const isResume = mode === 'resume' || !!resumeDir;
        const effectiveName = antennaName || 'antenna1';

        // For 'create' mode, validate GND config and variables
        if (!isResume) {
            const gndValidation = this.validateGndConfig(gndConfig);
            if (!gndValidation.valid) {
                throw new Error(gndValidation.error);
            }

            const varValidation = this.validateInitialVariables(initialVariables);
            if (!varValidation.valid) {
                throw new Error(varValidation.error);
            }
        }

        // Check project path exists
        if (!fs.existsSync(projectPath)) {
            throw new Error(`Project path does not exist: ${projectPath}`);
        }

        // In create mode, do not overwrite an existing run folder/profile with the same antenna name.
        if (!isResume) {
            const existingRunDir = this._resolveResultsDir(projectPath, effectiveName);
            const existingProfilePath = path.join(existingRunDir, 'profile.json');

            // If only an empty leftover folder exists (e.g. after partial delete), remove it and allow reuse.
            if (fs.existsSync(existingRunDir) && !fs.existsSync(existingProfilePath)) {
                try {
                    const entries = await fsPromises.readdir(existingRunDir);
                    if (entries.length === 0) {
                        await fsPromises.rmdir(existingRunDir);
                        logger.info('[ProgressiveTuning] Removed empty leftover run folder before start', {
                            runDir: existingRunDir,
                        });
                    }
                } catch (cleanupErr) {
                    logger.warn('[ProgressiveTuning] Could not clean leftover run folder', {
                        runDir: existingRunDir,
                        error: cleanupErr.message,
                    });
                }
            }

            if (fs.existsSync(existingRunDir) || fs.existsSync(existingProfilePath)) {
                throw new Error(
                    `Run "${effectiveName}" already exists. Choose a new antenna name or use resume mode.`
                );
            }
        }

        const earlyPhaseDir = this._resolveEarlyPhaseDir(projectPath);

        // Create EARLY_PHASE directory structure if needed
        try {
            await fsPromises.mkdir(earlyPhaseDir, { recursive: true });
            await fsPromises.mkdir(path.join(earlyPhaseDir, 'Results'), { recursive: true });
        } catch (err) {
            logger.warn('Could not create EARLY_PHASE directories (may already exist)', { error: err.message });
        }

        // Write initial control.json (no command)
        const controlPath = this._resolveControlPath(projectPath);
        await fsPromises.writeFile(controlPath, JSON.stringify({ command: 'none', timestamp: new Date().toISOString() }), 'utf8');

        // Build initial variables for state tracking (create mode only)
        let fullVars = {};
        if (!isResume) {
            const varsToUse = initialVariables || {};
            for (const [key, def] of Object.entries(DEFAULT_TUNING_VARIABLES)) {
                fullVars[key] = varsToUse[key] !== undefined ? parseFloat(varsToUse[key]) : def.value;
            }
        }

        // Write initial status.json (so polling doesn't fail before MATLAB starts)
        // For resume mode, only write if status.json doesn't already exist (MATLAB has its own)
        const statusPath = this._resolveStatusPath(projectPath);
        let initialStatus;
        if (isResume && fs.existsSync(statusPath)) {
            // Read existing status and just update the status_message
            try {
                const existing = JSON.parse(await fsPromises.readFile(statusPath, 'utf8'));
                existing.status_message = 'Resuming MATLAB session...';
                initialStatus = existing;
                await fsPromises.writeFile(statusPath, JSON.stringify(existing, null, 2), 'utf8');
            } catch {
                // If read fails, write a minimal one
                initialStatus = {
                    timestamp: new Date().toISOString(),
                    status: 'resuming',
                    current_phase: 0,
                    total_simulations: 0,
                    estimated_total_simulations: 25,
                    status_message: 'Resuming MATLAB session...',
                    elapsed_seconds: 0,
                    phase1: null, phase2: null, phase3: null,
                };
                await fsPromises.writeFile(statusPath, JSON.stringify(initialStatus, null, 2), 'utf8');
            }
        } else {
            initialStatus = {
                timestamp: new Date().toISOString(),
                status: 'starting',
                current_phase: 0,
                total_simulations: 0,
                estimated_total_simulations: 25,
                status_message: 'Initializing MATLAB...',
                elapsed_seconds: 0,
                phase1: null,
                phase2: null,
                phase3: null,
            };
            await fsPromises.writeFile(statusPath, JSON.stringify(initialStatus, null, 2), 'utf8');
        }

        // Build MATLAB command using EP_Start
        // EP_Start(mode, antenna_name, Name, Value, ...)
        const matlabDir = projectPath.replace(/\\/g, '/');
        
        const matlabStatements = [
            `cd('${matlabDir}')`,
            `addpath(genpath(fullfile('${matlabDir}','Function','EARLY_PHASE')))`,
        ];

        if (isResume) {
            // Resume mode: EP_Start('resume', 'antennaName') — no other params
            matlabStatements.push(`EP_Start('resume', '${effectiveName}')`);
        } else {
            // Create mode: EP_Start('create', 'antennaName', NV pairs...)
            const nvPairs = [];

            // GND config as name-value pairs
            if (gndConfig.use_DXF) {
                const dxfPath = gndConfig.dxf_file_path.replace(/\\/g, '/');
                nvPairs.push(`'dxf_path', '${dxfPath}'`);
                if (gndConfig.xPos !== undefined) nvPairs.push(`'xPos', ${gndConfig.xPos}`);
                if (gndConfig.yPos !== undefined) nvPairs.push(`'yPos', ${gndConfig.yPos}`);
                if (gndConfig.Lgx !== undefined) nvPairs.push(`'Lgx', ${gndConfig.Lgx}`);
                if (gndConfig.Lgy !== undefined) nvPairs.push(`'Lgy', ${gndConfig.Lgy}`);
                if (gndConfig.dxf_min_x !== undefined) nvPairs.push(`'dxf_min_x', ${gndConfig.dxf_min_x}`);
                if (gndConfig.dxf_min_y !== undefined) nvPairs.push(`'dxf_min_y', ${gndConfig.dxf_min_y}`);
            } else {
                nvPairs.push(`'Lgx', ${gndConfig.Lgx}`);
                nvPairs.push(`'Lgy', ${gndConfig.Lgy}`);
                nvPairs.push(`'xPos', ${gndConfig.xPos}`);
                nvPairs.push(`'yPos', ${gndConfig.yPos}`);
            }

            // Initial variable overrides as additional name-value pairs
            if (initialVariables) {
                for (const [key, value] of Object.entries(fullVars)) {
                    const def = DEFAULT_TUNING_VARIABLES[key];
                    // Only include variables that differ from defaults
                    if (def && parseFloat(value) !== def.value) {
                        nvPairs.push(`'${key}', ${value}`);
                    }
                }
            }

            const nvStr = nvPairs.length > 0 ? `, ${nvPairs.join(', ')}` : '';
            matlabStatements.push(`EP_Start('create', '${effectiveName}'${nvStr})`);
        }

        matlabStatements.push(`disp('=== PROGRESSIVE TUNING COMPLETED ===')`);

        const matlabCommand = matlabStatements.join('; ');

        // silent=false → -r  : visible MATLAB window (default, for debugging)
        // silent=true  → -batch: fully headless, no window (for production)
        const matlabArgs = silent
            ? ['-batch', matlabCommand]  // headless: auto-exits, no window
            : ['-r', matlabCommand];      // visible: window stays open after done

        const matlabProcess = spawn('matlab', matlabArgs, {
            cwd: projectPath,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });

        matlabProcess.stdout?.on('data', (data) => {
            logger.debug(`[ProgressiveTuning] MATLAB stdout: ${data.toString().trim()}`);
        });

        matlabProcess.stderr?.on('data', (data) => {
            const text = data.toString();
            this.state.lastErrorOutput = `${this.state.lastErrorOutput || ''}\n${text}`.slice(-4000);
            logger.warn(`[ProgressiveTuning] MATLAB stderr: ${text.trim()}`);
        });

        matlabProcess.on('close', (code) => {
            logger.info(`[ProgressiveTuning] MATLAB launcher process exited (code: ${code})`);
            // On Windows, the matlab launcher spawns the real MATLAB.exe and exits immediately.
            // The actual MATLAB.exe continues running in the background.
            this.state.launcherExited = true;
            this.state.matlabProcess = null;
        });

        matlabProcess.on('error', (err) => {
            logger.error('[ProgressiveTuning] MATLAB process error', { error: err.message });
            this.state.status = 'error';
            this.state.matlabProcess = null;
            this.state.matlabPid = null;
        });

        // Update manager state
        this.state = {
            status: 'running',
            projectPath,
            earlyPhaseDir,
            startTime: new Date(),
            matlabProcess,
            matlabPid: matlabProcess.pid,
            lastStatusUpdate: null,
            gndConfig: isResume ? null : gndConfig,
            initialVariables: isResume ? null : fullVars,
            cachedStatus: initialStatus,
            cachedResults: null,
            launcherExited: false,
            matlabAlive: true,
            lastMatlabCheck: new Date(),
            isResume,
            lastErrorOutput: '',
        };

        // Start background polling of status.json to keep cached state fresh
        this._startStatusPolling(projectPath);

        logger.info('[ProgressiveTuning] Started successfully', {
            pid: matlabProcess.pid,
            projectPath,
            gndConfig,
        });

        return {
            success: true,
            pid: matlabProcess.pid,
            message: 'Progressive tuning started',
            earlyPhaseDir,
        };
    }

    /**
     * Checks if actual MATLAB.exe processes are running on the system
     */
    _checkMatlabAlive() {
        return new Promise((resolve) => {
            exec('tasklist /FI "IMAGENAME eq MATLAB.exe" /FO CSV /NH', (error, stdout) => {
                if (error || !stdout) {
                    resolve(false);
                    return;
                }
                const alive = stdout.includes('MATLAB.exe');
                resolve(alive);
            });
        });
    }

    /**
     * Polls status.json every 3 seconds, checks MATLAB alive, and caches the result
     */
    _startStatusPolling(projectPath) {
        this._stopStatusPolling();

        this._statusPollInterval = setInterval(async () => {
            try {
                // 1. Read status.json
                const statusPath = this._resolveStatusPath(projectPath);
                if (fs.existsSync(statusPath)) {
                    const raw = await fsPromises.readFile(statusPath, 'utf8');
                    const parsed = JSON.parse(raw);
                    this.state.cachedStatus = this._withErrorClassification(parsed);
                    this.state.lastStatusUpdate = new Date();

                    // Auto-detect completion or error from status.json
                    if (TERMINAL_STATUSES.has(parsed.status)) {
                        this.state.status = parsed.status === 'stopped' ? 'cancelled' : parsed.status;
                        this.state.matlabAlive = false;
                        this._stopStatusPolling();
                        // Reset control.json after MATLAB exits
                        try {
                            const ctrlPath = this._resolveControlPath(projectPath);
                            await fsPromises.writeFile(ctrlPath, JSON.stringify({ command: 'none', timestamp: new Date().toISOString() }), 'utf8');
                        } catch (e) { /* ignore */ }
                        logger.info(`[ProgressiveTuning] Final status detected: ${parsed.status}`);
                        return;
                    }
                }

                // 2. Check if actual MATLAB.exe is still alive
                const matlabAlive = await this._checkMatlabAlive();
                this.state.matlabAlive = matlabAlive;
                this.state.lastMatlabCheck = new Date();

                // 3. Auto-detect MATLAB crash: launcher exited + no MATLAB.exe + status still 'starting'
                if (this.state.launcherExited && !matlabAlive) {
                    const statusFromFile = this.state.cachedStatus?.status;
                    const elapsedSec = this.state.startTime
                        ? Math.floor((Date.now() - this.state.startTime.getTime()) / 1000)
                        : 0;

                    // If status never progressed beyond 'starting' and MATLAB is gone
                    if ((statusFromFile === 'starting' || statusFromFile === 'resuming') && elapsedSec > 15) {
                        logger.warn('[ProgressiveTuning] MATLAB exited without updating status — likely crashed or function not found');
                        this.state.status = 'error';
                        this.state.cachedStatus = {
                            ...this.state.cachedStatus,
                            status: 'error',
                            status_message: 'MATLAB process terminated without starting tuning. Check MATLAB console for errors.',
                            error_type: this._classifyErrorText(this.state.lastErrorOutput) || 'matlab_crash',
                            elapsed_seconds: elapsedSec,
                        };
                        this._stopStatusPolling();
                        return;
                    }

                    // If status progressed but MATLAB is now gone without completing
                    if (statusFromFile && statusFromFile !== 'starting' && statusFromFile !== 'resuming' && !TERMINAL_STATUSES.has(statusFromFile)) {
                        logger.warn(`[ProgressiveTuning] MATLAB exited while status was '${statusFromFile}' — marking as error`);
                        this.state.status = 'error';
                        this.state.cachedStatus = {
                            ...this.state.cachedStatus,
                            status: 'error',
                            status_message: `MATLAB process exited unexpectedly during ${statusFromFile}. Check MATLAB console.`,
                            error_type: this._classifyErrorText(
                                [this.state.cachedStatus?.status_message, this.state.cachedStatus?.phase_step, this.state.lastErrorOutput].filter(Boolean).join(' | ')
                            ) || 'matlab_crash',
                            elapsed_seconds: elapsedSec,
                        };
                        this._stopStatusPolling();
                        return;
                    }
                }
            } catch (err) {
                // File may be mid-write, ignore transient errors
                logger.debug('[ProgressiveTuning] Status poll error (transient)', { error: err.message });
            }
        }, 3000);
    }

    _stopStatusPolling() {
        if (this._statusPollInterval) {
            clearInterval(this._statusPollInterval);
            this._statusPollInterval = null;
        }
    }

    /**
     * Gets current tuning status (from cached status.json)
     */
    async getStatus() {
        if (!this.state.projectPath) {
            return {
                status: 'idle',
                current_phase: 0,
                total_simulations: 0,
                estimated_total_simulations: 0,
                status_message: 'Not Started',
                elapsed_seconds: 0,
                phase1: null,
                phase2: null,
                phase3: null,
            };
        }

        // Try to read latest status.json directly for freshest data
        try {
            const statusPath = this._resolveStatusPath(this.state.projectPath);
            if (fs.existsSync(statusPath)) {
                const raw = await fsPromises.readFile(statusPath, 'utf8');
                const parsed = JSON.parse(raw);
                const normalized = this._withErrorClassification(parsed);
                this.state.cachedStatus = normalized;
                
                // Calculate elapsed time if MATLAB doesn't provide it
                if (this.state.startTime && !normalized.elapsed_seconds) {
                    normalized.elapsed_seconds = Math.floor((Date.now() - this.state.startTime.getTime()) / 1000);
                }
                
                return normalized;
            }
        } catch (err) {
            logger.debug('[ProgressiveTuning] Error reading status.json, using cache', { error: err.message });
        }

        // Fallback to cached status
        if (this.state.cachedStatus) {
            return this._withErrorClassification(this.state.cachedStatus);
        }

        // No status available yet
        return {
            status: this.state.status,
            current_phase: 0,
            total_simulations: 0,
            estimated_total_simulations: 25,
            status_message: this.state.isResume ? 'Waiting for MATLAB to resume...' : 'Waiting for MATLAB...',
            elapsed_seconds: this.state.startTime
                ? Math.floor((Date.now() - this.state.startTime.getTime()) / 1000)
                : 0,
            phase1: null,
            phase2: null,
            phase3: null,
            matlabAlive: this.state.matlabAlive,
        };
    }

    /**
     * Gets final tuning results.
     * Reads from profile.json in the run's Results/<name>/ directory,
     * falling back to status.json for summary data.
     */
    async getResults() {
        if (!this.state.projectPath) {
            throw new Error('No progressive tuning session active');
        }

        const earlyPhaseDir = this._resolveEarlyPhaseDir(this.state.projectPath);

        // 1. Try to find profile.json in the most recent Results subfolder
        const resultsBaseDir = path.join(earlyPhaseDir, 'Results');
        if (fs.existsSync(resultsBaseDir)) {
            try {
                const entries = await fsPromises.readdir(resultsBaseDir, { withFileTypes: true });
                // Check subfolders for profile.json (newest first by mtime)
                const dirs = entries.filter(e => e.isDirectory());
                for (const dir of dirs.reverse()) {
                    const profilePath = path.join(resultsBaseDir, dir.name, 'profile.json');
                    if (fs.existsSync(profilePath)) {
                        const raw = await fsPromises.readFile(profilePath, 'utf8');
                        const profile = JSON.parse(raw);
                        this.state.cachedResults = profile;
                        return profile;
                    }
                }
            } catch (err) {
                logger.debug('[ProgressiveTuning] Error scanning Results for profile.json', { error: err.message });
            }
        }

        // 2. Fallback: legacy progressive_tuning_result.json in EARLY_PHASE
        const legacyResultsFile = path.join(earlyPhaseDir, 'progressive_tuning_result.json');
        if (fs.existsSync(legacyResultsFile)) {
            try {
                const raw = await fsPromises.readFile(legacyResultsFile, 'utf8');
                const results = JSON.parse(raw);
                this.state.cachedResults = results;
                return results;
            } catch (err) {
                logger.error('[ProgressiveTuning] Error reading legacy results file', { error: err.message });
            }
        }

        // 3. Construct from status.json
        const status = await this.getStatus();
        
        if (status.status !== 'completed' && status.status !== 'error') {
            throw new Error('Tuning has not completed yet');
        }

        const results = {
            status: status.status,
            current_phase: status.current_phase,
            total_simulations: status.total_simulations || 0,
            estimated_total_simulations: status.estimated_total_simulations || 0,
            elapsed_seconds: status.elapsed_seconds || 0,
            status_message: status.status_message || '',
            phase1: status.phase1 || null,
            phase2: status.phase2 || null,
            phase3: status.phase3 || null,
            // Legacy fields for backward compat
            total_time_seconds: status.elapsed_seconds || 0,
            tightened_ranges: status.tightened_ranges || {},
            search_space_reduction_percent: status.search_space_reduction_percent || 0,
            estimated_moead_speedup: status.estimated_moead_speedup || 0,
            results_dir: status.results_dir || '',
        };

        this.state.cachedResults = results;
        return results;
    }

    /**
     * Sends a control command to MATLAB via control.json
     * MATLAB polls this file and responds accordingly.
     * 'stop' = graceful shutdown (MATLAB saves checkpoint and exits)
     */
    async sendControl(command) {
        const validCommands = ['pause', 'resume', 'stop', 'cancel'];
        if (!validCommands.includes(command)) {
            throw new Error(`Invalid command: ${command}. Must be one of: ${validCommands.join(', ')}`);
        }

        if (!this.state.projectPath) {
            throw new Error('No progressive tuning session active');
        }

        const controlPath = this._resolveControlPath(this.state.projectPath);

        // For 'cancel', map to 'stop' in the file (MATLAB expects 'stop')
        const fileCommand = command === 'cancel' ? 'stop' : command;

        await fsPromises.writeFile(controlPath, JSON.stringify({
            command: fileCommand,
            timestamp: new Date().toISOString(),
        }), 'utf8');

        // Update local state
        if (command === 'pause') {
            this.state.status = 'paused';
        } else if (command === 'resume') {
            this.state.status = 'running';
        } else if (command === 'stop' || command === 'cancel') {
            this.state.status = 'stopping';
            // Don't immediately stop polling — let MATLAB write final status
            // Polling will auto-stop when it detects 'completed', 'error', or 'cancelled' in status.json
        }

        logger.info(`[ProgressiveTuning] Control command sent: ${command}`);
        return { success: true, command };
    }

    /**
     * Resets the tuning manager state
     */
    reset() {
        this._stopStatusPolling();
        this.state = {
            status: 'idle',
            projectPath: null,
            earlyPhaseDir: null,
            startTime: null,
            matlabProcess: null,
            matlabPid: null,
            lastStatusUpdate: null,
            gndConfig: null,
            initialVariables: null,
            cachedStatus: null,
            cachedResults: null,
            launcherExited: false,
            matlabAlive: false,
            lastMatlabCheck: null,
            isResume: false,
            lastErrorOutput: '',
        };
        logger.info('[ProgressiveTuning] Manager reset');
    }

    /**
     * Cleanup on server shutdown
     */
    cleanup() {
        this._stopStatusPolling();
        if (this.state.matlabProcess) {
            try {
                this.state.matlabProcess.kill('SIGTERM');
            } catch (err) {
                // Process may already be dead
            }
        }
    }
}

// Export singleton instance
module.exports = new ProgressiveTuningManager();

// Also export the class and constants for testing
module.exports.ProgressiveTuningManager = ProgressiveTuningManager;
module.exports.DEFAULT_TUNING_VARIABLES = DEFAULT_TUNING_VARIABLES;
module.exports.PHASES = PHASES;
