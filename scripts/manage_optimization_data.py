#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Optimization Data Management Script
Handles backup and removal of optimization folders and F_Model_Element files

IMPORTANT: This script handles ALL backup and deletion operations including:
- Optimization folder backup/removal  
- F_Model_Element files backup/removal (from all locations)
- Legacy file cleanup
Execution order: manage_optimization_data.py → generate_f_model.py
"""

import sys
import os
import shutil
import json
from datetime import datetime
from pathlib import Path

# Set UTF-8 encoding for console output
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

class OptimizationDataManager:
    """Handles optimization data backup and removal operations"""
    
    def __init__(self, project_root):
        self.project_root = Path(project_root)
        self.optimization_folder = self.project_root / 'Optimization'
        self.base_backup_folder = self.project_root / 'backup_Optimization'
        self.results = {
            'success': False,
            'message': '',
            'action': '',
            'optimization_exists': False,
            'backup_created': False,
            'optimization_removed': False,
            'fmodel_backup_created': False,
            'fmodel_removed': False,
            'backup_path': '',
            'stats': {},
            'errors': [],
            'timestamp': datetime.now().isoformat()
        }
        
    def get_directory_stats(self, dir_path):
        """Get directory statistics (file count and total size)"""
        total_size = 0
        file_count = 0
        
        try:
            for root, dirs, files in os.walk(dir_path):
                for file in files:
                    file_path = os.path.join(root, file)
                    try:
                        file_stat = os.stat(file_path)
                        total_size += file_stat.st_size
                        file_count += 1
                    except OSError as e:
                        print(f"Warning: Could not stat file {file_path}: {e}")
        except OSError as e:
            print(f"Error accessing directory {dir_path}: {e}")
            
        return {
            'file_count': file_count,
            'total_size_bytes': total_size,
            'total_size_mb': round(total_size / (1024 * 1024), 2)
        }
    
    def find_fmodel_files(self):
        """Find ALL F_Model_Element files in project root and Function/HFSS, including backups"""
        fmodel_files = []
        
        # Check project root for current and backup files
        for ext in ['.m', '.mlx']:
            # Main files
            root_file = self.project_root / f'F_Model_Element{ext}'
            if root_file.exists():
                fmodel_files.append(root_file)
            
            # Legacy backup files (like F_Model_Element.mlx.backup)
            backup_file = self.project_root / f'F_Model_Element{ext}.backup'
            if backup_file.exists():
                fmodel_files.append(backup_file)
        
        # Check Function/HFSS directory for all files
        function_hfss_dir = self.project_root / 'Function' / 'HFSS'
        if function_hfss_dir.exists():
            # Current files
            for ext in ['.m', '.mlx']:
                hfss_file = function_hfss_dir / f'F_Model_Element{ext}'
                if hfss_file.exists():
                    fmodel_files.append(hfss_file)
            
            # All backup files (F_Model_Element.m.backup_*, F_Model_Element.mlx.backup_*)
            try:
                for file_path in function_hfss_dir.iterdir():
                    if file_path.is_file() and (
                        file_path.name.startswith('F_Model_Element.m.backup_') or
                        file_path.name.startswith('F_Model_Element.mlx.backup_')
                    ):
                        fmodel_files.append(file_path)
            except Exception as e:
                print(f'⚠️ Warning: Could not scan Function/HFSS directory: {e}')
        
        return fmodel_files
    
    def create_unique_backup_path(self):
        """Create a unique backup folder path"""
        backup_path = self.base_backup_folder
        counter = 1
        
        # Add date if base path exists
        if backup_path.exists():
            date_str = datetime.now().strftime('%Y-%m-%d')
            backup_path = Path(str(self.base_backup_folder) + f'_{date_str}')
        
        # Add counter if date path exists
        while backup_path.exists():
            date_str = datetime.now().strftime('%Y-%m-%d')
            backup_path = Path(str(self.base_backup_folder) + f'_{date_str}_{counter}')
            counter += 1
        
        return backup_path
    
    def backup_optimization_folder(self):
        """Create backup of optimization folder"""
        if not self.optimization_folder.exists():
            self.results['optimization_exists'] = False
            self.results['message'] = 'No optimization folder found - nothing to backup'
            print('ℹ️ No optimization folder exists')
            return True
        
        self.results['optimization_exists'] = True
        
        # Get optimization folder stats
        opt_stats = self.get_directory_stats(self.optimization_folder)
        self.results['stats']['optimization'] = opt_stats
        
        print(f'📊 Optimization folder: {opt_stats["file_count"]} files, {opt_stats["total_size_mb"]} MB')
        
        # Create unique backup path
        backup_path = self.create_unique_backup_path()
        self.results['backup_path'] = str(backup_path)
        
        try:
            # Copy optimization folder
            print(f'💾 Creating backup: {backup_path}')
            shutil.copytree(self.optimization_folder, backup_path)
            
            # Backup F_Model_Element files
            fmodel_files = self.find_fmodel_files()
            fmodel_backup_info = []
            
            for fmodel_file in fmodel_files:
                backup_file_path = backup_path / fmodel_file.name
                try:
                    shutil.copy2(fmodel_file, backup_file_path)
                    file_stats = os.stat(fmodel_file)
                    fmodel_backup_info.append({
                        'original_path': str(fmodel_file),
                        'backup_path': str(backup_file_path),
                        'size': file_stats.st_size
                    })
                    print(f'✅ F_Model_Element backup: {fmodel_file.name}')
                except Exception as e:
                    error_msg = f'Failed to backup {fmodel_file}: {e}'
                    print(f'⚠️ {error_msg}')
                    self.results['errors'].append(error_msg)
            
            if fmodel_backup_info:
                self.results['fmodel_backup_created'] = True
                self.results['fmodel_backup_info'] = fmodel_backup_info
            
            # Get backup folder stats
            backup_stats = self.get_directory_stats(backup_path)
            self.results['stats']['backup'] = backup_stats
            
            self.results['backup_created'] = True
            print(f'✅ Backup created successfully: {backup_path}')
            return True
            
        except Exception as e:
            error_msg = f'Failed to create backup: {e}'
            print(f'❌ {error_msg}')
            self.results['errors'].append(error_msg)
            return False
    
    def remove_optimization_data(self):
        """Remove optimization folder and F_Model_Element files"""
        removed_items = []
        
        # Remove optimization folder
        if self.optimization_folder.exists():
            try:
                print(f'🗑️ Removing optimization folder: {self.optimization_folder}')
                shutil.rmtree(self.optimization_folder)
                removed_items.append(str(self.optimization_folder))
                self.results['optimization_removed'] = True
                print('✅ Optimization folder removed')
            except Exception as e:
                error_msg = f'Failed to remove optimization folder: {e}'
                print(f'❌ {error_msg}')
                self.results['errors'].append(error_msg)
        
        # Remove F_Model_Element files
        fmodel_files = self.find_fmodel_files()
        fmodel_removed_count = 0
        
        for fmodel_file in fmodel_files:
            try:
                print(f'🗑️ Removing F_Model_Element file: {fmodel_file}')
                fmodel_file.unlink()
                removed_items.append(str(fmodel_file))
                fmodel_removed_count += 1
                print(f'✅ Removed: {fmodel_file.name}')
            except Exception as e:
                error_msg = f'Failed to remove {fmodel_file}: {e}'
                print(f'⚠️ {error_msg}')
                self.results['errors'].append(error_msg)
        
        if fmodel_removed_count > 0:
            self.results['fmodel_removed'] = True
            self.results['fmodel_removed_count'] = fmodel_removed_count
        
        self.results['removed_items'] = removed_items
        return len(removed_items) > 0 or len(self.results['errors']) == 0
    
    def backup_only(self):
        """Perform backup-only operation"""
        print('🔄 Starting backup-only operation...')
        self.results['action'] = 'backup-only'
        
        success = self.backup_optimization_folder()
        
        if success and self.results['optimization_exists']:
            stats = self.results['stats'].get('optimization', {})
            self.results['message'] = f"✅ Optimization data backed up successfully ({stats.get('file_count', 0)} files, {stats.get('total_size_mb', 0)} MB)"
        elif success:
            self.results['message'] = "ℹ️ No optimization data found to backup"
        else:
            self.results['message'] = "❌ Failed to backup optimization data"
        
        self.results['success'] = success
        return success
    
    def backup_and_remove(self):
        """Perform backup and remove operation"""
        print('🔄 Starting backup and remove operation...')
        self.results['action'] = 'backup-and-remove'
        
        # First backup
        backup_success = self.backup_optimization_folder()
        
        if not backup_success:
            self.results['message'] = "❌ Failed to create backup - aborting removal for safety"
            self.results['success'] = False
            return False
        
        # If no optimization folder exists, still remove F_Model files for clean start
        if not self.results['optimization_exists']:
            print('ℹ️ No optimization folder exists, but checking for F_Model files to remove...')
            # Still remove F_Model_Element files for clean start
            fmodel_files = self.find_fmodel_files()
            fmodel_removed_count = 0
            
            for fmodel_file in fmodel_files:
                try:
                    print(f'🗑️ Removing F_Model_Element file: {fmodel_file}')
                    fmodel_file.unlink()
                    fmodel_removed_count += 1
                    print(f'✅ Removed: {fmodel_file.name}')
                except Exception as e:
                    error_msg = f'Failed to remove {fmodel_file}: {e}'
                    print(f'⚠️ {error_msg}')
                    self.results['errors'].append(error_msg)
            
            if fmodel_removed_count > 0:
                self.results['fmodel_removed'] = True
                self.results['fmodel_removed_count'] = fmodel_removed_count
                self.results['message'] = f"ℹ️ No optimization folder found, but removed {fmodel_removed_count} old F_Model_Element files for clean start"
            else:
                self.results['message'] = "ℹ️ No optimization data or F_Model files found - ready for fresh start"
            
            self.results['success'] = True
            return True
        
        # Then remove optimization folder
        remove_success = self.remove_optimization_data()
        
        # Generate final message
        stats = self.results['stats'].get('optimization', {})
        if backup_success and remove_success:
            fmodel_text = f" + {self.results.get('fmodel_removed_count', 0)} F_Model files" if self.results.get('fmodel_removed') else ""
            self.results['message'] = f"✅ Optimization data backed up and removed successfully ({stats.get('file_count', 0)} files, {stats.get('total_size_mb', 0)} MB){fmodel_text}"
        elif backup_success:
            self.results['message'] = f"⚠️ Backup successful but removal had issues ({len(self.results['errors'])} errors)"
        else:
            self.results['message'] = "❌ Operation failed"
        
        self.results['success'] = backup_success and (remove_success or not self.results['optimization_exists'])
        return self.results['success']

def print_usage():
    """Print usage information"""
    print("Usage: python manage_optimization_data.py <action> <project_root>")
    print()
    print("Actions:")
    print("  backup-only      - Create backup of optimization data without removing originals")
    print("  backup-and-remove - Create backup then remove original optimization data")
    print()
    print("Arguments:")
    print("  project_root     - Path to the project root directory")
    print()
    print("Examples:")
    print("  python manage_optimization_data.py backup-only 'C:\\ANSYS_electronic_FYP\\MOEA_D_DE_0923'")
    print("  python manage_optimization_data.py backup-and-remove 'C:\\ANSYS_electronic_FYP\\MOEA_D_DE_0923'")

def main():
    """Main function to handle command line execution"""
    if len(sys.argv) != 3:
        print_usage()
        sys.exit(1)
    
    action = sys.argv[1].lower()
    project_root = sys.argv[2]
    
    # Validate action
    if action not in ['backup-only', 'backup-and-remove']:
        print(f"❌ Error: Invalid action '{action}'")
        print("Valid actions: backup-only, backup-and-remove")
        sys.exit(1)
    
    # Validate project root
    if not os.path.exists(project_root):
        print(f"❌ Error: Project root directory does not exist: {project_root}")
        sys.exit(1)
    
    print(f"🔧 Managing optimization data for project: {project_root}")
    print(f"⚙️ Action: {action}")
    print()
    
    try:
        # Create manager and execute action
        manager = OptimizationDataManager(project_root)
        
        if action == 'backup-only':
            success = manager.backup_only()
        else:  # backup-and-remove
            success = manager.backup_and_remove()
        
        # Print results
        print()
        print("=" * 60)
        print("OPERATION RESULTS:")
        print("=" * 60)
        print(f"Success: {manager.results['success']}")
        print(f"Message: {manager.results['message']}")
        print(f"Action: {manager.results['action']}")
        print(f"Backup Created: {manager.results['backup_created']}")
        if manager.results['backup_created']:
            print(f"Backup Location: {manager.results['backup_path']}")
        print(f"Optimization Removed: {manager.results['optimization_removed']}")
        print(f"F_Model Files Removed: {manager.results['fmodel_removed']}")
        
        if manager.results['errors']:
            print(f"Errors ({len(manager.results['errors'])}):")
            for error in manager.results['errors']:
                print(f"  - {error}")
        
        # Output JSON for programmatic use
        print()
        print("JSON OUTPUT:")
        print(json.dumps(manager.results, indent=2))
        
        sys.exit(0 if success else 1)
        
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        error_result = {
            'success': False,
            'message': f'Unexpected error: {e}',
            'action': action,
            'errors': [str(e)],
            'timestamp': datetime.now().isoformat()
        }
        print()
        print("JSON OUTPUT:")
        print(json.dumps(error_result, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    main()