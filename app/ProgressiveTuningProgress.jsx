import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Platform, ActivityIndicator, Dimensions, Modal, TextInput
} from "react-native";
import { LinearGradient } from 'expo-linear-gradient';
import AppConfig, { showAlert } from './app_config';

const { width } = Dimensions.get('window');

const PHASE_LABELS = {
  1: { name: 'Resonant Frequency', target: '1.575 GHz', icon: '📡', color: '#3b82f6' },
  2: { name: 'Impedance Matching', target: 'VSWR < 1.5', icon: '⚡', color: '#f59e0b' },
  3: { name: 'CP Loop Optimization', target: 'AR < 2 dB', icon: '🔄', color: '#10b981' },
};

const STATUS_CONFIG = {
  completed:       { label: '✅ COMPLETE', color: '#10b981', bgColor: '#f0fdf4' },
  running:         { label: '🔄 RUNNING',  color: '#3b82f6', bgColor: '#eff6ff' },
  pending:         { label: '⏳ PENDING',  color: '#94a3b8', bgColor: '#f8fafc' },
  error:           { label: '❌ ERROR',    color: '#ef4444', bgColor: '#fef2f2' },
  paused:          { label: '⏸️ PAUSED',   color: '#f59e0b', bgColor: '#fffbeb' },
  stopping:        { label: '⏹️ STOPPING', color: '#f59e0b', bgColor: '#fffbeb' },
  invalid:         { label: '⚠️ INVALID',  color: '#ef4444', bgColor: '#fef2f2' },
  invalid_initial: { label: '⚠️ INVALID',  color: '#ef4444', bgColor: '#fef2f2' },
};

/** Which 2 variables each phase tunes */
const PHASE_TUNED_VARS = {
  1: ['brown', 'ngreen', 'bluel'],
  2: ['probex', 'purple'],
  3: ['orange', 'orange2'],
};

/** Per-phase metric configuration — keys match MATLAB status.json field names */
const PHASE_METRIC_CONFIG = {
  1: { primary: 'current_f_res_discrete', label: 'f_res', unit: 'GHz', target: 1.575, direction: true,
       altKeys: ['current_f_res', 'f_resonance'] },
  2: { primary: 'current_VSWR', label: 'VSWR', unit: '', target: 1.5, lowerBetter: true,
       secondary: 'current_S11', secLabel: 'S11', secUnit: 'dB',
       altKeys: ['VSWR_at_target'], altSecKeys: ['S11_at_target'] },
  3: { primary: 'current_AR', label: 'AR', unit: 'dB', target: 2.0, lowerBetter: true,
       frequencies: [1.570, 1.575, 1.580],
       // MATLAB writes AR values with frequency keys like x1_570, x1_575, x1_580
       freqKeys: ['x1_570', 'x1_575', 'x1_580'],
       altKeys: ['AR_at_target', 'worst_AR'] },
};

/**
 * Resolve a metric value from MATLAB data.
 * MATLAB may write metrics as:
 *   - a scalar number (e.g. 1.575)
 *   - an array (e.g. [1.575]) — use last element
 *   - an empty array [] — treat as null
 *   - an empty string "" — treat as null
 *   - an object with frequency keys (Phase 3 AR) — handled separately
 */
const resolveMetricValue = (raw) => {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const last = raw[raw.length - 1];
    return typeof last === 'number' ? last : null;
  }
  if (typeof raw === 'string') {
    if (raw === '') return null;
    const n = parseFloat(raw);
    return isNaN(n) ? null : n;
  }
  // Object (e.g. Phase 3 AR with frequency keys) — return as-is for special handling
  if (typeof raw === 'object') return raw;
  return null;
};

/** Pure helpers */
const formatVarValue = (val) => {
  if (val == null) return '\u2014';
  return typeof val === 'number' ? val.toFixed(3) : String(val);
};

const getMarkerPosition = (value, range) => {
  if (!range || range.length < 2 || range[1] === range[0]) return 50;
  return Math.max(0, Math.min(100, ((value - range[0]) / (range[1] - range[0])) * 100));
};

const formatMetricValue = (value, conf) => {
  if (value == null) return '\u2014';
  let formatted;
  if (typeof value === 'number') {
    formatted = value.toFixed(3);
  } else if (typeof value === 'object' && !Array.isArray(value)) {
    // Phase 3 AR object with frequency keys (e.g. { x1_575: 1.2, ... }) — show target freq
    const targetVal = value.x1_575 ?? value.x1_570 ?? value.x1_580 ?? Object.values(value).find(v => typeof v === 'number');
    formatted = typeof targetVal === 'number' ? targetVal.toFixed(3) : '\u2014';
  } else {
    formatted = String(value);
  }
  return conf?.unit ? `${formatted} ${conf.unit}` : formatted;
};

const getMetricColor = (phaseId, value) => {
  if (value == null) return '#1e293b';
  if (phaseId === 1) {
    const delta = Math.abs(value - 1.575) * 1000;
    if (delta <= 2) return '#10b981';
    if (delta <= 5) return '#f59e0b';
    return '#ef4444';
  }
  if (phaseId === 2) {
    if (value <= 1.5) return '#10b981';
    if (value <= 2.0) return '#f59e0b';
    return '#ef4444';
  }
  if (phaseId === 3) {
    if (value <= 2) return '#10b981';
    if (value <= 3) return '#f59e0b';
    return '#ef4444';
  }
  return '#1e293b';
};

/**
 * Formats seconds into human-readable elapsed time
 */
function formatElapsed(seconds) {
  if (!seconds || seconds < 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Convert complex impedance Z (Ohms) → Smith chart SVG coordinates.
 * cx, cy = chart centre in pixels; r = chart radius in pixels.
 */
const smithCoords = (Z_re, Z_im, cx, cy, r) => {
  const z_re = Z_re / 50;
  const z_im = Z_im / 50;
  const dn = (z_re + 1) * (z_re + 1) + z_im * z_im;
  if (dn < 1e-10) return { x: cx + r, y: cy };
  const g_re = ((z_re - 1) * (z_re + 1) + z_im * z_im) / dn;
  const g_im = (2 * z_im) / dn;
  return { x: cx + g_re * r, y: cy - g_im * r };
};

/** AR color zones per spec: 🟢 0–2, 🟡 2–5, 🟠 5–10, 🔴 >10 */
const getARColor = (ar) => {
  if (ar == null) return '#94a3b8';
  if (ar <= 2)  return '#10b981';
  if (ar <= 5)  return '#f59e0b';
  if (ar <= 10) return '#f97316';
  return '#ef4444';
};

/** VSWR color thresholds: 🟢 <1.5, 🟡 1.5–3, 🔴 >3 */
const getVSWRColor = (vswr) => {
  if (vswr == null) return '#94a3b8';
  if (vswr <= 1.5) return '#10b981';
  if (vswr <= 3.0) return '#f59e0b';
  return '#ef4444';
};

export default function ProgressiveTuningProgress({ onBack, onComplete, projectPath }) {
  const [status, setStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedHistory, setExpandedHistory] = useState({});
  const [isStopping, setIsStopping] = useState(false);
  const [collapsedPhases, setCollapsedPhases] = useState({ 1: true, 2: true, 3: true });
  const [showFixedVars, setShowFixedVars] = useState({});
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustValues, setAdjustValues] = useState({});
  const [isRetrying, setIsRetrying] = useState(false);
  const pollRef = useRef(null);
  const autoNavTimerRef = useRef(null); // tracks the auto-navigate timer for cleanup

  const SERVER_URL = AppConfig.serverUrl;

  /**
   * Fetch status from backend (polls status.json via API)
   */
  const fetchStatus = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/progressive-tuning/status`);
      const data = await response.json();

      if (data.success) {
        setStatus(data.data);
        setError(null);
        setIsLoading(false);

        // Check for final states
        const finalStatuses = ['completed', 'error', 'cancelled', 'stopped', 'invalid_initial'];
        if (finalStatuses.includes(data.data.status) || finalStatuses.includes(data.data.manager?.status)) {
          // Stop polling
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          // Auto-navigate to results after letting user see the final state
          // 'cancelled' and 'stopped' also navigate to results to show partial data
          if (data.data.status === 'completed' || data.data.status === 'error' ||
              data.data.status === 'cancelled' || data.data.status === 'stopped') {
            autoNavTimerRef.current = setTimeout(() => {
              if (onComplete) onComplete(data.data);
            }, 5000);
          }
        }
      } else {
        setError(data.message || 'Failed to get status');
      }
    } catch (err) {
      setError(`Connection error: ${err.message}`);
    }
  };

  /**
   * Start polling on mount
   */
  useEffect(() => {
    fetchStatus(); // immediate first fetch
    pollRef.current = setInterval(fetchStatus, 5000); // poll every 5s

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
      if (autoNavTimerRef.current) {
        clearTimeout(autoNavTimerRef.current);
      }
    };
  }, []);

  /**
   * Send a graceful stop via the unified /api/matlab/stop endpoint.
   * The server detects that Progressive Tuning is active and writes
   * control.json — MATLAB will save a checkpoint and exit on its own.
   */
  const handleStop = async () => {
    setIsStopping(true);
    try {
      const controlResponse = await fetch(`${SERVER_URL}/api/matlab/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const controlData = await controlResponse.json();

      if (controlData.success) {
        showAlert(
          'Stop Requested',
          'MATLAB will save a checkpoint and exit gracefully.\nYou can resume this run later.'
        );

        // Update local status to stopping
        setStatus(prev => prev ? {
          ...prev,
          status: 'stopping',
          status_message: 'Stopping... saving checkpoint',
          manager: { ...prev.manager, status: 'stopping' },
        } : prev);

        // Don't stop polling — let it detect the final status from MATLAB
        // Polling will auto-stop when status becomes 'completed', 'cancelled', or 'stopped'
      } else {
        showAlert('Stop Failed', controlData.message || 'Failed to send stop command');
      }

    } catch (err) {
      showAlert('Stop Error', `Could not stop processes: ${err.message}`);
    } finally {
      setIsStopping(false);
    }
  };

  /**
   * Handle "Adjust & Retry" — reset the manager, then create a new run with adjusted variables.
   * Uses the same antenna_name (overwrites the invalid run) and same GND config.
   */
  const handleAdjustRetry = async (newValues) => {
    setIsRetrying(true);
    try {
      // Capture manager data before reset (reset clears it)
      const savedGndConfig = status?.gnd_config || status?.manager?.gndConfig || null;
      const savedProjectPath = status?.manager?.projectPath || projectPath;
      const savedAntennaName = status?.antenna_name || 'antenna1';

      // 1. Reset the manager state so it allows a new start
      await fetch(`${SERVER_URL}/api/progressive-tuning/reset`, { method: 'POST' });

      // 2. Build initial_variables with the user's adjusted values
      //    Start from the current status's variables (if available from profile/status), overlay adjustments
      const existingVars = {};
      // Gather existing variable values from phase data if available
      for (const phaseId of [1, 2, 3]) {
        const pd = status?.[`phase${phaseId}`];
        if (pd?.tuned_variables) {
          Object.entries(pd.tuned_variables).forEach(([k, v]) => {
            existingVars[k] = v.current ?? v.start ?? v;
          });
        }
        if (pd?.fixed_variables) {
          Object.entries(pd.fixed_variables).forEach(([k, v]) => {
            if (typeof v === 'number') existingVars[k] = v;
          });
        }
      }

      // Overlay the user's adjusted values
      const initial_variables = { ...existingVars };
      Object.entries(newValues).forEach(([k, data]) => {
        initial_variables[k] = data.value;
      });

      // 3. Start a new create run with adjusted variables
      const response = await fetch(`${SERVER_URL}/api/progressive-tuning/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: savedProjectPath,
          mode: 'create',
          GND_config: savedGndConfig,
          initial_variables,
          antenna_name: savedAntennaName,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setShowAdjustModal(false);
        // Reset local state and restart polling
        setStatus(null);
        setIsLoading(true);
        setError(null);
        setIsStopping(false);
        // Restart polling
        if (pollRef.current) clearInterval(pollRef.current);
        fetchStatus();
        pollRef.current = setInterval(fetchStatus, 5000);
      } else {
        showAlert('Retry Failed', data.message || 'Failed to start new tuning run');
      }
    } catch (error) {
      showAlert('Connection Error', `Could not reach server: ${error.message}`);
    } finally {
      setIsRetrying(false);
    }
  };

  /**
   * Toggle iteration history visibility for a phase
   */
  const toggleHistory = (phaseId) => {
    setExpandedHistory(prev => ({ ...prev, [phaseId]: !prev[phaseId] }));
  };

  // ─────────────────────────────────────────────────────────────
  //  Phase 1: Resonant Frequency — rich detail view
  // ─────────────────────────────────────────────────────────────
  const renderPhase1Detail = (phaseData, phaseLabel, isExpanded) => {
    if (!phaseData) return null;
    // When phase1 is completed, prefer the converged history entry's f_res_discrete
    // (guards against Status_Reporter writing best_iter value instead of converged iter)
    let fRes = resolveMetricValue(phaseData.current_f_res_discrete) ?? resolveMetricValue(phaseData.current_f_res);
    if (phaseData.status === 'completed') {
      const hist = phaseData.history || [];
      const convergedEntry = [...hist].reverse().find(r => r && r.status === 'converged');
      if (convergedEntry) {
        const cv = resolveMetricValue(convergedEntry.f_res_discrete) ?? resolveMetricValue(convergedEntry.f_res);
        if (cv != null) fRes = cv;
      }
    }
    const target = 1.575;
    const fMin = 1.550; const fMax = 1.600;
    const errorMHz = fRes != null ? ((fRes - target) * 1000) : null;
    const dotPct = fRes != null
      ? Math.max(2, Math.min(98, ((fRes - fMin) / (fMax - fMin)) * 100))
      : null;
    const targetPct = ((target - fMin) / (fMax - fMin)) * 100; // 50%
    const dotColor = errorMHz == null ? '#94a3b8'
      : Math.abs(errorMHz) <= 2 ? '#10b981'
      : Math.abs(errorMHz) <= 5 ? '#f59e0b'
      : '#ef4444';
    const direction = phaseData.direction; // "up" | "down"
    const iter = phaseData.iteration || 0;
    const maxIter = phaseData.max_iterations || 8;
    const history = phaseData.history || [];

    return (
      <View>
        {/* ── Status message ── */}
        {(phaseData.status_message || status?.status_message) && (
          <View style={styles.statusMessageRow}>
            <Text style={[styles.statusMessageText, { color: phaseLabel.color }]}>
              {phaseData.status_message || status?.status_message}
            </Text>
          </View>
        )}

        {/* ── Frequency convergence bar ── */}
        {fRes != null && (
          <View style={styles.p1FreqSection}>
            <Text style={styles.sectionLabel}>Frequency Convergence</Text>
            <View style={styles.p1FreqBar}>
              {/* Target line */}
              <View style={[styles.p1TargetLine, { left: `${targetPct}%` }]} />
              {/* Moving dot */}
              <View style={[styles.p1FreqDot, { left: `${dotPct}%`, backgroundColor: dotColor }]}>
                <View style={[styles.p1FreqDotInner, { backgroundColor: dotColor }]} />
              </View>
            </View>
            <View style={styles.p1FreqBarLabels}>
              <Text style={styles.p1FreqBarLabel}>1.550 GHz</Text>
              <Text style={[styles.p1FreqBarLabel, { color: '#10b981' }]}>▼ 1.575</Text>
              <Text style={styles.p1FreqBarLabel}>1.600 GHz</Text>
            </View>
            {/* Metric row */}
            <View style={styles.p1MetricRow}>
              <View style={styles.primaryMetric}>
                <View style={styles.primaryMetricMain}>
                  <Text style={styles.primaryMetricLabel}>f_res</Text>
                  <Text style={[styles.primaryMetricValue, { color: dotColor }]}>
                    {fRes.toFixed(4)} GHz
                  </Text>
                  {errorMHz != null && (
                    <Text style={[styles.primaryMetricDelta, { color: dotColor }]}>
                      {errorMHz > 0 ? `+${errorMHz.toFixed(1)} MHz` : `${errorMHz.toFixed(1)} MHz`}
                      {direction ? (direction === 'down' ? ' ↓ searching down' : ' ↑ searching up') : ''}
                    </Text>
                  )}
                </View>
                {iter > 0 && (
                  <View style={styles.secondaryMetric}>
                    <Text style={styles.metricLabel}>Iteration</Text>
                    <Text style={styles.metricValue}>{iter}/{maxIter}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {/* ── Initializing ── */}
        {fRes == null && iter === 0 && (
          <View style={styles.initializingRow}>
            <ActivityIndicator size="small" color={phaseLabel.color} />
            <Text style={[styles.initializingText, { color: phaseLabel.color }]}>
              Initializing — MATLAB is preparing Phase 1...
            </Text>
          </View>
        )}

        {/* ── Tuned variable sliders ── */}
        {phaseData.tuned_variables && (
          <View style={styles.tunedVarsSection}>
            <Text style={styles.sectionLabel}>Tuned Variables (brown, ngreen, bluel)</Text>
            <View style={styles.p1VarCard}>
              {Object.entries(phaseData.tuned_variables).map(([name, vd]) => {
                const startPct = vd.range ? getMarkerPosition(vd.start ?? vd.current, vd.range) : 50;
                const curPct   = vd.range ? getMarkerPosition(vd.current, vd.range) : 50;
                return (
                  <View key={name} style={styles.p1VarRow}>
                    <View style={styles.p1VarLabelRow}>
                      <Text style={styles.tunedVarName}>{name}</Text>
                      <Text style={styles.tunedVarValues}>
                        {vd.start != null ? `start: ${formatVarValue(vd.start)} → ` : ''}<Text style={styles.tunedVarCurrent}>{formatVarValue(vd.current)} mm</Text>
                      </Text>
                    </View>
                    {vd.range && (
                      <View style={styles.searchRange}>
                        <View style={styles.searchRangeBar}>
                          {/* Ghost dot: start */}
                          {vd.start != null && (
                            <View style={[styles.searchRangeMarker, styles.searchRangeStart, { left: `${startPct}%` }]} />
                          )}
                          {/* Colored dot: current */}
                          <View style={[styles.searchRangeMarker, styles.searchRangeCurrent, { left: `${curPct}%` }]} />
                        </View>
                        <View style={styles.searchRangeLabels}>
                          <Text style={styles.searchRangeLabel}>{vd.range[0]} mm</Text>
                          <Text style={styles.searchRangeLabel}>{vd.range[1]} mm</Text>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* ── Iteration history table ── */}
        {history.length > 0 && (
          <View style={styles.runningHistorySection}>
            <TouchableOpacity onPress={() => toggleHistory(1)} style={styles.historyToggle}>
              <Text style={styles.historyToggleText}>
                {isExpanded ? '▲ Hide history' : `▼ Iteration history (${history.length})`}
              </Text>
            </TouchableOpacity>
            {isExpanded && (
              <View style={styles.historyTable}>
                <View style={styles.historyHeaderRow}>
                  <Text style={[styles.historyCell, styles.historyHeader, { flex: 0.6 }]}>Iter</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>brown</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>ngreen</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>bluel</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>f_res</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>err MHz</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>Status</Text>
                </View>
                {[...history].slice(-5).reverse().map((row, idx) => {
                  const hlColor = idx === 0 ? '#eff6ff' : undefined;
                  const badge = row.status === 'converged' ? '✅' : row.status === 'below' ? '🔵' : '🔴';
                  return (
                    <View key={idx} style={[styles.historyDataRow, hlColor && { backgroundColor: hlColor }]}>
                      <Text style={[styles.historyCell, { flex: 0.6 }]}>{row.iter ?? (history.length - idx)}</Text>
                      <Text style={styles.historyCell}>{row.brown != null ? row.brown.toFixed(3) : '—'}</Text>
                      <Text style={styles.historyCell}>{row.ngreen != null ? row.ngreen.toFixed(3) : '—'}</Text>
                      <Text style={styles.historyCell}>{row.bluel != null ? row.bluel.toFixed(2) : '—'}</Text>
                      <Text style={styles.historyCell}>{(row.f_res_discrete ?? row.f_res) != null ? (row.f_res_discrete ?? row.f_res).toFixed(4) : '—'}</Text>
                      <Text style={styles.historyCell}>{row.error_MHz != null ? `${row.error_MHz > 0 ? '+' : ''}${row.error_MHz.toFixed(1)}` : '—'}</Text>
                      <Text style={styles.historyCell}>{badge}</Text>
                    </View>
                  );
                })}
                {history.length > 5 && (
                  <Text style={styles.historyMoreText}>Showing last 5 of {history.length}</Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* ── Phase progress bar ── */}
        {iter > 0 && maxIter > 0 && (
          <View style={styles.phaseProgress}>
            <View style={styles.phaseProgressHeader}>
              <Text style={styles.phaseProgressLabel}>Iteration {iter}/{maxIter}</Text>
              <Text style={styles.phaseProgressPercent}>{Math.round((iter / maxIter) * 100)}%</Text>
            </View>
            <View style={styles.phaseProgressBarOuter}>
              <View style={[styles.phaseProgressBarInner, { width: `${Math.min((iter / maxIter) * 100, 100)}%`, backgroundColor: phaseLabel.color }]} />
            </View>
          </View>
        )}

        {/* ── Fixed variables ── */}
        {phaseData.fixed_variables && Object.keys(phaseData.fixed_variables).length > 0 && (
          <View style={styles.fixedVarsSection}>
            <TouchableOpacity
              onPress={() => setShowFixedVars(p => ({ ...p, 1: !p[1] }))}
              style={styles.fixedVarsToggle}
            >
              <Text style={styles.fixedVarsToggleText}>
                {showFixedVars[1] ? '▲' : '▼'} Fixed Variables ({Object.keys(phaseData.fixed_variables).length})
              </Text>
            </TouchableOpacity>
            {showFixedVars[1] && (
              <View style={styles.fixedVarsGrid}>
                {Object.entries(phaseData.fixed_variables).map(([k, v]) => (
                  <View key={k} style={styles.fixedVarItem}>
                    <Text style={styles.fixedVarName}>{k}</Text>
                    <Text style={styles.fixedVarValue}>{formatVarValue(v)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  // ─────────────────────────────────────────────────────────────
  //  Phase 2: Impedance Matching — Smith chart + 6-step strip
  // ─────────────────────────────────────────────────────────────
  const renderPhase2Detail = (phaseData, phaseLabel, isExpanded) => {
    if (!phaseData) return null;

    const currentVSWR = resolveMetricValue(phaseData.current_VSWR);
    const currentS11  = resolveMetricValue(phaseData.current_S11);
    const currentStep = phaseData.current_step || '';
    const currentSim  = phaseData.current_sim ?? (phaseData.simulations ?? 0);
    const history     = phaseData.history || [];
    const smithData   = phaseData.smith_data || {};
    const tunedVars   = phaseData.tuned_variables || {};

    // 6-step configuration
    const STEPS = [
      { id: 'probex_min',  label: 'P1·min',  var: 'probex', color: '#f59e0b' },
      { id: 'probex_max',  label: 'P1·max',  var: 'probex', color: '#f59e0b' },
      { id: 'probex_pred', label: 'P1·opt',  var: 'probex', color: '#f59e0b' },
      { id: 'purple_min',  label: 'P2·min',  var: 'purple', color: '#a855f7' },
      { id: 'purple_max',  label: 'P2·max',  var: 'purple', color: '#a855f7' },
      { id: 'purple_pred', label: 'P2·opt',  var: 'purple', color: '#a855f7' },
    ];
    // Determine step states from history + currentStep
    const completedSteps = new Set((history || []).map(r => r.step));
    const stepState = (step) => {
      if (completedSteps.has(step.id)) return 'done';
      if (currentStep === step.id) return 'active';
      return 'pending';
    };

    // Smith chart dimensions
    const chartSize = Math.min(width - 80, 300);
    const cx = chartSize / 2;
    const cy = chartSize / 2;
    const R  = (chartSize / 2) * 0.88;

    // Build smith points from smith_data.points
    const smithPoints = (smithData.points || []).filter(p => p.re != null && p.im != null);

    // Resistance circles helper: r circles on Smith chart
    const rCircle = (r_norm) => {
      const radius = R / (1 + r_norm);
      const cx_r   = cx + R * r_norm / (1 + r_norm);
      return { cx: cx_r, cy, radius };
    };

    return (
      <View>
        {/* ── Status message ── */}
        {(phaseData.status_message || status?.status_message) && (
          <View style={styles.statusMessageRow}>
            <Text style={[styles.statusMessageText, { color: phaseLabel.color }]}>
              {phaseData.status_message || status?.status_message}
            </Text>
          </View>
        )}

        {/* ── 6-Step progress strip ── */}
        <View style={styles.p2StepStrip}>
          {STEPS.map((step, i) => {
            const state = stepState(step);
            const icon = state === 'done' ? '✅' : state === 'active' ? '🔄' : '⏳';
            return (
              <React.Fragment key={step.id}>
                <View style={[styles.p2StepBadge,
                  state === 'active' && { backgroundColor: step.color + '22', borderColor: step.color },
                  state === 'done'   && { backgroundColor: '#f0fdf4', borderColor: '#10b981' },
                  state === 'pending' && { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' },
                ]}>
                  <Text style={styles.p2StepIcon}>{icon}</Text>
                  <Text style={[styles.p2StepLabel, state === 'active' && { color: step.color, fontWeight: '800' }]}>
                    {step.label}
                  </Text>
                </View>
                {i < 5 && <Text style={styles.p2StepArrow}>→</Text>}
              </React.Fragment>
            );
          })}
        </View>

        {/* ── VSWR/S11 metrics ── */}
        {(currentVSWR != null || currentS11 != null) && (
          <View style={styles.primaryMetric}>
            {currentVSWR != null && (
              <View style={styles.primaryMetricMain}>
                <Text style={styles.primaryMetricLabel}>VSWR</Text>
                <Text style={[styles.primaryMetricValue, { color: getVSWRColor(currentVSWR) }]}>
                  {currentVSWR.toFixed(2)}
                </Text>
                <Text style={[styles.primaryMetricDelta, { color: getVSWRColor(currentVSWR) }]}>
                  {currentVSWR <= 1.5 ? '✓ Target met' : `Target: ≤ 1.5`}
                </Text>
              </View>
            )}
            {currentS11 != null && (
              <View style={styles.secondaryMetric}>
                <Text style={styles.metricLabel}>S11</Text>
                <Text style={styles.metricValue}>{currentS11.toFixed(1)} dB</Text>
              </View>
            )}
            {currentSim > 0 && (
              <View style={styles.secondaryMetric}>
                <Text style={styles.metricLabel}>Sim</Text>
                <Text style={styles.metricValue}>{currentSim}/6</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Mini Smith Chart ── */}
        {smithPoints.length > 0 && Platform.OS === 'web' && (() => {
          // Build SVG string for web
          const dotConfigs = {
            _min:  { color: '#3b82f6', label: 'min'  },
            _max:  { color: '#ef4444', label: 'max'  },
            _pred: { color: '#eab308', label: 'pred' },
          };
          // Group points by variable for dashed lines
          const linesByVar = {};
          smithPoints.forEach(p => {
            if (!linesByVar[p.var]) linesByVar[p.var] = {};
            const suffix = p.label.replace(p.var, '');
            linesByVar[p.var][suffix] = smithCoords(p.re, p.im, cx, cy, R);
          });

          const docLines = Object.entries(linesByVar).map(([varName, pts]) => {
            if (pts['_min'] && pts['_max']) {
              const varColor = varName === 'probex' ? '#f59e0b' : '#a855f7';
              return `<line x1="${pts['_min'].x.toFixed(1)}" y1="${pts['_min'].y.toFixed(1)}" x2="${pts['_max'].x.toFixed(1)}" y2="${pts['_max'].y.toFixed(1)}" stroke="${varColor}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7"/>`;
            }
            return '';
          }).join('');

          const rCircles = [0.2, 0.5, 1, 2].map(r => {
            const c = rCircle(r);
            return `<circle cx="${c.cx.toFixed(1)}" cy="${c.cy.toFixed(1)}" r="${c.radius.toFixed(1)}" fill="none" stroke="#cbd5e1" stroke-width="0.8"/>`;
          }).join('');

          const dotsSVG = smithPoints.map(p => {
            const suffix = p.label.replace(p.var, '');
            const conf = dotConfigs[suffix] || { color: '#94a3b8', label: '' };
            const pt = smithCoords(p.re, p.im, cx, cy, R);
            const isPred = suffix === '_pred';
            return isPred
              ? `<polygon points="${pt.x.toFixed(1)},${(pt.y - 8).toFixed(1)} ${(pt.x + 7).toFixed(1)},${(pt.y + 4).toFixed(1)} ${(pt.x - 7).toFixed(1)},${(pt.y + 4).toFixed(1)}" fill="${conf.color}" stroke="#fff" stroke-width="1.5"/>
                 <text x="${(pt.x + 10).toFixed(1)}" y="${(pt.y + 4).toFixed(1)}" font-size="9" fill="${conf.color}" font-weight="600">${p.val != null ? p.val.toFixed(2) : ''}</text>`
              : `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="5" fill="${conf.color}" stroke="#fff" stroke-width="1.5"/>
                 <text x="${(pt.x + 8).toFixed(1)}" y="${(pt.y + 4).toFixed(1)}" font-size="9" fill="${conf.color}" font-weight="600">${p.val != null ? p.val.toFixed(2) : ''}</text>`;
          }).join('');

          // Target ★ at chart center (50+0j → Γ=0 → cx, cy)
          const targetSVG = `<text x="${cx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" font-size="14" fill="#10b981">★</text>`;

          const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${chartSize}" height="${chartSize}" viewBox="0 0 ${chartSize} ${chartSize}">
            <circle cx="${cx}" cy="${cy}" r="${R}" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
            <line x1="${cx - R}" y1="${cy}" x2="${cx + R}" y2="${cy}" stroke="#cbd5e1" stroke-width="0.8"/>
            <line x1="${cx}" y1="${cy - R}" x2="${cx}" y2="${cy + R}" stroke="#cbd5e1" stroke-width="0.8"/>
            ${rCircles}
            ${docLines}
            ${dotsSVG}
            ${targetSVG}
            <text x="${(cx - R).toFixed(1)}" y="${(cy + R + 14).toFixed(1)}" font-size="9" fill="#94a3b8">r=0</text>
            <text x="${(cx + R - 20).toFixed(1)}" y="${(cy + R + 14).toFixed(1)}" font-size="9" fill="#94a3b8">r=∞</text>
          </svg>`;

          return (
            <View style={styles.p2SmithContainer}>
              <Text style={styles.sectionLabel}>Smith Chart</Text>
              <View style={styles.p2SmithChart}>
                <img
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(svgStr)}`}
                  width={chartSize}
                  height={chartSize}
                  style={{ display: 'block' }}
                />
              </View>
              {/* Legend */}
              <View style={styles.p2SmithLegend}>
                <View style={styles.p2SmithLegendRow}>
                  <View style={[styles.p2LegendDot, { backgroundColor: '#3b82f6' }]} />
                  <Text style={styles.p2LegendText}>min</Text>
                  <View style={[styles.p2LegendDot, { backgroundColor: '#ef4444', marginLeft: 12 }]} />
                  <Text style={styles.p2LegendText}>max</Text>
                  <View style={[styles.p2LegendDot, { backgroundColor: '#eab308', marginLeft: 12 }]} />
                  <Text style={styles.p2LegendText}>predicted</Text>
                  <Text style={[styles.p2LegendText, { marginLeft: 12, color: '#10b981', fontWeight: '700' }]}>★ target (50Ω)</Text>
                </View>
              </View>
            </View>
          );
        })()}

        {/* ── Variable cards (probex, purple) ── */}
        {Object.keys(tunedVars).length > 0 && (
          <View style={styles.tunedVarsSection}>
            <Text style={styles.sectionLabel}>Variable Predictions</Text>
            {Object.entries(tunedVars).map(([varName, vd]) => {
              const varColor = varName === 'probex' ? '#f59e0b' : '#a855f7';
              const minVal  = vd.range?.[0] ?? 0;
              const maxVal  = vd.range?.[1] ?? 1;
              const range   = maxVal - minVal;
              const pctOf   = (val) => range > 0 ? Math.max(2, Math.min(98, ((val - minVal) / range) * 100)) : 50;
              const zMin    = vd.Z_min;
              const zMax    = vd.Z_max;
              const zPred   = vd.Z_pred;
              const predVSWR = vd.done && zPred != null
                ? (() => {
                    const row = history.find(r => r.step === `${varName}_pred`);
                    return row?.VSWR ?? null;
                  })()
                : null;
              return (
                <View key={varName} style={[styles.p2VarCard, { borderLeftColor: varColor }]}>
                  <View style={styles.p2VarHeader}>
                    <Text style={[styles.tunedVarName, { color: varColor }]}>{varName}</Text>
                    {vd.done && predVSWR != null && (
                      <View style={[styles.p2VswrBadge, { backgroundColor: getVSWRColor(predVSWR) + '22', borderColor: getVSWRColor(predVSWR) }]}>
                        <Text style={[styles.p2VswrBadgeText, { color: getVSWRColor(predVSWR) }]}>
                          VSWR {predVSWR.toFixed(2)}
                        </Text>
                      </View>
                    )}
                  </View>
                  {/* Number line */}
                  <View style={styles.p2NumberLine}>
                    <View style={styles.searchRangeBar}>
                      {/* min marker */}
                      {vd.Z_min != null && (
                        <View style={[styles.searchRangeMarker, { left: `${pctOf(minVal)}%`, backgroundColor: '#3b82f6' }]} />
                      )}
                      {/* pred star */}
                      {zPred != null && vd.current != null && (
                        <View style={[styles.searchRangeMarker, { left: `${pctOf(vd.current)}%`, backgroundColor: varColor, width: 14, height: 14, borderRadius: 7, top: -3 }]} />
                      )}
                      {/* max marker */}
                      {vd.Z_max != null && (
                        <View style={[styles.searchRangeMarker, { left: `${pctOf(maxVal)}%`, backgroundColor: '#ef4444' }]} />
                      )}
                    </View>
                    <View style={styles.p2NumberLineLabels}>
                      <Text style={styles.searchRangeLabel}>{minVal} mm</Text>
                      {zPred != null && (
                        <Text style={[styles.searchRangeLabel, { color: varColor, fontWeight: '700' }]}>★ {vd.current?.toFixed(2)} mm</Text>
                      )}
                      <Text style={styles.searchRangeLabel}>{maxVal} mm</Text>
                    </View>
                  </View>
                  {/* Z values */}
                  {(zMin != null || zMax != null || zPred != null) && (
                    <View style={styles.p2ZRow}>
                      {zMin  != null && zMin.re  != null && <Text style={styles.p2ZText}>Z_min: {zMin.re.toFixed(1)}{zMin.im != null ? (zMin.im >= 0 ? `+${zMin.im.toFixed(1)}` : zMin.im.toFixed(1)) : ''}j Ω</Text>}
                      {zMax  != null && zMax.re  != null && <Text style={styles.p2ZText}>Z_max: {zMax.re.toFixed(1)}{zMax.im != null ? (zMax.im >= 0 ? `+${zMax.im.toFixed(1)}` : zMax.im.toFixed(1)) : ''}j Ω</Text>}
                      {zPred != null && zPred.re != null && <Text style={[styles.p2ZText, { color: varColor, fontWeight: '700' }]}>Z_pred: {zPred.re.toFixed(1)}{zPred.im != null ? (zPred.im >= 0 ? `+${zPred.im.toFixed(1)}` : zPred.im.toFixed(1)) : ''}j Ω</Text>}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* ── Results summary (all 6 sims done) ── */}
        {currentSim >= 6 && history.length >= 6 && (
          <View style={styles.p2ResultsTable}>
            <Text style={styles.sectionLabel}>Interpolation Results</Text>
            <View style={styles.historyTable}>
              <View style={styles.historyHeaderRow}>
                <Text style={[styles.historyCell, styles.historyHeader]}>Variable</Text>
                <Text style={[styles.historyCell, styles.historyHeader]}>Z_min</Text>
                <Text style={[styles.historyCell, styles.historyHeader]}>Z_max</Text>
                <Text style={[styles.historyCell, styles.historyHeader]}>Z_pred</Text>
                <Text style={[styles.historyCell, styles.historyHeader]}>VSWR</Text>
              </View>
              {['probex', 'purple'].map(vn => {
                const vd = tunedVars[vn];
                if (!vd) return null;
                const predRow = history.find(r => r.step === `${vn}_pred`);
                return (
                  <View key={vn} style={styles.historyDataRow}>
                    <Text style={styles.historyCell}>{vn}</Text>
                    <Text style={styles.historyCell}>{vd.Z_min?.re != null ? `${vd.Z_min.re.toFixed(1)}${vd.Z_min.im != null ? (vd.Z_min.im >= 0 ? `+${vd.Z_min.im.toFixed(1)}` : vd.Z_min.im.toFixed(1)) : ''}j` : '—'}</Text>
                    <Text style={styles.historyCell}>{vd.Z_max?.re != null ? `${vd.Z_max.re.toFixed(1)}${vd.Z_max.im != null ? (vd.Z_max.im >= 0 ? `+${vd.Z_max.im.toFixed(1)}` : vd.Z_max.im.toFixed(1)) : ''}j` : '—'}</Text>
                    <Text style={styles.historyCell}>{vd.Z_pred?.re != null ? `${vd.Z_pred.re.toFixed(1)}${vd.Z_pred.im != null ? (vd.Z_pred.im >= 0 ? `+${vd.Z_pred.im.toFixed(1)}` : vd.Z_pred.im.toFixed(1)) : ''}j` : '—'}</Text>
                    <Text style={[styles.historyCell, predRow?.VSWR != null && { color: getVSWRColor(predRow.VSWR), fontWeight: '700' }]}>
                      {predRow?.VSWR != null ? predRow.VSWR.toFixed(2) : '—'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* ── Simulation history table ── */}
        {history.length > 0 && (
          <View style={styles.runningHistorySection}>
            <TouchableOpacity onPress={() => toggleHistory(2)} style={styles.historyToggle}>
              <Text style={styles.historyToggleText}>
                {isExpanded ? '▲ Hide history' : `▼ Simulation history (${history.length})`}
              </Text>
            </TouchableOpacity>
            {isExpanded && (
              <View style={styles.historyTable}>
                <View style={styles.historyHeaderRow}>
                  <Text style={[styles.historyCell, styles.historyHeader, { flex: 0.5 }]}>Sim</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>Step</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>probex</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>purple</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>VSWR</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>S11</Text>
                </View>
                {[...history].reverse().map((row, idx) => (
                  <View key={idx} style={[styles.historyDataRow, idx === 0 && { backgroundColor: '#eff6ff' }]}>
                    <Text style={[styles.historyCell, { flex: 0.5 }]}>{row.sim ?? '—'}</Text>
                    <Text style={styles.historyCell}>{row.step ?? '—'}</Text>
                    <Text style={styles.historyCell}>{row.probex != null ? row.probex.toFixed(2) : '—'}</Text>
                    <Text style={styles.historyCell}>{row.purple != null ? row.purple.toFixed(2) : '—'}</Text>
                    <Text style={[styles.historyCell, row.VSWR != null && { color: getVSWRColor(row.VSWR), fontWeight: '700' }]}>
                      {row.VSWR != null ? row.VSWR.toFixed(2) : '—'}
                    </Text>
                    <Text style={styles.historyCell}>{row.S11 != null ? `${row.S11.toFixed(1)}` : '—'}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── Fixed variables ── */}
        {phaseData.fixed_variables && Object.keys(phaseData.fixed_variables).length > 0 && (
          <View style={styles.fixedVarsSection}>
            <TouchableOpacity onPress={() => setShowFixedVars(p => ({ ...p, 2: !p[2] }))} style={styles.fixedVarsToggle}>
              <Text style={styles.fixedVarsToggleText}>
                {showFixedVars[2] ? '▲' : '▼'} Fixed Variables ({Object.keys(phaseData.fixed_variables).length})
              </Text>
            </TouchableOpacity>
            {showFixedVars[2] && (
              <View style={styles.fixedVarsGrid}>
                {Object.entries(phaseData.fixed_variables).map(([k, v]) => (
                  <View key={k} style={styles.fixedVarItem}>
                    <Text style={styles.fixedVarName}>{k}</Text>
                    <Text style={styles.fixedVarValue}>{formatVarValue(v)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  // ─────────────────────────────────────────────────────────────
  //  Phase 3: CP Optimization — AR gauge + iteration table
  // ─────────────────────────────────────────────────────────────
  const renderPhase3Detail = (phaseData, phaseLabel, isExpanded) => {
    if (!phaseData) return null;
    const rawAR  = phaseData.current_AR;
    const arKeys = ['x1_570', 'x1_575', 'x1_580'];
    const arFreqs = [1.570, 1.575, 1.580];
    const getAR = (key, idx) => {
      if (rawAR == null || (Array.isArray(rawAR) && rawAR.length === 0)) return null;
      if (Array.isArray(rawAR)) return typeof rawAR[idx] === 'number' ? rawAR[idx] : null;
      if (typeof rawAR === 'object') return typeof rawAR[key] === 'number' ? rawAR[key] : null;
      if (typeof rawAR === 'number' && idx === 1) return rawAR;
      return null;
    };
    const ar575   = getAR('x1_575', 1);
    const worstAR = resolveMetricValue(phaseData.worst_AR) ??
      Math.max(...arKeys.map((k, i) => getAR(k, i) ?? -Infinity).filter(isFinite));

    const iter    = phaseData.iteration || 0;
    const maxIter = phaseData.max_iterations || 15;
    const history = phaseData.history || [];
    const tunedVars = phaseData.tuned_variables || {};

    // AR gauge: arc from 0–20 dB (180° sweep)
    const gaugePct = worstAR != null ? Math.min(1, Math.max(0, (isFinite(worstAR) ? worstAR : 20) / 20)) : null;
    const gaugeColor = isFinite(worstAR) ? getARColor(worstAR) : '#94a3b8';
    const gaugeAngle = gaugePct != null ? gaugePct * 180 : null; // degrees from left (0) to right (180)

    return (
      <View>
        {/* ── Status message ── */}
        {(phaseData.status_message || status?.status_message) && (
          <View style={styles.statusMessageRow}>
            <Text style={[styles.statusMessageText, { color: phaseLabel.color }]}>
              {phaseData.status_message || status?.status_message}
            </Text>
          </View>
        )}

        {/* ── AR Gauge + 3-frequency display ── */}
        {(rawAR != null && !(Array.isArray(rawAR) && rawAR.length === 0)) ? (
          <View style={styles.p3ARSection}>
            <Text style={styles.sectionLabel}>Axial Ratio</Text>
            {/* 3 frequency values in a row */}
            <View style={styles.arFreqRow}>
              {arKeys.map((key, i) => {
                const arVal = getAR(key, i);
                const isPrimary = i === 1;
                return (
                  <View key={key} style={[styles.arFreqItem, isPrimary && styles.arFreqItemPrimary]}>
                    <Text style={[styles.arFreqLabel, isPrimary && { fontSize: 11, fontWeight: '700' }]}>
                      {arFreqs[i]} GHz{isPrimary ? ' ★' : ''}
                    </Text>
                    <Text style={[
                      styles.arFreqValue,
                      isPrimary && { fontSize: 22 },
                      { color: getARColor(arVal) }
                    ]}>
                      {arVal != null ? `${arVal.toFixed(1)} dB` : '—'}
                    </Text>
                    {isPrimary && ar575 != null && (
                      <Text style={{ fontSize: 10, color: getARColor(ar575), fontWeight: '600', marginTop: 2 }}>
                        {ar575 <= 2 ? '✓ Target met' : `Target: ≤ 2 dB`}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
            {/* Worst AR + simple color bar */}
            {isFinite(worstAR) && (
              <View style={styles.p3GaugeRow}>
                <Text style={styles.worstARLabel}>Worst AR:</Text>
                <Text style={[styles.worstARValue, { color: gaugeColor }]}>{worstAR.toFixed(2)} dB</Text>
                <View style={styles.p3GaugeBar}>
                  {/* Color zones */}
                  <View style={[styles.p3GaugeZone, { flex: 2/20, backgroundColor: '#10b981' }]} />
                  <View style={[styles.p3GaugeZone, { flex: 3/20, backgroundColor: '#f59e0b' }]} />
                  <View style={[styles.p3GaugeZone, { flex: 5/20, backgroundColor: '#f97316' }]} />
                  <View style={[styles.p3GaugeZone, { flex: 10/20, backgroundColor: '#ef4444' }]} />
                  {/* Needle */}
                  {gaugePct != null && (
                    <View style={[styles.p3GaugeNeedle, { left: `${gaugePct * 100}%` }]} />
                  )}
                </View>
                <View style={styles.p3GaugeLabels}>
                  <Text style={styles.p3GaugeLabel}>0</Text>
                  <Text style={[styles.p3GaugeLabel, { color: '#10b981' }]}>2</Text>
                  <Text style={styles.p3GaugeLabel}>5</Text>
                  <Text style={styles.p3GaugeLabel}>10</Text>
                  <Text style={styles.p3GaugeLabel}>20 dB</Text>
                </View>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.p3PreStepPanel}>
            {/* Spinner + live status message */}
            <View style={styles.initializingRow}>
              <ActivityIndicator size="small" color={phaseLabel.color} />
              <Text style={[styles.initializingText, { color: phaseLabel.color }]}>
                {status?.status_message || 'Phase 3: Running initial CP evaluation...'}
              </Text>
            </View>
            {/* Guide: explain the pre-step sequence to the user */}
            <View style={styles.p3GuideBox}>
              <Text style={styles.p3GuideTitle}>🔄 What is happening?</Text>
              <Text style={styles.p3GuideText}>
                Before tuning begins, MATLAB runs up to 3 preparatory HFSS simulations to assess the CP loop state:
              </Text>
              <View style={styles.p3GuideStep}>
                <Text style={styles.p3GuideStepNum}>❶</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.p3GuideStepTitle}>Initial evaluation</Text>
                  <Text style={styles.p3GuideStepDesc}>
                    Simulates the current <Text style={{ fontStyle: 'italic' }}>orange</Text> &amp; <Text style={{ fontStyle: 'italic' }}>orange2</Text> values at 1.570 / 1.575 / 1.580 GHz to classify whether the CP loop is formed, oversized, or absent.
                  </Text>
                </View>
              </View>
              <View style={styles.p3GuideStep}>
                <Text style={styles.p3GuideStepNum}>❷</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.p3GuideStepTitle}>orange2 neutral reset <Text style={styles.p3GuideStepOptional}>(if no loop)</Text></Text>
                  <Text style={styles.p3GuideStepDesc}>
                    If <Text style={{ fontStyle: 'italic' }}>orange2</Text> is too high it over-shrinks the loop and blocks formation. MATLAB resets it to the midpoint so <Text style={{ fontStyle: 'italic' }}>orange</Text> can form the loop freely.
                  </Text>
                </View>
              </View>
              <View style={styles.p3GuideStep}>
                <Text style={styles.p3GuideStepNum}>❸</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.p3GuideStepTitle}>Pre-shrink <Text style={styles.p3GuideStepOptional}>(if loop too large)</Text></Text>
                  <Text style={styles.p3GuideStepDesc}>
                    If the loop spans too many frequencies (high AR standard deviation), MATLAB increases <Text style={{ fontStyle: 'italic' }}>orange2</Text> to compact it until AR at 1.575 GHz is near 2 dB before the main bisection begins.
                  </Text>
                </View>
              </View>
              <Text style={[styles.p3GuideText, { marginTop: 8, color: '#64748b', fontStyle: 'italic' }]}>
                Each step takes one full HFSS simulation. The AR gauges above will appear once the first simulation completes.
              </Text>
            </View>
          </View>
        )}

        {/* ── Tuned variable sliders (orange, orange2 in °) ── */}
        {Object.keys(tunedVars).length > 0 && (
          <View style={styles.tunedVarsSection}>
            <Text style={styles.sectionLabel}>Tuned Variables (orange, orange2)</Text>
            <View style={styles.p1VarCard}>
              {Object.entries(tunedVars).map(([name, vd]) => {
                const startPct = vd.range ? getMarkerPosition(vd.start ?? vd.current, vd.range) : 50;
                const curPct   = vd.range ? getMarkerPosition(vd.current, vd.range) : 50;
                return (
                  <View key={name} style={styles.p1VarRow}>
                    <View style={styles.p1VarLabelRow}>
                      <Text style={styles.tunedVarName}>{name}</Text>
                      <Text style={styles.tunedVarValues}>
                        {vd.start != null ? `start: ${vd.start}° → ` : ''}<Text style={styles.tunedVarCurrent}>{vd.current}°</Text>
                      </Text>
                    </View>
                    {vd.range && (
                      <View style={styles.searchRange}>
                        <View style={styles.searchRangeBar}>
                          {vd.start != null && (
                            <View style={[styles.searchRangeMarker, styles.searchRangeStart, { left: `${startPct}%` }]} />
                          )}
                          <View style={[styles.searchRangeMarker, styles.searchRangeCurrent, { left: `${curPct}%`, backgroundColor: '#10b981' }]} />
                        </View>
                        <View style={styles.searchRangeLabels}>
                          <Text style={styles.searchRangeLabel}>{vd.range[0]}°</Text>
                          <Text style={styles.searchRangeLabel}>{vd.range[1]}°</Text>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* ── Drift warning ── */}
        {(phaseData.drift_detected || (phaseData.drift_corrections ?? 0) > 0) && (
          <View style={styles.driftWarning}>
            <Text style={styles.driftWarningText}>
              ⚠️ Frequency drift detected — correcting ({phaseData.drift_corrections || 0} correction{(phaseData.drift_corrections || 0) !== 1 ? 's' : ''})
            </Text>
          </View>
        )}

        {/* ── Iteration progress bar ── */}
        {iter > 0 && maxIter > 0 && (
          <View style={styles.phaseProgress}>
            <View style={styles.phaseProgressHeader}>
              <Text style={styles.phaseProgressLabel}>Iteration {iter}/{maxIter}</Text>
              <Text style={styles.phaseProgressPercent}>{Math.round((iter / maxIter) * 100)}%</Text>
            </View>
            <View style={styles.phaseProgressBarOuter}>
              <View style={[styles.phaseProgressBarInner, { width: `${Math.min((iter / maxIter) * 100, 100)}%`, backgroundColor: phaseLabel.color }]} />
            </View>
          </View>
        )}

        {/* ── Iteration history table ── */}
        {history.length > 0 && (
          <View style={styles.runningHistorySection}>
            <TouchableOpacity onPress={() => toggleHistory(3)} style={styles.historyToggle}>
              <Text style={styles.historyToggleText}>
                {isExpanded ? '▲ Hide history' : `▼ Iteration history (${history.length})`}
              </Text>
            </TouchableOpacity>
            {isExpanded && (
              <View style={styles.historyTable}>
                <View style={styles.historyHeaderRow}>
                  <Text style={[styles.historyCell, styles.historyHeader, { flex: 0.5 }]}>#</Text>
                  <Text style={[styles.historyCell, styles.historyHeader, { flex: 0.8 }]}>Step</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>orange°</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>orange2°</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>AR@1.575</Text>
                  <Text style={[styles.historyCell, styles.historyHeader]}>f_res</Text>
                </View>
                {[...history].reverse().map((row, idx) => {
                  const isDrift = !!(row.drift ?? row.drift_corrected);
                  const stepLabel = (() => {
                    const s = row.step || '';
                    if (s === 'init') return 'Init';
                    if (s.includes('freq_corr')) return '△f';
                    if (s === 'orange') return 'Og↑';
                    if (s === 'orange2') return 'Og2';
                    if (s.startsWith('preshrink')) return 'Shrink';
                    return s || '—';
                  })();
                  return (
                    <View key={idx} style={[styles.historyDataRow,
                      idx === 0 && { backgroundColor: '#f0fdf4' },
                      isDrift && { backgroundColor: '#fffbeb' },
                    ]}>
                      <Text style={[styles.historyCell, { flex: 0.5 }]}>{row.iter ?? (history.length - idx)}</Text>
                      <Text style={[styles.historyCell, { flex: 0.8, fontSize: 10, color: isDrift ? '#f59e0b' : '#64748b' }]}>{isDrift ? `⚠ ${stepLabel}` : stepLabel}</Text>
                      <Text style={styles.historyCell}>{row.orange != null ? row.orange.toFixed(1) : '—'}</Text>
                      <Text style={styles.historyCell}>{row.orange2 != null ? row.orange2.toFixed(1) : '—'}</Text>
                      <Text style={[styles.historyCell, row.AR_1575 != null && { color: getARColor(row.AR_1575), fontWeight: '700' }]}>
                        {row.AR_1575 != null ? row.AR_1575.toFixed(1) : '—'}
                      </Text>
                      <Text style={styles.historyCell}>{row.f_res != null ? row.f_res.toFixed(4) : '—'}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ── Fixed variables ── */}
        {phaseData.fixed_variables && Object.keys(phaseData.fixed_variables).length > 0 && (
          <View style={styles.fixedVarsSection}>
            <TouchableOpacity onPress={() => setShowFixedVars(p => ({ ...p, 3: !p[3] }))} style={styles.fixedVarsToggle}>
              <Text style={styles.fixedVarsToggleText}>
                {showFixedVars[3] ? '▲' : '▼'} Fixed Variables ({Object.keys(phaseData.fixed_variables).length})
              </Text>
            </TouchableOpacity>
            {showFixedVars[3] && (
              <View style={styles.fixedVarsGrid}>
                {Object.entries(phaseData.fixed_variables).map(([k, v]) => (
                  <View key={k} style={styles.fixedVarItem}>
                    <Text style={styles.fixedVarName}>{k}</Text>
                    <Text style={styles.fixedVarValue}>{formatVarValue(v)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  /**
   * Determine phase status for display.
   * Checks new per-phase schema first, falls back to old flat schema.
   */
  const getPhaseStatus = (phaseId) => {
    if (!status) return 'pending';

    // New schema: status.phase1.status, etc.
    const phaseKey = `phase${phaseId}`;
    if (status[phaseKey]?.status) {
      return status[phaseKey].status;
    }

    // Old schema fallback
    const cp = status.current_phase ?? status.phase ?? 0;
    const manSt = status.manager?.status || status.status || 'unknown';
    const alive = status.manager?.matlabAlive || false;
    const fileStatus = status.status || 'starting';

    if (status.phase_history) {
      const historyEntry = status.phase_history.find(h => h.phase === phaseId);
      if (historyEntry) {
        if (historyEntry.status === 'completed') return 'completed';
        if (historyEntry.status === 'error') return 'error';
      }
    }

    if (phaseId === cp) return 'running';
    if (phaseId < cp) return 'completed';

    // MATLAB alive but hasn't written progress yet — Phase 1 is initializing
    if (phaseId === 1 && cp === 0 && (alive || manSt === 'running') && (fileStatus === 'starting' || fileStatus === 'resuming')) {
      return 'running';
    }

    return 'pending';
  };

  /**
   * Get phase history data (old schema)
   */
  const getPhaseHistory = (phaseId) => {
    if (!status || !status.phase_history) return null;
    return status.phase_history.find(h => h.phase === phaseId);
  };

  /**
   * Extract per-phase data from either new or old schema.
   * New: status.phase1 / status.phase2 / status.phase3
   * Old: reconstructed from status.current_variables, status.current_results, status.phase_history
   */
  const getPhaseData = (phaseId) => {
    if (!status) return null;

    // New schema: direct per-phase object
    const phaseKey = `phase${phaseId}`;
    if (status[phaseKey]) {
      return status[phaseKey];
    }

    // Old schema fallback
    const ps = getPhaseStatus(phaseId);
    const tunedVarNames = PHASE_TUNED_VARS[phaseId] || [];

    if (ps === 'running' && status.current_variables) {
      const tunedVars = {};
      const fixedVars = {};
      Object.entries(status.current_variables).forEach(([key, val]) => {
        if (tunedVarNames.includes(key)) {
          tunedVars[key] = { start: val, current: val, range: null };
        } else {
          fixedVars[key] = val;
        }
      });

      return {
        status: 'running',
        tuned_variables: Object.keys(tunedVars).length > 0 ? tunedVars : null,
        fixed_variables: fixedVars,
        current_metrics: status.current_results || {},
        history: [],
        ...(phaseId === 2 && status.phase_step ? { current_step: status.phase_step.replace(/Phase\s*2\w?/i, '').trim() || status.phase_step } : {}),
      };
    }

    if (ps === 'completed') {
      const history = getPhaseHistory(phaseId);
      if (history) {
        const tunedVars = {};
        if (history.tuned_vars) {
          Object.entries(history.tuned_vars).forEach(([k, v]) => {
            tunedVars[k] = { current: v };
          });
        }
        return {
          status: 'completed',
          tuned_variables: Object.keys(tunedVars).length > 0 ? tunedVars : null,
          fixed_variables: {},
          iterations: history.iterations,
          final_metric: history.final_metric,
          elapsed_seconds: history.elapsed_seconds,
          history: history.iteration_log || [],
        };
      }
    }

    return { status: ps };
  };

  /**
   * Render primary metric for a running phase
   */
  const renderPrimaryMetric = (phaseId, phaseData) => {
    const conf = PHASE_METRIC_CONFIG[phaseId];
    if (!conf) return null;

    // Look up primary value: check phaseData first (MATLAB schema), then legacy current_metrics
    const lookupMetric = (key, altKeys) => {
      // 1. Direct on phaseData (MATLAB writes current_f_res, current_VSWR, etc. at phase level)
      let val = resolveMetricValue(phaseData?.[key]);
      if (val != null) return val;
      // 2. In current_metrics sub-object (old schema)
      const metrics = phaseData?.current_metrics || status?.current_results || {};
      val = resolveMetricValue(metrics[key]);
      if (val != null) return val;
      // 3. Alt keys
      if (altKeys) {
        for (const alt of altKeys) {
          val = resolveMetricValue(phaseData?.[alt]) ?? resolveMetricValue(metrics[alt]);
          if (val != null) return val;
        }
      }
      return null;
    };

    let primaryVal = lookupMetric(conf.primary, conf.altKeys);
    let secondaryVal = conf.secondary ? lookupMetric(conf.secondary, conf.altSecKeys) : null;

    // Phase 3: AR might be an object with frequency keys or an array — show worst AR instead
    if (phaseId === 3 && primaryVal != null && typeof primaryVal === 'object' && !Array.isArray(primaryVal)) {
      const worstAR = resolveMetricValue(phaseData?.worst_AR) ?? Math.max(...Object.values(primaryVal).filter(v => typeof v === 'number'));
      primaryVal = isFinite(worstAR) ? worstAR : null;
    }

    if (primaryVal == null && secondaryVal == null) return null;

    return (
      <View style={styles.primaryMetric}>
        <View style={styles.primaryMetricMain}>
          <Text style={styles.primaryMetricLabel}>{conf.label}</Text>
          <Text style={[styles.primaryMetricValue, { color: getMetricColor(phaseId, primaryVal) }]}>
            {primaryVal != null ? `${primaryVal.toFixed(3)} ${conf.unit}` : '\u2014'}
          </Text>
          {phaseId === 1 && primaryVal != null && (
            <Text style={[styles.primaryMetricDelta, { color: getMetricColor(phaseId, primaryVal) }]}>
              {primaryVal > conf.target
                ? `+${((primaryVal - conf.target) * 1000).toFixed(0)} MHz above`
                : primaryVal < conf.target
                  ? `${((primaryVal - conf.target) * 1000).toFixed(0)} MHz below`
                  : '\u2713 On target'}
            </Text>
          )}
        </View>
        {conf.secondary && (
          <View style={styles.secondaryMetric}>
            <Text style={styles.metricLabel}>{conf.secLabel}</Text>
            <Text style={styles.metricValue}>
              {secondaryVal != null ? `${secondaryVal.toFixed(1)} ${conf.secUnit}` : '\u2014'}
            </Text>
          </View>
        )}
      </View>
    );
  };

  /**
   * Render iteration history table (shared by running & completed phases)
   */
  const renderHistoryTable = (phaseId, history) => {
    if (!history || history.length === 0) return null;
    const tunedVarNames = PHASE_TUNED_VARS[phaseId] || [];
    const mConf = PHASE_METRIC_CONFIG[phaseId];

    // Build column order: tuned vars first, then metrics, then others
    const cols = [];
    const firstRow = history[0] || {};
    tunedVarNames.forEach(v => { if (v in firstRow) cols.push(v); });
    Object.keys(firstRow).forEach(k => {
      if (k !== 'iteration' && k !== 'status' && !cols.includes(k)) cols.push(k);
    });

    const displayRows = [...history].reverse().slice(0, 20);

    // Find the metric key for row coloring — try primary then alt keys
    const metricKey = mConf ? [mConf.primary, ...(mConf.altKeys || [])].find(k => k in (firstRow || {})) : null;

    return (
      <View style={styles.historyTable}>
        <View style={styles.historyHeaderRow}>
          <Text style={[styles.historyCell, styles.historyHeader, { flex: 0.6 }]}>#</Text>
          {cols.map(col => (
            <Text key={col} style={[styles.historyCell, styles.historyHeader]}>{col}</Text>
          ))}
        </View>
        {displayRows.map((row, idx) => {
          const metricVal = metricKey ? row[metricKey] : null;
          const rowColor = metricVal != null ? getMetricColor(phaseId, metricVal) : undefined;

          return (
            <View key={idx} style={[styles.historyDataRow, rowColor && { borderLeftWidth: 3, borderLeftColor: rowColor }]}>
              <Text style={[styles.historyCell, { flex: 0.6 }]}>{row.iteration || history.length - idx}</Text>
              {cols.map(col => (
                <Text key={col} style={styles.historyCell}>
                  {typeof row[col] === 'number' ? row[col].toFixed(3) : (row[col] ?? '\u2014')}
                </Text>
              ))}
            </View>
          );
        })}
        {history.length > 20 && (
          <Text style={styles.historyMoreText}>Showing latest 20 of {history.length} iterations</Text>
        )}
      </View>
    );
  };

  // Loading state
  if (isLoading && !status) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color="#7c3aed" />
        <Text style={styles.loadingText}>Connecting to tuning process...</Text>
      </View>
    );
  }

  const currentPhase = status?.current_phase ?? status?.phase ?? 0;
  const totalSims = status?.total_simulations || 0;
  const estimatedSims = status?.estimated_total_simulations || 0;
  const progressPercent = estimatedSims > 0
    ? Math.min(100, Math.round((totalSims / estimatedSims) * 100))
    : (status?.progress_percent || 0);
  const elapsed = status?.elapsed_seconds || 0;
  const managerStatus = status?.manager?.status || status?.status || 'unknown';
  const statusFromFile = status?.status || 'starting';
  const isFinished = ['completed', 'error', 'cancelled', 'stopped'].includes(managerStatus);
  const isInvalidInitial = statusFromFile === 'invalid_initial';
  const matlabAlive = status?.manager?.matlabAlive || false;
  const isStuckStarting = (statusFromFile === 'starting' || statusFromFile === 'resuming') && elapsed > 10;
  const isMatlabCrashed = managerStatus === 'error' && statusFromFile === 'error';
  const statusMessage = status?.status_message || '';
  const invalidDetails = status?.invalid_details || null;

  // Smart progress: when MATLAB is alive but status.json hasn't been written yet,
  // we know Phase 1 is initializing — give a small visual progress so it doesn't look stuck
  const isInitializing = (statusFromFile === 'starting' || statusFromFile === 'resuming' || currentPhase === 0) && !isFinished && (matlabAlive || managerStatus === 'running');
  const displayPercent = isInitializing && progressPercent === 0 ? 2 : progressPercent;
  const currentIteration = status?.iteration || 0;
  const maxIterations = status?.max_iterations || 0;

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={['#7c3aed', '#6d28d9', '#5b21b6']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Tuning Progress</Text>
          <View style={{ width: 60 }} />
        </View>
      </LinearGradient>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>

        {/* Overall Progress */}
        <View style={styles.overallCard}>
          {/* Phase stepper dots */}
          <View style={styles.phaseStepper}>
            {[1, 2, 3].map((pid) => {
              const ps = getPhaseStatus(pid);
              const isActive = ps === 'running' || (isInitializing && pid === 1);
              const isDone = ps === 'completed';
              return (
                <React.Fragment key={pid}>
                  <View style={styles.stepperItem}>
                    <View style={[
                      styles.stepperDot,
                      isDone && styles.stepperDotDone,
                      isActive && styles.stepperDotActive,
                    ]}>
                      <Text style={styles.stepperDotText}>
                        {isDone ? '✓' : pid}
                      </Text>
                    </View>
                    <Text style={[
                      styles.stepperLabel,
                      isActive && styles.stepperLabelActive,
                      isDone && styles.stepperLabelDone,
                    ]}>
                      {PHASE_LABELS[pid].name.split(' ')[0]}
                    </Text>
                  </View>
                  {pid < 3 && (
                    <View style={[
                      styles.stepperLine,
                      isDone && styles.stepperLineDone,
                    ]} />
                  )}
                </React.Fragment>
              );
            })}
          </View>

          {/* Progress bar */}
          <View style={styles.progressBarOuter}>
            <LinearGradient
              colors={isInvalidInitial ? ['#ef4444', '#f87171'] : displayPercent > 0 ? ['#7c3aed', '#a855f7'] : ['#e2e8f0', '#e2e8f0']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.progressBarInner, { width: isInvalidInitial ? '100%' : `${Math.max(Math.min(displayPercent, 100), 0)}%` }]}
            />
          </View>

          {/* Stats row */}
          <View style={styles.overallStats}>
            {isInvalidInitial ? (
              <>
                <Text style={[styles.overallPercent, { color: '#ef4444' }]}>⚠️</Text>
                <Text style={[styles.overallDetail, { color: '#ef4444', fontWeight: '600' }]}>
                  Invalid — Action Required
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.overallPercent}>{progressPercent}%</Text>
                <Text style={styles.overallDetail}>
                  {statusMessage
                    ? statusMessage
                    : isInitializing
                      ? 'Initializing...'
                      : totalSims > 0
                        ? `${totalSims}${estimatedSims > 0 ? '/' + estimatedSims : ''} simulation${totalSims !== 1 ? 's' : ''}`
                        : 'Starting...'}
                </Text>
                <Text style={styles.overallDetail}>⏱ {formatElapsed(elapsed)}</Text>
              </>
            )}
          </View>

          {(managerStatus === 'cancelled' || managerStatus === 'stopped') && (
            <View style={styles.pausedBanner}>
              <Text style={styles.pausedBannerText}>🚫 STOPPED</Text>
            </View>
          )}

          {managerStatus === 'stopping' && (
            <View style={styles.matlabAliveBanner}>
              <View style={styles.matlabAliveRow}>
                <ActivityIndicator color="#f59e0b" size="small" />
                <Text style={styles.matlabAliveText}>
                  Stopping... MATLAB is saving checkpoint
                </Text>
              </View>
            </View>
          )}

          {/* MATLAB status indicator when status.json hasn't updated */}
          {isStuckStarting && !isFinished && matlabAlive && (
            <View style={styles.matlabAliveBanner}>
              <View style={styles.matlabAliveRow}>
                <ActivityIndicator color="#16a34a" size="small" />
                <Text style={styles.matlabAliveText}>
                  MATLAB is running ({formatElapsed(elapsed)})
                </Text>
              </View>
              <Text style={styles.matlabAliveHint}>
                Waiting for MATLAB to write progress updates...
              </Text>
            </View>
          )}

          {isStuckStarting && !isFinished && !matlabAlive && elapsed > 15 && (
            <View style={styles.matlabDeadBanner}>
              <Text style={styles.matlabDeadText}>
                ⚠️ MATLAB process not detected
              </Text>
              <Text style={styles.matlabDeadHint}>
                MATLAB may have exited without starting tuning. Check the MATLAB console for errors.
              </Text>
            </View>
          )}
        </View>

        {/* MATLAB Crash / Error Banner */}
        {isMatlabCrashed && (
          <View style={styles.crashBanner}>
            <Text style={styles.crashTitle}>❌ MATLAB Exited Unexpectedly</Text>
            <Text style={styles.crashMessage}>
              {status?.status_message || status?.phase_step || 'MATLAB process terminated without completing. Check MATLAB console for errors.'}
            </Text>
            <Text style={styles.crashHint}>
              Common causes: EP_Start.m not found, MATLAB path errors, or HFSS license issues.
            </Text>
            <TouchableOpacity style={styles.crashBackButton} onPress={onBack}>
              <Text style={styles.crashBackButtonText}>← Go Back & Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Error Banner */}
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>⚠️ {error}</Text>
            <TouchableOpacity onPress={fetchStatus}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Phase Cards */}
        {[1, 2, 3].map(phaseId => {
          const phaseLabel = PHASE_LABELS[phaseId];
          const phaseStatus = getPhaseStatus(phaseId);
          const statusConf = STATUS_CONFIG[phaseStatus] || STATUS_CONFIG.pending;
          const phaseData = getPhaseData(phaseId);
          const isCurrentPhase = phaseStatus === 'running';
          const isCompleted = phaseStatus === 'completed';
          const isPending = phaseStatus === 'pending';
          const isInvalid = phaseStatus === 'invalid' || phaseStatus === 'invalid_initial';
          const isCollapsed = collapsedPhases[phaseId];
          const isExpanded = expandedHistory[phaseId];
          const tunedVarNames = PHASE_TUNED_VARS[phaseId] || [];
          const metricConf = PHASE_METRIC_CONFIG[phaseId];

          return (
            <View
              key={phaseId}
              style={[styles.phaseCard, { borderLeftColor: isInvalid ? '#ef4444' : phaseLabel.color }]}
            >
              {/* Phase Header — always visible, tappable for completed phases */}
              <TouchableOpacity
                style={styles.phaseHeader}
                onPress={() => isCompleted && setCollapsedPhases(p => ({...p, [phaseId]: !p[phaseId]}))}
                activeOpacity={isCompleted ? 0.7 : 1}
                disabled={!isCompleted}
              >
                <Text style={styles.phaseIcon}>{phaseLabel.icon}</Text>
                <View style={styles.phaseHeaderText}>
                  <Text style={styles.phaseName}>Phase {phaseId}: {phaseLabel.name}</Text>
                  {/* Collapsed completed: inline summary */}
                  {isCompleted && isCollapsed && phaseData && (() => {
                    // Phase-specific collapsed summary
                    const dur = phaseData.elapsed_seconds || phaseData.duration_seconds;
                    const iters = phaseData.iterations || phaseData.iteration;
                    const sims  = phaseData.simulations;
                    if (phaseId === 1) {
                      let fRes = (resolveMetricValue(phaseData.current_f_res_discrete) ?? resolveMetricValue(phaseData.current_f_res)) ?? resolveMetricValue(phaseData.final_metric);
                      const _hist1 = phaseData.history || [];
                      const _cv1 = [..._hist1].reverse().find(r => r && r.status === 'converged');
                      if (_cv1) { const _v = resolveMetricValue(_cv1.f_res_discrete) ?? resolveMetricValue(_cv1.f_res); if (_v != null) fRes = _v; }
                      return (
                        <Text style={styles.completedInline}>
                          f_res: {fRes != null ? `${fRes.toFixed(4)} GHz` : '—'}
                          {iters ? ` · ${iters} iters` : ''}
                          {dur ? ` · ${formatElapsed(dur)}` : ''}
                        </Text>
                      );
                    }
                    if (phaseId === 2) {
                      const vswr = resolveMetricValue(phaseData.current_VSWR) ?? resolveMetricValue(phaseData.final_metric);
                      return (
                        <Text style={styles.completedInline}>
                          VSWR: {vswr != null ? vswr.toFixed(2) : '—'}
                          {sims ? ` · ${sims} sims` : ''}
                          {dur ? ` · ${formatElapsed(dur)}` : ''}
                        </Text>
                      );
                    }
                    if (phaseId === 3) {
                      const rawAR = phaseData.current_AR;
                      const ar575 = typeof rawAR === 'object' && !Array.isArray(rawAR)
                        ? rawAR?.x1_575 : Array.isArray(rawAR) ? rawAR[1] : rawAR;
                      return (
                        <Text style={styles.completedInline}>
                          AR@1.575: {ar575 != null ? `${ar575.toFixed(1)} dB` : '—'}
                          {iters ? ` · ${iters} iters` : ''}
                          {dur ? ` · ${formatElapsed(dur)}` : ''}
                        </Text>
                      );
                    }
                    const finalVal = phaseData.final_metric ?? resolveMetricValue(phaseData?.[metricConf?.primary]);
                    return (
                      <Text style={styles.completedInline}>
                        {metricConf?.label}: {formatMetricValue(finalVal, metricConf)}
                        {iters ? ` · ${iters} iters` : ''}
                        {dur ? ` · ${formatElapsed(dur)}` : ''}
                      </Text>
                    );
                  })()}
                  {/* Non-completed: show target */}
                  {!isCompleted && <Text style={styles.phaseTarget}>Target: {phaseLabel.target}</Text>}
                  {/* Expanded completed: show target */}
                  {isCompleted && !isCollapsed && <Text style={styles.phaseTarget}>Target: {phaseLabel.target}</Text>}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: statusConf.bgColor }]}>
                  <Text style={[styles.statusBadgeText, { color: statusConf.color }]}>
                    {statusConf.label}
                  </Text>
                </View>
                {isCompleted && (
                  <Text style={styles.expandToggle}>{isCollapsed ? '\u25BC' : '\u25B2'}</Text>
                )}
              </TouchableOpacity>

              {/* ─── RUNNING PHASE ─── */}
              {isCurrentPhase && (
                <View style={styles.phaseDetails}>
                  {phaseId === 1 && renderPhase1Detail(phaseData, phaseLabel, isExpanded)}
                  {phaseId === 2 && renderPhase2Detail(phaseData, phaseLabel, isExpanded)}
                  {phaseId === 3 && renderPhase3Detail(phaseData, phaseLabel, isExpanded)}
                </View>
              )}

              {/* ─── COMPLETED PHASE (expandable) ─── */}
              {isCompleted && !isCollapsed && (
                <View style={styles.phaseDetails}>
                  {/* Completed metrics row */}
                  <View style={styles.completedMetrics}>
                    {phaseId === 1 && (() => {
                      let fRes = (resolveMetricValue(phaseData?.current_f_res_discrete) ?? resolveMetricValue(phaseData?.current_f_res)) ?? resolveMetricValue(phaseData?.final_metric);
                      const _hist1x = (phaseData?.history || []);
                      const _cv1x = [..._hist1x].reverse().find(r => r && r.status === 'converged');
                      if (_cv1x) { const _vx = resolveMetricValue(_cv1x.f_res_discrete) ?? resolveMetricValue(_cv1x.f_res); if (_vx != null) fRes = _vx; }
                      return fRes != null ? (
                        <View style={styles.metric}>
                          <Text style={styles.metricLabel}>f_res</Text>
                          <Text style={[styles.metricValue, { color: getMetricColor(1, fRes) }]}>
                            {fRes.toFixed(4)} GHz
                          </Text>
                        </View>
                      ) : null;
                    })()}
                    {phaseId === 2 && (() => {
                      const vswr = resolveMetricValue(phaseData?.current_VSWR) ?? resolveMetricValue(phaseData?.final_metric);
                      return vswr != null ? (
                        <View style={styles.metric}>
                          <Text style={styles.metricLabel}>VSWR</Text>
                          <Text style={[styles.metricValue, { color: getVSWRColor(vswr) }]}>{vswr.toFixed(2)}</Text>
                        </View>
                      ) : null;
                    })()}
                    {phaseId === 3 && (() => {
                      const rawAR   = phaseData?.current_AR;
                      const ar575   = typeof rawAR === 'object' && !Array.isArray(rawAR) ? rawAR?.x1_575 : Array.isArray(rawAR) ? rawAR[1] : rawAR;
                      const worstAR = resolveMetricValue(phaseData?.worst_AR);
                      return (
                        <>
                          {ar575 != null && (
                            <View style={styles.metric}>
                              <Text style={styles.metricLabel}>AR@1.575</Text>
                              <Text style={[styles.metricValue, { color: getARColor(ar575) }]}>{ar575.toFixed(1)} dB</Text>
                            </View>
                          )}
                          {worstAR != null && (
                            <View style={styles.metric}>
                              <Text style={styles.metricLabel}>Worst AR</Text>
                              <Text style={[styles.metricValue, { color: getARColor(worstAR) }]}>{worstAR.toFixed(1)} dB</Text>
                            </View>
                          )}
                        </>
                      );
                    })()}
                    {(phaseData?.iterations || phaseData?.iteration) ? (
                      <View style={styles.metric}>
                        <Text style={styles.metricLabel}>{phaseId === 2 ? 'Simulations' : 'Iterations'}</Text>
                        <Text style={styles.metricValue}>{phaseData.iterations || phaseData.iteration}</Text>
                      </View>
                    ) : null}
                    {phaseData?.simulations && phaseId === 2 ? (
                      <View style={styles.metric}>
                        <Text style={styles.metricLabel}>Simulations</Text>
                        <Text style={styles.metricValue}>{phaseData.simulations}</Text>
                      </View>
                    ) : null}
                    {(phaseData?.elapsed_seconds || phaseData?.duration_seconds) ? (
                      <View style={styles.metric}>
                        <Text style={styles.metricLabel}>Duration</Text>
                        <Text style={styles.metricValue}>{formatElapsed(phaseData.elapsed_seconds || phaseData.duration_seconds)}</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Tuned variable changes */}
                  {phaseData?.tuned_variables && (
                    <View style={styles.completedVarChanges}>
                      {Object.entries(phaseData.tuned_variables).map(([k, v]) => {
                        const unit = phaseId === 3 ? '°' : ' mm';
                        return (
                          <View key={k} style={styles.completedVarRow}>
                            <Text style={styles.completedVarName}>{k}</Text>
                            <Text style={styles.completedVarChange}>
                              {v?.start != null ? `${formatVarValue(v.start)}${unit} → ` : ''}{formatVarValue(v?.current)}{unit}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Iteration/simulation history — use phase renderers */}
                  {phaseData?.history && phaseData.history.length > 0 && (
                    <View>
                      <TouchableOpacity onPress={() => toggleHistory(phaseId)} style={styles.historyToggle}>
                        <Text style={styles.historyToggleText}>
                          {isExpanded ? '▲ Hide history' : `▼ Show history (${phaseData.history.length})`}
                        </Text>
                      </TouchableOpacity>
                      {isExpanded && phaseId === 1 && (() => {
                        const history = phaseData.history;
                        return (
                          <View style={styles.historyTable}>
                            <View style={styles.historyHeaderRow}>
                              <Text style={[styles.historyCell, styles.historyHeader, { flex: 0.6 }]}>Iter</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>brown</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>ngreen</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>f_res</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>err MHz</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>Status</Text>
                            </View>
                            {[...history].reverse().map((row, idx) => {
                              const badge = row.status === 'converged' ? '✅' : row.status === 'below' ? '🔵' : '🔴';
                              return (
                                <View key={idx} style={styles.historyDataRow}>
                                  <Text style={[styles.historyCell, { flex: 0.6 }]}>{row.iter ?? (history.length - idx)}</Text>
                                  <Text style={styles.historyCell}>{row.brown != null ? row.brown.toFixed(3) : '—'}</Text>
                                  <Text style={styles.historyCell}>{row.ngreen != null ? row.ngreen.toFixed(3) : '—'}</Text>
                                  <Text style={styles.historyCell}>{(row.f_res_discrete ?? row.f_res) != null ? (row.f_res_discrete ?? row.f_res).toFixed(4) : '—'}</Text>
                                  <Text style={styles.historyCell}>{row.error_MHz != null ? `${row.error_MHz > 0 ? '+' : ''}${row.error_MHz.toFixed(1)}` : '—'}</Text>
                                  <Text style={styles.historyCell}>{badge}</Text>
                                </View>
                              );
                            })}
                          </View>
                        );
                      })()}
                      {isExpanded && phaseId === 2 && (() => {
                        const history = phaseData.history;
                        return (
                          <View style={styles.historyTable}>
                            <View style={styles.historyHeaderRow}>
                              <Text style={[styles.historyCell, styles.historyHeader, { flex: 0.5 }]}>Sim</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>Step</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>probex</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>purple</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>VSWR</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>S11</Text>
                            </View>
                            {[...history].reverse().map((row, idx) => (
                              <View key={idx} style={styles.historyDataRow}>
                                <Text style={[styles.historyCell, { flex: 0.5 }]}>{row.sim ?? '—'}</Text>
                                <Text style={styles.historyCell}>{row.step ?? '—'}</Text>
                                <Text style={styles.historyCell}>{row.probex != null ? row.probex.toFixed(2) : '—'}</Text>
                                <Text style={styles.historyCell}>{row.purple != null ? row.purple.toFixed(2) : '—'}</Text>
                                <Text style={[styles.historyCell, row.VSWR != null && { color: getVSWRColor(row.VSWR), fontWeight: '700' }]}>
                                  {row.VSWR != null ? row.VSWR.toFixed(2) : '—'}
                                </Text>
                                <Text style={styles.historyCell}>{row.S11 != null ? row.S11.toFixed(1) : '—'}</Text>
                              </View>
                            ))}
                          </View>
                        );
                      })()}
                      {isExpanded && phaseId === 3 && (() => {
                        const history = phaseData.history;
                        return (
                          <View style={styles.historyTable}>
                            <View style={styles.historyHeaderRow}>
                              <Text style={[styles.historyCell, styles.historyHeader, { flex: 0.5 }]}>#</Text>
                              <Text style={[styles.historyCell, styles.historyHeader, { flex: 0.8 }]}>Step</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>orange°</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>orange2°</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>AR@1.575</Text>
                              <Text style={[styles.historyCell, styles.historyHeader]}>f_res</Text>
                            </View>
                            {[...history].reverse().map((row, idx) => {
                              const isDrift = !!(row.drift ?? row.drift_corrected);
                              const stepLabel = (() => {
                                const s = row.step || '';
                                if (s === 'init') return 'Init';
                                if (s.includes('freq_corr')) return '△f';
                                if (s === 'orange') return 'Og↑';
                                if (s === 'orange2') return 'Og2';
                                if (s.startsWith('preshrink')) return 'Shrink';
                                return s || '—';
                              })();
                              return (
                                <View key={idx} style={[styles.historyDataRow,
                                  isDrift && { backgroundColor: '#fffbeb' },
                                ]}>
                                  <Text style={[styles.historyCell, { flex: 0.5 }]}>{row.iter ?? (history.length - idx)}</Text>
                                  <Text style={[styles.historyCell, { flex: 0.8, fontSize: 10, color: isDrift ? '#f59e0b' : '#64748b' }]}>{isDrift ? `⚠ ${stepLabel}` : stepLabel}</Text>
                                  <Text style={styles.historyCell}>{row.orange != null ? row.orange.toFixed(1) : '—'}</Text>
                                  <Text style={styles.historyCell}>{row.orange2 != null ? row.orange2.toFixed(1) : '—'}</Text>
                                  <Text style={[styles.historyCell, row.AR_1575 != null && { color: getARColor(row.AR_1575), fontWeight: '700' }]}>
                                    {row.AR_1575 != null ? row.AR_1575.toFixed(1) : '—'}
                                  </Text>
                                  <Text style={styles.historyCell}>{row.f_res != null ? row.f_res.toFixed(4) : '—'}</Text>
                                </View>
                              );
                            })}
                          </View>
                        );
                      })()}
                    </View>
                  )}
                </View>
              )}

              {/* ─── INVALID PHASE (invalid_initial) ─── */}
              {isInvalid && (
                <View style={styles.invalidPhaseContent}>
                  <View style={styles.invalidMessageBox}>
                    <Text style={styles.invalidIcon}>⚠️</Text>
                    <Text style={styles.invalidMessageText}>
                      {statusMessage || 'Invalid initial result — no CP loop detected.'}
                    </Text>
                  </View>
                  {invalidDetails && (
                    <View style={styles.invalidDetailsBox}>
                      {invalidDetails.AR_min != null && (
                        <View style={styles.invalidMetricRow}>
                          <Text style={styles.invalidMetricLabel}>AR minimum</Text>
                          <Text style={styles.invalidMetricValue}>{invalidDetails.AR_min.toFixed(1)} dB</Text>
                        </View>
                      )}
                      {invalidDetails.reason && (
                        <View style={styles.invalidMetricRow}>
                          <Text style={styles.invalidMetricLabel}>Reason</Text>
                          <Text style={styles.invalidMetricValue}>
                            {invalidDetails.reason === 'no_cp_loop' ? 'No CP loop at any frequency' : invalidDetails.reason}
                          </Text>
                        </View>
                      )}
                      {invalidDetails.suggestion && (
                        <Text style={styles.invalidSuggestion}>
                          💡 {invalidDetails.suggestion}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              )}

              {/* ─── PENDING PHASE ─── */}
              {isPending && !isInvalidInitial && (
                <View style={styles.pendingMessage}>
                  <Text style={styles.pendingVars}>Variables: {tunedVarNames.join(', ')}</Text>
                  <Text style={styles.pendingText}>
                    {phaseId === 1 ? 'Waiting to start...' : `Waiting for Phase ${phaseId - 1} to complete...`}
                  </Text>
                </View>
              )}
              {/* When invalid_initial, pending phases show muted message */}
              {isPending && isInvalidInitial && (
                <View style={styles.pendingMessage}>
                  <Text style={styles.pendingVars}>Variables: {tunedVarNames.join(', ')}</Text>
                  <Text style={styles.pendingText}>Blocked — resolve Phase 1 issue first</Text>
                </View>
              )}
            </View>
          );
        })}

        {/* Control Buttons — Invalid Initial: show Adjust & Retry */}
        {isInvalidInitial && (
          <View style={styles.controlRow}>
            <TouchableOpacity
              style={[styles.controlButton, { backgroundColor: '#6b7280' }]}
              onPress={onBack}
            >
              <Text style={styles.controlButtonText}>← Back</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.controlButton, styles.adjustRetryButton]}
              onPress={() => {
                // Pre-fill slider values from invalid_details
                const vars = invalidDetails?.variables_to_adjust || {};
                const initial = {};
                Object.entries(vars).forEach(([key, data]) => {
                  initial[key] = {
                    value: data.current ?? data.value ?? 0,
                    min: data.range?.[0] ?? 0,
                    max: data.range?.[1] ?? 100,
                  };
                });
                // If no variables provided, use defaults for orange/orange2
                if (Object.keys(initial).length === 0) {
                  initial.orange  = { value: 30, min: 10, max: 90 };
                  initial.orange2 = { value: 66, min: 10, max: 90 };
                }
                setAdjustValues(initial);
                setShowAdjustModal(true);
              }}
            >
              <Text style={styles.controlButtonText}>🔧 Adjust & Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Control Buttons — Normal running */}
        {!isFinished && !isInvalidInitial && (
          <View style={styles.controlRow}>
            {/* Running indicator (disabled, grey) */}
            <View style={[styles.controlButton, styles.runningButton]}>
              <Text style={styles.runningButtonText}>🔄 Running</Text>
            </View>

            {/* Stop button - terminates all MATLAB & HFSS */}
            <TouchableOpacity
              style={[styles.controlButton, styles.stopButton, isStopping && styles.stopButtonDisabled]}
              disabled={isStopping}
              onPress={() => {
                showAlert(
                  'Stop Tuning',
                  'This will terminate all MATLAB and HFSS processes. Current progress will be lost.',
                  [
                    { text: 'No', style: 'cancel' },
                    { text: 'Yes, Stop', onPress: handleStop, style: 'destructive' },
                  ]
                );
              }}
            >
              <Text style={styles.controlButtonText}>
                {isStopping ? '⏳ Stopping...' : '⛔ Stop'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Finished banner */}
        {isFinished && (
          <View style={[styles.finishedBanner,
            managerStatus === 'completed' ? styles.finishedSuccess :
            managerStatus === 'cancelled' ? styles.finishedCancelled :
            styles.finishedError
          ]}>
            <Text style={styles.finishedText}>
              {managerStatus === 'completed' ? '✅ Progressive tuning complete! Loading results...' :
               managerStatus === 'cancelled' ? '🚫 Tuning was cancelled' :
               '⚠️ Tuning ended with errors. Loading results...'}
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ─── Adjust & Retry Modal ─── */}
      <Modal
        visible={showAdjustModal}
        transparent
        animationType="fade"
        onRequestClose={() => !isRetrying && setShowAdjustModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.adjustModal}>
            <Text style={styles.adjustModalTitle}>🔧 Adjust Variables & Retry</Text>

            {invalidDetails?.suggestion && (
              <View style={styles.adjustSuggestionBox}>
                <Text style={styles.adjustSuggestionText}>💡 {invalidDetails.suggestion}</Text>
              </View>
            )}

            {invalidDetails?.AR_min != null && (
              <Text style={styles.adjustArInfo}>
                Current AR minimum: <Text style={{ fontWeight: '700', color: '#ef4444' }}>{invalidDetails.AR_min.toFixed(1)} dB</Text>
                {' '}(needs {'<'} 15 dB for CP loop)
              </Text>
            )}

            <View style={styles.adjustSlidersContainer}>
              {Object.entries(adjustValues).map(([varName, data]) => (
                <View key={varName} style={styles.adjustSliderRow}>
                  <View style={styles.adjustSliderHeader}>
                    <Text style={styles.adjustSliderLabel}>{varName}</Text>
                    <View style={styles.adjustSliderValueBox}>
                      <TextInput
                        style={styles.adjustSliderInput}
                        value={String(data.value)}
                        keyboardType="numeric"
                        onChangeText={(text) => {
                          const num = parseFloat(text);
                          if (!isNaN(num)) {
                            setAdjustValues(prev => ({
                              ...prev,
                              [varName]: { ...prev[varName], value: Math.max(data.min, Math.min(data.max, num)) },
                            }));
                          }
                        }}
                      />
                    </View>
                  </View>
                  {/* Slider track */}
                  <View style={styles.adjustSliderTrack}>
                    <View
                      style={[styles.adjustSliderFill, {
                        width: `${((data.value - data.min) / (data.max - data.min)) * 100}%`,
                      }]}
                    />
                    {/* Draggable thumb area — use touch on the full track */}
                    <TouchableOpacity
                      style={[styles.adjustSliderThumb, {
                        left: `${((data.value - data.min) / (data.max - data.min)) * 100}%`,
                      }]}
                      activeOpacity={1}
                    />
                  </View>
                  {/* Clickable slider track for web — handles onMouseDown position */}
                  {Platform.OS === 'web' && (
                    <View
                      style={styles.adjustSliderClickArea}
                      onMouseDown={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const fraction = (e.clientX - rect.left) / rect.width;
                        const newVal = data.min + fraction * (data.max - data.min);
                        setAdjustValues(prev => ({
                          ...prev,
                          [varName]: { ...prev[varName], value: Math.round(Math.max(data.min, Math.min(data.max, newVal)) * 10) / 10 },
                        }));
                      }}
                    />
                  )}
                  <View style={styles.adjustSliderLabels}>
                    <Text style={styles.adjustSliderRangeLabel}>{data.min}</Text>
                    <Text style={styles.adjustSliderRangeLabel}>{data.max}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.adjustModalButtons}>
              <TouchableOpacity
                style={[styles.adjustModalBtn, styles.adjustModalCancelBtn]}
                onPress={() => setShowAdjustModal(false)}
                disabled={isRetrying}
              >
                <Text style={styles.adjustModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.adjustModalBtn, styles.adjustModalConfirmBtn, isRetrying && { opacity: 0.6 }]}
                onPress={() => handleAdjustRetry(adjustValues)}
                disabled={isRetrying}
              >
                {isRetrying ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.adjustModalConfirmText}>▶ Start with New Values</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#64748b',
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

  // Overall Progress Card
  overallCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  // Phase stepper
  phaseStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  stepperItem: {
    alignItems: 'center',
    width: 72,
  },
  stepperDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepperDotActive: {
    backgroundColor: '#7c3aed',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  stepperDotDone: {
    backgroundColor: '#10b981',
  },
  stepperDotText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  stepperLabel: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
    textAlign: 'center',
  },
  stepperLabelActive: {
    color: '#7c3aed',
  },
  stepperLabelDone: {
    color: '#10b981',
  },
  stepperLine: {
    height: 2,
    flex: 1,
    backgroundColor: '#e2e8f0',
    marginBottom: 18,
    marginHorizontal: -4,
  },
  stepperLineDone: {
    backgroundColor: '#10b981',
  },
  overallLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 12,
  },
  progressBarOuter: {
    height: 12,
    backgroundColor: '#e2e8f0',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressBarInner: {
    height: '100%',
    borderRadius: 6,
  },
  overallStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  overallPercent: {
    fontSize: 18,
    fontWeight: '700',
    color: '#7c3aed',
  },
  overallDetail: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 3,
  },
  pausedBanner: {
    marginTop: 10,
    backgroundColor: '#fffbeb',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  pausedBannerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f59e0b',
  },

  // MATLAB alive/dead banners
  matlabAliveBanner: {
    marginTop: 10,
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  matlabAliveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matlabAliveText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#16a34a',
  },
  matlabAliveHint: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
    fontStyle: 'italic',
  },
  matlabDeadBanner: {
    marginTop: 10,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  matlabDeadText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#d97706',
  },
  matlabDeadHint: {
    fontSize: 12,
    color: '#92400e',
    marginTop: 4,
    textAlign: 'center',
  },

  // MATLAB Crash Banner
  crashBanner: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  crashTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#dc2626',
    marginBottom: 8,
  },
  crashMessage: {
    fontSize: 14,
    color: '#991b1b',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  crashHint: {
    fontSize: 12,
    color: '#92400e',
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  crashBackButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  crashBackButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  // Error Banner
  errorBanner: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorBannerText: {
    fontSize: 13,
    color: '#dc2626',
    flex: 1,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3b82f6',
    marginLeft: 12,
  },

  // Phase Cards
  phaseCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  phaseIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  phaseHeaderText: {
    flex: 1,
  },
  phaseName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
  },
  phaseTarget: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Phase Details
  phaseDetails: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  metric: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 80,
  },
  metricLabel: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
    marginTop: 2,
  },

  // Expand toggle for completed phases
  expandToggle: {
    fontSize: 12,
    color: '#94a3b8',
    marginLeft: 8,
    paddingHorizontal: 4,
  },

  // Completed inline summary (shown when collapsed)
  completedInline: {
    fontSize: 12,
    color: '#10b981',
    fontWeight: '600',
    marginTop: 2,
  },

  // Status message
  statusMessageRow: {
    marginTop: 10,
    marginBottom: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#7c3aed',
  },
  statusMessageText: {
    fontSize: 13,
    fontWeight: '600',
    fontStyle: 'italic',
  },

  // Tuned Variables Section
  tunedVarsSection: {
    marginTop: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  tunedVarCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  tunedVarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tunedVarName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  tunedVarValues: {
    fontSize: 13,
    color: '#64748b',
  },
  tunedVarCurrent: {
    fontWeight: '700',
    color: '#7c3aed',
  },

  // Search Range Bar
  searchRange: {
    marginTop: 8,
  },
  searchRangeBar: {
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    position: 'relative',
  },
  searchRangeMarker: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    top: -2,
    marginLeft: -6,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  searchRangeStart: {
    backgroundColor: '#94a3b8',
    zIndex: 1,
  },
  searchRangeCurrent: {
    backgroundColor: '#7c3aed',
    zIndex: 2,
  },
  searchRangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  searchRangeLabel: {
    fontSize: 10,
    color: '#94a3b8',
  },

  // Primary Metric (prominent)
  primaryMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
  },
  primaryMetricMain: {
    flex: 1,
  },
  primaryMetricLabel: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  primaryMetricValue: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
  },
  primaryMetricDelta: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  secondaryMetric: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 70,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },

  // Phase 2: Step A/B Indicator
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  stepBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 2,
  },
  stepBadgeActive: {
    backgroundColor: '#f59e0b',
    borderColor: '#f59e0b',
  },
  stepBadgeInactive: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  stepBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
  },
  stepBadgeTextActive: {
    color: '#ffffff',
  },
  stepArrowText: {
    fontSize: 16,
    color: '#94a3b8',
    fontWeight: '700',
  },

  // Phase 2: Smith Data
  smithData: {
    marginTop: 12,
  },
  smithValues: {
    flexDirection: 'row',
    gap: 12,
  },

  // Phase 3: AR at Frequencies
  arFrequencies: {
    marginTop: 12,
  },
  arFreqRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  arFreqItem: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  arFreqLabel: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },
  arFreqValue: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 4,
  },
  worstARRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  worstARLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  worstARValue: {
    fontSize: 15,
    fontWeight: '800',
  },

  // Phase 3: Drift Warning
  driftWarning: {
    marginTop: 10,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 8,
    padding: 10,
  },
  driftWarningText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#d97706',
    textAlign: 'center',
  },

  // Fixed Variables (collapsible)
  fixedVarsSection: {
    marginTop: 12,
  },
  fixedVarsToggle: {
    paddingVertical: 6,
  },
  fixedVarsToggleText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  fixedVarsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  fixedVarItem: {
    flexDirection: 'row',
    gap: 4,
    minWidth: '40%',
  },
  fixedVarName: {
    fontSize: 12,
    color: '#94a3b8',
  },
  fixedVarValue: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },

  // Phase progress
  phaseProgress: {
    marginTop: 12,
  },
  phaseProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  phaseProgressLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  phaseProgressPercent: {
    fontSize: 12,
    color: '#7c3aed',
    fontWeight: '700',
  },
  phaseProgressBarOuter: {
    height: 6,
    backgroundColor: '#e2e8f0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  phaseProgressBarInner: {
    height: '100%',
    borderRadius: 3,
  },

  // Completed phase expanded
  completedMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  completedVarChanges: {
    marginTop: 10,
  },
  completedVarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  completedVarName: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  completedVarChange: {
    fontSize: 13,
    color: '#10b981',
    fontWeight: '700',
  },

  // Running history section
  runningHistorySection: {
    marginTop: 12,
  },

  // History (shared)
  historyToggle: {
    marginTop: 10,
    paddingVertical: 6,
  },
  historyToggleText: {
    fontSize: 13,
    color: '#3b82f6',
    fontWeight: '600',
  },
  historyTable: {
    marginTop: 8,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  historyHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
  },
  historyDataRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  historyCell: {
    flex: 1,
    fontSize: 11,
    color: '#475569',
    paddingVertical: 6,
    paddingHorizontal: 6,
    textAlign: 'center',
  },
  historyHeader: {
    fontWeight: '700',
    color: '#1e293b',
    fontSize: 11,
  },
  historyMoreText: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 6,
    fontStyle: 'italic',
  },

  // Pending
  pendingMessage: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  pendingVars: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
    marginBottom: 4,
  },
  pendingText: {
    fontSize: 13,
    color: '#94a3b8',
    fontStyle: 'italic',
  },

  // Initializing
  initializingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    paddingBottom: 8,
  },
  initializingText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Control buttons
  controlRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  controlButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  runningButton: {
    backgroundColor: '#d1d5db',
    opacity: 0.7,
  },
  runningButtonText: {
    color: '#6b7280',
    fontSize: 15,
    fontWeight: '700',
  },
  stopButton: {
    backgroundColor: '#ef4444',
  },
  stopButtonDisabled: {
    backgroundColor: '#9ca3af',
    opacity: 0.7,
  },
  controlButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },

  // Finished banners
  finishedBanner: {
    borderRadius: 12,
    padding: 16,
    marginTop: 4,
    alignItems: 'center',
  },
  finishedSuccess: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  finishedCancelled: {
    backgroundColor: '#fef9c3',
    borderWidth: 1,
    borderColor: '#fde047',
  },
  finishedError: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  finishedText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
    textAlign: 'center',
  },

  // ─── Invalid Phase Styles ───
  invalidPhaseContent: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  invalidMessageBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
    gap: 8,
  },
  invalidIcon: {
    fontSize: 20,
    marginTop: 1,
  },
  invalidMessageText: {
    flex: 1,
    fontSize: 13,
    color: '#991b1b',
    lineHeight: 19,
    fontWeight: '500',
  },
  invalidDetailsBox: {
    marginTop: 10,
    backgroundColor: '#fff7ed',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  invalidMetricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  invalidMetricLabel: {
    fontSize: 13,
    color: '#78350f',
    fontWeight: '500',
  },
  invalidMetricValue: {
    fontSize: 13,
    color: '#c2410c',
    fontWeight: '700',
  },
  invalidSuggestion: {
    marginTop: 8,
    fontSize: 12,
    color: '#92400e',
    fontStyle: 'italic',
    lineHeight: 18,
  },

  // ─── Adjust & Retry Button ───
  adjustRetryButton: {
    backgroundColor: '#f59e0b',
  },

  // ─── Adjust & Retry Modal ───
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  adjustModal: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 480,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 10,
  },
  adjustModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 12,
    textAlign: 'center',
  },
  adjustSuggestionBox: {
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  adjustSuggestionText: {
    fontSize: 13,
    color: '#1e40af',
    lineHeight: 18,
  },
  adjustArInfo: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 16,
    textAlign: 'center',
  },
  adjustSlidersContainer: {
    gap: 18,
    marginBottom: 20,
  },
  adjustSliderRow: {
    position: 'relative',
  },
  adjustSliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  adjustSliderLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
  },
  adjustSliderValueBox: {
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 60,
    alignItems: 'center',
  },
  adjustSliderInput: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
    textAlign: 'center',
    minWidth: 50,
    ...(Platform.OS === 'web' && { outlineStyle: 'none' }),
  },
  adjustSliderTrack: {
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    position: 'relative',
    overflow: 'visible',
  },
  adjustSliderFill: {
    height: '100%',
    backgroundColor: '#f59e0b',
    borderRadius: 4,
  },
  adjustSliderThumb: {
    position: 'absolute',
    top: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#f59e0b',
    borderWidth: 3,
    borderColor: '#ffffff',
    marginLeft: -10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  adjustSliderClickArea: {
    position: 'absolute',
    top: -10,
    left: 0,
    right: 0,
    height: 28,
    ...(Platform.OS === 'web' && { cursor: 'pointer' }),
  },
  adjustSliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  adjustSliderRangeLabel: {
    fontSize: 11,
    color: '#94a3b8',
  },
  adjustModalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  adjustModalBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  adjustModalCancelBtn: {
    backgroundColor: '#f1f5f9',
  },
  adjustModalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
  },
  adjustModalConfirmBtn: {
    backgroundColor: '#f59e0b',
  },
  adjustModalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },

  // ─── Phase 1: Frequency convergence ───
  p1FreqSection: {
    marginTop: 12,
  },
  p1FreqBar: {
    height: 10,
    backgroundColor: '#e2e8f0',
    borderRadius: 5,
    position: 'relative',
    marginVertical: 8,
    overflow: 'visible',
  },
  p1TargetLine: {
    position: 'absolute',
    width: 2,
    height: 20,
    top: -5,
    backgroundColor: '#10b981',
    zIndex: 2,
  },
  p1FreqDot: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    top: -4,
    marginLeft: -9,
    zIndex: 3,
    borderWidth: 2,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  p1FreqDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  p1FreqBarLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  p1FreqBarLabel: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },
  p1MetricRow: {
    marginTop: 4,
  },
  p1VarCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    gap: 12,
  },
  p1VarRow: {
    gap: 4,
  },
  p1VarLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  // ─── Phase 2: 6-step strip ───
  p2StepStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 12,
    marginBottom: 4,
  },
  p2StepBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    minWidth: 50,
  },
  p2StepIcon: {
    fontSize: 12,
    lineHeight: 16,
  },
  p2StepLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 1,
  },
  p2StepArrow: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '700',
  },

  // ─── Phase 2: Smith chart ───
  p2SmithContainer: {
    marginTop: 14,
  },
  p2SmithChart: {
    alignItems: 'center',
    marginTop: 6,
  },
  p2SmithLegend: {
    marginTop: 8,
  },
  p2SmithLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  p2LegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  p2LegendText: {
    fontSize: 11,
    color: '#64748b',
  },

  // ─── Phase 2: Variable cards ───
  p2VarCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
  },
  p2VarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  p2VswrBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  p2VswrBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  p2NumberLine: {
    marginBottom: 6,
  },
  p2NumberLineLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  p2ZRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  p2ZText: {
    fontSize: 11,
    color: '#64748b',
  },

  // ─── Phase 2: Results summary table ───
  p2ResultsTable: {
    marginTop: 14,
  },

  // ─── Phase 3: AR section ───
  p3ARSection: {
    marginTop: 12,
  },
  arFreqItemPrimary: {
    flex: 1.4,
    borderWidth: 1.5,
    borderColor: '#10b981',
  },
  p3GaugeRow: {
    marginTop: 10,
    gap: 4,
  },
  p3GaugeBar: {
    height: 12,
    flexDirection: 'row',
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
    marginTop: 4,
  },
  p3GaugeZone: {
    height: '100%',
  },
  p3GaugeNeedle: {
    position: 'absolute',
    top: -2,
    width: 3,
    height: 16,
    backgroundColor: '#1e293b',
    borderRadius: 2,
    marginLeft: -1.5,
  },
  p3GaugeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  p3GaugeLabel: {
    fontSize: 10,
    color: '#94a3b8',
  },

  // ─── Phase 3: Pre-step guidance panel ───
  p3PreStepPanel: {
    marginBottom: 8,
  },
  p3GuideBox: {
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    padding: 14,
    marginTop: 12,
  },
  p3GuideTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#065f46',
    marginBottom: 6,
  },
  p3GuideText: {
    fontSize: 12,
    color: '#374151',
    lineHeight: 18,
    marginBottom: 10,
  },
  p3GuideStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 8,
  },
  p3GuideStepNum: {
    fontSize: 16,
    lineHeight: 20,
    marginTop: 1,
  },
  p3GuideStepTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 2,
  },
  p3GuideStepOptional: {
    fontSize: 11,
    fontWeight: '400',
    color: '#64748b',
    fontStyle: 'italic',
  },
  p3GuideStepDesc: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 17,
  },
});
