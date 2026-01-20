#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load centralized configuration
const setupConfig = require('../OPEN_THIS/SETUP/setup_loader.js');
const serverConfig = setupConfig.getServerConfig();

// PID file to track server process
const PID_FILE = path.join(__dirname, 'server.pid');
const SERVER_SCRIPT = path.join(__dirname, 'server.js');

// Check if server is already running
function checkExistingServer() {
    return new Promise((resolve) => {
        if (fs.existsSync(PID_FILE)) {
            const pid = fs.readFileSync(PID_FILE, 'utf8').trim();
            
            // Check if process with this PID is actually running
            exec(`tasklist /FI "PID eq ${pid}" /FO CSV`, (error, stdout) => {
                if (!error && stdout.includes(`"${pid}"`)) {
                    resolve({ running: true, pid: pid });
                } else {
                    // PID file exists but process is not running, clean up
                    fs.unlinkSync(PID_FILE);
                    resolve({ running: false, pid: null });
                }
            });
        } else {
            resolve({ running: false, pid: null });
        }
    });
}

// Kill existing Node.js processes on port
function killExistingProcesses() {
    return new Promise((resolve) => {
        console.log('🛑 Checking for existing Node.js processes...');
        
        const port = serverConfig.port;
        exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
            if (error || !stdout) {
                resolve();
                return;
            }
            
            const lines = stdout.split('\n');
            const pids = new Set();
            
            lines.forEach(line => {
                const match = line.match(/LISTENING\s+(\d+)/);
                if (match) {
                    pids.add(match[1]);
                }
            });
            
            if (pids.size === 0) {
                resolve();
                return;
            }
            
            console.log(`🔄 Found ${pids.size} processes using port ${serverConfig.port}, terminating...`);
            
            const killPromises = Array.from(pids).map(pid => {
                return new Promise((killResolve) => {
                    exec(`taskkill /F /PID ${pid}`, (killError) => {
                        if (!killError) {
                            console.log(`✅ Terminated process ${pid}`);
                        }
                        killResolve();
                    });
                });
            });
            
            Promise.all(killPromises).then(() => {
                setTimeout(resolve, 1000); // Wait 1 second after killing
            });
        });
    });
}

// Start the server
function startServer() {
    return new Promise((resolve, reject) => {
        console.log('🚀 Starting MATLAB server...');
        
        const serverProcess = spawn('node', [SERVER_SCRIPT], {
            detached: false,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        // Write PID to file
        fs.writeFileSync(PID_FILE, serverProcess.pid.toString());
        
        let startupOutput = '';
        let errorOutput = '';
        
        serverProcess.stdout.on('data', (data) => {
            const output = data.toString();
            startupOutput += output;
            process.stdout.write(output);
            
            // Check if server started successfully (V2 output format)
            if (output.includes('MATLAB-HFSS Server v2 running')) {
                resolve(serverProcess);
            }
        });
        
        serverProcess.stderr.on('data', (data) => {
            const error = data.toString();
            errorOutput += error;
            process.stderr.write(error);
        });
        
        serverProcess.on('error', (error) => {
            console.error('❌ Failed to start server:', error.message);
            if (fs.existsSync(PID_FILE)) {
                fs.unlinkSync(PID_FILE);
            }
            reject(error);
        });
        
        serverProcess.on('exit', (code) => {
            if (fs.existsSync(PID_FILE)) {
                fs.unlinkSync(PID_FILE);
            }
            
            if (code !== 0) {
                console.error(`❌ Server exited with code ${code}`);
                if (errorOutput) {
                    console.error('Error output:', errorOutput);
                }
                reject(new Error(`Server exited with code ${code}`));
            }
        });
        
        // Timeout after 10 seconds if server doesn't start
        setTimeout(() => {
            if (startupOutput.includes('MATLAB-HFSS Server v2 running')) {
                return; // Already resolved
            }
            
            console.error('❌ Server startup timeout');
            serverProcess.kill();
            reject(new Error('Server startup timeout'));
        }, 10000);
    });
}

// Main function
async function main() {
    try {
        // Check if server is already running
        const existing = await checkExistingServer();
        if (existing.running) {
            console.log(`✅ Server is already running (PID: ${existing.pid})`);
            console.log(`🌐 Server URL: ${serverConfig.url}`);
            return;
        }
        
        // Kill any existing processes
        await killExistingProcesses();
        
        // Start new server
        const serverProcess = await startServer();
        
        console.log(`✅ Server started successfully (PID: ${serverProcess.pid})`);
        console.log(`🌐 Server URL: ${serverConfig.url}`);
        console.log(`🔗 WebSocket URL: ${serverConfig.websocket.url}`);
        console.log('📋 Use Ctrl+C to stop the server');
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Shutting down server...');
            
            if (fs.existsSync(PID_FILE)) {
                const pid = fs.readFileSync(PID_FILE, 'utf8').trim();
                exec(`taskkill /F /PID ${pid}`, () => {
                    if (fs.existsSync(PID_FILE)) {
                        fs.unlinkSync(PID_FILE);
                    }
                    console.log('✅ Server stopped');
                    process.exit(0);
                });
            } else {
                serverProcess.kill();
                process.exit(0);
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Run the script
main();