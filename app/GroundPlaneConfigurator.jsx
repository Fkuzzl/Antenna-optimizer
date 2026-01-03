import React, { useState, useRef, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Dimensions, Platform, Alert, Keyboard, ActivityIndicator, ScrollView } from "react-native";
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import AppConfig from './app_config';

const { width } = Dimensions.get('window');

export default function GroundPlaneConfigurator({ onBack, onApply, projectPath }) {
  // Step 0: Choose mode (parametric or import)
  const [mode, setMode] = useState(null); // null = choose mode, 'parametric' = size input, 'import' = import custom GND
  
  // Step 1: Size input (parametric mode)
  const [step, setStep] = useState(1); // 1 = size input, 2 = position adjustment
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
  
  // Step 2: Position adjustment - track dragging state
  // Note: antennaX/antennaY represent the CENTER of the antenna, not the corner
  const [antennaX, setAntennaX] = useState(12.5); // GND_xPos in mm (center of antenna)
  const [antennaY, setAntennaY] = useState(12.5); // GND_yPos in mm (center of antenna)
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [initialAntennaPos, setInitialAntennaPos] = useState({ x: 0, y: 0 });
  
  const ANTENNA_SIZE = 25; // Fixed 25x25mm antenna
  
  // Draw CUSTOM DXF geometry on canvas (import mode only)
  useEffect(() => {
    console.log('🔄 Canvas useEffect triggered:', {
      platform: Platform.OS,
      hasCanvasRef: !!canvasRef.current,
      mode,
      step,
      hasGndData: !!gndData,
      hasGeometry: !!(gndData?.geometry)
    });
    
    // Only for web platform with import mode
    if (Platform.OS !== 'web' || mode !== 'import' || step !== 2) {
      return;
    }
    
    if (!canvasRef.current) {
      console.warn('⚠️ Canvas ref not available yet');
      return;
    }
    
    if (!gndData || !gndData.geometry) {
      console.warn('⚠️ No geometry data available');
      return;
    }
    
    const { vertices, edges } = gndData.geometry;
    
    // Validate geometry structure
    if (!Array.isArray(vertices) || vertices.length === 0) {
      console.error('❌ Invalid vertices:', vertices);
      return;
    }
    
    if (!Array.isArray(edges) || edges.length === 0) {
      console.error('❌ Invalid edges:', edges);
      return;
    }
    
    console.log('📦 Geometry data:', {
      vertexCount: vertices.length,
      edgeCount: edges.length,
      sampleVertex: vertices[0],
      sampleEdge: edges[0]
    });
    
    // Get canvas and context
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Calculate canvas dimensions based on GND size
    const scaleFactor = getScaleFactor();
    const lgxValue = parseFloat(lgx) || 50;
    const lgyValue = parseFloat(lgy) || 50;
    const canvasWidth = lgxValue * scaleFactor;
    const canvasHeight = lgyValue * scaleFactor;
    
    // Set canvas size
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    
    console.log(`🖼️  Canvas: ${canvasWidth.toFixed(0)}×${canvasHeight.toFixed(0)}px, Scale: ${scaleFactor.toFixed(2)}`);
    
    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // Use bounds from backend (already calculated correctly)
    const bounds = gndData.bounds;
    const geoMinX = bounds.min_x;
    const geoMaxX = bounds.max_x;
    const geoMinY = bounds.min_y;
    const geoMaxY = bounds.max_y;
    const geoWidth = bounds.width;
    const geoHeight = bounds.height;
    
    console.log(`📐 Geometry bounds: (${geoMinX.toFixed(1)}, ${geoMinY.toFixed(1)}) to (${geoMaxX.toFixed(1)}, ${geoMaxY.toFixed(1)})`);
    console.log(`📏 Geometry size: ${geoWidth.toFixed(1)} × ${geoHeight.toFixed(1)} mm`);
    console.log(`📏 Canvas size from lgx/lgy: ${lgxValue.toFixed(1)} × ${lgyValue.toFixed(1)} mm`);
    
    // NO centering offset - render geometry at its actual coordinates
    // The lgx/lgy values are set from bounds.width/height, so geometry fills the canvas naturally
    
    // Helper function to convert geometry coordinates to screen coordinates
    const geoToScreen = (x, y) => {
      const gx = parseFloat(x);
      const gy = parseFloat(y);
      // Translate geometry so min corner is at origin
      const normalizedX = gx - geoMinX;
      const normalizedY = gy - geoMinY;
      const screenX = normalizedX * scaleFactor;
      // Flip Y-axis: DXF Y-up (cartesian) → Screen Y-down
      const screenY = (geoHeight - normalizedY) * scaleFactor;
      return { x: screenX, y: screenY };
    };
    
    // Set drawing style
    ctx.strokeStyle = '#2563eb'; // Blue color
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // FIRST: Draw semi-transparent fill to show valid antenna placement area
    // Use edge-based rendering to properly handle holes
    if (edges.length > 0) {
      ctx.fillStyle = 'rgba(37, 99, 235, 0.08)'; // Light blue transparent fill
      
      // Group edges into continuous paths (separate outer boundary from holes)
      const paths = [];
      const visitedEdges = new Set();
      
      for (let i = 0; i < edges.length; i++) {
        if (visitedEdges.has(i)) continue;
        
        const path = [];
        let currentEdge = i;
        const startVertex = edges[currentEdge][0];
        
        // Follow edges to form a closed path
        while (!visitedEdges.has(currentEdge)) {
          visitedEdges.add(currentEdge);
          const [v1, v2] = edges[currentEdge];
          path.push(vertices[v1]);
          
          // Find next connected edge
          let foundNext = false;
          for (let j = 0; j < edges.length; j++) {
            if (visitedEdges.has(j)) continue;
            if (edges[j][0] === v2) {
              currentEdge = j;
              foundNext = true;
              break;
            }
          }
          
          if (!foundNext) break;
          // Stop if we've returned to start
          if (edges[currentEdge][1] === startVertex) {
            visitedEdges.add(currentEdge);
            break;
          }
        }
        
        if (path.length > 0) {
          paths.push(path);
        }
      }
      
      console.log(`🎨 Found ${paths.length} boundary path(s)`);
      
      // Draw all paths with even-odd fill rule (handles holes automatically)
      ctx.beginPath();
      paths.forEach((path, pathIdx) => {
        if (path.length > 0) {
          const firstPoint = geoToScreen(path[0][0], path[0][1]);
          ctx.moveTo(firstPoint.x, firstPoint.y);
          
          for (let i = 1; i < path.length; i++) {
            const point = geoToScreen(path[i][0], path[i][1]);
            ctx.lineTo(point.x, point.y);
          }
          ctx.closePath();
          console.log(`  Path ${pathIdx}: ${path.length} vertices`);
        }
      });
      
      // Use 'evenodd' fill rule to properly render holes
      ctx.fill('evenodd');
      console.log('🎨 Drew boundary fill with hole support (even-odd rule)');
    }
    
    // SECOND: Draw all edges on top of fill
    let drawnCount = 0;
    let outOfBoundsCount = 0;
    
    edges.forEach(([startIdx, endIdx], edgeIdx) => {
      if (startIdx >= vertices.length || endIdx >= vertices.length) {
        console.warn(`⚠️ Edge ${edgeIdx} has invalid indices: [${startIdx}, ${endIdx}]`);
        return;
      }
      
      const v1 = vertices[startIdx];
      const v2 = vertices[endIdx];
      
      if (!v1 || !v2) {
        console.warn(`⚠️ Edge ${edgeIdx} has missing vertices`);
        return;
      }
      
      const p1 = geoToScreen(v1[0], v1[1]);
      const p2 = geoToScreen(v2[0], v2[1]);
      
      // Debug first 3 edges
      if (edgeIdx < 3) {
        console.log(`  Edge ${edgeIdx}: [${startIdx}→${endIdx}] DXF(${v1[0]},${v1[1]})→(${v2[0]},${v2[1]}) Screen(${p1.x.toFixed(1)},${p1.y.toFixed(1)})→(${p2.x.toFixed(1)},${p2.y.toFixed(1)})`);
      }
      
      // Check if edge is within canvas bounds
      const inBounds = (
        p1.x >= -10 && p1.x <= canvasWidth + 10 &&
        p1.y >= -10 && p1.y <= canvasHeight + 10 &&
        p2.x >= -10 && p2.x <= canvasWidth + 10 &&
        p2.y >= -10 && p2.y <= canvasHeight + 10
      );
      
      if (!inBounds) {
        outOfBoundsCount++;
        if (edgeIdx < 3) {
          console.warn(`    ⚠️ Edge ${edgeIdx} is outside canvas (0,0)-(${canvasWidth},${canvasHeight})`);
        }
      }
      
      // Draw the edge
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      drawnCount++;
    });
    
    console.log(`✅ Drawing complete: ${drawnCount} edges drawn, ${outOfBoundsCount} out of bounds`);
    
    // Draw test marker to verify canvas is working
    ctx.fillStyle = 'red';
    ctx.fillRect(5, 5, 10, 10);
    console.log('🔴 Test marker drawn at (5,5)');
    
  }, [gndData, step, lgx, lgy, mode]);
  
  // Convert mm to pixels for display (scale factor)
  const getScaleFactor = () => {
    const lgxValue = parseFloat(lgx) || 50;
    const lgyValue = parseFloat(lgy) || 50;
    const maxDimension = Math.max(lgxValue, lgyValue);
    const availableWidth = width - 80; // Leave margins
    const availableHeight = 400; // Fixed height for canvas
    const minDimension = Math.min(availableWidth, availableHeight);
    return (minDimension - 40) / maxDimension; // Leave padding
  };
  
  // Check if a point is inside the custom geometry polygon
  const isPointInsideGeometry = (px, py) => {
    if (mode !== 'import' || !gndData || !gndData.geometry) {
      return true; // For parametric mode, no custom boundary check
    }

    const { vertices, edges } = gndData.geometry;
    if (!vertices || !edges || vertices.length === 0) {
      return true;
    }

    // Use bounds directly from backend (no offset needed)
    const bounds = gndData.bounds;
    if (!bounds) {
      return true;
    }
    
    // Convert canvas coordinates (0 to lgx/lgy) to geometry coordinates (min_x to max_x, min_y to max_y)
    // Canvas: (0,0) to (lgx, lgy) maps to Geometry: (min_x, min_y) to (max_x, max_y)
    const lgxValue = parseFloat(lgx) || 50;
    const lgyValue = parseFloat(lgy) || 50;
    const geoX = bounds.min_x + (px / lgxValue) * bounds.width;
    const geoY = bounds.min_y + (py / lgyValue) * bounds.height;
    
    // Quick bounding box check first
    if (geoX < bounds.min_x || geoX > bounds.max_x || geoY < bounds.min_y || geoY > bounds.max_y) {
      return false;
    }
    
    // Ray casting algorithm - cast ray from point to infinity and count intersections
    // If odd number of intersections, point is inside
    // Using even-odd rule to properly handle complex shapes with holes
    let crossings = 0;
    const epsilon = 1e-9;
    
    // Test against each edge using geometry coordinates
    for (let i = 0; i < edges.length; i++) {
      const [startIdx, endIdx] = edges[i];
      
      if (startIdx >= vertices.length || endIdx >= vertices.length) {
        continue;
      }
      
      const v1 = vertices[startIdx];
      const v2 = vertices[endIdx];
      
      if (!v1 || !v2) continue;
      
      const x1 = parseFloat(v1[0]);
      const y1 = parseFloat(v1[1]);
      const x2 = parseFloat(v2[0]);
      const y2 = parseFloat(v2[1]);
      
      // Skip horizontal edges
      if (Math.abs(y1 - y2) < epsilon) continue;
      
      // Ray casting: horizontal ray from (geoX, geoY) to the right (+X direction)
      // Check if ray intersects edge (v1, v2)
      if ((y1 > geoY) !== (y2 > geoY)) {
        // Edge crosses the horizontal line at geoY
        const intersectX = x1 + (x2 - x1) * (geoY - y1) / (y2 - y1);
        
        // If intersection is to the right of point, count it
        if (geoX < intersectX + epsilon) {
          crossings++;
        }
      }
    }
    
    // Odd number of crossings = inside
    return (crossings % 2) === 1;
  };
  
  // Find a valid position for the antenna inside the geometry
  const findValidAntennaPosition = () => {
    if (mode !== 'import' || !gndData) {
      const lgxValue = parseFloat(lgx) || 50;
      const lgyValue = parseFloat(lgy) || 50;
      return { x: lgxValue / 2, y: lgyValue / 2 };
    }
    
    const lgxValue = parseFloat(lgx) || 50;
    const lgyValue = parseFloat(lgy) || 50;
    const halfAntenna = ANTENNA_SIZE / 2;
    
    // Try center first
    const centerX = lgxValue / 2;
    const centerY = lgyValue / 2;
    
    const centerPoints = [
      { x: centerX, y: centerY },
      { x: centerX - halfAntenna, y: centerY - halfAntenna },
      { x: centerX + halfAntenna, y: centerY - halfAntenna },
      { x: centerX - halfAntenna, y: centerY + halfAntenna },
      { x: centerX + halfAntenna, y: centerY + halfAntenna }
    ];
    
    if (centerPoints.every(p => isPointInsideGeometry(p.x, p.y))) {
      console.log('✅ Center position is valid');
      return { x: centerX, y: centerY };
    }
    
    console.log('⚠️ Center position invalid, searching for valid position...');
    
    // Search grid for valid position
    const step = 5; // 5mm steps
    for (let y = halfAntenna + step; y < lgyValue - halfAntenna; y += step) {
      for (let x = halfAntenna + step; x < lgxValue - halfAntenna; x += step) {
        const testPoints = [
          { x: x, y: y },
          { x: x - halfAntenna, y: y - halfAntenna },
          { x: x + halfAntenna, y: y - halfAntenna },
          { x: x - halfAntenna, y: y + halfAntenna },
          { x: x + halfAntenna, y: y + halfAntenna }
        ];
        
        if (testPoints.every(p => isPointInsideGeometry(p.x, p.y))) {
          console.log(`✅ Found valid position at (${x.toFixed(1)}, ${y.toFixed(1)})`);
          return { x, y };
        }
      }
    }
    
    // Fallback to center if no valid position found
    console.warn('⚠️ No valid position found, using center as fallback');
    return { x: centerX, y: centerY };
  };
  
  // Handle mouse/touch events for dragging
  const handleDragStart = (event) => {
    setIsDragging(true);
    const clientX = event.clientX || (event.touches && event.touches[0].clientX) || 0;
    const clientY = event.clientY || (event.touches && event.touches[0].clientY) || 0;
    setDragStartPos({ x: clientX, y: clientY });
    setInitialAntennaPos({ x: antennaX, y: antennaY });
  };
  
  // Validate and reposition antenna when entering Step 2 if current position is invalid
  useEffect(() => {
    if (step === 2 && mode === 'import' && gndData && gndData.geometry) {
      const halfAntenna = ANTENNA_SIZE / 2;
      
      console.log(`🔍 Validating antenna position (${antennaX.toFixed(1)}, ${antennaY.toFixed(1)}) for imported geometry`);
      
      // Check if current antenna position is valid
      const testPoints = [
        { x: antennaX, y: antennaY },
        { x: antennaX - halfAntenna, y: antennaY - halfAntenna },
        { x: antennaX + halfAntenna, y: antennaY - halfAntenna },
        { x: antennaX - halfAntenna, y: antennaY + halfAntenna },
        { x: antennaX + halfAntenna, y: antennaY + halfAntenna }
      ];
      
      const isValid = testPoints.every(p => isPointInsideGeometry(p.x, p.y));
      
      if (!isValid) {
        console.warn(`⚠️ Current antenna position (${antennaX.toFixed(1)}, ${antennaY.toFixed(1)}) is invalid, searching for valid position...`);
        const validPos = findValidAntennaPosition();
        setAntennaX(validPos.x);
        setAntennaY(validPos.y);
        console.log(`✅ Repositioned antenna to (${validPos.x.toFixed(1)}, ${validPos.y.toFixed(1)})`);
      } else {
        console.log(`✅ Antenna position (${antennaX.toFixed(1)}, ${antennaY.toFixed(1)}) is valid`);
      }
    }
  }, [step, mode, gndData]);  // Removed antennaX, antennaY, lgx, lgy from dependencies to prevent infinite loop
  
  const handleDragMove = (event) => {
    if (!isDragging) return;
    
    const clientX = event.clientX || (event.touches && event.touches[0].clientX) || 0;
    const clientY = event.clientY || (event.touches && event.touches[0].clientY) || 0;
    
    const scaleFactor = getScaleFactor();
    const lgxValue = parseFloat(lgx) || 50;
    const lgyValue = parseFloat(lgy) || 50;
    
    // Calculate displacement in pixels, then convert to mm
    const deltaX = (clientX - dragStartPos.x) / scaleFactor;
    const deltaY = (clientY - dragStartPos.y) / scaleFactor;
    
    // Apply displacement to initial position
    let newX = initialAntennaPos.x + deltaX;
    // Reverse Y calculation: screen Y increases downward, but GND_yPos increases upward
    // When dragging down (positive deltaY), GND_yPos should decrease
    let newY = initialAntennaPos.y - deltaY;
    
    // Constrain antenna CENTER to stay within ground plane
    // Center must be at least ANTENNA_SIZE/2 from each edge
    const halfAntenna = ANTENNA_SIZE / 2;
    
    // First apply canvas boundary constraints
    newX = Math.max(halfAntenna, Math.min(newX, lgxValue - halfAntenna));
    newY = Math.max(halfAntenna, Math.min(newY, lgyValue - halfAntenna));
    
    // For import mode, check if antenna is fully inside the custom geometry
    if (mode === 'import' && gndData) {
      // Define the 4 corners and center of the antenna
      const testPoints = [
        { x: newX, y: newY, name: 'center' },                              // Center
        { x: newX - halfAntenna, y: newY - halfAntenna, name: 'BL' },     // Bottom-left
        { x: newX + halfAntenna, y: newY - halfAntenna, name: 'BR' },     // Bottom-right
        { x: newX - halfAntenna, y: newY + halfAntenna, name: 'TL' },     // Top-left
        { x: newX + halfAntenna, y: newY + halfAntenna, name: 'TR' }      // Top-right
      ];
      
      // Check if all points are inside the geometry
      const allPointsInside = testPoints.every(point => 
        isPointInsideGeometry(point.x, point.y)
      );
      
      if (!allPointsInside) {
        // Try to allow movement in one axis only (sliding along boundary)
        // Test X-axis only movement
        const xOnlyPoints = [
          { x: newX, y: antennaY },
          { x: newX - halfAntenna, y: antennaY - halfAntenna },
          { x: newX + halfAntenna, y: antennaY - halfAntenna },
          { x: newX - halfAntenna, y: antennaY + halfAntenna },
          { x: newX + halfAntenna, y: antennaY + halfAntenna }
        ];
        
        const xOnlyValid = xOnlyPoints.every(p => isPointInsideGeometry(p.x, p.y));
        
        if (xOnlyValid) {
          // Allow X movement only
          newY = antennaY;
        } else {
          // Test Y-axis only movement
          const yOnlyPoints = [
            { x: antennaX, y: newY },
            { x: antennaX - halfAntenna, y: newY - halfAntenna },
            { x: antennaX + halfAntenna, y: newY - halfAntenna },
            { x: antennaX - halfAntenna, y: newY + halfAntenna },
            { x: antennaX + halfAntenna, y: newY + halfAntenna }
          ];
          
          const yOnlyValid = yOnlyPoints.every(p => isPointInsideGeometry(p.x, p.y));
          
          if (yOnlyValid) {
            // Allow Y movement only
            newX = antennaX;
          } else {
            // Can't move in any direction, stay at current position
            return;
          }
        }
      }
    }
    
    setAntennaX(newX);
    setAntennaY(newY);
  };
  
  const handleDragEnd = () => {
    setIsDragging(false);
  };
  
  // Check if a point is inside the imported GND geometry
  const isPointInGND = (x, y) => {
    if (mode !== 'import' || !gndData || !gndData.geometry) {
      // For parametric mode, use simple rectangle bounds
      return true;
    }
    
    // For imported geometry, check if point is within bounding box
    // TODO: Implement proper point-in-polygon test for complex shapes
    const { bounds } = gndData;
    return (
      x >= bounds.min_x &&
      x <= bounds.max_x &&
      y >= bounds.min_y &&
      y <= bounds.max_y
    );
  };
  
  const validateAndProceedToStep2 = () => {
    const lgxValue = parseFloat(lgx);
    const lgyValue = parseFloat(lgy);
    
    if (isNaN(lgxValue) || lgxValue < ANTENNA_SIZE) {
      const message = `Ground plane X dimension must be at least ${ANTENNA_SIZE}mm (antenna size)`;
      if (Platform.OS === 'web') {
        window.alert(message);
      } else {
        Alert.alert('Invalid Size', message);
      }
      return;
    }
    
    if (isNaN(lgyValue) || lgyValue < ANTENNA_SIZE) {
      const message = `Ground plane Y dimension must be at least ${ANTENNA_SIZE}mm (antenna size)`;
      if (Platform.OS === 'web') {
        window.alert(message);
      } else {
        Alert.alert('Invalid Size', message);
      }
      return;
    }
    
    // Initialize antenna position at center (coordinates represent antenna center)
    setAntennaX(lgxValue / 2);
    setAntennaY(lgyValue / 2);
    setStep(2);
  };
  
  const handleApply = () => {
    const lgxValue = parseFloat(lgx);
    const lgyValue = parseFloat(lgy);
    
    if (mode === 'import' && gndData) {
      // For imported DXF: Convert canvas coordinates to DXF coordinates
      // Canvas (0→lgx, 0→lgy) → DXF (min_x→max_x, min_y→max_y)
      const bounds = gndData.bounds;
      const dxfX = bounds.min_x + (antennaX / lgxValue) * bounds.width;
      const dxfY = bounds.min_y + (antennaY / lgyValue) * bounds.height;
      
      console.log(`📍 Antenna position conversion:`);
      console.log(`   Canvas: (${antennaX.toFixed(1)}, ${antennaY.toFixed(1)})`);
      console.log(`   DXF: (${dxfX.toFixed(1)}, ${dxfY.toFixed(1)})`);
      console.log(`   Bounds: (${bounds.min_x}, ${bounds.min_y}) to (${bounds.max_x}, ${bounds.max_y})`);
      
      // Apply custom GND configuration with DXF coordinates
      onApply({
        mode: 'custom',
        gndId: gndData.gndId,
        file: gndData.file,
        bounds: gndData.bounds,
        GND_xPos: dxfX,
        GND_yPos: dxfY
      });
    } else {
      // For parametric mode: Use canvas coordinates directly (they ARE the GND coordinates)
      onApply({
        mode: 'parametric',
        Lgx: lgxValue,
        Lgy: lgyValue,
        GND_xPos: antennaX,
        GND_yPos: antennaY
      });
    }
  };
  
  // Import GND file - Web version using HTML file input
  const pickAndUploadFileWeb = async (event) => {
    try {
      const file = event.target.files[0];
      if (!file) {
        console.log('❌ No file selected');
        return;
      }

      console.log('📄 Selected file (Web):', file.name, 'Size:', file.size, 'Type:', file.type);
      
      // Validate DXF file extension
      if (!file.name.toLowerCase().endsWith('.dxf')) {
        window.alert('Invalid File Format\n\nPlease select a DXF file. Other formats (STL, VBS) are not supported.');
        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }
      
      setUploadedFile({ name: file.name, size: file.size });
      setIsUploading(true);

      // Step 2: Upload to server
      const formData = new FormData();
      formData.append('gndFile', file);
      formData.append('projectPath', projectPath);

      console.log('📦 FormData prepared, starting upload...');
      console.log('   Project path:', projectPath);

      let uploadSuccess = false;
      let response;
      let lastError = null;

      for (const serverUrl of MATLAB_SERVER_URLS) {
        try {
          console.log(`🔄 Trying server: ${serverUrl}/api/gnd/upload`);
          
          response = await fetch(`${serverUrl}/api/gnd/upload`, {
            method: 'POST',
            body: formData,
            headers: {
              'Accept': 'application/json'
            }
          });

          console.log(`📥 Response status: ${response.status}`);

          if (response.ok) {
            uploadSuccess = true;
            console.log(`✅ Upload successful to ${serverUrl}`);
            break;
          } else {
            const errorText = await response.text();
            console.log(`❌ Server returned error: ${errorText}`);
            lastError = new Error(`Server error: ${response.status} - ${errorText}`);
          }
        } catch (err) {
          console.log(`❌ Failed to connect to ${serverUrl}:`, err.message);
          lastError = err;
        }
      }

      if (!uploadSuccess) {
        throw lastError || new Error('Failed to upload to any server');
      }

      const data = await response.json();
      console.log('📊 Server response data:', data);
      
      if (data.success) {
        // Check validation errors (e.g., size too small)
        if (data.validation && data.validation.errors && data.validation.errors.length > 0) {
          const errorMessages = data.validation.errors.join('\n');
          window.alert(
            '❌ Invalid Ground Plane Design\n\n' +
            errorMessages + '\n\n' +
            'The antenna is 25mm × 25mm and must fit entirely within the ground plane. ' +
            'Please redesign your DXF file with larger dimensions.'
          );
          // Reset file input
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          setIsUploading(false);
          return;
        }
        
        console.log('✅ GND data loaded successfully');
        console.log('   Format:', data.file.format);
        console.log('   Vertices:', data.vertex_count);
        console.log('   Faces:', data.face_count);
        console.log('   Edges:', data.edge_count);
        console.log('   Bounds:', data.bounds);
        console.log('   Geometry data structure:', {
          hasGeometry: !!data.geometry,
          hasVertices: !!(data.geometry && data.geometry.vertices),
          hasEdges: !!(data.geometry && data.geometry.edges),
          verticesLength: data.geometry?.vertices?.length,
          edgesLength: data.geometry?.edges?.length
        });
        
        setGndData(data);
        
        // Set dimensions from imported GND
        setLgx(data.bounds.width.toFixed(1));
        setLgy(data.bounds.height.toFixed(1));
        
        // Initialize antenna position at center
        setAntennaX(data.bounds.width / 2);
        setAntennaY(data.bounds.height / 2);
        
        const alertMessage = 
          `✅ GND Imported Successfully!\n\n` +
          `Format: ${data.file.format}\n` +
          `Vertices: ${data.vertex_count || 0}\n` +
          `Faces: ${data.face_count || 0}\n` +
          `Size: ${data.bounds.width.toFixed(2)} × ${data.bounds.height.toFixed(2)} mm\n\n` +
          `Review the geometry info below, then tap "Next" to position your antenna.`;
        
        console.log('📢 Showing alert:', alertMessage);
        window.alert(alertMessage);
      } else {
        throw new Error(data.error || 'Upload failed with unknown error');
      }

    } catch (error) {
      console.error('❌ Upload error:', error);
      console.error('   Error stack:', error.stack);
      
      const errorMessage = error.message || 'Unknown error occurred';
      window.alert(
        'Upload Failed\n\n' +
        errorMessage + '\n\n' +
        'Troubleshooting:\n' +
        '• Check server is running (port 3001)\n' +
        '• Verify file format (DXF only)\n' +
        '• Check file size (max 50MB)\n' +
        '• See browser console for details'
      );
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Import GND file - Mobile version using DocumentPicker
  const pickAndUploadFileMobile = async () => {
    try {
      // Step 1: Pick file
      const result = await DocumentPicker.getDocumentAsync({
        type: ['*/*'], // Allow all extensions, backend will validate DXF format
        copyToCacheDirectory: true
      });

      console.log('📤 DocumentPicker result:', result);

      if (result.canceled) {
        console.log('❌ File selection canceled');
        return;
      }

      const file = result.assets[0];
      console.log('📄 Selected file:', file.name, 'URI:', file.uri, 'Size:', file.size);
      
      // Validate DXF file extension
      if (!file.name.toLowerCase().endsWith('.dxf')) {
        Alert.alert(
          'Invalid File Format',
          'Please select a DXF file. Other formats (STL, VBS) are not supported.',
          [{ text: 'OK' }]
        );
        return;
      }
      
      setUploadedFile(file);
      setIsUploading(true);

      // Step 2: Upload to server
      const formData = new FormData();
      formData.append('gndFile', {
        uri: file.uri,
        type: file.mimeType || 'application/octet-stream',
        name: file.name
      });
      formData.append('projectPath', projectPath);

      console.log('📦 FormData prepared, starting upload...');
      console.log('   Project path:', projectPath);

      let uploadSuccess = false;
      let response;
      let lastError = null;

      for (const serverUrl of MATLAB_SERVER_URLS) {
        try {
          console.log(`🔄 Trying server: ${serverUrl}/api/gnd/upload`);
          
          response = await fetch(`${serverUrl}/api/gnd/upload`, {
            method: 'POST',
            body: formData,
            headers: {
              'Accept': 'application/json'
            }
          });

          console.log(`📥 Response status: ${response.status}`);

          if (response.ok) {
            uploadSuccess = true;
            console.log(`✅ Upload successful to ${serverUrl}`);
            break;
          } else {
            const errorText = await response.text();
            console.log(`❌ Server returned error: ${errorText}`);
            lastError = new Error(`Server error: ${response.status} - ${errorText}`);
          }
        } catch (err) {
          console.log(`❌ Failed to connect to ${serverUrl}:`, err.message);
          lastError = err;
        }
      }

      if (!uploadSuccess) {
        throw lastError || new Error('Failed to upload to any server');
      }

      const data = await response.json();
      console.log('📊 Server response data:', data);
      
      if (data.success) {
        // Check validation errors (e.g., size too small)
        if (data.validation && data.validation.errors && data.validation.errors.length > 0) {
          const errorMessages = data.validation.errors.join('\n');
          Alert.alert(
            '❌ Invalid Ground Plane Design',
            errorMessages + '\n\n' +
            'The antenna is 25mm × 25mm and must fit entirely within the ground plane. ' +
            'Please redesign your DXF file with larger dimensions.',
            [{ text: 'OK' }]
          );
          setIsUploading(false);
          return;
        }
        
        console.log('✅ GND data loaded successfully');
        console.log('   Format:', data.file.format);
        console.log('   Vertices:', data.vertex_count);
        console.log('   Faces:', data.face_count);
        console.log('   Edges:', data.edge_count);
        console.log('   Bounds:', data.bounds);
        console.log('   Geometry data structure:', {
          hasGeometry: !!data.geometry,
          hasVertices: !!(data.geometry && data.geometry.vertices),
          hasEdges: !!(data.geometry && data.geometry.edges),
          verticesLength: data.geometry?.vertices?.length,
          edgesLength: data.geometry?.edges?.length
        });
        
        setGndData(data);
        
        // Set dimensions from imported GND
        setLgx(data.bounds.width.toFixed(1));
        setLgy(data.bounds.height.toFixed(1));
        
        // Initialize antenna position at center
        setAntennaX(data.bounds.width / 2);
        setAntennaY(data.bounds.height / 2);
        
        const alertMessage = 
          `✅ GND Imported Successfully!\n\n` +
          `Format: ${data.file.format}\n` +
          `Vertices: ${data.vertex_count || 0}\n` +
          `Faces: ${data.face_count || 0}\n` +
          `Size: ${data.bounds.width.toFixed(2)} × ${data.bounds.height.toFixed(2)} mm\n\n` +
          `Review the geometry info below, then tap "Next" to position your antenna.`;
        
        console.log('📢 Showing alert:', alertMessage);
        Alert.alert('✅ GND Imported', alertMessage, [{ text: 'OK' }]);
      } else {
        throw new Error(data.error || 'Upload failed with unknown error');
      }

    } catch (error) {
      console.error('❌ Upload error:', error);
      console.error('   Error stack:', error.stack);
      
      const errorMessage = error.message || 'Unknown error occurred';
      Alert.alert(
        'Upload Failed', 
        `Could not upload DXF file.\n\n` +
        `Error: ${errorMessage}\n\n` +
        `Troubleshooting:\n` +
        `• Check that server is running (npm run server)\n` +
        `• Verify file format (DXF only)\n` +
        `• Check file size (<50MB)\n` +
        `• Look at console for detailed logs`,
        [{ text: 'OK' }]
      );
    } finally {
      setIsUploading(false);
    }
  };

  // Wrapper function to call appropriate upload method
  const pickAndUploadFile = () => {
    if (Platform.OS === 'web') {
      // Trigger file input click on web
      fileInputRef.current?.click();
    } else {
      // Use DocumentPicker on mobile
      pickAndUploadFileMobile();
    }
  };
  
  const validateGND = async () => {
    if (!gndData || !gndData.gndId) {
      Alert.alert('Error', 'No GND file uploaded');
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
            const validationData = await response.json();
            
            let message = validationData.valid ? '✅ Geometry is valid!\n\n' : '❌ Geometry has errors:\n\n';
            
            if (validationData.errors && validationData.errors.length > 0) {
              message += 'Errors:\n' + validationData.errors.join('\n') + '\n\n';
            }
            
            if (validationData.warnings && validationData.warnings.length > 0) {
              message += 'Warnings:\n' + validationData.warnings.join('\n') + '\n\n';
            }
            
            if (validationData.suggestions && validationData.suggestions.length > 0) {
              message += 'Suggestions:\n' + validationData.suggestions.join('\n');
            }
            
            Alert.alert('Validation Result', message);
            return;
          }
        } catch (err) {
          console.log(`Failed to connect to ${serverUrl}`);
        }
      }

      throw new Error('Failed to validate on any server');

    } catch (error) {
      console.error('❌ Validation error:', error);
      Alert.alert('Validation Failed', error.message);
    } finally {
      setIsUploading(false);
    }
  };
  
  const renderModeSelection = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Choose Ground Plane Type</Text>
      <Text style={styles.stepDescription}>
        Select how you want to define the ground plane for your antenna simulation.
      </Text>
      
      <TouchableOpacity 
        onPress={() => {
          setMode('parametric');
          setStep(1);
        }} 
        style={styles.modeCard}
      >
        <LinearGradient
          colors={['#f59e0b', '#f97316']}
          style={styles.modeCardGradient}
        >
          <Text style={styles.modeIcon}>🏗️</Text>
          <Text style={styles.modeTitle}>Parametric Ground Plane</Text>
          <Text style={styles.modeDescription}>
            Define a rectangular ground plane by entering length and width dimensions.
            Best for simple designs and quick testing.
          </Text>
          <View style={styles.modeFeatures}>
            <Text style={styles.modeFeature}>✓ Quick setup</Text>
            <Text style={styles.modeFeature}>✓ Rectangle only</Text>
            <Text style={styles.modeFeature}>✓ Interactive positioning</Text>
          </View>
        </LinearGradient>
      </TouchableOpacity>
      
      <TouchableOpacity 
        onPress={() => {
          setMode('import');
          setStep(1);
        }} 
        style={styles.modeCard}
      >
        <LinearGradient
          colors={['#6366f1', '#8b5cf6']}
          style={styles.modeCardGradient}
        >
          <Text style={styles.modeIcon}>📐</Text>
          <Text style={styles.modeTitle}>Import Custom GND</Text>
          <Text style={styles.modeDescription}>
            Upload a CAD file (DXF, STL, VBScript) of your real-world PCB or device housing.
            Best for accurate simulations with complex shapes.
          </Text>
          <View style={styles.modeFeatures}>
            <Text style={styles.modeFeature}>✓ Any 2D shape</Text>
            <Text style={styles.modeFeature}>✓ DXF format only</Text>
            <Text style={styles.modeFeature}>✓ Real-world accuracy</Text>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
  
  const renderImportStep = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Import Custom Ground Plane</Text>
      <Text style={styles.stepDescription}>
        Upload a DXF file of your ground plane design (max 50MB). Supports lines, polylines, circles, arcs, and complex 2D shapes.
      </Text>
      
      {/* Hidden file input for web */}
      {Platform.OS === 'web' && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".dxf,.DXF"
          onChange={pickAndUploadFileWeb}
          style={{ display: 'none' }}
        />
      )}
      
      {!gndData ? (
        <View>
          <TouchableOpacity 
            onPress={pickAndUploadFile} 
            style={styles.uploadButton}
            disabled={isUploading}
          >
            <LinearGradient
              colors={['#6366f1', '#8b5cf6']}
              style={styles.buttonGradient}
            >
              {isUploading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator color="#ffffff" />
                  <Text style={styles.buttonText}>Uploading...</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.uploadIcon}>📁</Text>
                  <Text style={styles.buttonText}>Select DXF File</Text>
                  <Text style={styles.uploadHint}>AutoCAD DXF</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
          
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>📋 DXF File Requirements:</Text>
            <Text style={styles.infoText}>• Use millimeters (mm) as units</Text>
            <Text style={styles.infoText}>• Place geometry at Z = 0 plane</Text>
            <Text style={styles.infoText}>• Supports: lines, circles, arcs, polylines</Text>
            <Text style={styles.infoText}>• File size limit: 50 MB</Text>
          </View>
        </View>
      ) : (
        <View>
          <View style={styles.successBox}>
            <Text style={styles.successIcon}>✅</Text>
            <Text style={styles.successTitle}>File Loaded Successfully!</Text>
            <View style={styles.gndInfoGrid}>
              <View style={styles.gndInfoItem}>
                <Text style={styles.gndInfoLabel}>File:</Text>
                <Text style={styles.gndInfoValue}>{gndData.file.originalName}</Text>
              </View>
              <View style={styles.gndInfoItem}>
                <Text style={styles.gndInfoLabel}>Format:</Text>
                <Text style={styles.gndInfoValue}>{gndData.file.format.toUpperCase()}</Text>
              </View>
              <View style={styles.gndInfoItem}>
                <Text style={styles.gndInfoLabel}>Dimensions:</Text>
                <Text style={styles.gndInfoValue}>
                  {gndData.bounds.width.toFixed(1)} × {gndData.bounds.height.toFixed(1)} mm
                </Text>
              </View>
              <View style={styles.gndInfoItem}>
                <Text style={styles.gndInfoLabel}>Vertices:</Text>
                <Text style={styles.gndInfoValue}>{gndData.vertex_count}</Text>
              </View>
              <View style={styles.gndInfoItem}>
                <Text style={styles.gndInfoLabel}>Faces:</Text>
                <Text style={styles.gndInfoValue}>{gndData.face_count}</Text>
              </View>
              <View style={styles.gndInfoItem}>
                <Text style={styles.gndInfoLabel}>Edges:</Text>
                <Text style={styles.gndInfoValue}>{gndData.edge_count}</Text>
              </View>
            </View>
          </View>
          
          <TouchableOpacity 
            onPress={() => setStep(2)} 
            style={styles.nextButton}
          >
            <LinearGradient
              colors={['#10b981', '#059669']}
              style={styles.buttonGradient}
            >
              <Text style={styles.buttonText}>Next: Position Antenna →</Text>
            </LinearGradient>
          </TouchableOpacity>
          
          <View style={styles.importActionsRow}>
            <TouchableOpacity 
              onPress={validateGND} 
              style={styles.validateButtonSmall}
              disabled={isUploading}
            >
              <Text style={styles.validateButtonSmallText}>
                {isUploading ? '⏳ Validating...' : '🔍 Validate'}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={() => setGndData(null)} 
              style={styles.reuploadButtonSmall}
            >
              <Text style={styles.reuploadButtonSmallText}>↻ Re-upload</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
  
  const renderSizeInputStep = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Step 1: Define Ground Plane Size</Text>
      <Text style={styles.stepDescription}>
        Enter the ground plane dimensions. Minimum size is {ANTENNA_SIZE}mm × {ANTENNA_SIZE}mm (antenna size).
      </Text>
      
      <View style={styles.inputsRow}>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>X Dimension (Lgx)</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              value={lgx}
              onChangeText={setLgx}
              placeholder="50"
              keyboardType="numeric"
              maxLength={6}
              onSubmitEditing={() => Keyboard.dismiss()}
              onBlur={() => Keyboard.dismiss()}
              returnKeyType="done"
            />
            <Text style={styles.unitText}>mm</Text>
          </View>
        </View>
        
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Y Dimension (Lgy)</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              value={lgy}
              onChangeText={setLgy}
              placeholder="50"
              keyboardType="numeric"
              maxLength={6}
              onSubmitEditing={() => Keyboard.dismiss()}
              onBlur={() => Keyboard.dismiss()}
              returnKeyType="done"
            />
            <Text style={styles.unitText}>mm</Text>
          </View>
        </View>
      </View>
      
      <TouchableOpacity onPress={validateAndProceedToStep2} style={styles.nextButton}>
        <LinearGradient
          colors={['#10b981', '#059669']}
          style={styles.buttonGradient}
        >
          <Text style={styles.buttonText}>Next: Position Antenna →</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
  
  const renderPositionAdjustmentStep = () => {
    const scaleFactor = getScaleFactor();
    const lgxValue = parseFloat(lgx) || 50;
    const lgyValue = parseFloat(lgy) || 50;
    
    const canvasWidth = lgxValue * scaleFactor;
    const canvasHeight = lgyValue * scaleFactor;
    const antennaDisplaySize = ANTENNA_SIZE * scaleFactor;
    
    // Convert ground plane coordinates to screen coordinates
    // Ground plane: Origin (0,0) at bottom-left, Y increases upward
    // Screen: Origin (0,0) at top-left, Y increases downward
    // antennaX/antennaY are the CENTER of the antenna, so we need to subtract half the antenna size
    const halfAntenna = ANTENNA_SIZE / 2;
    const antennaCornerX = antennaX - halfAntenna; // Convert center to bottom-left corner
    const antennaCornerY = antennaY - halfAntenna;
    
    // Convert to screen coordinates
    const screenX = antennaCornerX * scaleFactor;
    const screenY = (lgyValue - antennaCornerY - ANTENNA_SIZE) * scaleFactor;
    
    // Helper function to convert geometry coordinates to screen coordinates
    const geoToScreen = (x, y) => {
      return {
        x: x * scaleFactor,
        y: (lgyValue - y) * scaleFactor // Flip Y axis
      };
    };
    
    // Render geometry edges if in import mode
    const renderGeometry = () => {
      if (mode !== 'import' || !gndData || !gndData.geometry) {
        return null;
      }

      const { vertices, edges } = gndData.geometry;
      
      // Validate geometry data
      if (!vertices || !Array.isArray(vertices) || vertices.length === 0) {
        console.warn('⚠️ Invalid vertices data:', vertices);
        return null;
      }
      
      if (!edges || !Array.isArray(edges) || edges.length === 0) {
        console.warn('⚠️ Invalid edges data:', edges);
        return null;
      }
      
      if (Platform.OS === 'web') {
        // Use HTML5 Canvas for web - more reliable than SVG in React Native Web
        return (
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          />
        );
      } else {
        // For React Native mobile, render lines as View elements
        console.log(`🎨 Rendering ${edges.length} edges as Views for mobile`);
        
        try {
          return edges.map(([start, end], idx) => {
            if (!vertices[start] || !vertices[end]) {
              return null;
            }
            
            const v1 = vertices[start];
            const v2 = vertices[end];
            const p1 = geoToScreen(v1[0], v1[1]);
            const p2 = geoToScreen(v2[0], v2[1]);
            
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            
            return (
              <View
                key={`edge-${idx}`}
                style={{
                  position: 'absolute',
                  left: p1.x,
                  top: p1.y,
                  width: length,
                  height: 3,
                  backgroundColor: '#2563eb',
                  transform: [{ rotate: `${angle}deg` }],
                  transformOrigin: '0 0',
                  zIndex: 2,
                }}
              />
            );
          }).filter(view => view !== null);
        } catch (error) {
          console.error('Error rendering geometry:', error);
          return null;
        }
      }
    };
    
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>
          {mode === 'import' ? 'Step 2: Position Antenna on Custom GND Design' : 'Step 2: Position Antenna on Rectangular GND'}
        </Text>
        <Text style={styles.stepDescription}>
          {mode === 'import' 
            ? `Drag the antenna to position it on your custom DXF design. The blue outline shows the complex geometry from ${gndData?.file.originalName}. Same positioning rules apply.`
            : 'Drag the antenna to set its position on the rectangular ground plane. The gray border shows the simple rectangle shape. GND_xPos and GND_yPos represent the CENTER of the antenna.'
          }
        </Text>
        
        {mode === 'import' && gndData && (
          <View style={styles.importedGNDInfo}>
            <Text style={styles.importedGNDLabel}>Custom GND Design:</Text>
            <Text style={styles.importedGNDText}>
              {gndData.file.originalName} • {gndData.bounds.width.toFixed(1)} × {gndData.bounds.height.toFixed(1)} mm • {gndData.vertex_count || 0} vertices, {gndData.edge_count || 0} edges
            </Text>
          </View>
        )}
        
        {mode === 'parametric' && (
          <View style={styles.importedGNDInfo}>
            <Text style={styles.importedGNDLabel}>Rectangular GND:</Text>
            <Text style={styles.importedGNDText}>
              Simple rectangle • {lgxValue} × {lgyValue} mm (width × height)
            </Text>
          </View>
        )}
        
        <View style={styles.canvasContainer}>
          <View 
            style={[styles.canvas, { 
              width: canvasWidth, 
              height: canvasHeight,
              position: 'relative',
              overflow: 'visible'  // Allow SVG to render outside if needed
            }]}
            onMouseMove={Platform.OS === 'web' ? handleDragMove : undefined}
            onMouseUp={Platform.OS === 'web' ? handleDragEnd : undefined}
            onMouseLeave={Platform.OS === 'web' ? handleDragEnd : undefined}
          >
            {/* Ground plane background - different rendering for parametric vs import mode */}
            <View style={[
              styles.groundPlane, 
              { 
                width: canvasWidth, 
                height: canvasHeight,
                backgroundColor: mode === 'import' ? '#f0f9ff' : '#e2e8f0',
                borderColor: mode === 'import' ? 'transparent' : '#94a3b8', // No border for custom GND
                borderWidth: mode === 'parametric' ? 3 : 0, // No border for custom GND
                position: 'absolute',
                top: 0,
                left: 0,
                zIndex: 0, // Behind everything
              }
            ]} />
            
            {/* Parametric mode: Show simple rectangle outline */}
            {mode === 'parametric' && Platform.OS === 'web' && (
              <View 
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: canvasWidth,
                  height: canvasHeight,
                  borderWidth: 3,
                  borderColor: '#94a3b8',
                  borderStyle: 'solid',
                  zIndex: 1,
                }}
              />
            )}
            
            {/* Import mode: Render custom DXF geometry (complex shapes) */}
            {mode === 'import' && renderGeometry()}
            
            {/* Coordinate system labels */}
            <View style={styles.coordinateLabels}>
              <Text style={styles.originLabel}>(0,0)</Text>
              <Text style={[styles.cornerLabel, { bottom: 5, left: canvasWidth - 50 }]}>({lgxValue},0)</Text>
              <Text style={[styles.cornerLabel, { top: 5, left: 5 }]}>(0,{lgyValue})</Text>
              <Text style={[styles.cornerLabel, { top: 5, left: canvasWidth - 70 }]}>({lgxValue},{lgyValue})</Text>
            </View>
            
            {/* Antenna - draggable, z-index above everything */}
            <View
              style={[
                styles.antenna,
                {
                  width: antennaDisplaySize,
                  height: antennaDisplaySize,
                  left: screenX,
                  top: screenY,
                  cursor: isDragging ? 'grabbing' : 'grab',
                  zIndex: 10,
                }
              ]}
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
          
          <View style={styles.dimensionsDisplay}>
            <Text style={styles.dimensionText}>Ground Plane: {lgxValue} × {lgyValue} mm</Text>
            {mode === 'import' && gndData ? (
              <>
                <Text style={styles.dimensionText}>
                  Canvas Position: ({antennaX.toFixed(1)}, {antennaY.toFixed(1)}) mm
                </Text>
                <Text style={styles.dimensionText}>
                  DXF Position (GND_xPos, GND_yPos): (
                  {(gndData.bounds.min_x + (antennaX / lgxValue) * gndData.bounds.width).toFixed(1)}, 
                  {(gndData.bounds.min_y + (antennaY / lgyValue) * gndData.bounds.height).toFixed(1)}) mm
                </Text>
                <Text style={styles.dimensionHint}>
                  (DXF coordinates will be used in MATLAB/HFSS)
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.dimensionText}>
                  GND_xPos: {antennaX.toFixed(1)}mm, GND_yPos: {antennaY.toFixed(1)}mm
                </Text>
                <Text style={styles.dimensionHint}>
                  (Center of antenna in ground plane coordinate system)
                </Text>
              </>
            )}
          </View>
        </View>
        
        <View style={styles.buttonsRow}>
          <TouchableOpacity 
            onPress={() => {
              if (mode === 'import') {
                setStep(1);
                setGndData(null);
              } else {
                setStep(1);
              }
            }} 
            style={styles.backStepButton}
          >
            <Text style={styles.backStepButtonText}>
              {mode === 'import' ? '← Back to Import' : '← Back to Size'}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity onPress={handleApply} style={styles.applyButton}>
            <LinearGradient
              colors={['#8b5cf6', '#7c3aed']}
              style={styles.buttonGradient}
            >
              <Text style={styles.buttonText}>✓ Apply Configuration</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  };
  
  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={mode === null ? ['#6366f1', '#8b5cf6', '#a855f7'] : mode === 'import' ? ['#6366f1', '#8b5cf6', '#a855f7'] : ['#f59e0b', '#f97316', '#ea580c']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <TouchableOpacity onPress={() => {
          if (mode === null) {
            onBack();
          } else if (step === 1 && mode === 'parametric') {
            setMode(null);
            setStep(1);
          } else if (step === 1 && mode === 'import') {
            setMode(null);
            setStep(1);
            setGndData(null);
          } else {
            // Already handled in step buttons
            onBack();
          }
        }} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        
        <View style={styles.headerContent}>
          <Text style={styles.title}>
            {mode === null ? '🏗️ Ground Plane Configurator' : 
             mode === 'import' ? '📐 Custom GND Import' : 
             '🏗️ Parametric Ground Plane'}
          </Text>
          <Text style={styles.subtitle}>
            {mode === null ? 'Choose your configuration method' :
             mode === 'import' ? (step === 1 ? 'Upload GND file' : 'Position antenna') :
             `Step ${step} of 2: ${step === 1 ? 'Define Size' : 'Position Antenna'}`}
          </Text>
        </View>
      </LinearGradient>
      
      {/* Content */}
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {mode === null && renderModeSelection()}
        {mode === 'parametric' && step === 1 && renderSizeInputStep()}
        {mode === 'import' && step === 1 && renderImportStep()}
        {step === 2 && renderPositionAdjustmentStep()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    paddingTop: 20,
    paddingBottom: 30,
    paddingHorizontal: 20,
  },
  backButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 15,
    marginTop: 10,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  headerContent: {
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  stepContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 24,
    lineHeight: 20,
  },
  // Mode Selection Styles
  modeCard: {
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  modeCardGradient: {
    padding: 24,
    alignItems: 'center',
  },
  modeIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  modeTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  modeDescription: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  modeFeatures: {
    alignItems: 'flex-start',
    width: '100%',
  },
  modeFeature: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.95)',
    marginVertical: 3,
    fontWeight: '600',
  },
  // Import Mode Styles
  uploadButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 20,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  uploadIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  uploadHint: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 4,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoBox: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 12,
    padding: 16,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e40af',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: '#1e40af',
    marginVertical: 3,
    lineHeight: 18,
  },
  successBox: {
    backgroundColor: '#f0fdf4',
    borderWidth: 2,
    borderColor: '#86efac',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 16,
  },
  gndInfoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    width: '100%',
  },
  gndInfoItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#ffffff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1fae5',
  },
  gndInfoLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
    marginBottom: 4,
  },
  gndInfoValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#047857',
  },
  importActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  validateButtonSmall: {
    flex: 1,
    backgroundColor: '#f0f9ff',
    borderWidth: 2,
    borderColor: '#38bdf8',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  validateButtonSmallText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0369a1',
  },
  reuploadButtonSmall: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  reuploadButtonSmallText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  validateButton: {
    backgroundColor: '#f0f9ff',
    borderWidth: 2,
    borderColor: '#38bdf8',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  validateButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0369a1',
  },
  reuploadButton: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  reuploadButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  importedGNDInfo: {
    backgroundColor: '#dbeafe',
    borderWidth: 1,
    borderColor: '#93c5fd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  importedGNDLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e40af',
    marginBottom: 4,
  },
  importedGNDText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e3a8a',
  },
  // Parametric Mode Styles
  inputsRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
  },
  inputGroup: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: '#1f2937',
    paddingVertical: 0,
  },
  unitText: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
    marginLeft: 8,
  },
  nextButton: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  buttonGradient: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  canvasContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  canvas: {
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 16,
  },
  groundPlane: {
    backgroundColor: '#e2e8f0',
    borderWidth: 2,
    borderColor: '#94a3b8',
    borderRadius: 0,  // Remove border radius to prevent clipping SVG
  },
  coordinateLabels: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
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
    fontSize: 12,
    fontWeight: '700',
  },
  antennaSize: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  antennaDrag: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '500',
    marginTop: 2,
    fontStyle: 'italic',
  },
  dimensionsDisplay: {
    backgroundColor: '#f1f5f9',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  dimensionText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
    marginVertical: 2,
  },
  dimensionHint: {
    fontSize: 11,
    color: '#64748b',
    fontStyle: 'italic',
    marginTop: 4,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  backStepButton: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  backStepButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  applyButton: {
    flex: 2,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
});

