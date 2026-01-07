# Project Documentation - Antenna Optimizer

Complete technical documentation for the MATLAB-HFSS Antenna Optimization System.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Component Details](#component-details)
3. [API Documentation](#api-documentation)
4. [WebSocket Communication](#websocket-communication)
5. [Data Management](#data-management)
6. [Performance Metrics](#performance-metrics)
7. [Advanced Configuration](#advanced-configuration)
8. [Troubleshooting Guide](#troubleshooting-guide)

---

## System Architecture

### Technology Stack

**Frontend:**
- React Native 0.81.4 + Expo ~54.0.10
- Expo Router (file-based navigation)
- AsyncStorage for state persistence
- LinearGradient for modern UI

**Backend:**
- Node.js + Express 5.1.0
- WebSocket (ws 8.18.3) for real-time updates
- express-rate-limit for API protection
- Python 3.8+ for data processing
- MATLAB R2020b+ + HFSS integration

**Network Architecture:**
- HTTP API: Port 3001
- WebSocket: Port 3001/ws
- Expo Dev Server: Port 8081
- Multi-URL fallback system

### Project Structure

```
fyp_project_current/
├── app/                              # React Native Application
│   ├── index.jsx                     # Home page and navigation
│   ├── app_config.js                 # Centralized config + utilities (PathUtils, showAlert)
│   ├── MatlabProjectRunner.jsx       # MATLAB execution interface
│   ├── AntennaVariableSelector.jsx   # Variable selection (78 vars)
│   ├── GroundPlaneConfigurator.jsx   # Ground plane setup
│   ├── SimulationResultsViewer.jsx   # Results display
│   ├── AboutPage.jsx                 # App information
│   └── SettingsPage.jsx              # Configuration display
│
├── server/                           # Node.js Backend
│   ├── matlab-server.js              # Main server (Port 3001)
│   ├── start-server.js               # Server launcher with auto-restart
│   └── server.pid                    # Process ID file
│
├── OPEN_THIS/                        # Setup System
│   ├── run_setup.bat                 # Quick setup launcher (Windows)
│   └── SETUP/
│       ├── quick_setup.js            # Auto-detection wizard
│       ├── setup_loader.js           # Configuration loader
│       ├── requirements.txt          # Python dependencies
│       ├── setup_variable.json       # User config (generated)
│       └── setup_variable.template.json
│
├── scripts/                          # Python Utilities
│   ├── generate_f_model.py           # Variable file generation
│   ├── generate_gnd_import.py        # Ground plane DXF import
│   ├── integrated_results_manager.py # Excel consolidation
│   ├── manage_optimization_data.py   # Backup and cleanup
│   ├── variable_config_loader.py     # Variable definitions loader
│   └── gnd_importer/                 # DXF parsing utilities
│
├── config/
│   ├── antenna_variables.json        # 78 optimization variables
│   └── antenna_variables.json.backup # Backup (83 original)
│
├── test_files/                       # Sample DXF files
│   └── dxf/                          # Test geometries
│
├── assets/                           # Images and Icons
│   ├── Matlab_Logo.png
│   ├── program_running.gif
│   ├── ready_icon.png
│   └── server_icon.png
│
├── package.json                      # Node.js dependencies
├── app.json                          # Expo configuration
├── .gitignore                        # Git exclusions
└── README.md                         # Quick start guide
```

---

## Component Details

### 1. MATLAB Project Runner (MatlabProjectRunner.jsx)

**Purpose:** Execute MATLAB Live Scripts (.mlx) with real-time monitoring

**Features:**
- Project path input and validation
- Path history (5 recent projects)
- Execution controls (Launch/Stop)
- Real-time status display via WebSocket
- Iteration counter
- Process information cards (MATLAB + HFSS)

**Workflow:**
1. Enter .mlx file path
2. Validate path exists
3. Click "Launch MATLAB Execution"
4. Monitor real-time progress
5. Stop execution if needed

**State Management:**
- Execution status (idle, running, stopping, error)
- Current iteration count
- Process details (MATLAB PID, HFSS processes)
- WebSocket connection status

---

### 2. Antenna Variable Selector (AntennaVariableSelector.jsx)

**Purpose:** Select optimization variables and configure system

**Features:**
- 78 variable selection interface
- Real-time selection counter
- Multi-URL server fallback
- Ground plane configurator button
- Optimization data management
- File generation controls

**API Endpoints:**
- `POST /api/matlab/check-file` - Validate F_Model_Element.m existence
- `POST /api/matlab/apply-variables` - Generate variable file
- `POST /api/matlab/update-ground-plane` - Apply ground plane configuration
- `POST /api/matlab/manage-optimization-folder` - Backup/clean data

**Workflow:**
1. Select 1-78 variables (or optimize all)
2. Configure ground plane (optional)
3. Choose data strategy (clean vs preserve)
4. Generate F_Model_Element.m
5. Automatic ground plane parameter application

**Variable Selection Modes:**
- **Optimize All**: All 78 variables included (default)
- **Custom**: Manually exclude specific variables

---

### 3. Ground Plane Configurator (GroundPlaneConfigurator.jsx)

**Purpose:** Configure ground plane dimensions and antenna positioning

**Interactive Visual Configuration:**
- Visual antenna positioning interface
- Real-time coordinate display
- Dimension validation (minimum 25mm × 25mm)
- Center point calculation
- Automatic boundary constraint

**Parameters:**
- **Lgx, Lgy**: Ground plane dimensions (mm)
- **GND_xPos, GND_yPos**: Antenna center position (mm)
- **Default**: 25×25mm plane, antenna centered at (12.5, 12.5)mm

**Features:**
- Drag-and-drop antenna positioning
- Real-time coordinate updates
- Visual grid display
- Boundary enforcement

**Ground Plane Variables (IDs 83-86):**
```json
{
  "id": 83, "name": "Lgx", "description": "Ground plane length X-axis",
  "id": 84, "name": "Lgy", "description": "Ground plane length Y-axis",
  "id": 85, "name": "GND_xPos", "description": "Antenna X position (center)",
  "id": 86, "name": "GND_yPos", "description": "Antenna Y position (center)"
}
```

---

### 4. Simulation Results Viewer (SimulationResultsViewer.jsx)

**Purpose:** Visualize optimization results from Excel files

**Data Visualization:**
- Excel results reading and display
- S11 (Reflection Coefficient), AR (Axial Ratio), Gain parameters
- Iteration-based data organization
- Real-time data refresh
- Summary statistics

**API Endpoints:**
- `GET /api/simulation/results` - Fetch simulation data
- `POST /api/integrated-results/create` - Initialize results cache
- `POST /api/integrated-results/update` - Update with new iterations
- `POST /api/integrated-results/read` - Read integrated Excel file
- `POST /api/integrated-results/clear` - Delete integrated results

**Functionality:**
- Automatic CSV to Excel consolidation
- Multi-iteration data tracking
- Frequency sweep data display
- Progress monitoring

---

### 5. Settings Page (SettingsPage.jsx)

**Purpose:** Display system configuration (read-only)

**Configuration Display:**
- Server IP and ports
- WebSocket connection status
- Python executable path
- MATLAB executable path
- System paths (uploads, config, scripts)

**Feature Settings:**
- Links to Antenna Variable Selector
- Links to Ground Plane Configurator
- Links to MATLAB Runner
- Run Setup Wizard button

**Note:** This page displays configuration loaded from `setup_variable.json`. To change settings, run the setup wizard again.

---

### 6. HFSS Process Management

**Detected ANSYS Processes:**
- ansysedt.exe: ANSYS Electronics Desktop
- anshfss.exe: HFSS Solver
- ansysli_server.exe: License Server
- ansysacad.exe: Academic Version
- maxwell.exe, q3d.exe: Other ANSYS solvers

**Capabilities:**
- Automatic process detection
- Version identification (e.g., v222 = 2022 R2)
- Memory usage monitoring
- Session information tracking
- Coordinated termination with MATLAB

**API Endpoints:**
- `GET /api/processes/details` - Get detailed process information

**Termination Strategy:**
1. Send WM_CLOSE for graceful shutdown
2. Wait 5 seconds for cleanup
3. Force kill if still running
4. Verify termination success
5. Report results

---

### 7. Optimization Data Management

**Python Integration (manage_optimization_data.py):**

**Actions:**
- **backup-only**: Create timestamped backup of Optimization/ folder
- **backup-and-remove**: Backup then delete Optimization/ and F_Model files

**Functionality:**
- Backup optimization folder with timestamp
- Clean optimization data
- Remove F_Model_Element files
- Directory statistics tracking
- JSON output for API integration

**Python Integration (integrated_results_manager.py):**

**Actions:**
- **create**: Initialize integrated Excel file
- **update**: Add new iteration data
- **clear**: Delete integrated results
- **summary**: Get file statistics

**Functionality:**
- CSV file scanning in Optimization/data folder
- Data standardization and consolidation
- Excel file creation (Integrated_Results.xlsx)
- Incremental updates for new iterations
- Summary statistics generation

---

### 8. Utility Functions (app_config.js)

**PathUtils:**
```javascript
// Extract project root directory from file path
PathUtils.getProjectRoot(filePath)
// Example: "C:\\Project\\Main.mlx" → "C:\\Project"

// Get filename from full path
PathUtils.getFileName(filePath)
// Example: "C:\\Project\\Main.mlx" → "Main.mlx"

// Get directory portion only
PathUtils.getDirectory(filePath)
// Example: "C:\\Project\\Main.mlx" → "C:\\Project"

// Normalize path separators
PathUtils.normalize(filePath)
// Converts to platform-specific separators
```

**showAlert:**
```javascript
// Unified alert function for web and mobile
showAlert(title, message, buttons)

// Simple alert
showAlert('Success', 'Operation completed')

// Alert with callback
showAlert('Confirm', 'Proceed with action?', [
  { text: 'Cancel', style: 'cancel' },
  { text: 'OK', onPress: () => handleAction() }
])
```

**Benefits:**
- Cross-platform compatibility (Platform.OS detection)
- Consistent UX across web and mobile
- Automatic button configuration
- Navigation support with callbacks

---

## API Documentation

### Base URL
```
http://YOUR_IP:3001/api
```

### Rate Limiting

All API endpoints are protected by rate limiting:

| Endpoint Type | Limit | Window | Response |
|--------------|-------|--------|----------|
| MATLAB execution | 50 requests | 15 minutes | 429 Too Many Requests |
| File operations | 30 requests | 1 minute | 429 Too Many Requests |
| File uploads | 10 uploads | 10 minutes | 429 Too Many Requests |

**Rate Limit Headers:**
```
RateLimit-Limit: 30
RateLimit-Remaining: 25
RateLimit-Reset: 1704280800
```

**Rate Limit Response:**
```json
{
  "error": "Too many requests from this IP, please try again later"
}
```

### MATLAB Endpoints

#### Check MATLAB Installation
```http
GET /api/matlab/check

Response:
{
  "success": true,
  "matlabPath": "C:\\Program Files\\MATLAB\\R2023b\\bin\\matlab.exe",
  "message": "MATLAB detected"
}
```

#### Run MATLAB Script
```http
POST /api/matlab/run
Content-Type: application/json

Body:
{
  "filePath": "C:\\path\\to\\script.mlx"
}

Response:
{
  "success": true,
  "message": "MATLAB execution started",
  "processId": 12345,
  "timestamp": "2025-01-03T10:30:00.000Z"
}
```

#### Stop MATLAB Execution
```http
POST /api/matlab/stop

Response:
{
  "success": true,
  "terminated": {
    "matlab": [{ "pid": 12345, "success": true }],
    "hfss": { "terminated": [...], "failed": [] }
  },
  "timestamp": "2025-01-03T10:35:00.000Z"
}
```

#### Get Execution Status
```http
GET /api/matlab/status

Response:
{
  "execution": {
    "status": "running",
    "startTime": "2025-01-03T10:30:00.000Z",
    "iterationCount": 15
  },
  "processDetails": {
    "matlab": { "pid": 12345, "memoryMB": 1200 }
  },
  "hfssProcesses": [
    { "type": "ansysedt.exe", "pid": 23456, "memoryMB": 3500 }
  ]
}
```

#### Get Iteration Count
```http
GET /api/matlab/iteration-count?projectPath=C:\\MOEA_D_DE_0923

Response:
{
  "success": true,
  "iterationCount": 25,
  "projectPath": "C:\\MOEA_D_DE_0923"
}
```

---

### Variable Management Endpoints

#### Check File Existence
```http
POST /api/matlab/check-file
Content-Type: application/json

Body:
{
  "filePath": "C:\\MOEA_D_DE_0923\\Function\\HFSS\\F_Model_Element.m"
}

Response:
{
  "exists": true,
  "absolutePath": "C:\\MOEA_D_DE_0923\\Function\\HFSS\\F_Model_Element.m",
  "isFile": true
}
```

#### Apply Variables
```http
POST /api/matlab/apply-variables
Content-Type: application/json

Body:
{
  "variableIds": [1, 2, 3, 8, 9, 10],
  "projectPath": "C:\\MOEA_D_DE_0923\\Main_MOEA_DE.mlx"
}

Response:
{
  "success": true,
  "variablesApplied": 6,
  "message": "F_Model_Element.m generated successfully",
  "filePath": "C:\\MOEA_D_DE_0923\\Function\\HFSS\\F_Model_Element.m",
  "timestamp": "2025-01-03T10:30:00.000Z"
}
```

#### Update Ground Plane
```http
POST /api/matlab/update-ground-plane
Content-Type: application/json

Body:
{
  "projectPath": "C:\\MOEA_D_DE_0923\\Main_MOEA_DE.mlx",
  "Lgx": 50,
  "Lgy": 50,
  "GND_xPos": 25,
  "GND_yPos": 25
}

Response:
{
  "success": true,
  "message": "Ground plane configuration updated",
  "parameters": { "Lgx": 50, "Lgy": 50, "GND_xPos": 25, "GND_yPos": 25 }
}
```

---

### Data Management Endpoints

#### Manage Optimization Folder
```http
POST /api/matlab/manage-optimization-folder
Content-Type: application/json

Body:
{
  "projectPath": "C:\\MOEA_D_DE_0923\\Main_MOEA_DE.mlx",
  "action": "backup-and-remove"
}

Response:
{
  "success": true,
  "action": "backup-and-remove",
  "optimizationExists": true,
  "backupCreated": true,
  "optimizationRemoved": true,
  "fModelRemoved": true,
  "paths": {
    "optimizationPath": "C:\\MOEA_D_DE_0923\\Optimization",
    "backupPath": "C:\\MOEA_D_DE_0923\\Optimization_backup_20250103_103000"
  },
  "stats": {
    "filesBackedUp": 125,
    "sizeBackedUpMB": 45.3
  }
}
```

#### Get Simulation Results
```http
GET /api/simulation/results?projectPath=C:\\MOEA_D_DE_0923

Response:
{
  "success": true,
  "iterations": [
    { "iteration": 1, "S11": -15.3, "AR": 3.2, "Gain": 5.8 },
    { "iteration": 2, "S11": -18.1, "AR": 2.9, "Gain": 6.1 }
  ],
  "summary": {
    "totalIterations": 25,
    "bestS11": -22.5,
    "bestAR": 2.1,
    "bestGain": 7.2
  }
}
```

---

### Integrated Results Endpoints

#### Create Integrated Excel
```http
POST /api/integrated-results/create
Content-Type: application/json

Body:
{
  "projectPath": "C:\\MOEA_D_DE_0923\\Main_MOEA_DE.mlx"
}

Response:
{
  "success": true,
  "message": "Integrated Excel file created",
  "filePath": "C:\\MOEA_D_DE_0923\\Optimization\\Integrated_Results.xlsx"
}
```

#### Update Integrated Excel
```http
POST /api/integrated-results/update
Content-Type: application/json

Body:
{
  "projectPath": "C:\\MOEA_D_DE_0923\\Main_MOEA_DE.mlx",
  "iteration": 25
}

Response:
{
  "success": true,
  "message": "Integrated Excel updated with iteration 25",
  "totalIterations": 25
}
```

#### Read Integrated Excel
```http
POST /api/integrated-results/read
Content-Type: application/json

Body:
{
  "projectPath": "C:\\MOEA_D_DE_0923\\Main_MOEA_DE.mlx"
}

Response:
{
  "success": true,
  "exists": true,
  "sheets": {
    "S11": { "rows": 25, "columns": 10 },
    "AR": { "rows": 25, "columns": 10 },
    "Gain": { "rows": 25, "columns": 10 }
  },
  "totalIterations": 25
}
```

#### Clear Integrated Excel
```http
POST /api/integrated-results/clear
Content-Type: application/json

Body:
{
  "projectPath": "C:\\MOEA_D_DE_0923\\Main_MOEA_DE.mlx"
}

Response:
{
  "success": true,
  "message": "Integrated Excel file deleted"
}
```

---

### Process Information Endpoint

#### Get Process Details
```http
GET /api/processes/details

Response:
{
  "summary": {
    "totalMatlab": 1,
    "totalHfss": 2
  },
  "matlab": {
    "total": 1,
    "processes": [
      {
        "pid": 12345,
        "memoryMB": 1200,
        "startTime": "2025-01-03T10:30:00.000Z"
      }
    ]
  },
  "hfss": {
    "total": 2,
    "byType": {
      "ansysedt.exe": 1,
      "anshfss.exe": 1
    },
    "processes": [
      {
        "type": "ansysedt.exe",
        "pid": 23456,
        "version": "v222",
        "memoryMB": 3500
      },
      {
        "type": "anshfss.exe",
        "pid": 34567,
        "memoryMB": 2800
      }
    ]
  }
}
```

---

## WebSocket Communication

### Connection URL
```
ws://YOUR_IP:3001/ws
```

### Message Types

#### Status Update
```json
{
  "type": "status",
  "status": "running",
  "timestamp": "2025-01-03T10:30:00.000Z"
}
```

**Status values:**
- `idle`: No execution running
- `running`: MATLAB executing
- `stopping`: Termination in progress
- `error`: Execution error occurred

#### Iteration Update
```json
{
  "type": "iterations",
  "count": 15,
  "timestamp": "2025-01-03T10:35:00.000Z"
}
```

#### Process Update
```json
{
  "type": "processes",
  "matlab": { "pid": 12345, "memoryMB": 1200 },
  "hfss": [
    { "type": "ansysedt.exe", "pid": 23456, "memoryMB": 3500 }
  ],
  "timestamp": "2025-01-03T10:36:00.000Z"
}
```

#### Connection Status
```json
{
  "type": "connection",
  "connected": true,
  "clientId": "client-abc123",
  "timestamp": "2025-01-03T10:30:00.000Z"
}
```

### Client Implementation

**React Native Example:**
```javascript
const ws = new WebSocket('ws://192.168.3.72:3001/ws');

ws.onopen = () => {
  console.log('WebSocket connected');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch(data.type) {
    case 'status':
      setExecutionStatus(data.status);
      break;
    case 'iterations':
      setIterationCount(data.count);
      break;
    case 'processes':
      setProcessDetails(data);
      break;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('WebSocket disconnected');
  // Implement reconnection logic
};
```

### Reconnection Strategy

```javascript
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
const baseDelay = 1000;

function reconnect() {
  if (reconnectAttempts < maxReconnectAttempts) {
    const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts), 30000);
    
    setTimeout(() => {
      reconnectAttempts++;
      connectWebSocket();
    }, delay);
  }
}

function connectWebSocket() {
  const ws = new WebSocket(websocketUrl);
  
  ws.onopen = () => {
    reconnectAttempts = 0; // Reset on successful connection
  };
  
  ws.onclose = () => {
    reconnect();
  };
}
```

---

## Performance Metrics

### WebSocket vs HTTP Polling Comparison

| Metric | WebSocket | HTTP Polling |
|--------|-----------|--------------|
| **Average Latency** | <100ms | 1-5 seconds |
| **TIME_WAIT Connections** | 0 | 50-200+ |
| **Server CPU Load** | 2-5% | 15-30% |
| **Battery Impact (Mobile)** | Low (1-2%/hr) | High (5-10%/hr) |
| **Messages/Second** | 100+ | 10-20 |
| **Scalability** | Excellent | Poor |
| **Network Efficiency** | 95%+ | 60-70% |

### Execution Performance

**MATLAB Launch Times:**
- Cold start: 8-15 seconds
- Warm start: 3-5 seconds

**Optimization Iteration:**
- Simple models: 30-40 seconds/iteration
- Complex models: 60-120 seconds/iteration

**Complete Optimization Run (50 iterations):**
- Minimum: 25 minutes
- Typical: 42 minutes
- Maximum: 100 minutes

### Memory Requirements

**Application:**
- React Native App: 150-200 MB
- Node.js Server: 80-120 MB

**MATLAB & HFSS:**
- MATLAB: 1100-1900 MB
- HFSS: 2500-4800 MB

**Recommended System:**
- RAM: 16 GB (minimum 8 GB)
- CPU: 4+ cores
- Storage: 50 GB+ free space

---

## Advanced Configuration

### Configuration File Structure

**Location:** `OPEN_THIS/SETUP/setup_variable.json`

```json
{
  "YOUR_IP_ADDRESS": "192.168.3.72",
  "EXPO_PORT": "8081",
  "MATLAB_PATH": "C:\\Program Files\\MATLAB\\R2023b\\bin\\matlab.exe",
  "PYTHON_PATH": "C:\\Python313\\python.exe",
  "SERVER_PORT": 3001,
  
  "matlab": {
    "executable": "C:\\Program Files\\MATLAB\\R2023b\\bin\\matlab.exe",
    "version": "R2023b"
  },
  
  "python": {
    "executable": "C:\\Python313\\python.exe"
  },
  
  "server": {
    "host": "192.168.3.72",
    "port": 3001,
    "websocket": {
      "path": "/ws",
      "port": 3001
    }
  },
  
  "network": {
    "subnet": "192.168.3.x",
    "fallback_urls": [
      "http://192.168.3.72:3001",
      "http://localhost:3001"
    ]
  },
  
  "paths": {
    "project_root": "C:\\Coding_Environment\\fyp_project_current",
    "uploads_dir": "C:\\Coding_Environment\\fyp_project_current\\uploads",
    "config_dir": "C:\\Coding_Environment\\fyp_project_current\\config"
  }
}
```

### Variable Configuration

**Location:** `config/antenna_variables.json`

**Structure:**
```json
{
  "metadata": {
    "version": "1.1.0",
    "total_variables": 78,
    "ground_plane_variables": 4,
    "material_variables": 1
  },
  "variables": [
    {
      "id": 1,
      "name": "xmatch",
      "display_name": "xmatch (purple)",
      "description": "Impedance matching parameter",
      "multiplier": 0.545,
      "offset": 0.77,
      "precision": 3,
      "formula": "0.545*seed(1)+0.77",
      "range": "[0.225, 1.315]",
      "category": "standard",
      "units": "mm"
    }
  ]
}
```

**Variable Categories:**
- `standard`: Design parameters (73 variables)
- `ground_plane`: Ground plane config (4 variables, IDs 83-86)
- `material`: Material properties (1 variable, ID 87)

**Variable ID to Seed Mapping:**
```
Input:  Variable IDs [1, 2, 3, 8, 9, 10]  (gaps allowed)
Output: MATLAB seeds [1, 2, 3, 4, 5, 6]  (sequential)
```

---

## Security & Performance

### Security Features

**Path Validation:**
- `validatePath()` helper prevents directory traversal attacks
- Blocks `../` patterns and access to system directories
- Applied to all endpoints accepting file paths
- Returns 400 Bad Request for invalid paths

**Error Sanitization:**
- `sanitizeError()` helper removes internal system details from error responses
- Strips file paths, stack traces, and sensitive information
- Applied to critical API endpoints
- Prevents information disclosure vulnerabilities

**API Rate Limiting:**
- Three-tier rate limiting system:
  - **Strict**: 50 requests/15min for MATLAB execution
  - **Moderate**: 30 requests/min for file operations
  - **Upload**: 10 uploads/10min for file uploads
- Returns `429 Too Many Requests` when limits exceeded
- Protects against abuse and DoS attacks
- Applied to endpoints: `/api/matlab/apply-variables`, `/api/matlab/update-ground-plane`, `/api/matlab/generate-gnd-import`, `/api/gnd/upload`

**Alert Standardization:**
- Unified `showAlert()` utility for consistent user experience
- Cross-platform compatibility (web/mobile)
- Centralized in `app/app_config.js`
- 37 alert instances standardized across 3 components

### Performance Optimizations

**Async File Operations:**
- Converted synchronous file operations to async (`fs.promises`)
- Prevents event loop blocking on large file operations
- Applied to:
  - Configuration file reading (`/api/variables`)
  - F_Model_Element.m read/write operations
  - Ground plane parameter updates
- Improved server responsiveness under load

**WebSocket Efficiency:**
- Persistent connections eliminate TIME_WAIT accumulation
- <100ms average latency vs 1-5s HTTP polling
- 95%+ network efficiency
- Reduced battery impact on mobile (1-2% vs 5-10%/hr)

**Connection Management:**
- Aggressive connection pooling
- Automatic reconnection with exponential backoff
- Memory leak prevention with proper cleanup
- Event handler nullification on unmount

---

## Troubleshooting Guide

### Installation Issues

**Problem:** Setup wizard can't detect MATLAB
```
Solution:
1. Run manual setup: node OPEN_THIS/SETUP/quick_setup.js --manual
2. Provide full path: C:\Program Files\MATLAB\R2023b\bin\matlab.exe
3. Verify MATLAB installed in standard location
4. Check supported versions: R2022a - R2024b
```

**Problem:** Python library installation fails
```
Solution:
1. cd OPEN_THIS/SETUP
2. pip install -r requirements.txt
3. If pip not found: python -m pip install -r requirements.txt
4. Verify Python 3.8+ installed
```

**Problem:** Port 3001 already in use
```
Solution:
1. Check running processes: netstat -an | findstr :3001
2. Kill existing server: npm run kill-server
3. Or edit setup_variable.json to change port
4. Restart server
```

---

### Connection Issues

**Problem:** Frontend can't connect to server
```
Solution:
1. Verify server running: http://YOUR_IP:3001/api/matlab/check
2. Check firewall allows port 3001
3. Ensure devices on same network (same subnet)
4. Try localhost fallback: http://localhost:3001
5. Check server console for errors
```

**Problem:** WebSocket connection fails
```
Solution:
1. Verify WebSocket URL: ws://YOUR_IP:3001/ws
2. Check browser console for errors
3. Disable VPN/proxy temporarily
4. Test with wscat: wscat -c ws://localhost:3001/ws
5. Check network stability
```

**Problem:** Mobile app can't find server
```
Solution:
1. Ensure device on same WiFi network
2. Check IP address matches: ipconfig (Windows) / ifconfig (Mac/Linux)
3. Try multiple fallback URLs in app
4. Disable mobile data, use WiFi only
5. Check router AP isolation settings
```

---

### Execution Issues

**Problem:** MATLAB won't start
```
Solution:
1. Check MATLAB path in setup_variable.json
2. Verify MATLAB license active
3. Close any existing MATLAB instances
4. Check Windows Task Manager for MATLAB.exe
5. Try manual launch: "C:\Program Files\MATLAB\R2023b\bin\matlab.exe"
```

**Problem:** HFSS won't launch
```
Solution:
1. Verify HFSS/Ansys Electronics Desktop installed
2. Check HFSS license server running
3. Look for ansysedt.exe in Task Manager
4. Review MATLAB script for HFSS initialization code
5. Check HFSS project file path valid
```

**Problem:** Execution stuck/frozen
```
Solution:
1. Wait 30 seconds (MATLAB/HFSS may be initializing)
2. Check Task Manager for CPU activity
3. Click "Stop Execution" in app
4. If no response, manually kill processes:
   - taskkill /F /IM MATLAB.exe
   - taskkill /F /IM ansysedt.exe
5. Restart server and try again
```

---

### File System Issues

**Problem:** F_Model_Element.m not found
```
Solution:
1. Verify project structure: Function/HFSS/ folder exists
2. Generate file via Antenna Variable Selector
3. Check file permissions (not read-only)
4. Ensure Python script executed successfully
5. Review server logs for errors
```

**Problem:** Optimization data missing
```
Solution:
1. Check Optimization/ folder exists in project
2. Verify MATLAB script creates output files
3. Look for CSV files in Optimization/data/
4. Check disk space available
5. Review MATLAB script for data save commands
```

**Problem:** Permission denied errors
```
Solution:
1. Run as Administrator (Windows)
2. Check file/folder not read-only
3. Close files if open in MATLAB/Excel
4. Verify user has write permissions
5. Check antivirus not blocking
```

---

### Data Processing Issues

**Problem:** Integrated Excel not updating
```
Solution:
1. Check CSV files in Optimization/data/
2. Verify Python script runs: Check server logs
3. Manually run: python scripts/integrated_results_manager.py update --project-path "C:\path"
4. Check openpyxl installed: pip show openpyxl
5. Delete old Excel file and recreate
```

**Problem:** Python script errors
```
Solution:
1. Check Python version: python --version (need 3.8+)
2. Verify dependencies: pip install -r OPEN_THIS/SETUP/requirements.txt
3. Check file encoding (UTF-8)
4. Review script logs in server console
5. Test script manually with example data
```

---

### Performance Issues

**Problem:** Slow execution (>2 min/iteration)
```
Causes & Solutions:
1. Complex geometry: Simplify mesh in HFSS
2. High frequency range: Reduce sweep points
3. Insufficient RAM: Close other applications
4. CPU throttling: Check power settings
5. Disk I/O: Use SSD instead of HDD
```

**Problem:** High memory usage
```
Solution:
1. Close unnecessary applications
2. Reduce HFSS mesh density
3. Limit parallel HFSS processes
4. Increase system RAM to 16 GB+
5. Monitor with Task Manager
```

**Problem:** Network lag/delays
```
Solution:
1. Use wired Ethernet instead of WiFi
2. Close bandwidth-heavy applications
3. Check router QoS settings
4. Reduce WebSocket message frequency
5. Use localhost when possible
```

---

## Development Notes

### Adding New Variables

1. Edit `config/antenna_variables.json`:
```json
{
  "id": 88,
  "name": "newVariable",
  "display_name": "New Variable",
  "description": "Description here",
  "multiplier": 1.0,
  "offset": 0.0,
  "precision": 2,
  "formula": "1.0*seed(88)+0.0",
  "range": "[0, 10]",
  "category": "standard",
  "units": "mm"
}
```

2. Update metadata:
```json
"total_variables": 79
```

3. System automatically handles new variable via ID-based lookup

### Modifying API Endpoints

**Location:** `server/matlab-server.js`

**Example - Add new endpoint:**
```javascript
app.post('/api/custom/endpoint', async (req, res) => {
  try {
    const { param1, param2 } = req.body;
    
    // Your logic here
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

### Extending Python Scripts

**Location:** `scripts/`

**Example - Create new utility:**
```python
#!/usr/bin/env python3
"""
New utility script description
"""
import sys
import os
from variable_config_loader import VariableConfig

def main():
    config = VariableConfig()
    variables = config.get_all_variables()
    
    # Your logic here
    
    print(f"Processed {len(variables)} variables")

if __name__ == "__main__":
    main()
```

---

## Version History

**v1.2.0** (2026-01-07)
- Added security improvements:
  - Path validation to prevent traversal attacks
  - Error sanitization to hide internal details
  - API rate limiting (3-tier system)
- Performance optimizations:
  - Converted sync file operations to async
  - Improved WebSocket memory management
  - Fixed race conditions in Excel updates
- Code quality improvements:
  - Unified alert system (showAlert utility)
  - PathUtils helper functions
  - Consistent error handling
- 10 commits with systematic fixes

**v1.1.0** (2025-01-03)
- Removed 5 variables (H1, H2, Hg, Rg, Rf)
- Reorganized server files into server/ folder
- Updated documentation
- Fixed Python script paths

**v1.0.0** (2025-10-08)
- Initial release
- 83-variable optimization system
- WebSocket real-time monitoring
- Cross-platform support
- MATLAB-HFSS integration

---

**For quick start guide, see [README.md](README.md)**
