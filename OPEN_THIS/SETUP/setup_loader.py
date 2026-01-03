#!/usr/bin/env python3
"""
Setup Configuration Loader (Python)
Loads and validates configuration from setup_variable.json
"""

import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Any


class SetupConfigLoader:
    """Loader for setup_variable.json configuration"""
    
    def __init__(self, config_path: Optional[str] = None):
        """
        Initialize configuration loader
        
        Args:
            config_path: Optional path to setup_variable.json
        """
        if config_path is None:
            # Default to OPEN_THIS/SETUP directory
            script_dir = Path(__file__).parent
            config_path = script_dir / 'setup_variable.json'
        
        self.config_path = Path(config_path)
        self.config: Optional[Dict[str, Any]] = None
        self.loaded = False
    
    def load(self) -> Dict[str, Any]:
        """
        Load configuration from file
        
        Returns:
            Configuration dictionary
        """
        if self.loaded and self.config:
            return self.config
        
        try:
            if not self.config_path.exists():
                raise FileNotFoundError(f'Configuration file not found: {self.config_path}')
            
            with open(self.config_path, 'r', encoding='utf-8') as f:
                self.config = json.load(f)
            
            # Sync simplified top-level fields to internal config structure
            if 'YOUR_IP_ADDRESS' in self.config:
                self.config['server']['host'] = self.config['YOUR_IP_ADDRESS']
                ip_parts = self.config['YOUR_IP_ADDRESS'].rsplit('.', 1)
                self.config['network']['subnet'] = ip_parts[0] + '.x'
                port = self.config.get('SERVER_PORT', 3001)
                self.config['network']['allowed_origins'][0] = f"http://{self.config['YOUR_IP_ADDRESS']}:{port}"
            if 'SERVER_PORT' in self.config:
                self.config['server']['port'] = self.config['SERVER_PORT']
            if 'MATLAB_PATH' in self.config:
                self.config['matlab']['installation_paths'] = [self.config['MATLAB_PATH']]
            if 'PYTHON_PATH' in self.config:
                self.config['python']['executable'] = self.config['PYTHON_PATH']
            
            self.loaded = True
            print(f'✅ Loaded configuration from {self.config_path.name}')
            return self.config
        
        except Exception as e:
            print(f'❌ Failed to load configuration: {e}', file=sys.stderr)
            raise
    
    def get_matlab_paths(self) -> List[str]:
        """Get MATLAB installation paths"""
        config = self.load()
        return config.get('matlab', {}).get('installation_paths', [])
    
    def get_python_executable(self) -> str:
        """Get Python executable path"""
        config = self.load()
        return config.get('python', {}).get('executable', 'python')
    
    def get_server_config(self) -> Dict[str, Any]:
        """Get server configuration"""
        config = self.load()
        server = config.get('server', {})
        host = server.get('host')
        port = server.get('port', 3001)
        
        if not host:
            raise ValueError('Server host not configured in setup_variable.json. Please set server.host to your PC\'s IP address.')
        
        return {
            'host': host,
            'port': port,
            'url': f'http://{host}:{port}',
            'websocket': {
                'enabled': server.get('websocket', {}).get('enabled', True),
                'path': server.get('websocket', {}).get('path', '/ws'),
                'url': f'ws://{host}:{port}{server.get("websocket", {}).get("path", "/ws")}'
            }
        }
    
    def get_hfss_config(self) -> Dict[str, Any]:
        """Get HFSS configuration"""
        config = self.load()
        return config.get('hfss', {})
    
    def get_project_paths(self) -> Dict[str, Path]:
        """Get project paths configuration"""
        config = self.load()
        paths = config.get('paths', {})
        
        # Get project root (usually current directory)
        project_root = Path.cwd()
        
        return {
            'project_root': project_root / paths.get('project_root', '.'),
            'uploads_dir': project_root / paths.get('uploads_dir', './uploads'),
            'gnd_files_dir': project_root / paths.get('gnd_files_dir', './uploads/gnd_files'),
            'config_dir': project_root / paths.get('config_dir', './config'),
            'scripts_dir': project_root / paths.get('scripts_dir', './scripts'),
            'test_files_dir': project_root / paths.get('test_files_dir', './test_files')
        }
    
    def get_performance_settings(self) -> Dict[str, Any]:
        """Get performance settings"""
        config = self.load()
        return config.get('performance', {
            'cache_ttl_ms': 1000,
            'websocket_heartbeat_ms': 2000,
            'status_polling_interval_ms': 3000,
            'max_file_upload_mb': 50
        })
    
    def validate(self) -> Dict[str, Any]:
        """
        Validate configuration
        
        Returns:
            Dictionary with validation result
        """
        errors = []
        warnings = []
        
        try:
            config = self.load()
            
            # Check required fields
            if 'matlab' not in config or 'installation_paths' not in config.get('matlab', {}):
                errors.append('Missing MATLAB installation paths')
            
            if 'server' not in config or not config.get('server', {}).get('host') or not config.get('server', {}).get('port'):
                errors.append('Missing server configuration')
            
            if 'python' not in config or not config.get('python', {}).get('executable'):
                errors.append('Missing Python executable configuration')
            
            # Check if MATLAB exists
            matlab_paths = self.get_matlab_paths()
            valid_matlab_path = None
            for matlab_path in matlab_paths:
                if Path(matlab_path).exists():
                    valid_matlab_path = matlab_path
                    break
            
            if not valid_matlab_path:
                warnings.append('MATLAB installation not found in configured paths')
            
            return {
                'valid': len(errors) == 0,
                'errors': errors,
                'warnings': warnings
            }
        
        except Exception as e:
            return {
                'valid': False,
                'errors': [str(e)],
                'warnings': []
            }
    
    def get_config(self) -> Dict[str, Any]:
        """Get full configuration object"""
        return self.load()


# Singleton instance
_setup_config_instance = None


def get_setup_config(config_path: Optional[str] = None) -> SetupConfigLoader:
    """
    Get singleton instance of SetupConfigLoader
    
    Args:
        config_path: Optional path to configuration file
    
    Returns:
        SetupConfigLoader instance
    """
    global _setup_config_instance
    
    if _setup_config_instance is None:
        _setup_config_instance = SetupConfigLoader(config_path)
    
    return _setup_config_instance


# Convenience functions
def get_matlab_paths() -> List[str]:
    """Get MATLAB installation paths"""
    return get_setup_config().get_matlab_paths()


def get_server_url() -> str:
    """Get server URL"""
    return get_setup_config().get_server_config()['url']


def get_python_executable() -> str:
    """Get Python executable path"""
    return get_setup_config().get_python_executable()


if __name__ == '__main__':
    # Test configuration loading
    loader = get_setup_config()
    
    print('\n=== Setup Configuration ===')
    print(f'Config file: {loader.config_path}')
    
    # Validate
    validation = loader.validate()
    print(f'\nValidation: {"✅ PASSED" if validation["valid"] else "❌ FAILED"}')
    
    if validation['errors']:
        print('\nErrors:')
        for error in validation['errors']:
            print(f'  ❌ {error}')
    
    if validation['warnings']:
        print('\nWarnings:')
        for warning in validation['warnings']:
            print(f'  ⚠️  {warning}')
    
    # Display configuration
    print('\n=== Configuration Summary ===')
    print(f'Server: {get_server_url()}')
    print(f'Python: {get_python_executable()}')
    print(f'MATLAB paths: {len(get_matlab_paths())} configured')
    
    server_config = loader.get_server_config()
    print(f'WebSocket: {server_config["websocket"]["url"]}')
