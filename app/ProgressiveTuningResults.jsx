import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Platform, ActivityIndicator, Dimensions, Image, Modal
} from "react-native";
import { LinearGradient } from 'expo-linear-gradient';
import AppConfig, { showAlert } from './app_config';

const { width } = Dimensions.get('window');

/**
 * Formats seconds into human-readable elapsed time
 */
function formatElapsed(seconds) {
  if (!seconds || seconds < 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

export default function ProgressiveTuningResults({
  onBack,
  onRunMoead,       // callback: proceed to MOEA/D with tightened ranges
  onRerun,          // callback: re-run progressive tuning
  onExport,         // callback: export results only
  statusData,       // pre-loaded status data from progress screen (optional)
}) {
  const [results, setResults] = useState(statusData || null);
  const [isLoading, setIsLoading] = useState(!statusData);
  const [error, setError] = useState(null);
  const [outputFiles, setOutputFiles] = useState([]);
  const [isStartingMoead, setIsStartingMoead] = useState(false);

  const SERVER_URL = AppConfig.serverUrl;

  /**
   * Fetch results from backend
   */
  const fetchResults = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${SERVER_URL}/api/progressive-tuning/results`);
      const data = await response.json();
      if (data.success) {
        setResults(data.data);
        setError(null);
        // Extract output files if available
        if (data.data?.files) {
          setOutputFiles(parseOutputFiles(data.data.files));
        }
      } else {
        setError(data.message || 'Failed to load results');
      }
    } catch (err) {
      setError(`Connection error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Parse output files from results into categorized display list
   * Expects descriptive CSV names like: S11_initial.csv, AR_phase2_3.csv, Gain_final.csv
   */
  const parseOutputFiles = (files) => {
    if (!files) return [];
    
    // files may be an object { csv: [...], mat: [...], plots: [...] }
    // or an array of filenames
    const fileList = Array.isArray(files) ? files : [];
    
    // If it's an object with categories
    if (typeof files === 'object' && !Array.isArray(files)) {
      const allFiles = [];
      for (const [category, items] of Object.entries(files)) {
        if (Array.isArray(items)) {
          items.forEach(f => {
            const name = typeof f === 'string' ? f : f.name || f.filename || '';
            allFiles.push({ name, category });
          });
        } else if (typeof items === 'string') {
          allFiles.push({ name: items, category });
        }
      }
      return allFiles;
    }
    
    return fileList.map(f => {
      const name = typeof f === 'string' ? f : f.name || '';
      // Categorize by prefix pattern
      let category = 'other';
      if (/^S11[_]/i.test(name)) category = 'S11';
      else if (/^AR[_]/i.test(name)) category = 'AR';
      else if (/^Gain[_]/i.test(name)) category = 'Gain';
      else if (/^VSWR[_]/i.test(name)) category = 'VSWR';
      else if (/tightened/i.test(name)) category = 'ranges';
      else if (/summary/i.test(name)) category = 'summary';
      return { name, category };
    });
  };

  /**
   * Friendly label for a descriptive CSV filename
   * e.g. S11_initial.csv → "S11 - Initial", AR_phase2_3.csv → "AR - Phase 2 Iter 3"
   */
  const friendlyFileName = (name) => {
    const base = name.replace(/\.[^.]+$/, ''); // strip extension
    const parts = base.split('_');
    if (parts.length < 2) return name;
    
    const metric = parts[0];
    const label = parts.slice(1).join('_');
    
    // Format label
    let friendly = label
      .replace(/^initial$/, 'Initial')
      .replace(/^final$/, 'Final')
      .replace(/^phase(\d+)$/, 'Phase $1')
      .replace(/^phase(\d+)_(\d+)$/, 'Phase $1 Iter $2');
    
    return `${metric} - ${friendly}`;
  };

  useEffect(() => {
    if (!statusData) {
      fetchResults();
    }
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color="#7c3aed" />
        <Text style={styles.loadingText}>Loading tuning results...</Text>
      </View>
    );
  }

  // Error state
  if (error && !results) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorMessage}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchResults}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backLink} onPress={onBack}>
          <Text style={styles.backLinkText}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isComplete = results?.status === 'completed';
  const isPartialConvergence = results?.status === 'error' ||
    (results?.phase_history && results.phase_history.some(p => p.status !== 'completed'));
  const totalSims = results?.total_simulations || 0;
  const totalTime = results?.total_time_seconds || results?.elapsed_seconds || 0;

  // Determine which phases converged
  const phaseStatuses = (results?.phase_history || []).map(p => ({
    phase: p.phase,
    converged: p.status === 'completed',
    status: p.status,
    final_metric: p.final_metric,
    target_metric: p.target_metric,
  }));

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={isComplete ? ['#059669', '#047857', '#065f46'] : ['#d97706', '#b45309', '#92400e']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Tuning Results</Text>
          <View style={{ width: 60 }} />
        </View>
      </LinearGradient>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>

        {/* Status Banner */}
        <View style={[styles.statusBanner, isComplete ? styles.statusSuccess : styles.statusWarning]}>
          <Text style={styles.statusBannerIcon}>{isComplete ? '✅' : '⚠️'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusBannerTitle}>
              {isComplete ? 'PROGRESSIVE TUNING COMPLETE' : 'PARTIAL CONVERGENCE'}
            </Text>
            <Text style={styles.statusBannerDetail}>
              Total simulations: {totalSims}  •  Time: {formatElapsed(totalTime)}
            </Text>
          </View>
        </View>

        {/* Performance Summary */}
        {results?.performance && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionIcon}>📋</Text>
              <Text style={styles.sectionTitle}>Performance Summary</Text>
            </View>
            <View style={styles.perfTable}>
              <View style={styles.perfHeaderRow}>
                <Text style={[styles.perfCell, styles.perfHeader, { flex: 2 }]}>Metric</Text>
                <Text style={[styles.perfCell, styles.perfHeader]}>Target</Text>
                <Text style={[styles.perfCell, styles.perfHeader]}>Achieved</Text>
                <Text style={[styles.perfCell, styles.perfHeader]}>Status</Text>
              </View>

              {results.performance.f_resonance !== undefined && (
                <PerfRow
                  label="Resonance"
                  target="1.575 GHz"
                  achieved={`${results.performance.f_resonance.toFixed(3)} GHz`}
                  pass={Math.abs(results.performance.f_resonance - 1.575) < 0.005}
                />
              )}
              {results.performance.VSWR !== undefined && (
                <PerfRow
                  label="VSWR"
                  target="< 1.5"
                  achieved={results.performance.VSWR.toFixed(2)}
                  pass={results.performance.VSWR < 1.5}
                />
              )}
              {results.performance.S11_dB !== undefined && (
                <PerfRow
                  label="S11"
                  target="< -10 dB"
                  achieved={`${results.performance.S11_dB.toFixed(1)} dB`}
                  pass={results.performance.S11_dB < -10}
                />
              )}
              {results.performance.AR_1570 !== undefined && (
                <PerfRow
                  label="AR @ 1.570"
                  target="< 2 dB"
                  achieved={`${results.performance.AR_1570.toFixed(1)} dB`}
                  pass={results.performance.AR_1570 < 2}
                />
              )}
              {results.performance.AR_1575 !== undefined && (
                <PerfRow
                  label="AR @ 1.575"
                  target="< 2 dB"
                  achieved={`${results.performance.AR_1575.toFixed(1)} dB`}
                  pass={results.performance.AR_1575 < 2}
                />
              )}
              {results.performance.AR_1580 !== undefined && (
                <PerfRow
                  label="AR @ 1.580"
                  target="< 2 dB"
                  achieved={`${results.performance.AR_1580.toFixed(1)} dB`}
                  pass={results.performance.AR_1580 < 2}
                />
              )}
            </View>
          </View>
        )}

        {/* Tuned Design Point */}
        {results?.tuned_variables && Object.keys(results.tuned_variables).length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionIcon}>🎯</Text>
              <Text style={styles.sectionTitle}>Tuned Design Point</Text>
            </View>
            <View style={styles.tunedTable}>
              <View style={styles.tunedHeaderRow}>
                <Text style={[styles.tunedCell, styles.tunedHeader, { flex: 1.5 }]}>Variable</Text>
                <Text style={[styles.tunedCell, styles.tunedHeader]}>Tuned Value</Text>
              </View>
              {Object.entries(results.tuned_variables).map(([key, val]) => (
                <View key={key} style={styles.tunedDataRow}>
                  <Text style={[styles.tunedCell, styles.tunedVarName, { flex: 1.5 }]}>{key}</Text>
                  <Text style={[styles.tunedCell, styles.tunedVarValue]}>
                    {typeof val === 'number' ? val.toFixed(3) : val}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Tightened Ranges */}
        {results?.tightened_ranges && Object.keys(results.tightened_ranges).length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionIcon}>📐</Text>
              <Text style={styles.sectionTitle}>Tightened Ranges for MOEA/D</Text>
            </View>
            <View style={styles.rangesTable}>
              <View style={styles.rangesHeaderRow}>
                <Text style={[styles.rangesCell, styles.rangesHeader, { flex: 1.2 }]}>Variable</Text>
                <Text style={[styles.rangesCell, styles.rangesHeader, { flex: 2 }]}>Tightened Range</Text>
              </View>
              {Object.entries(results.tightened_ranges).map(([key, range]) => (
                <View key={key} style={styles.rangesDataRow}>
                  <Text style={[styles.rangesCell, styles.rangesVarName, { flex: 1.2 }]}>{key}</Text>
                  <Text style={[styles.rangesCell, styles.rangesValue, { flex: 2 }]}>
                    [{Array.isArray(range)
                      ? range.map(v => typeof v === 'number' ? v.toFixed(2) : v).join(', ')
                      : range}]
                  </Text>
                </View>
              ))}
            </View>

            {/* Reduction stats */}
            <View style={styles.reductionStats}>
              {results.search_space_reduction_percent > 0 && (
                <View style={styles.reductionStat}>
                  <Text style={styles.reductionLabel}>Search Space Reduction</Text>
                  <Text style={styles.reductionValue}>{results.search_space_reduction_percent}%</Text>
                </View>
              )}
              {results.estimated_moead_speedup > 0 && (
                <View style={styles.reductionStat}>
                  <Text style={styles.reductionLabel}>Expected MOEA/D Speedup</Text>
                  <Text style={styles.reductionValue}>~{results.estimated_moead_speedup}x</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Output Files */}
        {(outputFiles.length > 0 || (results?.results_dir)) && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionIcon}>📄</Text>
              <Text style={styles.sectionTitle}>Output Files</Text>
            </View>
            {results?.results_dir && (
              <Text style={styles.resultsDirText}>
                📁 {results.results_dir}
              </Text>
            )}
            {outputFiles.length > 0 && (
              <View style={styles.filesList}>
                {outputFiles.map((file, idx) => (
                  <View key={idx} style={styles.fileRow}>
                    <View style={[styles.fileCategoryBadge, 
                      file.category === 'S11' && { backgroundColor: '#dbeafe' },
                      file.category === 'AR' && { backgroundColor: '#fce7f3' },
                      file.category === 'Gain' && { backgroundColor: '#dcfce7' },
                      file.category === 'VSWR' && { backgroundColor: '#fef3c7' },
                      file.category === 'ranges' && { backgroundColor: '#ede9fe' },
                      file.category === 'summary' && { backgroundColor: '#f1f5f9' },
                    ]}>
                      <Text style={styles.fileCategoryText}>{file.category.toUpperCase()}</Text>
                    </View>
                    <View style={styles.fileNameContainer}>
                      <Text style={styles.fileDisplayName}>{friendlyFileName(file.name)}</Text>
                      <Text style={styles.fileRawName}>{file.name}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Partial Convergence Recommendations */}
        {isPartialConvergence && (
          <View style={styles.section}>
            <LinearGradient colors={['#fffbeb', '#fef3c7']} style={styles.recommendCard}>
              <Text style={styles.recommendTitle}>Recommendations</Text>
              {phaseStatuses.filter(p => !p.converged).map(p => (
                <Text key={p.phase} style={styles.recommendText}>
                  Phase {p.phase} did not converge (status: {p.status}).
                  {p.phase === 3
                    ? ' This may indicate the GND geometry limits circular polarization performance.'
                    : ' Consider adjusting starting variables and re-running.'}
                </Text>
              ))}
              <Text style={styles.recommendText}>
                Options:{'\n'}
                1. Proceed with current ranges (targets may be relaxed in MOEA/D){'\n'}
                2. Re-run with different starting settings{'\n'}
                3. Modify GND design and re-run
              </Text>
            </LinearGradient>
          </View>
        )}

        {/* Performance Charts */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionIcon}>📈</Text>
            <Text style={styles.sectionTitle}>Performance Charts</Text>
          </View>
          {[
            { key: 'chart_s11.png',   label: 'Return Loss (S11)' },
            { key: 'chart_ar.png',    label: 'Axial Ratio' },
            { key: 'chart_gain.png',  label: 'Realized Gain' },
            { key: 'chart_smith.png', label: 'Smith Chart (S11 Locus)' },
          ].map(({ key, label }) => (
            <ChartCard
              key={key}
              url={`${SERVER_URL}/api/progressive-tuning/chart/${key}${results?.results_dir ? `?dir=${encodeURIComponent(results.results_dir)}` : ''}`}
              label={label}
            />
          ))}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsSection}>
          <Text style={styles.actionsTitle}>What would you like to do?</Text>

          {/* Run MOEA/D with tightened ranges */}
          <TouchableOpacity
            style={[styles.actionCard, isStartingMoead && { opacity: 0.7 }]}
            onPress={async () => {
              if (!onRunMoead || isStartingMoead) return;
              setIsStartingMoead(true);
              try {
                await onRunMoead(results);
              } finally {
                setIsStartingMoead(false);
              }
            }}
            activeOpacity={0.8}
            disabled={isStartingMoead}
          >
            <LinearGradient
              colors={['#7c3aed', '#6d28d9']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.actionCardGradient}
            >
              {isStartingMoead
                ? <ActivityIndicator color="#ffffff" style={{ marginRight: 12 }} />
                : <Text style={styles.actionCardIcon}>🚀</Text>
              }
              <View style={styles.actionCardText}>
                <Text style={styles.actionCardTitle}>
                  {isStartingMoead ? 'Setting up MOEA/D...' : 'Run MOEA/D with Tightened Ranges'}
                </Text>
                <Text style={styles.actionCardSubtitle}>
                  {isStartingMoead ? 'Generating F_Model_Element.m' : '~50-100 sims, ~4-8 hours'}
                </Text>
              </View>
              {!isStartingMoead && <Text style={styles.actionCardArrow}>→</Text>}
            </LinearGradient>
          </TouchableOpacity>

          {/* Re-run tuning */}
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => {
              if (onRerun) onRerun();
            }}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#f59e0b', '#d97706']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.actionCardGradient}
            >
              <Text style={styles.actionCardIcon}>🔄</Text>
              <View style={styles.actionCardText}>
                <Text style={styles.actionCardTitle}>Re-run Progressive Tuning</Text>
                <Text style={styles.actionCardSubtitle}>With different settings</Text>
              </View>
              <Text style={styles.actionCardArrow}>→</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* View file locations */}
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => {
              if (onExport) {
                onExport(results);
              } else {
                showAlert('Results File Location',
                  `Results are saved at:\n${results?.results_dir || 'Function/EARLY_PHASE/Results/'}\n\nFiles: .mat and .csv`
                );
              }
            }}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#64748b', '#475569']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.actionCardGradient}
            >
              <Text style={styles.actionCardIcon}>📁</Text>
              <View style={styles.actionCardText}>
                <Text style={styles.actionCardTitle}>View File Locations</Text>
                <Text style={styles.actionCardSubtitle}>See where .mat/.csv results are saved</Text>
              </View>
              <Text style={styles.actionCardArrow}>→</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

/**
 * Chart image card — loads a PNG from the Express server.
 * Tap the image to open a fullscreen modal with pinch-to-zoom.
 */
function ChartCard({ url, label }) {
  const [loaded, setLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartLabel}>{label}</Text>
      {!loaded && !imgError && (
        <View style={styles.chartPlaceholder}>
          <ActivityIndicator color="#7c3aed" />
          <Text style={styles.chartLoadingText}>Loading chart...</Text>
        </View>
      )}
      {imgError && (
        <View style={styles.chartPlaceholder}>
          <Text style={styles.chartErrorText}>Chart not yet available</Text>
          <Text style={styles.chartErrorSub}>Run the tuning to generate charts</Text>
        </View>
      )}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => loaded && !imgError && setModalVisible(true)}
        disabled={!loaded || imgError}
      >
        <Image
          source={{ uri: url }}
          style={[styles.chartImage, (!loaded || imgError) && { width: 0, height: 0 }]}
          resizeMode="contain"
          onLoad={() => setLoaded(true)}
          onError={() => setImgError(true)}
        />
        {loaded && !imgError && (
          <View style={styles.zoomHint}>
            <Text style={styles.zoomHintText}>🔍 Tap to zoom</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.modalScrollContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            centerContent
          >
            <Image
              source={{ uri: url }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          </ScrollView>
          <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setModalVisible(false)}>
            <Text style={styles.modalCloseBtnText}>✕</Text>
          </TouchableOpacity>
          <View style={styles.modalHintRow}>
            <Text style={styles.modalHintText}>Pinch to zoom  •  Tap ✕ to close</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Performance table row component
 */
function PerfRow({ label, target, achieved, pass }) {
  return (
    <View style={styles.perfDataRow}>
      <Text style={[styles.perfCell, { flex: 2, fontWeight: '600', color: '#1e293b' }]}>{label}</Text>
      <Text style={[styles.perfCell, { color: '#64748b' }]}>{target}</Text>
      <Text style={[styles.perfCell, { fontWeight: '600', color: '#1e293b' }]}>{achieved}</Text>
      <Text style={[styles.perfCell, { fontSize: 16 }]}>{pass ? '✅' : '❌'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    ...(Platform.OS === 'web' && { height: '100vh', maxHeight: '100vh', overflow: 'hidden' }),
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#64748b',
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 16,
    color: '#dc2626',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  backLink: {
    padding: 8,
  },
  backLinkText: {
    color: '#64748b',
    fontSize: 14,
  },
  header: {
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
    ...(Platform.OS === 'web' && { overflow: 'auto' }),
  },
  scrollContent: {
    padding: 20,
  },

  // Status Banner
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  statusSuccess: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  statusWarning: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde047',
  },
  statusBannerIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  statusBannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
  },
  statusBannerDetail: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
  },

  // Sections
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 0,
  },
  sectionIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
  },

  // Performance Table
  perfTable: {
    margin: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  perfHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
  },
  perfDataRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  perfCell: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    fontSize: 12,
    color: '#475569',
    textAlign: 'center',
  },
  perfHeader: {
    fontWeight: '700',
    color: '#1e293b',
    fontSize: 12,
  },

  // Tuned Variables Table
  tunedTable: {
    margin: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  tunedHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
  },
  tunedDataRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  tunedCell: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  tunedHeader: {
    fontWeight: '700',
    color: '#1e293b',
  },
  tunedVarName: {
    fontWeight: '600',
    color: '#7c3aed',
  },
  tunedVarValue: {
    fontWeight: '700',
    color: '#1e293b',
  },

  // Tightened Ranges Table
  rangesTable: {
    margin: 16,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  rangesHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
  },
  rangesDataRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  rangesCell: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  rangesHeader: {
    fontWeight: '700',
    color: '#1e293b',
  },
  rangesVarName: {
    fontWeight: '600',
    color: '#7c3aed',
  },
  rangesValue: {
    fontWeight: '600',
    color: '#059669',
  },
  reductionStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  reductionStat: {
    alignItems: 'center',
  },
  reductionLabel: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 4,
  },
  reductionValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#059669',
  },

  // Recommendations
  recommendCard: {
    padding: 16,
    borderRadius: 16,
  },
  recommendTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#92400e',
    marginBottom: 8,
  },
  recommendText: {
    fontSize: 13,
    color: '#78350f',
    lineHeight: 20,
    marginBottom: 8,
  },

  // Output Files
  resultsDirText: {
    fontSize: 12,
    color: '#64748b',
    paddingHorizontal: 16,
    paddingTop: 8,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  filesList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  fileCategoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 10,
    minWidth: 52,
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
  },
  fileCategoryText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  fileNameContainer: {
    flex: 1,
  },
  fileDisplayName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
  },
  fileRawName: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 1,
  },

  // Action Buttons
  actionsSection: {
    marginTop: 4,
  },
  actionsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 12,
  },
  actionCard: {
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  actionCardGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  actionCardIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  actionCardText: {
    flex: 1,
  },
  actionCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  actionCardSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  actionCardArrow: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '700',
  },

  // Performance Charts
  chartCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  chartLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  chartPlaceholder: {
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  chartLoadingText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 8,
  },
  chartErrorText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
  },
  chartErrorSub: {
    fontSize: 11,
    color: '#cbd5e1',
    marginTop: 4,
  },
  chartImage: {
    width: '100%',
    height: 220,
  },
  zoomHint: {
    position: 'absolute',
    bottom: 6,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  zoomHintText: {
    fontSize: 10,
    color: '#ffffff',
  },

  // Fullscreen zoom modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.93)',
    justifyContent: 'center',
  },
  modalScrollContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImage: {
    width: width,
    height: width * 0.78,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 22,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseBtnText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  modalHintRow: {
    position: 'absolute',
    bottom: 38,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  modalHintText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
  },
});
