"""Import the exact committed models used by the original saved trajectories."""

import atexit
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def install_original_models():
    folder = Path(__file__).resolve().parent
    repo = folder.parents[2]
    versions = json.loads((folder / "versions.json").read_text())
    temporary = tempfile.TemporaryDirectory(prefix="tensnap-historical-models-")
    atexit.register(temporary.cleanup)
    root = Path(temporary.name)
    for filename, expected in versions["modelSources"].items():
        data = subprocess.check_output(
            ["git", "show", f"{versions['sourceCommit']}:{filename}"], cwd=repo
        )
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError(f"Historical source hash mismatch: {filename}")
        target = root / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    # An explicit package prevents an installed `examples` package from winning.
    (root / "examples/__init__.py").write_text("")
    sys.path.insert(0, str(root))
    return versions["sourceCommit"]
