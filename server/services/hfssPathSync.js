const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

const setupConfigPath = path.join(__dirname, '..', '..', 'OPEN_THIS', 'SETUP', 'setup_loader');

function loadSetupConfig() {
    try {
        delete require.cache[require.resolve(setupConfigPath)];
        return require(setupConfigPath);
    } catch (error) {
        logger.warn('[HFSS Sync] Setup config not found', { error: error.message });
        return null;
    }
}

function normalizePathValue(value) {
    if (!value || typeof value !== 'string') return '';
    return value.trim().replace(/\//g, '\\').replace(/\\+$/g, '').toLowerCase();
}

function syncConfigFile(configPath, configuredHfssPath, options = {}) {
    const { cleanupNestedHfssPath = false } = options;

    if (!fs.existsSync(configPath)) {
        return {
            configPath,
            exists: false,
            updated: false,
            reason: 'config_missing',
        };
    }

    try {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!raw || typeof raw !== 'object') {
            return {
                configPath,
                exists: true,
                updated: false,
                reason: 'invalid_json',
            };
        }

        const currentHfssPath = raw.hfssExePath || raw?.hfss?.exe_path || null;
        if (normalizePathValue(currentHfssPath) === normalizePathValue(configuredHfssPath)) {
            return {
                configPath,
                exists: true,
                updated: false,
                reason: 'already_synced',
                currentHfssPath,
            };
        }

        raw.hfssExePath = configuredHfssPath;

        if (cleanupNestedHfssPath && raw.hfss && typeof raw.hfss === 'object' && 'exe_path' in raw.hfss) {
            delete raw.hfss.exe_path;
            if (Object.keys(raw.hfss).length === 0) {
                delete raw.hfss;
            }
        }

        fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf8');
        return {
            configPath,
            exists: true,
            updated: true,
            reason: 'updated',
            previousHfssPath: currentHfssPath,
        };
    } catch {
        return {
            configPath,
            exists: true,
            updated: false,
            reason: 'write_error',
        };
    }
}

function syncHfssPathForProject(projectPath) {
    if (!projectPath || typeof projectPath !== 'string') {
        return { updated: false, reason: 'invalid_project_path' };
    }

    const normalizedProjectPath = projectPath.trim().replace(/^"+|"+$/g, '');
    if (!normalizedProjectPath) {
        return { updated: false, reason: 'invalid_project_path' };
    }

    const setupConfig = loadSetupConfig();
    const configuredHfssPath = setupConfig?.getHfssExecutablePath?.() || null;
    if (!configuredHfssPath) {
        return { updated: false, reason: 'hfss_not_configured' };
    }

    const epConfigPath = path.join(normalizedProjectPath, 'Function', 'EARLY_PHASE', 'Config', 'EP_Config.json');
    const verificationConfigPath = path.join(normalizedProjectPath, 'Function', 'VERIFICATION', 'Config', 'Verification_Config.json');

    const epResult = syncConfigFile(epConfigPath, configuredHfssPath, { cleanupNestedHfssPath: true });
    const verificationResult = syncConfigFile(verificationConfigPath, configuredHfssPath, { cleanupNestedHfssPath: false });

    const updated = !!(epResult.updated || verificationResult.updated);
    const targets = [epResult, verificationResult];
    const missingBoth = targets.every((item) => item.reason === 'config_missing');
    const allAlreadySynced = targets.every((item) => item.reason === 'already_synced');
    const hasWriteError = targets.some((item) => item.reason === 'write_error' || item.reason === 'invalid_json');

    let reason = 'updated';
    if (missingBoth) reason = 'config_missing';
    else if (!updated && allAlreadySynced) reason = 'already_synced';
    else if (hasWriteError && !updated) reason = 'write_error';
    else if (!updated) reason = 'partial_no_update';

    if (hasWriteError) {
        const failed = targets.filter((item) => item.reason === 'write_error' || item.reason === 'invalid_json');
        logger.warn('[HFSS Sync] Failed to sync some config files', {
            configuredHfssPath,
            failed,
        });
    }

    return {
        updated,
        reason,
        configuredHfssPath,
        epConfigPath,
        verificationConfigPath,
        targets,
    };
}

module.exports = {
    syncHfssPathForProject,
};
