/**
 * Setup Configuration Loader (Node.js)
 * Loads and validates configuration from setup_variable.json
 */

const fs = require('fs');
const path = require('path');

class SetupConfigLoader {
    constructor() {
        this.configPath = path.join(__dirname, 'setup_variable.json');
        this.config = null;
        this.loaded = false;
    }

    /**
     * Load configuration from file
     * @returns {Object} Configuration object
     */
    load() {
        if (this.loaded && this.config) {
            return this.config;
        }

        try {
            if (!fs.existsSync(this.configPath)) {
                throw new Error(`Configuration file not found: ${this.configPath}`);
            }

            const configData = fs.readFileSync(this.configPath, 'utf-8');
            this.config = JSON.parse(configData);
            
            // Sync simplified top-level fields to internal config structure
            if (this.config.YOUR_IP_ADDRESS) {
                this.config.server.host = this.config.YOUR_IP_ADDRESS;
                this.config.network.subnet = this.config.YOUR_IP_ADDRESS.substring(0, this.config.YOUR_IP_ADDRESS.lastIndexOf('.')) + '.x';
                this.config.network.allowed_origins[0] = `http://${this.config.YOUR_IP_ADDRESS}:${this.config.SERVER_PORT || 3001}`;
            }
            if (this.config.SERVER_PORT) {
                this.config.server.port = this.config.SERVER_PORT;
            }
            if (this.config.MATLAB_PATH) {
                this.config.matlab.installation_paths = [this.config.MATLAB_PATH];
            }
            if (this.config.PYTHON_PATH) {
                this.config.python.executable = this.config.PYTHON_PATH;
            }
            
            this.loaded = true;

            console.log('✅ Loaded configuration from setup_variable.json');
            return this.config;
        } catch (error) {
            console.error('❌ Failed to load configuration:', error.message);
            throw error;
        }
    }

    /**
     * Get MATLAB installation paths
     * @returns {Array} Array of MATLAB installation paths
     */
    getMatlabPaths() {
        const config = this.load();
        return config.matlab.installation_paths || [];
    }

    /**
     * Get server configuration
     * @returns {Object} Server configuration
     */
    getServerConfig() {
        const config = this.load();
        const host = config.server?.host;
        const port = config.server?.port || 3001;
        
        if (!host) {
            throw new Error('Server host not configured in setup_variable.json. Please set server.host to your PC\'s IP address.');
        }
        
        return {
            host: host,
            port: port,
            url: `http://${host}:${port}`,
            websocket: {
                enabled: config.server?.websocket?.enabled !== false,
                path: config.server?.websocket?.path || '/ws',
                url: `ws://${host}:${port}${config.server?.websocket?.path || '/ws'}`
            }
        };
    }

    /**
     * Get Python executable path
     * @returns {string} Python executable path
     */
    getPythonExecutable() {
        const config = this.load();
        return config.python.executable || 'python';
    }

    /**
     * Get HFSS process names
     * @returns {Array} Array of HFSS process names
     */
    getHfssProcessNames() {
        const config = this.load();
        return config.hfss.process_names || [
            'ansysedt.exe',
            'anshfss.exe',
            'ansysli_server.exe'
        ];
    }

    /**
     * Get network configuration
     * @returns {Object} Network configuration
     */
    getNetworkConfig() {
        const config = this.load();
        return {
            allowedOrigins: config.network.allowed_origins || [],
            corsEnabled: config.network.cors_enabled !== false
        };
    }

    /**
     * Get performance settings
     * @returns {Object} Performance settings
     */
    getPerformanceSettings() {
        const config = this.load();
        return config.performance || {
            cache_ttl_ms: 1000,
            websocket_heartbeat_ms: 2000,
            status_polling_interval_ms: 3000,
            max_file_upload_mb: 50
        };
    }

    /**
     * Get project paths
     * @returns {Object} Project paths configuration
     */
    getProjectPaths() {
        const config = this.load();
        const projectRoot = process.cwd();
        
        return {
            projectRoot: path.resolve(config.paths.project_root || projectRoot),
            uploadsDir: path.resolve(config.paths.uploads_dir || path.join(projectRoot, 'uploads')),
            gndFilesDir: path.resolve(config.paths.gnd_files_dir || path.join(projectRoot, 'uploads', 'gnd_files')),
            configDir: path.resolve(config.paths.config_dir || path.join(projectRoot, 'config')),
            scriptsDir: path.resolve(config.paths.scripts_dir || path.join(projectRoot, 'scripts')),
            testFilesDir: path.resolve(config.paths.test_files_dir || path.join(projectRoot, 'test_files'))
        };
    }

    /**
     * Validate configuration
     * @returns {Object} Validation result {isValid: boolean, errors: Array, warnings: Array}
     */
    validate() {
        const errors = [];
        const warnings = [];

        try {
            const config = this.load();

            // Check required top-level fields
            if (!config.YOUR_IP_ADDRESS) {
                errors.push('❌ YOUR_IP_ADDRESS is missing');
            }
            if (!config.SERVER_PORT) {
                errors.push('❌ SERVER_PORT is missing');
            }
            if (!config.MATLAB_PATH) {
                errors.push('❌ MATLAB_PATH is missing');
            }
            if (!config.PYTHON_PATH) {
                errors.push('❌ PYTHON_PATH is missing');
            }

            // Check MATLAB path exists
            if (config.MATLAB_PATH && !fs.existsSync(config.MATLAB_PATH)) {
                errors.push(`❌ MATLAB not found at: ${config.MATLAB_PATH}`);
            }

            // Check Python path exists
            if (config.PYTHON_PATH && !fs.existsSync(config.PYTHON_PATH)) {
                errors.push(`❌ Python not found at: ${config.PYTHON_PATH}`);
            }

            // Check IP format
            if (config.YOUR_IP_ADDRESS) {
                const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
                if (!ipRegex.test(config.YOUR_IP_ADDRESS)) {
                    warnings.push(`⚠️  IP address format may be invalid: ${config.YOUR_IP_ADDRESS}`);
                }
            }

            return {
                isValid: errors.length === 0,
                errors: errors,
                warnings: warnings
            };
        } catch (error) {
            return {
                isValid: false,
                errors: [`❌ Failed to load configuration: ${error.message}`],
                warnings: []
            };
        }
    }

    /**
     * Get full configuration object
     * @returns {Object} Complete configuration
     */
    getConfig() {
        return this.load();
    }
}

// Singleton instance
const setupConfig = new SetupConfigLoader();

module.exports = setupConfig;
