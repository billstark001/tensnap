# tensnap/bindings/mesa/decorators.py
"""Decorators for Mesa 3 Model integration with TenSnap"""

from typing import Callable, Optional, List, Union, TYPE_CHECKING
from tensnap.bindings.basic import chart as basic_chart, bind as basic_bind
from tensnap.bindings.basic import ChartProperty, SimplifiedChartMetadata

if TYPE_CHECKING:
    from mesa import Model


def parameters(*args, **kwargs):
    """
    Parameter decorator for Mesa models - uses the basic bind decorator.
    This is an alias that can be directly used on Mesa Model classes.
    
    Usage:
        class MyModel(mesa.Model):
            @parameters("number", min=0, max=100, default=50)
            def population(self):
                return self._population
    """
    return basic_bind(*args, **kwargs)


def chart(
    id: str,
    label: str,
    color: Optional[str] = None,
    data_list: Optional[List[SimplifiedChartMetadata]] = None,
    use_datacollector: bool = True,
    datacollector_key: Optional[str] = None,
) -> Callable[[Callable], ChartProperty]:
    """
    Chart decorator for Mesa models that can optionally integrate with DataCollector.
    
    Args:
        id: Chart identifier
        label: Chart display label
        color: Optional chart color
        data_list: Optional list of data series for grouped charts
        use_datacollector: If True, tries to get data from model's datacollector
        datacollector_key: Key to use when fetching from datacollector (defaults to id)
    
    Usage:
        class MyModel(mesa.Model):
            @chart("population", "Total Population", color="#3498DB")
            def get_population(self):
                return len(self.agents)
            
            # Using datacollector
            @chart("wealth", "Average Wealth", use_datacollector=True)
            def get_wealth(self):
                # Will try to fetch from datacollector if available
                if hasattr(self, 'datacollector'):
                    from tensnap.bindings.mesa.datacollector import get_latest_data
                    data = get_latest_data(self.datacollector)
                    return data.get('wealth', 0.0)
                return 0.0
    """
    
    def decorator(func: Callable) -> ChartProperty:
        # If using datacollector, wrap the function to fetch from it
        if use_datacollector:
            key = datacollector_key or id
            
            def datacollector_wrapper(model: "Model") -> Union[float, int]:
                if hasattr(model, 'datacollector'):
                    from tensnap.bindings.mesa.datacollector import get_latest_data
                    data = get_latest_data(model.datacollector)
                    if key in data:
                        return data[key]
                # Fallback to original function
                return func(model)
            
            return basic_chart(id, label, color, data_list)(datacollector_wrapper)
        else:
            return basic_chart(id, label, color, data_list)(func)
    
    return decorator
