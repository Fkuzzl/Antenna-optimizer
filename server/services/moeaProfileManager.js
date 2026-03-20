const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const logger = require('../config/logger');
const { readSimulationResults } = require('./excelReader');

const PROFILE_ROOT_DIRNAME = 'Result_Profile';
const PROFILE_CONTEXT_FILE = '_context.json';
const INTEGRATED_RESULTS_FILENAME = 'Integrated_Results.xlsx';
const VARIABLE_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'antenna_variables.json');
const BALANCED_OPTIMAL_MAX_AR_DB = 1;
const TARGET_FREQUENCY_GHZ = 1.575;

let variableConfigCache = null;

const stripBom = (text) => String(text || '').replace(/^\uFEFF/, '');

const readJsonFileSafe = async (filePath, fallback = null) => {
    try {
        const raw = await fsPromises.readFile(filePath, 'utf8');
        return JSON.parse(stripBom(raw));
    } catch {
        return fallback;
    }
};

const normalizeProfileName = (value) => {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ');
    return normalized || null;
};

const loadVariableConfig = () => {
    if (variableConfigCache) return variableConfigCache;

    let variables = [];
    if (fs.existsSync(VARIABLE_CONFIG_PATH)) {
        try {
            const parsed = JSON.parse(stripBom(fs.readFileSync(VARIABLE_CONFIG_PATH, 'utf8')));
            variables = Array.isArray(parsed?.variables) ? parsed.variables : [];
        } catch {
            variables = [];
        }
    }

    const byName = {};
    for (const item of variables) {
        if (!item?.name) continue;
        byName[item.name.toLowerCase()] = item;
    }

    variableConfigCache = { variables, byName };
    return variableConfigCache;
};

const resolveProjectDir = (projectPath) => {
    const cleaned = String(projectPath || '').trim().replace(/^"+|"+$/g, '');
    if (!cleaned) return '';

    try {
        if (fs.existsSync(cleaned) && fs.statSync(cleaned).isFile()) {
            return path.dirname(cleaned);
        }
    } catch {
        return cleaned;
    }

    return cleaned;
};

const getProfileRoot = (projectPath) => path.join(resolveProjectDir(projectPath), PROFILE_ROOT_DIRNAME);

const getPythonExecutable = () => {
    try {
        const setupConfig = require(path.join(__dirname, '..', '..', 'OPEN_THIS', 'SETUP', 'setup_loader'));
        return setupConfig.getPythonExecutable();
    } catch {
        return 'python';
    }
};

const runCommand = (command) => new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
            reject(new Error(stderr || error.message));
            return;
        }
        resolve({ stdout, stderr });
    });
});

const refreshIntegratedExcel = async (projectDir) => {
    const excelPath = path.join(projectDir, INTEGRATED_RESULTS_FILENAME);
    const pythonExe = getPythonExecutable();

    let scriptPath;
    let command;

    if (fs.existsSync(excelPath)) {
        scriptPath = path.join(__dirname, '..', '..', 'scripts', 'update_excel_incremental.py');
        command = `"${pythonExe}" "${scriptPath}" --project-path "${projectDir}"`;
    } else {
        scriptPath = path.join(__dirname, '..', '..', 'scripts', 'integrated_results_manager.py');
        command = `"${pythonExe}" "${scriptPath}" create --project-path "${projectDir}"`;
    }

    await runCommand(command);
};

const normalizeValue = (value, min, max, mode = 'max') => {
    if (value == null || isNaN(value)) return 0;
    if (max === min) return 1;
    if (mode === 'min') {
        return (max - value) / (max - min);
    }
    return (value - min) / (max - min);
};

const getInterpolatedPercentageBelowThreshold = (frequencies = [], values = [], threshold = 3) => {
    const points = [];

    const count = Math.min(frequencies.length, values.length);
    for (let index = 0; index < count; index++) {
        const frequency = Number(frequencies[index]);
        const value = Number(values[index]);
        if (Number.isNaN(frequency) || Number.isNaN(value)) continue;
        points.push({ frequency, value });
    }

    if (points.length < 2) return null;

    points.sort((left, right) => left.frequency - right.frequency);

    let totalSpan = 0;
    let belowSpan = 0;

    for (let index = 0; index < points.length - 1; index++) {
        const p1 = points[index];
        const p2 = points[index + 1];

        const segmentLength = p2.frequency - p1.frequency;
        if (!(segmentLength > 0)) continue;

        totalSpan += segmentLength;

        const y1 = p1.value;
        const y2 = p2.value;

        if (y1 < threshold && y2 < threshold) {
            belowSpan += segmentLength;
            continue;
        }

        if (y1 >= threshold && y2 >= threshold) {
            continue;
        }

        if (y1 === y2) {
            continue;
        }

        const ratio = (threshold - y1) / (y2 - y1);
        const crossingFrequency = p1.frequency + (ratio * segmentLength);

        if (y1 < threshold) {
            belowSpan += Math.max(0, crossingFrequency - p1.frequency);
        } else {
            belowSpan += Math.max(0, p2.frequency - crossingFrequency);
        }
    }

    if (!(totalSpan > 0)) return null;
    return (belowSpan / totalSpan) * 100;
};

const buildMetricTriplet = (iteration, key) => {
    const frequencies = Array.isArray(iteration?.frequencies) ? [...iteration.frequencies] : [];
    const values = Array.isArray(iteration?.[key]) ? [...iteration[key]] : [];

    if (!values.length) return [];

    if (frequencies.length === values.length && frequencies.length > 0) {
        return frequencies
            .map((frequency, index) => ({ frequency, value: values[index] }))
            .filter((point) => typeof point.frequency === 'number' && !isNaN(point.frequency) && typeof point.value === 'number' && !isNaN(point.value))
            .sort((a, b) => a.frequency - b.frequency)
            .slice(0, 3);
    }

    return values
        .filter((value) => typeof value === 'number' && !isNaN(value))
        .slice(0, 3)
        .map((value, index) => ({ frequency: null, value, index }));
};

const getObjectiveValue = (iteration, metricKey, targetFrequency, objective) => {
    const values = Array.isArray(iteration?.[metricKey]) ? iteration[metricKey] : [];
    const frequencies = Array.isArray(iteration?.frequencies) ? iteration.frequencies : [];

    if (values.length === 0) return null;

    if (frequencies.length > 0 && values.length === frequencies.length) {
        let bestIndex = 0;
        let bestDelta = Math.abs(frequencies[0] - targetFrequency);
        for (let index = 1; index < frequencies.length; index++) {
            const delta = Math.abs(frequencies[index] - targetFrequency);
            if (delta < bestDelta) {
                bestDelta = delta;
                bestIndex = index;
            }
        }

        const atTarget = values[bestIndex];
        if (typeof atTarget === 'number' && !isNaN(atTarget)) {
            return atTarget;
        }
    }

    const numericValues = values.filter((value) => typeof value === 'number' && !isNaN(value));
    if (numericValues.length === 0) return null;
    return objective === 'max' ? Math.max(...numericValues) : Math.min(...numericValues);
};

const findNearestAr1575 = (triplet) => {
    if (!triplet || !triplet.length) return null;

    const withFrequency = triplet.filter((point) => typeof point.frequency === 'number' && !isNaN(point.frequency));
    if (withFrequency.length) {
        const nearest = withFrequency.reduce((best, current) => {
            if (!best) return current;
            return Math.abs(current.frequency - 1.575) < Math.abs(best.frequency - 1.575) ? current : best;
        }, null);
        return nearest?.value ?? null;
    }

    const values = triplet.map((point) => point.value).filter((value) => typeof value === 'number' && !isNaN(value));
    if (!values.length) return null;
    return Math.min(...values);
};

const computeProfileOptimals = (iterations) => {
    const candidates = iterations
        .map((iteration) => {
            const s11Triplet = buildMetricTriplet(iteration, 's11');
            const arTriplet = buildMetricTriplet(iteration, 'ar');
            const gainTriplet = buildMetricTriplet(iteration, 'gain');

            if (!s11Triplet.length || !arTriplet.length || !gainTriplet.length) {
                return null;
            }

            const s11Representative = getObjectiveValue(iteration, 's11', TARGET_FREQUENCY_GHZ, 'min');
            const ar1575 = getObjectiveValue(iteration, 'ar', TARGET_FREQUENCY_GHZ, 'min');
            const gainRepresentative = getObjectiveValue(iteration, 'gain', TARGET_FREQUENCY_GHZ, 'max');
            const arBelow3Pct = getInterpolatedPercentageBelowThreshold(
                iteration?.frequencies,
                iteration?.ar,
                3
            );

            if (s11Representative == null || ar1575 == null || gainRepresentative == null) {
                return null;
            }

            return {
                iteration: iteration.iteration,
                s11Triplet,
                arTriplet,
                gainTriplet,
                s11Representative,
                ar1575,
                gainRepresentative,
                arBelow3Pct,
            };
        })
        .filter(Boolean);

    if (!candidates.length) {
        return {
            balanced: null,
            optimal: null,
            totalIterations: 0,
        };
    }

    const scoreCandidates = (pool, mode) => {
        if (!Array.isArray(pool) || pool.length === 0) return null;

        const s11Min = Math.min(...pool.map((item) => item.s11Representative));
        const s11Max = Math.max(...pool.map((item) => item.s11Representative));
        const arMin = Math.min(...pool.map((item) => item.ar1575));
        const arMax = Math.max(...pool.map((item) => item.ar1575));
        const gainMin = Math.min(...pool.map((item) => item.gainRepresentative));
        const gainMax = Math.max(...pool.map((item) => item.gainRepresentative));

        let best = null;
        for (const candidate of pool) {
            const s11Score = normalizeValue(candidate.s11Representative, s11Min, s11Max, 'min');
            const arScore = normalizeValue(candidate.ar1575, arMin, arMax, 'min');
            const gainScore = normalizeValue(candidate.gainRepresentative, gainMin, gainMax, 'max');

            const score = mode === 'balanced'
                ? (s11Score + arScore + gainScore) / 3
                : (s11Score * 0.45) + (arScore * 0.40) + (gainScore * 0.15);

            const scored = {
                ...candidate,
                score: {
                    [mode]: score,
                    s11Score,
                    arScore,
                    gainScore,
                },
            };

            if (!best || scored.score[mode] > best.score[mode]) {
                best = scored;
            }
        }

        return best;
    };

    const balancedPool = candidates.filter((candidate) => candidate.ar1575 < BALANCED_OPTIMAL_MAX_AR_DB);
    const bestBalanced = scoreCandidates(balancedPool.length > 0 ? balancedPool : candidates, 'balanced');
    const bestOptimal = scoreCandidates(candidates, 'optimal');

    const toProfileResult = (candidate, mode) => {
        if (!candidate) return null;
        return {
            mode,
            iteration: candidate.iteration,
            s11: candidate.s11Triplet,
            ar: candidate.arTriplet,
            gain: candidate.gainTriplet,
            arBelow3Pct: candidate.arBelow3Pct,
            arAt1575: candidate.ar1575,
            score: candidate.score[mode],
            arBandwidthMeta: {
                thresholdDb: 3,
                method: 'linear-interpolation',
                predicted: true,
            },
        };
    };

    return {
        balanced: toProfileResult(bestBalanced, 'balanced'),
        optimal: toProfileResult(bestOptimal, 'optimal'),
        totalIterations: candidates.length,
    };
};

const saveProfileContext = async (projectPath, patch) => {
    const projectDir = resolveProjectDir(projectPath);
    if (!projectDir) return null;

    const profilesRoot = getProfileRoot(projectDir);
    await fsPromises.mkdir(profilesRoot, { recursive: true });

    const contextPath = path.join(profilesRoot, PROFILE_CONTEXT_FILE);

    let existing = {};
    if (fs.existsSync(contextPath)) {
        existing = await readJsonFileSafe(contextPath, {}) || {};
    }

    const next = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
    };

    await fsPromises.writeFile(contextPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
};

const loadProfileContext = async (projectPath) => {
    const projectDir = resolveProjectDir(projectPath);
    const contextPath = path.join(getProfileRoot(projectDir), PROFILE_CONTEXT_FILE);
    if (!fs.existsSync(contextPath)) return {};

    return (await readJsonFileSafe(contextPath, {})) || {};
};

const copyIfExists = async (sourcePath, destPath) => {
    if (!fs.existsSync(sourcePath)) return false;
    await fsPromises.copyFile(sourcePath, destPath);
    return true;
};

const getCandidateVbsPaths = (projectDir, iteration) => {
    const fileName = `Antenna${iteration}.vbs`;
    const candidates = [
        path.join(projectDir, 'Optimization', 'temp', fileName),
        path.join(projectDir, 'Optimization', 'Temp', fileName),
        path.join(projectDir, 'backup_Optimization', 'temp', fileName),
    ];

    try {
        const entries = fs.readdirSync(projectDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (!entry.name.toLowerCase().startsWith('backup_optimization')) continue;
            candidates.push(path.join(projectDir, entry.name, 'temp', fileName));
        }
    } catch {
        // ignore
    }

    return candidates;
};

const parseNumericWithUnit = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    const match = trimmed.match(/^([+-]?[\d.]+(?:e[+-]?\d+)?)\s*([a-zA-Z%]+)?$/i);
    if (!match) return null;

    const value = Number(match[1]);
    if (Number.isNaN(value)) return null;

    return {
        value,
        unitFromVbs: match[2] || null,
    };
};

const parseVariablesFromVbs = (projectDir, iteration) => {
    if (!iteration || Number.isNaN(Number(iteration))) return [];

    const candidates = getCandidateVbsPaths(projectDir, Number(iteration));
    const vbsPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!vbsPath) return [];

    const content = fs.readFileSync(vbsPath, 'utf8');
    const { byName } = loadVariableConfig();

    const regex = /Array\("NAME:([A-Za-z0-9_]+)"\s*,\s*"Value:="\s*,\s*"([^"]+)"\)\)\)/g;
    const variableMap = new Map();
    let match;

    while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        const parsed = parseNumericWithUnit(match[2]);
        if (!parsed) continue;

        const meta = byName[name.toLowerCase()] || {};
        const unit = parsed.unitFromVbs || meta.units || '';
        variableMap.set(name.toLowerCase(), {
            name,
            value: parsed.value,
            unit,
            displayValue: `${parsed.value}${unit}`,
            category: meta.category || null,
            description: meta.description || null,
        });
    }

    const ordered = [];
    const { variables } = loadVariableConfig();
    for (const variable of variables) {
        const item = variableMap.get(String(variable.name || '').toLowerCase());
        if (!item) continue;
        if (variable.category && variable.category !== 'standard') continue;
        ordered.push(item);
    }

    for (const item of variableMap.values()) {
        if (!ordered.find((existing) => existing.name.toLowerCase() === item.name.toLowerCase())) {
            ordered.push(item);
        }
    }

    return ordered;
};

const parseNumericAssignment = (content, variableName) => {
    const regex = new RegExp(`^\\s*${variableName}\\s*=\\s*([+-]?[\\d.]+(?:e[+-]?\\d+)?)\\s*;`, 'im');
    const match = String(content || '').match(regex);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
};

const deriveContextFromFModel = (projectDir) => {
    const fModelPath = path.join(projectDir, 'Function', 'HFSS', 'F_Model_Element.m');
    if (!fs.existsSync(fModelPath)) {
        return { gndSetting: null, antennaPosition: null };
    }

    try {
        const content = fs.readFileSync(fModelPath, 'utf8');
        const Lgx = parseNumericAssignment(content, 'Lgx');
        const Lgy = parseNumericAssignment(content, 'Lgy');
        const GND_xPos = parseNumericAssignment(content, 'GND_xPos');
        const GND_yPos = parseNumericAssignment(content, 'GND_yPos');

        const hasGeometry = Number.isFinite(Lgx) && Number.isFinite(Lgy);
        const hasPosition = Number.isFinite(GND_xPos) && Number.isFinite(GND_yPos);

        const gndSetting = hasGeometry
            ? {
                mode: 'parametric',
                Lgx,
                Lgy,
                GND_xPos: hasPosition ? GND_xPos : null,
                GND_yPos: hasPosition ? GND_yPos : null,
            }
            : null;

        const antennaPosition = hasPosition
            ? { x: GND_xPos, y: GND_yPos }
            : null;

        return { gndSetting, antennaPosition };
    } catch {
        return { gndSetting: null, antennaPosition: null };
    }
};

const createMoeaProfile = async (projectPath, options = {}) => {
    const projectDir = resolveProjectDir(projectPath);
    if (!projectDir || !fs.existsSync(projectDir)) {
        throw new Error(`Invalid project directory: ${projectPath}`);
    }

    const profilesRoot = getProfileRoot(projectDir);
    await fsPromises.mkdir(profilesRoot, { recursive: true });

    try {
        await refreshIntegratedExcel(projectDir);
    } catch (error) {
        logger.warn('[MOEAProfile] Failed to refresh integrated Excel before snapshot', {
            projectDir,
            error: error.message,
        });
    }

    const profileId = `profile_${Date.now()}`;
    const profileDir = path.join(profilesRoot, profileId);
    await fsPromises.mkdir(profileDir, { recursive: true });

    const excelPath = path.join(projectDir, INTEGRATED_RESULTS_FILENAME);
    const excelSnapshotName = `Integrated_Results_${profileId}.xlsx`;
    const excelSnapshotPath = path.join(profileDir, excelSnapshotName);

    let iterations = [];
    let optimalResults = { balanced: null, optimal: null, totalIterations: 0 };

    if (fs.existsSync(excelPath)) {
        try {
            const iterationData = readSimulationResults(excelPath);
            iterations = Object.values(iterationData).sort((a, b) => a.iteration - b.iteration);
            optimalResults = computeProfileOptimals(iterations);
            await fsPromises.copyFile(excelPath, excelSnapshotPath);
        } catch (error) {
            logger.warn('[MOEAProfile] Unable to read/copy integrated Excel', {
                excelPath,
                error: error.message,
            });
        }
    }

    const context = await loadProfileContext(projectDir);
    const derivedContext = deriveContextFromFModel(projectDir);
    const effectiveGndSetting = context.gndSetting || derivedContext.gndSetting || null;
    const effectiveAntennaPosition = context.antennaPosition || derivedContext.antennaPosition || null;
    const profileName = normalizeProfileName(options.profileName)
        || normalizeProfileName(context.moeaProfileName)
        || profileId;

    const gndImportPath = path.join(projectDir, 'Function', 'HFSS', 'F_GND_Import.m');
    const fModelPath = path.join(projectDir, 'Function', 'HFSS', 'F_Model_Element.m');

    const copiedArtifacts = {
        fModel: await copyIfExists(fModelPath, path.join(profileDir, 'F_Model_Element.m')),
        gndImport: await copyIfExists(gndImportPath, path.join(profileDir, 'F_GND_Import.m')),
        integratedExcel: fs.existsSync(excelSnapshotPath),
    };

    const profileData = {
        profileId,
        profileName,
        createdAt: new Date().toISOString(),
        projectDir,
        status: options.status || 'stopped',
        reason: options.reason || 'manual-stop',
        trigger: options.trigger || 'api-stop',
        totalIterations: optimalResults.totalIterations || 0,
        valid: (optimalResults.totalIterations || 0) > 100,
        optimalResults,
        gndSetting: effectiveGndSetting,
        variableSetting: context.variableSetting || null,
        antennaPosition: effectiveAntennaPosition,
        artifacts: {
            integratedExcelSnapshot: copiedArtifacts.integratedExcel ? excelSnapshotName : null,
            fModelSnapshot: copiedArtifacts.fModel ? 'F_Model_Element.m' : null,
            gndImportSnapshot: copiedArtifacts.gndImport ? 'F_GND_Import.m' : null,
        },
    };

    if (profileData.optimalResults?.balanced?.iteration) {
        profileData.optimalResults.balanced.variableValues = parseVariablesFromVbs(
            projectDir,
            profileData.optimalResults.balanced.iteration
        );
    }

    if (profileData.optimalResults?.optimal?.iteration) {
        profileData.optimalResults.optimal.variableValues = parseVariablesFromVbs(
            projectDir,
            profileData.optimalResults.optimal.iteration
        );
    }

    const profileFilePath = path.join(profileDir, 'profile.json');
    await fsPromises.writeFile(profileFilePath, JSON.stringify(profileData, null, 2), 'utf8');

    return {
        profileId,
        profileDir,
        profile: profileData,
    };
};

const listMoeaProfiles = async (projectPath) => {
    const projectDir = resolveProjectDir(projectPath);
    const profilesRoot = getProfileRoot(projectDir);

    if (!fs.existsSync(profilesRoot)) {
        return [];
    }

    const entries = await fsPromises.readdir(profilesRoot, { withFileTypes: true });
    const profiles = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith('profile_')) continue;

        const profileFile = path.join(profilesRoot, entry.name, 'profile.json');
        if (!fs.existsSync(profileFile)) continue;

        try {
            const profile = await readJsonFileSafe(profileFile, null);
            if (!profile) continue;
            profile.profileName = normalizeProfileName(profile.profileName) || profile.profileId || entry.name;
            profiles.push(profile);
        } catch {
            // ignore corrupt profile files
        }
    }

    profiles.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return profiles;
};

const getMoeaProfile = async (projectPath, profileId) => {
    const projectDir = resolveProjectDir(projectPath);
    const profileFile = path.join(getProfileRoot(projectDir), profileId, 'profile.json');

    if (!fs.existsSync(profileFile)) {
        throw new Error(`Profile not found: ${profileId}`);
    }

    const profile = await readJsonFileSafe(profileFile, null);
    if (!profile) {
        throw new Error(`Profile parse failed: ${profileId}`);
    }

    const normalizedName = normalizeProfileName(profile.profileName) || profile.profileId || profileId;
    const nameUpdated = profile.profileName !== normalizedName;
    if (nameUpdated) {
        profile.profileName = normalizedName;
    }

    let updated = false;
    if (profile?.optimalResults?.balanced?.iteration && !Array.isArray(profile?.optimalResults?.balanced?.variableValues)) {
        profile.optimalResults.balanced.variableValues = parseVariablesFromVbs(projectDir, profile.optimalResults.balanced.iteration);
        updated = true;
    }
    if (profile?.optimalResults?.optimal?.iteration && !Array.isArray(profile?.optimalResults?.optimal?.variableValues)) {
        profile.optimalResults.optimal.variableValues = parseVariablesFromVbs(projectDir, profile.optimalResults.optimal.iteration);
        updated = true;
    }

    if (updated || nameUpdated) {
        await fsPromises.writeFile(profileFile, JSON.stringify(profile, null, 2), 'utf8');
    }

    return profile;
};

const deleteMoeaProfile = async (projectPath, profileId) => {
    const projectDir = resolveProjectDir(projectPath);
    const normalizedId = String(profileId || '').trim();

    if (!normalizedId) {
        throw new Error('profileId is required');
    }

    if (!/^profile_[A-Za-z0-9_-]+$/.test(normalizedId)) {
        throw new Error(`Invalid profileId: ${normalizedId}`);
    }

    const profilesRoot = path.resolve(getProfileRoot(projectDir));
    const profileDir = path.resolve(path.join(profilesRoot, normalizedId));

    const safePrefix = `${profilesRoot}${path.sep}`;
    if (profileDir !== profilesRoot && !profileDir.startsWith(safePrefix)) {
        throw new Error('Invalid profile path');
    }

    if (!fs.existsSync(profileDir)) {
        throw new Error(`Profile not found: ${normalizedId}`);
    }

    await fsPromises.rm(profileDir, { recursive: true, force: false });

    return {
        profileId: normalizedId,
        profileDir,
    };
};

module.exports = {
    resolveProjectDir,
    saveProfileContext,
    loadProfileContext,
    createMoeaProfile,
    listMoeaProfiles,
    getMoeaProfile,
    deleteMoeaProfile,
};
