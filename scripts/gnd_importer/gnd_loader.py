"""
GND Loader - Parse uploaded ground plane geometry files
Supports: DXF, STL, STEP, HFSS VBScript
"""

import sys
import json
from pathlib import Path

# Handle both direct script execution and module import
if __name__ == '__main__':
    # Running as script - add parent directory to path
    script_dir = Path(__file__).parent
    sys.path.insert(0, str(script_dir))
    from geometry_parser import GeometryParser
    from gnd_validator import GNDValidator
else:
    # Running as module - use relative imports
    from .geometry_parser import GeometryParser
    from .gnd_validator import GNDValidator

class GNDLoader:
    def __init__(self, file_path, project_path):
        self.file_path = Path(file_path)
        self.project_path = Path(project_path)
        self.format = self.file_path.suffix.lower()
        self.geometry = None
        self.bounds = None
        
    def load(self):
        """Load and parse GND geometry file"""
        try:
            parser = GeometryParser(self.file_path)
            self.geometry = parser.parse()
            
            # Validate geometry
            validator = GNDValidator(self.geometry)
            validation_report = validator.get_report()
            
            if not validation_report['valid']:
                raise ValueError(f"Invalid geometry: {', '.join(validation_report['errors'])}")
            
            # Calculate bounding box
            self.bounds = self.calculate_bounds()
            
            return {
                'geometry': self.geometry.to_dict(),
                'bounds': self.bounds,
                'format': self.format,
                'vertex_count': len(self.geometry.vertices),
                'face_count': len(self.geometry.faces) if self.geometry.faces else 0,
                'edge_count': len(self.geometry.edges) if self.geometry.edges else 0,
                'validation': validation_report
            }
        except Exception as e:
            raise Exception(f"Failed to load GND file: {str(e)}")
    
    def calculate_bounds(self):
        """Calculate bounding box of geometry"""
        vertices = self.geometry.vertices
        if not vertices:
            return None
        
        x_coords = [v[0] for v in vertices]
        y_coords = [v[1] for v in vertices]
        z_coords = [v[2] if len(v) > 2 else 0 for v in vertices]
        
        return {
            'min_x': float(min(x_coords)),
            'max_x': float(max(x_coords)),
            'min_y': float(min(y_coords)),
            'max_y': float(max(y_coords)),
            'min_z': float(min(z_coords)) if z_coords else 0,
            'max_z': float(max(z_coords)) if z_coords else 0,
            'width': float(max(x_coords) - min(x_coords)),
            'height': float(max(y_coords) - min(y_coords)),
            'depth': float(max(z_coords) - min(z_coords)) if z_coords else 0,
            'center': [
                float((min(x_coords) + max(x_coords)) / 2),
                float((min(y_coords) + max(y_coords)) / 2),
                float((min(z_coords) + max(z_coords)) / 2) if z_coords else 0
            ]
        }

def main():
    if len(sys.argv) < 3:
        print(json.dumps({'success': False, 'error': 'Missing arguments. Usage: python gnd_loader.py <file_path> <project_path>'}))
        sys.exit(1)
    
    file_path = sys.argv[1]
    project_path = sys.argv[2]
    
    try:
        loader = GNDLoader(file_path, project_path)
        result = loader.load()
        print(json.dumps({'success': True, **result}, indent=2))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}, indent=2))
        sys.exit(1)

if __name__ == '__main__':
    main()
