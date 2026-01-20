# MATLAB-HFSS Server

Modular Node.js backend for antenna optimization with MATLAB-HFSS integration.

## 🏗️ Architecture

```
server/
├── config/                 # Configuration
│   ├── constants.js       # Server constants and timeouts
│   └── logger.js          # Winston logger setup
├── middleware/            # Express middleware
│   └── validation.js      # Request validation
├── routes/                # API endpoints
│   ├── gnd.js            # GND file upload/processing
│   ├── groundPlane.js    # Ground plane configuration
│   ├── matlab.js         # MATLAB control & execution
│   ├── optimization.js   # Optimization data management
│   ├── results.js        # Results reading & Excel processing
│   └── variables.js      # Variable configuration
├── services/              # Business logic
│   ├── excelReader.js    # Excel operations with retry logic
│   ├── processManager.js # MATLAB process lifecycle
│   └── websocketManager.js # Real-time WebSocket communication
├── utils/                 # Utilities
│   └── helpers.js        # Error handling, validation
├── logs/                  # Server logs (auto-generated)
├── uploads/               # File uploads (GND files)
├── v1_archived/          # Legacy server (archived)
├── server.js             # Main server entry point
└── start-server.js       # Server launcher script
```

## ✨ Features

### Modular Design
- **Separated concerns** - Routes, services, utilities in distinct modules
- **Easy maintenance** - Locate and modify specific functionality quickly
- **Scalable** - Add new features without touching existing code

### Robust Error Handling
- **Standardized responses** - Consistent API response format
- **Sanitized errors** - No sensitive path/system info leakage
- **Proper HTTP codes** - Semantic status codes

### Real-time Communication
- **WebSocket support** - Live MATLAB execution updates
- **Heartbeat monitoring** - Auto-detect disconnected clients
- **Broadcast system** - Push updates to all connected clients

### Process Management
- **MATLAB lifecycle** - Start, stop, monitor execution
- **HFSS detection** - Track Ansys HFSS processes
- **State tracking** - Reliable execution state management

### Advanced Features
- **File upload** - DXF/GND geometry import with validation
- **Excel processing** - Paginated results, incremental updates
- **Optimization management** - Backup/clear optimization data
- **Variable configuration** - Dynamic antenna parameter selection

## 📡 API Endpoints

### MATLAB Operations
- `GET /api/matlab/status` - Get execution status with process details
- `POST /api/matlab/run` - Start MATLAB script execution
- `POST /api/matlab/stop` - Stop MATLAB & HFSS processes
- `GET /api/matlab/check` - Check MATLAB availability
- `POST /api/matlab/check-file` - Verify file existence
- `POST /api/matlab/reset` - Reset execution state
- `GET /api/matlab/iteration-count` - Count optimization iterations
- `POST /api/matlab/apply-variables` - Generate F_Model_Element.m

### Variables & Configuration
- `GET /api/variables` - Get antenna variable configuration
- `POST /api/matlab/update-ground-plane` - Update ground plane parameters
- `POST /api/matlab/generate-gnd-import` - Generate custom GND import

### GND File Management
- `POST /api/gnd/upload` - Upload & parse DXF geometry files
- `POST /api/gnd/validate` - Validate GND file geometry

### Optimization Management
- `POST /api/matlab/manage-optimization-folder` - Backup/clear optimization data

### Results Processing
- `POST /api/integrated-results/read-page` - Read paginated results
- `POST /api/integrated-results/update` - Update Excel from CSV
- `POST /api/integrated-results/create` - Create integrated Excel
- `POST /api/integrated-results/clear` - Clear Excel file
- `POST /api/integrated-results/read` - Read full Excel
- `POST /api/simulation/results` - Load simulation results

### System
- `GET /health` - Health check endpoint
- `GET /api/server/config` - Server configuration info

## 🚀 Quick Start

### Start Server
```bash
# From project root
cd OPEN_THIS
start_application.bat

# Or manually
cd server
node start-server.js
```

### Stop Server
```bash
cd OPEN_THIS
stop_application_server.bat
```

## 🔧 Configuration

Server configuration is centralized in:
- **Setup config**: `OPEN_THIS/SETUP/setup_variable.json`
- **Constants**: `server/config/constants.js`
- **Logger**: `server/config/logger.js`

## 📊 Logging

Logs are written to `server/logs/`:
- `error.log` - Error-level messages
- `combined.log` - All log levels
- **Rotation**: 10MB max size, 5 files kept

## 🔌 WebSocket

WebSocket server runs on same port as HTTP (default: 3001)

**Connection URL**: `ws://localhost:3001`

**Message Types**:
- `status` - MATLAB execution status updates
- `iteration` - New iteration detected
- `heartbeat` - Connection keep-alive

## 🛠️ Development

### Project Dependencies
```bash
npm install
```

**Core Dependencies**:
- `express` - Web framework
- `ws` - WebSocket server
- `winston` - Logging
- `multer` - File uploads
- `xlsx` - Excel processing

### Adding New Routes

1. Create route file in `routes/`
2. Implement endpoint handlers
3. Mount in `server.js`:
   ```javascript
   const newRoutes = require('./routes/newRoutes');
   app.use('/api/new', newRoutes);
   ```

### Code Style
- Use `logger.info()`, `logger.error()` for logging
- Return responses via `createResponse(success, data, message)`
- Validate inputs with middleware
- Sanitize errors before sending to client

## 📁 V1 Legacy Server

The original monolithic server (3200+ lines) has been archived:
- **Location**: `server/v1_archived/matlab-server.js`
- **Status**: Read-only reference
- **Why archived**: Replaced by modular V2 architecture

See `server/v1_archived/README.md` for details.

## 🔐 Security

- **Path validation** - Prevents directory traversal attacks
- **Input sanitization** - All user inputs validated
- **Error sanitization** - No system paths exposed
- **File size limits** - Upload size restrictions
- **CORS configured** - Controlled cross-origin access

## ⚙️ Performance

- **Retry logic** - Excel file lock handling
- **Pagination** - Efficient large dataset handling
- **Connection pooling** - Optimized HTTP keep-alive
- **Process cleanup** - Graceful shutdown
- **WebSocket heartbeat** - Dead connection detection

## 📝 Migration from V1

If upgrading from V1:
1. ✅ All endpoints maintain backward compatibility
2. ✅ Response formats unchanged
3. ✅ No application code changes needed
4. ✅ Start with `node start-server.js` (automatically uses new server)

## 🐛 Troubleshooting

### Server Won't Start
- Check if port 3001 is available
- Verify `setup_variable.json` exists
- Check `logs/error.log` for details

### MATLAB Won't Run
- Ensure MATLAB is in system PATH
- Check MATLAB license
- Verify project path is correct

### WebSocket Connection Failed
- Confirm server is running
- Check firewall allows port 3001
- Verify client uses correct URL

## 📞 Support

For issues or questions:
1. Check `logs/` directory for error details
2. Review documentation in `DOCUMENTATION.md`
3. Reference V1 archived code if needed

---

**Version**: 2.0.0  
**Status**: Production Ready ✅  
**Last Updated**: January 20, 2026
