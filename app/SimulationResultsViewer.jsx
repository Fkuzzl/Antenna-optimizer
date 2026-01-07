import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, Dimensions } from "react-native";
import { LinearGradient } from 'expo-linear-gradient';
import AppConfig, { PathUtils, showAlert } from './app_config';

export default function SimulationResultsViewer({ onBack, projectPath = null }) {
  const [simulationResults, setSimulationResults] = useState({
    iterations: [],
    summary: {
      totalIterations: 0,
      s11Available: false,
      arAvailable: false,
      gainAvailable: false
    }
  });
  const [isLoading, setIsLoading] = useState(false);

  // Server configuration - load from centralized config
  const MATLAB_SERVER_URL = AppConfig.serverUrl;

  // Get project directory from projectPath using PathUtils
  const getProjectDirectory = () => {
    if (!projectPath) return null;
    return PathUtils.getProjectRoot(projectPath);
  };

  const loadSimulationResults = async () => {
    setIsLoading(true);
    
    try {
      const projectDir = getProjectDirectory();
      
      if (!projectDir) {
        showAlert('Error', 'Project path not available. Please ensure a project is selected.');
        setIsLoading(false);
        return;
      }

      console.log('🔄 Loading latest simulation results...');
      
      // ALWAYS recreate Excel file from latest CSV data first to ensure fresh results
      console.log('📝 Creating/updating integrated Excel from latest CSV files...');
      const createResponse = await fetch(`${MATLAB_SERVER_URL}/api/integrated-results/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: projectDir })
      });
      
      if (!createResponse.ok) {
        console.warn('⚠️ Failed to create/update Excel file');
        // Continue to try reading existing file
      } else {
        const createResult = await createResponse.json();
        console.log('✅ Excel file created/updated:', createResult.message);
      }
      
      // Now load the results from the updated Excel file
      console.log('📖 Reading integrated results from Excel...');
      
      // Add timeout control for loading results
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout for loading

      const response = await fetch(`${MATLAB_SERVER_URL}/api/integrated-results/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectPath: projectDir
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        setSimulationResults(result.data);
        showAlert('Success', `Latest results loaded successfully!\n\n📊 ${result.data.iterations.length} iterations found\n🎯 Auto-updated from CSV files`);
      } else {
        // Fallback to old method if integrated Excel not available
        await loadResultsFromManualPath();
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('⏱️ Results loading timed out - server may be busy');
        showAlert('Timeout', 'Loading results timed out. Server may be busy. Please try again.');
      } else {
        console.error('Error loading integrated results:', error);
        showAlert('Connection Error', 'Could not connect to server to load results.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Fallback method for manual path results loading
  const loadResultsFromManualPath = async () => {
    try {
      const response = await fetch(`${MATLAB_SERVER_URL}/api/simulation/results`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectPath: projectDir
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        setSimulationResults(result.data);
        showAlert('Success', 'Simulation results loaded successfully from manual path!');
      } else {
        showAlert('Error', result.message || 'No simulation data found. Try creating the integrated Excel cache first.');
      }
    } catch (error) {
      console.error('Error loading manual path results:', error);
      showAlert('No Data Found', 'No integrated Excel file or manual CSV files found.\n\nTo use this feature:\n1. Run MATLAB optimization to generate CSV files\n2. The system will automatically create an integrated Excel cache');
    }
  };

  const refreshResults = async () => {
    setIsLoading(true);
    
    try {
      const projectDir = getProjectDirectory();
      
      if (!projectDir) {
        showAlert('Error', 'Project path not available. Please ensure a project is selected.');
        setIsLoading(false);
        return;
      }

      console.log('🔄 Refreshing simulation results from latest CSV files...');
      
      // First, recreate the Excel file from latest CSV data
      console.log('📝 Recreating integrated Excel from latest CSV files...');
      const createResponse = await fetch(`${MATLAB_SERVER_URL}/api/integrated-results/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: projectDir })
      });
      
      if (!createResponse.ok) {
        console.warn('⚠️ Failed to recreate Excel, attempting to read existing file...');
      } else {
        const createResult = await createResponse.json();
        console.log('✅ Excel file recreated:', createResult.message);
      }
      
      // Then load the updated results
      await loadSimulationResults();
      
    } catch (error) {
      console.error('❌ Error refreshing results:', error);
      showAlert(
        'Refresh Failed',
        `Could not refresh simulation results: ${error.message}`
      );
      setIsLoading(false);
    }
  };

  // Removed automatic iteration checking to prevent duplicate logs
  // MatlabProjectRunner already handles iteration tracking efficiently



  const formatFrequency = (freq) => {
    return `${freq} GHz`;
  };

  const formatResult = (value) => {
    if (value === null || value === undefined) return 'N/A';
    if (typeof value === 'number') {
      return value.toFixed(3);
    }
    return value.toString();
  };

  const IterationCard = ({ iteration, frequencies, s11, ar, gain }) => {
    return (
      <View style={styles.iterationCard}>
        <LinearGradient
          colors={['#f8fafc', '#e2e8f0']}
          style={styles.iterationCardGradient}
        >
          <Text style={styles.iterationTitle}>Iteration {iteration}</Text>
          <View style={styles.iterationGrid}>
            {frequencies.map((freq, freqIndex) => (
              <View key={freqIndex} style={styles.frequencySection}>
                <Text style={styles.frequencyHeader}>{formatFrequency(freq)}</Text>
                <View style={styles.parameterRow}>
                  <Text style={styles.parameterLabel}>S11:</Text>
                  <Text style={styles.parameterValue}>
                    {s11 && s11[freqIndex] !== undefined ? `${formatResult(s11[freqIndex])} dB` : 'N/A'}
                  </Text>
                </View>
                <View style={styles.parameterRow}>
                  <Text style={styles.parameterLabel}>AR:</Text>
                  <Text style={styles.parameterValue}>
                    {ar && ar[freqIndex] !== undefined ? `${formatResult(ar[freqIndex])}` : 'N/A'}
                  </Text>
                </View>
                <View style={styles.parameterRow}>
                  <Text style={styles.parameterLabel}>Gain:</Text>
                  <Text style={styles.parameterValue}>
                    {gain && gain[freqIndex] !== undefined ? `${formatResult(gain[freqIndex])} dBi` : 'N/A'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </LinearGradient>
      </View>
    );
  };



  return (
    <View style={styles.container}>
      {/* Fixed Header */}
      <View style={styles.fixedHeader}>
        <LinearGradient colors={['#667eea', '#764ba2']} style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Simulation Results</Text>
          
          {/* Smaller Action Button in Header */}
          {simulationResults.iterations.length === 0 ? (
            <TouchableOpacity 
              onPress={loadSimulationResults} 
              style={styles.headerActionButton}
              disabled={isLoading}
            >
              <Text style={styles.headerActionButtonText}>
                {isLoading ? '⏳' : '📥'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              onPress={refreshResults} 
              style={styles.headerActionButton}
              disabled={isLoading}
            >
              <Text style={styles.headerActionButtonText}>
                {isLoading ? '⏳' : '🔄'}
              </Text>
            </TouchableOpacity>
          )}
        </LinearGradient>
      </View>

      {/* Single Unified Scrollable Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={true}>
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>📊 Simulation Results Viewer</Text>
          <Text style={styles.infoText}>
            View S11, AR, and Gain results from MATLAB/HFSS optimization iterations. Frequencies are automatically detected from CSV files.
          </Text>
          <Text style={styles.pathInfo}>
            📁 Project: {projectPath ? projectPath.split('\\').pop() : 'Not specified'}
          </Text>
          {/* Simplified status - no real-time checking to avoid log spam */}
          {simulationResults.iterations.length > 0 && (
            <View style={styles.iterationStatus}>
              <Text style={styles.iterationStatusText}>
                Loaded: {simulationResults.iterations.length} iteration{simulationResults.iterations.length !== 1 ? 's' : ''} from cache
              </Text>
            </View>
          )}
        </View>

        {/* Compact Action Button - Smaller Size */}
        <View style={styles.compactActionSection}>
          {simulationResults.iterations.length === 0 ? (
            <TouchableOpacity 
              onPress={loadSimulationResults} 
              style={styles.compactActionButton}
              disabled={isLoading}
            >
              <LinearGradient
                colors={isLoading ? ['#94a3b8', '#64748b'] : ['#3b82f6', '#1d4ed8']}
                style={styles.compactActionButtonGradient}
              >
                <Text style={styles.compactActionButtonText}>
                  {isLoading ? '⏳ Loading Latest...' : '📥 Load Latest Results'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              onPress={refreshResults} 
              style={styles.compactActionButton}
              disabled={isLoading}
            >
              <LinearGradient
                colors={isLoading ? ['#94a3b8', '#64748b'] : ['#10b981', '#059669']}
                style={styles.compactActionButtonGradient}
              >
                <Text style={styles.compactActionButtonText}>
                  {isLoading ? '⏳ Refreshing...' : '🔄 Refresh Results'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>

        {/* Combined Results Section */}
        {simulationResults.iterations.length > 0 ? (
          <View style={styles.unifiedResultsSection}>
            {/* Summary Header */}
            <View style={styles.resultsSummaryHeader}>
              <Text style={styles.resultsSectionTitle}>
                📈 Simulation Results ({simulationResults.summary.totalIterations} iterations)
              </Text>
              <Text style={styles.summaryInfoText}>
                Available: {simulationResults.summary.s11Available ? '✅ S11' : '❌ S11'} • {simulationResults.summary.arAvailable ? '✅ AR' : '❌ AR'} • {simulationResults.summary.gainAvailable ? '✅ Gain' : '❌ Gain'}
              </Text>
            </View>

            {/* Iterations List */}
            {simulationResults.iterations.map((iterData, index) => (
              <IterationCard
                key={index}
                iteration={iterData.iteration}
                frequencies={iterData.frequencies}
                s11={iterData.s11}
                ar={iterData.ar}
                gain={iterData.gain}
              />
            ))}
          </View>
        ) : (
          <View style={styles.noDataSection}>
            <Text style={styles.noDataTitle}>📄 No Results Loaded</Text>
            <Text style={styles.noDataText}>
              Click "Load Results" to fetch the latest simulation data from Excel files.
            </Text>
            <Text style={styles.noDataHint}>
              Debug: Iterations count = {simulationResults.iterations.length}
            </Text>
            <Text style={styles.noDataHint}>
              💡 Make sure the data path contains the S11, AR, and Gain Excel files.
            </Text>
          </View>
        )}
      </ScrollView>
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
    ...Platform.select({
      android: {
        paddingTop: 0,
      },
    }),
  },
  fixedHeader: {
    position: 'relative',
    zIndex: 1000,
  },
  header: {
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 50 : 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 10,
  },
  backButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40, // Same width as back button to keep title centered
  },
  headerActionButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  headerActionButtonText: {
    fontSize: 18,
    color: 'white',
  },
  settingsButton: {
    padding: 10,
  },
  settingsButtonText: {
    fontSize: 18,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    ...(Platform.OS === 'web' && {
      overflow: 'scroll',
      overflowX: 'hidden',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      height: '100%',
      maxHeight: 'calc(100vh - 120px)', // Account for fixed header
    }),
  },
  settingsContent: {
    flex: 1,
    padding: 20,
  },
  infoSection: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 12,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
    marginBottom: 10,
  },
  pathInfo: {
    fontSize: 12,
    color: '#9ca3af',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  iterationStatus: {
    backgroundColor: '#f0f9ff',
    padding: 12,
    borderRadius: 8,
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#0ea5e9',
  },
  iterationStatusText: {
    fontSize: 13,
    color: '#0c4a6e',
    fontWeight: '600',
    marginBottom: 4,
  },
  iterationDetailText: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  compactActionSection: {
    marginVertical: 10,
    zIndex: 999,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  compactActionButton: {
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
  },
  compactActionButtonGradient: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  compactActionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  unifiedResultsSection: {
    marginBottom: 20,
  },
  resultsSummaryHeader: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  loadButton: {
    width: '100%',
    marginBottom: 10,
    minHeight: 50,
    ...Platform.select({
      ios: {
        shadowColor: '#3b82f6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  loadButtonGradient: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  loadButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },

  refreshButton: {
    width: '100%',
    minHeight: 50,
    ...Platform.select({
      ios: {
        shadowColor: '#059669',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  refreshButtonGradient: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  refreshButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  resultsSection: {
    marginBottom: 20,
  },
  resultsSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 8,
  },
  resultCard: {
    marginBottom: 15,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  resultCardGradient: {
    padding: 20,
  },
  resultCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: 15,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  frequencyLabel: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  resultValue: {
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  summarySection: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 12,
    marginTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: 15,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  summaryCard: {
    backgroundColor: '#f9fafb',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    minWidth: '30%',
    alignItems: 'center',
  },
  summaryFreq: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 2,
  },
  noDataSection: {
    backgroundColor: 'white',
    padding: 30,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  noDataTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: 10,
  },
  noDataText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 10,
  },
  noDataHint: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  settingSection: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: 10,
  },
  pathInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#f9fafb',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  frequencyInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  frequencyInputLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginRight: 10,
    minWidth: 80,
  },
  frequencyInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    backgroundColor: '#f9fafb',
    flex: 1,
    marginRight: 10,
    textAlign: 'center',
  },
  unitLabel: {
    fontSize: 14,
    color: '#6b7280',
    minWidth: 30,
  },
  saveButton: {
    marginTop: 20,
  },
  saveButtonGradient: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  iterationCard: {
    marginBottom: 15,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  iterationCardGradient: {
    padding: 20,
  },
  iterationTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: 15,
    textAlign: 'center',
  },
  iterationGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  frequencySection: {
    flex: 1,
    marginHorizontal: 5,
    backgroundColor: '#ffffff',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  frequencyHeader: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 8,
  },
  parameterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 4,
  },
  parameterLabel: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  parameterValue: {
    fontSize: 12,
    color: '#1f2937',
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  summaryInfoText: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'left',
    fontWeight: '500',
  },
});