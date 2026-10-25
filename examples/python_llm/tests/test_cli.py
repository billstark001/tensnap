"""Exercise the documented public entrypoints as fresh processes."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize("kind", ["naming_game", "mini_commons_harvest"])
def test_serve_reports_old_binding_with_same_interpreter_install_command(
    kind, tmp_path
):
    package = tmp_path / "tensnap"
    package.mkdir()
    (package / "__init__.py").write_text(
        '__version__ = "0.3.6"\ndef edge(source="source", target="target"): pass\n'
    )
    result = subprocess.run(
        [sys.executable, "-m", f"examples.python_llm.{kind}", "serve"],
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(tmp_path), "TENSNAP_USE_SOURCE": "0"},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 2
    assert "TenSnap Python >=0.3.7 with edge(data=...)" in result.stderr
    assert f"Loaded 0.3.6 from {package}" in result.stderr
    assert sys.executable in result.stderr
    assert "-m pip install -e" in result.stderr
    assert "TENSNAP_USE_SOURCE=1" in result.stderr
    assert "unexpected keyword" not in result.stderr
    assert "Traceback" not in result.stderr


def test_headless_rule_does_not_import_binding(tmp_path):
    (tmp_path / "tensnap.py").write_text('raise AssertionError("binding imported")\n')
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "examples.python_llm.mini_commons_harvest",
            "run",
            "--policy",
            "rule",
            "--steps",
            "1",
        ],
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(tmp_path)},
        capture_output=True,
        text=True,
        check=True,
    )
    assert json.loads(result.stdout)["runs"][0]["metrics"]["tick"] == 1


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


@pytest.mark.parametrize("kind", ["naming_game", "mini_commons_harvest"])
def test_cli_reports_invalid_checkpoint_types_without_traceback(kind, tmp_path):
    from examples.python_llm.mini_commons_harvest.model import MiniCommons
    from examples.python_llm.naming_game.model import NamingGame

    model = NamingGame() if kind == "naming_game" else MiniCommons()
    saved = model.capture()
    saved["config"]["seed"] = "invalid type"
    path = tmp_path / "invalid-checkpoint.json"
    path.write_text(json.dumps(saved))
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            f"examples.python_llm.{kind}",
            "run",
            "--checkpoint-in",
            str(path),
        ],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "Example stopped: seed must be an integer" in result.stderr
    assert "Traceback" not in result.stderr


def test_naming_cli_presets_and_custom_initializations(tmp_path):
    prefix = [sys.executable, "-m", "examples.python_llm.naming_game", "run"]
    for options, population, topology in [
        (["--scenario", "small-population"], 12, "ring"),
        (["--scenario", "barbell-polarized"], 24, "barbell"),
        (
            [
                "--agents",
                "48",
                "--topology",
                "community",
                "--initial-names",
                "polarized",
                "--layout",
                "communities",
            ],
            48,
            "community",
        ),
    ]:
        output = tmp_path / f"{population}-{topology}.json"
        subprocess.run(
            [*prefix, *options, "--steps", "2", "--output", str(output)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        run = json.loads(output.read_text())["runs"][0]
        assert run["config"]["agents"] == population
        assert run["config"]["topology"] == topology
        assert len(run["checkpoint"]["state"]["agents"]) == population
        assert run["metrics"]["tick"] == 2
