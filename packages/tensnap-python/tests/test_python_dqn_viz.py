from __future__ import annotations

import sys
from pathlib import Path

import pytest
import torch

from tensnap import EnumParameter, NumberParameter, SimulationScenario

REPO_ROOT = Path(__file__).resolve().parents[3]
EXAMPLES_ROOT = REPO_ROOT / "examples"
if str(EXAMPLES_ROOT) not in sys.path:
    sys.path.insert(0, str(EXAMPLES_ROOT))

from python_dqn.config import DQNConfig, EnvConfig
from python_dqn.dqn import DQNAgent
from python_dqn.evac_viz import configure_visualization_scenario
from python_dqn.model import EvacuationModel


def _small_env_config(max_steps: int = 5) -> EnvConfig:
    return EnvConfig(
        width=6,
        height=6,
        num_evacuees=4,
        max_steps=max_steps,
        guide_influence_radius=2,
        exits=((0, 3), (5, 3)),
        fire_sources=((3, 3),),
        walls=(),
    )


def test_dqn_model_state_action_step_and_termination_shapes():
    config = _small_env_config(max_steps=4)
    model = EvacuationModel(config, seed=3)

    state = model.get_state()
    assert isinstance(state, torch.Tensor)
    assert len(state) == model.state_size
    assert model.state_size == 16
    assert model.action_size == 5

    next_state, reward, done, info = model.env_step(0)

    assert isinstance(next_state, torch.Tensor)
    assert len(next_state) == model.state_size
    assert isinstance(reward, float)
    assert isinstance(done, bool)
    assert set(info) == {"alive", "evacuated", "dead", "congestion"}

    for _ in range(config.max_steps + 1):
        if done:
            break
        _, _, done, _ = model.env_step(0)

    assert done is True
    assert model.step_count <= config.max_steps


def test_dqn_agent_checkpoint_round_trip(tmp_path: Path):
    model = EvacuationModel(_small_env_config(), seed=5)
    config = DQNConfig(batch_size=2, warmup_steps=2, buffer_size=16, hidden_dim=16)
    agent = DQNAgent(model.state_size, model.action_size, config, device="cpu")
    checkpoint = tmp_path / "dqn_round_trip.pt"

    agent.save(str(checkpoint))
    loaded = DQNAgent(model.state_size, model.action_size, config, device="cpu")
    loaded.load(str(checkpoint))

    assert loaded.total_steps == agent.total_steps
    for expected, actual in zip(
        agent.policy_net.parameters(),
        loaded.policy_net.parameters(),
    ):
        assert expected.equal(actual)


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

    assert "evacuation" in scenario.environments
    layer_ids = set(scenario.environments["evacuation"].layers)
    assert {
        "grid",
        "fire_cells",
        "wall_cells",
        "exit_cells",
        "evacuees",
        "evacuee_trails",
        "guides",
    }.issubset(layer_ids)

    assert set(scenario.charts) == {"alive", "fire_size"}
    chart_metadata, chart_getter = scenario.charts["alive"]
    assert chart_metadata.label == "Evacuation Outcomes"
    assert chart_metadata.data_list is not None
    assert [series.id for series in chart_metadata.data_list] == [
        "alive",
        "evacuated",
        "dead",
    ]
    assert chart_getter() == {
        "alive": config.num_evacuees,
        "evacuated": 0,
        "dead": 0,
    }

    assert "guideModel" in scenario.parameters
    guide_param = scenario.parameters["guideModel"]
    assert isinstance(guide_param, EnumParameter)
    assert "untrained" in guide_param.options
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
