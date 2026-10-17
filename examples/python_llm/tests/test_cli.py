"""Exercise the documented public entrypoints as fresh processes."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize("kind", ["naming_game", "mini_commons_harvest"])
def test_cli_batch_and_checkpoint_continuation(kind, tmp_path):
    prefix = [sys.executable, "-m", f"examples.python_llm.{kind}"]
    report = tmp_path / "batch.json"
    subprocess.run(
        [*prefix, "batch", "--seeds", "1,2", "--steps", "3", "--output", str(report)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    data = json.loads(report.read_text())
    assert [run["seed"] for run in data["runs"]] == [1, 2]
    assert all(run["metrics"]["tick"] == 3 for run in data["runs"])
    single = tmp_path / "single.json"
    single.write_text(json.dumps(data["runs"][0]))
    result = subprocess.run(
        [*prefix, "run", "--checkpoint-in", str(single), "--steps", "2"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(result.stdout)["runs"][0]["metrics"]["tick"] == 5
