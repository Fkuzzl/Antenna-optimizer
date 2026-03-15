// Configuration loader for React Native app
// This file loads baseline configuration from OPEN_THIS/SETUP/setup_variable.json
// 
// ⚠️ IMPORTANT:
// - Desktop EXE users should use the in-app Setup Wizard to configure paths.
// - Source/dev users can still run OPEN_THIS/run_setup.bat or npm run setup.

import { Alert, Platform } from 'react-native';
import setupVariableConfig from '../OPEN_THIS/SETUP/setup_variable.json';

// Load configuration from the centralized setup file
const config = setupVariableConfig;
const hasWindow = typeof window !== 'undefined';
const isElectronDesktop = hasWindow && !!window.desktopEnv?.isElectron;
const isBrowserRuntime = hasWindow && !isElectronDesktop;

const resolvedServerHost = (() => {
  if (isElectronDesktop) {
    return '127.0.0.1';
  }

  if (isBrowserRuntime) {
    const runtimeHost = String(window.location?.hostname || '').trim();
    if (runtimeHost) {
      return runtimeHost;
    }
  }

  return config.server.host;
})();

const resolvedServerPort = (() => {
  if (isElectronDesktop && hasWindow) {
    const runtimePort = Number(window.location?.port || 0);
    if (Number.isInteger(runtimePort) && runtimePort > 0) {
      return runtimePort;
    }
  }

  if (isBrowserRuntime && hasWindow) {
    const runtimePort = Number(window.location?.port || 0);
    if (Number.isInteger(runtimePort) && runtimePort > 0) {
      return runtimePort;
    }
  }

  return config.server.port || 3001;
})();

const resolvedWebSocketProtocol = (() => {
  if (hasWindow && String(window.location?.protocol || '').toLowerCase() === 'https:') {
    return 'wss';
  }
  return 'ws';
})();

const AppConfig = {
  // Server configuration - loaded from setup_variable.json
  server: {
    host: resolvedServerHost,
    port: resolvedServerPort,
    subnet: config.network.subnet || '192.168.3.x',  // For display in error messages
  },
  
  // Computed URLs (automatically generated from server config)
  get serverUrl() {
    return `http://${this.server.host}:${this.server.port}`;
  },
  
  get websocketUrl() {
    return `${resolvedWebSocketProtocol}://${this.server.host}:${this.server.port}${config.server.websocket.path}`;
  },
  
  // Network configuration - loaded from setup_variable.json
  network: {
    allowedOrigins: config.network.allowed_origins || [
      `http://${resolvedServerHost}:${resolvedServerPort}`,
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
    console.log(`   💡 To change settings in desktop app, use Setup Wizard in Settings`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    source: 'OPEN_THIS/SETUP/setup_variable.json'
  };
};

// Path utility functions to eliminate code duplication
export const PathUtils = {
  /**
   * Extract project root directory from MATLAB file path
   * Handles both Windows (\) and Unix (/) path separators
   * Removes the .mlx or .m filename from the end
   * @param {string} filePath - Full path to MATLAB file
   * @returns {string} - Directory containing the file
   */
  getProjectRoot: (filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return '';
    }
    // Remove filename ending with .mlx or .m (case insensitive)
    return filePath.replace(/[\\\/][^\\\/]*\.mlx?$/i, '');
  },
  
  /**
   * Extract just the filename from a full path
   * @param {string} filePath - Full file path
   * @returns {string} - Filename only
   */
  getFileName: (filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return '';
    }
    // Split by both \ and / separators and return last element
    return filePath.split(/[\\\/]/).pop() || '';
  },
  
  /**
   * Get the directory portion of a path (without filename)
   * Works with both Windows and Unix paths
   * @param {string} filePath - Full file path
   * @returns {string} - Directory path only
   */
  getDirectory: (filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return '';
    }
    const lastBackslash = filePath.lastIndexOf('\\');
    const lastSlash = filePath.lastIndexOf('/');
    const lastSeparator = Math.max(lastBackslash, lastSlash);
    
    if (lastSeparator === -1) {
      return ''; // No directory separator found
    }
    
    return filePath.substring(0, lastSeparator);
  },
  
  /**
   * Normalize path separators to forward slashes (for display)
   * @param {string} filePath - File path with any separators
   * @returns {string} - Path with forward slashes
   */
  normalize: (filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return '';
    }
    return filePath.replace(/\\/g, '/');
  }
};

/**
 * Unified alert utility for consistent alerts across web and mobile.
 * 
 * When the InAppModal system is active (via registerModalHandler), all alerts
 * are routed to the styled in-app modal. Otherwise falls back to native
 * Alert.alert / window.alert for safety.
 * 
 * @param {string} title - Alert title
 * @param {string} message - Alert message
 * @param {Array} buttons - Array of button objects with text and onPress (optional)
 * @param {Object} options - Extra options: { type: 'info'|'success'|'error'|'warning' }
 */

// Global handler — set by ModalProvider at mount time
let _modalHandler = null;

export const registerModalHandler = (handler) => {
  _modalHandler = handler;
};

export const showAlert = (title, message, buttons = [{ text: 'OK' }], options = {}) => {
  // If InAppModal is registered, route everything through it
  if (_modalHandler) {
    _modalHandler(title, message, buttons, options);
    return;
  }

  // Fallback (pre-mount or in tests)
  if (Platform.OS === 'web') {
    const fullMessage = `${title}\n\n${message}`;
    if (buttons.length > 1 || buttons.some(b => b.style === 'cancel')) {
      const confirmed = window.confirm(fullMessage);
      if (confirmed) {
        const okButton = buttons.find(b => b.style !== 'cancel') || buttons[0];
        if (okButton.onPress) okButton.onPress();
      } else {
        const cancelButton = buttons.find(b => b.style === 'cancel');
        if (cancelButton && cancelButton.onPress) cancelButton.onPress();
      }
    } else {
      window.alert(fullMessage);
      if (buttons[0].onPress) buttons[0].onPress();
    }
  } else {
    Alert.alert(title, message, buttons);
  }
};

export default AppConfig;

