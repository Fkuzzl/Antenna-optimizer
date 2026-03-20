const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../config/logger');
const { getMoeaProfile, resolveProjectDir } = require('./moeaProfileManager');

const runningMap = new Map();
const ALLOWED_CHARTS = ['chart_s11.png', 'chart_ar.png', 'chart_gain.png', 'chart_smith.png'];
let lastFinishedVerification = null;
const DEFAULT_S11_THRESHOLD_DB = -15;
const DEFAULT_AR_THRESHOLD_DB = 3;

const normalizePathForMatlab = (p) => String(p || '').replace(/\\/g, '/').replace(/'/g, "''");

const keyOf = (projectPath, profileId) => `${resolveProjectDir(projectPath)}::${profileId}`;
const toTimestamp = (value) => {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
};

const rememberFinishedVerification = async ({ projectDir, profileId, runId, outputDir, status }) => {
    const normalizedStatus = String(status?.status || '').toLowerCase();
    if (!['completed', 'error', 'cancelled', 'stopped'].includes(normalizedStatus)) return;

    const resultLocations = await buildResultLocations({
        projectDir,
        profileId,
        runId,
        outputDir,
    });

    lastFinishedVerification = {
        projectDir,
        profileId,
        runId,
        solutionType: status?.solutionType || status?.solution_type || null,
        status: normalizedStatus,
        message: status?.message || null,
        summary: status?.summary || null,
        completedAt: status?.completedAt || status?.completed_at || new Date().toISOString(),
        resultLocations,
    };
};

const ensureDir = async (dirPath) => {
    await fsPromises.mkdir(dirPath, { recursive: true });
};

const resolveVerificationBandwidthThresholds = () => {
    return {
        s11Db: DEFAULT_S11_THRESHOLD_DB,
        arDb: DEFAULT_AR_THRESHOLD_DB,
    };
};

const parseCsvNumericPoints = async (filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return [];

    try {
        const raw = await fsPromises.readFile(filePath, 'utf8');
        const lines = String(raw || '').split(/\r?\n/).filter(Boolean);
        if (lines.length <= 1) return [];

        const points = [];
        for (let index = 1; index < lines.length; index++) {
            const line = lines[index];
            const parts = line.split(',');
            if (parts.length < 2) continue;

            let frequencyRaw = parts[0];
            let valueRaw = parts[parts.length - 1];

            if (parts.length >= 4) {
                frequencyRaw = parts[2];
                valueRaw = parts[parts.length - 1];
            }

            const frequency = Number(String(frequencyRaw).replace(/^"|"$/g, '').trim());
            const value = Number(String(valueRaw).replace(/^"|"$/g, '').trim());
            if (!Number.isFinite(frequency) || !Number.isFinite(value)) continue;

            points.push({ frequency, value });
        }

        return points.sort((left, right) => left.frequency - right.frequency);
    } catch {
        return [];
    }
};

const getBandwidthPercentageByThreshold = (points = [], threshold, mode = 'max') => {
    if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(threshold)) return null;

    const isPassing = (value) => {
        if (!Number.isFinite(value)) return false;
        return mode === 'min' ? value >= threshold : value <= threshold;
    };

    let totalSpan = 0;
    let passingSpan = 0;

    for (let index = 0; index < points.length - 1; index++) {
        const p1 = points[index];
        const p2 = points[index + 1];

        const segmentLength = p2.frequency - p1.frequency;
        if (!(segmentLength > 0)) continue;

        totalSpan += segmentLength;

        const pass1 = isPassing(p1.value);
        const pass2 = isPassing(p2.value);

        if (pass1 && pass2) {
            passingSpan += segmentLength;
            continue;
        }

        if (!pass1 && !pass2) {
            continue;
        }

        if (p1.value === p2.value) {
            continue;
        }

        const ratio = (threshold - p1.value) / (p2.value - p1.value);
        const crossingFrequency = p1.frequency + (ratio * segmentLength);

        if (pass1) {
            passingSpan += Math.max(0, crossingFrequency - p1.frequency);
        } else {
            passingSpan += Math.max(0, p2.frequency - crossingFrequency);
        }
    }

    if (!(totalSpan > 0)) return null;
    return (passingSpan / totalSpan) * 100;
};

const findRunCsvByPrefix = async (outputDir, prefix) => {
    const csvDir = path.join(outputDir, 'results_csv');
    if (!fs.existsSync(csvDir)) return null;

    try {
        const entries = await fsPromises.readdir(csvDir, { withFileTypes: true });
        const fileName = entries
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .find((name) => name.toLowerCase().startsWith(`${prefix.toLowerCase()}_`) && name.toLowerCase().endsWith('.csv'));

        return fileName ? path.join(csvDir, fileName) : null;
    } catch {
        return null;
    }
};

const enrichSummaryWithBandwidth = async ({ projectDir, outputDir, status }) => {
    if (!status || !outputDir || !projectDir) return status;

    const summary = status.summary && typeof status.summary === 'object'
        ? { ...status.summary }
        : null;
    if (!summary) return status;

    const thresholds = resolveVerificationBandwidthThresholds();

    const s11Csv = await findRunCsvByPrefix(outputDir, 'S11');
    const arCsv = await findRunCsvByPrefix(outputDir, 'AR');

    const s11Points = await parseCsvNumericPoints(s11Csv);
    const arPoints = await parseCsvNumericPoints(arCsv);

    summary.bandwidth_thresholds = {
        s11_db: thresholds.s11Db,
        ar_db: thresholds.arDb,
    };

    const s11Pct = getBandwidthPercentageByThreshold(s11Points, thresholds.s11Db, 'max');
    const arPct = getBandwidthPercentageByThreshold(arPoints, thresholds.arDb, 'max');

    summary.s11_bandwidth_pct = Number.isFinite(s11Pct) ? s11Pct : null;
    summary.ar_bandwidth_pct = Number.isFinite(arPct) ? arPct : null;

    return {
        ...status,
        summary,
    };
};

const copyIntegratedExcelSnapshot = async (projectDir, outputDir) => {
    const sourceExcel = path.join(projectDir, 'Integrated_Results.xlsx');
    const snapshotExcel = path.join(outputDir, 'Integrated_Results.xlsx');

    if (!fs.existsSync(sourceExcel)) {
        return null;
    }

    try {
        await fsPromises.copyFile(sourceExcel, snapshotExcel);
        return snapshotExcel;
    } catch {
        return null;
    }
};

const getProfileDir = (projectDir, profileId) => path.join(projectDir, 'Result_Profile', profileId);
const getProfileResultRoot = (projectDir, profileId) => path.join(getProfileDir(projectDir, profileId), 'result');
const getVerificationRunOutputDir = (projectDir, profileId, runId) => path.join(getProfileResultRoot(projectDir, profileId), runId);

const buildResultLocations = async ({ projectDir, profileId, runId, outputDir }) => {
    const profileDir = getProfileDir(projectDir, profileId);
    const resultDir = getProfileResultRoot(projectDir, profileId);
    const csvDir = path.join(outputDir, 'results_csv');

    let csvFiles = [];
    if (fs.existsSync(csvDir)) {
        try {
            const entries = await fsPromises.readdir(csvDir, { withFileTypes: true });
            csvFiles = entries
                .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.csv'))
                .map((entry) => path.join(csvDir, entry.name));
        } catch {
            csvFiles = [];
        }
    }

    const chartPaths = {};
    for (const chartName of ALLOWED_CHARTS) {
        const chartFilePath = path.join(outputDir, chartName);
        if (fs.existsSync(chartFilePath)) {
            chartPaths[chartName] = chartFilePath;
        }
    }

    const integratedExcelPath = path.join(projectDir, 'Integrated_Results.xlsx');
    const integratedExcelSnapshot = path.join(outputDir, 'Integrated_Results.xlsx');

    return {
        projectDir,
        profileDir,
        resultDir,
        runDir: outputDir,
        runId,
        statusFile: path.join(outputDir, 'verification_status.json'),
        summaryFile: path.join(outputDir, 'verification_summary.json'),
        profileSnapshotFile: path.join(outputDir, 'profile_snapshot.json'),
        csvDir,
        csvFiles,
        chartPaths,
        integratedExcelPath,
        integratedExcelSnapshot,
    };
};

const writeStatus = async (outputDir, status) => {
    await ensureDir(outputDir);
    const statusPath = path.join(outputDir, 'verification_status.json');
    await fsPromises.writeFile(statusPath, JSON.stringify(status, null, 2), 'utf8');
};

const getStatusPath = (outputDir) => path.join(outputDir, 'verification_status.json');

const readStatus = async (outputDir) => {
    const statusPath = getStatusPath(outputDir);
    if (!fs.existsSync(statusPath)) return null;
    try {
        return JSON.parse(await fsPromises.readFile(statusPath, 'utf8'));
    } catch {
        return null;
    }
};

const ensureVerificationScripts = async (projectDir) => {
    const verificationDir = path.join(projectDir, 'Function', 'VERIFICATION');
    await ensureDir(verificationDir);

    const runScriptPath = path.join(verificationDir, 'MOEA_Verification_Run.m');
    if (!fs.existsSync(runScriptPath)) {
        throw new Error(`Verification entrypoint not found: ${runScriptPath}. Please provide MOEA_Verification_Run.m in Function/VERIFICATION.`);
    }

    return {
        verificationDir,
        runScriptPath,
    };
};

const getMatlabCommand = (projectDir, outputDir, solutionType, profileJsonPath) => {
    const matlabProjectDir = normalizePathForMatlab(projectDir);
    const matlabOutputDir = normalizePathForMatlab(outputDir);
    const matlabSolution = normalizePathForMatlab(solutionType);
    const matlabProfilePath = normalizePathForMatlab(profileJsonPath);

    return [
        `cd('${matlabProjectDir}')`,
        `addpath(genpath(fullfile('${matlabProjectDir}','Function','VERIFICATION')))`,
        `MOEA_Verification_Run('${matlabOutputDir}','${matlabSolution}','${matlabProfilePath}')`,
    ].join('; ');
};

const startVerification = async ({ projectPath, profileId, solutionType }) => {
    const projectDir = resolveProjectDir(projectPath);
    if (!projectDir || !fs.existsSync(projectDir)) {
        throw new Error(`Invalid project directory: ${projectPath}`);
    }

    if (!['balanced', 'optimal'].includes(solutionType)) {
        throw new Error('solutionType must be "balanced" or "optimal"');
    }

    const profile = await getMoeaProfile(projectDir, profileId);

    const selected = solutionType === 'balanced'
        ? profile?.optimalResults?.balanced
        : profile?.optimalResults?.optimal;

    if (!selected) {
        throw new Error(`Selected solution not found: ${solutionType}`);
    }

    const runId = `verify_${solutionType}_${Date.now()}`;
    const outputDir = getVerificationRunOutputDir(projectDir, profileId, runId);

    await ensureDir(outputDir);
    await ensureVerificationScripts(projectDir);

    const profileSnapshotPath = path.join(outputDir, 'profile_snapshot.json');
    await fsPromises.writeFile(profileSnapshotPath, JSON.stringify(profile, null, 2), 'utf8');

    await writeStatus(outputDir, {
        status: 'starting',
        message: 'Starting MATLAB verification...',
        solutionType,
        profileId,
        runId,
        startedAt: new Date().toISOString(),
    });

    const matlabCommand = getMatlabCommand(projectDir, outputDir, solutionType, profileSnapshotPath);
    const matlabDesktopCommand = `${matlabCommand}; exit`;
    const matlabProc = spawn('matlab', ['-nosplash', '-r', matlabDesktopCommand], {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
    });

    const k = keyOf(projectDir, profileId);
    runningMap.set(k, {
        runId,
        outputDir,
        projectDir,
        profileId,
        solutionType,
        process: matlabProc,
        startedAt: new Date().toISOString(),
    });

    matlabProc.stdout?.on('data', (buf) => {
        const text = String(buf || '').trim();
        if (!text) return;
        logger.info(`[MOEAVerification][${runId}] MATLAB stdout: ${text}`);
    });
    matlabProc.stderr?.on('data', (buf) => {
        const text = String(buf || '').trim();
        if (!text) return;
        logger.warn(`[MOEAVerification][${runId}] MATLAB stderr: ${text}`);
    });

    matlabProc.on('close', async (code) => {
        logger.info('[MOEAVerification] MATLAB process exited', { runId, code });

        await copyIntegratedExcelSnapshot(projectDir, outputDir);

        let status = await readStatus(outputDir);
        if (!status) {
            await writeStatus(outputDir, {
                status: code === 0 ? 'completed' : 'error',
                message: code === 0 ? 'Verification completed' : `Verification failed (exit code ${code})`,
                solutionType,
                profileId,
                runId,
                completedAt: new Date().toISOString(),
            });
            status = await readStatus(outputDir);
        }

        if (status) {
            await rememberFinishedVerification({ projectDir, profileId, runId, outputDir, status });
        }

        const existing = runningMap.get(k);
        if (existing && existing.runId === runId) {
            runningMap.set(k, {
                ...existing,
                process: null,
            });
        }
    });

    matlabProc.on('error', async (error) => {
        logger.error('[MOEAVerification] MATLAB spawn error', { runId, error: error.message });
        await writeStatus(outputDir, {
            status: 'error',
            message: error.message,
            solutionType,
            profileId,
            runId,
            completedAt: new Date().toISOString(),
        });
    });

    const resultLocations = await buildResultLocations({
        projectDir,
        profileId,
        runId,
        outputDir,
    });

    return {
        runId,
        outputDir,
        solutionType,
        profileId,
        resultLocations,
    };
};

const getVerificationStatus = async ({ projectPath, profileId, runId }) => {
    const projectDir = resolveProjectDir(projectPath);
    const k = keyOf(projectDir, profileId);
    const active = runningMap.get(k);

    let resolvedRunId = runId || active?.runId;
    if (!resolvedRunId) {
        return null;
    }

    let outputDir = active?.runId === resolvedRunId
        ? active.outputDir
        : getVerificationRunOutputDir(projectDir, profileId, resolvedRunId);

    if (!fs.existsSync(outputDir)) {
        const legacyOutputDir = path.join(projectDir, 'Function', 'VERIFICATION', 'Results', resolvedRunId);
        if (fs.existsSync(legacyOutputDir)) {
            outputDir = legacyOutputDir;
        }
    }

    if (!fs.existsSync(outputDir)) {
        return null;
    }

    const rawStatus = await readStatus(outputDir);
    const status = await enrichSummaryWithBandwidth({
        projectDir,
        outputDir,
        status: rawStatus,
    });
    if (!status) {
        const resultLocations = await buildResultLocations({
            projectDir,
            profileId,
            runId: resolvedRunId,
            outputDir,
        });
        return {
            status: 'unknown',
            runId: resolvedRunId,
            outputDir,
            resultLocations,
        };
    }

    await rememberFinishedVerification({ projectDir, profileId, runId: resolvedRunId, outputDir, status });

    const resultLocations = await buildResultLocations({
        projectDir,
        profileId,
        runId: resolvedRunId,
        outputDir,
    });

    return {
        ...status,
        runId: resolvedRunId,
        outputDir,
        resultLocations,
    };
};

const getLatestVerificationForProfile = async ({ projectPath, profileId }) => {
    const projectDir = resolveProjectDir(projectPath);
    if (!projectDir || !profileId) return null;

    const resultRoot = getProfileResultRoot(projectDir, profileId);
    if (!fs.existsSync(resultRoot)) return null;

    const entries = await fsPromises.readdir(resultRoot, { withFileTypes: true }).catch(() => []);
    let best = null;

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const runId = entry.name;
        const outputDir = path.join(resultRoot, runId);
        const rawStatus = await readStatus(outputDir);
        const status = await enrichSummaryWithBandwidth({
            projectDir,
            outputDir,
            status: rawStatus,
        });
        if (!status) continue;

        const finishedAt = status.completedAt || status.completed_at || status.startedAt || status.started_at;
        const startedAt = status.startedAt || status.started_at || null;
        const candidateTime = toTimestamp(finishedAt || startedAt || 0);

        const inferredSolutionType =
            status.solutionType ||
            status.solution_type ||
            (runId.includes('verify_balanced_') ? 'balanced' : runId.includes('verify_optimal_') ? 'optimal' : null);

        const candidate = {
            runId,
            status: status.status || 'unknown',
            message: status.message || null,
            solutionType: inferredSolutionType,
            summary: status.summary || null,
            outputDir,
            timestamp: candidateTime,
        };

        if (!best || candidate.timestamp > best.timestamp) {
            best = candidate;
        }
    }

    if (!best) return null;

    const resultLocations = await buildResultLocations({
        projectDir,
        profileId,
        runId: best.runId,
        outputDir: best.outputDir,
    });

    return {
        runId: best.runId,
        status: best.status,
        message: best.message,
        solutionType: best.solutionType,
        summary: best.summary,
        outputDir: best.outputDir,
        resultLocations,
    };
};

const getVerificationChartPath = ({ projectPath, profileId, runId, chartName }) => {
    if (!ALLOWED_CHARTS.includes(chartName)) {
        throw new Error('Invalid chart name');
    }

    const projectDir = resolveProjectDir(projectPath);
    const outputDir = getVerificationRunOutputDir(projectDir, profileId, runId);
    const nextPath = path.join(outputDir, chartName);
    if (fs.existsSync(nextPath)) return nextPath;

    const legacyPath = path.join(projectDir, 'Function', 'VERIFICATION', 'Results', runId, chartName);
    return legacyPath;
};

const getActiveVerification = async (projectPath = null) => {
    const normalizedProjectPath = projectPath ? resolveProjectDir(projectPath) : null;
    let active = null;

    for (const item of runningMap.values()) {
        if (!item?.runId || !item?.profileId || !item?.outputDir) continue;
        if (!item.process) continue;
        if (normalizedProjectPath && resolveProjectDir(item.projectDir) !== normalizedProjectPath) continue;

        if (!active || toTimestamp(item.startedAt) > toTimestamp(active.startedAt)) {
            active = item;
        }
    }

    if (!active) return null;

    const resultLocations = await buildResultLocations({
        projectDir: active.projectDir,
        profileId: active.profileId,
        runId: active.runId,
        outputDir: active.outputDir,
    });

    const rawStatus = await readStatus(active.outputDir);
    const status = await enrichSummaryWithBandwidth({
        projectDir: active.projectDir,
        outputDir: active.outputDir,
        status: rawStatus,
    });

    return {
        projectDir: active.projectDir,
        profileId: active.profileId,
        runId: active.runId,
        solutionType: active.solutionType,
        startedAt: active.startedAt,
        status: status?.status || 'running',
        message: status?.message || 'Verification running in MATLAB/HFSS...',
        summary: status?.summary || null,
        resultLocations,
    };
};

const getLatestFinishedVerification = async (projectPath) => {
    const projectDir = resolveProjectDir(projectPath);
    const profilesRoot = path.join(projectDir, 'Result_Profile');
    if (!fs.existsSync(profilesRoot)) return null;

    const profileEntries = await fsPromises.readdir(profilesRoot, { withFileTypes: true }).catch(() => []);
    let best = null;

    for (const profileEntry of profileEntries) {
        if (!profileEntry.isDirectory() || !profileEntry.name.startsWith('profile_')) continue;

        const resultRoot = path.join(profilesRoot, profileEntry.name, 'result');
        if (!fs.existsSync(resultRoot)) continue;

        const runEntries = await fsPromises.readdir(resultRoot, { withFileTypes: true }).catch(() => []);
        for (const runEntry of runEntries) {
            if (!runEntry.isDirectory()) continue;
            const runId = runEntry.name;
            const outputDir = path.join(resultRoot, runId);
            const rawStatus = await readStatus(outputDir);
            const status = await enrichSummaryWithBandwidth({
                projectDir,
                outputDir,
                status: rawStatus,
            });
            if (!status) continue;

            const statusValue = String(status.status || '').toLowerCase();
            if (!['completed', 'error', 'cancelled', 'stopped'].includes(statusValue)) continue;

            const finishedAt = status.completedAt || status.completed_at || status.startedAt || status.started_at;
            const candidate = {
                projectDir,
                profileId: profileEntry.name,
                runId,
                solutionType: status.solutionType || status.solution_type || null,
                status: statusValue,
                message: status.message || null,
                summary: status.summary || null,
                completedAt: finishedAt,
                outputDir,
            };

            if (!best || toTimestamp(candidate.completedAt) > toTimestamp(best.completedAt)) {
                best = candidate;
            }
        }
    }

    if (!best) return null;

    const resultLocations = await buildResultLocations({
        projectDir: best.projectDir,
        profileId: best.profileId,
        runId: best.runId,
        outputDir: best.outputDir,
    });

    return {
        projectDir: best.projectDir,
        profileId: best.profileId,
        runId: best.runId,
        solutionType: best.solutionType,
        status: best.status,
        message: best.message,
        summary: best.summary,
        completedAt: best.completedAt,
        resultLocations,
    };
};

const getVerificationRuntimeState = async (projectPath = null) => {
    const activeVerification = await getActiveVerification(projectPath);
    if (activeVerification) {
        return {
            hasActiveVerification: true,
            activeVerification,
            latestFinishedVerification: null,
        };
    }

    const normalizedProjectPath = projectPath ? resolveProjectDir(projectPath) : null;
    const latestFinishedVerification = normalizedProjectPath
        ? await getLatestFinishedVerification(normalizedProjectPath)
        : lastFinishedVerification;

    return {
        hasActiveVerification: false,
        activeVerification: null,
        latestFinishedVerification,
    };
};

module.exports = {
    ALLOWED_CHARTS,
    startVerification,
    getVerificationStatus,
    getLatestVerificationForProfile,
    getVerificationChartPath,
    getVerificationRuntimeState,
};
