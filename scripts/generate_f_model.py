#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
F_Model_Element.m Generator Script

Generates MATLAB function with selected antenna variables

IMPORTANT: This script ONLY handles creation of new F_Model_Element files.
All backup and deletion of old files is handled by manage_optimization_data.py

Execution order: manage_optimization_data.py -> generate_f_model.py

REFACTORED: Now loads variable definitions from external JSON configuration file
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

# Import variable configuration loader
from variable_config_loader import VariableConfig

# Generate unique execution ID for debugging
EXECUTION_ID = str(uuid.uuid4())[:8]

print(f"Script execution started - ID: {EXECUTION_ID}")
print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]}")
print(f"Arguments: {sys.argv}")

# Load variable definitions from external configuration
try:
    config = VariableConfig()
    VARIABLE_DEFINITIONS = config.get_variable_definitions_dict()
    print(f"✅ Loaded {len(VARIABLE_DEFINITIONS)} variables from external configuration")
    print(f"   Configuration version: {config.get_metadata().get('version', 'unknown')}")
except Exception as e:
    print(f"❌ Failed to load variable configuration: {e}")
    sys.exit(1)

def generate_f_model_element(variable_ids):
    """Generate F_Model_Element.m content with selected variables and seed reassignment"""
    
    # Parse variable IDs
    if isinstance(variable_ids, str):
        if variable_ids.strip():
            ids = [int(x.strip()) for x in variable_ids.split(',') if x.strip()]
        else:
            ids = []
    else:
        ids = list(variable_ids)
    
    # Validate variable IDs using dictionary lookup (handles non-sequential IDs)
    invalid_ids = [vid for vid in ids if vid not in VARIABLE_DEFINITIONS]
    if invalid_ids:
        raise ValueError(f"Invalid variable IDs: {invalid_ids}")
    
    # System is robust: uses ID-based dictionary lookup, not array indices
    # Non-sequential IDs (e.g., gaps from deleted variables) are handled correctly
    
    # Sort IDs to ensure consistent ordering
    ids.sort()
    
    # Separate optimization variables from custom variables (ground plane) and material variables
    optimization_ids = [vid for vid in ids if not VARIABLE_DEFINITIONS[vid].get('custom', False) and VARIABLE_DEFINITIONS[vid].get('category') != 'material']
    custom_ids = [vid for vid in ids if VARIABLE_DEFINITIONS[vid].get('custom', False)]
    material_ids = [vid for vid in ids if VARIABLE_DEFINITIONS[vid].get('category') == 'material']
    
    # Note: Ground plane variables (83-86) are NO LONGER automatically included
    # They will only be added if user explicitly selects/configures them via the UI
    # The update-ground-plane endpoint will add them to the file if user configures ground plane
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    has_ground_plane = any(vid in [83, 84, 85, 86] for vid in custom_ids)
    has_material_vars = len(material_ids) > 0
    ground_plane_note = "included (user configured)" if has_ground_plane else "not included"
    material_note = f"included ({len(material_ids)} material properties)" if has_material_vars else "not included"
    
    # Total optimizable variables includes both standard and material variables
    total_opt_vars = len(optimization_ids) + len(material_ids)
    
    matlab_content = f"""function F_Model_Element(fid, seed, Units)
% Generated automatically by F_Model_Element Generator
% Timestamp: {timestamp}
% Selected variables: {total_opt_vars} out of 78 available (IDs may be non-sequential)
%   - Standard variables: {len(optimization_ids)}
%   - Material variables: {len(material_ids)}
% Ground plane parameters: {ground_plane_note}
% Seed reassignment: 1 to {total_opt_vars}
% Variable definitions loaded from: config/antenna_variables.json
% Note: System uses ID-based lookup (robust to gaps in ID sequence)

global numVar;
numVar = {total_opt_vars};
Units = 'mm';

"""
    
    # Add comments showing variable mapping (including material variables)
    matlab_content += f"% Variable mapping (ID -> Seed -> MATLAB Variable):\n"
    current_seed = 1
    
    # Map standard variables
    for var_id in optimization_ids:
        var_def = VARIABLE_DEFINITIONS[var_id]
        matlab_content += f"% ID {var_id:2d} -> seed({current_seed:2d}) -> {var_def['name']:15s} | Original: {var_def['formula']}\n"
        current_seed += 1
    
    # Map material variables
    for var_id in material_ids:
        var_def = VARIABLE_DEFINITIONS[var_id]
        material_name = var_def.get('material_name', 'unknown')
        property_name = var_def.get('material_property', 'unknown')
        matlab_content += f"% ID {var_id:2d} -> seed({current_seed:2d}) -> {material_name}.{property_name:10s} | Original: {var_def['formula']}\n"
        current_seed += 1
    
    matlab_content += "\n"
    
    # Generate variable assignments with seed reassignment (standard variables)
    current_seed = 1
    for var_id in optimization_ids:
        var_def = VARIABLE_DEFINITIONS[var_id]
        
        # Check if this is a special variable (category == 'special')
        is_special = var_def.get('category') == 'special'
        
        # Handle special variables (1-6) with old naming style
        if is_special:
            # Add original formula as comment for special variables
            matlab_content += f"% Original: {var_def['formula']}\n"
            
            # Get the custom variable name
            var_name = var_def.get('var_name', f'var{current_seed}')
            units = var_def.get('units', 'mm')
            
            if var_def.get('precision') is None:  # Variable 6 (brown) - no rounding
                matlab_content += f"{var_name} = {var_def['multiplier']}*seed({current_seed}){var_def['offset']:+g};\n"
            else:
                matlab_content += f"{var_name} = round({var_def['multiplier']}*seed({current_seed}){var_def['offset']:+g},{var_def['precision']});\n"
            
            matlab_content += f"hfssChangeVar(fid,'{var_def['name']}',{var_name},'{units}')\n\n"
        else:
            # Standard variables with modern naming
            # Add original formula as comment
            matlab_content += f"% Original: {var_def['formula']}\n"
            
            # Generate new formula with reassigned seed
            offset_str = f"{var_def['offset']:+g}" if var_def['offset'] != 0 else ""
            matlab_content += f"Value{current_seed} = {var_def['multiplier']}*seed({current_seed}){offset_str};\n"
            
            if var_def.get('precision') is not None:
                matlab_content += f"num{current_seed} = round(Value{current_seed}, {var_def['precision']});\n"
            else:
                matlab_content += f"num{current_seed} = Value{current_seed};\n"
            
            # Use the specific unit from variable definition instead of generic Units
            units = var_def.get('units', 'mm')
            matlab_content += f"hfssChangeVar(fid,'{var_def['name']}',num{current_seed},'{units}');\n\n"
        
        current_seed += 1
    
    # Generate material property assignments
    for var_id in material_ids:
        var_def = VARIABLE_DEFINITIONS[var_id]
        
        # Add original formula as comment
        matlab_content += f"% Material Property: {var_def['name']} - {var_def['description']}\n"
        matlab_content += f"% Original: {var_def['formula']}\n"
        
        # Get material properties
        material_name = var_def.get('material_name', 'unknown')
        property_name = var_def.get('material_property', 'permittivity')
        var_name = var_def.get('var_name', f'mat{current_seed}')
        units = var_def.get('units', '')
        
        # Generate new formula with reassigned seed
        offset_str = f"{var_def['offset']:+g}" if var_def['offset'] != 0 else ""
        matlab_content += f"{var_name} = {var_def['multiplier']}*seed({current_seed}){offset_str};\n"
        
        # Apply rounding if specified
        if var_def.get('precision') is not None:
            matlab_content += f"{var_name} = round({var_name}, {var_def['precision']});\n"
        
        # Use hfssChangeMaterialProperty to modify material property
        matlab_content += f"hfssChangeMaterialProperty(fid, '{material_name}', '{property_name}', {var_name}, '{units}');\n\n"
        
        current_seed += 1
    
    # Add custom variables (ground plane parameters) with placeholder values
    # These will be updated by the update-ground-plane endpoint
    # IMPORTANT: GND_xPos and GND_yPos represent the CENTER of the 25x25mm antenna
    for var_id in custom_ids:
        var_def = VARIABLE_DEFINITIONS[var_id]
        matlab_content += f"% Custom variable: {var_def['name']} - {var_def['formula']}\n"
        
        # Set default values for ground plane parameters
        if var_id == 83:  # Lgx
            matlab_content += f"Lgx = 25;  % Ground plane length X (mm) - default/will be updated by UI\n"
            matlab_content += f"hfssChangeVar(fid,'Lgx',Lgx,'mm');\n\n"
        elif var_id == 84:  # Lgy
            matlab_content += f"Lgy = 25;  % Ground plane length Y (mm) - default/will be updated by UI\n"
            matlab_content += f"hfssChangeVar(fid,'Lgy',Lgy,'mm');\n\n"
        elif var_id == 85:  # GND_xPos
            matlab_content += f"GND_xPos = 12.5;  % Antenna X center position (mm) - default/will be updated by UI\n"
            matlab_content += f"hfssChangeVar(fid,'GND_xPos',GND_xPos,'mm');\n\n"
        elif var_id == 86:  # GND_yPos
            matlab_content += f"GND_yPos = 12.5;  % Antenna Y center position (mm) - default/will be updated by UI\n"
            matlab_content += f"hfssChangeVar(fid,'GND_yPos',GND_yPos,'mm');\n\n"
    
    matlab_content += "end\n"
    
    return matlab_content

def main():
    """Main function to handle command line arguments and generate F_Model_Element.m"""
    
    print(f"Execution ID {EXECUTION_ID}: Starting main function")
    
    if len(sys.argv) not in [2, 3]:
        print("Usage: python generate_f_model.py <variable_ids> [project_root]")
        print("Example: python generate_f_model.py '1,2,3,4,5'")
        print("Example: python generate_f_model.py '1,2,3,4,5' 'C:\\Users\\cheon\\Downloads\\MOEA_D_DE_0923'")
        sys.exit(1)
    
    try:
        variable_ids_str = sys.argv[1]
        print(f"Processing variable IDs: {variable_ids_str}")
        
        # Determine project root
        if len(sys.argv) == 3:
            # Use provided project root path
            project_root = sys.argv[2]
            print(f"Using provided project root: {project_root}")
        else:
            # Fall back to parent of scripts directory (backward compatibility)
            project_root = os.path.dirname(os.path.dirname(__file__))
            print(f"Using default project root: {project_root}")
        
        # Validate project root exists
        if not os.path.exists(project_root):
            print(f"Error: Project root directory does not exist: {project_root}")
            sys.exit(1)
        
        # Generate MATLAB content
        matlab_content = generate_f_model_element(variable_ids_str)
        variable_count = len([x for x in variable_ids_str.split(',') if x.strip()])
        
        # Count custom and material variables for reporting
        ids_list = [int(x.strip()) for x in variable_ids_str.split(',') if x.strip()]
        custom_count = sum(1 for vid in ids_list if VARIABLE_DEFINITIONS.get(vid, {}).get('custom', False))
        material_count = sum(1 for vid in ids_list if VARIABLE_DEFINITIONS.get(vid, {}).get('category') == 'material')
        optimization_count = variable_count - custom_count
        
        # Create Function/HFSS directory if it doesn't exist
        function_hfss_dir = os.path.join(project_root, 'Function', 'HFSS')
        os.makedirs(function_hfss_dir, exist_ok=True)
        print(f"Created/verified directory: {function_hfss_dir}")
        
        # Set output file path in Function\HFSS directory
        output_file = os.path.join(function_hfss_dir, 'F_Model_Element.m')
        output_file = os.path.abspath(output_file)
        
        # Also check for .mlx file
        output_file_mlx = os.path.join(function_hfss_dir, 'F_Model_Element.mlx')
        output_file_mlx = os.path.abspath(output_file_mlx)
        
        # Create the new F_Model_Element.m file
        # Note: All backup and deletion of old files is handled by manage_optimization_data.py
        print("Creating new F_Model_Element.m file...")
        
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
                print(f"   Please manually remove read-only attribute from:")
                print(f"   {output_file}")
                raise
        
        # Write new file to Function\HFSS directory
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(matlab_content)
        except PermissionError as e:
            print(f"❌ Permission denied when writing file")
            print(f"   File: {output_file}")
            print(f"   Possible causes:")
            print(f"   1. File is open in MATLAB or another editor")
            print(f"   2. File is read-only (check Properties > Attributes)")
            print(f"   3. Antivirus is blocking the write operation")
            print(f"   4. Insufficient user permissions")
            print(f"   Solution: Close the file if it's open, or run: attrib -r \"{output_file}\"")
            raise
        
        print(f"F_Model_Element.m generated successfully")
        print(f"Output file: {output_file}")
        print(f"Total variables selected: {variable_count}")
        print(f"Optimization variables: {optimization_count - material_count}")
        print(f"Material variables: {material_count}")
        print(f"Custom variables (ground plane): {custom_count}")
        print(f"Seed range: 1-{optimization_count + material_count}")
        
    except Exception as e:
        print(f"Error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
