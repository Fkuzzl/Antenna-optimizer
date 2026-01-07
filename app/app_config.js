// Configuration loader for React Native app
// This file automatically loads configuration from OPEN_THIS/SETUP/setup_variable.json
// 
// ⚠️ IMPORTANT: To change server IP, port, or other settings:
//    Edit: OPEN_THIS/SETUP/setup_variable.json (ONE FILE FOR ALL CONFIGURATION)
//    This file will automatically read those values.

import { Alert, Platform } from 'react-native';
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
 * Unified alert utility for consistent alerts across web and mobile
 * Replaces window.alert on web with proper Alert.alert for better UX
 * @param {string} title - Alert title
 * @param {string} message - Alert message
 * @param {Array} buttons - Array of button objects with text and onPress (optional)
 */
export const showAlert = (title, message, buttons = [{ text: 'OK' }]) => {
  if (Platform.OS === 'web') {
    // For web, construct a formatted message
    const fullMessage = `${title}\n\n${message}`;
    
    // If we have multiple buttons or a cancel button, use confirm()
    if (buttons.length > 1 || buttons.some(b => b.style === 'cancel')) {
      const confirmed = window.confirm(fullMessage);
      
      // Find and call the appropriate button handler
      if (confirmed) {
        const okButton = buttons.find(b => b.style !== 'cancel') || buttons[0];
        if (okButton.onPress) okButton.onPress();
      } else {
        const cancelButton = buttons.find(b => b.style === 'cancel');
        if (cancelButton && cancelButton.onPress) cancelButton.onPress();
      }
    } else {
      // Simple alert with OK button
      window.alert(fullMessage);
      if (buttons[0].onPress) buttons[0].onPress();
    }
  } else {
    // Use native Alert for mobile platforms
    Alert.alert(title, message, buttons);
  }
};

export default AppConfig;

