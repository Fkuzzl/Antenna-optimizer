"""
Geometry Parser - Format-specific parsers for GND files
Supports: DXF, STL, STEP (future), HFSS VBScript
"""

from pathlib import Path
import json

class Geometry:
    """Generic geometry container"""
    def __init__(self):
        self.vertices = []
        self.faces = []
        self.edges = []
        self.metadata = {}
    
    def to_dict(self):
        """Convert geometry to JSON-serializable dict"""
        import numpy as np
        
        # Convert numpy types to native Python types
        def convert_value(val):
            if isinstance(val, (np.integer, np.floating)):
                return float(val)
            elif isinstance(val, np.ndarray):
                return val.tolist()
            elif isinstance(val, list):
                return [convert_value(v) for v in val]
            return val
        
        return {
            'vertices': convert_value(self.vertices),
            'faces': convert_value(self.faces),
            'edges': convert_value(self.edges),
            'metadata': self.metadata
        }

class GeometryParser:
    """Factory class for format-specific parsers"""
    def __init__(self, file_path):
        self.file_path = Path(file_path)
        self.format = self.file_path.suffix.lower()
    
    def parse(self):
        """Parse geometry based on file format"""
        if self.format == '.dxf':
            return self._parse_dxf()
        elif self.format == '.stl':
            return self._parse_stl()
        elif self.format in ['.step', '.stp']:
            return self._parse_step()
        elif self.format == '.vbs':
            return self._parse_vbscript()
        else:
            raise ValueError(f"Unsupported format: {self.format}")
    
    def _parse_dxf(self):
        """Parse DXF file using ezdxf library"""
        try:
            import ezdxf
        except ImportError:
            raise ImportError("ezdxf library required. Install: pip install ezdxf")
        
        doc = ezdxf.readfile(str(self.file_path))
        msp = doc.modelspace()
        
        geometry = Geometry()
        
        # Use vertex map to deduplicate vertices (crucial for proper edge topology)
        vertex_map = {}
        epsilon = 1e-6  # Tolerance for vertex deduplication
        
        def add_vertex(x, y, z=0):
            """Add vertex with deduplication"""
            # Round to prevent floating point issues
            key = (round(x / epsilon) * epsilon, 
                   round(y / epsilon) * epsilon, 
                   round(z / epsilon) * epsilon)
            if key not in vertex_map:
                vertex_map[key] = len(geometry.vertices)
                geometry.vertices.append([float(x), float(y), float(z)])
            return vertex_map[key]
        
        # Extract entities
        for entity in msp:
            if entity.dxftype() == 'LINE':
                p1 = entity.dxf.start
                p2 = entity.dxf.end
                v1_idx = add_vertex(p1.x, p1.y, getattr(p1, 'z', 0))
                v2_idx = add_vertex(p2.x, p2.y, getattr(p2, 'z', 0))
                geometry.edges.append([v1_idx, v2_idx])
            
            elif entity.dxftype() == 'LWPOLYLINE':
                points = [(p[0], p[1], 0) for p in entity.get_points()]
                indices = [add_vertex(p[0], p[1], p[2]) for p in points]
                for i in range(len(indices)-1):
                    geometry.edges.append([indices[i], indices[i + 1]])
                # Close polyline if needed
                if entity.closed and len(indices) > 0:
                    geometry.edges.append([indices[-1], indices[0]])
            
            elif entity.dxftype() == 'POLYLINE':
                points = [(p.dxf.location.x, p.dxf.location.y, 
                          getattr(p.dxf.location, 'z', 0)) 
                         for p in entity.vertices]
                indices = [add_vertex(p[0], p[1], p[2]) for p in points]
                for i in range(len(indices)-1):
                    geometry.edges.append([indices[i], indices[i + 1]])
                # Close if it's a closed polyline
                if entity.is_closed and len(indices) > 0:
                    geometry.edges.append([indices[-1], indices[0]])
            
            elif entity.dxftype() == '3DFACE':
                vertices_idx = []
                for point in [entity.dxf.vtx0, entity.dxf.vtx1, entity.dxf.vtx2]:
                    idx = add_vertex(point.x, point.y, getattr(point, 'z', 0))
                    vertices_idx.append(idx)
                geometry.faces.append(vertices_idx)
            
            elif entity.dxftype() == 'CIRCLE':
                # Approximate circle with polygon
                center = entity.dxf.center
                radius = entity.dxf.radius
                segments = 32
                import math
                indices = []
                for i in range(segments):
                    angle = (2 * math.pi * i) / segments
                    x = center.x + radius * math.cos(angle)
                    y = center.y + radius * math.sin(angle)
                    z = getattr(center, 'z', 0)
                    indices.append(add_vertex(x, y, z))
                # Create edges (closed loop)
                for i in range(segments):
                    geometry.edges.append([indices[i], indices[(i + 1) % segments]])
        
        geometry.metadata = {
            'units': 'mm',
            'source': 'DXF',
            'layer_count': len(list(doc.layers)),
            'entity_count': len(list(msp))
        }
        
        return geometry
    
    def _parse_stl(self):
        """Parse STL file using numpy-stl"""
        try:
            from stl import mesh
            import numpy as np
        except ImportError:
            raise ImportError("numpy-stl required. Install: pip install numpy-stl")
        
        stl_mesh = mesh.Mesh.from_file(str(self.file_path))
        
        geometry = Geometry()
        
        # Extract vertices and faces from STL triangles
        vertex_map = {}  # To deduplicate vertices
        for i, triangle in enumerate(stl_mesh.vectors):
            face_indices = []
            for vertex in triangle:
                # Create a hashable key for the vertex
                vertex_tuple = tuple(vertex)
                if vertex_tuple not in vertex_map:
                    vertex_map[vertex_tuple] = len(geometry.vertices)
                    geometry.vertices.append(vertex.tolist())
                face_indices.append(vertex_map[vertex_tuple])
            geometry.faces.append(face_indices)
        
        geometry.metadata = {
            'units': 'mm',
            'source': 'STL',
            'triangle_count': len(stl_mesh.vectors),
            'unique_vertices': len(geometry.vertices)
        }
        
        return geometry
    
    def _parse_step(self):
        """Parse STEP file (placeholder for future implementation)"""
        # Requires pythonOCC-core library (large dependency)
        raise NotImplementedError("STEP parsing requires pythonOCC-core. Coming in future update.")
    
    def _parse_vbscript(self):
        """Extract geometry reference from existing HFSS VBScript"""
        geometry = Geometry()
        
        with open(self.file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        # Store VBScript content as metadata
        # The actual geometry will be imported by HFSS directly
        geometry.metadata = {
            'source': 'HFSS_VBScript',
            'script_content': content,
            'file_path': str(self.file_path)
        }
        
        # For VBScript, we don't extract vertices/faces
        # HFSS will handle the geometry directly
        
        return geometry
