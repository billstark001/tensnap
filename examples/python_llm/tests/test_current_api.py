"""Current-only API and trajectory checks against the historical Git snapshot."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

from examples.python_llm.mini_commons_harvest.model import CommonsConfig, MiniCommons
from examples.python_llm.naming_game.model import NamingConfig, NamingGame

REFERENCE = json.loads(
    (Path(__file__).parent / "fixtures/latest_dynamics.json").read_text()
)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case", REFERENCE["cases"], ids=lambda case: f"{case['kind']}-{case['config']}"
)
async def test_latest_mechanisms_match_the_committed_dynamics(case):
    factory, config = (
        (NamingGame, NamingConfig)
        if case["kind"] == "naming"
        else (MiniCommons, CommonsConfig)
    )
    model = factory(config(**case["config"]))
    for _ in range(case["steps"]):
        await model.step()
    actual = {"checkpoint": model.capture(), "metrics": model.metrics()}
    assert (
        hashlib.sha256(json.dumps(actual, sort_keys=True).encode()).hexdigest()
        == case["sha256"]
    )


@pytest.mark.parametrize("factory", [NamingGame, MiniCommons])
def test_schema_version_one_requires_historical_execution(factory):
    model = factory()
    current = model.capture()
    assert current["version"] == 2
    assert "protocol" not in current["config"]
    old = {**current, "version": 1}
    with pytest.raises(ValueError, match="HISTORY.md"):
        model.restore(old)
    assert model.capture() == current


@pytest.mark.parametrize("kind", ["naming_game", "mini_commons_harvest"])
def test_cli_has_no_protocol_selector(kind):
    prefix = [sys.executable, "-m", f"examples.python_llm.{kind}"]
    help_result = subprocess.run(
        [*prefix, "--help"], text=True, capture_output=True, check=True
    )
    assert "--protocol" not in help_result.stdout
    rejected = subprocess.run(
        [*prefix, "run", "--protocol", "legacy"],
        check=False,
        text=True,
        capture_output=True,
    )
    assert rejected.returncode == 2
    assert "unrecognized arguments" in rejected.stderr
