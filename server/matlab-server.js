const express = require('express');
const cors = require('cors');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const XLSX = require('xlsx');
const WebSocket = require('ws');
const http = require('http');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const winston = require('winston');

// Configure winston logger with file rotation and proper levels
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
        })
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join(__dirname, 'logs', 'error.log'), 
            level: 'error',
            maxsize: 10485760, // 10MB
            maxFiles: 5
        }),
        new winston.transports.File({ 
            filename: path.join(__dirname, 'logs', 'combined.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 5
        })
    ]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message }) => {
                return `${timestamp} [${level}]: ${message}`;
            })
        )
    }));
}

// Provide a safe uuidv4 helper (uses crypto.randomUUID when available)
const crypto = require('crypto');
const uuidv4 = () => {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Fallback: reasonably unique id using timestamp + random
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
};

/**
 * Sanitizes error messages to prevent exposure of internal system details.
 * Removes file paths, stack traces, and sensitive system information.
 * @param {Error|string} error - The error object or message to sanitize
 * @returns {string} - Sanitized error message safe for client consumption
 */
const sanitizeError = (error) => {
    const message = typeof error === 'string' ? error : (error.message || 'Unknown error');
    
    // Remove file paths (Windows and Unix)
    let sanitized = message.replace(/[A-Za-z]:\\[\w\\\-\. ]+/g, '[path]');
    sanitized = sanitized.replace(/\/[\w\/\-\. ]+/g, '[path]');
    
    // Remove Python stack traces
    sanitized = sanitized.replace(/File ".*?", line \d+.*/g, '');
    sanitized = sanitized.replace(/Traceback \(most recent call last\):.*/s, '');
    
    // Remove node module paths
    sanitized = sanitized.replace(/node_modules[\\/][\w\\/\-\.]+/g, '[module]');
    
    // Trim excessive whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    
    // If the sanitized message is too generic, provide a helpful fallback
    if (sanitized === '' || sanitized === '[path]') {
        return 'An error occurred during processing';
    }
    
    return sanitized;
};

/**
 * Validates and sanitizes file paths to prevent path traversal attacks.
 * Ensures paths don't contain dangerous patterns like ../ or absolute paths to system directories.
 * @param {string} filePath - The file path to validate
 * @param {string} expectedBase - Optional expected base directory path
 * @returns {{valid: boolean, sanitized: string, error: string}} - Validation result
 */
const validatePath = (filePath, expectedBase = null) => {
    if (!filePath || typeof filePath !== 'string') {
        return { valid: false, sanitized: '', error: 'Path must be a non-empty string' };
    }
    
    // Normalize the path to resolve . and .. segments
    const normalized = path.normalize(filePath);
    
    // Check for path traversal attempts
    if (normalized.includes('..')) {
        return { valid: false, sanitized: '', error: 'Path traversal detected' };
    }
    
    // Prevent access to sensitive system directories
    const dangerous = ['windows', 'system32', 'program files', '/etc', '/usr', '/bin', '/sys', '/proc'];
    const lowerPath = normalized.toLowerCase();
    for (const dir of dangerous) {
        if (lowerPath.includes(dir)) {
            return { valid: false, sanitized: '', error: 'Access to system directories not allowed' };
        }
    }
    
    // If expected base provided, ensure path starts with it
    if (expectedBase) {
        const normalizedBase = path.normalize(expectedBase);
        const resolved = path.resolve(normalized);
        const resolvedBase = path.resolve(normalizedBase);
        
        if (!resolved.startsWith(resolvedBase)) {
            return { valid: false, sanitized: '', error: 'Path outside expected directory' };
        }
    }
    
    return { valid: true, sanitized: normalized, error: '' };
};

// Load centralized configuration
const setupConfig = require('../OPEN_THIS/SETUP/setup_loader.js');

// Validate configuration on startup
const validation = setupConfig.validate();
if (!validation.isValid) {
    logger.error('CONFIGURATION ERROR', { errors: validation.errors });
    console.error('\n❌ CONFIGURATION ERROR:\n');
    validation.errors.forEach(err => console.error(`   ${err}`));
    console.error('\n💡 Run setup: node OPEN_THIS/SETUP/quick_setup.js\n');
    process.exit(1);
}

const serverConfig = setupConfig.getServerConfig();
const performanceSettings = setupConfig.getPerformanceSettings();
const networkConfig = setupConfig.getNetworkConfig();

// Timeout and interval constants for consistent behavior
const TIMEOUTS = {
    PROCESS_TERMINATION_WAIT: 3000,      // Wait time after killing MATLAB process
    PROCESS_VERIFICATION_WAIT: 2000,      // Wait before verifying process stopped
    SOCKET_TIMEOUT: 10000,                // HTTP socket timeout
    CACHE_CLEANUP_INTERVAL: 30000,        // File system cache cleanup interval
    CONNECTION_CLEANUP_INTERVAL: 5000,    // Idle connection cleanup interval
    ITERATION_CHECK_INTERVAL: 5000,       // Automatic iteration tracking interval
    CONNECTION_MANAGER_INTERVAL: 3000,    // Connection health monitoring interval
    GRACEFUL_SHUTDOWN_DELAY: 1000,        // Delay before process.exit after cleanup
    WEBSOCKET_HEARTBEAT: 2000,            // WebSocket heartbeat interval
    STATUS_POLLING_INTERVAL: 3000         // Status polling for fallback HTTP
};

// Global error handlers to prevent server crashes
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  // Don't exit - log and continue
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  // Don't exit - log and continue
});

const app = express();
const PORT = serverConfig.port;

// Configure CORS with proper headers for connection management
app.use(cors({
  origin: networkConfig.corsEnabled ? true : networkConfig.allowedOrigins,
  credentials: true,
  optionsSuccessStatus: 200,
  exposedHeaders: ['Connection', 'Keep-Alive']
}));

// Configure Express with connection management
app.use(express.json());

// Add aggressive connection management middleware
app.use((req, res, next) => {
  // Set shorter keep-alive headers for faster connection turnover
  res.set({
    'Connection': 'keep-alive',
    'Keep-Alive': 'timeout=2, max=10', // Shorter timeout, fewer requests per connection
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  
  // Force connection close for rapid polling endpoints
  if (req.url.includes('/status') || req.url.includes('/iteration-count')) {
    res.set('Connection', 'close');
  }
  
  next();
});

// Rate limiting for sensitive endpoints
const strictRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const moderateRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 requests per minute
  message: 'Too many requests, please slow down',
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10, // Limit uploads to 10 per 10 minutes
  message: 'Too many file uploads, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Track current MATLAB execution
let currentExecutionState = {
    isRunning: false,
    fileName: null,
    startTime: null,
    processId: null,
    filePath: null,
    fileDir: null,
    hfssProcesses: []
};

let matlabProcess = null;

// Track previous state to avoid duplicate logging
let previousState = {
    matlabRunning: false,
    appStateRunning: false,
    iterationCount: -1,
    currentIteration: -1
};

// Project-specific iteration state tracking
let projectIterationStates = new Map();

// Cache for file system operations to reduce I/O
let fileSystemCache = new Map();
const CACHE_TTL = performanceSettings.cache_ttl_ms || 1000; // Cache timeout from config

// Store interval IDs for cleanup on shutdown
const activeIntervals = [];

// Clean up old cache entries every 30 seconds
const cacheCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of fileSystemCache.entries()) {
        if (now - value.timestamp > CACHE_TTL * 10) { // Keep for 10x TTL before cleanup
            fileSystemCache.delete(key);
        }
    }
}, TIMEOUTS.CACHE_CLEANUP_INTERVAL);
activeIntervals.push(cacheCleanupInterval);

// Function to detect MATLAB installation
function detectMatlabInstallation() {
    // Load MATLAB paths from configuration
    const matlabPaths = setupConfig.getMatlabPaths();

    for (const matlabPath of matlabPaths) {
        if (fs.existsSync(matlabPath)) {
            return matlabPath;
        }
    }
    return null;
}

// Function to get detailed process information with PIDs
function getProcessDetails(processName) {
    return new Promise((resolve) => {
        // First get basic process info
        const command = `tasklist /FI "IMAGENAME eq ${processName}" /FO CSV`;
        exec(command, (error, stdout, stderr) => {
            if (error || !stdout || stdout.trim() === '') {
                resolve([]);
                return;
            }
            
            try {
                const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('Image Name'));
                const processes = lines.map(line => {
                    const parts = line.split(',').map(part => part.replace(/"/g, '').trim());
                    if (parts.length >= 5) {
                        return {
                            name: parts[0],
                            pid: parseInt(parts[1]),
                            sessionName: parts[2],
                            sessionNumber: parts[3],
                            memUsage: parts[4]
                        };
                    }
                    return null;
                }).filter(proc => proc !== null);
                
                // Try to get command line for version detection (ANSYS Electronics Desktop)
                if (processes.length > 0 && processName.toLowerCase() === 'ansysedt.exe') {
                    const pid = processes[0].pid;
                    const wmicCmd = `wmic process where "ProcessId=${pid}" get CommandLine /format:list`;
                    exec(wmicCmd, (wmicError, wmicStdout) => {
                        if (!wmicError && wmicStdout) {
                            // Extract version from command line (e.g., v222 = 2022 R2)
                            const versionMatch = wmicStdout.match(/v(\d{3})/i) || wmicStdout.match(/20\d{2}\s*R\d/i);
                            if (versionMatch) {
                                processes[0].version = versionMatch[0];
                            }
                        }
                        resolve(processes);
                    });
                } else {
                    resolve(processes);
                }
            } catch (parseError) {
                resolve([]);
            }
        });
    });
}

// Function to detect all HFSS-related processes
async function detectHFSSProcesses() {
    const hfssProcessNames = {
        'ansysedt.exe': 'ANSYS Electronics Desktop',
        'anshfss.exe': 'HFSS Solver',
        'ansysli_server.exe': 'ANSYS License Server',
        'ansysacad.exe': 'ANSYS Academic',
        'maxwell.exe': 'Maxwell',
        'q3d.exe': 'Q3D Extractor'
    };
    
    const allHfssProcesses = [];
    
    for (const [processName, applicationName] of Object.entries(hfssProcessNames)) {
        try {
            const processes = await getProcessDetails(processName);
            if (processes.length > 0) {
                // Add application name to each process, with version if available
                const processesWithAppName = processes.map(proc => {
                    let displayName = applicationName;
                    if (proc.version) {
                        // Convert version code to readable format (e.g., v222 -> 2022 R2)
                        const versionStr = proc.version.toLowerCase().replace('v', '');
                        if (versionStr.length === 3) {
                            const year = '20' + versionStr.substring(0, 2);
                            const release = 'R' + versionStr.substring(2);
                            displayName = `${applicationName} ${year} ${release}`;
                        } else {
                            displayName = `${applicationName} ${proc.version}`;
                        }
                    }
                    return {
                        ...proc,
                        applicationName: displayName
                    };
                });
                allHfssProcesses.push(...processesWithAppName);
            }
        } catch (error) {
            // Silent error handling
        }
    }
    
    return allHfssProcesses;
}

// Function to gracefully terminate processes
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

// Function to terminate all HFSS processes
async function terminateAllHFSSProcesses(forceKill = false) {
    const hfssProcesses = await detectHFSSProcesses();
    
    if (hfssProcesses.length === 0) {
        return { terminated: [], failed: [] };
    }
    
    const terminated = [];
    const failed = [];
    
    // Terminate processes in parallel for faster execution
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

// Function to get MATLAB processes with PIDs
async function getMatlabProcesses() {
    const matlabProcesses = await getProcessDetails('MATLAB.exe');
    return matlabProcesses;
}

// API endpoint to get variable definitions from external configuration
app.get('/api/variables', async (req, res) => {
  try {
    const configPath = path.join(__dirname, '..', 'config', 'antenna_variables.json');
    
    if (!fs.existsSync(configPath)) {
      console.log(`❌ Variable configuration file not found: ${configPath}`);
      return res.status(404).json({
        success: false,
        message: 'Variable configuration file not found'
      });
    }
    
    const configContent = await fsPromises.readFile(configPath, 'utf-8');
    const configData = JSON.parse(configContent);
    
    // Variables loaded silently
    
    res.json({
      success: true,
      variables: configData.variables,
      metadata: configData.metadata
    });
    
  } catch (error) {
    console.log(`❌ Error loading variable configuration:`);
    console.log(`   🔧 Error type: ${error.name}`);
    console.log(`   💬 Error message: ${error.message}`);
    res.status(500).json({
      success: false,
      error: sanitizeError(error)
    });
  }
});

// API endpoint to check MATLAB installation
app.get('/api/matlab/check', (req, res) => {
  try {
    const matlabPath = detectMatlabInstallation();
    
    if (matlabPath) {
      // MATLAB found silently
      res.json({
        success: true,
        matlabPath: matlabPath,
        message: 'MATLAB installation detected'
      });
    } else {
      console.log(`❌ MATLAB installation check: Not found in common paths`);
      console.log(`   🔍 Searched paths: R2024a, R2024b, R2023a, R2023b, R2022a, R2022b`);
      res.json({
        success: false,
        message: 'MATLAB installation not found'
      });
    }
  } catch (error) {
    console.log(`❌ Error during MATLAB installation check:`);
    console.log(`   🔧 Error type: ${error.name}`);
    console.log(`   💬 Error message: ${error.message}`);
    res.status(500).json({
      success: false,
      error: sanitizeError(error)
    });
  }
});

// API endpoint to check if F_Model_Element.m or F_Model_Element.mlx file exists
app.post('/api/matlab/check-file', (req, res) => {
  try {
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: 'File path is required'
      });
    }
    
    console.log(`🔍 Checking if file exists: ${filePath}`);
    console.log(`   📂 Directory path: ${path.dirname(filePath)}`);
    console.log(`   📄 File name: ${path.basename(filePath)}`);
    
    // Check if directory exists first
    const dirExists = fs.existsSync(path.dirname(filePath));
    console.log(`   📁 Directory exists: ${dirExists}`);
    
    // Check for both .m and .mlx files
    // Handle both cases: if path ends with .m or doesn't have extension
    let mFilePath, mlxFilePath;
    
    if (filePath.endsWith('.m')) {
      mFilePath = filePath;
      mlxFilePath = filePath.slice(0, -2) + '.mlx';
    } else if (filePath.endsWith('.mlx')) {
      mlxFilePath = filePath;
      mFilePath = filePath.slice(0, -4) + '.m';
    } else {
      // No extension, add both
      mFilePath = filePath + '.m';
      mlxFilePath = filePath + '.mlx';
    }
    
    console.log(`   🔍 Checking .m file: ${mFilePath}`);
    console.log(`   🔍 Checking .mlx file: ${mlxFilePath}`);
    
    const mExists = fs.existsSync(mFilePath);
    const mlxExists = fs.existsSync(mlxFilePath);
    const exists = mExists || mlxExists;
    
    let fileInfo = {
      exists: exists,
      mFile: mExists,
      mlxFile: mlxExists
    };
    
    if (exists) {
      try {
        if (mExists) {
          const stats = fs.statSync(mFilePath);
          fileInfo.mSize = stats.size;
          fileInfo.mLastModified = stats.mtime.toISOString();
          console.log(`✅ .m file found: ${mFilePath} (${stats.size} bytes)`);
        }
        if (mlxExists) {
          const stats = fs.statSync(mlxFilePath);
          fileInfo.mlxSize = stats.size;
          fileInfo.mlxLastModified = stats.mtime.toISOString();
          console.log(`✅ .mlx file found: ${mlxFilePath} (${stats.size} bytes)`);
        }
      } catch (statError) {
        console.log(`⚠️ File exists but couldn't get stats: ${statError.message}`);
      }
    } else {
      console.log(`❌ Neither .m nor .mlx file found`);
      console.log(`   📄 Checked .m: ${mFilePath}`);
      console.log(`   📄 Checked .mlx: ${mlxFilePath}`);
      
      // Debug: List directory contents if directory exists
      if (dirExists) {
        try {
          const dirContents = fs.readdirSync(path.dirname(filePath));
          console.log(`   📋 Directory contents (${dirContents.length} items):`);
          dirContents.forEach(item => {
            const itemPath = path.join(path.dirname(filePath), item);
            const isDir = fs.lstatSync(itemPath).isDirectory();
            console.log(`      ${isDir ? '📁' : '📄'} ${item}`);
          });
        } catch (dirError) {
          console.log(`   ❌ Could not list directory: ${dirError.message}`);
        }
      }
    }
    
    res.json(fileInfo);
  } catch (error) {
    console.log(`❌ Error checking file: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API endpoint to run MATLAB Live Script with visible GUI
app.post('/api/matlab/run', strictRateLimiter, async (req, res) => {
    try {
        const { filePath } = req.body;
        
        if (!filePath) {
            console.log('❌ Error: User did not provide file path');
            return res.status(400).json({
                success: false,
                message: 'File path is required'
            });
        }
        
        // Check if already running
        if (currentExecutionState.isRunning) {
            console.log(`⚠️ Already running: ${currentExecutionState.fileName}`);
            return res.status(409).json({
                success: false,
                message: 'MATLAB script is already running',
                currentExecution: currentExecutionState
            });
        }
        
        // Extract file info
        const fileName = path.basename(filePath);
        const fileDir = path.dirname(filePath);
        const matlabDir = fileDir.replace(/\\/g, '/');
        const matlabFilePath = filePath.replace(/\\/g, '/');
        
        console.log(`🚀 Running: ${fileName}`);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            console.log(`❌ File not found: ${fileName}`);
            return res.status(404).json({
                success: false,
                message: `File not found: ${fileName}`
            });
        }
        
        // MATLAB command to open AND automatically run the Live Script
        const matlabCommand = `cd('${matlabDir}'); open('${matlabFilePath}'); pause(2); run('${matlabFilePath}'); disp('=== EXECUTION COMPLETED ===');`;
        
        // Start MATLAB process with visible GUI (not batch mode)
        matlabProcess = spawn('matlab', ['-r', matlabCommand], {
            cwd: fileDir,
            stdio: ['ignore', 'pipe', 'pipe'],  // Allow GUI but capture some output
            detached: false  // Keep process attached so we can track it
        });
        
        // Detect initial HFSS processes before MATLAB start
        const initialHfssProcesses = await detectHFSSProcesses();
        
        // Update execution state
        currentExecutionState = {
            isRunning: true,
            fileName: fileName,
            startTime: new Date().toISOString(),
            processId: matlabProcess.pid,
            filePath: filePath,
            fileDir: fileDir,
            hfssProcesses: initialHfssProcesses
        };
        
        // Broadcast status change to all connected clients
        broadcastCurrentStatus();
        
        // Handle process events
        matlabProcess.on('close', (code) => {
            console.log(`✅ MATLAB finished (code: ${code})`);
            currentExecutionState.isRunning = false;
            matlabProcess = null;
            // Broadcast status change to all connected clients
            broadcastCurrentStatus();
        });
        
        matlabProcess.on('error', (error) => {
            logger.error('MATLAB process error', { error: error.message, stack: error.stack });
            console.error(`❌ MATLAB error: ${error.message}`);
            currentExecutionState.isRunning = false;
            matlabProcess = null;
            // Broadcast status change to all connected clients
            broadcastCurrentStatus();
        });
        
        // Add periodic check to ensure process is still running
        const processCheckInterval = setInterval(() => {
            if (matlabProcess && currentExecutionState.isRunning) {
                exec('tasklist /FI \"IMAGENAME eq MATLAB.exe\" /FO CSV', (error, stdout) => {
                    if (error || !stdout.includes('MATLAB.exe')) {
                        currentExecutionState.isRunning = false;
                        matlabProcess = null;
                        previousState.matlabRunning = false;
                        previousState.appStateRunning = false;
                        clearInterval(processCheckInterval);
                        // Broadcast status change to all connected clients
                        broadcastCurrentStatus();
                    }
                });
            } else {
                clearInterval(processCheckInterval);
            }
        }, TIMEOUTS.CONNECTION_CLEANUP_INTERVAL);
        
        res.json({
            success: true,
            message: `Started executing: ${fileName} (MATLAB GUI visible with auto-run)`,
            execution: currentExecutionState,
            instructions: [
                "1. MATLAB is now opening with your Live Script loaded",
                "2. The script will automatically start executing after a brief pause",
                "3. You can see MATLAB GUI and execution progress in real-time",
                "4. Use /api/matlab/status to monitor execution status",
                "5. Use /api/matlab/stop to interrupt execution if needed"
            ],
            workflow: {
                step: "AUTO_EXECUTING",
                nextAction: "Script is running automatically - monitor progress",
                userControl: false
            }
        });
        
    } catch (error) {
        console.log(`❌ Failed to start MATLAB: ${error.message}`);
        res.status(500).json({
            success: false,
            message: 'Failed to start MATLAB execution',
            error: error.message
        });
    }
});

// API endpoint to stop MATLAB execution and HFSS processes simultaneously
app.post('/api/matlab/stop', async (req, res) => {
    try {
        console.log('🛑 Stop request - terminating processes...');
        
        // Get current MATLAB and HFSS processes
        const currentMatlabProcesses = await getMatlabProcesses();
        const currentHfssProcesses = await detectHFSSProcesses();
        
        console.log(`📊 Found: ${currentMatlabProcesses.length} MATLAB, ${currentHfssProcesses.length} HFSS`);
        
        if (currentMatlabProcesses.length === 0 && currentHfssProcesses.length === 0) {
            console.log('ℹ️ No processes to terminate');
            currentExecutionState.isRunning = false;
            matlabProcess = null;
            
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
            console.log(`� Attempting graceful termination of ${currentHfssProcesses.length} HFSS process(es)`);
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
            for (const matlabProc of remainingMatlab) {
                const forceResult = await terminateProcess(matlabProc.pid, 'MATLAB.exe', true);
                matlabTerminationResults.push(forceResult);
            }
        }
        
        if (remainingHfss.length > 0) {
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
            console.log(`✅ Terminated ${allTerminated} processes`);
        }
        
        // Reset execution state
        currentExecutionState.isRunning = false;
        currentExecutionState.hfssProcesses = [];
        matlabProcess = null;
        
        // Broadcast status change to all connected clients
        broadcastCurrentStatus();
        
        // Prepare response
        const matlabTerminated = matlabTerminationResults.filter(r => r.success);
        const matlabFailed = matlabTerminationResults.filter(r => !r.success);
        
        const allTerminatedCount = matlabTerminated.length + hfssTerminationResults.terminated.length;
        const allFailedCount = matlabFailed.length + hfssTerminationResults.failed.length;
        
        const isSuccess = finalMatlab.length === 0 && finalHfss.length === 0;
        
        res.json({
            success: isSuccess,
            message: isSuccess 
                ? `✅ All processes terminated successfully (${allTerminatedCount} total)`
                : `⚠️ Some processes may still be running (${allFailedCount} failed)`,
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
        console.error('❌ Termination error:', error.message);
        
        // Emergency force kill all processes
        exec('taskkill /F /IM MATLAB.exe', () => {});
        exec('taskkill /F /IM ansysedt.exe', () => {});
        exec('taskkill /F /IM anshfss.exe', () => {});
        
        currentExecutionState.isRunning = false;
        matlabProcess = null;
        
        res.status(500).json({
            success: false,
            message: 'Critical error during termination - emergency force kill executed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get MATLAB execution status with detailed HFSS process information
app.get('/api/matlab/status', async (req, res) => {
    try {
        // Get detailed process information
        const currentMatlabProcesses = await getMatlabProcesses();
        const currentHfssProcesses = await detectHFSSProcesses();
        
        const matlabRunning = currentMatlabProcesses.length > 0;
        
        // Only log when state changes
        if (matlabRunning !== previousState.matlabRunning || currentExecutionState.isRunning !== previousState.appStateRunning) {
            // Status changed silently
            previousState.matlabRunning = matlabRunning;
            previousState.appStateRunning = currentExecutionState.isRunning;
        }
        
        // Update execution state based on actual process status
        // Track if state changed to broadcast updates
        let stateChanged = false;
        
        if (currentExecutionState.isRunning && !matlabRunning) {
            // MATLAB stopped, updating state
            currentExecutionState.isRunning = false;
            matlabProcess = null;
            stateChanged = true;
        } else if (!currentExecutionState.isRunning && matlabRunning) {
            // External MATLAB detected
            currentExecutionState.isRunning = true;
            // Try to get process info if we don't have it
            if (!currentExecutionState.fileName) {
                currentExecutionState.fileName = 'MATLAB (external start)';
                currentExecutionState.startTime = new Date().toISOString();
                currentExecutionState.processId = currentMatlabProcesses[0]?.pid || 'Unknown';
            }
            stateChanged = true;
        }
        
        // Update HFSS processes in execution state
        currentExecutionState.hfssProcesses = currentHfssProcesses;
        
        const statusData = {
            success: true,
            execution: currentExecutionState,
            processDetails: {
                matlab: {
                    running: matlabRunning,
                    count: currentMatlabProcesses.length,
                    processes: currentMatlabProcesses.map(p => ({
                        pid: p.pid,
                        name: p.name,
                        memoryUsage: p.memUsage,
                        sessionName: p.sessionName
                    }))
                },
                hfss: {
                    running: currentHfssProcesses.length > 0,
                    count: currentHfssProcesses.length,
                    processes: currentHfssProcesses.map(p => ({
                        pid: p.pid,
                        name: p.name,
                        memoryUsage: p.memUsage,
                        sessionName: p.sessionName
                    }))
                }
            },
            // Legacy compatibility
            hfssProcesses: currentHfssProcesses.map(p => p.name),
            matlabProcessRunning: matlabRunning,
            timestamp: new Date().toISOString()
        };
        
        // Broadcast status to WebSocket clients (always broadcast, but force if state changed)
        broadcastToClients('status', statusData, stateChanged);
        
        res.json(statusData);
    } catch (error) {
        console.error('❌ Error in status endpoint:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API endpoint to get detailed process information for MATLAB and HFSS
// API endpoint to get iteration count from VBScript files
app.get('/api/matlab/iteration-count', (req, res) => {
    try {
        // Get project path from query parameter or current execution state
        const projectPath = req.query.projectPath || currentExecutionState.filePath;
        
        let tempDir;
        if (projectPath) {
            // Handle both directory paths and .mlx file paths
            let projectDir = projectPath;
            if (path.extname(projectPath) === '.mlx') {
                projectDir = path.dirname(projectPath);
            }
            
            // Use forward slashes and normalize path for cross-platform compatibility
            tempDir = path.normalize(path.join(projectDir, 'Optimization', 'temp'));
        } else {
            tempDir = 'Unknown - no project path available';
        }
        
        if (!projectPath) {
            return res.json({
                success: true,
                iterationCount: 0,
                currentIteration: null,
                latestVBScript: null,
                tempDir: tempDir,
                message: 'Project path not available - please set project path for iteration tracking'
            });
        }
        
        if (!fs.existsSync(tempDir)) {
            return res.json({
                success: true,
                iterationCount: 0,
                currentIteration: null,
                latestVBScript: null,
                tempDir: tempDir,
                message: 'Temp directory not found - optimization starting...'
            });
        }
        
        try {
            // Check cache first to avoid repeated file system operations
            const cacheKey = tempDir;
            const now = Date.now();
            
            if (fileSystemCache.has(cacheKey)) {
                const cached = fileSystemCache.get(cacheKey);
                if (now - cached.timestamp < CACHE_TTL) {
                    // Return cached result with updated timestamp
                    return res.json({
                        ...cached.result,
                        timestamp: new Date().toISOString(),
                        cached: true
                    });
                }
            }
            
            const files = fs.readdirSync(tempDir);
            const vbsFiles = files.filter(file => 
                file.toLowerCase().endsWith('.vbs') && 
                file.toLowerCase().startsWith('antenna')
            );
            
            if (vbsFiles.length === 0) {
                const result = {
                    success: true,
                    iterationCount: 0,
                    currentIteration: null,
                    latestVBScript: null,
                    tempDir: tempDir,
                    allFiles: files,
                    message: `No VBScript files found yet (${files.length} files total)`
                };
                
                // Cache the result
                fileSystemCache.set(cacheKey, {
                    result: result,
                    timestamp: now
                });
                
                return res.json(result);
            }
            
            // Extract iteration numbers from filenames (e.g., Antenna4.vbs -> 4)
            const iterations = vbsFiles.map(file => {
                const match = file.match(/antenna(\d+)\.vbs/i);
                return match ? parseInt(match[1], 10) : 0;
            }).filter(num => num > 0);
            
            const maxIteration = Math.max(...iterations);
            const latestVBScript = `Antenna${maxIteration}.vbs`;
            
            // Get or create project-specific state
            const projectKey = projectPath;
            if (!projectIterationStates.has(projectKey)) {
                projectIterationStates.set(projectKey, { 
                    iterationCount: -1, 
                    currentIteration: -1,
                    lastLogTime: 0
                });
            }
            
            const projectState = projectIterationStates.get(projectKey);
            
            // Only log when iteration count actually changes for this specific project
            if (iterations.length !== projectState.iterationCount) {
                // Project iterations detected silently
                projectState.iterationCount = iterations.length;
                projectState.currentIteration = maxIteration;
                projectState.lastLogTime = Date.now();
            }
            
            // Determine if this looks like an ongoing project vs just started
            const projectAge = Date.now() - (currentExecutionState.startTime ? new Date(currentExecutionState.startTime).getTime() : Date.now());
            const isOngoingProject = iterations.length > 0 && projectAge > 30000; // More than 30 seconds old with iterations
            
            const message = isOngoingProject 
                ? `Ongoing optimization: ${iterations.length} iterations completed (current: ${maxIteration})`
                : `${iterations.length} iterations found (current: ${maxIteration})`;
            
            const result = {
                success: true,
                iterationCount: iterations.length,
                currentIteration: maxIteration,
                latestVBScript: latestVBScript,
                tempDir: tempDir,
                allVBSFiles: vbsFiles,
                allIterations: iterations.sort((a, b) => a - b),
                message: message,
                isOngoing: isOngoingProject,
                timestamp: new Date().toISOString()
            };
            
            // Cache the result
            fileSystemCache.set(cacheKey, {
                result: result,
                timestamp: now
            });
            
            // Broadcast iterations to WebSocket clients
            broadcastToClients('iterations', result);
            
            res.json(result);
            
        } catch (readError) {
            console.error('Error reading temp directory:', readError);
            res.json({
                success: false,
                error: `Cannot read temp directory: ${readError.message}`,
                tempDir: tempDir
            });
        }
        
    } catch (error) {
        console.error('❌ Error in iteration-count endpoint:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Simplified endpoint to apply variable changes using Python script
app.post('/api/matlab/apply-variables', moderateRateLimiter, (req, res) => {
    try {
        const { variableIds, projectPath } = req.body;
        
        if (!variableIds || !Array.isArray(variableIds)) {
            console.log('❌ Error: Invalid variableIds provided');
            return res.status(400).json({
                success: false,
                message: 'variableIds array is required'
            });
        }

        if (!projectPath || typeof projectPath !== 'string') {
            console.log('❌ Error: Invalid projectPath provided');
            return res.status(400).json({
                success: false,
                message: 'projectPath string is required'
            });
        }
        
        // Validate and sanitize projectPath to prevent path traversal
        const pathValidation = validatePath(projectPath);
        if (!pathValidation.valid) {
            console.log(`❌ Security: Path validation failed - ${pathValidation.error}`);
            return res.status(400).json({
                success: false,
                message: 'Invalid project path',
                error: pathValidation.error
            });
        }

        if (variableIds.length === 0) {
            console.log('❌ Error: No variable IDs provided');
            return res.status(400).json({
                success: false,
                message: 'At least one variable ID is required'
            });
        }

        // Validate upper bound for variable count (security & performance)
        if (variableIds.length > 100) {
            console.log(`❌ Error: Too many variables requested (${variableIds.length})`);
            return res.status(400).json({
                success: false,
                message: 'Too many variables (maximum 100 supported)',
                requested: variableIds.length,
                maximum: 100
            });
        }

        // Removed 20-variable limit - now supports full design variable set (82 variables)
        console.log(`✅ Received request to apply ${variableIds.length} variables`);
        console.log(`🔧 Variable IDs: [${variableIds.join(', ')}]`);
        console.log(`📁 Project Path: ${projectPath}`);

        // Extract project root from project path
        const projectRoot = path.dirname(projectPath);
        console.log(`📂 Project Root: ${projectRoot}`);

        // Execute Python script to generate F_Model_Element.m
        const pythonScriptPath = path.join(__dirname, '..', 'scripts', 'generate_f_model.py');
        const variableIdsStr = variableIds.join(',');
        const pythonExecutable = setupConfig.getPythonExecutable();
        
        console.log(`🐍 Executing Python script: ${pythonScriptPath}`);
        console.log(`📊 Parameters: variable_ids="${variableIdsStr}", project_root="${projectRoot}"`);
        console.log(`🐍 Using Python: ${pythonExecutable}`);
        
        const pythonCommand = `${pythonExecutable} "${pythonScriptPath}" "${variableIdsStr}" "${projectRoot}"`;
        
        exec(pythonCommand, (error, stdout, stderr) => {
            if (error) {
                console.log(`❌ Python script execution error:`);
                console.log(`   🔧 Error: ${error.message}`);
                console.log(`   📝 stderr: ${stderr}`);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to execute Python script'
                    // Internal error details removed for security
                });
            }
            
            console.log(`✅ Python script executed successfully`);
            console.log(`📄 stdout: ${stdout}`);
            
            if (stderr) {
                console.log(`⚠️ stderr: ${stderr}`);
            }
            
            res.json({
                success: true,
                message: `F_Model_Element.m updated with ${variableIds.length} variables (seeds 1-${variableIds.length})`,
                variableCount: variableIds.length,
                variableIds: variableIds,
                seedRange: `1-${variableIds.length}`
                // pythonOutput removed - internal details only in server logs
            });
        });

    } catch (error) {
        console.log(`❌ Error in apply-variables endpoint:`);
        console.log(`   🔧 Error type: ${error.name}`);
        console.log(`   💬 Error message: ${error.message}`);
        console.log(`   📍 Stack trace: ${error.stack}`);
        res.status(500).json({
            success: false,
            message: 'Failed to apply variable changes',
            error: error.message
        });
    }
});



// API endpoint for updating ground plane parameters
app.post('/api/matlab/update-ground-plane', moderateRateLimiter, async (req, res) => {
    try {
        console.log('🔧 ===== UPDATE GROUND PLANE REQUEST =====');
        console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
        
        const { projectPath, Lgx, Lgy, GND_xPos, GND_yPos, groundPlaneLg, groundPlaneThick } = req.body;

        // Support both old and new parameter names for backward compatibility
        const lgxValue = Lgx !== undefined ? parseFloat(Lgx) : (groundPlaneLg !== undefined ? parseFloat(groundPlaneLg) : null);
        const lgyValue = Lgy !== undefined ? parseFloat(Lgy) : (groundPlaneLg !== undefined ? parseFloat(groundPlaneLg) : null);
        const xPosValue = GND_xPos !== undefined ? parseFloat(GND_xPos) : 0;
        const yPosValue = GND_yPos !== undefined ? parseFloat(GND_yPos) : 0;
        
        console.log('📊 Parsed values:');
        console.log(`   Lgx: ${lgxValue}`);
        console.log(`   Lgy: ${lgyValue}`);
        console.log(`   GND_xPos: ${xPosValue}`);
        console.log(`   GND_yPos: ${yPosValue}`);

        // Validate required parameters
        if (!projectPath || typeof projectPath !== 'string') {
            console.log('❌ Error: Invalid projectPath provided');
            return res.status(400).json({
                success: false,
                message: 'projectPath string is required'
            });
        }
        
        // Validate and sanitize projectPath to prevent path traversal
        const pathValidation = validatePath(projectPath);
        if (!pathValidation.valid) {
            console.log(`❌ Security: Path validation failed - ${pathValidation.error}`);
            return res.status(400).json({
                success: false,
                message: 'Invalid project path',
                error: pathValidation.error
            });
        }

        if (lgxValue === null || isNaN(lgxValue)) {
            console.log('❌ Error: Lgx parameter is required');
            return res.status(400).json({
                success: false,
                message: 'Lgx parameter is required'
            });
        }

        if (lgyValue === null || isNaN(lgyValue)) {
            console.log('❌ Error: Lgy parameter is required');
            return res.status(400).json({
                success: false,
                message: 'Lgy parameter is required'
            });
        }

        // Validate parameter ranges
        if (lgxValue < 25) {
            console.log(`❌ Error: Invalid Lgx value: ${lgxValue} (must be >= 25mm)`);
            return res.status(400).json({
                success: false,
                message: 'Lgx must be >= 25mm (antenna size)'
            });
        }

        if (lgyValue < 25) {
            console.log(`❌ Error: Invalid Lgy value: ${lgyValue} (must be >= 25mm)`);
            return res.status(400).json({
                success: false,
                message: 'Lgy must be >= 25mm (antenna size)'
            });
        }

        if (xPosValue < 0 || isNaN(xPosValue)) {
            console.log(`❌ Error: Invalid GND_xPos value: ${xPosValue}`);
            return res.status(400).json({
                success: false,
                message: 'GND_xPos must be >= 0'
            });
        }

        if (yPosValue < 0 || isNaN(yPosValue)) {
            console.log(`❌ Error: Invalid GND_yPos value: ${yPosValue}`);
            return res.status(400).json({
                success: false,
                message: 'GND_yPos must be >= 0'
            });
        }

        // Validate antenna stays within ground plane (25mm antenna size)
        // GND_xPos and GND_yPos represent the CENTER of the antenna
        // So the antenna extends from (center - 12.5) to (center + 12.5)
        const ANTENNA_SIZE = 25;
        const halfAntenna = ANTENNA_SIZE / 2;
        
        if (xPosValue - halfAntenna < 0 || xPosValue + halfAntenna > lgxValue) {
            console.log(`❌ Error: Antenna X position ${xPosValue} with size ${ANTENNA_SIZE}mm exceeds ground plane X dimension ${lgxValue}mm`);
            console.log(`   Antenna would span from ${xPosValue - halfAntenna} to ${xPosValue + halfAntenna}, but ground plane is 0 to ${lgxValue}`);
            return res.status(400).json({
                success: false,
                message: `Antenna position would exceed ground plane X dimension. Center at ${xPosValue}mm with 25mm antenna needs ground plane X >= ${xPosValue + halfAntenna}mm`
            });
        }

        if (yPosValue - halfAntenna < 0 || yPosValue + halfAntenna > lgyValue) {
            console.log(`❌ Error: Antenna Y position ${yPosValue} with size ${ANTENNA_SIZE}mm exceeds ground plane Y dimension ${lgyValue}mm`);
            console.log(`   Antenna would span from ${yPosValue - halfAntenna} to ${yPosValue + halfAntenna}, but ground plane is 0 to ${lgyValue}`);
            return res.status(400).json({
                success: false,
                message: `Antenna position would exceed ground plane Y dimension. Center at ${yPosValue}mm with 25mm antenna needs ground plane Y >= ${yPosValue + halfAntenna}mm`
            });
        }

        console.log(`🔧 Updating ground plane parameters for project: ${projectPath}`);
        console.log(`📏 Ground plane size: ${lgxValue}mm × ${lgyValue}mm`);
        console.log(`📍 Antenna position: (${xPosValue}, ${yPosValue})mm`);

        // Extract project root directory from project path
        const projectRoot = path.dirname(projectPath);
        const fModelPath = path.join(projectRoot, 'Function', 'HFSS', 'F_Model_Element.m');

        console.log(`📄 Target file path: ${fModelPath}`);
        console.log(`🔍 Checking if file exists...`);

        // Check if F_Model_Element.m exists
        const fileExists = fs.existsSync(fModelPath);
        console.log(`   File exists: ${fileExists}`);
        
        if (!fileExists) {
            console.log(`❌ F_Model_Element.m not found at: ${fModelPath}`);
            return res.status(404).json({
                success: false,
                message: 'F_Model_Element.m file not found. Please generate the F_Model first.',
                fModelPath: fModelPath,
                timestamp: new Date().toISOString()
            });
        }
        
        console.log(`✅ File found, proceeding with update...`);

        try {
            // Read the current F_Model_Element.m file (async)
            let fModelContent = await fsPromises.readFile(fModelPath, 'utf-8');
            console.log(`📖 Read F_Model_Element.m (${fModelContent.length} characters)`);
            
            // Extract current values for comparison
            const currentLgx = fModelContent.match(/^Lgx = ([\d.]+);/m);
            const currentLgy = fModelContent.match(/^Lgy = ([\d.]+);/m);
            const currentXPos = fModelContent.match(/^GND_xPos = ([\d.]+);/m);
            const currentYPos = fModelContent.match(/^GND_yPos = ([\d.]+);/m);
            
            console.log('📊 Current values in file:');
            console.log(`   Lgx: ${currentLgx ? currentLgx[1] : 'NOT FOUND'}`);
            console.log(`   Lgy: ${currentLgy ? currentLgy[1] : 'NOT FOUND'}`);
            console.log(`   GND_xPos: ${currentXPos ? currentXPos[1] : 'NOT FOUND'}`);
            console.log(`   GND_yPos: ${currentYPos ? currentYPos[1] : 'NOT FOUND'}`);

            // Check if ground plane variables exist
            const hasLgx = currentLgx !== null;
            const hasLgy = currentLgy !== null;
            const hasXPos = currentXPos !== null;
            const hasYPos = currentYPos !== null;
            const hasGroundPlane = hasLgx && hasLgy && hasXPos && hasYPos;

            if (!hasGroundPlane) {
                // Ground plane variables don't exist - need to ADD them
                console.log(`📝 Ground plane variables not found - adding them to file...`);
                
                // Find the 'end' statement and insert ground plane variables before it
                const endPattern = /^end\s*$/m;
                const endMatch = fModelContent.match(endPattern);
                
                if (endMatch) {
                    const groundPlaneCode = `
% Custom variable: Lgx - Custom value
Lgx = ${lgxValue};  % Ground plane length X (mm) - user configured
hfssChangeVar(fid,'Lgx',Lgx,'mm');

% Custom variable: Lgy - Custom value
Lgy = ${lgyValue};  % Ground plane length Y (mm) - user configured
hfssChangeVar(fid,'Lgy',Lgy,'mm');

% Custom variable: GND_xPos - Custom value
GND_xPos = ${xPosValue};  % Antenna X center position (mm) - user configured
hfssChangeVar(fid,'GND_xPos',GND_xPos,'mm');

% Custom variable: GND_yPos - Custom value
GND_yPos = ${yPosValue};  % Antenna Y center position (mm) - user configured
hfssChangeVar(fid,'GND_yPos',GND_yPos,'mm');

`;
                    fModelContent = fModelContent.replace(endPattern, groundPlaneCode + 'end');
                    console.log(`✅ Added all ground plane variables with user values`);
                } else {
                    console.log(`❌ Could not find 'end' statement in file`);
                    return res.status(500).json({
                        success: false,
                        message: 'Could not add ground plane variables - file structure unexpected'
                    });
                }
            } else {
                // Ground plane variables exist - UPDATE them
                console.log(`🔄 Ground plane variables found - updating values...`);

                // Update Lgx value (new) or Lg value (old - backward compatibility)
                const lgxRegex = /^Lgx = \d+(\.\d+)?;/m;
                const lgRegex = /^Lg = \d+(\.\d+)?;/m;
                if (lgxRegex.test(fModelContent)) {
                    fModelContent = fModelContent.replace(lgxRegex, `Lgx = ${lgxValue};`);
                    console.log(`✅ Updated Lgx: ${currentLgx[1]} -> ${lgxValue}`);
                } else if (lgRegex.test(fModelContent)) {
                    fModelContent = fModelContent.replace(lgRegex, `Lg = ${lgxValue};`);
                    console.log(`✅ Updated Lg (legacy) to ${lgxValue}`);
                }

                // Update Lgy value
                const lgyRegex = /^Lgy = \d+(\.\d+)?;/m;
                if (lgyRegex.test(fModelContent)) {
                    fModelContent = fModelContent.replace(lgyRegex, `Lgy = ${lgyValue};`);
                    console.log(`✅ Updated Lgy: ${currentLgy[1]} -> ${lgyValue}`);
                }

                // Update GND_xPos value
                const xPosRegex = /^GND_xPos = \d+(\.\d+)?;/m;
                if (xPosRegex.test(fModelContent)) {
                    fModelContent = fModelContent.replace(xPosRegex, `GND_xPos = ${xPosValue};`);
                    console.log(`✅ Updated GND_xPos: ${currentXPos[1]} -> ${xPosValue}`);
                }

                // Update GND_yPos value
                const yPosRegex = /^GND_yPos = \d+(\.\d+)?;/m;
                if (yPosRegex.test(fModelContent)) {
                    fModelContent = fModelContent.replace(yPosRegex, `GND_yPos = ${yPosValue};`);
                    console.log(`✅ Updated GND_yPos: ${currentYPos[1]} -> ${yPosValue}`);
                }
            }

            // Write the updated content back to the file (async)
            await fsPromises.writeFile(fModelPath, fModelContent, 'utf-8');
            console.log(`💾 Successfully updated F_Model_Element.m`);

            res.json({
                success: true,
                message: 'Ground plane parameters updated successfully in F_Model_Element.m',
                parameters: {
                    Lgx: lgxValue,
                    Lgy: lgyValue,
                    GND_xPos: xPosValue,
                    GND_yPos: yPosValue
                },
                fModelPath: fModelPath,
                timestamp: new Date().toISOString()
            });

        } catch (fileError) {
            console.log(`❌ Error updating F_Model_Element.m: ${fileError.message}`);
            return res.status(500).json({
                success: false,
                message: 'Failed to update F_Model_Element.m file',
                error: fileError.message,
                parameters: {
                    groundPlaneLg: lgValue,
                    groundPlaneThick: thickValue
                },
                fModelPath: fModelPath,
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        console.log(`❌ Error in update-ground-plane endpoint:`);
        console.log(`   🔧 Error type: ${error.name}`);
        console.log(`   💬 Error message: ${error.message}`);
        console.log(`   📍 Stack trace: ${error.stack}`);
        res.status(500).json({
            success: false,
            message: 'Failed to update ground plane parameters',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API endpoint to generate F_GND_Import.m for custom DXF ground plane
app.post('/api/matlab/generate-gnd-import', moderateRateLimiter, async (req, res) => {
    try {
        const { dxfPath, gndXPos, gndYPos, projectPath, mode } = req.body;

        // Validate projectPath (always required)
        if (!projectPath || typeof projectPath !== 'string') {
            console.log('❌ Error: Invalid projectPath provided');
            return res.status(400).json({
                success: false,
                message: 'projectPath string is required'
            });
        }
        
        // Validate and sanitize projectPath to prevent path traversal
        const pathValidation = validatePath(projectPath);
        if (!pathValidation.valid) {
            console.log(`❌ Security: Path validation failed - ${pathValidation.error}`);
            return res.status(400).json({
                success: false,
                message: 'Invalid project path',
                error: pathValidation.error
            });
        }

        // Extract project root directory
        const projectRoot = path.dirname(projectPath);
        const pythonExecutable = setupConfig.getPythonExecutable();
        const pythonScriptPath = path.join(__dirname, '..', 'scripts', 'generate_gnd_import.py');

        // Mode: 'clear' or 'import'
        // Clear mode: Generate empty F_GND_Import.m (no custom GND)
        // Import mode: Generate F_GND_Import.m with DXF import
        
        if (mode === 'clear' || !dxfPath || dxfPath === '' || dxfPath === 'none') {
            // CLEAR MODE: Generate empty F_GND_Import.m
            console.log(`🧹 Generating empty F_GND_Import.m (no custom GND)`);
            console.log(`📁 Project root: ${projectRoot}`);
            
            const pythonCommand = `"${pythonExecutable}" "${pythonScriptPath}" "${projectRoot}"`;
            console.log(`🐍 Executing: ${pythonCommand}`);
            
            exec(pythonCommand, (error, stdout, stderr) => {
                if (error) {
                    console.log(`❌ Python script execution failed`);
                    console.log(`   💬 Error message: ${error.message}`);
                    if (stderr) console.log(`   📛 stderr: ${stderr}`);
                    
                    return res.status(500).json({
                        success: false,
                        message: 'Failed to generate empty ground plane file. Check server logs.',
                        timestamp: new Date().toISOString()
                    });
                }

                console.log(`✅ Empty F_GND_Import.m generated successfully`);
                if (stdout) console.log(`   📊 stdout: ${stdout}`);

                const outputPath = path.join(projectRoot, 'Function', 'HFSS', 'F_GND_Import.m');

                res.json({
                    success: true,
                    message: 'F_GND_Import.m cleared (no custom GND)',
                    mode: 'clear',
                    outputFile: outputPath,
                    pythonOutput: stdout,
                    timestamp: new Date().toISOString()
                });
            });
            
        } else {
            // IMPORT MODE: Generate F_GND_Import.m with custom DXF
            
            // Validate required parameters for import mode
            if (typeof dxfPath !== 'string') {
                console.log('❌ Error: Invalid dxfPath provided');
                return res.status(400).json({
                    success: false,
                    message: 'dxfPath string is required for import mode'
                });
            }

            if (gndXPos === undefined || gndXPos === null || isNaN(Number(gndXPos))) {
                console.log('❌ Error: Invalid gndXPos provided');
                return res.status(400).json({
                    success: false,
                    message: 'gndXPos numeric value is required for import mode'
                });
            }

            if (gndYPos === undefined || gndYPos === null || isNaN(Number(gndYPos))) {
                console.log('❌ Error: Invalid gndYPos provided');
                return res.status(400).json({
                    success: false,
                    message: 'gndYPos numeric value is required for import mode'
                });
            }
            
            console.log(`🔧 Generating F_GND_Import.m for custom DXF ground plane`);
            console.log(`📂 DXF file: ${dxfPath}`);
            console.log(`📍 Position: X=${gndXPos}, Y=${gndYPos}`);
            console.log(`📁 Project root: ${projectRoot}`);

            // Execute Python script to generate F_GND_Import.m with DXF import
            const pythonCommand = `"${pythonExecutable}" "${pythonScriptPath}" "${dxfPath}" ${gndXPos} ${gndYPos} "${projectRoot}"`;
            
            console.log(`🐍 Executing: ${pythonCommand}`);
            
            exec(pythonCommand, (error, stdout, stderr) => {
                if (error) {
                    console.log(`❌ Python script execution failed`);
                    console.log(`   💬 Error message: ${error.message}`);
                    if (stderr) console.log(`   📛 stderr: ${stderr}`);
                    
                    return res.status(500).json({
                        success: false,
                        message: 'Ground plane generation failed. Check server logs.',
                        timestamp: new Date().toISOString()
                    });
                }

                console.log(`✅ Python script executed successfully`);
                if (stdout) console.log(`   📊 stdout: ${stdout}`);

                // Expected output path
                const outputPath = path.join(projectRoot, 'Function', 'HFSS', 'F_GND_Import.m');

                res.json({
                    success: true,
                    message: 'F_GND_Import.m generated successfully',
                    mode: 'import',
                    parameters: {
                        dxfPath: dxfPath,
                        gndXPos: Number(gndXPos),
                        gndYPos: Number(gndYPos)
                    },
                    outputFile: outputPath,
                    pythonOutput: stdout,
                    timestamp: new Date().toISOString()
                });
            });
        }

    } catch (error) {
        console.log(`❌ Error in generate-gnd-import endpoint:`);
        console.log(`   🔧 Error type: ${error.name}`);
        console.log(`   💬 Error message: ${error.message}`);
        console.log(`   📍 Stack trace: ${error.stack}`);
        res.status(500).json({
            success: false,
            message: 'Failed to generate custom GND import',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});



// API endpoint to backup and optionally remove optimization folder
app.post('/api/matlab/manage-optimization-folder', async (req, res) => {
    try {
        const { projectPath, action } = req.body; // action: 'backup-only' or 'backup-and-remove'
        
        if (!projectPath || typeof projectPath !== 'string') {
            console.log('❌ Error: Invalid projectPath provided');
            return res.status(400).json({
                success: false,
                message: 'projectPath string is required'
            });
        }

        if (!action || (action !== 'backup-only' && action !== 'backup-and-remove')) {
            console.log('❌ Error: Invalid action provided');
            return res.status(400).json({
                success: false,
                message: 'action must be "backup-only" or "backup-and-remove"'
            });
        }

        // Extract project root directory from project path
        const projectRoot = path.dirname(projectPath);
        
        console.log(`🔧 Managing optimization data for project: ${projectPath}`);
        console.log(`📂 Project root: ${projectRoot}`);
        console.log(`⚙️ Action: ${action}`);

        // Execute Python script for optimization data management
        const pythonScriptPath = path.join(__dirname, '..', 'scripts', 'manage_optimization_data.py');
        const pythonCommand = `python "${pythonScriptPath}" "${action}" "${projectRoot}"`;
        
        console.log(`🐍 Executing Python script: ${pythonScriptPath}`);
        console.log(`📊 Parameters: action="${action}", project_root="${projectRoot}"`);
        
        exec(pythonCommand, (error, stdout, stderr) => {
            if (error) {
                console.log(`❌ Python script execution error:`);
                console.log(`   🔧 Error: ${error.message}`);
                console.log(`   📝 stderr: ${stderr}`);
                console.log(`   📝 stdout: ${stdout}`);
                
                // Try to parse any JSON output from the error
                try {
                    const lines = stdout.split('\n');
                    const jsonLine = lines.find(line => line.trim().startsWith('{'));
                    if (jsonLine) {
                        const errorResult = JSON.parse(jsonLine);
                        return res.status(500).json({
                            success: false,
                            message: errorResult.message || 'Python script execution failed',
                            action: action,
                            error: error.message,
                            pythonOutput: stdout,
                            pythonErrors: stderr,
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (parseError) {
                    // Ignore parse error and fall back to generic response
                }
                
                return res.status(500).json({
                    success: false,
                    message: 'Failed to execute optimization management script',
                    action: action,
                    error: error.message,
                    pythonOutput: stdout,
                    pythonErrors: stderr,
                    timestamp: new Date().toISOString()
                });
            }
            
            console.log(`✅ Python script executed successfully`);
            console.log(`📄 stdout: ${stdout}`);
            
            if (stderr) {
                console.log(`⚠️ stderr: ${stderr}`);
            }
            
            try {
                // Parse JSON output from Python script
                const lines = stdout.split('\n');
                const jsonStartIndex = lines.findIndex(line => line.trim() === 'JSON OUTPUT:');
                
                if (jsonStartIndex === -1) {
                    throw new Error('No JSON output found from Python script');
                }
                
                const jsonLines = lines.slice(jsonStartIndex + 1).filter(line => line.trim());
                const jsonOutput = jsonLines.join('\n');
                const pythonResult = JSON.parse(jsonOutput);
                
                // Convert Python result format to expected API response format
                const apiResponse = {
                    success: pythonResult.success,
                    message: pythonResult.message,
                    action: pythonResult.action,
                    optimizationExists: pythonResult.optimization_exists,
                    backupCreated: pythonResult.backup_created,
                    optimizationRemoved: pythonResult.optimization_removed,
                    fModelRemoved: pythonResult.fmodel_removed,
                    fModelBackupCreated: pythonResult.fmodel_backup_created,
                    paths: {
                        optimizationPath: path.join(projectRoot, 'Optimization'),
                        backupPath: pythonResult.backup_path,
                        projectRoot: projectRoot
                    },
                    stats: pythonResult.stats,
                    errors: pythonResult.errors || [],
                    pythonOutput: stdout,
                    timestamp: pythonResult.timestamp
                };
                
                res.json(apiResponse);
                
            } catch (parseError) {
                console.log(`❌ Failed to parse Python script output: ${parseError.message}`);
                console.log(`📝 Raw output: ${stdout}`);
                
                return res.status(500).json({
                    success: false,
                    message: 'Failed to parse optimization management script output',
                    action: action,
                    error: parseError.message,
                    pythonOutput: stdout,
                    pythonErrors: stderr,
                    timestamp: new Date().toISOString()
                });
            }
        });

    } catch (error) {
        console.log(`❌ Error in manage-optimization-folder endpoint:`);
        console.log(`   🔧 Error type: ${error.name}`);
        console.log(`   💬 Error message: ${error.message}`);
        console.log(`   📍 Stack trace: ${error.stack}`);
        res.status(500).json({
            success: false,
            message: 'Failed to manage optimization folder',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API endpoint for reading simulation results from Excel files with iteration support
app.post('/api/simulation/results', async (req, res) => {
    try {
        const { dataPath, targetFrequencies } = req.body;
        
        if (!dataPath || !targetFrequencies || !Array.isArray(targetFrequencies)) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameters: dataPath and targetFrequencies array',
                timestamp: new Date().toISOString()
            });
        }

        console.log(`📊 Loading simulation results from: ${dataPath}`);
        console.log(`🎯 Target frequencies: ${targetFrequencies.join(', ')} GHz`);

        // Check if data path exists
        if (!fs.existsSync(dataPath)) {
            return res.status(404).json({
                success: false,
                message: `Data path not found: ${dataPath}`,
                timestamp: new Date().toISOString()
            });
        }

        // Look for Excel files in the data directory
        const files = fs.readdirSync(dataPath);
        const excelFiles = files.filter(file => 
            file.toLowerCase().endsWith('.xlsx') || file.toLowerCase().endsWith('.xls')
        );

        console.log(`📁 Found Excel files: ${excelFiles.join(', ')}`);

        // Function to read Excel file and extract iteration-based data
        const readIterationExcelData = (filePath) => {
            try {
                const workbook = XLSX.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                console.log(`📊 Reading ${path.basename(filePath)}: ${data.length} rows found`);

                // Skip header row and process data
                const iterationResults = [];
                let currentIteration = null;
                
                for (let i = 1; i < data.length; i++) {
                    const row = data[i];
                    if (row && row.length >= 2) {
                        // Try to parse iteration number (could be in first column or implied by position)
                        let iterationNum = null;
                        let freqValue = null;
                        let resultValue = null;
                        
                        // Check if first column is iteration number
                        if (!isNaN(parseFloat(row[0])) && row.length >= 3) {
                            iterationNum = parseInt(row[0]);
                            freqValue = parseFloat(row[1]);
                            resultValue = parseFloat(row[2]);
                        } else {
                            // Assume data is grouped by iteration (every 3 rows = 1 iteration for 3 frequencies)
                            iterationNum = Math.floor((i - 1) / targetFrequencies.length) + 1;
                            freqValue = parseFloat(row[0]);
                            resultValue = parseFloat(row[1]);
                        }
                        
                        if (!isNaN(freqValue) && !isNaN(resultValue)) {
                            // Find or create iteration entry
                            let iteration = iterationResults.find(iter => iter.iteration === iterationNum);
                            if (!iteration) {
                                iteration = {
                                    iteration: iterationNum,
                                    frequencies: [],
                                    values: []
                                };
                                iterationResults.push(iteration);
                            }
                            
                            iteration.frequencies.push(freqValue);
                            iteration.values.push(resultValue);
                        }
                    }
                }


                return iterationResults;
                
            } catch (error) {
                console.error(`❌ Error reading ${filePath}:`, error.message);
                return [];
            }
        };

        // Initialize results object
        const simulationResults = {
            iterations: [],
            summary: {
                totalIterations: 0,
                s11Available: false,
                arAvailable: false,
                gainAvailable: false
            }
        };

        let maxIterations = 0;

        // Read each type of Excel file
        for (const file of excelFiles) {
            const filePath = path.join(dataPath, file);
            const fileName = file.toLowerCase();
            
            console.log(`📄 Processing: ${file}`);
            
            const iterationData = readIterationExcelData(filePath);
            maxIterations = Math.max(maxIterations, iterationData.length);
            
            if (fileName.includes('s11') || fileName.includes('return')) {
                simulationResults.summary.s11Available = true;
                // Organize S11 data by iteration
                iterationData.forEach(iter => {
                    let existing = simulationResults.iterations.find(i => i.iteration === iter.iteration);
                    if (!existing) {
                        existing = {
                            iteration: iter.iteration,
                            s11: [],
                            ar: [],
                            gain: []
                        };
                        simulationResults.iterations.push(existing);
                    }
                    existing.s11 = iter.values;
                });

                
            } else if (fileName.includes('ar') || fileName.includes('axial')) {
                simulationResults.summary.arAvailable = true;
                // Organize AR data by iteration
                iterationData.forEach(iter => {
                    let existing = simulationResults.iterations.find(i => i.iteration === iter.iteration);
                    if (!existing) {
                        existing = {
                            iteration: iter.iteration,
                            s11: [],
                            ar: [],
                            gain: []
                        };
                        simulationResults.iterations.push(existing);
                    }
                    existing.ar = iter.values;
                });

                
            } else if (fileName.includes('gain')) {
                simulationResults.summary.gainAvailable = true;
                // Organize Gain data by iteration
                iterationData.forEach(iter => {
                    let existing = simulationResults.iterations.find(i => i.iteration === iter.iteration);
                    if (!existing) {
                        existing = {
                            iteration: iter.iteration,
                            s11: [],
                            ar: [],
                            gain: []
                        };
                        simulationResults.iterations.push(existing);
                    }
                    existing.gain = iter.values;
                });

                
            } else {
                console.log(`⚠️ Unknown file type: ${file} - skipping`);
            }
        }

        // Sort iterations by iteration number
        simulationResults.iterations.sort((a, b) => a.iteration - b.iteration);
        simulationResults.summary.totalIterations = maxIterations;

        // Fill in missing data with empty arrays
        simulationResults.iterations.forEach(iter => {
            if (!simulationResults.summary.s11Available) iter.s11 = [];
            if (!simulationResults.summary.arAvailable) iter.ar = [];
            if (!simulationResults.summary.gainAvailable) iter.gain = [];
        });

        // Check if any data was loaded
        const hasData = simulationResults.iterations.length > 0;
        
        if (!hasData) {
            return res.status(404).json({
                success: false,
                message: 'No valid simulation data found. Expected Excel files with names containing "s11", "ar", or "gain".',
                availableFiles: excelFiles,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`✅ Results loaded: ${simulationResults.iterations.length} iterations`);
        
        res.json({
            success: true,
            message: `Simulation results loaded successfully: ${simulationResults.iterations.length} iterations`,
            data: simulationResults,
            metadata: {
                dataPath: dataPath,
                targetFrequencies: targetFrequencies,
                filesProcessed: excelFiles,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Error in simulation results endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load simulation results',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API endpoint for integrated Excel results management
app.post('/api/integrated-results/create', async (req, res) => {
    try {
        const { projectPath } = req.body;
        
        if (!projectPath) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: projectPath',
                timestamp: new Date().toISOString()
            });
        }

        const pythonScript = path.join(__dirname, '..', 'scripts', 'integrated_results_manager.py');
        const command = `python "${pythonScript}" create --project-path "${projectPath}"`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Error creating integrated Excel:', error.message);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to create integrated Excel file',
                    error: error.message,
                    stderr: stderr,
                    timestamp: new Date().toISOString()
                });
            }

            console.log('✅ Results cache created successfully');

            res.json({
                success: true,
                message: 'Integrated Excel file created successfully',
                output: stdout,
                timestamp: new Date().toISOString()
            });
        });

    } catch (error) {
        console.error('❌ Error in integrated-results/create endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create integrated Excel',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API endpoint for updating integrated Excel with new iteration
app.post('/api/integrated-results/update', async (req, res) => {
    try {
        const { projectPath, iteration } = req.body;
        
        if (!projectPath) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: projectPath',
                timestamp: new Date().toISOString()
            });
        }

        const pythonScript = path.join(__dirname, '..', 'scripts', 'integrated_results_manager.py');
        let command = `python "${pythonScript}" update --project-path "${projectPath}"`;
        
        if (iteration) {
            command += ` --iteration ${iteration}`;
        }

        exec(command, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Error updating integrated Excel:', error.message);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to update integrated Excel file',
                    error: error.message,
                    stderr: stderr,
                    timestamp: new Date().toISOString()
                });
            }

            // Only log if there's an error, success is handled by frontend
            if (stderr && stderr.trim()) {
                console.log('⚠️ Python script warnings:', stderr.trim());
            }

            res.json({
                success: true,
                message: 'Integrated Excel file updated successfully',
                output: stdout,
                timestamp: new Date().toISOString()
            });
        });

    } catch (error) {
        console.error('❌ Error in integrated-results/update endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update integrated Excel',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API endpoint for clearing integrated Excel file
app.post('/api/integrated-results/clear', async (req, res) => {
    try {
        const { projectPath } = req.body;
        
        if (!projectPath) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: projectPath',
                timestamp: new Date().toISOString()
            });
        }

        console.log(`🗑️ Clearing integrated Excel for project: ${projectPath}`);

        const pythonScript = path.join(__dirname, '..', 'scripts', 'integrated_results_manager.py');
        const command = `python "${pythonScript}" clear --project-path "${projectPath}"`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Error clearing integrated Excel:', error.message);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to clear integrated Excel file',
                    error: error.message,
                    stderr: stderr,
                    timestamp: new Date().toISOString()
                });
            }

            console.log('✅ Results cache cleared successfully');

            res.json({
                success: true,
                message: 'Integrated Excel file cleared successfully',
                output: stdout,
                timestamp: new Date().toISOString()
            });
        });

    } catch (error) {
        console.error('❌ Error in integrated-results/clear endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to clear integrated Excel',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API endpoint for reading integrated Excel results
app.post('/api/integrated-results/read', async (req, res) => {
    try {
        const { projectPath } = req.body;
        
        if (!projectPath) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: projectPath',
                timestamp: new Date().toISOString()
            });
        }

        console.log(`📖 Reading integrated Excel for project: ${projectPath}`);

        // First get summary information
        const pythonScript = path.join(__dirname, '..', 'scripts', 'integrated_results_manager.py');
        const command = `python "${pythonScript}" summary --project-path "${projectPath}"`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Error reading integrated Excel:', error.message);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to read integrated Excel file',
                    error: error.message,
                    stderr: stderr,
                    timestamp: new Date().toISOString()
                });
            }

            try {
                const summary = JSON.parse(stdout);
                
                if (!summary.exists) {
                    console.log(`🔄 Excel file not found, auto-creating: ${summary.path}`);
                    return res.status(404).json({
                        success: false,
                        message: 'Integrated Excel file not found',
                        summary: summary,
                        timestamp: new Date().toISOString()
                    });
                }

                console.log(`✅ Excel summary retrieved: ${summary.total_iterations} iterations`);

                // Read the Excel file
                const excelPath = path.join(projectPath, 'Integrated_Results.xlsx');
                
                if (fs.existsSync(excelPath)) {
                    // Use the existing Excel reading logic
                    const workbook = XLSX.readFile(excelPath);
                    const results = {
                        iterations: [],
                        summary: {
                            totalIterations: summary.total_iterations,
                            s11Available: 'S11_Data' in summary.sheets,
                            arAvailable: 'AR_Data' in summary.sheets,
                            gainAvailable: 'Gain_Data' in summary.sheets
                        }
                    };

                    // Read each sheet and organize by iteration
                    const iterationData = {};

                    ['S11_Data', 'AR_Data', 'Gain_Data'].forEach(sheetName => {
                        if (workbook.SheetNames.includes(sheetName)) {
                            const worksheet = workbook.Sheets[sheetName];
                            const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                            
                            // Skip header row and process data
                            for (let i = 1; i < data.length; i++) {
                                const row = data[i];
                                if (row && row.length >= 3) {
                                    const iteration = parseInt(row[0]);
                                    const frequency = parseFloat(row[1]);
                                    const value = parseFloat(row[2]);
                                    
                                    if (!isNaN(iteration) && !isNaN(frequency) && !isNaN(value)) {
                                        if (!iterationData[iteration]) {
                                            iterationData[iteration] = {
                                                iteration: iteration,
                                                frequencies: [],
                                                s11: [],
                                                ar: [],
                                                gain: []
                                            };
                                        }
                                        
                                        // Store frequency if not already stored
                                        if (!iterationData[iteration].frequencies.includes(frequency)) {
                                            iterationData[iteration].frequencies.push(frequency);
                                        }
                                        
                                        // Store value in appropriate array
                                        const dataType = sheetName.split('_')[0].toLowerCase();
                                        iterationData[iteration][dataType].push(value);
                                    }
                                }
                            }
                        }
                    });

                    // Convert to array and sort by iteration
                    results.iterations = Object.values(iterationData).sort((a, b) => a.iteration - b.iteration);

                    res.json({
                        success: true,
                        message: `Integrated Excel data loaded: ${results.iterations.length} iterations`,
                        data: results,
                        summary: summary,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    res.status(404).json({
                        success: false,
                        message: 'Integrated Excel file not found',
                        path: excelPath,
                        timestamp: new Date().toISOString()
                    });
                }

            } catch (parseError) {
                console.error('❌ Error parsing summary output:', parseError.message);
                res.status(500).json({
                    success: false,
                    message: 'Failed to parse integrated Excel summary',
                    error: parseError.message,
                    output: stdout,
                    timestamp: new Date().toISOString()
                });
            }
        });

    } catch (error) {
        console.error('❌ Error in integrated-results/read endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to read integrated Excel',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Simple paginated API endpoint for loading results in chunks of 100
app.post('/api/integrated-results/read-page', async (req, res) => {
    try {
        const { projectPath, page = 1, pageSize = 100 } = req.body;
        
        if (!projectPath) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: projectPath'
            });
        }

        const excelPath = path.join(projectPath, 'Integrated_Results.xlsx');
        
        if (!fs.existsSync(excelPath)) {
            return res.status(404).json({
                success: false,
                message: 'Excel file not found. Please run optimization first.'
            });
        }

        console.log(`📖 Reading page ${page} (size: ${pageSize})`);

        const workbook = XLSX.readFile(excelPath);
        const iterationData = {};

        // Read all sheets
        ['S11_Data', 'AR_Data', 'Gain_Data'].forEach(sheetName => {
            if (workbook.SheetNames.includes(sheetName)) {
                const worksheet = workbook.Sheets[sheetName];
                const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                for (let i = 1; i < data.length; i++) {
                    const row = data[i];
                    if (row && row.length >= 3) {
                        const iteration = parseInt(row[0]);
                        const frequency = parseFloat(row[1]);
                        const value = parseFloat(row[2]);
                        
                        if (!isNaN(iteration) && !isNaN(frequency) && !isNaN(value)) {
                            if (!iterationData[iteration]) {
                                iterationData[iteration] = {
                                    iteration,
                                    frequencies: [],
                                    s11: [],
                                    ar: [],
                                    gain: []
                                };
                            }
                            
                            if (!iterationData[iteration].frequencies.includes(frequency)) {
                                iterationData[iteration].frequencies.push(frequency);
                            }
                            
                            const dataType = sheetName.split('_')[0].toLowerCase();
                            iterationData[iteration][dataType].push(value);
                        }
                    }
                }
            }
        });

        // Sort and paginate (ascending: oldest first, so page 1 = iter 1-100, last page = newest)
        const allIterations = Object.values(iterationData).sort((a, b) => a.iteration - b.iteration);
        const totalIterations = allIterations.length;
        const totalPages = Math.ceil(totalIterations / pageSize);
        const startIdx = (page - 1) * pageSize;
        const endIdx = startIdx + pageSize;
        const pageIterations = allIterations.slice(startIdx, endIdx);

        res.json({
            success: true,
            data: {
                iterations: pageIterations,
                summary: {
                    totalIterations,
                    s11Available: workbook.SheetNames.includes('S11_Data'),
                    arAvailable: workbook.SheetNames.includes('AR_Data'),
                    gainAvailable: workbook.SheetNames.includes('Gain_Data')
                }
            },
            page,
            pageSize,
            totalPages,
            hasMore: page < totalPages
        });

    } catch (error) {
        console.error('❌ Error reading page:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to read page',
            error: error.message
        });
    }
});

// Update Excel with missing iterations
app.post('/api/integrated-results/update', async (req, res) => {
    try {
        const { projectPath } = req.body;
        
        if (!projectPath || !fs.existsSync(projectPath)) {
            return res.status(400).json({ success: false, message: 'Invalid project path' });
        }

        console.log(`🔄 Updating Excel for project: ${projectPath}`);

        // Run Python script to update Excel
        const scriptPath = path.join(__dirname, '..', 'scripts', 'update_excel_incremental.py');
        const pythonCmd = `python "${scriptPath}" --project-path "${projectPath}"`;

        exec(pythonCmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Update error:', stderr);
                return res.json({ success: false, message: 'Update failed', error: stderr });
            }

            console.log('✅ Update output:', stdout);
            res.json({ success: true, message: 'Excel updated successfully', output: stdout });
        });

    } catch (error) {
        console.error('❌ Update endpoint error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
    console.log(`\n📛 Received ${signal}, shutting down gracefully...`);
    
    // Stop accepting new connections
    httpServer.close(() => {
        console.log('✅ HTTP server closed');
    });
    
    // Close all WebSocket connections
    if (wss) {
        console.log(`🔌 Closing ${wsClients.size} WebSocket connections...`);
        wsClients.forEach(client => {
            try {
                client.close(1000, 'Server shutting down');
            } catch (err) {
                console.error('Error closing WebSocket:', err.message);
            }
        });
        wss.close(() => {
            console.log('✅ WebSocket server closed');
        });
    }
    
    // Stop MATLAB process
    if (matlabProcess) {
        console.log('🛑 Stopping MATLAB process...');
        try {
            matlabProcess.kill('SIGTERM');
        } catch (err) {
            console.error('Error stopping MATLAB:', err.message);
        }
    }
    
    // Clear all intervals
    console.log(`🧹 Clearing ${activeIntervals.length} active intervals...`);
    activeIntervals.forEach(interval => clearInterval(interval));
    activeIntervals.length = 0;
    
    // Close active HTTP connections
    activeConnections.forEach(socket => {
        try {
            socket.destroy();
        } catch (err) {
            console.error('Error closing socket:', err.message);
        }
    });
    
    console.log('✅ Server shut down cleanly');
    
    // Give time for cleanup, then exit
    setTimeout(() => {
        process.exit(0);
    }, TIMEOUTS.GRACEFUL_SHUTDOWN_DELAY);
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the server
const httpServer = http.createServer(app);
const wss = new WebSocket.Server({ 
  server: httpServer,
  path: '/ws',
  perMessageDeflate: false
});

// WebSocket connection management
let wsClients = new Set();
let lastBroadcastData = {
  status: null,
  iterations: null,
  connection_stats: null,
  timestamp: 0
};

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
  // Client connected silently
  
  wsClients.add(ws);
  
  // Send initial data to new client - always send current live status
  // Get current process information for accurate status
  getMatlabProcesses().then(currentMatlabProcesses => {
    detectHFSSProcesses().then(currentHfssProcesses => {
      const matlabRunning = currentMatlabProcesses.length > 0;
      
      // Update execution state if external processes detected
      if (!currentExecutionState.isRunning && matlabRunning) {
        currentExecutionState.isRunning = true;
        if (!currentExecutionState.fileName) {
          currentExecutionState.fileName = 'MATLAB (external start)';
          currentExecutionState.startTime = new Date().toISOString();
          currentExecutionState.processId = currentMatlabProcesses[0]?.pid || 'Unknown';
        }
      } else if (currentExecutionState.isRunning && !matlabRunning) {
        currentExecutionState.isRunning = false;
      }
      
      const currentStatusData = {
        success: true,
        execution: currentExecutionState,
        processDetails: {
          matlab: {
            running: matlabRunning,
            count: currentMatlabProcesses.length,
            processes: currentMatlabProcesses.map(p => ({
              pid: p.pid,
              name: p.name,
              memoryUsage: p.memUsage,
              sessionName: p.sessionName
            }))
          },
          hfss: {
            running: currentHfssProcesses.length > 0,
            count: currentHfssProcesses.length,
            processes: currentHfssProcesses.map(p => ({
              pid: p.pid,
              name: p.name,
              memoryUsage: p.memUsage,
              sessionName: p.sessionName
            }))
          }
        },
        timestamp: new Date().toISOString()
      };
      
      ws.send(JSON.stringify({
        type: 'status',
        data: currentStatusData,
        timestamp: Date.now()
      }));
      
      // Status sent silently
    }).catch(err => console.error('Error getting HFSS processes for new client:', err));
  }).catch(err => console.error('Error getting MATLAB processes for new client:', err));
  
  if (lastBroadcastData.iterations) {
    ws.send(JSON.stringify({
      type: 'iterations',
      data: lastBroadcastData.iterations,
      timestamp: Date.now()
    }));
  }
  
  if (lastBroadcastData.connection_stats) {
    ws.send(JSON.stringify({
      type: 'connection_stats',
      data: lastBroadcastData.connection_stats,
      timestamp: Date.now()
    }));
  }
  
  // Handle client messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      // Message received silently
      
      // Handle different message types
      switch (data.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
        case 'subscribe':
          // Client subscribing to specific updates
          ws.subscriptions = data.topics || ['status', 'iterations'];
          break;
        default:
          console.log(`❓ Unknown WebSocket message type: ${data.type}`);
      }
    } catch (error) {
      console.log(`❌ WebSocket message parse error: ${error.message}`);
    }
  });
  
  // Handle client disconnect
  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`🔌 WebSocket client disconnected: ${clientId} (${wsClients.size} remaining)`);
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.log(`❌ WebSocket error for ${clientId}: ${error.message}`);
    wsClients.delete(ws);
  });
});

// Helper function to broadcast current status to all WebSocket clients
function broadcastCurrentStatus() {
  const statusData = {
    success: true,
    execution: currentExecutionState,
    timestamp: new Date().toISOString()
  };
  broadcastToClients('status', statusData, true); // Force update for state changes
}

// Function to broadcast data to all connected WebSocket clients
function broadcastToClients(type, data, forceUpdate = false) {
  if (wsClients.size === 0) return;
  
  const message = JSON.stringify({
    type: type,
    data: data,
    timestamp: Date.now()
  });
  
  // Check if data has changed to avoid unnecessary broadcasts
  const dataKey = type;
  const dataChanged = !lastBroadcastData[dataKey] || 
    JSON.stringify(lastBroadcastData[dataKey]) !== JSON.stringify(data) ||
    forceUpdate;
  
  if (dataChanged) {
    lastBroadcastData[dataKey] = data;
    lastBroadcastData.timestamp = Date.now();
    
    let successCount = 0;
    let errorCount = 0;
    
    wsClients.forEach(ws => {
      // Check if client is subscribed to this type
      if (!ws.subscriptions || ws.subscriptions.includes(type)) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(message);
            successCount++;
          } catch (error) {
            errorCount++;
            wsClients.delete(ws);
          }
        } else {
          wsClients.delete(ws);
        }
      }
    });
    
    // Broadcasting completed silently (only log errors)
    if (errorCount > 0) {
      console.log(`⚠️ Failed to send to ${errorCount} clients (removed)`);
    }
  }
}

const server = httpServer.listen(PORT, '0.0.0.0', () => {
    logger.info(`MATLAB & HFSS Server started`, {
        host: `http://${serverConfig.host}:${PORT}`,
        websocket: serverConfig.websocket.url,
        config: 'OPEN_THIS/SETUP/setup_variable.json',
        features: ['Real-time WebSocket', 'Zero TIME_WAIT', 'Iteration tracking', 'Integrated Excel results']
    });
    console.log(`🚀 MATLAB & HFSS Server running on http://${serverConfig.host}:${PORT}`);
    console.log(`🔗 WebSocket server running on ${serverConfig.websocket.url}`);
    console.log(`📋 Configuration loaded from: OPEN_THIS/SETUP/setup_variable.json`);
    console.log('⚡ Real-time WebSocket communication enabled - zero TIME_WAIT connections!');
    console.log('📋 Endpoints: /run, /stop, /status, /check, /processes/details, /iteration-count, /manage-optimization-folder, /simulation/results');
    console.log('🔄 Enhanced coordinated process management with iteration tracking, optimization folder management, and integrated Excel results ready');
    
    // Set initial state and show startup status
    exec('tasklist /FI "IMAGENAME eq MATLAB.exe" /FO CSV', (error, stdout) => {
        const matlabRunning = !error && stdout.includes('MATLAB.exe');
        console.log(`🔍 Initial status - MATLAB process: ${matlabRunning}, app state: ${currentExecutionState.isRunning}`);
        previousState.matlabRunning = matlabRunning;
        previousState.appStateRunning = currentExecutionState.isRunning;
    });
});

// Configure server for aggressive connection management
server.keepAliveTimeout = 2000; // Shorter 2 seconds to cycle connections faster
server.headersTimeout = 3000; // 3 seconds (higher than keepAliveTimeout)
server.timeout = 15000; // Shorter 15 seconds for request timeout
server.maxConnections = 20; // More aggressive connection limit

// Set aggressive TCP keep-alive options with connection tracking
let activeConnections = new Set();

server.on('connection', (socket) => {
    activeConnections.add(socket);
    
    // Shorter keep-alive and timeout for faster cleanup
    socket.setKeepAlive(true, 1000); // 1 second initial delay
    socket.setTimeout(TIMEOUTS.SOCKET_TIMEOUT); // 10 second socket timeout
    
    // Force socket reuse options
    socket.setNoDelay(true); // Disable Nagle's algorithm for faster response
    
    socket.on('timeout', () => {
        console.log('🔌 Socket timeout - closing connection');
        activeConnections.delete(socket);
        socket.destroy();
    });
    
    socket.on('error', (err) => {
        console.log('🔌 Socket error:', err.message);
        activeConnections.delete(socket);
        socket.destroy();
    });
    
    socket.on('close', () => {
        activeConnections.delete(socket);
    });
});

// Aggressive connection cleanup - force close idle connections every 5 seconds
const connectionCleanupInterval = setInterval(() => {
    if (activeConnections.size > 10) {
        console.log(`🧹 Cleaning up ${activeConnections.size} connections`);
        let cleaned = 0;
        activeConnections.forEach(socket => {
            if (socket.readyState === 'open' && cleaned < 5) {
                socket.destroy();
                cleaned++;
            }
        });
    }
}, TIMEOUTS.CONNECTION_CLEANUP_INTERVAL);
activeIntervals.push(connectionCleanupInterval);

// Automatic iteration tracking - check and broadcast iterations every 5 seconds when MATLAB is running
const iterationTrackingInterval = setInterval(async () => {
    // Only check if MATLAB is running and we have a valid project path
    if (currentExecutionState.isRunning && currentExecutionState.filePath) {
        try {
            const projectPath = currentExecutionState.filePath;
            let projectDir = projectPath;
            if (path.extname(projectPath) === '.mlx') {
                projectDir = path.dirname(projectPath);
            }
            
            const tempDir = path.normalize(path.join(projectDir, 'Optimization', 'temp'));
            
            // Only proceed if temp directory exists
            if (fs.existsSync(tempDir)) {
                // Check cache first to avoid repeated file system operations
                const cacheKey = tempDir;
                const now = Date.now();
                
                let shouldCheck = true;
                if (fileSystemCache.has(cacheKey)) {
                    const cached = fileSystemCache.get(cacheKey);
                    if (now - cached.timestamp < CACHE_TTL) {
                        shouldCheck = false; // Still within cache timeout
                    }
                }
                
                if (shouldCheck) {
                    const files = fs.readdirSync(tempDir);
                    const vbsFiles = files.filter(file => 
                        file.toLowerCase().endsWith('.vbs') && 
                        file.toLowerCase().startsWith('antenna')
                    );
                    
                    if (vbsFiles.length > 0) {
                        // Extract iteration numbers
                        const iterations = vbsFiles.map(file => {
                            const match = file.match(/antenna(\d+)\.vbs/i);
                            return match ? parseInt(match[1], 10) : 0;
                        }).filter(num => num > 0);
                        
                        const maxIteration = Math.max(...iterations);
                        const latestVBScript = `Antenna${maxIteration}.vbs`;
                        
                        // Get or create project-specific state
                        const projectKey = projectPath;
                        if (!projectIterationStates.has(projectKey)) {
                            projectIterationStates.set(projectKey, { 
                                iterationCount: -1, 
                                currentIteration: -1,
                                lastLogTime: 0
                            });
                        }
                        
                        const projectState = projectIterationStates.get(projectKey);
                        
                        // Only broadcast if iteration count changed
                        if (iterations.length !== projectState.iterationCount || 
                            maxIteration !== projectState.currentIteration) {
                            
                            const result = {
                                success: true,
                                iterationCount: iterations.length,
                                currentIteration: maxIteration,
                                latestVBScript: latestVBScript,
                                tempDir: tempDir,
                                message: `${iterations.length} iterations detected (current: ${maxIteration})`,
                                timestamp: new Date().toISOString()
                            };
                            
                            // Update state
                            projectState.iterationCount = iterations.length;
                            projectState.currentIteration = maxIteration;
                            
                            // Cache the result
                            fileSystemCache.set(cacheKey, {
                                result: result,
                                timestamp: now
                            });
                            
                            // Broadcast to WebSocket clients
                            broadcastToClients('iterations', result);
                        }
                    }
                }
            }
        } catch (error) {
            // Silently ignore errors in automatic iteration tracking
            // Full errors are logged in the HTTP endpoint
        }
    }
}, TIMEOUTS.ITERATION_CHECK_INTERVAL);
activeIntervals.push(iterationTrackingInterval);

// Automatic connection management system
let connectionStats = {
    totalRequests: 0,
    activeConnections: 0,
    timeWaitConnections: 0,
    lastCleanup: Date.now(),
    lastBroadcastTime: 0,
    adaptiveSettings: {
        keepAliveTimeout: 2000,
        maxConnections: 20,
        cleanupInterval: 5000
    },
    // Track previous values to detect actual changes
    previousSettings: {
        keepAliveTimeout: 2000,
        maxConnections: 20,
        cleanupInterval: 5000
    },
    // Track last broadcast values to batch changes
    lastBroadcastSettings: {
        keepAliveTimeout: 2000,
        maxConnections: 20,
        cleanupInterval: 5000
    }
};

// Intelligent connection monitor and auto-manager
const connectionManagerInterval = setInterval(async () => {
    // Get current connection statistics
    const { exec } = require('child_process');
    
    exec('netstat -an | findstr :3001', (error, stdout) => {
        if (error) return;
        
        const lines = stdout.split('\n').filter(line => line.trim());
        const stats = {
            listening: 0,
            established: 0,
            timeWait: 0,
            total: lines.length
        };
        
        lines.forEach(line => {
            if (line.includes('LISTENING')) stats.listening++;
            else if (line.includes('ESTABLISHED')) stats.established++;
            else if (line.includes('TIME_WAIT')) stats.timeWait++;
        });
        
        connectionStats.activeConnections = stats.established;
        connectionStats.timeWaitConnections = stats.timeWait;
        
        // Automatic adaptive management
        const now = Date.now();
        let adaptationsMade = [];
        
        // Auto-adjust keep-alive timeout based on TIME_WAIT accumulation
        if (stats.timeWait > 50) {
            const newTimeout = Math.max(1000, connectionStats.adaptiveSettings.keepAliveTimeout - 500);
            if (newTimeout !== connectionStats.previousSettings.keepAliveTimeout) {
                connectionStats.adaptiveSettings.keepAliveTimeout = newTimeout;
                server.keepAliveTimeout = newTimeout;
                adaptationsMade.push(`Reduced keep-alive to ${newTimeout}ms`);
                connectionStats.previousSettings.keepAliveTimeout = newTimeout;
            }
        } else if (stats.timeWait < 10 && connectionStats.adaptiveSettings.keepAliveTimeout < 3000) {
            const newTimeout = Math.min(3000, connectionStats.adaptiveSettings.keepAliveTimeout + 200);
            if (newTimeout !== connectionStats.previousSettings.keepAliveTimeout) {
                connectionStats.adaptiveSettings.keepAliveTimeout = newTimeout;
                server.keepAliveTimeout = newTimeout;
                adaptationsMade.push(`Increased keep-alive to ${newTimeout}ms`);
                connectionStats.previousSettings.keepAliveTimeout = newTimeout;
            }
        }
        
        // Auto-adjust max connections based on load
        if (stats.established > 15) {
            const newMax = Math.max(10, connectionStats.adaptiveSettings.maxConnections - 2);
            if (newMax !== connectionStats.previousSettings.maxConnections) {
                connectionStats.adaptiveSettings.maxConnections = newMax;
                server.maxConnections = newMax;
                adaptationsMade.push(`Reduced max connections to ${newMax}`);
                connectionStats.previousSettings.maxConnections = newMax;
            }
        } else if (stats.established < 3 && connectionStats.adaptiveSettings.maxConnections < 30) {
            const newMax = Math.min(30, connectionStats.adaptiveSettings.maxConnections + 1);
            if (newMax !== connectionStats.previousSettings.maxConnections) {
                connectionStats.adaptiveSettings.maxConnections = newMax;
                server.maxConnections = newMax;
                adaptationsMade.push(`Increased max connections to ${newMax}`);
                connectionStats.previousSettings.maxConnections = newMax;
            }
        }
        
        // Auto-adjust cleanup interval based on connection pressure
        if (stats.timeWait > 30 || stats.established > 10) {
            const newInterval = Math.max(2000, connectionStats.adaptiveSettings.cleanupInterval - 500);
            if (newInterval !== connectionStats.previousSettings.cleanupInterval) {
                connectionStats.adaptiveSettings.cleanupInterval = newInterval;
                adaptationsMade.push(`Increased cleanup frequency to ${newInterval}ms`);
                connectionStats.previousSettings.cleanupInterval = newInterval;
            }
        } else if (stats.timeWait < 5 && stats.established < 3) {
            const newInterval = Math.min(10000, connectionStats.adaptiveSettings.cleanupInterval + 500);
            if (newInterval !== connectionStats.previousSettings.cleanupInterval) {
                connectionStats.adaptiveSettings.cleanupInterval = newInterval;
                adaptationsMade.push(`Reduced cleanup frequency to ${newInterval}ms`);
                connectionStats.previousSettings.cleanupInterval = newInterval;
            }
        }
        
        // Aggressive cleanup when thresholds exceeded
        if (stats.timeWait > 40 || stats.established > 12) {
            let cleaned = 0;
            activeConnections.forEach(socket => {
                if (socket.readyState === 'open' && cleaned < 3) {
                    socket.destroy();
                    cleaned++;
                }
            });
            if (cleaned > 0) {
                adaptationsMade.push(`Force-cleaned ${cleaned} connections`);
            }
        }
        
        // Log adaptations (throttled to prevent spam) - only log every 30 seconds
        if (adaptationsMade.length > 0 && now - connectionStats.lastCleanup > 30000) {
            console.log(`🤖 Auto-manager: ${adaptationsMade.join(', ')}`);
            console.log(`📊 Current: ${stats.established} active, ${stats.timeWait} TIME_WAIT`);
            connectionStats.lastCleanup = now;
        }
        
        // Health scoring and status
        const healthScore = Math.max(0, 100 - (stats.timeWait * 1.5) - (stats.established * 5));
        if (healthScore < 30 && now - connectionStats.lastCleanup > 60000) {
            console.log(`⚠️ Connection health: ${healthScore.toFixed(0)}/100 - Auto-managing...`);
            connectionStats.lastCleanup = now;
        }
        
        // Broadcast connection stats to WebSocket clients only on significant changes
        const connectionData = {
            stats: stats,
            health: healthScore,
            adaptiveSettings: connectionStats.adaptiveSettings,
            wsClients: wsClients.size,
            timestamp: now
        };
        
        // Only broadcast if there are significant changes or enough time has passed
        let broadcastReasons = [];
        let shouldBroadcast = false;
        const timeSinceLastBroadcast = now - connectionStats.lastBroadcastTime;
        
        if (!lastBroadcastData.connection_stats) {
            broadcastReasons.push('initial');
            shouldBroadcast = true;
        } else {
            const prev = lastBroadcastData.connection_stats;
            const lastBroadcastSettings = connectionStats.lastBroadcastSettings;
            
            // High priority changes - broadcast immediately
            if (prev.stats.established !== stats.established) {
                broadcastReasons.push(`connections: ${prev.stats.established}→${stats.established}`);
                shouldBroadcast = true;
            }
            if (prev.stats.timeWait !== stats.timeWait) {
                broadcastReasons.push(`timeWait: ${prev.stats.timeWait}→${stats.timeWait}`);
                shouldBroadcast = true;
            }
            if (Math.abs(prev.health - healthScore) > 10) {
                broadcastReasons.push(`health: ${prev.health.toFixed(0)}→${healthScore.toFixed(0)}`);
                shouldBroadcast = true;
            }
            if (prev.wsClients !== wsClients.size) {
                broadcastReasons.push(`wsClients: ${prev.wsClients}→${wsClients.size}`);
                shouldBroadcast = true;
            }
            
            // Low priority changes - batch and broadcast every 15 seconds
            let batchedAdaptations = [];
            if (connectionStats.adaptiveSettings.keepAliveTimeout !== lastBroadcastSettings.keepAliveTimeout) {
                batchedAdaptations.push(`keep-alive: ${lastBroadcastSettings.keepAliveTimeout}→${connectionStats.adaptiveSettings.keepAliveTimeout}ms`);
            }
            if (connectionStats.adaptiveSettings.maxConnections !== lastBroadcastSettings.maxConnections) {
                batchedAdaptations.push(`max-conn: ${lastBroadcastSettings.maxConnections}→${connectionStats.adaptiveSettings.maxConnections}`);
            }
            if (connectionStats.adaptiveSettings.cleanupInterval !== lastBroadcastSettings.cleanupInterval) {
                batchedAdaptations.push(`cleanup: ${lastBroadcastSettings.cleanupInterval}→${connectionStats.adaptiveSettings.cleanupInterval}ms`);
            }
            
            // Broadcast batched adaptations if enough time passed or high priority change occurred
            if (batchedAdaptations.length > 0 && (timeSinceLastBroadcast > 15000 || shouldBroadcast)) {
                broadcastReasons.push(`adaptations: ${batchedAdaptations.join(', ')}`);
                shouldBroadcast = true;
                // Update last broadcast settings
                connectionStats.lastBroadcastSettings = { ...connectionStats.adaptiveSettings };
            }
        }
        
        if (shouldBroadcast && broadcastReasons.length > 0) {
            // Broadcasting connection stats silently
            broadcastToClients('connection_stats', connectionData, true);
            lastBroadcastData.connection_stats = connectionData;
            connectionStats.lastBroadcastTime = now;
        }
    });
}, TIMEOUTS.CONNECTION_MANAGER_INTERVAL); // Check every 3 seconds for responsive management
activeIntervals.push(connectionManagerInterval);

// ================================================================
// CUSTOM GND IMPORT API ENDPOINTS
// ================================================================

// Configure multer for GND file uploads
const gndStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads', 'gnd_files');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}_${uuidv4()}_${file.originalname}`;
    cb(null, uniqueName);
  }
});

const gndUpload = multer({
  storage: gndStorage,
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.dxf', '.stl', '.step', '.stp', '.vbs'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file format: ${ext}. Allowed: ${allowedExts.join(', ')}`));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

/**
 * POST /api/gnd/upload
 * Upload and parse custom GND geometry file
 */
app.post('/api/gnd/upload', uploadRateLimiter, gndUpload.single('gndFile'), async (req, res) => {
  try {
    const { projectPath } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    if (!projectPath) {
      return res.status(400).json({ success: false, error: 'Project path is required' });
    }
    
    console.log(`📥 GND file uploaded: ${file.originalname} (${(file.size / 1024).toFixed(2)} KB)`);
    
    // Parse geometry using Python script
    const pythonScript = path.join(__dirname, '..', 'scripts', 'gnd_importer', 'gnd_loader.py');
    const pythonExe = setupConfig.getPythonExecutable();
    
    // Wrap Python execution in a proper Promise
    const parseResult = await new Promise((resolve, reject) => {
      const pythonProcess = spawn(pythonExe, [pythonScript, file.path, projectPath]);
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`❌ Python script error: ${stderr}`);
          reject(new Error(`Failed to parse GND file: ${stderr}`));
          return;
        }
        
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (parseError) {
          console.error(`❌ Failed to parse Python output: ${parseError}`);
          reject(new Error(`Invalid response from parser: ${parseError.message}`));
        }
      });
      
      pythonProcess.on('error', (error) => {
        console.error(`❌ Failed to spawn Python process: ${error}`);
        reject(new Error(`Failed to execute parser: ${error.message}`));
      });
    });
    
    // Check if parsing was successful
    if (!parseResult.success) {
      return res.status(400).json(parseResult);
    }
    
    console.log(`✅ GND parsed successfully: ${parseResult.vertex_count} vertices, ${parseResult.face_count} faces`);
    
    res.json({
      success: true,
      file: {
        originalName: file.originalname,
        size: file.size,
        format: parseResult.format,
        path: file.path
      },
      geometry: parseResult.geometry, // Send full geometry with vertices and edges
      bounds: parseResult.bounds,
      vertex_count: parseResult.vertex_count,
      face_count: parseResult.face_count,
      edge_count: parseResult.edge_count,
      validation: parseResult.validation
    });
    
  } catch (error) {
    console.error('❌ GND upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Removed unused /api/gnd/validate, /api/gnd/generate-hfss-script, /api/gnd/list, /api/gnd/delete endpoints
// These were designed for CustomGNDImporter.jsx which was never used
// GroundPlaneConfigurator.jsx handles all GND import functionality directly

// ================================================================
// END CUSTOM GND IMPORT API ENDPOINTS
// ================================================================

module.exports = app;