# tensnap/bindings/mesa/datacollector.py
"""Utility functions for working with Mesa 3 DataCollector"""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from mesa import DataCollector


def get_registered_collectors(datacollector: "DataCollector") -> list[str]:
    """
    Get a list of all registered collector names in the DataCollector.
    
    Args:
        datacollector: Mesa DataCollector instance
        
    Returns:
        List of collector names (both model and agent reporters)
    """
    collectors = []
    
    # Get model reporters
    if hasattr(datacollector, "model_reporters"):
        collectors.extend(datacollector.model_reporters.keys())
    
    # Get agent reporters (if needed)
    if hasattr(datacollector, "agent_reporters"):
        collectors.extend(datacollector.agent_reporters.keys())
    
    return collectors


def get_latest_data(datacollector: "DataCollector") -> dict[str, Any]:
    """
    Get the latest collected data from DataCollector after a collect() call.
    
    Args:
        datacollector: Mesa DataCollector instance
        
    Returns:
        Dictionary mapping collector names to their latest values
    """
    latest_data = {}
    
    # Get latest model data
    if hasattr(datacollector, "model_vars") and datacollector.model_vars:
        for key, values in datacollector.model_vars.items():
            if values:
                latest_data[key] = values[-1]
    
    return latest_data


def get_all_data(datacollector: "DataCollector") -> dict[str, list[Any]]:
    """
    Get all collected data from DataCollector.
    
    Args:
        datacollector: Mesa DataCollector instance
        
    Returns:
        Dictionary mapping collector names to lists of all their values
    """
    all_data = {}
    
    # Get all model data
    if hasattr(datacollector, "model_vars") and datacollector.model_vars:
        for key, values in datacollector.model_vars.items():
            all_data[key] = list(values)
    
    return all_data


def get_data_at_step(datacollector: "DataCollector", step: int) -> dict[str, Any]:
    """
    Get collected data at a specific step.
    
    Args:
        datacollector: Mesa DataCollector instance
        step: Step number to retrieve data for
        
    Returns:
        Dictionary mapping collector names to their values at the given step
    """
    step_data = {}
    
    # Get model data at step
    if hasattr(datacollector, "model_vars") and datacollector.model_vars:
        for key, values in datacollector.model_vars.items():
            if len(values) > step:
                step_data[key] = values[step]
    
    return step_data
