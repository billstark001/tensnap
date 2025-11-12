import json
import msgpack
from typing import Any, List, Tuple, Union, Set, Type, Callable, Optional
from collections import deque
import re
import base64
from io import BytesIO

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False


def find_unserializable_items(
    data: Union[dict, list, tuple], library: str = "both"
) -> List[Tuple[str, Any, str]]:
    """
    Find all items in a data structure that cannot be serialized by json or msgpack.

    Args:
        data: Data structure to check (dict, list or tuple)
        library: 'json', 'msgpack' or 'both' (default)

    Returns:
        List of tuples: (path, value, failed_library)
    """
    unserializable = []
    queue = deque([(data, "")])

    while queue:
        current_data, path = queue.popleft()

        if isinstance(current_data, dict):
            for key, value in current_data.items():
                current_path = f"{path}.{key}" if path else str(key)
                _check_serializable(
                    key, f"{current_path}[key]", library, unserializable
                )

                if isinstance(value, (dict, list, tuple)):
                    queue.append((value, current_path))
                else:
                    _check_serializable(value, current_path, library, unserializable)

        elif isinstance(current_data, (list, tuple)):
            for index, value in enumerate(current_data):
                current_path = f"{path}[{index}]"

                if isinstance(value, (dict, list, tuple)):
                    queue.append((value, current_path))
                else:
                    _check_serializable(value, current_path, library, unserializable)

    return unserializable


# JSON-serializable types
_JSON_TYPES: Set[Type] = {type(None), bool, int, float, str, dict, list}

# msgpack-serializable types (superset of JSON types plus bytes)
_MSGPACK_TYPES: Set[Type] = _JSON_TYPES | {bytes, bytearray}


def _is_json_serializable(value: Any) -> bool:
    """Check if a value is JSON-serializable based on its type."""
    value_type = type(value)

    if value_type in _JSON_TYPES:
        return True

    # Check for special numeric types
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        # Check for special float values
        if isinstance(value, float):
            return not (
                value != value or value == float("inf") or value == float("-inf")
            )
        return True

    return False


def _is_msgpack_serializable(value: Any) -> bool:
    """Check if a value is msgpack-serializable based on its type."""
    value_type = type(value)

    if value_type in _MSGPACK_TYPES:
        return True

    # Check for special numeric types
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float):
            return not (
                value != value or value == float("inf") or value == float("-inf")
            )
        return True

    return False


def _check_serializable(value: Any, path: str, library: str, results: list):
    """Check if a value is serializable using efficient type checking."""
    failed_libs = []

    if library in ("json", "both"):
        if not _is_json_serializable(value):
            failed_libs.append("json")

    if library in ("msgpack", "both"):
        if not _is_msgpack_serializable(value):
            failed_libs.append("msgpack")

    if failed_libs:
        results.append((path, value, " & ".join(failed_libs)))


def find_objects_by_error(
    data: Union[dict, list, tuple],
    error_message: str,
    library: str = "both",
    test_func: Optional[Callable[[Any, str], Optional[str]]] = None,
) -> List[Tuple[str, Any]]:
    """
    Find objects that cause a specific serialization error.

    Args:
        data: Data structure to check
        error_message: Error message pattern (regex supported)
        library: 'json', 'msgpack' or 'both'
        test_func: Custom function to test serialization. If None, uses default.

    Returns:
        List of tuples: (path, value)
    """
    pattern = re.compile(error_message, re.IGNORECASE)
    matching_objects = []
    queue = deque([(data, "")])

    if test_func is None:
        test_func = _default_test_serialization

    while queue:
        current_data, path = queue.popleft()

        if isinstance(current_data, dict):
            for key, value in current_data.items():
                current_path = f"{path}.{key}" if path else str(key)

                _test_and_match(
                    key,
                    f"{current_path}[key]",
                    library,
                    pattern,
                    test_func,
                    matching_objects,
                )

                if isinstance(value, (dict, list, tuple)):
                    queue.append((value, current_path))
                else:
                    _test_and_match(
                        value,
                        current_path,
                        library,
                        pattern,
                        test_func,
                        matching_objects,
                    )

        elif isinstance(current_data, (list, tuple)):
            for index, value in enumerate(current_data):
                current_path = f"{path}[{index}]"

                if isinstance(value, (dict, list, tuple)):
                    queue.append((value, current_path))
                else:
                    _test_and_match(
                        value,
                        current_path,
                        library,
                        pattern,
                        test_func,
                        matching_objects,
                    )

    return matching_objects


def _default_test_serialization(value: Any, library: str) -> Optional[str]:
    """Test serialization and return error message if it fails."""
    if library == "json":
        try:
            json.dumps(value)
            return None
        except Exception as e:
            return str(e)
    elif library == "msgpack":
        try:
            msgpack.packb(value)
            return None
        except Exception as e:
            return str(e)
    return None


def _test_and_match(
    value: Any,
    path: str,
    library: str,
    pattern: re.Pattern,
    test_func: Callable[[Any, str], Optional[str]],
    results: list,
):
    """Test value and match error against pattern."""
    if library in ("json", "both"):
        error = test_func(value, "json")
        if error and pattern.search(error):
            results.append((path, value))
            return

    if library in ("msgpack", "both"):
        error = test_func(value, "msgpack")
        if error and pattern.search(error):
            results.append((path, value))
            return


def detect_file_type(data: bytes) -> str:
    """
    Detect file type from byte content by checking magic numbers.
    
    Args:
        data: Byte content to analyze
        
    Returns:
        MIME type string (e.g., 'image/png', 'application/octet-stream')
    """
    if len(data) == 0:
        return "application/octet-stream"
    
    # Check for NPY format (magic: \x93NUMPY)
    if data[:6] == b'\x93NUMPY':
        return "application/x-npy"
    
    # Check for PNG format (magic: \x89PNG\r\n\x1a\n)
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return "image/png"
    
    # Check for JPEG format (magic: \xff\xd8\xff)
    if data[:3] == b'\xff\xd8\xff':
        return "image/jpeg"
    
    # Check for BMP format (magic: BM)
    if data[:2] == b'BM':
        return "image/bmp"
    
    # Check for GIF format (magic: GIF87a or GIF89a)
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return "image/gif"
    
    # Check for WebP format (magic: RIFF....WEBP)
    if len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return "image/webp"
    
    # Default to octet-stream
    return "application/octet-stream"


def msgpack_default(obj: Any) -> Any:
    """
    Default function for msgpack serialization.
    
    Handles:
    - 0-dimensional numpy scalars: converts to Python number
    - numpy arrays: serializes to NPY byte stream
    
    Args:
        obj: Object to serialize
        
    Returns:
        Serializable representation
        
    Raises:
        TypeError: If object cannot be serialized
    """
    if not HAS_NUMPY:
        raise TypeError(f"Object of type {type(obj).__name__} is not msgpack serializable")
    
    # Handle numpy types
    if isinstance(obj, np.ndarray):
        # Check if it's a 0-dimensional array (scalar)
        if obj.ndim == 0:
            # Convert to Python number
            return obj.item()
        else:
            # Serialize array to NPY format
            buffer = BytesIO()
            np.save(buffer, obj)
            return buffer.getvalue()
    
    # Handle numpy scalar types
    if isinstance(obj, np.generic):
        return obj.item()
    
    raise TypeError(f"Object of type {type(obj).__name__} is not msgpack serializable")


def json_default(obj: Any) -> Any:
    """
    Default function for JSON serialization.
    
    Handles:
    - 0-dimensional numpy scalars: converts to Python number
    - numpy arrays: serializes to NPY byte stream, then to data URL
    - bytes/bytearray: detects file type and converts to data URL with base64 encoding
    
    Args:
        obj: Object to serialize
        
    Returns:
        JSON-serializable representation
        
    Raises:
        TypeError: If object cannot be serialized
    """
    # Handle bytes and bytearray
    if isinstance(obj, (bytes, bytearray)):
        data = bytes(obj)
        mime_type = detect_file_type(data)
        b64_data = base64.b64encode(data).decode('ascii')
        return f"data:{mime_type};base64,{b64_data}"
    
    if not HAS_NUMPY:
        raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")
    
    # Handle numpy types
    if isinstance(obj, np.ndarray):
        # Check if it's a 0-dimensional array (scalar)
        if obj.ndim == 0:
            # Convert to Python number
            return obj.item()
        else:
            # Serialize array to NPY format
            buffer = BytesIO()
            np.save(buffer, obj)
            npy_bytes = buffer.getvalue()
            # Convert to data URL
            b64_data = base64.b64encode(npy_bytes).decode('ascii')
            return f"data:application/x-npy;base64,{b64_data}"
    
    # Handle numpy scalar types
    if isinstance(obj, np.generic):
        return obj.item()
    
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")
