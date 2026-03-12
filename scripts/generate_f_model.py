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
    
    # Separate optimization variables from non-optimizable variables (ground_plane, locked)
    optimization_ids = [vid for vid in ids if VARIABLE_DEFINITIONS[vid].get('category') == 'standard']
    non_optimizable_ids = [vid for vid in ids if VARIABLE_DEFINITIONS[vid].get('category') in ['ground_plane', 'locked']]
    
    # Note: Ground plane variables are NO LONGER automatically included
    # They will only be added if user explicitly selects/configures them via the UI
    # The update-ground-plane endpoint will add them to the file if user configures ground plane
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    has_ground_plane = any(VARIABLE_DEFINITIONS[vid].get('category') == 'ground_plane' for vid in non_optimizable_ids)
    ground_plane_note = "included (user configured)" if has_ground_plane else "not included"
    
    # Total optimizable variables (only standard category)
    total_opt_vars = len(optimization_ids)
    
    matlab_content = f"""function F_Model_Element(fid, seed, Units)
% Generated automatically by F_Model_Element Generator
% Timestamp: {timestamp}
% Selected variables: {total_opt_vars} standard variables (IDs may be non-sequential)
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
        # Generate formula dynamically from multiplier and offset
        offset_str = f"{var_def['offset']:+g}" if var_def['offset'] != 0 else ""
        formula = f"{var_def['multiplier']}*seed({var_id}){offset_str}"
        matlab_content += f"% ID {var_id:2d} -> seed({current_seed:2d}) -> {var_def['name']:15s} | Formula: {formula}\n"
        current_seed += 1
    
    matlab_content += "\n"
    
    # Generate variable assignments with seed reassignment (standard variables)
    current_seed = 1
    for var_id in optimization_ids:
        var_def = VARIABLE_DEFINITIONS[var_id]
        
        # Generate formula dynamically
        offset_str = f"{var_def['offset']:+g}" if var_def['offset'] != 0 else ""
        formula = f"{var_def['multiplier']}*seed({current_seed}){offset_str}"
        matlab_content += f"% Formula: {formula}\n"
        
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
    
    # Add non-optimizable variables (ground plane parameters, locked variables) with placeholder values
    # Ground plane variables will be updated by the update-ground-plane endpoint
    # Locked variables are display-only, not optimized
    # IMPORTANT: GND_xPos and GND_yPos represent the CENTER of the 25x25mm antenna
    for var_id in non_optimizable_ids:
        var_def = VARIABLE_DEFINITIONS[var_id]
        var_category = var_def.get('category', 'unknown')
        
        # Only process ground_plane variables (skip locked variables)
        if var_category != 'ground_plane':
            continue
            
        matlab_content += f"% Ground plane variable: {var_def['name']}\n"
        
        # Set default values for ground plane parameters based on variable name
        var_name = var_def['name']
        
        if var_name == 'Lgx':
            matlab_content += f"Lgx = 25;  % Ground plane length X (mm) - default/will be updated by UI\n"
            matlab_content += f"hfssChangeVar(fid,'Lgx',Lgx,'mm');\n\n"
        elif var_name == 'Lgy':
            matlab_content += f"Lgy = 25;  % Ground plane length Y (mm) - default/will be updated by UI\n"
            matlab_content += f"hfssChangeVar(fid,'Lgy',Lgy,'mm');\n\n"
        elif var_name == 'GND_xPos':
            matlab_content += f"GND_xPos = 12.5;  % Antenna X center position (mm) - default/will be updated by UI\n"
            matlab_content += f"hfssChangeVar(fid,'GND_xPos',GND_xPos,'mm');\n\n"
        elif var_name == 'GND_yPos':
            matlab_content += f"GND_yPos = 12.5;  % Antenna Y center position (mm) - default/will be updated by UI\n"
            matlab_content += f"hfssChangeVar(fid,'GND_yPos',GND_yPos,'mm');\n\n"
    
    matlab_content += "end\n"
    
    return matlab_content

def _write_matlab_file(output_file, content):
    """Write MATLAB content to file, stripping read-only attribute on Windows if needed."""
    if os.path.exists(output_file) and sys.platform == "win32":
        import stat
        try:
            if not (os.stat(output_file).st_mode & stat.S_IWRITE):
                print(f"⚠️ File is read-only, removing read-only attribute...")
                os.chmod(output_file, stat.S_IWRITE | stat.S_IREAD)
        except Exception as e:
            print(f"❌ Could not remove read-only attribute: {e}")
            raise
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(content)
    except PermissionError:
        print(f"❌ Permission denied: {output_file}")
        print(f"   Close the file if open, or run: attrib -r \"{output_file}\"")
        raise


def generate_f_model_tightened(tightened_ranges):
    """
    Generate F_Model_Element.m from progressive tuning tightened ranges.

    Seed domain is [-1, 1], so for physical range [lo, hi]:
        multiplier = (hi - lo) / 2
        offset     = (hi + lo) / 2

    All entries in tightened_ranges are treated as optimization variables,
    including variables that are normally 'locked' in the static config
    (e.g. bluel) but were tuned during progressive tuning.
    """
    import json
    if isinstance(tightened_ranges, str):
        tightened_ranges = json.loads(tightened_ranges)

    var_names    = list(tightened_ranges.keys())
    n            = len(var_names)
    timestamp    = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    name_to_cfg  = {v['name']: v for v in VARIABLE_DEFINITIONS.values()}

    lines = [
        "function F_Model_Element(fid, seed, Units)",
        "% Generated automatically by F_Model_Element Generator (Tightened Ranges Mode)",
        f"% Timestamp: {timestamp}",
        "% Source: Progressive Tuning tightened_ranges.csv",
        f"% Variables: {n}  |  Seed domain: [-1, 1]",
        "% Formula per variable: value = ((hi-lo)/2)*seed + (hi+lo)/2",
        "",
        "global numVar;",
        f"numVar = {n};",
        "Units = 'mm';",
        "",
        "% Variable mapping: index  name            [lo, hi]  ->  multiplier, offset",
    ]

    for i, name in enumerate(var_names, 1):
        lo   = float(tightened_ranges[name][0])
        hi   = float(tightened_ranges[name][1])
        mult = (hi - lo) / 2.0
        off  = (hi + lo) / 2.0
        lines.append(f"% {i:2d}.  {name:12s}  [{lo:.4g}, {hi:.4g}]"
                     f"  ->  mult={mult:.6g}, offset={off:.6g}")
    lines.append("")

    for i, name in enumerate(var_names, 1):
        lo        = float(tightened_ranges[name][0])
        hi        = float(tightened_ranges[name][1])
        mult      = (hi - lo) / 2.0
        off       = (hi + lo) / 2.0
        cfg       = name_to_cfg.get(name, {})
        precision = cfg.get('precision') or 3
        units     = cfg.get('units', 'mm')
        lines += [
            f"Value{i} = {mult:.6g}*seed({i})+{off:.6g};",
            f"num{i} = round(Value{i}, {precision});",
            f"hfssChangeVar(fid,'{name}',num{i},'{units}');",
            "",
        ]

    lines.append("end")
    return "\n".join(lines) + "\n"


def main():
    """
    Handle command-line arguments and generate F_Model_Element.m.

    Standard mode (existing MOEA setup):
        python generate_f_model.py <variable_ids_csv> [project_root]

    Tightened-ranges mode (post progressive tuning):
        python generate_f_model.py --tightened-file <json_path> <project_root>
    """
    print(f"Execution ID {EXECUTION_ID}: Starting main function")

    # ── Tightened-ranges mode ────────────────────────────────────────────────
    if len(sys.argv) == 4 and sys.argv[1] == '--tightened-file':
        import json
        try:
            json_file    = sys.argv[2]
            project_root = sys.argv[3]

            if not os.path.exists(project_root):
                print(f"Error: Project root not found: {project_root}")
                sys.exit(1)

            with open(json_file, 'r', encoding='utf-8') as f:
                tightened_ranges = json.load(f)

            print(f"Tightened-ranges mode: {len(tightened_ranges)} variables: "
                  f"{list(tightened_ranges.keys())}")

            matlab_content    = generate_f_model_tightened(tightened_ranges)
            function_hfss_dir = os.path.join(project_root, 'Function', 'HFSS')
            os.makedirs(function_hfss_dir, exist_ok=True)
            output_file = os.path.abspath(os.path.join(function_hfss_dir, 'F_Model_Element.m'))
            _write_matlab_file(output_file, matlab_content)
            print(f"F_Model_Element.m (tightened) written to: {output_file}")
        except Exception as e:
            print(f"Error: {e}")
            sys.exit(1)
        return

    # ── Standard mode ────────────────────────────────────────────────────────
    if len(sys.argv) not in [2, 3]:
        print("Usage (standard):  python generate_f_model.py <variable_ids> [project_root]")
        print("Usage (tightened): python generate_f_model.py --tightened-file <json_path> <project_root>")
        sys.exit(1)

    try:
        variable_ids_str = sys.argv[1]
        print(f"Processing variable IDs: {variable_ids_str}")

        if len(sys.argv) == 3:
            project_root = sys.argv[2]
            print(f"Using provided project root: {project_root}")
        else:
            project_root = os.path.dirname(os.path.dirname(__file__))
            print(f"Using default project root: {project_root}")

        if not os.path.exists(project_root):
            print(f"Error: Project root directory does not exist: {project_root}")
            sys.exit(1)

        matlab_content     = generate_f_model_element(variable_ids_str)
        variable_count     = len([x for x in variable_ids_str.split(',') if x.strip()])
        ids_list           = [int(x.strip()) for x in variable_ids_str.split(',') if x.strip()]
        ground_plane_count = sum(1 for vid in ids_list
                                 if VARIABLE_DEFINITIONS.get(vid, {}).get('category') == 'ground_plane')
        optimization_count = variable_count - ground_plane_count

        function_hfss_dir = os.path.join(project_root, 'Function', 'HFSS')
        os.makedirs(function_hfss_dir, exist_ok=True)
        print(f"Created/verified directory: {function_hfss_dir}")

        output_file = os.path.abspath(os.path.join(function_hfss_dir, 'F_Model_Element.m'))
        print("Creating new F_Model_Element.m file...")
        _write_matlab_file(output_file, matlab_content)

        print(f"F_Model_Element.m generated successfully")
        print(f"Output file: {output_file}")
        print(f"Total variables: {variable_count}  |  Optimization: {optimization_count}"
              f"  |  Ground plane: {ground_plane_count}")
        print(f"Seed range: 1-{optimization_count}")

    except Exception as e:
        print(f"Error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
