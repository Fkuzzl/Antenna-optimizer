/**
 * Progressive Tuning API Routes
 * 
 * Endpoints for the progressive GPS CP antenna tuning pre-optimization system.
 * 
 * POST /api/progressive-tuning/start    - Launch progressive tuning (create or resume)
 * GET  /api/progressive-tuning/status   - Read current status (polls status.json)
 * GET  /api/progressive-tuning/results  - Get final tuning results
 * POST /api/progressive-tuning/control  - Send control command (pause, resume)
 * POST /api/progressive-tuning/reset    - Reset tuning manager state
 * GET  /api/progressive-tuning/runs     - Scan previous runs
 * 
 * NOTE: Stop is handled by the unified POST /api/matlab/stop endpoint.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const progressiveTuningManager = require('../services/progressiveTuningManager');
const { syncHfssPathForProject } = require('../services/hfssPathSync');
const { createResponse } = require('../utils/helpers');
const { HTTP_STATUS } = require('../config/constants');
const logger = require('../config/logger');

/**
 * POST /api/progressive-tuning/start
 * Start or resume the progressive tuning process
 * 
 * Body for 'create' mode (default): {
 *   projectPath: string (required),
 *   mode: 'create' (optional, default),
 *   GND_config: {
 *     use_DXF: boolean,
 *     dxf_file_path?: string,   // when use_DXF = true
 *     Lgx?: number,             // when use_DXF = false (or DXF with bounds)
 *     Lgy?: number,
 *     xPos?: number,
 *     yPos?: number
 *   },
 *   initial_variables?: {       // optional overrides
 *     probex?: number,
 *     purple?: number,
 *     ngreen?: number,
 *     orange?: number,
 *     orange2?: number,
 *     brown?: number,
 *     bluel?: number
 *   },
 *   antenna_name?: string       // output folder name (default: 'antenna1')
 * }
 * 
 * Body for 'resume' mode: {
 *   projectPath: string (required),
 *   mode: 'resume',
 *   antenna_name: string (required)  // name of the run to resume
 * }
 */
router.post('/start', async (req, res) => {
    try {
        const { projectPath, GND_config, initial_variables, antenna_name, resume_dir, mode } = req.body;

        // Determine effective mode
        const effectiveMode = mode || (resume_dir ? 'resume' : 'create');
        const isResume = effectiveMode === 'resume';

        // Validate project path
        if (!projectPath || typeof projectPath !== 'string') {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'projectPath is required')
            );
        }

        if (!fs.existsSync(projectPath)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, `Project path does not exist: ${projectPath}`)
            );
        }

        // Validate GND config (only required for create mode)
        if (!isResume && !GND_config) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'GND_config is required for create mode')
            );
        }

        // Check if already running
        if (progressiveTuningManager.isRunning()) {
            return res.status(HTTP_STATUS.CONFLICT).json(
                createResponse(false, { state: progressiveTuningManager.getState() },
                    'Progressive tuning is already running')
            );
        }

        // Start the process — visible MATLAB window for debugging
        const result = await progressiveTuningManager.start({
            projectPath,
            gndConfig: GND_config || null,
            initialVariables: initial_variables || null,
            antennaName: antenna_name || 'antenna1',
            resumeDir: resume_dir || null,
            mode: effectiveMode,
            silent: false, // always visible on this endpoint
        });

        logger.info('[ProgressiveTuning] Start request successful', {
            projectPath,
            mode: effectiveMode,
            gndConfig: GND_config,
            antennaName: antenna_name,
            pid: result.pid,
        });

        res.json(createResponse(true, result, `Progressive tuning ${isResume ? 'resumed' : 'started'}`));

    } catch (error) {
        logger.error('[ProgressiveTuning] Start error', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, error.message)
        );
    }
});

/**
 * POST /api/progressive-tuning/start-silent
 * Same as /start but runs MATLAB fully headless (-batch, no window, no GUI).
 * Intended for production / automated pipeline use — NOT for debugging.
 * All window output is suppressed; progress is still tracked via status.json.
 *
 * Body: identical to POST /start
 */
router.post('/start-silent', async (req, res) => {
    try {
        const { projectPath, GND_config, initial_variables, antenna_name, resume_dir, mode } = req.body;

        const effectiveMode = mode || (resume_dir ? 'resume' : 'create');
        const isResume = effectiveMode === 'resume';

        if (!projectPath || typeof projectPath !== 'string') {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'projectPath is required')
            );
        }
        if (!fs.existsSync(projectPath)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, `Project path does not exist: ${projectPath}`)
            );
        }
        if (!isResume && !GND_config) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'GND_config is required for create mode')
            );
        }
        if (progressiveTuningManager.isRunning()) {
            return res.status(HTTP_STATUS.CONFLICT).json(
                createResponse(false, { state: progressiveTuningManager.getState() },
                    'Progressive tuning is already running')
            );
        }

        // Start the process — fully headless (no MATLAB window)
        const result = await progressiveTuningManager.start({
            projectPath,
            gndConfig: GND_config || null,
            initialVariables: initial_variables || null,
            antennaName: antenna_name || 'antenna1',
            resumeDir: resume_dir || null,
            mode: effectiveMode,
            silent: true, // headless: -batch, no MATLAB window
        });

        logger.info('[ProgressiveTuning] Silent start request successful', {
            projectPath,
            mode: effectiveMode,
            antennaName: antenna_name,
            pid: result.pid,
        });

        res.json(createResponse(true, result, `Progressive tuning ${isResume ? 'resumed' : 'started'} (silent/background mode)`));

    } catch (error) {
        logger.error('[ProgressiveTuning] Silent start error', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, error.message)
        );
    }
});

/**
 * GET /api/progressive-tuning/status
 * Get current tuning status (reads status.json from EARLY_PHASE)
 */
router.get('/status', async (req, res) => {
    try {
        const status = await progressiveTuningManager.getStatus();
        
        // Include manager-level state info
        const managerState = progressiveTuningManager.getState();

        res.json(createResponse(true, {
            ...status,
            manager: {
                status: managerState.status,
                startTime: managerState.startTime,
                matlabPid: managerState.matlabPid,
                projectPath: managerState.projectPath,
                matlabAlive: managerState.matlabAlive,
                launcherExited: managerState.launcherExited,
                gndConfig: managerState.gndConfig,
            },
            timestamp: new Date().toISOString(),
        }));

    } catch (error) {
        logger.error('[ProgressiveTuning] Status error', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, 'Failed to get tuning status')
        );
    }
});

/**
 * GET /api/progressive-tuning/results
 * Get final tuning results after completion
 */
router.get('/results', async (req, res) => {
    try {
        const results = await progressiveTuningManager.getResults();
        res.json(createResponse(true, results));
    } catch (error) {
        logger.error('[ProgressiveTuning] Results error', { error: error.message });
        const statusCode = error.message.includes('not completed')
            ? HTTP_STATUS.BAD_REQUEST
            : HTTP_STATUS.INTERNAL_ERROR;
        res.status(statusCode).json(
            createResponse(false, null, error.message)
        );
    }
});

/**
 * POST /api/progressive-tuning/control
 * Send control command to MATLAB process via control.json.
 * Use this for pause / resume only.
 * For stopping, use the unified POST /api/matlab/stop instead.
 * 
 * Body: { command: 'pause' | 'resume' }
 */
router.post('/control', async (req, res) => {
    try {
        const { command } = req.body;

        if (!command) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'command is required (pause, resume)')
            );
        }

        const result = await progressiveTuningManager.sendControl(command);
        
        res.json(createResponse(true, result, `Command '${command}' sent successfully`));

    } catch (error) {
        logger.error('[ProgressiveTuning] Control error', { error: error.message });
        res.status(HTTP_STATUS.BAD_REQUEST).json(
            createResponse(false, null, error.message)
        );
    }
});

/**
 * POST /api/progressive-tuning/reset
 * Reset the tuning manager (clears state, does not kill MATLAB)
 */
router.post('/reset', (req, res) => {
    try {
        progressiveTuningManager.reset();
        res.json(createResponse(true, null, 'Progressive tuning manager reset'));
    } catch (error) {
        logger.error('[ProgressiveTuning] Reset error', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, 'Failed to reset tuning manager')
        );
    }
});

/**
 * GET /api/progressive-tuning/runs
 * Scan Results/ subfolders to find previous runs and their status.
 * Returns list of runs with name, status (complete/incomplete), path, phase, timestamp.
 * 
 * Query: { projectPath: string (required) }
 */
router.get('/runs', async (req, res) => {
    try {
        const { projectPath } = req.query;

        if (!projectPath || typeof projectPath !== 'string') {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'projectPath query parameter is required')
            );
        }

        if (!fs.existsSync(projectPath)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, `Project path does not exist: ${projectPath}`)
            );
        }

        const hfssSync = syncHfssPathForProject(projectPath);
        if (hfssSync.updated) {
            logger.info('[ProgressiveTuning] Synced HFSS path on project location confirmation', {
                projectPath,
                epConfigPath: hfssSync.epConfigPath,
                verificationConfigPath: hfssSync.verificationConfigPath,
            });
        }

        const runs = await progressiveTuningManager.scanRuns(projectPath);
        res.json(createResponse(true, runs));

    } catch (error) {
        logger.error('[ProgressiveTuning] Runs scan error', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, error.message)
        );
    }
});

/**
 * GET /api/progressive-tuning/chart/:chartName
 * Serve a chart PNG from the results directory.
 * chartName must be one of: chart_s11.png, chart_ar.png, chart_gain.png, chart_smith.png
 */
router.get('/chart/:chartName', async (req, res) => {
    try {
        const { chartName } = req.params;

        // Whitelist — prevent path traversal
        const allowed = ['chart_s11.png', 'chart_ar.png', 'chart_gain.png', 'chart_smith.png'];
        if (!allowed.includes(chartName)) {
            return res.status(404).json(createResponse(false, null, 'Chart not found'));
        }

        // Prefer explicit ?dir= query param (sent by app after a completed run),
        // fall back to current status.json (works during an active run).
        let resultsDir = req.query.dir || null;
        if (!resultsDir) {
            const status = await progressiveTuningManager.getStatus();
            resultsDir = status.results_dir;
        }

        if (!resultsDir) {
            return res.status(404).json(createResponse(false, null, 'No results directory in status'));
        }

        const chartPath = path.join(resultsDir, chartName);

        if (!fs.existsSync(chartPath)) {
            return res.status(404).json(createResponse(false, null, `Chart file not found: ${chartName}`));
        }

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(chartPath).pipe(res);

    } catch (error) {
        logger.error('[ProgressiveTuning] Chart serve error', { error: error.message });
        res.status(500).json(createResponse(false, null, error.message));
    }
});

/**
 * GET /api/progressive-tuning/run-result
 * Read the status.json (+ profile.json) of a specific completed run directory.
 * Used to re-enter the results view for any past run.
 *
 * Query: { runPath: string (absolute path to the run subfolder) }
 */
router.get('/run-result', async (req, res) => {
    try {
        const { runPath } = req.query;
        if (!runPath || typeof runPath !== 'string') {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'runPath query parameter is required')
            );
        }
        if (!fs.existsSync(runPath)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, `Run directory not found: ${runPath}`)
            );
        }

        let statusData = {};
        let profileData = {};

        const statusPath = path.join(runPath, 'status.json');
        if (fs.existsSync(statusPath)) {
            try { statusData = JSON.parse(fs.readFileSync(statusPath, 'utf8')); } catch (e) {}
        }

        const profilePath = path.join(runPath, 'profile.json');
        if (fs.existsSync(profilePath)) {
            try { profileData = JSON.parse(fs.readFileSync(profilePath, 'utf8')); } catch (e) {}
        }

        // Merge: status.json is authoritative for phase data; profile fills in metadata
        const merged = { ...profileData, ...statusData, _runPath: runPath };

        // If tightened_ranges not in either JSON, try parsing tightened_ranges.csv
        if (!merged.tightened_ranges || Object.keys(merged.tightened_ranges).length === 0) {
            const csvPath = path.join(runPath, 'tightened_ranges.csv');
            if (fs.existsSync(csvPath)) {
                try {
                    const csvText = fs.readFileSync(csvPath, 'utf8');
                    const lines = csvText.split(/\r?\n/).filter(l => l.trim());
                    const tightened = {};
                    for (const line of lines) {
                        const parts = line.split(',').map(s => s.trim());
                        if (parts.length < 3) continue;
                        const [name, lo, hi] = parts;
                        const loNum = parseFloat(lo);
                        const hiNum = parseFloat(hi);
                        if (isNaN(loNum) || isNaN(hiNum)) continue; // skip header rows
                        tightened[name] = [loNum, hiNum];
                    }
                    if (Object.keys(tightened).length > 0) {
                        merged.tightened_ranges = tightened;
                    }
                } catch (csvErr) {
                    logger.warn('[ProgressiveTuning] Failed to parse tightened_ranges.csv', { error: csvErr.message });
                }
            }
        }

        res.json(createResponse(true, merged));

    } catch (error) {
        logger.error('[ProgressiveTuning] run-result error', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, error.message)
        );
    }
});

/**
 * GET /api/progressive-tuning/ep-config
 * Read EP_Config.json from <projectPath>/Function/EARLY_PHASE/Config/EP_Config.json
 * Returns default_values and variable_ranges for the frontend variable editor.
 *
 * Query: { projectPath: string (required) }
 */
router.get('/ep-config', (req, res) => {
    try {
        const { projectPath } = req.query;
        if (!projectPath || typeof projectPath !== 'string') {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'projectPath query parameter is required')
            );
        }

        const configPath = path.join(projectPath, 'Function', 'EARLY_PHASE', 'Config', 'EP_Config.json');
        if (!fs.existsSync(configPath)) {
            return res.status(404).json(
                createResponse(false, null, `EP_Config.json not found at: ${configPath}`)
            );
        }

        const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        res.json(createResponse(true, {
            default_values: raw.default_values || {},
            variable_ranges: raw.variable_ranges || {},
        }));
    } catch (error) {
        logger.error('[ProgressiveTuning] ep-config error', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, error.message)
        );
    }
});

/**
 * DELETE /api/progressive-tuning/run
 * Permanently delete a run folder and all its contents.
 *
 * Query: { runPath: string (absolute path to the run subfolder) }
 */
router.delete('/run', async (req, res) => {
    try {
        const { runPath } = req.query;
        if (!runPath || typeof runPath !== 'string') {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'runPath query parameter is required')
            );
        }
        // Safety guard: only allow deleting inside a Results/ directory
        const normalised = path.normalize(runPath);
        if (!normalised.includes('Results')) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(
                createResponse(false, null, 'Invalid run path: must be inside a Results/ directory')
            );
        }
        if (!fs.existsSync(normalised)) {
            return res.status(404).json(createResponse(false, null, 'Run directory not found'));
        }

        // Robust deletion for Windows: retry a few times and verify folder removal.
        await fs.promises.rm(normalised, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 200,
        });

        // Extra cleanup pass in case of transient file locks creating a half-deleted folder.
        if (fs.existsSync(normalised)) {
            try {
                const leftovers = await fs.promises.readdir(normalised);
                for (const name of leftovers) {
                    const itemPath = path.join(normalised, name);
                    await fs.promises.rm(itemPath, {
                        recursive: true,
                        force: true,
                        maxRetries: 5,
                        retryDelay: 200,
                    });
                }
                await fs.promises.rmdir(normalised);
            } catch (cleanupErr) {
                logger.warn('[ProgressiveTuning] Secondary delete cleanup failed', {
                    runPath: normalised,
                    error: cleanupErr.message,
                });
            }
        }

        if (fs.existsSync(normalised)) {
            return res.status(HTTP_STATUS.CONFLICT).json(
                createResponse(false, null, 'Run files were removed but the run folder is still present. Close MATLAB/HFSS locks and delete again.')
            );
        }

        logger.info('[ProgressiveTuning] Run deleted', { runPath: normalised });
        res.json(createResponse(true, null, 'Run deleted successfully'));
    } catch (error) {
        logger.error('[ProgressiveTuning] Delete run error', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, error.message)
        );
    }
});

module.exports = router;
