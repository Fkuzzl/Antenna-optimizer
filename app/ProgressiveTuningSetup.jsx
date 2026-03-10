import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Platform, ActivityIndicator, Dimensions
} from "react-native";
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppConfig, { showAlert } from './app_config';
import ProgressiveTuningResults from './ProgressiveTuningResults';

const { width } = Dimensions.get('window');
const ANTENNA_SIZE = 25; // Fixed 25x25mm antenna

/**
 * Fallback variable definitions — used until EP_Config.json is loaded from the server.
 * Units and descriptions are UI-only metadata; values/ranges come from EP_Config.json.
 */
const FALLBACK_VARS = {
  probex: { value: 2.1,   unit: 'mm',  min: 2.0,   max: 4.5,   description: 'Feed probe position' },
  purple: { value: 1.2,   unit: 'mm',  min: 0.5,   max: 2.5,   description: 'Impedance matching strip' },
  ngreen: { value: 0.2,   unit: 'mm',  min: 0.1,   max: 0.4,   description: 'Half-sphere cut size' },
  orange: { value: 30,    unit: 'deg', min: 10,    max: 90,    description: 'L3 arm angle (CP loop)' },
  orange2:{ value: 55,    unit: 'deg', min: 10,    max: 90,    description: 'L4 arm angle (CP loop)' },
  brown:  { value: 1.6,   unit: 'mm',  min: 0.5,   max: 1.7,   description: 'T-strip gap' },
  bluel:  { value: 10.54, unit: 'mm',  min: 10.39, max: 10.60, description: 'Blue-L patch length' },
};

/** Unit/description metadata that cannot be stored in EP_Config.json */
const VAR_META = {
  probex: { unit: 'mm',  description: 'Feed probe position' },
  purple: { unit: 'mm',  description: 'Impedance matching strip' },
  ngreen: { unit: 'mm',  description: 'Half-sphere cut size' },
  orange: { unit: 'deg', description: 'L3 arm angle (CP loop)' },
  orange2:{ unit: 'deg', description: 'L4 arm angle (CP loop)' },
  brown:  { unit: 'mm',  description: 'T-strip gap' },
  bluel:  { unit: 'mm',  description: 'Blue-L patch length' },
};

const PHASES = [
  { id: 1, name: 'Resonant Frequency',  target: '1.575 GHz',  variables: ['brown', 'ngreen', 'bluel'], sims: '5-8' },
  { id: 2, name: 'Impedance Matching',  target: 'VSWR < 1.5', variables: ['probex', 'purple'],         sims: '6-12' },
  { id: 3, name: 'CP Loop Optimization', target: 'AR < 2 dB', variables: ['orange', 'orange2'],        sims: '10-15' },
];

/**
 * Ray-casting point-in-DXF-polygon test using raw edges (no polygon tracing).
 * px, py are in bounding-box mm coords (0..bounds.width, 0..bounds.height).
 * Mapped to raw DXF geo coords via bounds.min_x / min_y offset.
 */
function isPointInsideDxf(px, py, dxfGndData) {
  if (!dxfGndData?.geometry?.vertices?.length || !dxfGndData?.geometry?.edges?.length) return true;
  const { vertices, edges } = dxfGndData.geometry;
  const bounds = dxfGndData.bounds;
  // Canvas mm → raw DXF geo coords
  const geoX = bounds.min_x + px;
  const geoY = bounds.min_y + py;
  if (geoX < bounds.min_x || geoX > bounds.max_x || geoY < bounds.min_y || geoY > bounds.max_y) return false;
  let crossings = 0;
  const epsilon = 1e-9;
  for (const [startIdx, endIdx] of edges) {
    if (startIdx >= vertices.length || endIdx >= vertices.length) continue;
    const v1 = vertices[startIdx], v2 = vertices[endIdx];
    if (!v1 || !v2) continue;
    const x1 = parseFloat(v1[0]), y1 = parseFloat(v1[1]);
    const x2 = parseFloat(v2[0]), y2 = parseFloat(v2[1]);
    if (Math.abs(y1 - y2) < epsilon) continue;
    if ((y1 > geoY) !== (y2 > geoY)) {
      const intersectX = x1 + (x2 - x1) * (geoY - y1) / (y2 - y1);
      if (geoX < intersectX + epsilon) crossings++;
    }
  }
  return (crossings % 2) === 1;
}

/**
 * Check whether the full 25×25mm antenna rectangle lies inside the DXF shape.
 * Tests all 4 corners and the center. ax, ay are in bounding-box mm coords.
 */
function isAntennaInsideDxf(ax, ay, dxfGndData) {
  const half = ANTENNA_SIZE / 2;
  return [
    [ax - half, ay - half], // bottom-left corner
    [ax + half, ay - half], // bottom-right corner
    [ax + half, ay + half], // top-right corner
    [ax - half, ay + half], // top-left corner
    [ax,        ay       ], // center
  ].every(([px, py]) => isPointInsideDxf(px, py, dxfGndData));
}

export default function ProgressiveTuningSetup({ onBack, projectPath, onSetProjectPath, onStart }) {
  // ---- Step 1: Project Location ----
  const [localProjectPath, setLocalProjectPath] = useState(projectPath || '');
  const [projectLocationConfirmed, setProjectLocationConfirmed] = useState(!!projectPath);
  const [pathHistory, setPathHistory] = useState([]);
  const [showPathHistory, setShowPathHistory] = useState(false);
  const [isValidatingLocation, setIsValidatingLocation] = useState(false);
  const [locationValidationMessage, setLocationValidationMessage] = useState('');

  // ---- Step 2: Config ----
  // Antenna name (used as output folder name)
  const [antennaName, setAntennaName] = useState('antenna1');

  // Ground plane mode
  const [gndMode, setGndMode] = useState('parametric'); // 'parametric' | 'dxf'
  const [lgx, setLgx] = useState('100');
  const [lgy, setLgy] = useState('100');
  const [dxfPath, setDxfPath] = useState('');
  const [dxfFileName, setDxfFileName] = useState('');
  const [isUploadingDxf, setIsUploadingDxf] = useState(false);
  const [dxfGndData, setDxfGndData] = useState(null); // Full upload response with bounds/geometry
  const dxfFileInputRef = useRef(null);
  const dxfCanvasRef = useRef(null);

  // Drag-and-drop antenna positioning
  const [antennaX, setAntennaX] = useState(12.5); // GND_xPos in mm (center of antenna)
  const [antennaY, setAntennaY] = useState(12.5); // GND_yPos in mm (center of antenna)
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [initialAntennaPos, setInitialAntennaPos] = useState({ x: 0, y: 0 });
  // DXF polygon boundary check — true when antenna is outside the DXF shape
  const [antennaOutsideDxfShape, setAntennaOutsideDxfShape] = useState(false);
  // Precision fine-tune inputs (DXF mode)
  const [dxfXInput, setDxfXInput] = useState('');
  const [dxfYInput, setDxfYInput] = useState('');

  // Advanced variables
  const [showAdvanced, setShowAdvanced] = useState(false);
  // varDefs: variable definitions loaded from EP_Config.json (falls back to FALLBACK_VARS)
  const [varDefs, setVarDefs] = useState(FALLBACK_VARS);
  const [variables, setVariables] = useState(() => {
    const initial = {};
    for (const [key, def] of Object.entries(FALLBACK_VARS)) {
      initial[key] = String(def.value);
    }
    return initial;
  });

  // Previous runs (for checkpoint/resume)
  const [previousRuns, setPreviousRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  // Inline result viewer state (set to result data to open, null to close)
  const [viewingResult, setViewingResult] = useState(null);

  // Active session guard
  const [activeSessionDetected, setActiveSessionDetected] = useState(false);

  // UI state
  const [isStarting, setIsStarting] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);

  const SERVER_URL = AppConfig.serverUrl;

  // ---- Location Step Functions ----

  // Load path history from storage on mount
  useEffect(() => {
    loadPathHistory();
  }, []);

  const loadPathHistory = async () => {
    try {
      const savedPaths = await AsyncStorage.getItem('tuningPathHistory');
      if (savedPaths) {
        setPathHistory(JSON.parse(savedPaths));
      }
    } catch (error) {
      console.error('Error loading tuning path history:', error);
    }
  };

  const savePathToHistory = async (path) => {
    try {
      const updatedHistory = [path, ...pathHistory.filter(p => p !== path)].slice(0, 10);
      setPathHistory(updatedHistory);
      await AsyncStorage.setItem('tuningPathHistory', JSON.stringify(updatedHistory));
    } catch (error) {
      console.error('Error saving tuning path history:', error);
    }
  };

  const clearPathHistory = async () => {
    try {
      setPathHistory([]);
      await AsyncStorage.removeItem('tuningPathHistory');
      showAlert('Cleared', 'Path history cleared');
    } catch (error) {
      console.error('Error clearing tuning path history:', error);
    }
  };

  const handlePaste = async () => {
    try {
      let clipboardContent = '';
      if (Platform.OS === 'web') {
        if (navigator.clipboard && navigator.clipboard.readText) {
          clipboardContent = await navigator.clipboard.readText();
        } else {
          showAlert('Paste Not Supported', 'Use Ctrl+V to paste');
          return;
        }
      } else {
        // React Native built-in Clipboard (imported from react-native)
        const { Clipboard: RNClipboard } = require('react-native');
        clipboardContent = await RNClipboard.getString();
      }
      if (clipboardContent) {
        setLocalProjectPath(clipboardContent.trim());
      } else {
        showAlert('Clipboard Empty', 'Nothing to paste');
      }
    } catch (error) {
      console.error('Failed to paste from clipboard:', error);
      showAlert('Paste Error', 'Could not read clipboard. Use Ctrl+V to paste.');
    }
  };

  const validateProjectLocation = async () => {
    const trimmed = localProjectPath.trim();
    if (!trimmed) {
      setLocationValidationMessage('❌ Please enter a project folder path');
      return;
    }

    setIsValidatingLocation(true);
    setLocationValidationMessage('Validating project location...');

    try {
      // Check path format: should be a directory path (Windows or Unix)
      const isWindowsPath = /^[A-Za-z]:\\/.test(trimmed);
      const isLinuxPath = trimmed.startsWith('/');

      if (!isWindowsPath && !isLinuxPath) {
        setLocationValidationMessage('❌ Path format not recognized. Please use a full directory path');
        setIsValidatingLocation(false);
        return;
      }

      // Verify via server — check if the path contains expected project structure
      const response = await fetch(`${SERVER_URL}/api/progressive-tuning/runs?projectPath=${encodeURIComponent(trimmed)}`);
      if (response.ok) {
        // Server confirmed path is accessible
        setProjectLocationConfirmed(true);
        setLocationValidationMessage('✅ Project location validated');
        if (onSetProjectPath) onSetProjectPath(trimmed);
        await savePathToHistory(trimmed);
      } else if (response.status === 404) {
        // Path not found on server
        setLocationValidationMessage('❌ Directory not found. Check the path and try again.');
      } else {
        // Server error but path format is OK — accept as new project
        setProjectLocationConfirmed(true);
        setLocationValidationMessage('✅ Project location set (new project)');
        if (onSetProjectPath) onSetProjectPath(trimmed);
        await savePathToHistory(trimmed);
      }
    } catch (error) {
      // Server unreachable — accept with warning
      setProjectLocationConfirmed(true);
      setLocationValidationMessage('⚠️ Server not reachable — path accepted, verify server is running');
      if (onSetProjectPath) onSetProjectPath(trimmed);
      await savePathToHistory(trimmed);
    }

    setIsValidatingLocation(false);
  };

  const resetProjectLocation = () => {
    setProjectLocationConfirmed(false);
    setLocationValidationMessage('');
  };

  // ---- DXF File Picker ----
  const handleDxfFilePick = () => {
    if (Platform.OS === 'web' && dxfFileInputRef.current) {
      dxfFileInputRef.current.value = ''; // Reset so re-selecting same file works
      dxfFileInputRef.current.click();
    }
  };

  const handleDxfFileSelected = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.dxf')) {
      showAlert('Invalid File', 'Please select a .dxf file');
      return;
    }

    setIsUploadingDxf(true);
    setDxfFileName(file.name);

    try {
      const formData = new FormData();
      formData.append('gndFile', file);
      formData.append('projectPath', localProjectPath || projectPath || '');

      const response = await fetch(`${SERVER_URL}/api/gnd/upload`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        if (data.validation && data.validation.errors && data.validation.errors.length > 0) {
          showAlert('Invalid Ground Plane', data.validation.errors.join('\n') + '\n\nThe antenna is 25mm × 25mm and must fit entirely within the ground plane.');
          setDxfFileName('');
          return;
        }
        setDxfPath(data.file?.path || data.filePath || data.validation?.filePath || '');
        setDxfGndData(data);
        // Update dimensions and center antenna on the imported shape
        if (data.bounds) {
          const w = data.bounds.width;
          const h = data.bounds.height;
          setLgx(w.toFixed(1));
          setLgy(h.toFixed(1));
          setAntennaX(w / 2);
          setAntennaY(h / 2);
        }
        showAlert('DXF Uploaded', `File "${file.name}" uploaded successfully.\nSize: ${data.bounds?.width?.toFixed(1)} × ${data.bounds?.height?.toFixed(1)} mm\n\nPosition your antenna on the canvas below.`);
      } else {
        showAlert('Upload Failed', data.message || 'Failed to upload DXF file');
        setDxfFileName('');
      }
    } catch (error) {
      showAlert('Upload Error', `Could not upload file: ${error.message}`);
      setDxfFileName('');
    } finally {
      setIsUploadingDxf(false);
    }
  };

  // Check if a tuning session is already running (guard against concurrent runs)
  useEffect(() => {
    const checkActiveSession = async () => {
      try {
        const response = await fetch(`${SERVER_URL}/api/progressive-tuning/status`);
        const data = await response.json();
        if (data.success && data.data) {
          const managerStatus = data.data.manager?.status || data.data.status;
          if (managerStatus === 'running' || managerStatus === 'paused') {
            setActiveSessionDetected(true);
          }
        }
      } catch (e) { /* ignore */ }
    };
    checkActiveSession();
  }, []);

  // Fetch previous runs + EP_Config when project location is confirmed
  useEffect(() => {
    if (projectLocationConfirmed && (localProjectPath || projectPath)) {
      fetchPreviousRuns();
      fetchEpConfig();
    }
  }, [projectLocationConfirmed, localProjectPath, projectPath]);

  /**
   * Load variable defaults and ranges from EP_Config.json via the server.
   * Merges server values with local VAR_META (units, descriptions).
   * Falls back to FALLBACK_VARS silently if the file doesn't exist.
   */
  const fetchEpConfig = async () => {
    const effectivePath = localProjectPath || projectPath;
    if (!effectivePath) return;
    try {
      const response = await fetch(
        `${SERVER_URL}/api/progressive-tuning/ep-config?projectPath=${encodeURIComponent(effectivePath)}`
      );
      const data = await response.json();
      if (data.success && data.data) {
        const { default_values, variable_ranges } = data.data;
        const merged = {};
        // Build varDefs by combining server values/ranges with local metadata
        for (const key of Object.keys(FALLBACK_VARS)) {
          merged[key] = {
            ...(VAR_META[key] || {}),
            value: (default_values && default_values[key] !== undefined)
              ? default_values[key]
              : FALLBACK_VARS[key].value,
            min: (variable_ranges && variable_ranges[key])
              ? variable_ranges[key][0]
              : FALLBACK_VARS[key].min,
            max: (variable_ranges && variable_ranges[key])
              ? variable_ranges[key][1]
              : FALLBACK_VARS[key].max,
          };
        }
        setVarDefs(merged);
        // Reset variables inputs to newly loaded defaults
        const newVars = {};
        for (const [key, def] of Object.entries(merged)) {
          newVars[key] = String(def.value);
        }
        setVariables(newVars);
      }
    } catch (err) {
      // Silently fall back to FALLBACK_VARS
      console.log('Could not load EP_Config.json — using fallback defaults:', err.message);
    }
  };

  const fetchPreviousRuns = async () => {
    setLoadingRuns(true);
    const effectivePath = localProjectPath || projectPath;
    try {
      const response = await fetch(
        `${SERVER_URL}/api/progressive-tuning/runs?projectPath=${encodeURIComponent(effectivePath)}`
      );
      const data = await response.json();
      if (data.success && data.data) {
        setPreviousRuns(data.data);
      }
    } catch (err) {
      // Silently fail - runs list is optional
      console.log('Could not fetch previous runs:', err.message);
    } finally {
      setLoadingRuns(false);
    }
  };

  /**
   * Resume an incomplete run — only needs project name, MATLAB has the checkpoint
   */
  const handleResume = async (run) => {
    setIsStarting(true);
    try {
      const response = await fetch(`${SERVER_URL}/api/progressive-tuning/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: localProjectPath || projectPath,
          mode: 'resume',
          antenna_name: run.name,
        }),
      });
      const data = await response.json();
      if (data.success) {
        if (onStart) onStart(data.data);
      } else {
        showAlert('Resume Failed', data.message || 'Failed to resume progressive tuning');
      }
    } catch (error) {
      showAlert('Connection Error', `Could not reach server: ${error.message}`);
    } finally {
      setIsStarting(false);
    }
  };

  /**
   * View the results of a completed run — loads status.json and renders
   * ProgressiveTuningResults inline (no navigation to parent).
   */
  const handleViewResult = async (run) => {
    setLoadingRuns(true);
    try {
      const response = await fetch(
        `${SERVER_URL}/api/progressive-tuning/run-result?runPath=${encodeURIComponent(run.path)}`
      );
      const data = await response.json();
      if (data.success) {
        setViewingResult(data.data);
      } else {
        showAlert('Error', data.message || 'Could not load run results');
      }
    } catch (error) {
      showAlert('Connection Error', `Could not reach server: ${error.message}`);
    } finally {
      setLoadingRuns(false);
    }
  };

  /**
   * Delete a run folder permanently (with confirmation)
   */
  const handleDeleteRun = (run) => {
    showAlert(
      'Delete Run',
      `Permanently delete "${run.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await fetch(
                `${SERVER_URL}/api/progressive-tuning/run?runPath=${encodeURIComponent(run.path)}`,
                { method: 'DELETE' }
              );
              const data = await response.json();
              if (data.success) {
                fetchPreviousRuns();
              } else {
                showAlert('Delete Failed', data.message || 'Could not delete run');
              }
            } catch (error) {
              showAlert('Connection Error', `Could not reach server: ${error.message}`);
            }
          },
        },
      ]
    );
  };

  // Re-center antenna when ground plane dimensions change
  useEffect(() => {
    const lgxVal = parseFloat(lgx) || 50;
    const lgyVal = parseFloat(lgy) || 50;
    const halfAntenna = ANTENNA_SIZE / 2;
    // Clamp current position to new bounds
    setAntennaX(prev => Math.max(halfAntenna, Math.min(prev, lgxVal - halfAntenna)));
    setAntennaY(prev => Math.max(halfAntenna, Math.min(prev, lgyVal - halfAntenna)));
  }, [lgx, lgy]);

  // Live DXF polygon containment check — updates whenever antenna moves or DXF changes
  useEffect(() => {
    if (gndMode !== 'dxf' || !dxfGndData) {
      setAntennaOutsideDxfShape(false);
      return;
    }
    const inside = isAntennaInsideDxf(antennaX, antennaY, dxfGndData);
    setAntennaOutsideDxfShape(!inside);
    // Sync precision inputs to match dragged position (only when not editing)
    setDxfXInput(antennaX.toFixed(2));
    setDxfYInput(antennaY.toFixed(2));
  }, [gndMode, dxfGndData, antennaX, antennaY]);

  // Scale factor: convert mm to screen pixels
  const getScaleFactor = useCallback(() => {
    const lgxVal = parseFloat(lgx) || 50;
    const lgyVal = parseFloat(lgy) || 50;
    const maxDim = Math.max(lgxVal, lgyVal);
    const availableWidth = width - 80; // Leave margins
    const availableHeight = 400; // Fixed height for canvas
    const minDim = Math.min(availableWidth, availableHeight);
    return (minDim - 40) / maxDim; // Leave padding
  }, [lgx, lgy]);

  // Drag handlers
  const handleDragStart = useCallback((event) => {
    setIsDragging(true);
    const clientX = event.clientX || (event.touches && event.touches[0].clientX) || 0;
    const clientY = event.clientY || (event.touches && event.touches[0].clientY) || 0;
    setDragStartPos({ x: clientX, y: clientY });
    setInitialAntennaPos({ x: antennaX, y: antennaY });
  }, [antennaX, antennaY]);

  const handleDragMove = useCallback((event) => {
    if (!isDragging) return;
    const clientX = event.clientX || (event.touches && event.touches[0].clientX) || 0;
    const clientY = event.clientY || (event.touches && event.touches[0].clientY) || 0;

    const scaleFactor = getScaleFactor();
    const lgxVal = parseFloat(lgx) || 50;
    const lgyVal = parseFloat(lgy) || 50;
    const halfAntenna = ANTENNA_SIZE / 2;

    const deltaX = (clientX - dragStartPos.x) / scaleFactor;
    const deltaY = (clientY - dragStartPos.y) / scaleFactor;

    // Screen Y increases downward, but GND Y increases upward
    let newX = initialAntennaPos.x + deltaX;
    let newY = initialAntennaPos.y - deltaY;

    // Clamp: antenna center must stay ANTENNA_SIZE/2 from bounding-box edges
    newX = Math.max(halfAntenna, Math.min(newX, lgxVal - halfAntenna));
    newY = Math.max(halfAntenna, Math.min(newY, lgyVal - halfAntenna));

    // DXF mode: boundary sliding — prevent the antenna leaving the custom polygon
    if (gndMode === 'dxf' && dxfGndData) {
      if (!isAntennaInsideDxf(newX, newY, dxfGndData)) {
        // Try sliding along X only (keep current antenna Y)
        if (isAntennaInsideDxf(newX, antennaY, dxfGndData)) {
          newY = antennaY;
        // Try sliding along Y only (keep current antenna X)
        } else if (isAntennaInsideDxf(antennaX, newY, dxfGndData)) {
          newX = antennaX;
        } else {
          // Both axes blocked — stay put
          return;
        }
      }
    }

    setAntennaX(newX);
    setAntennaY(newY);
  }, [isDragging, dragStartPos, initialAntennaPos, lgx, lgy, gndMode, dxfGndData, antennaX, antennaY, getScaleFactor]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // ---- Draw DXF geometry on canvas (web only) ----
  useEffect(() => {
    if (Platform.OS !== 'web' || gndMode !== 'dxf' || !dxfGndData || !dxfGndData.geometry) return;
    if (!dxfCanvasRef.current) return;

    const { vertices, edges } = dxfGndData.geometry;
    if (!Array.isArray(vertices) || vertices.length === 0 || !Array.isArray(edges) || edges.length === 0) return;

    const canvas = dxfCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const scaleFactor = getScaleFactor();
    const lgxVal = parseFloat(lgx) || 50;
    const lgyVal = parseFloat(lgy) || 50;
    const canvasWidth = lgxVal * scaleFactor;
    const canvasHeight = lgyVal * scaleFactor;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const bounds = dxfGndData.bounds;
    const geoMinX = bounds.min_x;
    const geoMinY = bounds.min_y;
    const geoHeight = bounds.height;

    const geoToScreen = (x, y) => ({
      x: (parseFloat(x) - geoMinX) * scaleFactor,
      y: (geoHeight - (parseFloat(y) - geoMinY)) * scaleFactor,
    });

    // Fill shape
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw edges
    ctx.beginPath();
    for (const [startIdx, endIdx] of edges) {
      if (!vertices[startIdx] || !vertices[endIdx]) continue;
      const p1 = geoToScreen(vertices[startIdx][0], vertices[startIdx][1]);
      const p2 = geoToScreen(vertices[endIdx][0], vertices[endIdx][1]);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();

    // Try to fill (simple path tracing)
    ctx.beginPath();
    const visitedEdges = new Set();
    for (let i = 0; i < edges.length; i++) {
      if (visitedEdges.has(i)) continue;
      const path = [];
      let currentEdge = i;
      while (!visitedEdges.has(currentEdge) && currentEdge < edges.length) {
        visitedEdges.add(currentEdge);
        const [v1] = edges[currentEdge];
        path.push(vertices[v1]);
        // Find next edge
        const endVertex = edges[currentEdge][1];
        let nextEdge = -1;
        for (let j = 0; j < edges.length; j++) {
          if (!visitedEdges.has(j) && edges[j][0] === endVertex) { nextEdge = j; break; }
        }
        currentEdge = nextEdge === -1 ? edges.length : nextEdge;
      }
      if (path.length > 2) {
        const p0 = geoToScreen(path[0][0], path[0][1]);
        ctx.moveTo(p0.x, p0.y);
        for (let k = 1; k < path.length; k++) {
          const pk = geoToScreen(path[k][0], path[k][1]);
          ctx.lineTo(pk.x, pk.y);
        }
        ctx.closePath();
      }
    }
    ctx.fill('evenodd');
  }, [gndMode, dxfGndData, lgx, lgy, getScaleFactor]);

  /**
   * Validate all inputs before starting
   */
  const validate = () => {
    const errors = [];

    // Validate antenna name
    if (!antennaName || !antennaName.trim()) {
      errors.push('Antenna name is required');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(antennaName.trim())) {
      errors.push('Antenna name can only contain letters, numbers, hyphens and underscores');
    } else {
      const duplicate = previousRuns.find(
        (r) => r.name?.toLowerCase() === antennaName.trim().toLowerCase()
      );
      if (duplicate) {
        errors.push(`Profile name "${antennaName.trim()}" already exists — choose a different name or delete the existing profile first`);
      }
    }

    if (gndMode === 'parametric') {
      const lgxVal = parseFloat(lgx);
      const lgyVal = parseFloat(lgy);

      if (isNaN(lgxVal) || lgxVal <= 0) errors.push('Lgx must be a positive number');
      if (isNaN(lgyVal) || lgyVal <= 0) errors.push('Lgy must be a positive number');
      if (lgxVal < ANTENNA_SIZE) errors.push(`Lgx must be at least ${ANTENNA_SIZE}mm (antenna size)`);
      if (lgyVal < ANTENNA_SIZE) errors.push(`Lgy must be at least ${ANTENNA_SIZE}mm (antenna size)`);
    } else {
      if ((!dxfPath || !dxfPath.trim()) && !dxfGndData) errors.push('Please select a DXF file using the file picker');
      if (antennaOutsideDxfShape) errors.push('Antenna is outside the DXF ground plane boundary — drag it to a valid position inside the shape');
    }

    if (showAdvanced) {
      for (const [key, val] of Object.entries(variables)) {
        const def = varDefs[key];
        if (!def) continue; // skip any key not present in loaded config
        const num = parseFloat(val);
        if (isNaN(num)) {
          errors.push(`${key} must be a number`);
        } else if (num < def.min || num > def.max) {
          errors.push(`${key} must be between ${def.min} and ${def.max}`);
        }
      }
    }

    setValidationErrors(errors);
    return errors.length === 0;
  };

  /**
   * Start progressive tuning
   */
  const handleStart = async () => {
    if (!validate()) return;

    setIsStarting(true);
    try {
      // HFSS Coordinate System Transformation:
      // UI: (0,0) at bottom-left, X increases right, Y increases up
      // HFSS: Top = -X, Bottom = +X, Left = -Y, Right = +Y
      // → xPos = Lgy - antennaY (flip Y→X), yPos = antennaX (X→Y)
      const lgyNum = parseFloat(lgy);
      const GND_config = {
        use_DXF: gndMode === 'dxf',
        ...(gndMode === 'dxf' && { dxf_file_path: dxfPath.trim() }),
        Lgx: parseFloat(lgx),
        Lgy: lgyNum,
        xPos: parseFloat((lgyNum - antennaY).toFixed(2)),
        yPos: parseFloat(antennaX.toFixed(2)),
      };

      const initial_variables = showAdvanced
        ? Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, parseFloat(v)]))
        : null;

      const response = await fetch(`${SERVER_URL}/api/progressive-tuning/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: localProjectPath || projectPath,
          mode: 'create',
          GND_config: GND_config,
          initial_variables,
          antenna_name: antennaName.trim(),
        }),
      });

      const data = await response.json();

      if (data.success) {
        if (onStart) onStart(data.data);
      } else {
        showAlert('Start Failed', data.message || 'Failed to start progressive tuning');
      }
    } catch (error) {
      showAlert('Connection Error', `Could not reach server: ${error.message}`);
    } finally {
      setIsStarting(false);
    }
  };

  /**
   * Reset advanced variables to defaults
   */
  const resetToDefaults = () => {
    const reset = {};
    for (const [key, def] of Object.entries(varDefs)) {
      reset[key] = String(def.value);
    }
    setVariables(reset);
  };

  // If an active session is running, block the setup form
  if (activeSessionDetected) {
    return (
      <View style={styles.container}>
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
            <Text style={styles.headerTitle}>Progressive Tuning</Text>
            <View style={{ width: 60 }} />
          </View>
        </LinearGradient>
        <View style={styles.blockedContainer}>
          <Text style={styles.blockedIcon}>🔒</Text>
          <Text style={styles.blockedTitle}>Tuning Already Running</Text>
          <Text style={styles.blockedMessage}>
            Another progressive tuning session is currently active on this server.
            Only one tuning session can run at a time.
          </Text>
          <Text style={styles.blockedHint}>
            Please wait for the current session to finish, or stop it from the Progress page.
          </Text>
          <TouchableOpacity style={styles.blockedBackButton} onPress={onBack}>
            <Text style={styles.blockedBackButtonText}>← Go Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ---- Inline result viewer: rendered in place of Setup ----
  if (viewingResult) {
    return (
      <ProgressiveTuningResults
        statusData={viewingResult}
        onBack={() => setViewingResult(null)}
        onRerun={() => setViewingResult(null)}
        onRunMoead={() => setViewingResult(null)}
      />
    );
  }

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
          <TouchableOpacity onPress={projectLocationConfirmed ? resetProjectLocation : onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← {projectLocationConfirmed ? 'Change Location' : 'Back'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Progressive Tuning</Text>
          <View style={{ width: 60 }} />
        </View>
        {/* Step indicator */}
        <View style={styles.stepIndicator}>
          <View style={[styles.stepDot, styles.stepDotActive]} />
          <View style={[styles.stepLine, projectLocationConfirmed && styles.stepLineActive]} />
          <View style={[styles.stepDot, projectLocationConfirmed && styles.stepDotActive]} />
        </View>
        <View style={styles.stepLabels}>
          <Text style={styles.stepLabelActive}>1. Location</Text>
          <Text style={[styles.stepLabel, projectLocationConfirmed && styles.stepLabelActive]}>2. Configuration</Text>
        </View>
      </LinearGradient>

      {/* Hidden DXF file input (web only) */}
      {Platform.OS === 'web' && (
        <input
          type="file"
          accept=".dxf"
          ref={dxfFileInputRef}
          onChange={handleDxfFileSelected}
          style={{ display: 'none' }}
        />
      )}

      {/* ============ STEP 1: Project Location ============ */}
      {!projectLocationConfirmed && (
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>📁</Text>
              <Text style={styles.sectionTitle}>Project Location</Text>
            </View>
            <View style={styles.locationContainer}>
              <Text style={styles.locationHint}>
                Enter the full path to your MATLAB/HFSS project folder
              </Text>

              {/* Input Row with Paste button */}
              <View style={styles.locationInputRow}>
                <TextInput
                  style={[styles.textInput, styles.locationInput]}
                  value={localProjectPath}
                  onChangeText={setLocalProjectPath}
                  placeholder="C:\\Users\\...\\MOEA_D_DE_3obj_current"
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.pasteButton} onPress={handlePaste}>
                  <Text style={styles.pasteButtonText}>📋 Paste</Text>
                </TouchableOpacity>
              </View>

              {/* History & Clear buttons */}
              <View style={styles.locationButtonRow}>
                <TouchableOpacity
                  style={styles.historyToggleButton}
                  onPress={() => setShowPathHistory(!showPathHistory)}
                >
                  <Text style={styles.historyToggleText}>
                    {showPathHistory ? '▼' : '▶'} History ({pathHistory.length})
                  </Text>
                </TouchableOpacity>
                {pathHistory.length > 0 && (
                  <TouchableOpacity style={styles.clearHistoryButton} onPress={clearPathHistory}>
                    <Text style={styles.clearHistoryText}>Clear History</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Path History Dropdown */}
              {showPathHistory && pathHistory.length > 0 && (
                <View style={styles.historyDropdown}>
                  {pathHistory.map((path, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={styles.historyItem}
                      onPress={() => {
                        setLocalProjectPath(path);
                        setShowPathHistory(false);
                      }}
                    >
                      <Text style={styles.historyItemText} numberOfLines={1}>
                        {path}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Validation message */}
              {locationValidationMessage ? (
                <Text style={[
                  styles.validationMessage,
                  locationValidationMessage.startsWith('✅') && styles.validationSuccess,
                  locationValidationMessage.startsWith('❌') && styles.validationError,
                  locationValidationMessage.startsWith('⚠️') && styles.validationWarning,
                ]}>
                  {locationValidationMessage}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Confirm Location Button */}
          <TouchableOpacity
            style={[styles.confirmLocationButton, isValidatingLocation && styles.startButtonDisabled]}
            onPress={validateProjectLocation}
            disabled={isValidatingLocation || !localProjectPath.trim()}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={isValidatingLocation ? ['#9ca3af', '#6b7280'] : ['#7c3aed', '#6d28d9', '#5b21b6']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.confirmLocationGradient}
            >
              {isValidatingLocation ? (
                <View style={styles.startButtonContent}>
                  <ActivityIndicator color="#ffffff" size="small" />
                  <Text style={styles.confirmLocationText}>  Validating...</Text>
                </View>
              ) : (
                <Text style={styles.confirmLocationText}>✔ Confirm Location & Continue</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ============ STEP 2: Configuration ============ */}
      {projectLocationConfirmed && (
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>

        {/* Confirmed Location Summary */}
        <View style={styles.locationSummary}>
          <Text style={styles.locationSummaryLabel}>📁 Project:</Text>
          <Text style={styles.locationSummaryPath} numberOfLines={1}>{localProjectPath || projectPath}</Text>
        </View>

        {/* Antenna Name */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>🏷️</Text>
            <Text style={styles.sectionTitle}>Antenna Name</Text>
          </View>
          <View style={styles.nameInputContainer}>
            {(() => {
              const isDuplicate = !!antennaName.trim() && previousRuns.some(
                (r) => r.name?.toLowerCase() === antennaName.trim().toLowerCase()
              );
              return (
                <>
                  <TextInput
                    style={[styles.textInput, isDuplicate && { borderColor: '#ef4444', borderWidth: 2 }]}
                    value={antennaName}
                    onChangeText={setAntennaName}
                    placeholder="antenna1"
                    autoCapitalize="none"
                  />
                  {isDuplicate ? (
                    <Text style={[styles.hintText, { color: '#dc2626', fontWeight: '600' }]}>
                      ⚠️ Profile "{antennaName.trim()}" already exists — choose a different name
                    </Text>
                  ) : (
                    <Text style={styles.hintText}>
                      Used as the output folder name: Results/{antennaName || 'antenna1'}/
                    </Text>
                  )}
                </>
              );
            })()}
          </View>
        </View>

        {/* Previous Runs / Checkpoint Resume */}
        {previousRuns.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>📂</Text>
              <Text style={styles.sectionTitle}>Previous Runs</Text>
            </View>
            <View style={styles.runsContainer}>
              {previousRuns.map((run, idx) => (
                <View key={idx} style={[styles.runCard, run.status === 'invalid' && { borderLeftWidth: 3, borderLeftColor: '#ef4444' }]}>
                  <View style={styles.runInfo}>
                    <Text style={styles.runName}>{run.name}</Text>
                    <Text style={styles.runDetail}>
                      {run.status === 'complete' ? '✅ Complete'
                       : run.status === 'invalid' ? '⚠️ Invalid — needs adjustment'
                       : run.has_checkpoint ? '⏸️ Resumable' : '⏸️ Incomplete'}
                      {(run.current_phase ?? run.phase) ? ` • Phase ${run.current_phase ?? run.phase}` : ''}
                      {run.total_simulations ? ` • ${run.total_simulations} sims` : ''}
                      {run.timestamp ? ` • ${new Date(run.timestamp).toLocaleDateString()}` : ''}
                    </Text>
                  </View>
                  {run.status === 'incomplete' && (
                    <TouchableOpacity
                      style={styles.resumeButton}
                      onPress={() => handleResume(run)}
                      disabled={isStarting}
                    >
                      <Text style={styles.resumeButtonText}>▶ Resume</Text>
                    </TouchableOpacity>
                  )}
                  {run.status === 'invalid' && (
                    <View style={[styles.completeTag, { backgroundColor: '#fef2f2' }]}>
                      <Text style={[styles.completeTagText, { color: '#ef4444' }]}>⚠️ Invalid</Text>
                    </View>
                  )}
                  {run.status === 'complete' && (
                    <TouchableOpacity
                      style={styles.viewResultButton}
                      onPress={() => handleViewResult(run)}
                      disabled={loadingRuns}
                    >
                      <Text style={styles.viewResultButtonText}>📊 View</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.deleteRunButton}
                    onPress={() => handleDeleteRun(run)}
                  >
                    <Text style={styles.deleteRunButtonText}>🗑</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Ground Plane Configuration */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>📡</Text>
            <Text style={styles.sectionTitle}>Ground Plane Configuration</Text>
          </View>

          {/* Mode Toggle */}
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeButton, gndMode === 'parametric' && styles.modeButtonActive]}
              onPress={() => setGndMode('parametric')}
            >
              <Text style={[styles.modeButtonText, gndMode === 'parametric' && styles.modeButtonTextActive]}>
                Parametric Rectangle
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeButton, gndMode === 'dxf' && styles.modeButtonActive]}
              onPress={() => setGndMode('dxf')}
            >
              <Text style={[styles.modeButtonText, gndMode === 'dxf' && styles.modeButtonTextActive]}>
                Import Custom DXF
              </Text>
            </TouchableOpacity>
          </View>

          {/* Parametric Inputs */}
          {gndMode === 'parametric' && (() => {
            const scaleFactor = getScaleFactor();
            const lgxVal = parseFloat(lgx) || 50;
            const lgyVal = parseFloat(lgy) || 50;
            const canvasWidth = lgxVal * scaleFactor;
            const canvasHeight = lgyVal * scaleFactor;
            const antennaDisplaySize = ANTENNA_SIZE * scaleFactor;
            const halfAntenna = ANTENNA_SIZE / 2;
            const antennaCornerX = antennaX - halfAntenna;
            const antennaCornerY = antennaY - halfAntenna;
            const screenX = antennaCornerX * scaleFactor;
            const screenY = (lgyVal - antennaCornerY - ANTENNA_SIZE) * scaleFactor;

            return (
              <View style={styles.inputGrid}>
                {/* Dimension inputs */}
                <View style={styles.inputRow}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Lgx - Width (mm)</Text>
                    <TextInput
                      style={[styles.textInput, lgxVal < ANTENNA_SIZE && { borderColor: '#ef4444', borderWidth: 2 }]}
                      value={lgx}
                      onChangeText={setLgx}
                      keyboardType="numeric"
                      placeholder="100"
                    />
                    {lgxVal < ANTENNA_SIZE && (
                      <Text style={styles.fieldErrorText}>⚠️ Min {ANTENNA_SIZE}mm (antenna width)</Text>
                    )}
                  </View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Lgy - Height (mm)</Text>
                    <TextInput
                      style={[styles.textInput, lgyVal < ANTENNA_SIZE && { borderColor: '#ef4444', borderWidth: 2 }]}
                      value={lgy}
                      onChangeText={setLgy}
                      keyboardType="numeric"
                      placeholder="100"
                    />
                    {lgyVal < ANTENNA_SIZE && (
                      <Text style={styles.fieldErrorText}>⚠️ Min {ANTENNA_SIZE}mm (antenna height)</Text>
                    )}
                  </View>
                </View>

                {/* Antenna Position Label */}
                <Text style={styles.canvasLabel}>Drag the antenna to set its position on the ground plane:</Text>

                {/* Visual Canvas — only shown when GND is large enough to contain the antenna */}
                {(lgxVal < ANTENNA_SIZE || lgyVal < ANTENNA_SIZE) ? (
                  <View style={styles.canvasSizeErrorBox}>
                    <Text style={styles.canvasSizeErrorText}>
                      ⚠️ Ground plane must be at least {ANTENNA_SIZE}×{ANTENNA_SIZE}mm to contain the antenna.
                      {lgxVal < ANTENNA_SIZE ? `\nLgx is ${lgxVal}mm — increase to at least ${ANTENNA_SIZE}mm.` : ''}
                      {lgyVal < ANTENNA_SIZE ? `\nLgy is ${lgyVal}mm — increase to at least ${ANTENNA_SIZE}mm.` : ''}
                    </Text>
                  </View>
                ) : (
                <View style={styles.canvasContainer}>
                  <View
                    style={[styles.canvas, {
                      width: canvasWidth,
                      height: canvasHeight,
                      position: 'relative',
                    }]}
                    onMouseMove={Platform.OS === 'web' ? handleDragMove : undefined}
                    onMouseUp={Platform.OS === 'web' ? handleDragEnd : undefined}
                    onMouseLeave={Platform.OS === 'web' ? handleDragEnd : undefined}
                  >
                    {/* Ground plane background */}
                    <View style={[styles.groundPlane, {
                      width: canvasWidth,
                      height: canvasHeight,
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      zIndex: 0,
                    }]} />

                    {/* Corner coordinate labels */}
                    <View style={styles.coordinateLabels}>
                      <Text style={styles.originLabel}>(0,0)</Text>
                      <Text style={[styles.cornerLabel, { bottom: 5, left: canvasWidth - 55 }]}>({lgxVal},0)</Text>
                      <Text style={[styles.cornerLabel, { top: 5, left: 5 }]}>(0,{lgyVal})</Text>
                      <Text style={[styles.cornerLabel, { top: 5, left: canvasWidth - 75 }]}>({lgxVal},{lgyVal})</Text>
                    </View>

                    {/* Draggable Antenna */}
                    <View
                      style={[styles.antenna, {
                        width: antennaDisplaySize,
                        height: antennaDisplaySize,
                        left: screenX,
                        top: screenY,
                        cursor: isDragging ? 'grabbing' : 'grab',
                        zIndex: 10,
                      }]}
                      onMouseDown={Platform.OS === 'web' ? handleDragStart : undefined}
                      onTouchStart={handleDragStart}
                      onTouchMove={handleDragMove}
                      onTouchEnd={handleDragEnd}
                    >
                      <Text style={styles.antennaText}>Antenna</Text>
                      <Text style={styles.antennaSize}>{ANTENNA_SIZE}x{ANTENNA_SIZE}mm</Text>
                      <Text style={styles.antennaDrag}>Drag me!</Text>
                    </View>
                  </View>

                  {/* Position readout */}
                  <View style={styles.positionDisplay}>
                    <Text style={styles.positionText}>
                      Ground Plane: {lgxVal} x {lgyVal} mm
                    </Text>
                    <Text style={styles.positionText}>
                      GND_xPos: {antennaX.toFixed(1)}mm, GND_yPos: {antennaY.toFixed(1)}mm
                    </Text>
                    <Text style={styles.positionHint}>
                      (Center of antenna in ground plane coordinate system)
                    </Text>
                    {/* HFSS Coordinate System Info */}
                    <View style={styles.coordinateSystemInfo}>
                      <Text style={styles.coordinateSystemTitle}>HFSS Coordinate System:</Text>
                      <Text style={styles.coordinateSystemText}>Top = -X axis | Bottom = +X axis | Left = -Y axis | Right = +Y axis</Text>
                      <Text style={styles.positionText}>
                        HFSS Output: xPos = {(lgyVal - antennaY).toFixed(1)}mm, yPos = {antennaX.toFixed(1)}mm
                      </Text>
                    </View>
                  </View>
                </View>
                )}
              </View>
            );
          })()}

          {/* DXF Input - File Picker */}
          {gndMode === 'dxf' && (() => {
            const scaleFactor = getScaleFactor();
            const lgxVal = parseFloat(lgx) || 50;
            const lgyVal = parseFloat(lgy) || 50;
            const canvasWidth = lgxVal * scaleFactor;
            const canvasHeight = lgyVal * scaleFactor;
            const antennaDisplaySize = ANTENNA_SIZE * scaleFactor;
            const halfAntenna = ANTENNA_SIZE / 2;
            const antennaCornerX = antennaX - halfAntenna;
            const antennaCornerY = antennaY - halfAntenna;
            const screenX = antennaCornerX * scaleFactor;
            const screenY = (lgyVal - antennaCornerY - ANTENNA_SIZE) * scaleFactor;

            return (
              <View style={styles.dxfInputContainer}>
                <Text style={styles.inputLabel}>Custom DXF Ground Plane</Text>
                <TouchableOpacity
                  style={styles.dxfPickerButton}
                  onPress={handleDxfFilePick}
                  disabled={isUploadingDxf}
                >
                  {isUploadingDxf ? (
                    <View style={styles.dxfPickerContent}>
                      <ActivityIndicator color="#7c3aed" size="small" />
                      <Text style={styles.dxfPickerText}>  Uploading...</Text>
                    </View>
                  ) : (
                    <View style={styles.dxfPickerContent}>
                      <Text style={styles.dxfPickerIcon}>📂</Text>
                      <Text style={styles.dxfPickerText}>
                        {dxfFileName ? dxfFileName : 'Browse for DXF file...'}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
                {dxfFileName && dxfGndData ? (
                  <View>
                    <Text style={[styles.hintText, { color: '#16a34a' }]}>
                      ✅ {dxfFileName} • {dxfGndData.bounds?.width?.toFixed(1)} × {dxfGndData.bounds?.height?.toFixed(1)} mm
                    </Text>

                    {/* Re-upload button */}
                    <TouchableOpacity
                      style={styles.reuploadButton}
                      onPress={handleDxfFilePick}
                    >
                      <Text style={styles.reuploadButtonText}>🔄 Re-upload</Text>
                    </TouchableOpacity>

                    {/* Positioning Canvas */}
                    <Text style={[styles.canvasLabel, { marginTop: 16 }]}>
                      Drag the antenna to set its position on the ground plane:
                    </Text>

                    <View style={styles.canvasContainer}>
                      <View
                        style={[styles.canvas, {
                          width: canvasWidth,
                          height: canvasHeight,
                          position: 'relative',
                        }]}
                        onMouseMove={Platform.OS === 'web' ? handleDragMove : undefined}
                        onMouseUp={Platform.OS === 'web' ? handleDragEnd : undefined}
                        onMouseLeave={Platform.OS === 'web' ? handleDragEnd : undefined}
                      >
                        {/* Ground plane background */}
                        <View style={[styles.groundPlane, {
                          width: canvasWidth,
                          height: canvasHeight,
                          backgroundColor: '#f0f9ff',
                          borderColor: 'transparent',
                          borderWidth: 0,
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          zIndex: 0,
                        }]} />

                        {/* DXF geometry overlay (web: canvas, mobile: lines) */}
                        {Platform.OS === 'web' ? (
                          <canvas
                            ref={dxfCanvasRef}
                            style={{
                              position: 'absolute', top: 0, left: 0,
                              width: '100%', height: '100%',
                              pointerEvents: 'none', zIndex: 5,
                            }}
                          />
                        ) : (
                          dxfGndData.geometry && dxfGndData.geometry.edges && dxfGndData.geometry.vertices &&
                          dxfGndData.geometry.edges.map(([startIdx, endIdx], idx) => {
                            const verts = dxfGndData.geometry.vertices;
                            if (!verts[startIdx] || !verts[endIdx]) return null;
                            const bounds = dxfGndData.bounds;
                            const p1x = (verts[startIdx][0] - bounds.min_x) * scaleFactor;
                            const p1y = (bounds.height - (verts[startIdx][1] - bounds.min_y)) * scaleFactor;
                            const p2x = (verts[endIdx][0] - bounds.min_x) * scaleFactor;
                            const p2y = (bounds.height - (verts[endIdx][1] - bounds.min_y)) * scaleFactor;
                            const dx = p2x - p1x, dy = p2y - p1y;
                            const length = Math.sqrt(dx * dx + dy * dy);
                            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                            return (
                              <View key={`dxf-edge-${idx}`} style={{
                                position: 'absolute', left: p1x, top: p1y,
                                width: length, height: 3, backgroundColor: '#2563eb',
                                transform: [{ rotate: `${angle}deg` }], transformOrigin: '0 0', zIndex: 2,
                              }} />
                            );
                          }).filter(Boolean)
                        )}

                        {/* Corner coordinate labels */}
                        <View style={styles.coordinateLabels}>
                          <Text style={styles.originLabel}>(0,0)</Text>
                          <Text style={[styles.cornerLabel, { bottom: 5, left: canvasWidth - 55 }]}>({lgxVal},0)</Text>
                          <Text style={[styles.cornerLabel, { top: 5, left: 5 }]}>(0,{lgyVal})</Text>
                          <Text style={[styles.cornerLabel, { top: 5, left: canvasWidth - 75 }]}>({lgxVal},{lgyVal})</Text>
                        </View>

                        {/* Draggable Antenna */}
                        <View
                          style={[styles.antenna, {
                            width: antennaDisplaySize,
                            height: antennaDisplaySize,
                            left: screenX,
                            top: screenY,
                            cursor: isDragging ? 'grabbing' : 'grab',
                            zIndex: 10,
                          }]}
                          onMouseDown={Platform.OS === 'web' ? handleDragStart : undefined}
                          onTouchStart={handleDragStart}
                          onTouchMove={handleDragMove}
                          onTouchEnd={handleDragEnd}
                        >
                          <Text style={styles.antennaText}>Antenna</Text>
                          <Text style={styles.antennaSize}>{ANTENNA_SIZE}x{ANTENNA_SIZE}mm</Text>
                          <Text style={styles.antennaDrag}>Drag me!</Text>
                        </View>
                      </View>

                      {/* Position readout + precision inputs */}
                      <View style={[styles.positionDisplay, antennaOutsideDxfShape && styles.positionDisplayError]}>
                        {antennaOutsideDxfShape && (
                          <Text style={styles.outsideWarningText}>
                            ⚠️ Antenna is outside the DXF ground plane boundary!
                            Drag it to a valid position inside the shape.
                          </Text>
                        )}
                        <Text style={styles.positionText}>
                          Ground Plane: {lgxVal} × {lgyVal} mm (from DXF)
                        </Text>
                        {/* Fine-tune coordinate inputs */}
                        <View style={styles.fineTuneRow}>
                          <View style={styles.fineTuneGroup}>
                            <Text style={styles.fineTuneLabel}>GND X (mm)</Text>
                            <TextInput
                              style={[styles.fineTuneInput, antennaOutsideDxfShape && styles.fineTuneInputError]}
                              value={dxfXInput}
                              onChangeText={setDxfXInput}
                              keyboardType="numeric"
                              onBlur={() => {
                                const v = parseFloat(dxfXInput);
                                const half = ANTENNA_SIZE / 2;
                                if (!isNaN(v)) {
                                  const clamped = Math.max(half, Math.min(v, lgxVal - half));
                                  if (isAntennaInsideDxf(clamped, antennaY, dxfGndData)) {
                                    setAntennaX(clamped);
                                  }
                                }
                                setDxfXInput(antennaX.toFixed(2));
                              }}
                            />
                          </View>
                          <View style={styles.fineTuneGroup}>
                            <Text style={styles.fineTuneLabel}>GND Y (mm)</Text>
                            <TextInput
                              style={[styles.fineTuneInput, antennaOutsideDxfShape && styles.fineTuneInputError]}
                              value={dxfYInput}
                              onChangeText={setDxfYInput}
                              keyboardType="numeric"
                              onBlur={() => {
                                const v = parseFloat(dxfYInput);
                                const half = ANTENNA_SIZE / 2;
                                if (!isNaN(v)) {
                                  const clamped = Math.max(half, Math.min(v, lgyVal - half));
                                  if (isAntennaInsideDxf(antennaX, clamped, dxfGndData)) {
                                    setAntennaY(clamped);
                                  }
                                }
                                setDxfYInput(antennaY.toFixed(2));
                              }}
                            />
                          </View>
                        </View>
                        <Text style={styles.positionHint}>
                          Type exact mm values or drag on canvas above
                        </Text>
                        <View style={styles.coordinateSystemInfo}>
                          <Text style={styles.coordinateSystemTitle}>HFSS Coordinate System:</Text>
                          <Text style={styles.coordinateSystemText}>Top = -X axis | Bottom = +X axis | Left = -Y axis | Right = +Y axis</Text>
                          <Text style={styles.positionText}>
                            HFSS Output: xPos = {(lgyVal - antennaY).toFixed(2)}mm, yPos = {antennaX.toFixed(2)}mm
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                ) : dxfFileName ? (
                  <Text style={[styles.hintText, { color: '#16a34a' }]}>
                    ✅ {dxfFileName} uploaded and ready
                  </Text>
                ) : (
                  <Text style={styles.hintText}>
                    Click to select a .dxf ground plane file from your computer
                  </Text>
                )}
              </View>
            );
          })()}
        </View>

        {/* Advanced Variables (Collapsible) */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.advancedToggle}
            onPress={() => setShowAdvanced(!showAdvanced)}
          >
            <Text style={styles.advancedToggleIcon}>{showAdvanced ? '▼' : '▶'}</Text>
            <Text style={styles.advancedToggleText}>Advanced: Starting Variables</Text>
            {!showAdvanced && (
              <Text style={styles.advancedHint}>Using defaults from config</Text>
            )}
          </TouchableOpacity>

          {showAdvanced && (
            <View style={styles.advancedContent}>
              {Object.entries(varDefs).map(([key, def]) => (
                <View key={key} style={styles.varRow}>
                  <View style={styles.varLabel}>
                    <Text style={styles.varName}>{key}</Text>
                    <Text style={styles.varDesc}>{def.description}</Text>
                  </View>
                  <View style={styles.varInputWrapper}>
                    <TextInput
                      style={styles.varInput}
                      value={variables[key]}
                      onChangeText={(val) => setVariables(prev => ({ ...prev, [key]: val }))}
                      keyboardType="numeric"
                    />
                    <Text style={styles.varUnit}>{def.unit}</Text>
                  </View>
                  <Text style={styles.varRange}>({def.min} - {def.max})</Text>
                </View>
              ))}

              <TouchableOpacity style={styles.resetButton} onPress={resetToDefaults}>
                <Text style={styles.resetButtonText}>Reset to Defaults</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* What This Does - Info Card */}
        <View style={styles.section}>
          <LinearGradient
            colors={['#eff6ff', '#dbeafe']}
            style={styles.infoCard}
          >
            <Text style={styles.infoTitle}>ℹ️  What This Does</Text>
            <Text style={styles.infoText}>
              Progressive tuning automatically adjusts antenna parameters in 3 phases:
            </Text>
            {PHASES.map(phase => (
              <View key={phase.id} style={styles.phaseInfoRow}>
                <View style={styles.phaseInfoBadge}>
                  <Text style={styles.phaseInfoBadgeText}>{phase.id}</Text>
                </View>
                <View style={styles.phaseInfoContent}>
                  <Text style={styles.phaseInfoName}>{phase.name}</Text>
                  <Text style={styles.phaseInfoTarget}>Target: {phase.target} • {phase.sims} sims</Text>
                  <Text style={styles.phaseInfoVars}>Variables: {phase.variables.join(', ')}</Text>
                </View>
              </View>
            ))}
            <View style={styles.infoFooter}>
              <View style={styles.infoStat}>
                <Text style={styles.infoStatLabel}>Estimated Time</Text>
                <Text style={styles.infoStatValue}>2-4 hours</Text>
              </View>
              <View style={styles.infoStat}>
                <Text style={styles.infoStatLabel}>Simulations</Text>
                <Text style={styles.infoStatValue}>20-35</Text>
              </View>
              <View style={styles.infoStat}>
                <Text style={styles.infoStatLabel}>Speedup</Text>
                <Text style={styles.infoStatValue}>3-7x</Text>
              </View>
            </View>
            <Text style={styles.infoResultText}>
              Result: Narrowed variable ranges for faster final MOEA/D optimization
            </Text>
          </LinearGradient>
        </View>

        {/* Validation Errors */}
        {validationErrors.length > 0 && (
          <View style={styles.errorContainer}>
            {validationErrors.map((err, i) => (
              <Text key={i} style={styles.errorText}>• {err}</Text>
            ))}
          </View>
        )}

        {/* Start Button */}
        <TouchableOpacity
          style={[styles.startButton, isStarting && styles.startButtonDisabled]}
          onPress={handleStart}
          disabled={isStarting}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={isStarting ? ['#9ca3af', '#6b7280'] : ['#7c3aed', '#6d28d9', '#5b21b6']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.startButtonGradient}
          >
            {isStarting ? (
              <View style={styles.startButtonContent}>
                <ActivityIndicator color="#ffffff" size="small" />
                <Text style={styles.startButtonText}>  Starting...</Text>
              </View>
            ) : (
              <Text style={styles.startButtonText}>🚀 Start Progressive Tuning</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    ...(Platform.OS === 'web' && { height: '100vh', maxHeight: '100vh', overflow: 'hidden' }),
  },
  header: {
    paddingTop: 50,
    paddingBottom: 12,
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

  // Step Indicator
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  stepDotActive: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
  },
  stepLine: {
    width: 60,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    marginHorizontal: 8,
  },
  stepLineActive: {
    backgroundColor: '#ffffff',
  },
  stepLabels: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
    marginBottom: 4,
  },
  stepLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '500',
  },
  stepLabelActive: {
    color: '#ffffff',
    fontWeight: '700',
  },

  // Location Step
  locationContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  locationHint: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 12,
  },
  locationInputRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  locationInput: {
    flex: 1,
  },
  pasteButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    justifyContent: 'center',
  },
  pasteButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  locationButtonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  historyToggleButton: {
    paddingVertical: 6,
  },
  historyToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7c3aed',
  },
  clearHistoryButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  clearHistoryText: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '600',
  },
  historyDropdown: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  historyItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  historyItemText: {
    fontSize: 13,
    color: '#334155',
  },
  validationMessage: {
    fontSize: 13,
    color: '#475569',
    marginTop: 8,
    fontWeight: '500',
  },
  validationSuccess: {
    color: '#16a34a',
  },
  validationError: {
    color: '#dc2626',
  },
  validationWarning: {
    color: '#d97706',
  },
  confirmLocationButton: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  confirmLocationGradient: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmLocationText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  locationSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ede9fe',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  locationSummaryLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6d28d9',
    marginRight: 6,
  },
  locationSummaryPath: {
    fontSize: 13,
    color: '#475569',
    flex: 1,
  },

  // DXF File Picker
  dxfPickerButton: {
    backgroundColor: '#f8fafc',
    borderWidth: 2,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  dxfPickerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dxfPickerIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  dxfPickerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  reuploadButton: {
    marginTop: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  reuploadButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },

  scrollView: {
    flex: 1,
    ...(Platform.OS === 'web' && { overflow: 'auto' }),
  },
  scrollContent: {
    padding: 20,
  },

  // Section
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  sectionIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1e293b',
  },

  // Mode Toggle
  modeToggle: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    padding: 4,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  modeButtonActive: {
    backgroundColor: '#7c3aed',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  modeButtonTextActive: {
    color: '#ffffff',
  },

  // Inputs
  inputGrid: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  inputGroup: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1e293b',
  },
  dxfInputContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  nameInputContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  hintText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 6,
  },
  fieldErrorText: {
    fontSize: 12,
    color: '#dc2626',
    fontWeight: '600',
    marginTop: 4,
  },
  canvasSizeErrorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 8,
    padding: 14,
    marginTop: 8,
    marginBottom: 8,
  },
  canvasSizeErrorText: {
    fontSize: 13,
    color: '#dc2626',
    lineHeight: 20,
  },

  // Canvas & Drag-and-Drop Positioning
  canvasLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 10,
  },
  canvasContainer: {
    alignItems: 'center',
    marginBottom: 8,
  },
  canvas: {
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 12,
  },
  groundPlane: {
    backgroundColor: '#e2e8f0',
    borderWidth: 3,
    borderColor: '#94a3b8',
    borderRadius: 0,
  },
  coordinateLabels: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
    zIndex: 1,
  },
  originLabel: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    fontSize: 10,
    color: '#475569',
    fontWeight: '600',
  },
  cornerLabel: {
    position: 'absolute',
    fontSize: 10,
    color: '#475569',
    fontWeight: '600',
  },
  antenna: {
    position: 'absolute',
    backgroundColor: '#fb923c',
    borderWidth: 2,
    borderColor: '#ea580c',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    userSelect: 'none',
  },
  antennaText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  antennaSize: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '600',
    marginTop: 1,
  },
  antennaDrag: {
    color: '#ffffff',
    fontSize: 8,
    fontWeight: '500',
    marginTop: 1,
    fontStyle: 'italic',
  },
  positionDisplay: {
    backgroundColor: '#f1f5f9',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    width: '100%',
  },
  positionDisplayError: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  outsideWarningText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#dc2626',
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 19,
  },
  fineTuneRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    marginBottom: 2,
    width: '100%',
  },
  fineTuneGroup: {
    flex: 1,
    alignItems: 'center',
  },
  fineTuneLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fineTuneInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#7c3aed',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'center',
    width: '100%',
  },
  fineTuneInputError: {
    borderColor: '#ef4444',
  },
  positionText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
    marginVertical: 1,
  },
  positionHint: {
    fontSize: 11,
    color: '#64748b',
    fontStyle: 'italic',
    marginTop: 4,
  },
  coordinateSystemInfo: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
    width: '100%',
    alignItems: 'center',
  },
  coordinateSystemTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 4,
  },
  coordinateSystemText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '500',
    marginBottom: 4,
  },

  // Advanced Toggle
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  advancedToggleIcon: {
    fontSize: 12,
    color: '#7c3aed',
    marginRight: 8,
    fontWeight: '700',
  },
  advancedToggleText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
    flex: 1,
  },
  advancedHint: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  advancedContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },

  // Variable Rows
  varRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  varLabel: {
    flex: 1,
    marginRight: 8,
  },
  varName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7c3aed',
  },
  varDesc: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  varInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  varInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    width: 70,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    color: '#1e293b',
    textAlign: 'center',
  },
  varUnit: {
    fontSize: 12,
    color: '#64748b',
    marginLeft: 6,
    width: 30,
  },
  varRange: {
    fontSize: 11,
    color: '#94a3b8',
    marginLeft: 8,
    width: 80,
  },
  resetButton: {
    marginTop: 12,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  resetButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7c3aed',
  },

  // Info Card
  infoCard: {
    padding: 16,
    borderRadius: 16,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e40af',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
    marginBottom: 12,
  },
  phaseInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  phaseInfoBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  phaseInfoBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  phaseInfoContent: {
    flex: 1,
  },
  phaseInfoName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
  },
  phaseInfoTarget: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  phaseInfoVars: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  infoFooter: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#bfdbfe',
  },
  infoStat: {
    alignItems: 'center',
  },
  infoStatLabel: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 2,
  },
  infoStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e40af',
  },
  infoResultText: {
    fontSize: 13,
    color: '#1e40af',
    textAlign: 'center',
    marginTop: 12,
    fontWeight: '500',
    fontStyle: 'italic',
  },

  // Errors
  errorContainer: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: '#dc2626',
    marginBottom: 4,
  },

  // Start Button
  startButton: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  startButtonDisabled: {
    opacity: 0.7,
  },
  startButtonGradient: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },

  // Previous Runs
  runsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  runCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  runInfo: {
    flex: 1,
  },
  runName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  runDetail: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  resumeButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  resumeButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  completeTag: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  completeTagText: {
    color: '#16a34a',
    fontSize: 12,
    fontWeight: '700',
  },
  viewResultButton: {
    backgroundColor: '#0ea5e9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  viewResultButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  deleteRunButton: {
    backgroundColor: '#fef2f2',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 6,
  },
  deleteRunButtonText: {
    fontSize: 16,
  },

  // Blocked state (active session running)
  blockedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  blockedIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  blockedTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 12,
    textAlign: 'center',
  },
  blockedMessage: {
    fontSize: 15,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 12,
  },
  blockedHint: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: 24,
  },
  blockedBackButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  blockedBackButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
