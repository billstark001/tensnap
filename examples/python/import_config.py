"""Opt into this checkout with TENSNAP_USE_SOURCE=1; otherwise use the installed package."""

import os
import sys
from pathlib import Path

if os.environ.get("TENSNAP_USE_SOURCE", "0") == "1":
    source = Path(__file__).resolve().parents[2] / "packages" / "tensnap-python"
    if not (source / "tensnap" / "__init__.py").is_file():
        raise ImportError(
            f"TENSNAP_USE_SOURCE requested but no TenSnap source exists at {source}"
        )
    sys.path.insert(0, str(source))
