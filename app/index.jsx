import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Dimensions, Image, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MatlabProjectRunner from './MatlabProjectRunner';
import SettingsPage from './SettingsPage';
import AboutPage from './AboutPage';

const { width, height } = Dimensions.get('window');

const HomePage = () => {
  const [currentPage, setCurrentPage] = useState('home');

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

  if (currentPage === 'settings') {
    return <SettingsPage onBack={navigateHome} />;
  }

  if (currentPage === 'about') {
    return <AboutPage onBack={navigateHome} />;
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
          <Text style={styles.appSubtitle}>Visible GUI • Auto Execute • Real-time Monitor</Text>
          
          {/* Status Indicators */}
          <View style={styles.statusRow}>
            <View style={styles.statusItem}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Ready</Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={styles.statusIcon}>⚡</Text>
              <Text style={styles.statusText}>Powered</Text>
            </View>
          </View>
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
            onPress={() => navigateToPage('matlab')}
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
                    <Text style={styles.primaryCardTitle}>MATLAB Antenna Optimizer</Text>
                    <Text style={styles.primaryCardSubtitle}>Launch optimization workspace</Text>
                  </View>
                  <View style={styles.primaryCardArrow}>
                    <Text style={styles.primaryCardArrowText}>→</Text>
                  </View>
                </View>
                
                <View style={styles.primaryCardFeatures}>
                  <Text style={styles.primaryCardFeature}>✨ Live Script Execution</Text>
                  <Text style={styles.primaryCardFeature}>📈 HFSS Integration</Text>
                  <Text style={styles.primaryCardFeature}>🎛️ Process Control</Text>
                </View>
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
                <Text style={styles.secondaryCardDescription}>View server and system settings</Text>
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
                <Text style={styles.secondaryCardDescription}>App information & support</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>

        {/* Quick Stats */}
        <View style={styles.statsSection}>
          <Text style={styles.sectionTitle}>Platform Capabilities</Text>
          
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <LinearGradient
                colors={['#3b82f6', '#1d4ed8']}
                style={styles.statCardGradient}
              >
                <Text style={styles.statNumber}>∞</Text>
                <Text style={styles.statLabel}>Projects</Text>
              </LinearGradient>
            </View>
            
            <View style={styles.statCard}>
              <LinearGradient
                colors={['#10b981', '#059669']}
                style={styles.statCardGradient}
              >
                <Text style={styles.statNumber}>24/7</Text>
                <Text style={styles.statLabel}>Monitoring</Text>
              </LinearGradient>
            </View>
            
            <View style={styles.statCard}>
              <LinearGradient
                colors={['#f59e0b', '#d97706']}
                style={styles.statCardGradient}
              >
                <Text style={styles.statNumber}>⚡</Text>
                <Text style={styles.statLabel}>Fast Execute</Text>
              </LinearGradient>
            </View>
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

export default HomePage;