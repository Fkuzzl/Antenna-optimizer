import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Image, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const AboutPage = ({ onBack }) => {
  
  const openURL = (url) => {
    Linking.openURL(url).catch(err => console.error('Failed to open URL:', err));
  };

  const InfoRow = ({ label, value, onPress, isLink = false }) => (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <TouchableOpacity onPress={onPress} disabled={!isLink}>
        <Text style={[styles.infoValue, isLink && styles.linkText]}>{value}</Text>
      </TouchableOpacity>
    </View>
  );

  const FeatureItem = ({ icon, title, description }) => (
    <View style={styles.featureItem}>
      <View style={styles.featureHeader}>
        <Text style={styles.featureIcon}>{icon}</Text>
        <Text style={styles.featureTitle}>{title}</Text>
      </View>
      <Text style={styles.featureDescription}>{description}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Enhanced Header with Gradient */}
      <LinearGradient
        colors={['#f59e0b', '#d97706', '#b45309']}
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
              <Image 
                source={require('../assets/Matlab_Logo.png')} 
                style={styles.headerIconImage}
                resizeMode="contain"
              />
            </LinearGradient>
          </View>
          <Text style={styles.title}>MATLAB Studio</Text>
          <Text style={styles.subtitle}>Advanced antenna optimization with MATLAB Live Scripts and HFSS integration</Text>
          
          <View style={styles.headerVersionInfo}>
            <Text style={styles.headerVersionText}>Version 1.1.0</Text>
            <Text style={styles.headerBuildText}>Build 2026.01.03</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.scrollWrapper}>
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
        >
        {/* Spacer between header and content */}
        <View style={styles.headerSpacer} />

        {/* Features Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🚀 Key Features</Text>
          
          <FeatureItem
            icon="🖥️"
            title="Visible MATLAB GUI"
            description="Execute Live Scripts with full visibility and real-time monitoring"
          />
          
          <FeatureItem
            icon="⚡"
            title="Automatic Execution"
            description="One-click launch with automated script execution and process tracking"
          />
          
          <FeatureItem
            icon="📊"
            title="Real-time Monitoring"
            description="Live status updates, execution tracking, and HFSS process monitoring"
          />
          
          <FeatureItem
            icon="🎛️"
            title="Process Control"
            description="Start, stop, and manage MATLAB executions with graceful termination"
          />
          
          <FeatureItem
            icon="🔧"
            title="HFSS Integration"
            description="Seamless ANSYS HFSS integration with automatic process detection"
          />
        </View>

        {/* Technical Specs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⚙️ Technical Specifications</Text>
          
          <InfoRow label="Platform" value="React Native with Expo" />
          <InfoRow label="Backend" value="Node.js Express Server" />
          <InfoRow label="MATLAB Support" value="Live Scripts (.mlx files)" />
          <InfoRow label="HFSS Compatibility" value="ANSYS Electronics Desktop" />
          <InfoRow label="Network Protocol" value="HTTP REST API" />
        </View>

        {/* Supported Formats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📁 Supported File Formats</Text>
          
          <View style={styles.formatItem}>
            <View style={styles.formatIcon}>
              <Text style={styles.formatIconText}>📄</Text>
            </View>
            <View style={styles.formatDetails}>
              <Text style={styles.formatName}>.mlx</Text>
              <Text style={styles.formatDescription}>MATLAB Live Scripts with embedded documentation</Text>
            </View>
          </View>
          
          <View style={styles.formatItem}>
            <View style={styles.formatIcon}>
              <Text style={styles.formatIconText}>🔧</Text>
            </View>
            <View style={styles.formatDetails}>
              <Text style={styles.formatName}>.m</Text>
              <Text style={styles.formatDescription}>MATLAB Script Files (legacy support)</Text>
            </View>
          </View>
        </View>

        {/* Support */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🛠️ Support & Resources</Text>
          
          <InfoRow 
            label="Documentation" 
            value="User Guide & API Docs" 
            isLink={true}
            onPress={() => openURL('https://docs.matlabstudio.com')}
          />
          
          <InfoRow 
            label="GitHub Repository" 
            value="View Source Code" 
            isLink={true}
            onPress={() => openURL('https://github.com/matlabstudio/app')}
          />
          
          <InfoRow 
            label="Technical Support" 
            value="support@matlabstudio.com" 
            isLink={true}
            onPress={() => openURL('mailto:support@matlabstudio.com')}
          />
        </View>

        {/* Credits */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🏆 Built With</Text>
          
          <View style={styles.creditsList}>
            <Text style={styles.creditItem}>• React Native & Expo SDK</Text>
            <Text style={styles.creditItem}>• Node.js & Express Framework</Text>
            <Text style={styles.creditItem}>• Linear Gradient Components</Text>
            <Text style={styles.creditItem}>• Cross-platform Networking</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <LinearGradient
            colors={['#1e293b', '#0f172a']}
            style={styles.footerGradient}
          >
            <Text style={styles.footerText}>
              © 2025 MATLAB Studio. Professional antenna optimization platform.
            </Text>
            <Text style={styles.footerSubtext}>
              MATLAB and HFSS are trademarks of their respective owners.
            </Text>
          </LinearGradient>
        </View>
      </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Main Container - Root layout with full height and background color
  container: { flex: 1, backgroundColor: '#f1f5f9', ...(Platform.OS === 'web' && { height: '100vh', maxHeight: '100vh', overflow: 'hidden' }) },

  // Header Section - Orange gradient header with back button, icon, title and version info
  header: { paddingTop: 20, paddingBottom: 30, paddingHorizontal: 20 },
  headerTop: { alignItems: 'flex-start', marginBottom: 15, marginTop: 10 },
  backButton: { backgroundColor: 'rgba(255, 255, 255, 0.2)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  backButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  headerContent: { alignItems: 'center' },
  headerIcon: { marginBottom: 15 },
  headerIconGradient: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
  headerIconText: { fontSize: 24, color: '#f59e0b' },
  headerIconImage: { width: 36, height: 36 },
  title: { fontSize: 28, fontWeight: '800', color: '#ffffff', textAlign: 'center', marginBottom: 8, textShadowColor: 'rgba(0, 0, 0, 0.3)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 },
  subtitle: { fontSize: 14, color: 'rgba(255, 255, 255, 0.9)', textAlign: 'center', fontWeight: '500' },
  headerVersionInfo: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 15 },
  headerVersionText: { fontSize: 12, color: 'rgba(255, 255, 255, 0.8)', fontWeight: '600' },
  headerBuildText: { fontSize: 12, color: 'rgba(255, 255, 255, 0.7)', fontWeight: '500' },

  // Scroll Container - Wrapper for scrollable content area with web overflow handling
  scrollWrapper: { flex: 1, ...(Platform.OS === 'web' && { overflow: 'hidden', position: 'relative' }) },
  scrollView: { flex: 1, ...(Platform.OS === 'web' && { overflow: 'scroll', overflowX: 'hidden', overflowY: 'auto', WebkitOverflowScrolling: 'touch', height: '100%' }) },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  headerSpacer: { height: 30 },

  // Section Components - Gradient background containers for grouped content
  section: { marginBottom: 20 },
  sectionGradient: { borderRadius: 16, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 6 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1e293b', marginBottom: 16, paddingHorizontal: 4 },

  // Info Row - Application details with label-value pairs and optional links
  infoRow: { backgroundColor: '#ffffff', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 20, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  infoLabel: { fontSize: 14, color: '#374151', fontWeight: '500' },
  infoValue: { fontSize: 14, color: '#64748b' },
  linkText: { color: '#3b82f6', fontWeight: '500' },

  // Feature Items - Feature list with icons, titles and descriptions
  featureItem: { backgroundColor: '#ffffff', borderRadius: 12, padding: 16, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#10b981', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 3 },
  featureHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  featureIcon: { fontSize: 16, marginRight: 12 },
  featureTitle: { fontSize: 15, fontWeight: '600', color: '#1e293b', flex: 1 },
  featureDescription: { fontSize: 13, color: '#64748b', lineHeight: 18, marginLeft: 28 },

  // Format Items - Supported file formats with icons and descriptions
  formatItem: { backgroundColor: '#ffffff', flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  formatIcon: { width: 40, height: 40, backgroundColor: '#f1f5f9', borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  formatIconText: { fontSize: 16 },
  formatDetails: { flex: 1 },
  formatName: { fontSize: 16, fontWeight: '600', color: '#3b82f6', marginBottom: 2 },
  formatDescription: { fontSize: 13, color: '#64748b', lineHeight: 16 },

  // Credits Section - List of libraries and acknowledgments
  creditsList: { backgroundColor: '#ffffff', borderRadius: 12, padding: 20, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 3 },
  creditItem: { fontSize: 14, color: '#374151', marginBottom: 8, lineHeight: 20 },

  // Footer - Bottom gradient section with copyright and additional info
  footer: { marginTop: 20, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  footerGradient: { padding: 24, alignItems: 'center' },
  footerText: { fontSize: 14, color: '#ffffff', textAlign: 'center', marginBottom: 8, fontWeight: '500' },
  footerSubtext: { fontSize: 12, color: 'rgba(255, 255, 255, 0.7)', textAlign: 'center', lineHeight: 16 },
});

export default AboutPage;