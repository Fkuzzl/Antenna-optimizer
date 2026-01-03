"""
GND Validator - Validates ground plane geometry
Checks for common issues and provides suggestions
"""

class GNDValidator:
    """Validates ground plane geometry"""
    def __init__(self, geometry):
        self.geometry = geometry
        self.errors = []
        self.warnings = []
        self.suggestions = []
    
    def is_valid(self):
        """Run all validation checks"""
        self._check_empty_geometry()
        self._check_minimum_size()
        self._check_planar_geometry()
        self._check_closed_boundaries()
        self._check_self_intersections()
        
        return len(self.errors) == 0
    
    def _check_empty_geometry(self):
        """Check if geometry has any vertices"""
        if not self.geometry.vertices or len(self.geometry.vertices) == 0:
            self.errors.append("Geometry is empty (no vertices found)")
    
    def _check_minimum_size(self):
        """Check if geometry meets minimum size requirements"""
        if not self.geometry.vertices:
            return
        
        # Calculate bounding box
        x_coords = [v[0] for v in self.geometry.vertices]
        y_coords = [v[1] for v in self.geometry.vertices]
        
        min_x = min(x_coords)
        max_x = max(x_coords)
        min_y = min(y_coords)
        max_y = max(y_coords)
        
        width = max_x - min_x
        height = max_y - min_y
        
        # Antenna is 25mm x 25mm, ground plane must be at least this size
        antenna_size = 25  # 25mm antenna
        
        # First check: bounding box must be at least antenna size
        if width < antenna_size or height < antenna_size:
            self.errors.append(
                f"Ground plane bounding box is too small (W: {width:.1f}mm, H: {height:.1f}mm). "
                f"Minimum required: {antenna_size}mm × {antenna_size}mm to fit the antenna. "
                f"Please redesign with larger dimensions."
            )
            return
        
        # Second check: verify there's actually a space where 25x25mm antenna can fit
        # Use point-in-polygon test to check if antenna can fit anywhere
        if self.geometry.edges and len(self.geometry.edges) > 0:
            can_fit = self._test_antenna_fit(antenna_size, min_x, max_x, min_y, max_y)
            if not can_fit:
                self.errors.append(
                    f"Ground plane cannot accommodate the {antenna_size}mm × {antenna_size}mm antenna. "
                    f"Although the bounding box is {width:.1f}mm × {height:.1f}mm, "
                    f"there is no continuous area large enough for the antenna. "
                    f"Please redesign with a larger solid area (e.g., wider arms for plus/cross shapes)."
                )
    
    def _test_antenna_fit(self, antenna_size, min_x, max_x, min_y, max_y):
        """Test if antenna can fit anywhere in the geometry using grid search"""
        half_antenna = antenna_size / 2
        step = 5  # Test every 5mm
        
        # Grid search for valid position
        y = min_y + half_antenna
        while y <= max_y - half_antenna:
            x = min_x + half_antenna
            while x <= max_x - half_antenna:
                # Check if antenna at this position fits (center + 4 corners must be inside)
                test_points = [
                    (x, y),  # Center
                    (x - half_antenna, y - half_antenna),  # Bottom-left
                    (x + half_antenna, y - half_antenna),  # Bottom-right
                    (x - half_antenna, y + half_antenna),  # Top-left
                    (x + half_antenna, y + half_antenna)   # Top-right
                ]
                
                if all(self._point_in_polygon(px, py) for px, py in test_points):
                    return True  # Found a valid position
                
                x += step
            y += step
        
        return False  # No valid position found
    
    def _point_in_polygon(self, px, py):
        """Ray casting algorithm for point-in-polygon test"""
        if not self.geometry.edges or len(self.geometry.edges) == 0:
            return True  # If no edges, assume valid
        
        inside = False
        
        # Test against each edge
        for edge in self.geometry.edges:
            if len(edge) < 2:
                continue
            
            start_idx, end_idx = edge[0], edge[1]
            
            if start_idx >= len(self.geometry.vertices) or end_idx >= len(self.geometry.vertices):
                continue
            
            v1 = self.geometry.vertices[start_idx]
            v2 = self.geometry.vertices[end_idx]
            
            x1, y1 = float(v1[0]), float(v1[1])
            x2, y2 = float(v2[0]), float(v2[1])
            
            # Ray casting: horizontal ray from (px, py) to the right
            if (y1 > py) != (y2 > py):
                # Edge crosses the horizontal line at py
                intersect_x = x1 + (x2 - x1) * (py - y1) / (y2 - y1)
                if px < intersect_x:
                    inside = not inside
        
        return inside
    
    def _check_planar_geometry(self):
        """Check if geometry is mostly planar (for 2D GND)"""
        if not self.geometry.vertices:
            return
        
        z_coords = [v[2] if len(v) > 2 else 0 for v in self.geometry.vertices]
        z_variation = max(z_coords) - min(z_coords)
        
        if z_variation > 5:  # More than 5mm variation
            self.suggestions.append(
                f"Geometry has significant Z-axis variation ({z_variation:.2f}mm). "
                "Consider using 3D visualization mode."
            )
    
    def _check_closed_boundaries(self):
        """Check if edges form closed loops"""
        if not self.geometry.edges:
            if self.geometry.faces:
                # If we have faces, edges aren't necessary
                return
            self.warnings.append("No edges or faces defined in geometry")
            return
        
        # Build edge connectivity map
        edge_count = {}
        for edge in self.geometry.edges:
            for vertex_idx in edge:
                edge_count[vertex_idx] = edge_count.get(vertex_idx, 0) + 1
        
        # Check for vertices with odd edge count (open boundaries)
        open_vertices = [v for v, count in edge_count.items() if count % 2 != 0]
        
        if open_vertices and len(open_vertices) > 2:
            self.warnings.append(
                f"Geometry has {len(open_vertices)} open boundary vertices. "
                "Consider closing the boundaries for better HFSS simulation."
            )
    
    def _check_self_intersections(self):
        """Check for self-intersecting edges (basic check)"""
        # This is a computationally expensive check
        # For now, just add a suggestion
        if len(self.geometry.edges) > 100:
            self.suggestions.append(
                "Complex geometry detected. "
                "Please verify no self-intersections exist in your CAD software."
            )
    
    def get_errors(self):
        """Get list of validation errors"""
        return self.errors
    
    def get_warnings(self):
        """Get list of validation warnings"""
        return self.warnings
    
    def get_suggestions(self):
        """Get list of suggestions"""
        return self.suggestions
    
    def get_report(self):
        """Get full validation report"""
        return {
            'valid': self.is_valid(),
            'errors': self.errors,
            'warnings': self.warnings,
            'suggestions': self.suggestions
        }
