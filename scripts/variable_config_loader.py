"""
Variable Configuration Loader
Reads antenna variable definitions from external JSON configuration file.
Used by backend scripts to dynamically load optimization parameters.
"""

import json
import os
from typing import Dict, List, Optional, Any

# Default path to configuration file
CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config')
DEFAULT_CONFIG_PATH = os.path.join(CONFIG_DIR, 'antenna_variables.json')


class VariableConfig:
    """
    Loads and provides access to antenna variable definitions.
    """
    
    def __init__(self, config_path: str = DEFAULT_CONFIG_PATH):
        """
        Initialize the variable configuration loader.
        
        Args:
            config_path: Path to the JSON configuration file
        """
        self.config_path = config_path
        self.config_data = None
        self.variables = None
        self.metadata = None
        self._load_config()
    
    def _load_config(self):
        """Load the configuration file and parse JSON data."""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                self.config_data = json.load(f)
                self.variables = self.config_data.get('variables', [])
                self.metadata = self.config_data.get('metadata', {})
        except FileNotFoundError:
            raise FileNotFoundError(
                f"Configuration file not found: {self.config_path}\n"
                f"Please ensure antenna_variables.json exists in the config directory."
            )
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in configuration file: {e}")
    
    def get_all_variables(self) -> List[Dict[str, Any]]:
        """
        Get all variable definitions.
        
        Returns:
            List of all variable dictionaries
        """
        return self.variables
    
    def get_variable_by_id(self, var_id: int) -> Optional[Dict[str, Any]]:
        """
        Get a specific variable by its ID.
        
        Args:
            var_id: The variable ID to search for
            
        Returns:
            Variable dictionary or None if not found
        """
        for var in self.variables:
            if var.get('id') == var_id:
                return var
        return None
    
    def get_variable_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """
        Get a specific variable by its name.
        
        Args:
            name: The variable name to search for
            
        Returns:
            Variable dictionary or None if not found
        """
        for var in self.variables:
            if var.get('name') == name:
                return var
        return None
    
    def get_variables_by_category(self, category: str) -> List[Dict[str, Any]]:
        """
        Get all variables in a specific category.
        
        Args:
            category: Category name (e.g., 'standard', 'special', 'ground_plane')
            
        Returns:
            List of variables in the specified category
        """
        return [var for var in self.variables if var.get('category') == category]
    
    def get_selected_variables(self, selected_ids: List[int]) -> List[Dict[str, Any]]:
        """
        Get variables matching the provided list of IDs.
        
        Args:
            selected_ids: List of variable IDs
            
        Returns:
            List of matching variable dictionaries
        """
        return [var for var in self.variables if var.get('id') in selected_ids]
    
    def get_variable_definitions_dict(self) -> Dict[int, Dict[str, Any]]:
        """
        Get variables as a dictionary indexed by ID (compatible with old format).
        
        Returns:
            Dictionary with variable IDs as keys
        """
        return {var['id']: var for var in self.variables}
    
    def get_optimization_variables(self) -> List[Dict[str, Any]]:
        """
        Get all non-custom variables (variables 1-82 for optimization).
        
        Returns:
            List of optimization variables (excludes ground plane custom variables)
        """
        return [var for var in self.variables if not var.get('custom', False)]
    
    def get_ground_plane_variables(self) -> List[Dict[str, Any]]:
        """
        Get ground plane configuration variables (83-86).
        
        Returns:
            List of ground plane variables
        """
        return [var for var in self.variables if var.get('custom', False)]
    
    def validate_variable(self, var: Dict[str, Any]) -> bool:
        """
        Validate that a variable dictionary has all required fields.
        
        Args:
            var: Variable dictionary to validate
            
        Returns:
            True if valid, False otherwise
        """
        required_fields = ['id', 'name', 'multiplier', 'offset', 'formula']
        return all(field in var for field in required_fields)
    
    def get_metadata(self) -> Dict[str, Any]:
        """
        Get configuration metadata.
        
        Returns:
            Metadata dictionary
        """
        return self.metadata
    
    def reload(self):
        """Reload the configuration from file."""
        self._load_config()


# Convenience function for quick access
def load_variables(config_path: str = DEFAULT_CONFIG_PATH) -> List[Dict[str, Any]]:
    """
    Quick function to load all variables from configuration file.
    
    Args:
        config_path: Path to configuration file
        
    Returns:
        List of all variable dictionaries
    """
    config = VariableConfig(config_path)
    return config.get_all_variables()


def load_variable_definitions() -> Dict[int, Dict[str, Any]]:
    """
    Load variables in dictionary format (compatible with old code).
    
    Returns:
        Dictionary with variable IDs as keys
    """
    config = VariableConfig()
    return config.get_variable_definitions_dict()


if __name__ == '__main__':
    # Test the configuration loader
    try:
        config = VariableConfig()
        print(f"Loaded {len(config.get_all_variables())} variables")
        print(f"Metadata: {config.get_metadata()}")
        
        # Test variable retrieval
        var_7 = config.get_variable_by_id(7)
        if var_7:
            print(f"\nVariable 7 (H1):")
            print(f"  Name: {var_7['name']}")
            print(f"  Formula: {var_7['formula']}")
            print(f"  Range: {var_7['range']}")
        
        # Test category filtering
        ground_plane = config.get_ground_plane_variables()
        print(f"\nGround plane variables: {len(ground_plane)}")
        for gp in ground_plane:
            print(f"  {gp['id']}: {gp['name']}")
            
    except Exception as e:
        print(f"Error: {e}")
