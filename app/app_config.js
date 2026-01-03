// Configuration loader for React Native app
// This file automatically loads configuration from OPEN_THIS/SETUP/setup_variable.json
// 
// ⚠️ IMPORTANT: To change server IP, port, or other settings:
//    Edit: OPEN_THIS/SETUP/setup_variable.json (ONE FILE FOR ALL CONFIGURATION)
//    This file will automatically read those values.

import setupVariableConfig from '../OPEN_THIS/SETUP/setup_variable.json';

// Load configuration from the centralized setup file
const config = setupVariableConfig;

const AppConfig = {
  // Server configuration - loaded from setup_variable.json
  server: {
    host: config.server.host,
    port: config.server.port,
    subnet: config.network.subnet || '192.168.3.x',  // For display in error messages
  },
  
  // Computed URLs (automatically generated from server config)
  get serverUrl() {
    return `http://${this.server.host}:${this.server.port}`;
  },
  
  get websocketUrl() {
    return `ws://${this.server.host}:${this.server.port}${config.server.websocket.path}`;
  },
  
  // Network configuration - loaded from setup_variable.json
  network: {
    allowedOrigins: config.network.allowed_origins || [
      `http://${config.server.host}:${config.server.port}`,
      'http://localhost:3001',
      'http://127.0.0.1:3001',
    ]
  },
  
  // Performance settings - loaded from setup_variable.json
  performance: {
    cacheTtlMs: config.performance.cache_ttl_ms || 1000,
    websocketHeartbeatMs: config.performance.websocket_heartbeat_ms || 2000,
    statusPollingIntervalMs: config.performance.status_polling_interval_ms || 3000,
  },
  
  // Expo configuration - loaded from setup_variable.json
  expo: {
    port: config.expo.port || 8081,
  },
  
  // Project paths
  paths: {
    projectRoot: config.paths.project_root,
    uploadsDir: config.paths.uploads_dir,
  }
};

// Helper function to validate configuration
export const validateConfig = () => {
  const errors = [];
  
  if (!AppConfig.server.host) {
    errors.push('Server host is not configured in setup_variable.json');
  }
  
  if (!AppConfig.server.port) {
    errors.push('Server port is not configured in setup_variable.json');
  }
  
  if (!config.paths.project_root) {
    errors.push('Project root path is not configured in setup_variable.json');
  }
  
  // Show info message about configuration source
  if (AppConfig.server.host) {
    console.log(`✅ Configuration loaded from setup_variable.json`);
    console.log(`   Server: ${AppConfig.serverUrl}`);
    console.log(`   WebSocket: ${AppConfig.websocketUrl}`);
    console.log(`   💡 To change settings, edit: OPEN_THIS/SETUP/setup_variable.json`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    source: 'OPEN_THIS/SETUP/setup_variable.json'
  };
};

export default AppConfig;

