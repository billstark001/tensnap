"""Make repository examples importable before collecting their regression tests."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [
    str(ROOT),
    str(ROOT / "examples/python"),
    str(ROOT / "examples/python_mesa"),
]
