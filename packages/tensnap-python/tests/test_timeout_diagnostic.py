"""Diagnostic startup must be opt-in and identify the exact model snapshot."""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
PROBE = ROOT / "benchmarks/diagnostics/mesa/sitecustomize.py"
MODEL = ROOT / "examples/python_mesa/schelling.py"


@pytest.mark.parametrize("enabled", [False, True])
def test_timeout_probe_startup_and_shutdown(tmp_path, enabled):
    output = tmp_path / "trace.json"
    env = os.environ.copy()
    for name in ("TENSNAP_TIMEOUT_SERVER_TRACE", "TENSNAP_TIMEOUT_MODEL_SOURCE"):
        env.pop(name, None)
    if enabled:
        env["TENSNAP_TIMEOUT_SERVER_TRACE"] = str(output)
        env["TENSNAP_TIMEOUT_MODEL_SOURCE"] = str(MODEL)
    script = """
import importlib.util
import json
import signal
import sys
from pathlib import Path
before = signal.getsignal(signal.SIGTERM)
modules_before = set(sys.modules)
spec = importlib.util.spec_from_file_location('timeout_probe', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
if sys.argv[3] == 'True':
    ready = json.loads(Path(sys.argv[2]).read_text())
    assert ready['status'] == 'ready'
    assert ready['schemaVersion'] == 2
    assert ready['actions'] == []
else:
    assert signal.getsignal(signal.SIGTERM) == before
    assert not (set(sys.modules) - modules_before) & {'mesa', 'tensnap', 'schelling'}
    assert not Path(sys.argv[2]).exists()
"""
    subprocess.run(
        [sys.executable, "-c", script, str(PROBE), str(output), str(enabled)],
        env=env,
        check=True,
        capture_output=True,
        text=True,
        timeout=20,
    )
    if enabled:
        trace = json.loads(output.read_text())
        assert trace["status"] == "stopped"
        assert trace["modelSha256"] == hashlib.sha256(MODEL.read_bytes()).hexdigest()
    else:
        assert not output.exists()
