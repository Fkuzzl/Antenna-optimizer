import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Alert, Platform, Clipboard, Image } from "react-native";
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AntennaVariableSelector from './AntennaVariableSelector';
import SimulationResultsViewer from './SimulationResultsViewer';
import AppConfig, { validateConfig } from './app_config';

export default function MatlabProjectRunner({ onBack }) {
  const [filePath, setFilePath] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTerminating, setIsTerminating] = useState(false);
  const [serverStatus, setServerStatus] = useState('Disconnected');
  const [executionState, setExecutionState] = useState({
    isRunning: false,
    fileName: null,
    startTime: null,
    processId: null
  });
  const [hfssProcesses, setHfssProcesses] = useState([]);
  const [pathHistory, setPathHistory] = useState([]);
  const [showPathHistory, setShowPathHistory] = useState(false);
  const [showQuickGuide, setShowQuickGuide] = useState(false);
  const [showVariableSelector, setShowVariableSelector] = useState(false);
  const [showSimulationResults, setShowSimulationResults] = useState(false);
  
  // Loading panel state
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Initializing...');
  
  // New state for iteration tracking
  const [iterationData, setIterationData] = useState({
    count: 0,
    current: null,
    latestVBScript: null,
    isTracking: false,
    message: null,
    tempDir: null
  });
  
  // New state for project location validation
  const [projectLocationConfirmed, setProjectLocationConfirmed] = useState(false);
  const [isValidatingLocation, setIsValidatingLocation] = useState(false);
  const [locationValidationMessage, setLocationValidationMessage] = useState('');

  // WebSocket connection state
  const [wsConnected, setWsConnected] = useState(false);
  const [wsStatus, setWsStatus] = useState('Disconnected');
  const [connectionStats, setConnectionStats] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const [wsReconnectCount, setWsReconnectCount] = useState(0);

  // Simplified logging state for WebSocket-based updates
  const [lastLoggedData, setLastLoggedData] = useState({
    iteration: { count: -1, current: -1 },
    lastExcelUpdate: { projectDir: '', iteration: -1, timestamp: 0 }
  });

  // Simplified request throttling for fallback HTTP requests only
  const [requestThrottle, setRequestThrottle] = useState({
    lastStatusRequest: 0,
    adaptiveMode: true, // Keep for UI display
    connectionHealth: 100
  });

  // Load server configuration from centralized config
  const MATLAB_SERVER_URL = AppConfig.serverUrl;
  const WS_SERVER_URL = AppConfig.websocketUrl;

  // Validate configuration on mount
  useEffect(() => {
    const configValidation = validateConfig();
    if (!configValidation.valid) {
      console.error('❌ Configuration errors:', configValidation.errors);
      Alert.alert('Configuration Error', 
        'Please update app_config.js with your PC\'s IP address.\n\n' + 
        configValidation.errors.join('\n')
      );
    }
  }, []);

  // WebSocket connection management
  const connectWebSocket = async () => {
    // Stronger guard: prevent duplicate connections
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN || 
          wsRef.current.readyState === WebSocket.CONNECTING) {
        console.log('⚠️ WebSocket already connected or connecting, skipping...');
        return; // Already connected or connecting
      }
    }

    try {
      console.log('🔗 Attempting to connect to WebSocket server...');
      console.log('📍 Server URL:', WS_SERVER_URL);
      setWsStatus('Connecting...');
      setServerStatus('Connecting...');
      
      // Quick server health check before WebSocket connection
      try {
        const healthCheck = await fetch(`${MATLAB_SERVER_URL}/api/matlab/status`, {
          method: 'GET',
          timeout: 3000
        });
        if (!healthCheck.ok) {
          console.warn('⚠️ Server health check failed, but attempting WebSocket anyway...');
        }
      } catch (healthError) {
        console.warn('⚠️ Cannot reach server HTTP endpoint:', healthError.message);
        console.log('🔄 Will retry WebSocket connection...');
      }
      
      wsRef.current = new WebSocket(WS_SERVER_URL);
      
      wsRef.current.onopen = () => {
        console.log('✅ WebSocket connected successfully');
        setWsConnected(true);
        setWsStatus('Connected');
        setServerStatus('Connected');
        setWsReconnectCount(0);
        
        // Fetch current execution state immediately on connection
        fetchCurrentExecutionState();
        
        // Subscribe to all event types with small delay to ensure connection is ready
        setTimeout(() => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            try {
              wsRef.current.send(JSON.stringify({
                type: 'subscribe',
                topics: ['status', 'iterations', 'connection_stats']
              }));
              console.log('📡 WebSocket subscription sent successfully');
            } catch (error) {
              console.error('❌ Failed to send WebSocket subscription:', error);
            }
          }
        }, 100); // 100ms delay
      };
      
      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (error) {
          console.error('❌ WebSocket message parse error:', error);
        }
      };
      
      wsRef.current.onerror = (error) => {
        // Enhanced error logging with more context
        console.error('❌ WebSocket error occurred');
        console.error('Error type:', error?.type || 'unknown');
        console.error('Error message:', error?.message || 'No message available');
        console.error('WebSocket URL:', WS_SERVER_URL);
        console.error('WebSocket state:', wsRef.current?.readyState);
        
        // Map WebSocket readyState to human-readable status
        const stateMap = {
          0: 'CONNECTING',
          1: 'OPEN', 
          2: 'CLOSING',
          3: 'CLOSED'
        };
        const currentState = stateMap[wsRef.current?.readyState] || 'UNKNOWN';
        console.error('WebSocket status:', currentState);
        
        setWsStatus('Error - Reconnecting...');
        setServerStatus('Connection Error');
        setWsConnected(false);
      };
      
      wsRef.current.onclose = (event) => {
        console.log('🔌 WebSocket connection closed:', event.code, event.reason);
        setWsConnected(false);
        setWsStatus('Disconnected');
        setServerStatus('Disconnected');
        
        // Auto-reconnect with exponential backoff
        if (wsReconnectCount < 10) { // Limit reconnect attempts
          const delay = Math.min(1000 * Math.pow(2, wsReconnectCount), 30000); // Max 30 seconds
          setWsReconnectCount(prev => prev + 1);
          
          console.log(`🔄 WebSocket reconnecting in ${delay}ms (attempt ${wsReconnectCount + 1})`);
          setWsStatus('Connecting...');
          setServerStatus('Connecting...');
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, delay);
        } else {
          setWsStatus('Disconnected');
          setServerStatus('Disconnected');
        }
      };
      
    } catch (error) {
      console.error('❌ WebSocket connection failed');
      console.error('Error name:', error?.name || 'Unknown');
      console.error('Error message:', error?.message || 'No message');
      console.error('Error code:', error?.code || 'No code');
      console.error('Server URL:', WS_SERVER_URL);
      console.error('HTTP Server:', MATLAB_SERVER_URL);
      
      setWsStatus('Failed - Retrying...');
      setServerStatus('Connection Failed');
      setWsConnected(false);
      
      // Trigger auto-reconnect on connection failure
      if (wsReconnectCount < 10) {
        const delay = Math.min(2000 * Math.pow(1.5, wsReconnectCount), 30000);
        setWsReconnectCount(prev => prev + 1);
        
        console.log(`🔄 Retrying connection in ${delay}ms (attempt ${wsReconnectCount + 1}/10)`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, delay);
      } else {
        console.error('❌ Max reconnection attempts reached. Please check:');
        console.error('   1. Server is running: npm run server');
        console.error('   2. Server IP is correct: ' + MATLAB_SERVER_URL);
        console.error('   3. Firewall allows connections on port 3001');
        console.error('   4. Mobile device on same network as server');
        setWsStatus('Disconnected');
        setServerStatus('Max Retries Reached');
      }
    }
  };

  // Handle incoming WebSocket messages
  const handleWebSocketMessage = (data) => {
    console.log(`📨 WebSocket message: ${data.type}`);
    
    switch (data.type) {
      case 'pong':
        // Handle ping response
        break;
        
      case 'status':
        // Update status from WebSocket instead of polling
        if (data.data && data.data.success) {
          updateStatusFromData(data.data);
        }
        break;
        
      case 'iterations':
        // Update iterations from WebSocket instead of polling
        if (data.data && data.data.success) {
          updateIterationsFromData(data.data);
        }
        break;
        
      case 'connection_stats':
        // Update connection statistics
        setConnectionStats(data.data);
        break;
        
      default:
        console.log(`❓ Unknown WebSocket message type: ${data.type}`);
    }
  };

  // Disconnect WebSocket
  const disconnectWebSocket = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setWsConnected(false);
    setWsStatus('Disconnected');
    setServerStatus('Disconnected');
  };

  // Network diagnostics helper
  const checkNetworkConnectivity = async () => {
    console.log('🔍 Running network diagnostics...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Check 1: Server URL configuration
    console.log('📍 Configuration Check:');
    console.log('   HTTP Server:', MATLAB_SERVER_URL);
    console.log('   WebSocket Server:', WS_SERVER_URL);
    
    // Check 2: HTTP endpoint connectivity
    console.log('\n🌐 Testing HTTP connectivity...');
    try {
      const startTime = Date.now();
      const response = await fetch(`${MATLAB_SERVER_URL}/api/matlab/status`, {
        method: 'GET',
        timeout: 5000
      });
      const endTime = Date.now();
      
      if (response.ok) {
        console.log(`   ✅ HTTP Connected (${endTime - startTime}ms)`);
        const data = await response.json();
        console.log('   ✅ Server responding correctly');
      } else {
        console.log(`   ⚠️ HTTP Status: ${response.status}`);
      }
    } catch (error) {
      console.log('   ❌ HTTP Connection Failed:', error.message);
      console.log('   💡 Check: Is server running? (npm run server)');
      console.log('   💡 Check: Is IP address correct?');
    }
    
    // Check 3: WebSocket state
    console.log('\n🔌 WebSocket Status:');
    if (wsRef.current) {
      const stateMap = {
        0: 'CONNECTING',
        1: 'OPEN',
        2: 'CLOSING',
        3: 'CLOSED'
      };
      console.log('   State:', stateMap[wsRef.current.readyState]);
      console.log('   Connected:', wsConnected);
      console.log('   Reconnect Count:', wsReconnectCount);
    } else {
      console.log('   ⚠️ No WebSocket instance');
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    Alert.alert(
      'Network Diagnostics',
      `Check console logs for detailed results.\n\nQuick Status:\nHTTP: ${wsConnected ? '✅' : '❌'}\nWebSocket: ${wsConnected ? '✅ Connected' : '❌ Disconnected'}`,
      [{ text: 'OK' }]
    );
  };

  // Optimized fetch configuration with aggressive connection management
  const createFetchConfig = (options = {}) => {
    const isPollingRequest = options.isPolling || false;
    
    return {
      headers: {
        'Content-Type': 'application/json',
        // Use different connection strategies for polling vs regular requests
        'Connection': isPollingRequest ? 'close' : 'keep-alive',
        'Keep-Alive': 'timeout=2, max=5', // Shorter timeout, fewer requests
        ...options.headers
      },
      ...options
    };
  };

  // Load path history from storage
  const loadPathHistory = async () => {
    try {
      const savedPaths = await AsyncStorage.getItem('matlabPathHistory');
      if (savedPaths) {
        setPathHistory(JSON.parse(savedPaths));
      } else {
        // Preload with default valid paths if no history exists
        const defaultPaths = [
          'C:\\ANSYS_electronic_FYP\\MOEA_D_DE_0923\\Main_run_this_3obj.mlx',
          'C:\\ANSYS_electronic_FYP\\MOEA_D_DE_0923\\antenna_optimization.mlx',
          'C:\\Projects\\MATLAB\\filter_design.mlx'
        ];
        setPathHistory(defaultPaths);
        setFilePath('C:\\ANSYS_electronic_FYP\\MOEA_D_DE_0923\\Main_run_this_3obj.mlx'); // Set default path
        await AsyncStorage.setItem('matlabPathHistory', JSON.stringify(defaultPaths));
      }
    } catch (error) {
      console.error('Error loading path history:', error);
      // Fallback to default path if storage fails
      const defaultPaths = [
        'C:\\ANSYS_electronic_FYP\\MOEA_D_DE_0923\\Main_run_this_3obj.mlx',
        'C:\\ANSYS_electronic_FYP\\MOEA_D_DE_0923\\antenna_optimization.mlx',
        'C:\\Projects\\MATLAB\\filter_design.mlx'
      ];
      setPathHistory(defaultPaths);
      setFilePath('C:\\ANSYS_electronic_FYP\\MOEA_D_DE_0923\\Main_run_this_3obj.mlx'); // Set default path
    }
  };

  // Save valid path to history
  const savePathToHistory = async (path) => {
    try {
      const updatedHistory = [path, ...pathHistory.filter(p => p !== path)].slice(0, 10); // Keep last 10 paths
      setPathHistory(updatedHistory);
      await AsyncStorage.setItem('matlabPathHistory', JSON.stringify(updatedHistory));
    } catch (error) {
      console.error('Error saving path history:', error);
    }
  };

  // Clear path history
  const clearPathHistory = async () => {
    try {
      setPathHistory([]);
      await AsyncStorage.removeItem('matlabPathHistory');
      Alert.alert('Cleared', 'Path history cleared');
    } catch (error) {
      console.error('Error clearing path history:', error);
    }
  };

  // Validate project location
  const validateProjectLocation = async () => {
    if (!filePath.trim()) {
      Alert.alert('Invalid Path', 'Please enter a project path');
      return;
    }

    setIsValidatingLocation(true);
    setLocationValidationMessage('Validating project location...');

    try {
      // Simple validation - check if path looks like a valid MATLAB file
      const validExtensions = ['.mlx', '.m'];
      const hasValidExtension = validExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
      
      if (!hasValidExtension) {
        setLocationValidationMessage('❌ Invalid file type. Please select a .mlx or .m file');
        setIsValidatingLocation(false);
        return;
      }

      // Additional validation - check if path looks realistic
      const isWindowsPath = filePath.includes(':\\') || filePath.includes('C:');
      const isLinuxPath = filePath.startsWith('/');
      
      if (!isWindowsPath && !isLinuxPath) {
        setLocationValidationMessage('❌ Path format not recognized. Please use full path');
        setIsValidatingLocation(false);
        return;
      }

      // Simulate validation delay
      await new Promise(resolve => setTimeout(resolve, 1500));

      // For now, accept the path as valid (in real scenario, you might check file system)
      setProjectLocationConfirmed(true);
      setLocationValidationMessage('✅ Project location validated successfully');
      await savePathToHistory(filePath);
      
      // Create/update integrated Excel file after path validation
      await createIntegratedExcel();
      
      const fileName = filePath.split('\\').pop() || filePath.split('/').pop();
      const fileType = filePath.toLowerCase().endsWith('.mlx') ? 'MATLAB Live Script' : 'MATLAB Script';
      
      Alert.alert(
        'Location Confirmed', 
        `Project validated successfully!\n\nFile: ${fileName}\nType: ${fileType}\n\n📊 Integrated results cache initialized.\nReady to launch.`
      );

    } catch (error) {
      console.error('Error validating location:', error);
      setLocationValidationMessage('❌ Validation failed');
    }
    
    setIsValidatingLocation(false);
  };

  // Reset project location (allow user to change location)
  const resetProjectLocation = () => {
    // Prevent changing location while project is running
    if (executionState.isRunning) {
      Alert.alert(
        'Cannot Change Location',
        'Please stop the running project before changing the location.',
        [{ text: 'OK' }]
      );
      return;
    }
    setProjectLocationConfirmed(false);
    setLocationValidationMessage('');
  };

  // Generate new F_Model_Element.mlx with selected variables (simplified)
  const generateFModelElement = async (selectedVariableIds) => {
    try {
      const response = await fetch(`${MATLAB_SERVER_URL}/api/matlab/apply-variables`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          variableIds: selectedVariableIds
        }),
      });

      const result = await response.json();

      if (result.success) {
        Alert.alert(
          'File Generated',
          `File updated with ${selectedVariableIds.length} variables.\n\nSeed range: ${result.seedRange}`
        );
      } else {
        Alert.alert('Error', result.message || 'Failed to generate file');
      }
    } catch (error) {
      console.error('Error generating F_Model_Element:', error);
      Alert.alert('Connection Error', 'Cannot connect to server');
    }
  };

  // Handle optimization folder management
  const handleOptimizationManagement = async (action) => {
    try {
      setIsLoading(true);
      
      const response = await fetch(`${MATLAB_SERVER_URL}/api/matlab/manage-optimization-folder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectPath: filePath,
          action: action // 'backup-only' or 'backup-and-remove'
        }),
      });

      const result = await response.json();

      if (result.success) {
        const actionText = action === 'backup-only' ? 'backed up' : 'backed up and removed';
        const statsText = result.optimizationExists && result.stats && result.stats.optimization
          ? `\n\n📊 Statistics:\n• Files: ${result.stats.optimization.fileCount || 0}\n• Size: ${((result.stats.optimization.totalSize || 0) / 1024 / 1024).toFixed(2)} MB`
          : '';
        const backupText = result.paths && result.paths.backupPath 
          ? `\n• Backup location: ${result.paths.backupPath}`
          : '';
        const fModelText = result.fModelBackupCreated 
          ? `\n• F_Model_Element: Backed up`
          : '';
        const detailsText = result.optimizationExists 
          ? `${statsText}${backupText}${fModelText}`
          : '\n\nNo optimization folder was found.';
        
        Alert.alert(
          'Complete',
          `${result.message}${detailsText}`
        );
      } else {
        Alert.alert('Error', result.message || 'Operation failed');
      }
    } catch (error) {
      console.error('Error managing optimization folder:', error);
      Alert.alert('Connection Error', 'Cannot connect to server');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle variable selection confirmation
  const handleVariableSelection = (selectedVariableIds) => {
    setShowVariableSelector(false);
    generateFModelElement(selectedVariableIds);
  };

  // Handle optimization management from AntennaVariableSelector
  // Automatically backup and delete when toggle is enabled
  const handleOptimizationManagementFromSelector = async () => {
    try {
      setIsLoading(true);
      
      const response = await fetch(`${MATLAB_SERVER_URL}/api/matlab/manage-optimization-folder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectPath: filePath,
          action: 'backup-and-remove'
        }),
      });

      const result = await response.json();

      if (result.success) {
        // Clear integrated Excel file when optimization folder is deleted
        try {
          const clearResponse = await fetch(`${MATLAB_SERVER_URL}/api/integrated-results/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectPath: getProjectDirectory(filePath) })
          });

          const clearResult = await clearResponse.json();
          if (clearResult.success) {
            console.log('✅ Integrated Excel file cleared after optimization folder deletion');
          } else {
            console.log('⚠️ Could not clear integrated Excel file:', clearResult.message);
          }
        } catch (clearError) {
          console.error('❌ Error clearing integrated Excel file:', clearError);
        }

        return { success: true, result }; // Return the detailed result
      } else {
        Alert.alert('Error', result.message || 'Operation failed');
        return { success: false };
      }
    } catch (error) {
      console.error('Error in optimization management:', error);
      Alert.alert('Connection Error', 'Cannot connect to server');
      return { success: false };
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch current execution state from server (called on reconnect/refresh)
  const fetchCurrentExecutionState = async () => {
    try {
      console.log('🔄 Fetching current execution state...');
      const response = await fetch(`${MATLAB_SERVER_URL}/api/matlab/status`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        console.warn('⚠️ Failed to fetch execution state');
        return;
      }

      const result = await response.json();
      
      if (result.execution) {
        console.log('✅ Execution state fetched:', result.execution);
        setExecutionState(result.execution);
        
        // If MATLAB is running, restore the file path
        if (result.execution.isRunning && result.execution.filePath) {
          setFilePath(result.execution.filePath);
          setProjectLocationConfirmed(true);
        }
        
        // Handle iteration data based on whether we have a file path
        if (result.execution.isRunning) {
          if (result.execution.filePath) {
            // Fetch iteration data when file path is available
            const iterResponse = await fetch(`${MATLAB_SERVER_URL}/api/matlab/iteration-count?projectPath=${encodeURIComponent(result.execution.filePath)}`, {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' }
            });
            
            if (iterResponse.ok) {
              const iterResult = await iterResponse.json();
              if (iterResult.success) {
                setIterationData({
                  count: iterResult.iterationCount || 0,
                  current: iterResult.currentIteration,
                  latestVBScript: iterResult.latestVBScript,
                  isTracking: true,
                  message: iterResult.message,
                  tempDir: iterResult.tempDir
                });
                console.log('✅ Iteration data fetched:', iterResult.iterationCount, 'iterations');
              }
            } else {
              // If iteration fetch fails but MATLAB is running, set tracking to true
              setIterationData({
                count: 0,
                current: null,
                latestVBScript: null,
                isTracking: true,
                message: 'Detecting iterations...',
                tempDir: null
              });
            }
          } else {
            // MATLAB running but no file path (external start)
            setIterationData({
              count: 0,
              current: null,
              latestVBScript: null,
              isTracking: false,
              message: 'External MATLAB session - project path unknown',
              tempDir: null
            });
            console.log('⚠️ MATLAB running externally - no project path available');
          }
        }
      }

      // Fetch HFSS processes
      if (result.processDetails?.hfss?.processes) {
        setHfssProcesses(result.processDetails.hfss.processes);
      }
    } catch (error) {
      console.error('❌ Error fetching execution state:', error);
    }
  };

  // Helper function to get project directory from file path
  const getProjectDirectory = (filePath) => {
    return filePath.replace(/\\[^\\]*\.mlx?$/, '');
  };

  // Helper function to calculate running time duration
  const calculateRunningTime = (startTime) => {
    if (!startTime) return '00:00:00';
    
    const start = new Date(startTime);
    const now = new Date();
    const diffMs = now - start;
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  // State for running time display (updates every second)
  const [runningTime, setRunningTime] = useState('00:00:00');

  // Effect to update running time every second when MATLAB is running
  useEffect(() => {
    let intervalId = null;
    
    if (executionState.isRunning && executionState.startTime) {
      // Update immediately
      setRunningTime(calculateRunningTime(executionState.startTime));
      
      // Then update every second
      intervalId = setInterval(() => {
        setRunningTime(calculateRunningTime(executionState.startTime));
      }, 1000);
    } else {
      setRunningTime('00:00:00');
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [executionState.isRunning, executionState.startTime]);

  // Create integrated Excel file when project path is validated
  const createIntegratedExcel = async () => {
    if (!filePath) return;

    try {
      const projectDir = getProjectDirectory(filePath);

      const response = await fetch(`${MATLAB_SERVER_URL}/api/integrated-results/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: projectDir })
      });

      const result = await response.json();
      if (result.success) {
        // Only log Excel creation once per project setup
        console.log('📊 Results cache initialized');
      } else {
        console.log('⚠️ Could not initialize results cache:', result.message);
      }
    } catch (error) {
      console.error('❌ Error creating integrated Excel file:', error);
    }
  };

  // Update integrated Excel when new iteration completes
  const updateIntegratedExcel = async (iteration = null) => {
    if (!filePath) return;

    try {
      const projectDir = getProjectDirectory(filePath);
      
      // Check if we should throttle this update (prevent spam for same iteration)
      const shouldUpdate = iteration !== lastLoggedData.lastExcelUpdate.iteration ||
                          projectDir !== lastLoggedData.lastExcelUpdate.projectDir ||
                          (Date.now() - lastLoggedData.lastExcelUpdate.timestamp) > 30000; // 30 second minimum interval

      if (!shouldUpdate) {
        return; // Skip if same iteration was already processed recently
      }

      const response = await fetch(`${MATLAB_SERVER_URL}/api/integrated-results/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          projectPath: projectDir,
          iteration: iteration 
        })
      });

      const result = await response.json();
      if (result.success) {
        // Minimal logging - just show iteration number
        console.log(`📊 Results updated (iteration ${iteration || 'current'})`);
        
        // Update throttle tracking
        setLastLoggedData(prev => ({
          ...prev,
          lastExcelUpdate: {
            projectDir,
            iteration: iteration || -1,
            timestamp: Date.now()
          }
        }));
      } else {
        console.log('⚠️ Results update failed:', result.message);
      }
    } catch (error) {
      console.error('❌ Error updating integrated Excel file:', error);
    }
  };

  // Function to paste from clipboard
  const handlePaste = async () => {
    try {
      let clipboardContent = '';
      
      if (Platform.OS === 'web') {
        // Web clipboard API
        if (navigator.clipboard && navigator.clipboard.readText) {
          clipboardContent = await navigator.clipboard.readText();
        } else {
          // Fallback for older browsers
          Alert.alert('Paste Not Supported', 'Use Ctrl+V to paste');
          return;
        }
      } else {
        // React Native clipboard API for mobile
        clipboardContent = await Clipboard.getString();
      }
      
      if (clipboardContent) {
        setFilePath(clipboardContent);
      } else {
        Alert.alert('Clipboard Empty', 'Nothing to paste');
      }
    } catch (error) {
      console.error('Failed to paste from clipboard:', error);
      if (Platform.OS === 'web') {
        Alert.alert('Paste Error', 'Use Ctrl+V to paste');
      } else {
        Alert.alert('Paste Error', 'Use Ctrl+V to paste');
      }
    }
  };

  // Update status from WebSocket data (replaces HTTP polling)
  const updateStatusFromData = (data) => {
    if (data.execution) {
      const statusChanged = 
        executionState.isRunning !== data.execution.isRunning ||
        executionState.processId !== data.execution.processId ||
        executionState.fileName !== data.execution.fileName;

      console.log('📡 Received status data:', {
        isRunning: data.execution.isRunning,
        fileName: data.execution.fileName,
        statusChanged: statusChanged
      });

      if (statusChanged || true) { // Always update for now to ensure sync
        setExecutionState(data.execution);
        console.log('📡 Status updated via WebSocket:', data.execution.isRunning ? 'Running' : 'Stopped');
      }
    }

    if (data.processDetails) {
      const newHfssProcesses = data.processDetails.hfss?.processes || [];
      if (JSON.stringify(newHfssProcesses) !== JSON.stringify(hfssProcesses)) {
        setHfssProcesses(newHfssProcesses);
      }
    }

    // Server status is handled by WebSocket connection state, not execution status
  };

  // Update iterations from WebSocket data (replaces HTTP polling)
  const updateIterationsFromData = (data) => {
    const newIterationData = {
      count: data.iterationCount || 0,
      current: data.currentIteration,
      latestVBScript: data.latestVBScript,
      isTracking: data.iterationCount > 0,
      message: data.message,
      tempDir: data.tempDir
    };

    // Only update if data actually changed
    if (JSON.stringify(newIterationData) !== JSON.stringify(iterationData)) {
      setIterationData(newIterationData);
      console.log(`📡 Iterations updated via WebSocket: ${data.iterationCount} iterations`);

      // Handle Excel integration for significant iteration updates
      if (data.iterationCount > 0 && data.iterationCount !== lastLoggedData.iteration.count) {
        handleIterationExcelUpdate(data);
      }
    }
  };

  // Handle Excel integration for iteration updates (WebSocket version)
  const handleIterationExcelUpdate = (data) => {
    if (data.iterationCount && data.currentIteration) {
      updateIntegratedExcel(data.currentIteration);
      
      // Update tracking
      setLastLoggedData(prev => ({
        ...prev,
        iteration: {
          count: data.iterationCount,
          current: data.currentIteration
        }
      }));
    }
  };

  // Function to check server connectivity
  const checkServerStatus = async () => {
    try {
      const response = await fetch(`${MATLAB_SERVER_URL}/api/matlab/check`, 
        createFetchConfig({ timeout: 5000 })
      );
      const result = await response.json();
      if (result.success) {
        setServerStatus('Connected');
      } else {
        setServerStatus('Connected');
      }
    } catch (error) {
      setServerStatus('Disconnected');
    }
  };

  useEffect(() => {
    // Initialize the page with loading sequence
    const initializePage = async () => {
      setIsInitialLoading(true);
      setLoadingMessage('Initializing MATLAB Optimizer...');
      
      try {
        // Step 1: Load path history
        setLoadingMessage('Loading project history...');
        await loadPathHistory();
        
        // Step 2: Connect to WebSocket
        setLoadingMessage('Connecting to server...');
        await connectWebSocket();
        
        // Step 3: Wait a bit for WebSocket to establish and fetch state
        setLoadingMessage('Fetching MATLAB status...');
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Loading complete
        setLoadingMessage('Ready!');
        await new Promise(resolve => setTimeout(resolve, 500));
        setIsInitialLoading(false);
      } catch (error) {
        console.error('❌ Initialization error:', error);
        setLoadingMessage('Initialization complete');
        setIsInitialLoading(false);
      }
    };
    
    initializePage();
    
    // Cleanup on unmount
    return () => {
      disconnectWebSocket();
    };
  }, []); // Only run once on mount

  // Separate effect for fallback polling only (NOT for initial connection)
  useEffect(() => {
    // Fallback polling when WebSocket disconnected (limited fallback)
    let fallbackInterval = null;
    if (!wsConnected && wsReconnectCount > 5) {
      console.log('🔄 WebSocket failed, falling back to basic server checks');
      fallbackInterval = setInterval(() => {
        // Only check basic server connectivity as fallback
        checkServerStatus();
      }, 10000); // Much slower polling as fallback (10 seconds)
    }
    
    return () => {
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [wsConnected, wsReconnectCount]);

  const handleRunProject = async () => {
    if (!filePath.trim()) {
      Alert.alert('Error', 'Please enter a file path');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${MATLAB_SERVER_URL}/api/matlab/run`, 
        createFetchConfig({
          method: 'POST',
          body: JSON.stringify({
            filePath: filePath
          }),
        })
      );

      const result = await response.json();

      if (result.success) {
        setExecutionState(result.execution);
        // Initialize iteration tracking
        setIterationData({
          count: 0,
          current: null,
          latestVBScript: null,
          isTracking: true,
          message: 'Starting optimization - waiting for iterations...',
          tempDir: null
        });
        // Save valid path to history
        await savePathToHistory(filePath);
        
        Alert.alert(
          'Started Successfully', 
          `MATLAB is running your project.\n\nMonitor progress in real-time below.`
        );
      } else {
        Alert.alert('Error', result.message);
      }
    } catch (error) {
      console.error('Error running project:', error);
      Alert.alert('Error', 'Cannot start project');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStopMatlab = async () => {
    // Show immediate feedback
    Alert.alert(
      'Stopping Project',
      'Sending shutdown signal to MATLAB...',
      [{ text: 'OK', onPress: () => {} }]
    );
    
    setIsLoading(true);
    setIsTerminating(true);
    
    try {
      const response = await fetch(`${MATLAB_SERVER_URL}/api/matlab/stop`, 
        createFetchConfig({ method: 'POST' })
      );

      const result = await response.json();
      
      if (result.success) {
        // Force update state regardless of server response
        setExecutionState({ 
          isRunning: false, 
          fileName: null, 
          startTime: null, 
          processId: null 
        });
        // Reset iteration tracking
        setIterationData({
          count: 0,
          current: null,
          latestVBScript: null,
          isTracking: false,
          message: null,
          tempDir: null
        });
        Alert.alert(
          'Project Stopped', 
          `${result.message}\n\nMATLAB execution stopped successfully.`
        );
      } else {
        // Even if server says no process running, reset our state
        setExecutionState({ 
          isRunning: false, 
          fileName: null, 
          startTime: null, 
          processId: null 
        });
        setIterationData({
          count: 0,
          current: null,
          latestVBScript: null,
          isTracking: false,
          message: null,
          tempDir: null
        });
        Alert.alert('Already Stopped', result.message);
      }
    } catch (error) {
      console.error('Stop request error:', error);
      // Reset state on error
      setExecutionState({ 
        isRunning: false, 
        fileName: null, 
        startTime: null, 
        processId: null 
      });
      setIterationData({
        count: 0,
        current: null,
        latestVBScript: null,
        isTracking: false,
        message: null,
        tempDir: null
      });
      Alert.alert('Connection Error', 'Cannot connect to server');
    } finally {
      setIsLoading(false);
      setIsTerminating(false);
    }
  };



  // Show variable selector if requested
  if (showVariableSelector) {
    return (
      <AntennaVariableSelector 
        onBack={() => setShowVariableSelector(false)}
        onConfirm={handleVariableSelection}
        projectPath={filePath}
        onOptimizationManagement={handleOptimizationManagementFromSelector}
      />
    );
  }

  // Show simulation results viewer if requested
  if (showSimulationResults) {
    return (
      <SimulationResultsViewer 
        onBack={() => setShowSimulationResults(false)}
        projectPath={filePath}
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* Loading Panel - Show while fetching initial status */}
      {isInitialLoading && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingPanel}>
            <LinearGradient
              colors={['#059669', '#10b981', '#34d399']}
              style={styles.loadingPanelGradient}
            >
              {/* Animated Loading Icon */}
              <View style={styles.loadingIconContainer}>
                <Image 
                  source={require('../assets/Matlab_Logo.png')} 
                  style={styles.loadingIcon}
                  resizeMode="contain"
                />
              </View>
              
              {/* Loading Text */}
              <Text style={styles.loadingTitle}>MATLAB Antenna Optimizer</Text>
              <Text style={styles.loadingMessage}>{loadingMessage}</Text>
              
              {/* Loading Spinner */}
              <View style={styles.loadingSpinnerContainer}>
                <View style={styles.loadingSpinner}>
                  <View style={styles.spinnerDot} />
                  <View style={[styles.spinnerDot, { animationDelay: '0.2s' }]} />
                  <View style={[styles.spinnerDot, { animationDelay: '0.4s' }]} />
                </View>
              </View>
            </LinearGradient>
          </View>
        </View>
      )}
      
      {/* Header Section - Different gradient from index */}
      <LinearGradient
        colors={['#059669', '#10b981', '#34d399']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.headerStatus}>
            <View style={[styles.statusDot, 
              serverStatus.includes('Connected') && !serverStatus.includes('⚠️') ? styles.statusDotGreen :
              serverStatus.includes('⚠️') ? styles.statusDotYellow : styles.statusDotRed
            ]} />
          </View>
        </View>
        
        <View style={styles.headerContent}>
          <View style={styles.titleContainer}>
            <LinearGradient
              colors={['#1e40af', '#3b82f6']}
              style={styles.titleIcon}
            >
              <Image 
                source={require('../assets/Matlab_Logo.png')} 
                style={styles.titleIconImage}
                resizeMode="contain"
              />
            </LinearGradient>
            <View style={styles.titleTexts}>
              <Text style={styles.title}>MATLAB Studio</Text>
              <Text style={styles.subtitle}>Execute & monitor optimization projects</Text>
            </View>
          </View>
          
          {/* Status Overview in Header */}
          <View style={styles.headerStatusOverview}>
            <View style={styles.headerStatusCard}>
              <View style={styles.headerStatusContent}>
                <View style={styles.headerStatusIconContainer}>
                  <Image 
                    source={require('../assets/server_icon.png')} 
                    style={styles.headerStatusIcon}
                    resizeMode="contain"
                  />
                </View>
                
                {/* Server Status Card */}
                <View style={styles.headerStatusTexts}>
                  <Text style={styles.headerStatusTitle}>Server</Text>
                  <Text style={[styles.headerStatusValue,
                    serverStatus.includes('Connected') && !serverStatus.includes('⚠️') ? styles.statusConnected :
                    serverStatus.includes('⚠️') ? styles.statusWarning : styles.statusError
                  ]}>
                    {serverStatus.split(' - ')[0]}
                  </Text>

                </View>
              </View>
            </View>

            <View style={styles.headerStatusCard}>
              <View style={[styles.headerStatusContent, 
                executionState.isRunning ? styles.headerStatusRunning : styles.headerStatusReady
              ]}>
                <View style={styles.headerStatusIconContainer}>
                  {executionState.isRunning ? (
                    <Image 
                      source={require('../assets/program_running.gif')} 
                      style={styles.headerStatusIcon}
                      resizeMode="contain"
                    />
                  ) : (
                    <Image 
                      source={require('../assets/ready_icon.png')} 
                      style={styles.headerStatusIcon}
                      resizeMode="contain"
                    />
                  )}
                </View>
                <View style={styles.headerStatusTexts}>
                  <Text style={styles.headerStatusTitle}>MATLAB</Text>
                  <Text style={styles.headerStatusValue}>
                    {executionState.isRunning ? 'Running' : 'Ready'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </LinearGradient>

      {/* Results Button Section - Just below header */}
      {projectLocationConfirmed && (
        <View style={styles.headerResultsButtonSection}>
          <TouchableOpacity 
            onPress={() => {
              if (projectLocationConfirmed && filePath) {
                setShowSimulationResults(true);
              } else {
                Alert.alert(
                  'Project Location Required',
                  'Please confirm your project location first to view simulation results from the correct directory.'
                );
              }
            }} 
            style={styles.headerResultsButton}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#0ea5e9', '#0284c7']}
              style={styles.headerResultsButtonGradient}
            >
              <Text style={styles.headerResultsButtonIcon}>📊</Text>
              <Text style={styles.headerResultsButtonText}>View Simulation Results</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.scrollWrapper}>
        <ScrollView 
          style={styles.content} 
          contentContainerStyle={[styles.contentContainer, showPathHistory && styles.contentContainerExpanded]} 
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled={true}
        >
        {/* Close dropdown overlay - positioned to not interfere with dropdown content */}
        {showPathHistory && (
          <TouchableOpacity 
            style={styles.dropdownOverlay} 
            onPress={() => setShowPathHistory(false)}
            activeOpacity={1}
          />
        )}

        {/* Combined MATLAB & HFSS Session Card - Compact design */}
        {(executionState.isRunning || hfssProcesses.length > 0) && (
          <View style={styles.detailsCard}>
            <View style={styles.detailsCardHeader}>
              <View style={styles.detailsIcon}>
                <Text style={styles.detailsIconText}>⚡</Text>
              </View>
              <Text style={styles.detailsCardTitle}>Active Sessions</Text>
              <TouchableOpacity 
                onPress={() => {
                  const instructions = executionState.fileName?.endsWith('.mlx') 
                    ? 'Next Steps for Live Script (.mlx):\n\n• Live Script is executing automatically in MATLAB\n• Monitor progress in the MATLAB GUI window\n• Use "Stop Project" button to close MATLAB when done\n\nNote: Live Scripts now execute automatically on launch.'
                    : 'Next Steps for Script (.m):\n\n• Script should be executing automatically in MATLAB\n• Monitor progress in the MATLAB GUI window\n• Use "Stop Project" button to close MATLAB when done\n\nNote: Regular scripts execute automatically.';
                  
                  if (Platform.OS === 'web') {
                    window.alert('💡 Session Instructions\n\n' + instructions);
                  } else {
                    Alert.alert('💡 Session Instructions', instructions);
                  }
                }}
                style={styles.infoIcon}
              >
                <Text style={styles.infoIconText}>ℹ️</Text>
              </TouchableOpacity>
            </View>
            
            {/* MATLAB Session Section */}
            {executionState.isRunning && (
              <View style={styles.sessionSection}>
                <View style={styles.sessionHeader}>
                  <Text style={styles.sessionIcon}>📊</Text>
                  <Text style={styles.sessionTitle}>
                    MATLAB 
                  </Text>
                  <Text style={styles.sessionStatus}>🟡 Running</Text>
                </View>
                <View style={styles.sessionDetails}>
                  <Text style={styles.sessionDetailText} numberOfLines={3}>
                    📄 {executionState.fileName} • ⏱️ {runningTime}
                    {iterationData.current && ` • Current Iteration: ${iterationData.current}`}
                    {executionState.filePath && (
                      `\n📁 ${getProjectDirectory(executionState.filePath)}`
                    )}
                  </Text>
                </View>
              </View>
            )}
            
            {/* Connection Statistics - Show benefits of WebSocket */}
            {connectionStats && wsConnected && (
              <View style={styles.sessionSection}>
                <View style={styles.sessionHeader}>
                  <Text style={styles.sessionIcon}>📡</Text>
                  <Text style={styles.sessionTitle}>Connection Health</Text>
                  <Text style={styles.sessionStatus}>
                    {connectionStats.health >= 80 ? '🟢 Excellent' : 
                     connectionStats.health >= 60 ? '🟡 Good' : '🔴 Poor'}
                  </Text>
                </View>
                <View style={styles.sessionDetails}>
                  <Text style={styles.sessionDetailText}>
                    ⚡ Active: {connectionStats.stats?.established || 0} • 
                    🕐 TIME_WAIT: {connectionStats.stats?.timeWait || 0} • 
                    👥 WebSocket Clients: {connectionStats.wsClients || 0}
                  </Text>
                  <Text style={styles.sessionDetailText}>
                    📊 Health Score: {Math.round(connectionStats.health || 0)}/100 • 
                    🔄 Keep-Alive: {connectionStats.adaptiveSettings?.keepAliveTimeout}ms
                  </Text>
                </View>
              </View>
            )}
            
            {/* HFSS Processes Section */}
            {hfssProcesses.length > 0 && (
              <View style={styles.sessionSection}>
                <View style={styles.sessionHeader}>
                  <Text style={styles.sessionIcon}>⚡</Text>
                  <Text style={styles.sessionTitle}>HFSS</Text>
                  <Text style={styles.sessionStatus}>🟢 {hfssProcesses.length} Active</Text>
                </View>
                <View style={styles.sessionDetails}>
                  <Text style={styles.sessionDetailText}>
                    📡 {hfssProcesses.map(proc => proc.applicationName || proc.name).join(', ')}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Project Control Section - Different layout from index */}
        <View style={styles.controlSection}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTexts}>
              <Text style={styles.sectionTitle}>
                {projectLocationConfirmed ? 'Project Execution' : 'Project Location Setup'}
              </Text>
              <Text style={styles.sectionSubtitle}>
                {projectLocationConfirmed 
                  ? executionState.isRunning 
                    ? `🔄 Running: ${filePath.split('\\').pop() || filePath.split('/').pop()}` 
                    : `Ready to launch: ${filePath.split('\\').pop() || filePath.split('/').pop()}` 
                  : 'Confirm your project location to continue'
                }
              </Text>
            </View>
            {projectLocationConfirmed && (
              <TouchableOpacity 
                onPress={resetProjectLocation} 
                style={[
                  styles.changeLocationButton,
                  executionState.isRunning && styles.changeLocationButtonDisabled
                ]}
                disabled={executionState.isRunning}
              >
                <Text style={[
                  styles.changeLocationText,
                  executionState.isRunning && styles.changeLocationTextDisabled
                ]}>
                  Change
                </Text>
              </TouchableOpacity>
            )}
          </View>
          
          <View style={[styles.inputContainer, showPathHistory && styles.inputContainerExpanded]}>
            <View style={styles.inputHeader}>
              <Text style={styles.inputLabel}>📁 MATLAB Project Path</Text>
              {!projectLocationConfirmed && (
                <View style={styles.inputActions}>
                  {pathHistory.length > 0 && (
                    <TouchableOpacity 
                      onPress={() => setShowPathHistory(!showPathHistory)} 
                      style={styles.historyButton}
                    >
                      <Text style={styles.historyButtonText}>
                        📋 History ({pathHistory.length})
                      </Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={handlePaste} style={styles.pasteButton}>
                    <Text style={styles.pasteButtonText}>📋 Paste</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
            
            {/* Only show text input if location is not confirmed AND MATLAB is not running */}
            {!projectLocationConfirmed && !executionState.isRunning && (
              <TextInput
                style={styles.pathInput}
                value={filePath}
                onChangeText={setFilePath}
                onFocus={() => setShowPathHistory(false)}
                placeholder="C:\Projects\MATLAB\MyProject\optimization_script.mlx"
                placeholderTextColor="#94a3b8"
                multiline={true}
                numberOfLines={2}
                editable={!executionState.isRunning}
              />
            )}
            
            {/* Show info message when MATLAB is running */}
            {executionState.isRunning && !projectLocationConfirmed && (
              <View style={styles.runningInfoBox}>
                <Text style={styles.runningInfoIcon}>🔒</Text>
                <Text style={styles.runningInfoText}>
                  Project location locked - MATLAB is currently running
                </Text>
              </View>
            )}
            
            {/* Enhanced Validation Status */}
            {locationValidationMessage && (
              <View style={[
                styles.validationMessage,
                locationValidationMessage.includes('✅') && styles.validationSuccess,
                locationValidationMessage.includes('❌') && styles.validationError
              ]}>
                <View style={styles.validationContent}>
                  <Text style={[
                    styles.validationText,
                    locationValidationMessage.includes('✅') && styles.validationTextSuccess,
                    locationValidationMessage.includes('❌') && styles.validationTextError
                  ]}>
                    {locationValidationMessage}
                  </Text>
                  {projectLocationConfirmed && (
                    <View style={styles.pathDetailsCard}>
                      <View style={styles.pathDetailsHeader}>
                        <Text style={styles.pathDetailsIcon}>📂</Text>
                        <Text style={styles.pathDetailsTitle}>Validated Project Details</Text>
                      </View>
                      <View style={styles.pathDetailsGrid}>
                        <View style={styles.pathDetailItem}>
                          <Text style={styles.pathDetailLabel}>File Name:</Text>
                          <Text style={styles.pathDetailValue}>
                            {filePath.split('\\').pop() || filePath.split('/').pop()}
                          </Text>
                        </View>
                        <View style={styles.pathDetailItem}>
                          <Text style={styles.pathDetailLabel}>Type:</Text>
                          <Text style={styles.pathDetailValue}>
                            {filePath.toLowerCase().endsWith('.mlx') ? 'MATLAB Live Script' : 'MATLAB Script'}
                          </Text>
                        </View>
                        <View style={styles.pathDetailItem}>
                          <Text style={styles.pathDetailLabel}>Directory:</Text>
                          <Text style={[styles.pathDetailValue, styles.pathDetailDirectory]} numberOfLines={2}>
                            {filePath.substring(0, filePath.lastIndexOf('\\') || filePath.lastIndexOf('/'))}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.pathActionsRow}>
                        <View style={styles.pathStatusBadge}>
                          <Text style={styles.pathStatusText}>
                            {executionState.isRunning ? '🟡 Running' : '🟢 Ready to Launch'}
                          </Text>
                        </View>
                        <TouchableOpacity 
                          onPress={() => {
                            Clipboard.setString(filePath);
                            Alert.alert('📋 Copied', 'Project path copied to clipboard');
                          }} 
                          style={styles.copyPathButton}
                        >
                          <Text style={styles.copyPathText}>📋 Copy Path</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            )}
            
            {/* Path History Dropdown - Only show if location not confirmed */}
            {!projectLocationConfirmed && showPathHistory && pathHistory.length > 0 && (
              <View style={styles.historyDropdown}>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyTitle}>📂 Recent Valid Paths</Text>
                  <TouchableOpacity onPress={clearPathHistory} style={styles.clearHistoryButton}>
                    <Text style={styles.clearHistoryText}>🗑️ Clear</Text>
                  </TouchableOpacity>
                </View>
                
                <ScrollView style={styles.historyList} nestedScrollEnabled={true}>
                  {pathHistory.map((path, index) => (
                    <TouchableOpacity
                      key={index}
                      style={styles.historyItem}
                      onPress={() => {
                        setFilePath(path);
                        setShowPathHistory(false);
                        // Reset location confirmation if user selects a different path
                        if (projectLocationConfirmed) {
                          setProjectLocationConfirmed(false);
                          setLocationValidationMessage('');
                        }
                      }}
                      activeOpacity={0.6}
                      onStartShouldSetResponder={() => true}
                      onResponderGrant={() => {
                      }}
                    >
                      <View style={styles.historyItemContent} pointerEvents="none">
                        <Text style={styles.historyItemFileName}>
                          📄 {path.split('\\').pop() || path.split('/').pop()}
                        </Text>
                        <Text style={styles.historyItemPath} numberOfLines={2}>
                          {path}
                        </Text>
                      </View>
                      <View style={styles.historyItemIndicator} pointerEvents="none">
                        <Text style={styles.historyItemArrow}>▶</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                
                <View style={styles.historyFooter}>
                  <Text style={styles.historyFooterText}>
                    💡 Tap any path to use it instantly
                  </Text>
                </View>
              </View>
            )}
          </View>
          
          {/* Action Buttons - Only show location confirmation when not confirmed */}
          {!projectLocationConfirmed && (
            <View style={styles.actionGrid}>
              <TouchableOpacity 
                onPress={validateProjectLocation} 
                style={[styles.actionButton, styles.confirmAction]}
                disabled={isValidatingLocation || !filePath.trim()}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={isValidatingLocation ? ['#94a3b8', '#64748b'] : ['#3b82f6', '#1d4ed8']}
                  style={styles.actionButtonGradient}
                >
                  <Text style={styles.actionButtonIcon}>
                    {isValidatingLocation ? '⏳' : '✅'}
                  </Text>
                  <Text style={styles.actionButtonText}>
                    {isValidatingLocation ? 'Validating...' : 'Confirm Location'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Compact Quick Guide - Collapsible */}
        <View style={styles.guideCard}>
          <TouchableOpacity 
            onPress={() => setShowQuickGuide(!showQuickGuide)}
            style={styles.guideHeader}
            activeOpacity={0.7}
          >
            <Text style={styles.guideIcon}>🎯</Text>
            <View style={styles.guideHeaderTexts}>
              <Text style={styles.guideTitle}>Quick Start Guide</Text>
              <Text style={styles.guideSubtitle}>
                {showQuickGuide ? 'Tap to collapse' : 'Tap to view 4 easy steps'}
              </Text>
            </View>
            <Text style={styles.guideToggleIcon}>
              {showQuickGuide ? '▼' : '▶'}
            </Text>
          </TouchableOpacity>
          
          {showQuickGuide && (
            <>
              <View style={styles.guideStepsList}>
                <View style={styles.guideStepItem}>
                  <View style={styles.guideStepNumber}>
                    <Text style={styles.guideStepNumberText}>1</Text>
                  </View>
                  <View style={styles.guideStepContent}>
                    <Text style={styles.guideStepTitle}>📁 Select Project File</Text>
                    <Text style={styles.guideStepDescription}>
                      Enter the path to your MATLAB Live Script (.mlx) file in the input field above
                    </Text>
                  </View>
                </View>

                <View style={styles.guideStepItem}>
                  <View style={styles.guideStepNumber}>
                    <Text style={styles.guideStepNumberText}>2</Text>
                  </View>
                  <View style={styles.guideStepContent}>
                    <Text style={styles.guideStepTitle}>🚀 Launch Execution</Text>
                    <Text style={styles.guideStepDescription}>
                      Click the Launch button to start MATLAB and automatically execute your Live Script
                    </Text>
                  </View>
                </View>

                <View style={styles.guideStepItem}>
                  <View style={styles.guideStepNumber}>
                    <Text style={styles.guideStepNumberText}>3</Text>
                  </View>
                  <View style={styles.guideStepContent}>
                    <Text style={styles.guideStepTitle}>👀 Monitor Progress</Text>
                    <Text style={styles.guideStepDescription}>
                      Watch MATLAB GUI and HFSS processes in real-time through the status cards
                    </Text>
                  </View>
                </View>

                <View style={styles.guideStepItem}>
                  <View style={styles.guideStepNumber}>
                    <Text style={styles.guideStepNumberText}>4</Text>
                  </View>
                  <View style={styles.guideStepContent}>
                    <Text style={styles.guideStepTitle}>⏹️ Control Execution</Text>
                    <Text style={styles.guideStepDescription}>
                      Use Stop button to interrupt execution or let MATLAB continue for manual use
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.guideFeatures}>
                <Text style={styles.guideFeaturesTitle}>Key Features</Text>
                <View style={styles.guideFeaturesList}>
                  <Text style={styles.guideFeature}>🖥️ Visible MATLAB GUI for monitoring</Text>
                  <Text style={styles.guideFeature}>⚡ Real-time HFSS process tracking</Text>
                  <Text style={styles.guideFeature}>🎛️ Graceful execution control</Text>
                </View>
              </View>
              
              <View style={styles.guideNote}>
                <Text style={styles.guideNoteIcon}>💡</Text>
                <Text style={styles.guideNoteText}>
                  MATLAB Studio provides full visibility and control over automatic Live Script execution with integrated HFSS monitoring
                </Text>
              </View>
            </>
          )}
        </View>
      </ScrollView>
      </View>
      
      {/* Floating Action Bar - Always visible when location confirmed */}
      {projectLocationConfirmed && (
        <View style={styles.floatingActionBar}>
          <View style={styles.floatingActionGrid}>
            <TouchableOpacity 
              onPress={handleRunProject} 
              style={[styles.floatingActionButton, styles.floatingPrimaryAction]}
              disabled={isLoading || executionState.isRunning}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={executionState.isRunning ? ['#94a3b8', '#64748b'] : ['#059669', '#10b981']}
                style={styles.floatingActionButtonGradient}
              >
                <Text style={styles.floatingActionButtonIcon}>
                  {executionState.isRunning ? '🔄' : '▶️'}
                </Text>
                <Text style={styles.floatingActionButtonText}>
                  {executionState.isRunning ? 'Running...' : 'Launch'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
            
            {/* Stop Button - Only show when running */}
            {executionState.isRunning ? (
              <TouchableOpacity 
                onPress={handleStopMatlab} 
                style={[styles.floatingActionButton, styles.floatingSecondaryAction]}
                disabled={isLoading || isTerminating}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={isTerminating ? ['#e2e8f0', '#cbd5e1'] : ['#ef4444', '#dc2626']}
                  style={styles.floatingActionButtonGradient}
                >
                  <Text style={styles.floatingActionButtonIcon}>⏹️</Text>
                  <Text style={[styles.floatingActionButtonText, 
                    isTerminating ? styles.disabledActionText : styles.enabledActionText
                  ]}>
                    {isTerminating ? 'Terminating...' : 'Stop'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              /* Variables Button - Takes Stop button position when not running */
              <TouchableOpacity 
                onPress={() => setShowVariableSelector(true)} 
                style={[styles.floatingActionButton, styles.floatingSecondaryAction]}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={['#8b5cf6', '#a855f7']}
                  style={styles.floatingActionButtonGradient}
                >
                   <Image 
                    source={require('../assets/variable.png')} 
                    style={styles.floatingActionButtonIconImage}
                    resizeMode="contain"
                  />
                  <Text style={styles.floatingActionButtonText}>
                    Variables
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            {/* Management Buttons Row - Empty when Variables moved up */}
            <View style={styles.managementButtonsRow}>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    ...(Platform.OS === 'web' && {
      height: '100vh',
      maxHeight: '100vh',
      overflow: 'hidden',
    }),
  },
  
  // Loading Panel Styles
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingPanel: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  loadingPanelGradient: {
    padding: 40,
    alignItems: 'center',
  },
  loadingIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  loadingIcon: {
    width: 60,
    height: 60,
  },
  loadingTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 12,
    textAlign: 'center',
  },
  loadingMessage: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 24,
    textAlign: 'center',
  },
  loadingSpinnerContainer: {
    marginTop: 8,
  },
  loadingSpinner: {
    flexDirection: 'row',
    gap: 8,
  },
  spinnerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    ...(Platform.OS === 'web' && {
      animation: 'pulse 1.4s ease-in-out infinite',
    }),
  },
  
  // Dropdown overlay - positioned to allow dropdown interaction
  dropdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  
  // Header Styles - Compact design for better space usage
  header: {
    paddingTop: 15,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 8,
  },
  backButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  headerStatus: {
    alignItems: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusDotGreen: {
    backgroundColor: '#ffffff',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  statusDotYellow: {
    backgroundColor: '#ffffff',
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  statusDotRed: {
    backgroundColor: '#ffffff',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  
  // Scroll Wrapper for web compatibility
  scrollWrapper: {
    flex: 1,
    ...(Platform.OS === 'web' && {
      overflow: 'hidden',
      position: 'relative',
    }),
  },
  
  // Header Content - Horizontal layout different from index
  headerContent: {
    alignItems: 'center',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  titleIconText: {
    fontSize: 20,
    color: '#ffffff',
  },
  titleIconImage: {
    width: 24,
    height: 24,
  },
  titleTexts: {
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  
  // Header Status Styles
  headerStatusOverview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    gap: 16,
    paddingHorizontal: 8,
  },
  headerStatusCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    flex: 1,
    shadowColor: 'rgba(0, 0, 0, 0.1)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  headerStatusContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerStatusRunning: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  headerStatusReady: {
    backgroundColor: 'rgba(100, 116, 139, 0.1)',
    borderColor: 'rgba(100, 116, 139, 0.3)',
  },
  headerStatusIconContainer: {
    width: 28,
    height: 28,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerStatusIcon: {
    width: 22,
    height: 22,
  },
  headerStatusTexts: {
    alignItems: 'flex-start',
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 8,
    marginHorizontal: 2,
    minHeight: 45,
    justifyContent: 'center',
  },
  headerStatusTitle: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  headerStatusValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  autoManagerIndicator: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F59E0B',
    textAlign: 'center',
  },
  wsStatsText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#4CAF50',
    marginTop: 1,
    textShadowColor: 'rgba(76, 175, 80, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  
  // Header Results Button Styles
  headerResultsButtonSection: {
    backgroundColor: '#f8fafc',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerResultsButton: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#0ea5e9',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  headerResultsButtonGradient: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  headerResultsButtonIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  headerResultsButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  
  // Content Styles
  content: {
    flex: 1,
    ...(Platform.OS === 'web' && {
      overflow: 'scroll',
      overflowX: 'hidden',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      height: '100%',
    }),
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 120, // Extra padding for floating action bar
  },
  contentContainerExpanded: {
    paddingBottom: 480, // Extra padding when dropdown is open + floating action bar
  },
  
  // Status Overview - Compact horizontal cards 
  statusOverview: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  statusCard: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  statusCardGradient: {
    padding: 12,
  },
  statusCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusCardIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  statusCardIconContainer: {
    width: 32,
    height: 32,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusCardIconImage: {
    width: 28,
    height: 28,
  },
  statusCardTexts: {
    flex: 1,
  },
  statusCardTitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '600',
    marginBottom: 2,
  },
  statusCardValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  statusConnected: {
    color: '#ffffff',
  },
  statusWarning: {
    color: '#ffffff',
  },
  statusError: {
    color: '#ffffff',
  },
  
  // Details Card - Different from index cards
  detailsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    borderLeftWidth: 4,
    borderLeftColor: '#10b981',
  },
  detailsCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailsIcon: {
    display: 'none', // Hide icon
  },
  detailsIconText: {
    fontSize: 16,
  },
  detailsCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    flex: 1,
  },
  infoIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#0ea5e9',
  },
  infoIconText: {
    fontSize: 14,
  },
  
  // Combined session styles
  sessionSection: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  sessionIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  sessionIconImageContainer: {
    width: 20,
    height: 20,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sessionIconImage: {
    width: 18,
    height: 18,
  },
  sessionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    flex: 1,
  },
  sessionStatus: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
  },
  sessionDetails: {
    paddingLeft: 24,
  },
  sessionDetailText: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 16,
  },
  detailsGrid: {
    gap: 8,
  },
  detailsItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailsLabel: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  detailsValue: {
    fontSize: 14,
    color: '#1e293b',
    fontWeight: '600',
  },
  detailsStatusOpen: {
    color: '#059669',
    fontWeight: '600',
  },
  
  // Control Section - Compact layout for better visibility
  controlSection: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
    zIndex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionIcon: {
    display: 'none', // Hide icon
  },
  sectionIconText: {
    fontSize: 18,
  },
  sectionTexts: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#64748b',
  },
  
  // Input Container - Compact spacing
  inputContainer: {
    marginBottom: 16,
    position: 'relative',
    zIndex: 1000,
  },
  inputContainerExpanded: {
    marginBottom: 320, // Extra space when dropdown is open
  },
  inputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    flex: 1,
  },
  inputActions: {
    flexDirection: 'row',
    gap: 8,
  },
  historyButton: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  historyButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  pasteButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  pasteButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  pathInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    color: '#1e293b',
    minHeight: 60,
    textAlignVertical: 'top',
  },
  
  // Running Info Box Styles
  runningInfoBox: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fbbf24',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  runningInfoIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  runningInfoText: {
    flex: 1,
    fontSize: 14,
    color: '#92400e',
    fontWeight: '500',
  },
  
  // Path History Dropdown Styles
  historyDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 20,
    zIndex: 2000,
    maxHeight: 300,
    marginTop: 8,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
  },
  clearHistoryButton: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  clearHistoryText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  historyList: {
    maxHeight: 200,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
    minHeight: 44, // Ensure minimum touch target height
    backgroundColor: 'transparent',
  },
  historyItemContent: {
    flex: 1,
  },
  historyItemFileName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
  },
  historyItemPath: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 14,
  },
  historyItemIndicator: {
    marginLeft: 8,
  },
  historyItemArrow: {
    fontSize: 12,
    color: '#94a3b8',
  },
  historyFooter: {
    padding: 12,
    backgroundColor: '#f8fafc',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  historyFooterText: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  
  // Action Grid - Three buttons layout
  actionGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  actionButtonGradient: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  actionButtonIcon: {
    fontSize: 16,
    marginBottom: 4,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  enabledActionText: {
    color: '#ffffff',
  },
  disabledActionText: {
    color: '#64748b',
  },
  
  // HFSS Process Styles
  hfssProcessList: {
    gap: 12,
  },
  hfssProcessHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  hfssProcessCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
  },
  hfssProcessStatus: {
    fontSize: 12,
    fontWeight: '500',
    color: '#059669',
  },
  hfssProcessCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#10b981',
  },
  hfssProcessIcon: {
    width: 32,
    height: 32,
    backgroundColor: '#ecfdf5',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  hfssProcessIconText: {
    fontSize: 14,
  },
  hfssProcessIconImage: {
    width: 20,
    height: 20,
  },
  hfssProcessInfo: {
    flex: 1,
  },
  hfssProcessName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 2,
  },
  hfssProcessDetail: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 16,
  },
  hfssProcessIndicator: {
    alignItems: 'center',
  },
  hfssProcessDot: {
    fontSize: 12,
    color: '#10b981',
  },
  
  // Compact Guide Card Styles  
  guideCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  guideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  guideIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  guideHeaderTexts: {
    flex: 1,
  },
  guideToggleIcon: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '600',
    marginLeft: 8,
  },
  guideTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 2,
  },
  guideSubtitle: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  guideStepsList: {
    gap: 12,
    marginTop: 16,
    marginBottom: 16,
  },
  guideStepItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  guideStepNumber: {
    width: 28,
    height: 28,
    backgroundColor: '#10b981',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  guideStepNumberText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  guideStepContent: {
    flex: 1,
  },
  guideStepTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
  },
  guideStepDescription: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
  },
  guideFeatures: {
    marginBottom: 12,
  },
  guideFeaturesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 8,
  },
  guideFeaturesList: {
    gap: 4,
  },
  guideFeature: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 16,
  },
  guideNote: {
    flexDirection: 'row',
    backgroundColor: '#f0f9ff',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#0ea5e9',
  },
  guideNoteIcon: {
    fontSize: 14,
    marginRight: 8,
    marginTop: 1,
  },
  guideNoteText: {
    flex: 1,
    fontSize: 12,
    color: '#0369a1',
    lineHeight: 16,
  },
  
  // Enhanced validation message styles
  validationMessage: {
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  validationSuccess: {
    backgroundColor: '#ecfdf5',
    borderLeftWidth: 4,
    borderLeftColor: '#10b981',
  },
  validationError: {
    backgroundColor: '#fef2f2',
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
  },
  validationContent: {
    padding: 12,
  },
  validationText: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  validationTextSuccess: {
    color: '#059669',
  },
  validationTextError: {
    color: '#dc2626',
  },
  
  // Path details card styles
  pathDetailsCard: {
    marginTop: 12,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#d1fae5',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  pathDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f9ff',
  },
  pathDetailsIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  pathDetailsTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
  },
  pathDetailsGrid: {
    gap: 8,
    marginBottom: 8,
  },
  pathDetailItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  pathDetailLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748b',
    width: 80,
    marginRight: 8,
  },
  pathDetailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
    flex: 1,
  },
  pathDetailDirectory: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 16,
  },
  pathActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  pathStatusBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  pathStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#166534',
  },
  copyPathButton: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  copyPathText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1d4ed8',
  },
  
  // Project location validation styles
  changeLocationButton: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  changeLocationButtonDisabled: {
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
    borderColor: '#94a3b8',
    opacity: 0.5,
  },
  changeLocationText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3b82f6',
  },
  changeLocationTextDisabled: {
    color: '#94a3b8',
  },
  confirmAction: {
    flex: 1,
  },
  
  // Floating Action Bar Styles
  floatingActionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 12,
    paddingBottom: 20,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
    ...(Platform.OS === 'web' && {
      boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.1)',
    }),
  },
  floatingActionGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  floatingActionButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  floatingActionButtonGradient: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  floatingActionButtonIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  floatingActionButtonIconImage: {
    width: 24,
    height: 24,
    marginRight: 8,
  },
  floatingActionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  floatingSecondaryAction: {
    marginLeft: 10,
  },
  floatingOptimizeAction: {
    marginTop: 10,
  },
  floatingResultsAction: {
    marginTop: 10,
    marginLeft: 10,
  },
  enabledActionText: {
    color: '#ffffff',
  },
  disabledActionText: {
    color: '#9ca3af',
  },
  
  // Results Button Section Styles
  resultsButtonSection: {
    backgroundColor: '#ffffff',
    marginHorizontal: 20,
    marginVertical: 15,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    padding: 16,
  },
  resultsButton: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#0ea5e9',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  resultsButtonGradient: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  resultsButtonIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  resultsButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  managementButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 10,
  },
});

// Add CSS animation for web platform
if (Platform.OS === 'web') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0%, 100% {
        opacity: 0.3;
        transform: scale(0.8);
      }
      50% {
        opacity: 1;
        transform: scale(1.2);
      }
    }
  `;
  document.head.appendChild(style);
}