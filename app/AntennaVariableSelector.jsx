import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Dimensions, Platform, Image, TextInput, Keyboard } from "react-native";
import { LinearGradient } from 'expo-linear-gradient';
import GroundPlaneConfigurator from './GroundPlaneConfigurator';
import AppConfig, { PathUtils, showAlert } from './app_config';

const { width } = Dimensions.get('window');

// Server configuration for different environments
const getServerUrls = () => {
  const urls = [];
  
  // Primary URL from centralized config
  urls.push(AppConfig.serverUrl);
  
  // Fallback to localhost
  urls.push('http://localhost:3001');
  
  return urls;
};

const tryFetchWithMultipleUrls = async (endpoint, options) => {
  const urls = getServerUrls();
  let lastError = null;
  
  for (const baseUrl of urls) {
    try {
      console.log(`🔄 Attempting to connect to: ${baseUrl}${endpoint}`);
      
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const fetchOptions = {
        ...options,
        signal: controller.signal
      };
      
      const response = await fetch(`${baseUrl}${endpoint}`, fetchOptions);
      clearTimeout(timeoutId);
      
      console.log(`✅ Successfully connected to ${baseUrl}, status: ${response.status}`);
      return response;
    } catch (error) {
      console.log(`❌ Failed to connect to ${baseUrl}: ${error.message}`);
      console.log(`   Error type: ${error.name}`);
      lastError = error;
    }
  }
  
  console.error('❌ All server URLs failed. Last error:', lastError);
  throw lastError;
};

export default function AntennaVariableSelector({ onBack, projectPath, onOptimizationManagement }) {
  // State for dynamically loaded variables from backend API
  const [antennaVariables, setAntennaVariables] = useState([]);
  const [isLoadingVariables, setIsLoadingVariables] = useState(true);
  const [variablesError, setVariablesError] = useState(null);
  const [excludedVariables, setExcludedVariables] = useState(new Set()); // Changed: now tracks EXCLUDED variables
  const [optimizeAllMode, setOptimizeAllMode] = useState(true); // New: toggle between optimize all vs custom
  const [fModelExists, setFModelExists] = useState(null); // null = not checked, true = exists, false = doesn't exist
  const [isCheckingPath, setIsCheckingPath] = useState(false);
  const [manageOptimizationData, setManageOptimizationData] = useState(false);
  const [showGroundPlaneConfig, setShowGroundPlaneConfig] = useState(false);
  
  // Track whether user has explicitly configured ground plane
  const [hasGroundPlaneConfig, setHasGroundPlaneConfig] = useState(false);
  
  // Ground plane configuration state with default values
  // These are ONLY applied when user explicitly configures them
  // GND_xPos and GND_yPos represent the CENTER of the antenna
  const [groundPlaneConfig, setGroundPlaneConfig] = useState({
    Lgx: 25,       // 25mm default (minimum size to fit 25mm antenna)
    Lgy: 25,       // 25mm default (minimum size to fit 25mm antenna)
    GND_xPos: 12.5,   // Center of 25mm antenna in 25mm ground plane
    GND_yPos: 12.5    // Center of 25mm antenna in 25mm ground plane
  });

  // Load variables from backend API on component mount
  useEffect(() => {
    const loadVariables = async () => {
      try {
        console.log('📥 Loading antenna variables from backend API...');
        setIsLoadingVariables(true);
        setVariablesError(null);
        
        const response = await tryFetchWithMultipleUrls('/api/variables', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const result = await response.json();

        if (result.success && result.variables) {
          // Filter: Keep all optimizable variables (standard + material), exclude only ground_plane
          // Ground plane variables are configured separately via Ground Plane Configurator
          const selectableVariables = result.variables.filter(v => 
            !v.custom && v.category !== 'ground_plane'
          );
          
          // Transform to match UI format
          const transformedVariables = selectableVariables.map(v => {
            // Format range display
            const rangeDisplay = v.range ? 
              (Array.isArray(v.range) ? `[${v.range[0]}, ${v.range[1]}]` : v.range) :
              'N/A';
            
            return {
              id: v.id,
              name: v.name,
              description: v.description || `Variable ${v.name}`,
              range: rangeDisplay,
              formula: v.formula,
              category: v.category
            };
          });
          
          setAntennaVariables(transformedVariables);
          console.log(`✅ Loaded ${transformedVariables.length} optimizable variables (all optimized by default)`);
          console.log(`   Standard variables: ${transformedVariables.filter(v => v.category === 'standard').length}`);
          console.log(`   Material variables: ${transformedVariables.filter(v => v.category === 'material').length}`);
          console.log(`   (Ground plane variables excluded - configured separately)`);
        } else {
          throw new Error(result.message || 'Failed to load variables');
        }
      } catch (error) {
        console.error('❌ Failed to load variables from API:', error);
        setVariablesError(error.message);
        
        // Show error to user
        const errorMsg = `Failed to load variables from server:\n${error.message}\n\nPlease ensure the server is running.`;
        showAlert('Loading Error', errorMsg);
      } finally {
        setIsLoadingVariables(false);
      }
    };

    loadVariables();
  }, []); // Run once on mount


  const checkFModelPath = async () => {
    if (!projectPath || !projectPath.trim()) {
      const errorMessage = 'Please set a project location first.';
      showAlert('No Project Path', errorMessage);
      return;
    }

    setIsCheckingPath(true);
    
    try {
      // Extract project root from project path using PathUtils
      const projectRoot = PathUtils.getProjectRoot(projectPath);
      
      // Construct the expected path using proper separators
      const expectedPath = projectPath.includes('\\') 
        ? `${projectRoot}\\Function\\HFSS\\F_Model_Element.m`
        : `${projectRoot}/Function/HFSS/F_Model_Element.m`;
      
      const response = await tryFetchWithMultipleUrls('/api/matlab/check-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filePath: expectedPath
        }),
      });
      
      const responseText = await response.text();
      
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        console.log('❌ JSON parse error:', parseError);
        console.log('📄 Response was not JSON:', responseText.substring(0, 200));
        throw new Error(`Server returned non-JSON response: ${responseText.substring(0, 100)}`);
      }
      
      setFModelExists(result.exists);
      
      if (result.exists) {
        // Build file info message based on what exists
        let filesFound = [];
        if (result.mFile) filesFound.push('.m file');
        if (result.mlxFile) filesFound.push('.mlx file');
        const filesList = filesFound.join(' and ');
        
        const successMessage = `F_Model_Element files found and ready!\n\nCreating new file will replace existing files.`;
        
        showAlert('Files Found', successMessage);
      } else {
        const errorMessage = `F_Model_Element files not found.\n\nSelect variables and create the file to continue.`;
        
        showAlert('File Not Found', errorMessage);
      }
      
    } catch (error) {
      console.log('❌ Path check failed:', error);
      console.log('   Error name:', error.name);
      console.log('   Error message:', error.message);
      console.log('   Network state - check if device is on same network as server');
      setFModelExists(false);
      
      // More detailed error message
      let errorMessage = `Cannot connect to server.\n\n`;
      
      if (error.name === 'AbortError') {
        errorMessage += `Connection timeout (10s exceeded).\n\n`;
      } else if (error.message.includes('Network request failed')) {
        errorMessage += `Network error - check if:\n1. Device is on same Wi-Fi (${AppConfig.server.subnet})\n2. Server is running on ${AppConfig.server.host}:${AppConfig.server.port}\n3. Firewall allows port ${AppConfig.server.port}\n\n`;
      }
      
      errorMessage += `Please ensure the server is running at ${AppConfig.server.host}:${AppConfig.server.port}`;
      
      showAlert('Connection Failed', errorMessage);
    } finally {
      setIsCheckingPath(false);
    }
  };

  // Auto-check F_Model_Element.m when component mounts or project path changes
  useEffect(() => {
    if (projectPath && projectPath.trim()) {
      // Silent check without showing alerts
      const silentCheck = async () => {
        setIsCheckingPath(true);
        try {
          // Extract project root from project path using PathUtils
          const projectRoot = PathUtils.getProjectRoot(projectPath);
          
          // Construct the expected path using proper separators
          const expectedPath = projectPath.includes('\\') 
            ? `${projectRoot}\\Function\\HFSS\\F_Model_Element.m`
            : `${projectRoot}/Function/HFSS/F_Model_Element.m`;
          
          const response = await tryFetchWithMultipleUrls('/api/matlab/check-file', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filePath: expectedPath
            }),
          });
          
          const result = await response.json();
          setFModelExists(result.exists);
        } catch (error) {
          console.log('❌ Auto-check failed:', error);
          setFModelExists(false);
        } finally {
          setIsCheckingPath(false);
        }
      };
      silentCheck();
    }
  }, [projectPath]);

  const toggleVariable = (variableId) => {
    // In custom mode, toggle exclusion (add/remove from excluded set)
    if (!optimizeAllMode) {
      const newExcluded = new Set(excludedVariables);
      if (newExcluded.has(variableId)) {
        newExcluded.delete(variableId);
      } else {
        newExcluded.add(variableId);
      }
      setExcludedVariables(newExcluded);
    }
    // In optimize-all mode, clicking toggle has no effect (all are optimized)
  };

  const clearExclusions = () => {
    setExcludedVariables(new Set());
  };
  
  const excludeAll = () => {
    const allIds = new Set(antennaVariables.map(v => v.id));
    setExcludedVariables(allIds);
  };

  const createNewFModelFile = async () => {
    // Calculate variables to optimize (all - excluded)
    const variablesToOptimize = optimizeAllMode 
      ? antennaVariables.length
      : antennaVariables.length - excludedVariables.size;
    
    if (variablesToOptimize === 0) {
      showAlert('No Variables', 'Please optimize at least one variable.');
      return;
    }

    if (!projectPath || !projectPath.trim()) {
      showAlert('No Project Path', 'Please set a project path first.');
      return;
    }

    // Simple confirmation dialog
    const optimizeCount = optimizeAllMode ? antennaVariables.length : antennaVariables.length - excludedVariables.size;
    const confirmMessage = `Create F_Model_Element.m with ${optimizeCount} variables to optimize?${!optimizeAllMode ? ` (${excludedVariables.size} excluded)` : ' (all design variables)'}`;
    
    const proceedWithCreation = async () => {
      try {
        let optimizationResult = null;
        
        // Step 1: Handle optimization management if enabled
        if (manageOptimizationData && onOptimizationManagement) {
          const managementResult = await onOptimizationManagement();
          if (!managementResult.success) {
            return; // Operation failed or was cancelled
          }
          optimizationResult = managementResult.result;
        }

        // Step 2: Create F_Model_Element file
        await executeFileCreation();

        // Step 3: Show completion notification with accurate information
        let completionMessage = '';
        
        const optimizedCount = optimizeAllMode ? antennaVariables.length : antennaVariables.length - excludedVariables.size;
        
        if (manageOptimizationData && optimizationResult) {
          // Build dynamic message based on what actually happened
          if (optimizationResult.optimizationExists) {
            completionMessage = `File created successfully!\n\nOld optimization data backed up.\nGround plane configured.\n${optimizedCount} variables optimizing.`;
          } else {
            completionMessage = `File created successfully!\n\n${optimizedCount} variables optimizing.\nGround plane configured.\nReady for optimization.`;
          }
        } else {
          completionMessage = `File created successfully!\n\n${optimizedCount} variables optimizing.\nGround plane configured.\nExisting data preserved.`;
        }

        showAlert('✅ Complete', completionMessage, [{
          text: 'OK',
          onPress: () => {
            // Auto-navigate back to MATLAB studio after user clicks OK
            setTimeout(() => onBack(), Platform.OS === 'web' ? 100 : 0);
          }
        }]);
      } catch (error) {
        const errorMessage = `Process failed: ${error.message || error}`;
        showAlert('Error', errorMessage);
      }
    };

    // Show confirmation dialog - different handling for web vs native
    if (Platform.OS === 'web') {
      const confirmed = window.confirm(confirmMessage);
      if (confirmed) {
        await proceedWithCreation();
      }
    } else {
      showAlert(
        'Confirm Creation',
        confirmMessage,
        [
          {
            text: 'No',
            style: 'cancel'
          },
          {
            text: 'Yes',
            onPress: proceedWithCreation,
            style: 'default'
          }
        ]
      );
    }
  };

  const executeFileCreation = async () => {
    try {
      // Calculate variables to optimize: all design variables minus excluded ones
      let variableIds;
      if (optimizeAllMode) {
        // Optimize ALL design variables
        variableIds = antennaVariables.map(v => v.id).sort((a, b) => a - b);
      } else {
        // Optimize only non-excluded design variables
        variableIds = antennaVariables
          .filter(v => !excludedVariables.has(v.id))
          .map(v => v.id)
          .sort((a, b) => a - b);
      }
      
      // Note: Ground plane variables (83-86) are ALWAYS included by generate_f_model.py
      // with default values. Material variable (87) is also added by the Python script.
      
      console.log(`🔧 Creating new F_Model_Element.m for ${variableIds.length} variables (${optimizeAllMode ? 'ALL' : 'CUSTOM'}):`, variableIds);
      console.log(`📁 Using project path: ${projectPath}`);
      
      // Try multiple server URLs to find the working one
      const response = await tryFetchWithMultipleUrls('/api/matlab/apply-variables', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          variableIds: variableIds,
          projectPath: projectPath
        }),
      });

      const result = await response.json();

      if (result.success) {
        console.log(`✅ F_Model_Element.m created successfully`);
        
        // Step 2: Apply ground plane configuration ONLY if user explicitly configured it
        if (hasGroundPlaneConfig) {
          try {
            if (groundPlaneConfig.mode === 'custom') {
              // Custom GND import - generate F_GND_Import.m
              console.log(`🔧 Generating F_GND_Import.m for custom DXF ground plane:`);
              console.log(`   DXF file: ${groundPlaneConfig.file.path}`);
              console.log(`   GND_xPos: ${groundPlaneConfig.GND_xPos}`);
              console.log(`   GND_yPos: ${groundPlaneConfig.GND_yPos}`);
              console.log(`   Project path: ${projectPath}`);
              
              const gndImportResponse = await tryFetchWithMultipleUrls('/api/matlab/generate-gnd-import', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  dxfPath: groundPlaneConfig.file.path,
                  gndXPos: groundPlaneConfig.GND_xPos,
                  gndYPos: groundPlaneConfig.GND_yPos,
                  projectPath: projectPath
                }),
              });

              const gndImportResult = await gndImportResponse.json();
              
              if (gndImportResult.success) {
                console.log(`✅ F_GND_Import.m generated successfully:`);
                console.log(`   Output: ${gndImportResult.outputFile}`);
                console.log(`   Parameters: ${JSON.stringify(gndImportResult.parameters)}`);
              } else {
                console.log(`⚠️ F_GND_Import.m generation failed: ${gndImportResult.message}`);
                const errorMsg = `Custom GND import failed:\n${gndImportResult.message}`;
                showAlert('Warning', errorMsg);
              }
            } else {
              // Parametric GND - update F_Model_Element.m with ground plane variables
              console.log(`🔧 Applying user-configured ground plane:`);
              console.log(`   Lgx: ${groundPlaneConfig.Lgx}`);
              console.log(`   Lgy: ${groundPlaneConfig.Lgy}`);
              console.log(`   GND_xPos: ${groundPlaneConfig.GND_xPos}`);
              console.log(`   GND_yPos: ${groundPlaneConfig.GND_yPos}`);
              console.log(`   Project path: ${projectPath}`);
              
              const groundPlaneResponse = await tryFetchWithMultipleUrls('/api/matlab/update-ground-plane', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  projectPath: projectPath,
                  ...groundPlaneConfig
                }),
              });

              const groundPlaneResult = await groundPlaneResponse.json();
              
              if (groundPlaneResult.success) {
                console.log(`✅ Ground plane updated successfully:`);
                console.log(`   ${JSON.stringify(groundPlaneResult.parameters)}`);
              } else {
                console.log(`⚠️ Ground plane update failed: ${groundPlaneResult.message}`);
                const errorMsg = `Ground plane update failed:\n${groundPlaneResult.message}`;
                showAlert('Warning', errorMsg);
              }
            }
          } catch (groundPlaneError) {
            console.log(`⚠️ Ground plane configuration failed: ${groundPlaneError.message}`);
            const errorMsg = `Ground plane configuration failed:\n${groundPlaneError.message}`;
            showAlert('Warning', errorMsg);
          }
        } else {
          console.log(`ℹ️ Ground plane not configured by user - generating empty F_GND_Import.m`);
          
          // Generate empty F_GND_Import.m to avoid import errors
          try {
            const clearGndResponse = await tryFetchWithMultipleUrls('/api/matlab/generate-gnd-import', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                mode: 'clear',
                projectPath: projectPath
              }),
            });

            const clearGndResult = await clearGndResponse.json();
            
            if (clearGndResult.success) {
              console.log(`✅ Empty F_GND_Import.m generated (no custom GND)`);
            } else {
              console.log(`⚠️ Failed to clear F_GND_Import.m: ${clearGndResult.message}`);
            }
          } catch (clearError) {
            console.log(`⚠️ Failed to generate empty F_GND_Import.m: ${clearError.message}`);
            // Non-critical error - continue anyway
          }
        }
        
        // Refresh the path check to update the button status
        setTimeout(() => {
          const silentRecheck = async () => {
            try {
              const projectRoot = PathUtils.getProjectRoot(projectPath);
              
              const expectedPath = `${projectRoot}\\Function\\HFSS\\F_Model_Element.m`;
              
              const response = await tryFetchWithMultipleUrls('/api/matlab/check-file', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  filePath: expectedPath
                }),
              });
              
              const result = await response.json();
              setFModelExists(result.exists);
              console.log('🔄 Post-creation recheck:', result.exists ? 'File confirmed' : 'File not found');
            } catch (error) {
              console.log('⚠️ Post-creation recheck failed:', error);
            }
          };
          silentRecheck();
        }, 1000); // Small delay to ensure file system has updated
      } else {
        const errorMessage = result.message || 'Failed to create F_Model_Element.m';
        console.log(`❌ Error: ${result.message}`);
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.log(`❌ Network error:`, error);
      if (error.message) {
        throw error; // Re-throw the error with its message
      } else {
        throw new Error('Failed to communicate with server. Please check if the server is running.');
      }
    }
  };

  // Show all optimizable variables (standard + material, exclude ground_plane)
  const designVariables = antennaVariables.filter(v => !v.custom);

  // Show loading state
  if (isLoadingVariables) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#8b5cf6', '#a855f7', '#c084fc']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.header}
        >
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.title}>Loading Variables...</Text>
          </View>
        </LinearGradient>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>⏳ Loading antenna variables from server...</Text>
        </View>
      </View>
    );
  }

  // Show error state
  if (variablesError) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#8b5cf6', '#a855f7', '#c084fc']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.header}
        >
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.title}>Error Loading Variables</Text>
          </View>
        </LinearGradient>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>❌ Failed to load variables</Text>
          <Text style={styles.errorDetail}>{variablesError}</Text>
          <TouchableOpacity onPress={onBack} style={styles.errorButton}>
            <Text style={styles.errorButtonText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Show ground plane configurator if activated
  if (showGroundPlaneConfig) {
    return (
      <GroundPlaneConfigurator
        onBack={() => setShowGroundPlaneConfig(false)}
        onApply={(config) => {
          setGroundPlaneConfig(config);
          setHasGroundPlaneConfig(true); // Mark that user has configured ground plane
          setShowGroundPlaneConfig(false);
          
          let message;
          if (config.mode === 'custom') {
            // Custom GND import
            message = `Custom GND imported:\n${config.file.name} (${config.file.format.toUpperCase()})\n` +
                     `Size: ${config.bounds.width.toFixed(1)}×${config.bounds.height.toFixed(1)}mm\n` +
                     `Antenna at (${config.GND_xPos.toFixed(1)}, ${config.GND_yPos.toFixed(1)})mm`;
          } else {
            // Parametric GND
            message = `Ground plane configured:\n${config.Lgx}×${config.Lgy}mm\n` +
                     `Antenna at (${config.GND_xPos.toFixed(1)}, ${config.GND_yPos.toFixed(1)})mm`;
          }
          
          showAlert('Configuration Saved', message);
        }}
        projectPath={projectPath}
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={['#8b5cf6', '#a855f7', '#c084fc']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.headerRightSection}>
            <View style={styles.headerStatus}>
              <Text style={styles.selectionCount}>
                {optimizeAllMode ? antennaVariables.length : antennaVariables.length - excludedVariables.size}/{antennaVariables.length}
              </Text>
            </View>
            <TouchableOpacity 
              onPress={checkFModelPath} 
              style={[
                styles.headerCheckButton,
                fModelExists === true && styles.headerCheckButtonExists,
                fModelExists === false && styles.headerCheckButtonMissing
              ]}
              disabled={isCheckingPath}
            >
              <Text style={[
                styles.headerCheckButtonText,
                fModelExists === true && styles.headerCheckButtonTextExists,
                fModelExists === false && styles.headerCheckButtonTextMissing
              ]}>
                {isCheckingPath ? '⏳ Checking' : 
                 fModelExists === true ? '✅ Valid Path' :
                 fModelExists === false ? '❌ Invalid Path' :
                 '📁 Check'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        
        <View style={styles.headerContent}>
          <View style={styles.headerTitleRow}>
            <Image 
              source={require('../assets/user_guide_icon.png')} 
              style={styles.headerTitleIcon}
              resizeMode="contain"
            />
            <View style={styles.headerTitleTexts}>
              <Text style={styles.title}>Antenna Optimization</Text>
              <Text style={styles.subtitle}>All design variables optimized by default</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      {/* Control Panel */}
      <View style={styles.controlPanel}>
        {/* Top Row: Two Toggles Side by Side */}
        <View style={styles.topTogglesRow}>
          {/* Left: Optimization Mode Toggle */}
          <View style={[
            styles.optimizationModeToggleCompact,
            optimizeAllMode ? styles.toggleOptimizeAll : styles.toggleCustom
          ]}>
            <View style={styles.toggleInfoCompact}>
              <Text style={styles.toggleTitleCompact}>
                {optimizeAllMode ? '⚙️ Optimize All Variables' : '🎯 Custom Selection'}
              </Text>
              <Text style={styles.toggleDescriptionCompact}>
                {optimizeAllMode 
                  ? 'All design variables will be optimized' 
                  : `Select which variables to exclude (${excludedVariables.size} excluded)`}
              </Text>
            </View>
            <Switch
              value={!optimizeAllMode}
              onValueChange={(value) => {
                setOptimizeAllMode(!value);
                if (value) {
                  setExcludedVariables(new Set());
                }
              }}
              trackColor={{ false: '#dbeafe', true: '#fef3c7' }}
              thumbColor={optimizeAllMode ? '#3b82f6' : '#f59e0b'}
            />
          </View>

          {/* Right: Optimization Data Management Toggle */}
          <View style={[
            styles.optimizationDataToggleCompact,
            manageOptimizationData ? styles.toggleCleanMode : styles.toggleKeepMode
          ]}>
            <View style={styles.toggleInfoCompact}>
              <Text style={styles.toggleTitleCompact}>
                {manageOptimizationData ? '🗑️ Clean Previous Data' : '🔄 Keep Existing Data'}
              </Text>
              <Text style={styles.toggleDescriptionCompact}>
                {manageOptimizationData 
                  ? 'Backup old results and configuation files' 
                  : 'Hold existing simulation result'}
              </Text>
            </View>
            <Switch
              value={manageOptimizationData}
              onValueChange={setManageOptimizationData}
              trackColor={{ false: '#dcfce7', true: '#fef3c7' }}
              thumbColor={manageOptimizationData ? '#f59e0b' : '#10b981'}
            />
          </View>
        </View>

        {/* Ground Plane Configuration Button */}
        <TouchableOpacity 
          onPress={() => setShowGroundPlaneConfig(true)}
          style={styles.groundPlaneConfigButton}
        >
          <LinearGradient
            colors={
              groundPlaneConfig.mode === 'custom' 
                ? ['#6366f1', '#4f46e5']
                : ['#f59e0b', '#ea580c']
            }
            style={styles.configButtonGradient}
          >
            <Text style={styles.configButtonIcon}>
              {groundPlaneConfig.mode === 'custom' ? '📐' : '🏗️'}
            </Text>
            <View style={styles.configButtonText}>
              <Text style={styles.configButtonTitle}>
                {groundPlaneConfig.mode === 'custom' ? 'Custom Ground Plane Config' : 'Ground Plane Config'}
              </Text>
              <Text style={styles.configButtonSubtitle}>
                {groundPlaneConfig.mode === 'custom'
                  ? `${groundPlaneConfig.file.name} (${groundPlaneConfig.bounds.width.toFixed(1)}×${groundPlaneConfig.bounds.height.toFixed(1)}mm)`
                  : `GND size: ${groundPlaneConfig.Lgx}×${groundPlaneConfig.Lgy}mm | Antenna: (${groundPlaneConfig.GND_xPos.toFixed(1)}, ${groundPlaneConfig.GND_yPos.toFixed(1)})mm`
                }
              </Text>
            </View>
            <Text style={styles.configButtonArrow}>→</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Control Buttons */}
        <View style={styles.controlButtons}>
          <TouchableOpacity 
            onPress={clearExclusions} 
            style={styles.controlButton}
            disabled={optimizeAllMode}
          >
            <Text style={[styles.controlButtonText, optimizeAllMode && styles.controlButtonDisabled]}>
              ✓ Include All
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={excludeAll} 
            style={styles.controlButton}
            disabled={optimizeAllMode}
          >
            <Text style={[styles.controlButtonText, optimizeAllMode && styles.controlButtonDisabled]}>
              ✗ Exclude All
            </Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.statsPanel}>
          <Text style={styles.statsText}>
            Optimizing: {optimizeAllMode ? antennaVariables.length : antennaVariables.length - excludedVariables.size} | 
            Excluded: {optimizeAllMode ? 0 : excludedVariables.size} | 
            Total: {antennaVariables.length}
          </Text>
        </View>
      </View>

      {/* Variable List */}
      <View style={styles.scrollWrapper}>
        <ScrollView 
          style={styles.content} 
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
        >
          <View style={styles.variableList}>
            {designVariables.map((variable) => {
              const isExcluded = excludedVariables.has(variable.id);
              const isOptimizing = optimizeAllMode || !isExcluded;
              
              return (
                <View key={variable.id} style={[
                  styles.variableCard,
                  isOptimizing ? styles.variableCardOptimizing : styles.variableCardExcluded
                ]}>
                  <View style={styles.variableHeader}>
                    <View style={styles.variableInfo}>
                      <View style={styles.variableNameRow}>
                        <Text style={[
                          styles.variableName,
                          !isOptimizing && styles.variableNameExcluded
                        ]}>
                          {variable.name}
                        </Text>
                      </View>
                      <Text style={[
                        styles.variableDescription,
                        !isOptimizing && styles.variableDescriptionExcluded
                      ]}>
                        {variable.description}
                      </Text>
                    </View>
                    <Switch
                      value={isOptimizing}
                      onValueChange={() => toggleVariable(variable.id)}
                      disabled={optimizeAllMode}
                      trackColor={{ false: '#fecaca', true: '#86efac' }}
                      thumbColor={optimizeAllMode ? '#10b981' : (isExcluded ? '#ef4444' : '#10b981')}
                    />
                  </View>
                  
                  <View style={styles.variableDetails}>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Range:</Text>
                      <Text style={[
                        styles.detailValue,
                        !isOptimizing && styles.detailValueExcluded
                      ]}>
                        {variable.range}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
          {/* Extra bottom padding to ensure last items are visible */}
          <View style={styles.scrollBottomPadding} />
        </ScrollView>
      </View>

      {/* Fixed Bottom Button - Create F_Model_Element */}
      <View style={styles.fixedBottomContainer}>
        <TouchableOpacity 
          onPress={createNewFModelFile}
          style={styles.fixedBottomButton}
        >
          <LinearGradient
            colors={['#10b981', '#059669']}
            style={styles.fixedBottomButtonGradient}
          >
            <Text style={styles.fixedBottomButtonText}>
              💾 Save Configuration
            </Text>
            <Text style={styles.fixedBottomButtonSubtext}>
              Variables: {optimizeAllMode ? antennaVariables.length : antennaVariables.length - excludedVariables.size}/{antennaVariables.length} optimizing
              {' • '}
              {hasGroundPlaneConfig 
                ? `GND: ${groundPlaneConfig.Lgx}×${groundPlaneConfig.Lgy}mm @ (${groundPlaneConfig.GND_xPos.toFixed(1)}, ${groundPlaneConfig.GND_yPos.toFixed(1)})mm`
                : 'GND: Not configured'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  // Main Container - Root layout with full height and background color
  container: { flex: 1, backgroundColor: '#f8fafc', ...(Platform.OS === 'web' && { height: '100vh', maxHeight: '100vh', overflow: 'hidden' }) },

  // Header Section - Purple gradient header with back button, status indicators, and title
  header: { paddingTop: 20, paddingBottom: 30, paddingHorizontal: 20 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, marginTop: 10 },
  headerRightSection: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerCheckButton: { backgroundColor: 'rgba(255, 255, 255, 0.2)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, minWidth: 100, alignItems: 'center' },
  headerCheckButtonExists: { backgroundColor: 'rgba(16, 185, 129, 0.3)' },
  headerCheckButtonMissing: { backgroundColor: 'rgba(239, 68, 68, 0.3)' },
  headerCheckButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  headerCheckButtonTextExists: { color: '#dcfce7' },
  headerCheckButtonTextMissing: { color: '#fecaca' },
  backButton: { backgroundColor: 'rgba(255, 255, 255, 0.2)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  backButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  headerStatus: { backgroundColor: 'rgba(255, 255, 255, 0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  selectionCount: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  headerContent: { alignItems: 'center' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  headerTitleIcon: { width: 32, height: 32, marginRight: 12 },
  headerTitleTexts: { alignItems: 'flex-start' },
  title: { fontSize: 24, fontWeight: '700', color: '#ffffff', marginBottom: 4 },
  subtitle: { fontSize: 14, color: 'rgba(255, 255, 255, 0.8)' },

  // Control Panel - White card containing toggles, inputs, and control buttons
  controlPanel: { backgroundColor: '#ffffff', marginHorizontal: 20, marginTop: 20, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 5 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 4 },
  sectionDescription: { fontSize: 12, color: '#64748b', marginBottom: 16, lineHeight: 16 },
  controlButtons: { flexDirection: 'row', gap: 12, marginTop: 12 },
  controlButton: { flex: 1, backgroundColor: '#f1f5f9', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  controlButtonText: { fontSize: 14, fontWeight: '600', color: '#475569' },
  controlButtonDisabled: { color: '#cbd5e1' },
  statsPanel: { backgroundColor: '#f8fafc', padding: 8, borderRadius: 8 },
  statsText: { fontSize: 12, color: '#64748b', textAlign: 'center' },

  // Ground Plane Input Fields - Text inputs for Lgx, Lgy, GND_xPos, GND_yPos configuration
  groundPlaneInputs: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  inputGroup: { flex: 1 },
  inputLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  textInput: { flex: 1, fontSize: 14, color: '#1f2937', paddingVertical: 0 },
  unitText: { fontSize: 14, color: '#6b7280', fontWeight: '500', marginLeft: 4 },

  // Toggle Components - Switches for optimization mode (all/custom) and data management (keep/clean)
  topTogglesRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  optimizationModeToggleCompact: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 2 },
  optimizationDataToggleCompact: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 1 },
  toggleInfoCompact: { flex: 1, marginRight: 8 },
  toggleTitleCompact: { fontSize: 12, fontWeight: '700', color: '#1e293b', marginBottom: 3 },
  toggleDescriptionCompact: { fontSize: 10, color: '#64748b', lineHeight: 13 },
  optimizationToggle: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, marginBottom: 16, borderWidth: 1 },
  optimizationModeToggle: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, marginBottom: 16, borderWidth: 2 },
  toggleOptimizeAll: { backgroundColor: '#eff6ff', borderColor: '#93c5fd' },
  toggleCustom: { backgroundColor: '#fffbeb', borderColor: '#fcd34d' },
  toggleKeepMode: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  toggleCleanMode: { backgroundColor: '#fefbf3', borderColor: '#fed7aa' },
  toggleInfo: { flex: 1, marginRight: 12 },
  toggleTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b', marginBottom: 2 },
  toggleDescription: { fontSize: 12, color: '#64748b', lineHeight: 16 },

  // Ground Plane Configurator Button - Opens modal for custom/default ground plane setup
  groundPlaneConfigButton: { borderRadius: 12, overflow: 'hidden', marginBottom: 12, shadowColor: '#f59e0b', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  configButtonGradient: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16 },
  configButtonIcon: { fontSize: 24, marginRight: 12 },
  configButtonText: { flex: 1 },
  configButtonTitle: { fontSize: 16, fontWeight: '700', color: '#ffffff', marginBottom: 2 },
  configButtonSubtitle: { fontSize: 12, color: 'rgba(255, 255, 255, 0.9)' },
  configButtonArrow: { fontSize: 20, color: '#ffffff', fontWeight: '700' },

  // Fixed Bottom Action Button - Save configuration button pinned to bottom with gradient background
  fixedBottomContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingHorizontal: 20, paddingVertical: 12, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 8, ...(Platform.OS === 'web' && { position: 'fixed' }) },
  fixedBottomButton: { borderRadius: 12, overflow: 'hidden', shadowColor: '#10b981', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  fixedBottomButtonGradient: { paddingVertical: 16, alignItems: 'center' },
  fixedBottomButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  fixedBottomButtonSubtext: { color: '#ffffff', fontSize: 12, fontWeight: '400', marginTop: 4, opacity: 0.9 },

  // Scroll Container - Wrapper for scrollable content area with web overflow handling
  scrollWrapper: { flex: 1, ...(Platform.OS === 'web' && { overflow: 'hidden', position: 'relative' }) },
  content: { flex: 1, paddingHorizontal: 20, ...(Platform.OS === 'web' && { overflow: 'scroll', overflowX: 'hidden', overflowY: 'auto', WebkitOverflowScrolling: 'touch', height: '100%' }) },
  contentContainer: { paddingBottom: 120 },
  variableList: { gap: 12, paddingTop: 20 },
  scrollBottomPadding: { height: 40 },

  // Variable Cards - Individual cards displaying antenna design variables with min/max values
  variableCard: { backgroundColor: '#ffffff', borderRadius: 12, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, borderLeftWidth: 3 },
  variableCardOptimizing: { borderLeftColor: '#10b981', backgroundColor: '#ffffff' },
  variableCardExcluded: { borderLeftColor: '#ef4444', backgroundColor: '#fef2f2', opacity: 0.7 },
  variableHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  variableInfo: { flex: 1 },
  variableNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  variableName: { fontSize: 16, fontWeight: '600', color: '#1e293b' },
  variableNameExcluded: { color: '#94a3b8', textDecorationLine: 'line-through' },
  materialBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 1, borderColor: '#fbbf24' },
  materialBadgeText: { fontSize: 10, fontWeight: '700', color: '#92400e', letterSpacing: 0.5 },
  variableDescription: { fontSize: 13, color: '#64748b' },
  variableDescriptionExcluded: { color: '#cbd5e1' },
  variableDetails: { gap: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'center' },
  detailLabel: { fontSize: 12, fontWeight: '500', color: '#64748b', width: 60 },
  detailValue: { fontSize: 12, color: '#1e293b', fontWeight: '600' },
  detailValueExcluded: { color: '#cbd5e1' },

  // Loading & Error States - Centered feedback screens for data loading and error handling
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { fontSize: 16, color: '#64748b', textAlign: 'center' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { fontSize: 18, fontWeight: '600', color: '#dc2626', marginBottom: 8, textAlign: 'center' },
  errorDetail: { fontSize: 14, color: '#64748b', marginBottom: 24, textAlign: 'center' },
  errorButton: { backgroundColor: '#8b5cf6', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  errorButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});