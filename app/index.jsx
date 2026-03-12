import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Dimensions, Image, Platform, TextInput, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MatlabProjectRunner from './MatlabProjectRunner';
import SettingsPage from './SettingsPage';
import AboutPage from './AboutPage';
import ProgressiveTuningSetup from './ProgressiveTuningSetup';
import ProgressiveTuningProgress from './ProgressiveTuningProgress';
import ProgressiveTuningResults from './ProgressiveTuningResults';
import AppConfig from './app_config';
import { ModalProvider, useModal } from './InAppModal';

const { width, height } = Dimensions.get('window');

// Outer wrapper that provides the modal context
const App = () => (
  <ModalProvider>
    <HomePage />
  </ModalProvider>
);

const HomePage = () => {
  const { alert: modalAlert, showBusy } = useModal();
  const [currentPage, setCurrentPage] = useState('home');
  // Progressive tuning state
  const [tuningProjectPath, setTuningProjectPath] = useState('');
  const [tuningResultsData, setTuningResultsData] = useState(null);
  const [checkingTuningStatus, setCheckingTuningStatus] = useState(false);
  const [checkingMatlabStatus, setCheckingMatlabStatus] = useState(false);

  /**
   * Check if MATLAB optimization is currently running.
   * Returns true if running, false otherwise.
   */
  const isMatlabOptimizationRunning = useCallback(async () => {
    try {
      const response = await fetch(`${AppConfig.serverUrl}/api/matlab/status`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      return !!(data.execution && data.execution.isRunning);
    } catch {
      return false;
    }
  }, []);

  /**
   * Check if progressive tuning is currently running.
   * Returns { running: boolean, projectPath?: string }
   */
  const isProgressiveTuningRunning = useCallback(async () => {
    try {
      const response = await fetch(`${AppConfig.serverUrl}/api/progressive-tuning/status`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (data.success && data.data) {
        const managerStatus = data.data.manager?.status || data.data.status;
        if (managerStatus === 'running' || managerStatus === 'paused') {
          return { running: true, projectPath: data.data.manager?.projectPath };
        }
      }
      return { running: false };
    } catch {
      return { running: false };
    }
  }, []);

  /**
   * Navigate to MATLAB optimization — but first check if Progressive Tuning is running.
   * If it is, show an in-app popup with a navigate button instead.
   */
  const handleOptimizationPress = useCallback(async () => {
    setCheckingMatlabStatus(true);
    try {
      const tuning = await isProgressiveTuningRunning();
      if (tuning.running) {
        showBusy({
          title: 'Machine Busy',
          message: 'Progressive Tuning is currently running on this machine. You cannot start Antenna Optimization while tuning is in progress.',
          navigateLabel: 'Go to Progressive Tuning',
          onNavigate: () => {
            if (tuning.projectPath) setTuningProjectPath(tuning.projectPath);
            setCurrentPage('progressiveTuningProgress');
          },
        });
        return;
      }
    } catch (err) {
      console.log('Could not check tuning status:', err.message);
    } finally {
      setCheckingMatlabStatus(false);
    }
    setCurrentPage('matlab');
  }, [isProgressiveTuningRunning, showBusy]);

  /**
   * Check if a tuning session is already active on the server.
   * Also checks if MATLAB optimization is running — if so, block entry.
   * Note: Progressive Tuning itself uses MATLAB, so we check tuning status
   * FIRST — if tuning is already running, those MATLAB processes belong to
   * tuning and should not trigger the mutual-exclusion block.
   */
  const handleProgressiveTuningPress = useCallback(async () => {
    setCheckingTuningStatus(true);
    try {
      // Check if a tuning session is already active FIRST
      const response = await fetch(`${AppConfig.serverUrl}/api/progressive-tuning/status`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (data.success && data.data) {
        const managerStatus = data.data.manager?.status || data.data.status;
        if (managerStatus === 'running' || managerStatus === 'paused') {
          // Tuning is already active — go straight to progress page
          if (data.data.manager?.projectPath) {
            setTuningProjectPath(data.data.manager.projectPath);
          }
          setCurrentPage('progressiveTuningProgress');
          return;
        }
        if (managerStatus === 'completed' || managerStatus === 'error' || managerStatus === 'cancelled') {
          // Tuning finished but server not yet reset — re-enter progress page
          // which will detect the final status immediately and transition to results.
          if (data.data.manager?.projectPath) {
            setTuningProjectPath(data.data.manager.projectPath);
          }
          setCurrentPage('progressiveTuningProgress');
          return;
        }
      }

      // No tuning session active — NOW check if MATLAB optimization is running
      const matlabRunning = await isMatlabOptimizationRunning();
      if (matlabRunning) {
        showBusy({
          title: 'Machine Busy',
          message: 'Antenna Optimization (MATLAB) is currently running on this machine. You cannot start Progressive Tuning while optimization is in progress.',
          navigateLabel: 'Go to Antenna Optimization',
          onNavigate: () => setCurrentPage('matlab'),
        });
        return;
      }
    } catch (err) {
      console.log('Could not check tuning status:', err.message);
    } finally {
      setCheckingTuningStatus(false);
    }
    // No active session — go to setup
    setCurrentPage('progressiveTuningSetup');
  }, [isMatlabOptimizationRunning, showBusy]);

  /**
   * Apply tightened variable ranges from progressive tuning, then open MOEA/D runner.
   * Seed domain is [-1, 1]: the server rewrites F_Model_Element.m with the narrowed
   * multiplier/offset. F_GND_Import.m is left untouched (set during tuning setup).
   */
  const handleRunMoeadWithTightened = useCallback(async (results) => {
    if (!results?.tightened_ranges || Object.keys(results.tightened_ranges).length === 0) {
      modalAlert('No Tightened Ranges', 'No tightened ranges were found in the results. Cannot set up MOEA/D.');
      return;
    }
    try {
      const response = await fetch(`${AppConfig.serverUrl}/api/matlab/apply-tightened-variables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: tuningProjectPath,
          tightenedRanges: results.tightened_ranges,
          gndConfig: results.GND_config || results.gnd_config || results.manager?.gndConfig || null,
        }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message || 'Server error');
      // Update the stored project path in case it was resolved server-side
      if (data.projectPath) setTuningProjectPath(data.projectPath);
      setCurrentPage('matlabFromTuning');
    } catch (err) {
      modalAlert('Setup Failed', `Could not apply tightened ranges:\n${err.message}`);
    }
  }, [tuningProjectPath, modalAlert]);

  // Navigation functions
  const navigateToPage = (page) => {
    setCurrentPage(page);
  };

  const navigateHome = () => {
    setCurrentPage('home');
  };

  // Render different pages based on current selection
  if (currentPage === 'matlab') {
    return <MatlabProjectRunner onBack={navigateHome} />;
  }

  if (currentPage === 'matlabFromTuning') {
    return <MatlabProjectRunner onBack={navigateHome} initialProjectPath={tuningProjectPath} autoStart={true} />;
  }

  if (currentPage === 'settings') {
    return <SettingsPage onBack={navigateHome} />;
  }

  if (currentPage === 'about') {
    return <AboutPage onBack={navigateHome} />;
  }

  if (currentPage === 'progressiveTuningSetup') {
    return (
      <ProgressiveTuningSetup
        onBack={navigateHome}
        projectPath={tuningProjectPath}
        onSetProjectPath={setTuningProjectPath}
        onStart={() => setCurrentPage('progressiveTuningProgress')}
        onRunMoead={handleRunMoeadWithTightened}
      />
    );
  }

  if (currentPage === 'progressiveTuningProgress') {
    return (
      <ProgressiveTuningProgress
        onBack={navigateHome}
        projectPath={tuningProjectPath}
        onComplete={(data) => {
          setTuningResultsData(data);
          setCurrentPage('progressiveTuningResults');
        }}
      />
    );
  }

  if (currentPage === 'progressiveTuningResults') {
    return (
      <ProgressiveTuningResults
        onBack={navigateHome}
        statusData={tuningResultsData}
        onRunMoead={handleRunMoeadWithTightened}
        onRerun={() => {
          setTuningResultsData(null);
          setCurrentPage('progressiveTuningSetup');
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1e40af" />
      
      {/* Enhanced Header with Gradient */}
      <LinearGradient
        colors={['#1e40af', '#3b82f6', '#60a5fa']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerContent}>
          <Image 
            source={require('../assets/index_icon.webp')} 
            style={styles.headerIconImage}
            resizeMode="contain"
          />
          <Text style={styles.appTitle}>Antenna Optimizer</Text>
          <Text style={styles.appSubtitle}>Control MATLAB simulations • Monitor HFSS processes • View results in real-time</Text>
        </View>
      </LinearGradient>

      <View style={styles.scrollWrapper}>
        <ScrollView 
          style={styles.content} 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
        >
        {/* Spacer */}
        <View style={styles.spacer} />

        {/* Main Action Card */}
        <View style={styles.actionSection}>
          <TouchableOpacity 
            style={styles.primaryCard}
            onPress={handleOptimizationPress}
            disabled={checkingMatlabStatus}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#10b981', '#059669', '#047857']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryCardGradient}
            >
              <View style={styles.primaryCardContent}>
                <View style={styles.primaryCardHeader}>
                  <View style={styles.primaryCardIcon}>
                    <Image 
                      source={require('../assets/Matlab_Logo.png')} 
                      style={styles.primaryCardIconImage}
                      resizeMode="contain"
                    />
                  </View>
                  <View style={styles.primaryCardTexts}>
                    <Text style={styles.primaryCardTitle}>Run Antenna Optimization</Text>
                    <Text style={styles.primaryCardSubtitle}>Execute MATLAB Live Scripts and monitor HFSS simulations</Text>
                  </View>
                  <View style={styles.primaryCardArrow}>
                    <Text style={styles.primaryCardArrowText}>→</Text>
                  </View>
                </View>
                
                <View style={styles.primaryCardFeatures}>
                  <Text style={styles.primaryCardFeature}>✨ Visual MATLAB UI</Text>
                  <Text style={styles.primaryCardFeature}>📈 Track Iterations</Text>
                  <Text style={styles.primaryCardFeature}>🎛️ Start/Stop Control</Text>
                </View>
                {checkingMatlabStatus && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                    <ActivityIndicator size="small" color="#ffffff" />
                    <Text style={{ color: '#ffffff', marginLeft: 8, fontSize: 12 }}>Checking for active processes...</Text>
                  </View>
                )}
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Progressive Tuning Card */}
        <View style={styles.actionSection}>
          <TouchableOpacity 
            style={styles.primaryCard}
            onPress={handleProgressiveTuningPress}
            disabled={checkingTuningStatus}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#7c3aed', '#6d28d9', '#5b21b6']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryCardGradient}
            >
              <View style={styles.primaryCardContent}>
                <View style={styles.primaryCardHeader}>
                  <View style={[styles.primaryCardIcon, { backgroundColor: 'rgba(255, 255, 255, 0.2)' }]}>
                    <Text style={styles.primaryCardIconText}>📡</Text>
                  </View>
                  <View style={styles.primaryCardTexts}>
                    <Text style={styles.primaryCardTitle}>Progressive Tuning</Text>
                    <Text style={styles.primaryCardSubtitle}>Pre-optimize antenna parameters before MOEA/D</Text>
                  </View>
                  <View style={styles.primaryCardArrow}>
                    <Text style={styles.primaryCardArrowText}>→</Text>
                  </View>
                </View>
                
                <View style={styles.primaryCardFeatures}>
                  <Text style={styles.primaryCardFeature}>🎯 3-Phase Tuning</Text>
                  <Text style={styles.primaryCardFeature}>⚡ 3-7x Speedup</Text>
                  <Text style={styles.primaryCardFeature}>📐 Range Tightening</Text>
                </View>
                {checkingTuningStatus && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                    <ActivityIndicator size="small" color="#ffffff" />
                    <Text style={{ color: '#ffffff', marginLeft: 8, fontSize: 12 }}>Checking for active session...</Text>
                  </View>
                )}
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Secondary Actions */}
        <View style={styles.secondarySection}>
          <Text style={styles.sectionTitle}>Tools & Settings</Text>
          
          <View style={styles.secondaryGrid}>
            <TouchableOpacity 
              style={styles.secondaryCard}
              onPress={() => navigateToPage('settings')}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['#ffffff', '#f8fafc']}
                style={styles.secondaryCardGradient}
              >
                <View style={styles.secondaryCardIcon}>
                  <LinearGradient
                    colors={['#6366f1', '#4f46e5']}
                    style={styles.secondaryIconGradient}
                  >
                    <Text style={styles.secondaryCardIconText}>⚙️</Text>
                  </LinearGradient>
                </View>
                <Text style={styles.secondaryCardTitle}>Configuration</Text>
                <Text style={styles.secondaryCardDescription}>Server connection & system paths</Text>
              </LinearGradient>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.secondaryCard}
              onPress={() => navigateToPage('about')}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['#ffffff', '#f8fafc']}
                style={styles.secondaryCardGradient}
              >
                <View style={styles.secondaryCardIcon}>
                  <LinearGradient
                    colors={['#f59e0b', '#d97706']}
                    style={styles.secondaryIconGradient}
                  >
                    <Text style={styles.secondaryCardIconText}>ℹ️</Text>
                  </LinearGradient>
                </View>
                <Text style={styles.secondaryCardTitle}>About</Text>
                <Text style={styles.secondaryCardDescription}>Features, version, & how to use</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>
      </View>
    </View>
  );


};

const styles = StyleSheet.create({
  // Main Container - Root layout with full height and background color
  container: { flex: 1, backgroundColor: '#f1f5f9', ...(Platform.OS === 'web' && { height: '100vh', maxHeight: '100vh', overflow: 'hidden' }) },

  // Header Section - Blue gradient header with app icon, title, subtitle and status indicators
  header: { paddingTop: 60, paddingBottom: 30, paddingHorizontal: 20 },
  headerContent: { alignItems: 'center' },
  headerIconImage: { width: 50, height: 50, marginBottom: 15 },
  appTitle: { fontSize: 32, fontWeight: '800', color: '#ffffff', textAlign: 'center', marginBottom: 8, textShadowColor: 'rgba(0, 0, 0, 0.3)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 },
  appSubtitle: { fontSize: 16, color: 'rgba(255, 255, 255, 0.9)', textAlign: 'center', marginBottom: 20, fontWeight: '500' },
  statusRow: { flexDirection: 'row', gap: 20 },
  statusItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10b981', marginRight: 6 },
  statusIcon: { fontSize: 12, marginRight: 6 },
  statusText: { fontSize: 12, color: '#ffffff', fontWeight: '600' },

  // Scroll Container - Wrapper for scrollable content area with web overflow handling
  scrollWrapper: { flex: 1, ...(Platform.OS === 'web' && { overflow: 'hidden', position: 'relative' }) },
  content: { flex: 1, ...(Platform.OS === 'web' && { overflow: 'scroll', overflowX: 'hidden', overflowY: 'auto', WebkitOverflowScrolling: 'touch', height: '100%' }) },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  spacer: { height: 40 },

  // Hero Section - Welcome card with icon and description text
  heroSection: { marginTop: -20, marginBottom: 20 },
  heroCard: { borderRadius: 16, padding: 20, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 6 },
  heroIcon: { marginBottom: 15 },
  heroIconGradient: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', shadowColor: '#10b981', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  heroIconText: { fontSize: 24, color: '#ffffff' },
  welcomeDescription: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 20 },

  // Primary Action Card - Main MATLAB runner card with gradient, icon, features
  actionSection: { marginBottom: 20 },
  primaryCard: { borderRadius: 20, overflow: 'hidden', shadowColor: '#10b981', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 12 },
  primaryCardGradient: { padding: 28 },
  primaryCardContent: { gap: 16 },
  primaryCardHeader: { flexDirection: 'row', alignItems: 'center' },
  primaryCardIcon: { width: 50, height: 50, backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  primaryCardIconText: { fontSize: 20, color: '#ffffff' },
  primaryCardIconImage: { width: 30, height: 30 },
  primaryCardTexts: { flex: 1 },
  primaryCardTitle: { fontSize: 20, fontWeight: '700', color: '#ffffff', marginBottom: 4 },
  primaryCardSubtitle: { fontSize: 14, color: 'rgba(255, 255, 255, 0.8)', fontWeight: '500' },
  primaryCardArrow: { width: 32, height: 32, backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  primaryCardArrowText: { fontSize: 16, color: '#ffffff', fontWeight: 'bold' },
  primaryCardFeatures: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.2)' },
  primaryCardFeature: { fontSize: 12, color: 'rgba(255, 255, 255, 0.9)', fontWeight: '500' },

  // Secondary Cards - Settings and About cards with icons and descriptions
  secondarySection: { marginBottom: 25 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1e293b', marginBottom: 16, paddingHorizontal: 4 },
  secondaryGrid: { flexDirection: 'row', gap: 12 },
  secondaryCard: { flex: 1, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 6 },
  secondaryCardGradient: { padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  secondaryCardIcon: { marginBottom: 12 },
  secondaryIconGradient: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  secondaryCardIconText: { fontSize: 18, color: '#ffffff' },
  secondaryCardTitle: { fontSize: 16, fontWeight: '600', color: '#1e293b', textAlign: 'center', marginBottom: 6 },
  secondaryCardDescription: { fontSize: 12, color: '#64748b', textAlign: 'center', lineHeight: 16 },

  // Stats Section - System statistics with gradient backgrounds
  statsSection: { marginBottom: 20 },
  statsGrid: { flexDirection: 'row', gap: 12 },
  statCard: { flex: 1, borderRadius: 12, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6 },
  statCardGradient: { paddingVertical: 16, paddingHorizontal: 12, alignItems: 'center' },
  statNumber: { fontSize: 20, fontWeight: '700', color: '#ffffff', marginBottom: 4 },
  statLabel: { fontSize: 11, color: 'rgba(255, 255, 255, 0.9)', fontWeight: '500', textAlign: 'center' },
});

export default App;