import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, Modal } from "react-native";
import { LinearGradient } from 'expo-linear-gradient';
import AppConfig, { PathUtils, showAlert } from './app_config';

export default function SimulationResultsViewer({ onBack, projectPath = null }) {
  const [simulationResults, setSimulationResults] = useState({
    iterations: [],
    summary: { totalIterations: 0, s11Available: false, arAvailable: false, gainAvailable: false }
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showOutdatedModal, setShowOutdatedModal] = useState(false);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  
  const timerRef = useRef(null);
  const loadTimeRef = useRef(null);

  const MATLAB_SERVER_URL = AppConfig.serverUrl;
  const OUTDATED_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  // Timer management
  useEffect(() => {
    // Start timer when data is loaded
    if (simulationResults.iterations.length > 0 && !showOutdatedModal) {
      loadTimeRef.current = Date.now();
      
      // Clear any existing timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - loadTimeRef.current;
        const minutes = Math.floor(elapsed / 60000);
        setElapsedMinutes(minutes);
        
        if (elapsed >= OUTDATED_THRESHOLD_MS) {
          setShowOutdatedModal(true);
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      }, 10000); // Check every 10 seconds
      
      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    }
  }, [simulationResults.iterations.length, showOutdatedModal]);

  const getProjectDirectory = () => {
    if (!projectPath) return null;
    return PathUtils.getProjectRoot(projectPath);
  };

  const resetTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedMinutes(0);
    setShowOutdatedModal(false);
    loadTimeRef.current = Date.now();
  };

  const updateExcelFromCSV = async () => {
    try {
      const projectDir = getProjectDirectory();
      if (!projectDir) {
        showAlert('Error', 'Project path not available.');
        return false;
      }

      console.log('🔄 Updating Excel from CSV files...');
      
      const response = await fetch(`${MATLAB_SERVER_URL}/api/integrated-results/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: projectDir })
      });

      const result = await response.json();
      
      if (result.success) {
        console.log('✅ Excel updated:', result.output);
        return true;
      } else {
        console.error('❌ Update failed:', result.message);
        showAlert('Update Failed', result.message || 'Could not update Excel file');
        return false;
      }
    } catch (error) {
      console.error('❌ Update error:', error);
      showAlert('Error', 'Could not connect to server for update');
      return false;
    }
  };

  const refreshLatestResults = async () => {
    setIsLoading(true);
    resetTimer();
    
    // First update Excel from CSV
    const updated = await updateExcelFromCSV();
    
    if (updated) {
      // Wait a moment for file to be fully written and closed
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Then load the latest page
      await loadPage('last');
    } else {
      // Even if update fails, try to load existing data
      await loadPage('last');
    }
    
    setIsLoading(false);
  };

  const loadPage = async (page = 'last') => {
    // Don't reset timer if we're in loading state already
    if (!isLoading) {
      setIsLoading(true);
      resetTimer(); // Reset timer on manual navigation
    }
    
    try {
      const projectDir = getProjectDirectory();
      if (!projectDir) {
        showAlert('Error', 'Project path not available.');
        return;
      }

      // If 'last' is specified, we need to get total pages first
      let targetPage = page === 'last' ? 1 : page;
      
      console.log(`📖 Loading page ${page === 'last' ? 'latest' : page}...`);

      const response = await fetch(`${MATLAB_SERVER_URL}/api/integrated-results/read-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: projectDir, page: targetPage, pageSize: 100 })
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const result = await response.json();
      
      if (result.success) {
        // If we wanted the last page, load it now
        if (page === 'last' && result.totalPages > 1) {
          // Recursive call to load the actual last page
          await loadPage(result.totalPages);
          return;
        }
        
        setSimulationResults(result.data);
        setCurrentPage(result.page);
        setTotalPages(result.totalPages);
        setHasMore(result.hasMore);
        
        // Show which iterations are displayed
        const firstIter = result.data.iterations[0]?.iteration || 0;
        const lastIter = result.data.iterations[result.data.iterations.length - 1]?.iteration || 0;
        showAlert('Success', `Page ${result.page} of ${result.totalPages}\nShowing iterations ${firstIter}-${lastIter}\n(Total: ${result.data.summary.totalIterations})`);
      } else {
        showAlert('Error', result.message);
      }
    } catch (error) {
      console.error('Error:', error);
      showAlert('Error', 'Could not load results. Ensure Excel file exists.');
    } finally {
      setIsLoading(false);
    }
  };

  const formatFrequency = (freq) => `${freq} GHz`;
  const formatResult = (value) => value == null ? 'N/A' : typeof value === 'number' ? value.toFixed(3) : value.toString();

  const IterationCard = ({ iteration, frequencies, s11, ar, gain }) => (
    <View style={styles.iterationCard}>
      <LinearGradient colors={['#f8fafc', '#e2e8f0']} style={styles.iterationCardGradient}>
        <Text style={styles.iterationTitle}>Iteration {iteration}</Text>
        <View style={styles.iterationGrid}>
          {frequencies.map((freq, idx) => (
            <View key={idx} style={styles.frequencySection}>
              <Text style={styles.frequencyHeader}>{formatFrequency(freq)}</Text>
              <View style={styles.parameterRow}>
                <Text style={styles.parameterLabel}>S11:</Text>
                <Text style={styles.parameterValue}>
                  {s11 && s11[idx] !== undefined ? `${formatResult(s11[idx])} dB` : 'N/A'}
                </Text>
              </View>
              <View style={styles.parameterRow}>
                <Text style={styles.parameterLabel}>AR:</Text>
                <Text style={styles.parameterValue}>
                  {ar && ar[idx] !== undefined ? formatResult(ar[idx]) : 'N/A'}
                </Text>
              </View>
              <View style={styles.parameterRow}>
                <Text style={styles.parameterLabel}>Gain:</Text>
                <Text style={styles.parameterValue}>
                  {gain && gain[idx] !== undefined ? `${formatResult(gain[idx])} dBi` : 'N/A'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </LinearGradient>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Outdated Data Modal */}
      <Modal
        visible={showOutdatedModal}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <LinearGradient
              colors={['#10b981', '#059669']}
              style={styles.modalGradient}
            >
              <View style={styles.iconCircle}>
                <Text style={styles.iconText}>🔄</Text>
              </View>
              <Text style={styles.modalTitle}>MATLAB Antenna Optimizer</Text>
              <Text style={styles.modalSubtitle}>Data might be outdated...</Text>
              
              <View style={styles.loadingDots}>
                <View style={styles.dot} />
                <View style={styles.dot} />
                <View style={styles.dot} />
              </View>

              <TouchableOpacity
                onPress={refreshLatestResults}
                style={styles.refreshButton}
                disabled={isLoading}
              >
                <Text style={styles.refreshButtonText}>
                  {isLoading ? '⏳ Refreshing...' : '🔄 Refresh Latest Results'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setShowOutdatedModal(false)}
                style={styles.dismissButton}
              >
                <Text style={styles.dismissButtonText}>Dismiss</Text>
              </TouchableOpacity>
            </LinearGradient>
          </View>
        </View>
      </Modal>

      <View style={styles.fixedHeader}>
        <LinearGradient colors={['#667eea', '#764ba2']} style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Simulation Results</Text>
          <View style={{ width: 60 }} />
        </LinearGradient>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>📊 Simulation Results (Paginated)</Text>
          <Text style={styles.infoText}>
            Results loaded in pages of 100 iterations. Page 1 = oldest (iter 1-100), last page = newest iterations. Loads latest by default.
          </Text>
          <Text style={styles.pathInfo}>
            📁 Project: {projectPath ? projectPath.split('\\').pop() : 'Not specified'}
          </Text>
          {simulationResults.iterations.length > 0 && (
            <View style={styles.iterationStatus}>
              <Text style={styles.iterationStatusText}>
                Page {currentPage || 1} of {totalPages || 1} • Total: {simulationResults.summary.totalIterations || 0} iterations
              </Text>
              {elapsedMinutes > 0 && (
                <Text style={styles.timerText}>
                  ⏱️ Loaded {elapsedMinutes} min ago {elapsedMinutes >= 4 && '(refresh recommended)'}
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Load Button */}
        {simulationResults.iterations.length === 0 && (
          <TouchableOpacity onPress={() => loadPage('last')} style={styles.actionButton} disabled={isLoading}>
            <LinearGradient colors={isLoading ? ['#94a3b8', '#64748b'] : ['#3b82f6', '#1d4ed8']} style={styles.actionButtonGradient}>
              <Text style={styles.actionButtonText}>{isLoading ? '⏳ Loading...' : '📥 Load Latest Results'}</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* Pagination Controls */}
        {simulationResults.iterations.length > 0 && (
          <View style={styles.paginationContainer}>
            <TouchableOpacity 
              onPress={() => {
                if (currentPage > 1 && !isLoading) {
                  loadPage(currentPage - 1);
                }
              }} 
              style={[styles.pageButton, (currentPage <= 1 || isLoading) && styles.pageButtonDisabled]}
              disabled={currentPage <= 1 || isLoading}
              activeOpacity={currentPage <= 1 || isLoading ? 1 : 0.7}
            >
              <Text style={[styles.pageButtonText, (currentPage <= 1 || isLoading) && styles.pageButtonTextDisabled]}>← Previous</Text>
            </TouchableOpacity>
            
            <Text style={styles.pageInfo}>Page {currentPage || 1} / {totalPages || 1}</Text>
            
            <TouchableOpacity 
              onPress={() => {
                if (currentPage < totalPages && hasMore && !isLoading) {
                  loadPage(currentPage + 1);
                }
              }} 
              style={[styles.pageButton, (currentPage >= totalPages || !hasMore || isLoading) && styles.pageButtonDisabled]}
              disabled={currentPage >= totalPages || !hasMore || isLoading}
              activeOpacity={currentPage >= totalPages || !hasMore || isLoading ? 1 : 0.7}
            >
              <Text style={[styles.pageButtonText, (currentPage >= totalPages || !hasMore || isLoading) && styles.pageButtonTextDisabled]}>Next →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Refresh Latest Button */}
        {simulationResults.iterations.length > 0 && (
          <TouchableOpacity onPress={refreshLatestResults} style={styles.refreshLatestButton} disabled={isLoading}>
            <LinearGradient colors={isLoading ? ['#94a3b8', '#64748b'] : ['#10b981', '#059669']} style={styles.refreshLatestGradient}>
              <Text style={styles.refreshLatestText}>{isLoading ? '⏳ Refreshing...' : '🔄 Refresh Latest Results'}</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* Results */}
        {simulationResults.iterations.length > 0 ? (
          <View style={styles.resultsSection}>
            <View style={styles.resultsSummaryHeader}>
              <Text style={styles.resultsSectionTitle}>
                📈 Showing {simulationResults.iterations.length} iterations
              </Text>
              <Text style={styles.summaryInfoText}>
                {simulationResults.summary.s11Available ? '✅ S11' : '❌ S11'} • 
                {simulationResults.summary.arAvailable ? '✅ AR' : '❌ AR'} • 
                {simulationResults.summary.gainAvailable ? '✅ Gain' : '❌ Gain'}
              </Text>
            </View>

            {simulationResults.iterations.map((iterData, index) => (
              <IterationCard
                key={`${iterData.iteration}-${index}`}
                iteration={iterData.iteration}
                frequencies={iterData.frequencies}
                s11={iterData.s11}
                ar={iterData.ar}
                gain={iterData.gain}
              />
            ))}
          </View>
        ) : !isLoading && (
          <View style={styles.noDataSection}>
            <Text style={styles.noDataTitle}>📄 No Results Loaded</Text>
            <Text style={styles.noDataText}>Click "Load Results" to fetch data from the Excel file.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  fixedHeader: { position: 'relative', zIndex: 1000 },
  header: { padding: 20, paddingTop: Platform.OS === 'ios' ? 50 : 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { padding: 10 },
  backButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  headerTitle: { color: 'white', fontSize: 20, fontWeight: 'bold', flex: 1, textAlign: 'center' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 10 },
  infoSection: { backgroundColor: 'white', padding: 20, borderRadius: 12, marginBottom: 15, elevation: 3 },
  infoTitle: { fontSize: 18, fontWeight: 'bold', color: '#1f2937', marginBottom: 10 },
  infoText: { fontSize: 14, color: '#6b7280', lineHeight: 20, marginBottom: 10 },
  pathInfo: { fontSize: 12, color: '#9ca3af', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  iterationStatus: { backgroundColor: '#f0f9ff', padding: 12, borderRadius: 8, marginTop: 10, borderLeftWidth: 3, borderLeftColor: '#0ea5e9' },
  iterationStatusText: { fontSize: 13, color: '#0c4a6e', fontWeight: '600' },
  timerText: { fontSize: 11, color: '#075985', marginTop: 4, fontStyle: 'italic' },
  actionButton: { width: '100%', borderRadius: 10, overflow: 'hidden', marginBottom: 15 },
  actionButtonGradient: { paddingVertical: 14, alignItems: 'center' },
  actionButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },
  paginationContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  pageButton: { backgroundColor: '#3b82f6', padding: 12, borderRadius: 8, minWidth: 100, alignItems: 'center' },
  pageButtonDisabled: { backgroundColor: '#cbd5e1' },
  pageButtonText: { color: 'white', fontWeight: '600' },
  pageButtonTextDisabled: { color: '#94a3b8' },
  pageInfo: { fontSize: 14, fontWeight: 'bold', color: '#1f2937' },
  refreshLatestButton: { width: '100%', borderRadius: 10, overflow: 'hidden', marginBottom: 15 },
  refreshLatestGradient: { paddingVertical: 14, alignItems: 'center' },
  refreshLatestText: { color: 'white', fontSize: 15, fontWeight: '600' },
  resultsSection: { marginBottom: 20 },
  resultsSummaryHeader: { backgroundColor: 'white', padding: 16, borderRadius: 12, marginBottom: 15, elevation: 2 },
  resultsSectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#1f2937', marginBottom: 8 },
  summaryInfoText: { fontSize: 12, color: '#6b7280', fontWeight: '500' },
  iterationCard: { marginBottom: 15, borderRadius: 12, overflow: 'hidden', elevation: 3 },
  iterationCardGradient: { padding: 20 },
  iterationTitle: { fontSize: 16, fontWeight: 'bold', color: '#374151', marginBottom: 15, textAlign: 'center' },
  iterationGrid: { flexDirection: 'row', justifyContent: 'space-around' },
  frequencySection: { flex: 1, marginHorizontal: 5, backgroundColor: '#ffffff', padding: 12, borderRadius: 8, alignItems: 'center' },
  frequencyHeader: { fontSize: 14, fontWeight: 'bold', color: '#1f2937', marginBottom: 8 },
  parameterRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 4 },
  parameterLabel: { fontSize: 12, color: '#6b7280', fontWeight: '500' },
  parameterValue: { fontSize: 12, color: '#1f2937', fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  noDataSection: { backgroundColor: 'white', padding: 30, borderRadius: 12, alignItems: 'center', elevation: 3 },
  noDataTitle: { fontSize: 18, fontWeight: 'bold', color: '#374151', marginBottom: 10 },
  noDataText: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20 },
  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '85%', maxWidth: 400, borderRadius: 16, overflow: 'hidden', elevation: 10 },
  modalGradient: { padding: 30, alignItems: 'center' },
  iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255, 255, 255, 0.3)', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  iconText: { fontSize: 40 },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: 'white', marginBottom: 8, textAlign: 'center' },
  modalSubtitle: { fontSize: 15, color: 'rgba(255, 255, 255, 0.9)', marginBottom: 20, textAlign: 'center' },
  loadingDots: { flexDirection: 'row', justifyContent: 'center', marginBottom: 30 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255, 255, 255, 0.7)', marginHorizontal: 5 },
  refreshButton: { backgroundColor: 'white', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 10, marginBottom: 12, width: '100%', alignItems: 'center' },
  refreshButtonText: { color: '#059669', fontSize: 16, fontWeight: 'bold' },
  dismissButton: { paddingVertical: 10, paddingHorizontal: 20 },
  dismissButtonText: { color: 'rgba(255, 255, 255, 0.8)', fontSize: 14 },
});
