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
    if (!fs.existsSync(epConfigPath)) {
        return { updated: false, reason: 'ep_config_missing', epConfigPath, configuredHfssPath };
    }

    try {
        const raw = JSON.parse(fs.readFileSync(epConfigPath, 'utf8'));
        if (!raw || typeof raw !== 'object') {
            return { updated: false, reason: 'invalid_json', epConfigPath, configuredHfssPath };
        }

        const currentHfssPath = raw.hfssExePath || raw?.hfss?.exe_path || null;
        if (normalizePathValue(currentHfssPath) === normalizePathValue(configuredHfssPath)) {
            return {
                updated: false,
                reason: 'already_synced',
                epConfigPath,
                configuredHfssPath,
                currentHfssPath,
            };
        }

        raw.hfssExePath = configuredHfssPath;

        // Keep only top-level key in EP_Config for HFSS path to avoid duplicate fields.
        if (raw.hfss && typeof raw.hfss === 'object' && 'exe_path' in raw.hfss) {
            delete raw.hfss.exe_path;
            if (Object.keys(raw.hfss).length === 0) {
                delete raw.hfss;
            }
        }

        fs.writeFileSync(epConfigPath, JSON.stringify(raw, null, 2), 'utf8');
        return {
            updated: true,
            reason: 'updated',
            epConfigPath,
            configuredHfssPath,
            previousHfssPath: currentHfssPath,
        };
    } catch (error) {
        logger.warn('[HFSS Sync] Failed to sync EP_Config.json', { epConfigPath, error: error.message });
        return { updated: false, reason: 'write_error', epConfigPath, configuredHfssPath };
    }
}

module.exports = {
    syncHfssPathForProject,
};
