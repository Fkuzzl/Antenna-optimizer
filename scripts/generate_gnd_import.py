#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
F_GND_Import.m Generator Script

Generates MATLAB function for custom DXF ground plane import with user-specified positioning

This script creates the F_GND_Import.m file with:
- Custom DXF file path
- User-specified antenna position (GND_xPos, GND_yPos)
- Fixed HFSS variables (thick, H2, probe, Rg, Hg)

Usage:
    python generate_gnd_import.py <dxf_path> <gnd_x_pos> <gnd_y_pos> <project_root>

Example:
    python generate_gnd_import.py "C:/uploads/gnd_files/custom_gnd.dxf" 40.5 35.2 "C:/MOEA_D_DE_0923"
"""

import sys
import os
import uuid
from datetime import datetime

# Set UTF-8 encoding for console output
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Generate unique execution ID for debugging
EXECUTION_ID = str(uuid.uuid4())[:8]

print(f"Script execution started - ID: {EXECUTION_ID}")
print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]}")
print(f"Arguments: {sys.argv}")


def generate_gnd_import_function(dxf_path=None, gnd_x_pos=None, gnd_y_pos=None):
    """
    Generate F_GND_Import.m content with custom DXF path and antenna positioning
    
    Parameters:
    -----------
    dxf_path : str or None
        Full path to the DXF file (will be converted to forward slashes for MATLAB)
        If None, generates empty function that does nothing
    gnd_x_pos : float or None
        X position for antenna center on ground plane (mm)
    gnd_y_pos : float or None
        Y position for antenna center on ground plane (mm)
    
    Returns:
    --------
    str : MATLAB function code
    """
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # If no DXF path provided, generate empty function
    if dxf_path is None or dxf_path == '' or dxf_path.lower() == 'none':
        matlab_content = f"""function F_GND_Import(fid, Units)
% Custom ground plane import (DISABLED)
% Generated: {timestamp}
%
% No custom DXF ground plane specified.
% This function intentionally does nothing to avoid import errors.
% User chose parametric ground plane or no custom import.

% Do nothing - no custom GND import
fprintf('No custom ground plane to import\\n');

end
"""
        return matlab_content
    
    # Convert Windows backslashes to forward slashes for MATLAB compatibility
    matlab_dxf_path = dxf_path.replace('\\', '/')
    
    # Format floating point values
    x_pos_str = f"{float(gnd_x_pos):.2f}"
    y_pos_str = f"{float(gnd_y_pos):.2f}"
    
    # Convert to absolute path for DXF file
    absolute_dxf_path = os.path.abspath(dxf_path).replace('\\', '/')
    
    matlab_content = f"""function F_GND_Import(fid, Units)
% Import DXF ground plane and complete setup
% Generated: {timestamp}
% F_GND_Import(fid, Units)
%
% All operations now handled by hfssImportAndSetupGND:
% - Delete old GND
% - ImportDXF (creates 3D solid)
% - Rename to GND
% - Move to position (-GND_xPos, -GND_yPos, -H2)
% - Create cylinder subtract (probe, 0, -H2) with radius Rg, height -Hg
% - Subtract cylinder from GND
% - Assign pec material with SolveInside=false
%
% Parameters:
%   fid       - File identifier for VBScript output
%   DxfPath   - Full path to DXF file (use forward slashes)
%   GND_xPos  - X position for ground plane (will be negated)
%   GND_yPos  - Y position for ground plane (will be negated)
%   Units     - HFSS units (e.g., 'mm')

DxfPath = "{absolute_dxf_path}";
% Assign negative positions so the generated values are negative (GND is placed using negative offsets)
GND_xPos = -{x_pos_str};
GND_yPos = -{y_pos_str};

% Use hfssImportAndSetupGND which will handle import, rename, move and material assignment
hfssImportAndSetupGND(fid, DxfPath, GND_xPos, GND_yPos, Units);

end
"""
    
    return matlab_content


def main():
    """Main function to handle command line arguments and generate F_GND_Import.m"""
    
    print(f"Execution ID {EXECUTION_ID}: Starting main function")
    
    # Support both 2 arguments (clear mode) and 5 arguments (import mode)
    if len(sys.argv) not in [2, 5]:
        print("Usage:")
        print("  Clear mode:  python generate_gnd_import.py <project_root>")
        print("  Import mode: python generate_gnd_import.py <dxf_path> <gnd_x_pos> <gnd_y_pos> <project_root>")
        print("Example (clear):  python generate_gnd_import.py 'C:/MOEA_D_DE_0923'")
        print("Example (import): python generate_gnd_import.py 'C:/uploads/gnd_files/custom_gnd.dxf' 40.5 35.2 'C:/MOEA_D_DE_0923'")
        sys.exit(1)
    
    try:
        # Clear mode - generate empty F_GND_Import.m
        if len(sys.argv) == 2:
            project_root = sys.argv[1]
            
            print(f"Clear mode: Generating empty F_GND_Import.m")
            print(f"  Project Root: {project_root}")
            
            # Validate project root exists
            if not os.path.exists(project_root):
                print(f"Error: Project root directory does not exist: {project_root}")
                sys.exit(1)
            
            # Generate empty MATLAB function
            matlab_content = generate_gnd_import_function(dxf_path=None, gnd_x_pos=None, gnd_y_pos=None)
            
            # Create Function/HFSS directory if it doesn't exist
            function_hfss_dir = os.path.join(project_root, 'Function', 'HFSS')
            os.makedirs(function_hfss_dir, exist_ok=True)
            print(f"Created/verified directory: {function_hfss_dir}")
            
            # Set output file path in Function\HFSS directory
            output_file = os.path.join(function_hfss_dir, 'F_GND_Import.m')
            output_file = os.path.abspath(output_file)
            
            # Write the empty F_GND_Import.m file
            print("Creating empty F_GND_Import.m file...")
            
            # Handle read-only files by removing read-only attribute
            if os.path.exists(output_file):
                try:
                    # On Windows, remove read-only attribute if present
                    if sys.platform == "win32":
                        import stat
                        current_mode = os.stat(output_file).st_mode
                        if not (current_mode & stat.S_IWRITE):
                            print(f"⚠️ File is read-only, removing read-only attribute...")
                            os.chmod(output_file, stat.S_IWRITE | stat.S_IREAD)
                            print(f"✅ Read-only attribute removed")
                except Exception as perm_error:
                    print(f"❌ Could not remove read-only attribute: {perm_error}")
            
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(matlab_content)
            
            print(f"✅ F_GND_Import.m cleared successfully")
            print(f"   Output file: {output_file}")
            print(f"   Mode: No custom GND import (function does nothing)")
        
        # Import mode - generate F_GND_Import.m with custom DXF
        else:
            dxf_path = sys.argv[1]
            gnd_x_pos = float(sys.argv[2])
            gnd_y_pos = float(sys.argv[3])
            project_root = sys.argv[4]
            
            print(f"Import mode: Processing custom GND import")
            print(f"  DXF Path: {dxf_path}")
            print(f"  Antenna Position: ({gnd_x_pos}, {gnd_y_pos}) mm")
            print(f"  Project Root: {project_root}")
            
            # Validate DXF file exists
            if not os.path.exists(dxf_path):
                print(f"Warning: DXF file does not exist: {dxf_path}")
                print(f"         File will be referenced anyway (may exist at runtime)")
            
            # Validate project root exists
            if not os.path.exists(project_root):
                print(f"Error: Project root directory does not exist: {project_root}")
                sys.exit(1)
            
            # Generate MATLAB content
            matlab_content = generate_gnd_import_function(dxf_path, gnd_x_pos, gnd_y_pos)
            
            # Create Function/HFSS directory if it doesn't exist
            function_hfss_dir = os.path.join(project_root, 'Function', 'HFSS')
            os.makedirs(function_hfss_dir, exist_ok=True)
            print(f"Created/verified directory: {function_hfss_dir}")
            
            # Set output file path in Function\HFSS directory
            output_file = os.path.join(function_hfss_dir, 'F_GND_Import.m')
            output_file = os.path.abspath(output_file)
            
            # Write the new F_GND_Import.m file
            print("Creating F_GND_Import.m file...")
            
            # Handle read-only files by removing read-only attribute
            if os.path.exists(output_file):
                try:
                    # On Windows, remove read-only attribute if present
                    if sys.platform == "win32":
                        import stat
                        current_mode = os.stat(output_file).st_mode
                        if not (current_mode & stat.S_IWRITE):
                            print(f"⚠️ File is read-only, removing read-only attribute...")
                            os.chmod(output_file, stat.S_IWRITE | stat.S_IREAD)
                            print(f"✅ Read-only attribute removed")
                except Exception as perm_error:
                    print(f"❌ Could not remove read-only attribute: {perm_error}")
            
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(matlab_content)
            
            print(f"✅ F_GND_Import.m generated successfully")
            print(f"   Output file: {output_file}")
            print(f"   DXF File: {dxf_path}")
            print(f"   Antenna Position: ({gnd_x_pos}, {gnd_y_pos}) mm")
            print(f"   GND Import Position: ({-gnd_x_pos}, {-gnd_y_pos}, -H2)")
        
    except ValueError as e:
        print(f"❌ Error: Invalid position values. X and Y must be numeric.")
        print(f"   Details: {str(e)}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
