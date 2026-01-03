const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const readline = require('readline');

class QuickSetup {
    constructor() {
        this.configPath = path.join(__dirname, 'setup_variable.json');
        this.detectedConfig = {};
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async run() {
        console.clear();
        console.log('========================================');
        console.log('   ANTENNA OPTIMIZER - QUICK SETUP');
        console.log('========================================\n');

        // Step 1: Check system dependencies
        await this.checkDependencies();

        const isManual = process.argv.includes('--manual');

        if (!isManual) {
            console.log('\n🔍 Auto-detecting your system...\n');
            await this.autoDetect();
            await this.confirmSettings();
        } else {
            console.log('\n📝 Manual configuration mode\n');
            await this.manualSetup();
        }

        await this.testConfiguration();
        await this.saveConfiguration();

        console.log('\n✅ Setup complete!\n');
        console.log('📝 Next steps:');
        console.log('   1. Run start_application.bat to launch the server');
        console.log('   2. Wait for the server to start completely');
        console.log(`   3. The application will automatically pop out in browser, or you can open it manually at http://${this.detectedConfig.ip}:8081\n`);
        
        this.rl.close();
    }

    async autoDetect() {
        // Detect IP Address
        this.detectedConfig.ip = this.detectIP();
        console.log(`✅ IP Address: ${this.detectedConfig.ip}`);

        // Detect MATLAB
        this.detectedConfig.matlab = this.detectMATLAB();
        if (this.detectedConfig.matlab) {
            console.log(`✅ MATLAB: ${this.detectedConfig.matlab}`);
        } else {
            console.log(`⚠️  MATLAB: Not found (will need manual input)`);
        }

        // Detect Python
        this.detectedConfig.python = this.detectPython();
        if (this.detectedConfig.python) {
            console.log(`✅ Python: ${this.detectedConfig.python}`);
        } else {
            console.log(`⚠️  Python: Not found (will need manual input)`);
        }

        // Check port availability
        const portAvailable = this.checkPort(3001);
        console.log(`${portAvailable ? '✅' : '⚠️ '} Port 3001: ${portAvailable ? 'Available' : 'In use (will use 3002)'}`);
        this.detectedConfig.port = portAvailable ? 3001 : 3002;
    }

    async checkDependencies() {
        console.log('========================================');
        console.log('   CHECKING SYSTEM DEPENDENCIES');
        console.log('========================================\n');

        let hasErrors = false;
        const missingDeps = [];

        // Check Node.js
        try {
            const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
            console.log(`✅ Node.js: ${nodeVersion}`);
        } catch (error) {
            console.log('❌ Node.js: NOT FOUND');
            missingDeps.push('Node.js (https://nodejs.org)');
            hasErrors = true;
        }

        // Check npm
        try {
            const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
            console.log(`✅ npm: ${npmVersion}`);
        } catch (error) {
            console.log('❌ npm: NOT FOUND');
            missingDeps.push('npm (comes with Node.js)');
            hasErrors = true;
        }

        // Check node_modules
        const projectRoot = path.resolve(__dirname, '..', '..');
        const nodeModulesPath = path.join(projectRoot, 'node_modules');
        if (fs.existsSync(nodeModulesPath)) {
            console.log('✅ npm packages: Installed');
        } else {
            console.log('⚠️  npm packages: Not installed');
            const installNpm = await this.question('\nRun "npm install" now? [Y/n]: ');
            if (installNpm.toLowerCase() !== 'n') {
                console.log('\nInstalling npm packages...');
                try {
                    execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
                    console.log('✅ npm packages installed successfully\n');
                } catch (error) {
                    console.log('❌ npm install failed\n');
                    hasErrors = true;
                }
            }
        }

        // Check Python (basic detection)
        let pythonCmd = null;
        try {
            execSync('python --version', { stdio: 'ignore' });
            pythonCmd = 'python';
            const pyVersion = execSync('python --version', { encoding: 'utf8' }).trim();
            console.log(`✅ Python: ${pyVersion}`);
        } catch (error) {
            try {
                execSync('python3 --version', { stdio: 'ignore' });
                pythonCmd = 'python3';
                const pyVersion = execSync('python3 --version', { encoding: 'utf8' }).trim();
                console.log(`✅ Python: ${pyVersion}`);
            } catch (error2) {
                console.log('❌ Python: NOT FOUND');
                missingDeps.push('Python 3.7+ (https://python.org)');
                hasErrors = true;
            }
        }

        // Check Python libraries if Python is available
        if (pythonCmd) {
            const requiredLibs = ['pandas', 'numpy', 'openpyxl', 'ezdxf'];
            const missingLibs = [];

            for (const lib of requiredLibs) {
                try {
                    execSync(`${pythonCmd} -c "import ${lib}"`, { stdio: 'ignore' });
                    console.log(`✅ Python library: ${lib}`);
                } catch (error) {
                    console.log(`⚠️  Python library: ${lib} - Not installed`);
                    missingLibs.push(lib);
                }
            }

            if (missingLibs.length > 0) {
                const installPython = await this.question(`\nInstall missing Python libraries (${missingLibs.join(', ')})? [Y/n]: `);
                if (installPython.toLowerCase() !== 'n') {
                    console.log('\nInstalling Python libraries...');
                    const requirementsPath = path.join(__dirname, 'requirements.txt');
                    try {
                        execSync(`${pythonCmd} -m pip install -r "${requirementsPath}"`, { stdio: 'inherit' });
                        console.log('✅ Python libraries installed successfully\n');
                    } catch (error) {
                        console.log('⚠️  Some Python libraries may have failed to install\n');
                    }
                }
            }
        }

        if (hasErrors) {
            console.log('\n========================================');
            console.log('   ❌ MISSING DEPENDENCIES');
            console.log('========================================\n');
            console.log('Please install the following:\n');
            missingDeps.forEach(dep => console.log(`  • ${dep}`));
            console.log('\nThen run setup again.\n');
            process.exit(1);
        }

        console.log('\n✅ All system dependencies are ready!\n');
    }

    detectIP() {
        const interfaces = os.networkInterfaces();
        
        // Priority: Wi-Fi > Ethernet > First non-localhost
        const priorities = ['Wi-Fi', 'Wireless', 'Ethernet', 'en0', 'eth0'];
        
        for (const priority of priorities) {
            for (const [name, addresses] of Object.entries(interfaces)) {
                if (name.toLowerCase().includes(priority.toLowerCase())) {
                    const ipv4 = addresses.find(addr => addr.family === 'IPv4' && !addr.internal);
                    if (ipv4) return ipv4.address;
                }
            }
        }
        
        // Fallback: first non-localhost IPv4
        for (const addresses of Object.values(interfaces)) {
            const ipv4 = addresses.find(addr => addr.family === 'IPv4' && !addr.internal);
            if (ipv4) return ipv4.address;
        }
        
        return '127.0.0.1';
    }

    detectMATLAB() {
        // Search multiple common locations
        const searchPaths = [
            'C:\\Program Files\\MATLAB',
            'C:\\Program Files (x86)\\MATLAB',
            'D:\\Program Files\\MATLAB',
            'D:\\MATLAB',
            'C:\\MATLAB'
        ];

        for (const matlabDir of searchPaths) {
            if (fs.existsSync(matlabDir)) {
                const versions = fs.readdirSync(matlabDir).filter(v => v.startsWith('R'));
                if (versions.length > 0) {
                    const latest = versions.sort().reverse()[0];
                    const exePath = path.join(matlabDir, latest, 'bin', 'matlab.exe');
                    if (fs.existsSync(exePath)) return exePath;
                }
            }
        }

        // Try registry-based detection (Windows)
        try {
            const regQuery = execSync('reg query "HKLM\\SOFTWARE\\MathWorks\\MATLAB" /s /v MATLABROOT', { 
                encoding: 'utf8', 
                stdio: ['pipe', 'pipe', 'ignore'] 
            });
            const lines = regQuery.split('\n');
            for (const line of lines) {
                if (line.includes('MATLABROOT') && line.includes('REG_SZ')) {
                    const matlabRoot = line.split('REG_SZ')[1].trim();
                    const exePath = path.join(matlabRoot, 'bin', 'matlab.exe');
                    if (fs.existsSync(exePath)) return exePath;
                }
            }
        } catch (error) {
            // Registry query failed, continue
        }

        return null;
    }

    detectPython() {
        // Try 'where python' first (finds Python in PATH)
        try {
            const result = execSync('where python', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const paths = result.trim().split('\n');
            
            // Filter out Windows Store stub
            for (const pythonPath of paths) {
                if (!pythonPath.toLowerCase().includes('windowsapps')) {
                    return pythonPath.trim();
                }
            }
        } catch (error) {
            // Not in PATH, continue searching
        }

        // Search common installation directories
        const searchPaths = [
            'C:\\Python313', 'C:\\Python312', 'C:\\Python311', 'C:\\Python310', 'C:\\Python39',
            'C:\\Program Files\\Python313', 'C:\\Program Files\\Python312', 'C:\\Program Files\\Python311',
            'D:\\Python313', 'D:\\Python312', 'D:\\Python311',
            path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python313'),
            path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312'),
            path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311')
        ];

        for (const pythonDir of searchPaths) {
            const exePath = path.join(pythonDir, 'python.exe');
            if (fs.existsSync(exePath)) {
                return exePath;
            }
        }

        // Try to find any Python directory
        const drives = ['C:', 'D:', 'E:'];
        for (const drive of drives) {
            const pythonDirs = [
                path.join(drive, '\\'),
                path.join(drive, '\\Program Files\\'),
                path.join(drive, '\\Program Files (x86)\\')
            ];
            
            for (const dir of pythonDirs) {
                try {
                    if (fs.existsSync(dir)) {
                        const entries = fs.readdirSync(dir);
                        const pythonFolder = entries.find(e => e.toLowerCase().startsWith('python') && !e.includes('windowsapps'));
                        if (pythonFolder) {
                            const exePath = path.join(dir, pythonFolder, 'python.exe');
                            if (fs.existsSync(exePath)) return exePath;
                        }
                    }
                } catch (error) {
                    // Permission denied or directory doesn't exist, continue
                }
            }
        }

        return null;
    }

    checkPort(port) {
        try {
            const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            return result.trim().length === 0;
        } catch (error) {
            return true; // If command fails, assume port is available
        }
    }

    async confirmSettings() {
        console.log('\n========================================');
        console.log('   DETECTED SETTINGS');
        console.log('========================================\n');

        // Confirm IP
        const confirmIP = await this.question(`IP Address: ${this.detectedConfig.ip}\nUse this IP? [Y/n]: `);
        if (confirmIP.toLowerCase() === 'n') {
            this.detectedConfig.ip = (await this.question('Enter your IP address: ')).trim();
        }

        // Confirm MATLAB
        if (this.detectedConfig.matlab) {
            const confirmMATLAB = await this.question(`\nMATLAB: ${this.detectedConfig.matlab}\nUse this path? [Y/n/Browse]: `);
            if (confirmMATLAB.toLowerCase() === 'n' || confirmMATLAB.toLowerCase() === 'browse') {
                this.detectedConfig.matlab = (await this.question('Enter MATLAB path (matlab.exe): ')).replace(/['"]/g, '').trim();
            }
        } else {
            this.detectedConfig.matlab = (await this.question('\nMATLAB not found. Enter path to matlab.exe: ')).replace(/['"]/g, '').trim();
        }

        // Confirm Python
        if (this.detectedConfig.python) {
            const confirmPython = await this.question(`\nPython: ${this.detectedConfig.python}\nUse this path? [Y/n/Browse]: `);
            if (confirmPython.toLowerCase() === 'n' || confirmPython.toLowerCase() === 'browse') {
                this.detectedConfig.python = (await this.question('Enter Python path (python.exe): ')).replace(/['"]/g, '').trim();
            }
        } else {
            this.detectedConfig.python = (await this.question('\nPython not found. Enter path to python.exe: ')).replace(/['"]/g, '').trim();
        }

        // Confirm port
        const confirmPort = await this.question(`\nServer Port: ${this.detectedConfig.port}\nUse this port? [Y/n]: `);
        if (confirmPort.toLowerCase() === 'n') {
            this.detectedConfig.port = parseInt(await this.question('Enter port number: '), 10);
        }
    }

    async manualSetup() {
        this.detectedConfig.ip = await this.question('Enter your IP address: ');
        this.detectedConfig.matlab = (await this.question('Enter MATLAB path (matlab.exe): ')).replace(/['"]/g, '');
        this.detectedConfig.python = (await this.question('Enter Python path (python.exe): ')).replace(/['"]/g, '');
        this.detectedConfig.port = parseInt(await this.question('Enter server port [3001]: ') || '3001', 10);
    }

    async testConfiguration() {
        console.log('\n========================================');
        console.log('   TESTING CONFIGURATION');
        console.log('========================================\n');

        // Test MATLAB
        console.log('Testing MATLAB...');
        if (fs.existsSync(this.detectedConfig.matlab)) {
            try {
                execSync(`"${this.detectedConfig.matlab}" -batch "disp('Test')"`, { 
                    timeout: 10000,
                    stdio: 'ignore'
                });
                console.log('✅ MATLAB works\n');
            } catch (error) {
                console.log('⚠️  MATLAB path exists but test failed (may still work)\n');
            }
        } else {
            console.log('❌ MATLAB path does not exist\n');
            const continueSetup = await this.question('Continue anyway? [y/N]: ');
            if (continueSetup.toLowerCase() !== 'y') {
                console.log('\nSetup cancelled.');
                process.exit(1);
            }
        }

        // Test Python
        console.log('Testing Python...');
        if (fs.existsSync(this.detectedConfig.python)) {
            try {
                const version = execSync(`"${this.detectedConfig.python}" --version`, { encoding: 'utf8' });
                console.log(`✅ Python works: ${version.trim()}\n`);
            } catch (error) {
                console.log('❌ Python test failed\n');
                const continueSetup = await this.question('Continue anyway? [y/N]: ');
                if (continueSetup.toLowerCase() !== 'y') {
                    console.log('\nSetup cancelled.');
                    process.exit(1);
                }
            }
        } else {
            console.log('❌ Python path does not exist\n');
            const continueSetup = await this.question('Continue anyway? [y/N]: ');
            if (continueSetup.toLowerCase() !== 'y') {
                console.log('\nSetup cancelled.');
                process.exit(1);
            }
        }
    }

    async saveConfiguration() {
        console.log('========================================');
        console.log('   SAVING CONFIGURATION');
        console.log('========================================\n');

        const projectRoot = path.resolve(__dirname, '..', '..');
        
        const config = {
            "YOUR_IP_ADDRESS": this.detectedConfig.ip,
            "SERVER_PORT": this.detectedConfig.port,
            "MATLAB_PATH": this.detectedConfig.matlab,
            "PYTHON_PATH": this.detectedConfig.python,
            "config_version": "2.0.0",
            "last_updated": new Date().toISOString().split('T')[0],
            "matlab": {
                "installation_paths": [this.detectedConfig.matlab]
            },
            "python": {
                "executable": this.detectedConfig.python
            },
            "server": {
                "host": this.detectedConfig.ip,
                "port": this.detectedConfig.port,
                "websocket": {
                    "enabled": true,
                    "path": "/ws"
                }
            },
            "expo": {
                "port": 8081
            },
            "hfss": {
                "process_names": [
                    "ansysedt.exe",
                    "anshfss.exe",
                    "ansysli_server.exe",
                    "ansysacad.exe",
                    "maxwell.exe",
                    "q3d.exe"
                ]
            },
            "paths": {
                "project_root": projectRoot,
                "uploads_dir": path.join(projectRoot, 'uploads'),
                "gnd_files_dir": path.join(projectRoot, 'uploads', 'gnd_files'),
                "config_dir": path.join(projectRoot, 'config'),
                "scripts_dir": path.join(projectRoot, 'scripts'),
                "test_files_dir": path.join(projectRoot, 'test_files')
            },
            "network": {
                "subnet": this.detectedConfig.ip.substring(0, this.detectedConfig.ip.lastIndexOf('.')) + '.x',
                "allowed_origins": [
                    `http://${this.detectedConfig.ip}:${this.detectedConfig.port}`,
                    `http://localhost:${this.detectedConfig.port}`,
                    `http://127.0.0.1:${this.detectedConfig.port}`
                ],
                "cors_enabled": true
            },
            "performance": {
                "cache_ttl_ms": 1000,
                "websocket_heartbeat_ms": 2000,
                "status_polling_interval_ms": 3000
            }
        };

        fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
        console.log(`✅ Configuration saved to: ${this.configPath}\n`);
    }

    question(query) {
        return new Promise(resolve => this.rl.question(query, resolve));
    }
}

// Run setup
const setup = new QuickSetup();
setup.run().catch(error => {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
});
