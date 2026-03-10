import React, { useState, useRef, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Dimensions, Platform, Keyboard, ActivityIndicator, ScrollView } from "react-native";
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import AppConfig, { showAlert } from './app_config';

const { width } = Dimensions.get('window');

export default function GroundPlaneConfigurator({ onBack, onApply, projectPath }) {
  // Mode: 'parametric' (default) or 'import' — no separate selection screen
  const [mode, setMode] = useState('parametric');
  
  // Parametric size inputs
  const [lgx, setLgx] = useState('25');
  const [lgy, setLgy] = useState('25');
  
  // Import mode states
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [gndData, setGndData] = useState(null);
  
  // Web file input ref
  const fileInputRef = useRef(null);
  
  // Canvas ref for drawing geometry
  const canvasRef = useRef(null);
  
  // Load server URLs from centralized config
  const MATLAB_SERVER_URLS = [
    AppConfig.serverUrl,
    'http://localhost:3001'
  ];
  
  // Antenna position — CENTER of antenna in GND coordinate system
  const [antennaX, setAntennaX] = useState(12.5);
  const [antennaY, setAntennaY] = useState(12.5);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [initialAntennaPos, setInitialAntennaPos] = useState({ x: 0, y: 0 });
  
  const ANTENNA_SIZE = 25; // Fixed 25x25mm antenna
  
  // ═══════════════════════════════════════════════════════════════
  // DXF Canvas Drawing (import mode, web only)
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (Platform.OS !== 'web' || mode !== 'import' || !gndData || !gndData.geometry) return;
    if (!canvasRef.current) return;
    
    const { vertices, edges } = gndData.geometry;
    if (!Array.isArray(vertices) || vertices.length === 0 || !Array.isArray(edges) || edges.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    const scaleFactor = getScaleFactor();
    const lgxValue = parseFloat(lgx) || 50;
    const lgyValue = parseFloat(lgy) || 50;
    const canvasWidth = lgxValue * scaleFactor;
    const canvasHeight = lgyValue * scaleFactor;
    
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    const bounds = gndData.bounds;
    const geoMinX = bounds.min_x;
    const geoMinY = bounds.min_y;
    const geoHeight = bounds.height;
    
    const geoToScreen = (x, y) => {
      const normalizedX = parseFloat(x) - geoMinX;
      const normalizedY = parseFloat(y) - geoMinY;
      return {
        x: normalizedX * scaleFactor,
        y: (geoHeight - normalizedY) * scaleFactor
      };
    };
    
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Fill with even-odd rule for hole support
    if (edges.length > 0) {
      ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
      const paths = [];
      const visitedEdges = new Set();
      
      for (let i = 0; i < edges.length; i++) {
        if (visitedEdges.has(i)) continue;
        const path = [];
        let currentEdge = i;
        const startVertex = edges[currentEdge][0];
        
        while (!visitedEdges.has(currentEdge)) {
          visitedEdges.add(currentEdge);
          const [v1, v2] = edges[currentEdge];
          path.push(vertices[v1]);
          let foundNext = false;
          for (let j = 0; j < edges.length; j++) {
            if (visitedEdges.has(j)) continue;
            if (edges[j][0] === v2) { currentEdge = j; foundNext = true; break; }
          }
          if (!foundNext) break;
          if (edges[currentEdge][1] === startVertex) { visitedEdges.add(currentEdge); break; }
        }
        if (path.length > 0) paths.push(path);
      }
      
      ctx.beginPath();
      paths.forEach((path) => {
        if (path.length > 0) {
          const first = geoToScreen(path[0][0], path[0][1]);
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < path.length; i++) {
            const pt = geoToScreen(path[i][0], path[i][1]);
            ctx.lineTo(pt.x, pt.y);
          }
          ctx.closePath();
        }
      });
      ctx.fill('evenodd');
    }
    
    // Draw all edges
    edges.forEach(([startIdx, endIdx]) => {
      if (startIdx >= vertices.length || endIdx >= vertices.length) return;
      const v1 = vertices[startIdx];
      const v2 = vertices[endIdx];
      if (!v1 || !v2) return;
      const p1 = geoToScreen(v1[0], v1[1]);
      const p2 = geoToScreen(v2[0], v2[1]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });
  }, [gndData, lgx, lgy, mode]);
  
  // ═══════════════════════════════════════════════════════════════
  // Scale factor for canvas rendering
  // ═══════════════════════════════════════════════════════════════
  const getScaleFactor = () => {
    const lgxValue = parseFloat(lgx) || 50;
    const lgyValue = parseFloat(lgy) || 50;
    const maxDimension = Math.max(lgxValue, lgyValue);
    const availableWidth = width - 80;
    const availableHeight = 400;
    const minDimension = Math.min(availableWidth, availableHeight);
    return (minDimension - 40) / maxDimension;
  };
  
  // ═══════════════════════════════════════════════════════════════
  // Ray-casting point-in-polygon for custom DXF shapes
  // ═══════════════════════════════════════════════════════════════
  const isPointInsideGeometry = (px, py) => {
    if (mode !== 'import' || !gndData || !gndData.geometry) return true;
    const { vertices, edges } = gndData.geometry;
    if (!vertices || !edges || vertices.length === 0) return true;
    const bounds = gndData.bounds;
    if (!bounds) return true;
    
    const lgxValue = parseFloat(lgx) || 50;
    const lgyValue = parseFloat(lgy) || 50;
    const geoX = bounds.min_x + (px / lgxValue) * bounds.width;
    const geoY = bounds.min_y + (py / lgyValue) * bounds.height;
    
    if (geoX < bounds.min_x || geoX > bounds.max_x || geoY < bounds.min_y || geoY > bounds.max_y) return false;
    
    let crossings = 0;
    const epsilon = 1e-9;
    
    for (let i = 0; i < edges.length; i++) {
      const [startIdx, endIdx] = edges[i];
      if (startIdx >= vertices.length || endIdx >= vertices.length) continue;
      const v1 = vertices[startIdx];
      const v2 = vertices[endIdx];
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
  };
  
  // ═══════════════════════════════════════════════════════════════
  // Find valid antenna position inside custom geometry
  // ═══════════════════════════════════════════════════════════════
  const findValidAntennaPosition = () => {
    const lgxValue = parseFloat(lgx) || 50;
    const lgyValue = parseFloat(lgy) || 50;
    const halfAntenna = ANTENNA_SIZE / 2;
    
    if (mode !== 'import' || !gndData) return { x: lgxValue / 2, y: lgyValue / 2 };
    
    const centerX = lgxValue / 2, centerY = lgyValue / 2;
    const corners = [
      { x: centerX, y: centerY },
      { x: centerX - halfAntenna, y: centerY - halfAntenna },
      { x: centerX + halfAntenna, y: centerY - halfAntenna },
      { x: centerX - halfAntenna, y: centerY + halfAntenna },
      { x: centerX + halfAntenna, y: centerY + halfAntenna }
    ];
    if (corners.every(p => isPointInsideGeometry(p.x, p.y))) return { x: centerX, y: centerY };
    
    const step = 5;
    for (let y = halfAntenna + step; y < lgyValue - halfAntenna; y += step) {
      for (let x = halfAntenna + step; x < lgxValue - halfAntenna; x += step) {
        const pts = [
          { x, y },
          { x: x - halfAntenna, y: y - halfAntenna },
          { x: x + halfAntenna, y: y - halfAntenna },
          { x: x - halfAntenna, y: y + halfAntenna },
          { x: x + halfAntenna, y: y + halfAntenna }
        ];
        if (pts.every(p => isPointInsideGeometry(p.x, p.y))) return { x, y };
      }
    }
    return { x: centerX, y: centerY };
  };
  
  // ═══════════════════════════════════════════════════════════════
  // Drag handlers
  // ═══════════════════════════════════════════════════════════════
  const handleDragStart = (event) => {
    setIsDragging(true);
    const clientX = event.clientX || (event.touches && event.touches[0].clientX) || 0;
    const clientY = event.clientY || (event.touches && event.touches[0].clientY) || 0;
    setDragStartPos({ x: clientX, y: clientY });
    setInitialAntennaPos({ x: antennaX, y: antennaY });
  };
  
  // Re-validate antenna position when GND data changes
  useEffect(() => {
    if (mode === 'import' && gndData && gndData.geometry) {
      const halfAntenna = ANTENNA_SIZE / 2;
      const testPoints = [
        { x: antennaX, y: antennaY },
        { x: antennaX - halfAntenna, y: antennaY - halfAntenna },
        { x: antennaX + halfAntenna, y: antennaY - halfAntenna },
        { x: antennaX - halfAntenna, y: antennaY + halfAntenna },
        { x: antennaX + halfAntenna, y: antennaY + halfAntenna }
      ];
      if (!testPoints.every(p => isPointInsideGeometry(p.x, p.y))) {
        const validPos = findValidAntennaPosition();
        setAntennaX(validPos.x);
        setAntennaY(validPos.y);
      }
    }
  }, [mode, gndData]);
  
  const handleDragMove = (event) => {
    if (!isDragging) return;
    const clientX = event.clientX || (event.touches && event.touches[0].clientX) || 0;
    const clientY = event.clientY || (event.touches && event.touches[0].clientY) || 0;
    
    const scaleFactor = getScaleFactor();
    const lgxValue = parseFloat(lgx) || 50;
    const lgyValue = parseFloat(lgy) || 50;
    const halfAntenna = ANTENNA_SIZE / 2;
    
    let newX = initialAntennaPos.x + (clientX - dragStartPos.x) / scaleFactor;
    let newY = initialAntennaPos.y - (clientY - dragStartPos.y) / scaleFactor;
    
    // Canvas boundary constraints
    newX = Math.max(halfAntenna, Math.min(newX, lgxValue - halfAntenna));
    newY = Math.max(halfAntenna, Math.min(newY, lgyValue - halfAntenna));
    
    // Boundary sliding for custom geometry
    if (mode === 'import' && gndData) {
      const testPoints = [
        { x: newX, y: newY },
        { x: newX - halfAntenna, y: newY - halfAntenna },
        { x: newX + halfAntenna, y: newY - halfAntenna },
        { x: newX - halfAntenna, y: newY + halfAntenna },
        { x: newX + halfAntenna, y: newY + halfAntenna }
      ];
      
      if (!testPoints.every(p => isPointInsideGeometry(p.x, p.y))) {
        const xOnly = [
          { x: newX, y: antennaY },
          { x: newX - halfAntenna, y: antennaY - halfAntenna },
          { x: newX + halfAntenna, y: antennaY - halfAntenna },
          { x: newX - halfAntenna, y: antennaY + halfAntenna },
          { x: newX + halfAntenna, y: antennaY + halfAntenna }
        ];
        if (xOnly.every(p => isPointInsideGeometry(p.x, p.y))) {
          newY = antennaY;
        } else {
          const yOnly = [
            { x: antennaX, y: newY },
            { x: antennaX - halfAntenna, y: newY - halfAntenna },
            { x: antennaX + halfAntenna, y: newY - halfAntenna },
            { x: antennaX - halfAntenna, y: newY + halfAntenna },
            { x: antennaX + halfAntenna, y: newY + halfAntenna }
          ];
          if (yOnly.every(p => isPointInsideGeometry(p.x, p.y))) {
            newX = antennaX;
          } else {
            return;
          }
        }
      }
    }
    
    setAntennaX(newX);
    setAntennaY(newY);
  };
  
  const handleDragEnd = () => setIsDragging(false);
  
  // ═══════════════════════════════════════════════════════════════
  // Apply — HFSS coordinate transform
  // ═══════════════════════════════════════════════════════════════
  const handleApply = () => {
    const lgxValue = parseFloat(lgx);
    const lgyValue = parseFloat(lgy);
    
    if (isNaN(lgxValue) || lgxValue < ANTENNA_SIZE) {
      showAlert('Invalid Size', `Ground plane X must be at least ${ANTENNA_SIZE}mm`);
      return;
    }
    if (isNaN(lgyValue) || lgyValue < ANTENNA_SIZE) {
      showAlert('Invalid Size', `Ground plane Y must be at least ${ANTENNA_SIZE}mm`);
      return;
    }
    
    if (mode === 'import') {
      if (!gndData) {
        showAlert('No DXF File', 'Please upload a DXF ground plane file first.');
        return;
      }
      const bounds = gndData.bounds;
      const dxfX = bounds.min_x + (antennaX / lgxValue) * bounds.width;
      const dxfY = bounds.min_y + (antennaY / lgyValue) * bounds.height;
      const hfss_dxf_X = bounds.min_y + bounds.height - (dxfY - bounds.min_y);
      const hfss_dxf_Y = dxfX;
      
      onApply({
        mode: 'custom',
        gndId: gndData.gndId,
        file: gndData.file,
        bounds: gndData.bounds,
        GND_xPos: hfss_dxf_X,
        GND_yPos: hfss_dxf_Y
      });
    } else {
      const hfss_X = lgyValue - antennaY;
      const hfss_Y = antennaX;
      
      onApply({
        mode: 'parametric',
        Lgx: lgxValue,
        Lgy: lgyValue,
        GND_xPos: hfss_X,
        GND_yPos: hfss_Y
      });
    }
  };
  
  // ═══════════════════════════════════════════════════════════════
  // File Upload — Web
  // ═══════════════════════════════════════════════════════════════
  const pickAndUploadFileWeb = async (event) => {
    try {
      const file = event.target.files[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith('.dxf')) {
        showAlert('Invalid File Format', 'Please select a DXF file.');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      
      setUploadedFile({ name: file.name, size: file.size });
      setIsUploading(true);

      const formData = new FormData();
      formData.append('gndFile', file);
      formData.append('projectPath', projectPath);

      let uploadSuccess = false;
      let response;
      let lastError = null;

      for (const serverUrl of MATLAB_SERVER_URLS) {
        try {
          response = await fetch(`${serverUrl}/api/gnd/upload`, {
            method: 'POST',
            body: formData,
            headers: { 'Accept': 'application/json' }
          });
          if (response.ok) { uploadSuccess = true; break; }
          else {
            const errorText = await response.text();
            lastError = new Error(`Server error: ${response.status} - ${errorText}`);
          }
        } catch (err) { lastError = err; }
      }

      if (!uploadSuccess) throw lastError || new Error('Failed to upload to any server');

      const data = await response.json();
      
      if (data.success) {
        if (data.validation && data.validation.errors && data.validation.errors.length > 0) {
          showAlert('❌ Invalid Ground Plane Design',
            data.validation.errors.join('\n') + '\n\nThe antenna is 25mm × 25mm and must fit entirely within the ground plane.');
          if (fileInputRef.current) fileInputRef.current.value = '';
          setIsUploading(false);
          return;
        }
        
        setGndData(data);
        setLgx(data.bounds.width.toFixed(1));
        setLgy(data.bounds.height.toFixed(1));
        setAntennaX(data.bounds.width / 2);
        setAntennaY(data.bounds.height / 2);
        
        showAlert('✅ GND Imported',
          `Format: ${data.file.format}\nVertices: ${data.vertex_count || 0}\nSize: ${data.bounds.width.toFixed(2)} × ${data.bounds.height.toFixed(2)} mm\n\nPosition your antenna on the canvas below.`);
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (error) {
      showAlert('Upload Failed', error.message + '\n\nCheck server is running on port 3001.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // File Upload — Mobile
  // ═══════════════════════════════════════════════════════════════
  const pickAndUploadFileMobile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['*/*'], copyToCacheDirectory: true });
      if (result.canceled) return;

      const file = result.assets[0];
      if (!file.name.toLowerCase().endsWith('.dxf')) {
        showAlert('Invalid File Format', 'Please select a DXF file.');
        return;
      }
      
      setUploadedFile(file);
      setIsUploading(true);

      const formData = new FormData();
      formData.append('gndFile', {
        uri: file.uri,
        type: file.mimeType || 'application/octet-stream',
        name: file.name
      });
      formData.append('projectPath', projectPath);

      let uploadSuccess = false;
      let response;
      let lastError = null;

      for (const serverUrl of MATLAB_SERVER_URLS) {
        try {
          response = await fetch(`${serverUrl}/api/gnd/upload`, {
            method: 'POST',
            body: formData,
            headers: { 'Accept': 'application/json' }
          });
          if (response.ok) { uploadSuccess = true; break; }
          else {
            const errorText = await response.text();
            lastError = new Error(`Server error: ${response.status} - ${errorText}`);
          }
        } catch (err) { lastError = err; }
      }

      if (!uploadSuccess) throw lastError || new Error('Failed to upload to any server');

      const data = await response.json();
      
      if (data.success) {
        if (data.validation && data.validation.errors && data.validation.errors.length > 0) {
          showAlert('❌ Invalid Ground Plane Design',
            data.validation.errors.join('\n') + '\n\nThe antenna is 25mm × 25mm and must fit entirely within the ground plane.');
          setIsUploading(false);
          return;
        }
        
        setGndData(data);
        setLgx(data.bounds.width.toFixed(1));
        setLgy(data.bounds.height.toFixed(1));
        setAntennaX(data.bounds.width / 2);
        setAntennaY(data.bounds.height / 2);
        
        showAlert('✅ GND Imported',
          `Format: ${data.file.format}\nVertices: ${data.vertex_count || 0}\nSize: ${data.bounds.width.toFixed(2)} × ${data.bounds.height.toFixed(2)} mm\n\nPosition your antenna on the canvas below.`);
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (error) {
      showAlert('Upload Failed', error.message + '\n\nCheck server is running.');
    } finally {
      setIsUploading(false);
    }
  };

  const pickAndUploadFile = () => {
    if (Platform.OS === 'web') fileInputRef.current?.click();
    else pickAndUploadFileMobile();
  };
  
  // ═══════════════════════════════════════════════════════════════
  // Validate GND
  // ═══════════════════════════════════════════════════════════════
  const validateGND = async () => {
    if (!gndData || !gndData.gndId) {
      showAlert('Error', 'No GND file uploaded');
      return;
    }
    try {
      setIsUploading(true);
      for (const serverUrl of MATLAB_SERVER_URLS) {
        try {
          const response = await fetch(`${serverUrl}/api/gnd/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gndId: gndData.gndId })
          });
          if (response.ok) {
            const vd = await response.json();
            let msg = vd.valid ? '✅ Geometry is valid!\n\n' : '❌ Geometry has errors:\n\n';
            if (vd.errors?.length > 0) msg += 'Errors:\n' + vd.errors.join('\n') + '\n\n';
            if (vd.warnings?.length > 0) msg += 'Warnings:\n' + vd.warnings.join('\n') + '\n\n';
            if (vd.suggestions?.length > 0) msg += 'Suggestions:\n' + vd.suggestions.join('\n');
            showAlert('Validation Result', msg);
            return;
          }
        } catch (err) { /* try next server */ }
      }
      throw new Error('Failed to validate on any server');
    } catch (error) {
      showAlert('Validation Failed', error.message);
    } finally {
      setIsUploading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // Mode switch handler
  // ═══════════════════════════════════════════════════════════════
  const handleModeSwitch = (newMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    if (newMode === 'parametric') {
      setLgx('25');
      setLgy('25');
      setAntennaX(12.5);
      setAntennaY(12.5);
      setGndData(null);
      setUploadedFile(null);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // Inline positioning canvas (shared by both modes)
  // ═══════════════════════════════════════════════════════════════
  const renderCanvas = () => {
    const scaleFactor = getScaleFactor();
    const lgxValue = parseFloat(lgx) || 50;
    const lgyValue = parseFloat(lgy) || 50;
    
    if (lgxValue < ANTENNA_SIZE || lgyValue < ANTENNA_SIZE) return null;

    const canvasWidth = lgxValue * scaleFactor;
    const canvasHeight = lgyValue * scaleFactor;
    const antennaDisplaySize = ANTENNA_SIZE * scaleFactor;
    
    const halfAntenna = ANTENNA_SIZE / 2;
    const antennaCornerX = antennaX - halfAntenna;
    const antennaCornerY = antennaY - halfAntenna;
    const screenX = antennaCornerX * scaleFactor;
    const screenY = (lgyValue - antennaCornerY - ANTENNA_SIZE) * scaleFactor;
    
    const geoToScreen = (x, y) => ({
      x: x * scaleFactor,
      y: (lgyValue - y) * scaleFactor
    });
    
    const renderGeometry = () => {
      if (mode !== 'import' || !gndData || !gndData.geometry) return null;
      const { vertices, edges } = gndData.geometry;
      if (!vertices?.length || !edges?.length) return null;
      
      if (Platform.OS === 'web') {
        return (
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%',
              pointerEvents: 'none', zIndex: 5,
            }}
          />
        );
      } else {
        return edges.map(([start, end], idx) => {
          if (!vertices[start] || !vertices[end]) return null;
          const v1 = vertices[start], v2 = vertices[end];
          const p1 = geoToScreen(v1[0], v1[1]);
          const p2 = geoToScreen(v2[0], v2[1]);
          const dx = p2.x - p1.x, dy = p2.y - p1.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          return (
            <View key={`edge-${idx}`} style={{
              position: 'absolute', left: p1.x, top: p1.y,
              width: length, height: 3, backgroundColor: '#2563eb',
              transform: [{ rotate: `${angle}deg` }], transformOrigin: '0 0', zIndex: 2,
            }} />
          );
        }).filter(Boolean);
      }
    };

    return (
      <View>
        <Text style={styles.canvasLabel}>
          Drag the antenna to position it on the ground plane:
        </Text>
        
        {mode === 'import' && gndData && (
          <View style={styles.importedGNDInfo}>
            <Text style={styles.importedGNDLabel}>Custom GND Design:</Text>
            <Text style={styles.importedGNDText}>
              {gndData.file.originalName} • {gndData.bounds.width.toFixed(1)} × {gndData.bounds.height.toFixed(1)} mm • {gndData.vertex_count || 0} vertices, {gndData.edge_count || 0} edges
            </Text>
          </View>
        )}
        
        <View style={styles.canvasContainer}>
          <View 
            style={[styles.canvas, { 
              width: canvasWidth, height: canvasHeight,
              position: 'relative', overflow: 'visible',
            }]}
            onMouseMove={Platform.OS === 'web' ? handleDragMove : undefined}
            onMouseUp={Platform.OS === 'web' ? handleDragEnd : undefined}
            onMouseLeave={Platform.OS === 'web' ? handleDragEnd : undefined}
          >
            <View style={[styles.groundPlane, { 
              width: canvasWidth, height: canvasHeight,
              backgroundColor: mode === 'import' ? '#f0f9ff' : '#e2e8f0',
              borderColor: mode === 'import' ? 'transparent' : '#94a3b8',
              borderWidth: mode === 'parametric' ? 3 : 0,
              position: 'absolute', top: 0, left: 0, zIndex: 0,
            }]} />
            
            {mode === 'parametric' && Platform.OS === 'web' && (
              <View style={{
                position: 'absolute', top: 0, left: 0,
                width: canvasWidth, height: canvasHeight,
                borderWidth: 3, borderColor: '#94a3b8', borderStyle: 'solid', zIndex: 1,
              }} />
            )}
            
            {mode === 'import' && renderGeometry()}
            
            <View style={styles.coordinateLabels}>
              <Text style={styles.originLabel}>(0,0)</Text>
              <Text style={[styles.cornerLabel, { bottom: 5, left: canvasWidth - 55 }]}>({lgxValue},0)</Text>
              <Text style={[styles.cornerLabel, { top: 5, left: 5 }]}>(0,{lgyValue})</Text>
              <Text style={[styles.cornerLabel, { top: 5, left: canvasWidth - 75 }]}>({lgxValue},{lgyValue})</Text>
            </View>
            
            <View
              style={[styles.antenna, {
                width: antennaDisplaySize, height: antennaDisplaySize,
                left: screenX, top: screenY,
                cursor: isDragging ? 'grabbing' : 'grab', zIndex: 10,
              }]}
              onMouseDown={Platform.OS === 'web' ? handleDragStart : undefined}
              onTouchStart={handleDragStart}
              onTouchMove={handleDragMove}
              onTouchEnd={handleDragEnd}
            >
              <Text style={styles.antennaText}>Antenna</Text>
              <Text style={styles.antennaSize}>{ANTENNA_SIZE}×{ANTENNA_SIZE}mm</Text>
              <Text style={styles.antennaDrag}>Drag me!</Text>
            </View>
          </View>
          
          <View style={styles.positionDisplay}>
            <Text style={styles.positionText}>
              Ground Plane: {lgxValue} × {lgyValue} mm
            </Text>
            {mode === 'import' && gndData ? (
              <>
                <Text style={styles.positionText}>
                  Canvas: ({antennaX.toFixed(1)}, {antennaY.toFixed(1)}) mm
                </Text>
                <Text style={styles.positionText}>
                  DXF: ({(gndData.bounds.min_x + (antennaX / lgxValue) * gndData.bounds.width).toFixed(1)}, {(gndData.bounds.min_y + (antennaY / lgyValue) * gndData.bounds.height).toFixed(1)}) mm
                </Text>
                <Text style={styles.positionHint}>(DXF coordinates used in MATLAB/HFSS)</Text>
              </>
            ) : (
              <>
                <Text style={styles.positionText}>
                  GND_xPos: {antennaX.toFixed(1)}mm, GND_yPos: {antennaY.toFixed(1)}mm
                </Text>
                <Text style={styles.positionHint}>(Center of antenna in ground plane coordinates)</Text>
              </>
            )}
            <View style={styles.coordinateSystemInfo}>
              <Text style={styles.coordinateSystemTitle}>HFSS Coordinate System:</Text>
              <Text style={styles.coordinateSystemText}>
                Top = -X | Bottom = +X | Left = -Y | Right = +Y
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  };
  
  // ═══════════════════════════════════════════════════════════════
  // Main Render — Single scrollable page
  // ═══════════════════════════════════════════════════════════════
  return (
    <View style={styles.container}>
      {/* Hidden file input for web */}
      {Platform.OS === 'web' && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".dxf"
          style={{ display: 'none' }}
          onChange={pickAndUploadFileWeb}
        />
      )}
      
      {/* Header */}
      <LinearGradient
        colors={['#6366f1', '#8b5cf6', '#a855f7']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.title}>🏗️ Ground Plane Configurator</Text>
          <Text style={styles.subtitle}>Configure ground plane and antenna position</Text>
        </View>
      </LinearGradient>
      
      {/* Content */}
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        
        {/* Mode Toggle Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>📡</Text>
            <Text style={styles.sectionTitle}>Ground Plane Type</Text>
          </View>
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeButton, mode === 'parametric' && styles.modeButtonActive]}
              onPress={() => handleModeSwitch('parametric')}
            >
              <Text style={[styles.modeButtonText, mode === 'parametric' && styles.modeButtonTextActive]}>
                📐 Parametric Rectangle
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeButton, mode === 'import' && styles.modeButtonActive]}
              onPress={() => handleModeSwitch('import')}
            >
              <Text style={[styles.modeButtonText, mode === 'import' && styles.modeButtonTextActive]}>
                📂 Import Custom DXF
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        
        {/* ─── Parametric Mode ─── */}
        {mode === 'parametric' && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>📏</Text>
              <Text style={styles.sectionTitle}>Dimensions & Position</Text>
            </View>
            <View style={styles.sectionBody}>
              <View style={styles.inputRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Lgx - Width (mm)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={lgx}
                    onChangeText={(val) => {
                      setLgx(val);
                      const v = parseFloat(val);
                      if (!isNaN(v) && v >= ANTENNA_SIZE) {
                        setAntennaX(Math.min(antennaX, v - ANTENNA_SIZE / 2));
                      }
                    }}
                    keyboardType="numeric"
                    placeholder="50"
                    maxLength={6}
                    onSubmitEditing={() => Keyboard.dismiss()}
                    returnKeyType="done"
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Lgy - Height (mm)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={lgy}
                    onChangeText={(val) => {
                      setLgy(val);
                      const v = parseFloat(val);
                      if (!isNaN(v) && v >= ANTENNA_SIZE) {
                        setAntennaY(Math.min(antennaY, v - ANTENNA_SIZE / 2));
                      }
                    }}
                    keyboardType="numeric"
                    placeholder="50"
                    maxLength={6}
                    onSubmitEditing={() => Keyboard.dismiss()}
                    returnKeyType="done"
                  />
                </View>
              </View>
              {renderCanvas()}
            </View>
          </View>
        )}
        
        {/* ─── Import Mode ─── */}
        {mode === 'import' && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>📂</Text>
              <Text style={styles.sectionTitle}>DXF File & Position</Text>
            </View>
            <View style={styles.sectionBody}>
              <Text style={styles.inputLabel}>Custom DXF Ground Plane</Text>
              <TouchableOpacity
                style={styles.dxfPickerButton}
                onPress={pickAndUploadFile}
                disabled={isUploading}
              >
                {isUploading ? (
                  <View style={styles.dxfPickerContent}>
                    <ActivityIndicator color="#7c3aed" size="small" />
                    <Text style={styles.dxfPickerText}>  Uploading...</Text>
                  </View>
                ) : (
                  <View style={styles.dxfPickerContent}>
                    <Text style={styles.dxfPickerIcon}>📂</Text>
                    <Text style={styles.dxfPickerText}>
                      {uploadedFile ? uploadedFile.name : 'Browse for DXF file...'}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
              
              {uploadedFile && gndData ? (
                <View>
                  <Text style={[styles.hintText, { color: '#16a34a' }]}>
                    ✅ {gndData.file.originalName} • {gndData.bounds.width.toFixed(1)} × {gndData.bounds.height.toFixed(1)} mm • {gndData.vertex_count || 0} vertices
                  </Text>
                  <View style={styles.importActionsRow}>
                    <TouchableOpacity style={styles.validateButtonSmall} onPress={validateGND}>
                      <Text style={styles.validateButtonSmallText}>🔍 Validate</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.reuploadButtonSmall} onPress={pickAndUploadFile}>
                      <Text style={styles.reuploadButtonSmallText}>🔄 Re-upload</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ marginTop: 16 }}>
                    {renderCanvas()}
                  </View>
                </View>
              ) : (
                <Text style={styles.hintText}>
                  Select a .dxf ground plane file to upload and position the antenna
                </Text>
              )}
            </View>
          </View>
        )}
        
        {/* Apply Button */}
        <TouchableOpacity onPress={handleApply} style={styles.applyButton} activeOpacity={0.8}>
          <LinearGradient
            colors={['#8b5cf6', '#7c3aed']}
            style={styles.applyGradient}
          >
            <Text style={styles.applyText}>✓ Apply Configuration</Text>
          </LinearGradient>
        </TouchableOpacity>
        
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  // Layout
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  content: { flex: 1 },
  contentContainer: { padding: 16, paddingBottom: 40 },

  // Header
  header: { paddingTop: 20, paddingBottom: 20, paddingHorizontal: 20 },
  backButton: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, alignSelf: 'flex-start', marginBottom: 12, marginTop: 10 },
  backButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  headerContent: { alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.9)' },

  // Sections
  section: { backgroundColor: '#fff', borderRadius: 14, marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 3, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 8 },
  sectionIcon: { fontSize: 20, marginRight: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#1e293b' },
  sectionBody: { paddingHorizontal: 16, paddingBottom: 16 },

  // Mode Toggle
  modeToggle: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 16, borderRadius: 10, backgroundColor: '#f1f5f9', padding: 4 },
  modeButton: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  modeButtonActive: { backgroundColor: '#7c3aed', shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
  modeButtonText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  modeButtonTextActive: { color: '#fff' },

  // Inputs
  inputRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  inputGroup: { flex: 1 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6 },
  textInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#1e293b' },

  // DXF File Picker
  dxfPickerButton: { backgroundColor: '#f8fafc', borderWidth: 2, borderColor: '#e2e8f0', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 6, borderStyle: 'dashed' },
  dxfPickerContent: { flexDirection: 'row', alignItems: 'center' },
  dxfPickerIcon: { fontSize: 18, marginRight: 8 },
  dxfPickerText: { fontSize: 14, color: '#64748b', fontWeight: '500' },
  hintText: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  importActionsRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  validateButtonSmall: { flex: 1, backgroundColor: '#f0f9ff', borderWidth: 1, borderColor: '#38bdf8', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  validateButtonSmallText: { fontSize: 13, fontWeight: '600', color: '#0369a1' },
  reuploadButtonSmall: { flex: 1, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  reuploadButtonSmallText: { fontSize: 13, fontWeight: '600', color: '#64748b' },

  // Imported GND info
  importedGNDInfo: { backgroundColor: '#dbeafe', borderWidth: 1, borderColor: '#93c5fd', borderRadius: 8, padding: 10, marginBottom: 12 },
  importedGNDLabel: { fontSize: 12, fontWeight: '700', color: '#1e40af', marginBottom: 2 },
  importedGNDText: { fontSize: 13, fontWeight: '600', color: '#1e3a8a' },

  // Canvas & Positioning
  canvasLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 10 },
  canvasContainer: { alignItems: 'center', marginBottom: 8 },
  canvas: { borderRadius: 6, overflow: 'hidden', marginBottom: 12 },
  groundPlane: { backgroundColor: '#e2e8f0', borderRadius: 0 },
  coordinateLabels: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 1 },
  originLabel: { position: 'absolute', bottom: 5, left: 5, fontSize: 10, color: '#475569', fontWeight: '600' },
  cornerLabel: { position: 'absolute', fontSize: 10, color: '#475569', fontWeight: '600' },
  antenna: { position: 'absolute', backgroundColor: '#fb923c', borderWidth: 2, borderColor: '#ea580c', borderRadius: 4, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 5, userSelect: 'none' },
  antennaText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  antennaSize: { color: '#fff', fontSize: 10, fontWeight: '600', marginTop: 2 },
  antennaDrag: { color: '#fff', fontSize: 9, fontWeight: '500', marginTop: 2, fontStyle: 'italic' },

  // Position readout
  positionDisplay: { backgroundColor: '#f1f5f9', padding: 12, borderRadius: 8, alignItems: 'center' },
  positionText: { fontSize: 13, color: '#475569', fontWeight: '600', marginVertical: 2 },
  positionHint: { fontSize: 11, color: '#64748b', fontStyle: 'italic', marginTop: 4 },
  coordinateSystemInfo: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#cbd5e1', width: '100%' },
  coordinateSystemTitle: { fontSize: 12, fontWeight: '700', color: '#1e293b', marginBottom: 4, textAlign: 'center' },
  coordinateSystemText: { fontSize: 11, color: '#475569', textAlign: 'center' },

  // Apply Button
  applyButton: { borderRadius: 12, overflow: 'hidden', marginTop: 4, shadowColor: '#8b5cf6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  applyGradient: { paddingVertical: 16, alignItems: 'center' },
  applyText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
