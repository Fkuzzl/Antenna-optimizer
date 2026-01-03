import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const SettingsPage = ({ onBack }) => {
  const [serverConfig, setServerConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchServerConfig();
  }, []);

  const fetchServerConfig = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/server/config');
      if (response.ok) {
        const data = await response.json();
        setServerConfig(data);
      }
    } catch (error) {
      console.log('Could not fetch server config');
    } finally {
      setLoading(false);
    }
  };

  const openSetupWizard = () => {
    const message = 'To reconfigure settings, run the setup wizard:\n\n' +
                   'Windows: Double-click OPEN_THIS/run_setup.bat\n' +
                   'Command: npm run setup';
    
    if (Platform.OS === 'web') {
      alert(message);
    } else {
      Alert.alert('Run Setup Wizard', message, [{ text: 'OK' }]);
    }
  };

  const InfoItem = ({ icon, label, value }) => (
    <View style={styles.infoItem}>
      <View style={styles.infoHeader}>
        <Text style={styles.infoIcon}>{icon}</Text>
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue}>{value || 'Not configured'}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Enhanced Header with Gradient */}
      <LinearGradient
        colors={['#8b5cf6', '#7c3aed', '#6d28d9']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.headerContent}>
          <View style={styles.headerIcon}>
            <LinearGradient
              colors={['#ffffff', '#f1f5f9']}
              style={styles.headerIconGradient}
            >
              <Text style={styles.headerIconText}>⚙️</Text>
            </LinearGradient>
          </View>
          <Text style={styles.title}>Configuration</Text>
          <Text style={styles.subtitle}>View system settings and server configuration</Text>
        </View>
      </LinearGradient>

      <View style={styles.scrollWrapper}>
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.scrollViewContent}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
        >
        {/* Spacer between header and content */}
        <View style={styles.headerSpacer} />

        {/* Server Configuration Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🖥️ Server Configuration</Text>
          
          {loading ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Loading configuration...</Text>
            </View>
          ) : (
            <>
              <InfoItem
                icon="🌐"
                label="Server Address"
                value={serverConfig?.host || 'localhost'}
              />
              
              <InfoItem
                icon="🔌"
                label="Server Port"
                value={serverConfig?.port?.toString() || '3001'}
              />
              
              <InfoItem
                icon="📱"
                label="Expo Port"
                value={serverConfig?.expo?.port?.toString() || '8081'}
              />
              
              <InfoItem
                icon="🔗"
                label="WebSocket"
                value={serverConfig?.websocket?.enabled ? 'Enabled' : 'Disabled'}
              />
            </>
          )}
        </View>

        {/* System Paths Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📂 System Paths</Text>
          
          <View style={styles.infoCard}>
            <Text style={styles.infoIcon}>ℹ️</Text>
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Configuration Location</Text>
              <Text style={styles.infoText}>
                System paths are configured in:{'\n'}
                OPEN_THIS/SETUP/setup_variable.json{'\n\n'}
                • MATLAB installation path{'\n'}
                • Python executable path{'\n'}
                • Project directories
              </Text>
            </View>
          </View>
        </View>

        {/* Feature Configuration Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⚙️ Feature Settings</Text>
          
          <View style={styles.featureCard}>
            <Text style={styles.featureIcon}>🎯</Text>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Variable Selection</Text>
              <Text style={styles.featureText}>Configure in: Antenna Variable Selector page</Text>
            </View>
          </View>
          
          <View style={styles.featureCard}>
            <Text style={styles.featureIcon}>📐</Text>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Ground Plane</Text>
              <Text style={styles.featureText}>Configure in: Ground Plane Configurator</Text>
            </View>
          </View>
          
          <View style={styles.featureCard}>
            <Text style={styles.featureIcon}>▶️</Text>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>MATLAB Execution</Text>
              <Text style={styles.featureText}>Configure in: MATLAB Project Runner</Text>
            </View>
          </View>
        </View>

        {/* Reconfigure Section */}
        <View style={styles.resetSection}>
          <TouchableOpacity style={styles.resetButton} onPress={openSetupWizard} activeOpacity={0.8}>
            <LinearGradient
              colors={['#3b82f6', '#2563eb']}
              style={styles.resetButtonGradient}
            >
              <Text style={styles.resetIcon}>🔧</Text>
              <Text style={styles.resetButtonText}>Run Setup Wizard</Text>
            </LinearGradient>
          </TouchableOpacity>
          
          <Text style={styles.resetHint}>
            To change server address, MATLAB path, or Python path, run the setup wizard
          </Text>
        </View>
      </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    ...(Platform.OS === 'web' && {
      height: '100vh',
      maxHeight: '100vh',
      overflow: 'hidden',
    }),
  },
  
  // Header Styles
  header: {
    paddingTop: 20,
    paddingBottom: 30,
    paddingHorizontal: 20,
  },
  headerTop: {
    alignItems: 'flex-start',
    marginBottom: 15,
    marginTop: 10,
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
  headerContent: {
    alignItems: 'center',
  },
  headerIcon: {
    marginBottom: 15,
  },
  headerIconGradient: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  headerIconText: {
    fontSize: 24,
    color: '#8b5cf6',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    fontWeight: '500',
  },
  
  // Scroll Wrapper for web compatibility
  scrollWrapper: {
    flex: 1,
    ...(Platform.OS === 'web' && {
      overflow: 'hidden',
      position: 'relative',
    }),
  },
  
  // Content Styles
  scrollView: {
    flex: 1,
    ...(Platform.OS === 'web' && {
      overflow: 'scroll',
      overflowX: 'hidden',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      height: '100%',
    }),
  },
  scrollViewContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  
  // Header spacer
  headerSpacer: {
    height: 30,
  },
  
  // Section Styles
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  
  // Loading Styles
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: '#64748b',
  },
  
  // Info Item Styles
  infoItem: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
  },
  infoValue: {
    fontSize: 14,
    color: '#3b82f6',
    marginLeft: 24,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  
  // Info Card Styles (existing)
  infoCard: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#eff6ff',
    borderLeftWidth: 4,
    borderLeftColor: '#3b82f6',
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e40af',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 12,
    color: '#1e40af',
    lineHeight: 16,
  },
  
  // Feature Card Styles
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  featureIcon: {
    fontSize: 18,
    marginRight: 12,
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 2,
  },
  featureText: {
    fontSize: 13,
    color: '#64748b',
  },
  
  // Reset Section Styles
  resetSection: {
    marginBottom: 40,
  },
  resetButton: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  resetButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  resetIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  resetButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  resetHint: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 16,
    paddingHorizontal: 20,
  },
});

export default SettingsPage;