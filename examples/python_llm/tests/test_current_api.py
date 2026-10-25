"""Current-only API and trajectory checks against the historical Git snapshot."""

import copy
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path

import pytest

from examples.python_llm.mini_commons_harvest.model import CommonsConfig, MiniCommons
from examples.python_llm.naming_game.model import NamingConfig, NamingGame

REFERENCE = json.loads(
    (Path(__file__).parent / "fixtures/latest_dynamics.json").read_text()
)


def dynamics_digest(actual, kind):
    """Keep trajectory/RNG state exact; canonicalize only visual circle positions."""
    canonical = copy.deepcopy(actual)
    if kind == "naming":
        for player in canonical["checkpoint"]["state"]["agents"]:
            for coordinate in ("x", "y"):
                player[coordinate] = round(
                    player[coordinate], REFERENCE["coordinate_decimal_places"]
                )
    return hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()


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
    if case["kind"] == "naming":
        # Additive initialization controls retain the historical defaults;
        # Normalize only those new fields and libm-dependent layout roundoff.
        assert actual["checkpoint"]["config"].pop("initial_names") == "unassigned"
        assert actual["checkpoint"]["config"].pop("layout") == "circle"
    assert dynamics_digest(actual, case["kind"]) == case["sha256"]


def test_dynamics_digest_preserves_nonvisual_state_and_detects_layout_changes():
    model = NamingGame()
    actual = {"checkpoint": model.capture(), "metrics": model.metrics()}
    original = copy.deepcopy(actual)
    expected = dynamics_digest(actual, "naming")
    close = copy.deepcopy(actual)
    player = close["checkpoint"]["state"]["agents"][0]
    player["x"] = math.nextafter(player["x"], math.inf)
    assert dynamics_digest(close, "naming") == expected
    player["x"] += 1e-6
    assert dynamics_digest(close, "naming") != expected
    for field in ("random_state", "policy_random_state"):
        changed = copy.deepcopy(actual)
        state = json.loads(changed["checkpoint"][field])
        state[1][0] ^= 1
        changed["checkpoint"][field] = json.dumps(state)
        assert dynamics_digest(changed, "naming") != expected
    changed = copy.deepcopy(actual)
    changed["metrics"]["q_share"] += 1e-15
    assert dynamics_digest(changed, "naming") != expected
    assert actual == original


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
