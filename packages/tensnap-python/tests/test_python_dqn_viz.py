from __future__ import annotations

import sys
from pathlib import Path

import pytest
import torch

from tensnap import NumberParameter, SimulationScenario

REPO_ROOT = Path(__file__).resolve().parents[3]
EXAMPLES_ROOT = REPO_ROOT / "examples"
if str(EXAMPLES_ROOT) not in sys.path:
    sys.path.insert(0, str(EXAMPLES_ROOT))

from python_dqn.config import DQNConfig, EnvConfig
from python_dqn.evac_viz import configure_visualization_scenario


def test_annotated_dataclass_fields_expose_parameter_metadata():
    scenario = SimulationScenario()
    config = EnvConfig()

    changes = scenario.add_parameters(config)

    assert "width" in changes["parameters"]
    assert "height" in changes["parameters"]
    assert "num_evacuees" in changes["parameters"]
    assert "walls" not in changes["parameters"]

    width = scenario.parameters["width"]
    assert isinstance(width, NumberParameter)
    assert width.label == "Width"
    assert width.min == 4
    assert width.max == 64
    assert width.step == 1

    follow_bias = scenario.parameters["guide_follow_bias"]
    assert isinstance(follow_bias, NumberParameter)
    assert follow_bias.label == "Guide Follow Bias"
    assert follow_bias.min == 0.0
    assert follow_bias.max == 1.0
    assert follow_bias.step == 0.01


def test_evac_viz_configures_env_parameters_once_and_registers_expected_metadata():
    scenario = SimulationScenario()
    config = EnvConfig()
    observed_targets: list[object] = []
    original_add_parameters = scenario.add_parameters

    def add_parameters_spy(target, *cfg_suggest, dry_run=False):
        observed_targets.append(target)
        return original_add_parameters(target, *cfg_suggest, dry_run=dry_run)

    scenario.add_parameters = add_parameters_spy  # type: ignore[method-assign]

    model, reinitializer, guide_manager = configure_visualization_scenario(
        scenario=scenario,
        env_config=config,
        dqn_config=DQNConfig(),
        device="cpu",
        guide_model_dir=REPO_ROOT / "examples" / "python_dqn" / "checkpoints",
    )

    assert model is not None
    assert reinitializer is not None
    assert guide_manager is not None
    assert observed_targets.count(config) == 1
    assert "guideModel" in scenario.parameters
    assert "resetGuideModel" in scenario.actions


@pytest.mark.asyncio
async def test_evac_viz_reset_replays_changed_env_config_values():
    scenario = SimulationScenario()
    config = EnvConfig()

    model, reinitializer, _guide_manager = configure_visualization_scenario(
        scenario=scenario,
        env_config=config,
        dqn_config=DQNConfig(),
        device="cpu",
        guide_model_dir=REPO_ROOT / "examples" / "python_dqn" / "checkpoints",
    )

    scenario.set_parameter("width", 20)
    scenario.set_parameter("height", 12)
    scenario.set_parameter("num_evacuees", 10)

    await reinitializer.model_reset()

    assert config.width == 20
    assert config.height == 12
    assert config.num_evacuees == 10
    assert model.width == 20
    assert model.height == 12
    assert len(model.evacuees) == 10
