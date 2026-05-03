"""
Import configuration for TenSnap Python examples.

This module provides a configurable way to import the tensnap package.
You can switch between:
1. Using the pip-installed version (default)
2. Using the source code from the repository

To use source code, set environment variable:
    export TENSNAP_USE_SOURCE=1

Or modify USE_SOURCE below directly.
"""

import os
import sys
from pathlib import Path

# Configuration: Set to True to use source code, False to use pip-installed version
USE_SOURCE = os.environ.get("TENSNAP_USE_SOURCE", "0") == "1"

if USE_SOURCE:
    # Add the source code path to sys.path
    repo_root = Path(__file__).parent.parent.parent
    python_package_path = repo_root / "packages" / "tensnap-python"

    if python_package_path.exists():
        sys.path.insert(0, str(python_package_path))
        print(f"Using tensnap from source: {python_package_path}")
    else:
        print(f"Warning: Source path not found: {python_package_path}")
        print("Falling back to pip-installed version")
else:
    print("Using pip-installed tensnap package")
