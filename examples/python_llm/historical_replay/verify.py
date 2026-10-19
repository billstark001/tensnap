"""Verify the five original trajectories without credentials or HTTP calls."""

import argparse
import asyncio
import json
from pathlib import Path

from original_models import install_original_models

SOURCE_COMMIT = install_original_models()

from examples.python_llm.common.llm import DecisionError, DecisionTape
from examples.python_llm.mini_commons_harvest.model import CommonsConfig, MiniCommons
from examples.python_llm.naming_game.model import NamingConfig, NamingGame


async def verify(folder):
    checks = []
    for path in sorted(folder.glob("*/spec.json")):
        spec = json.loads(path.read_text())

        class OriginalPromptTape(DecisionTape):
            async def decide(self, system, observation):
                if "system_suffix" in spec and observation.get("tick", -1) >= spec["system_suffix_from_tick"]:
                    system += spec["system_suffix"]
                return await super().decide(system, observation)

        tape = OriginalPromptTape(replay=Path(spec["tape"]))
        naming = spec["example"].endswith("naming_game")
        factory, config = (NamingGame, NamingConfig) if naming else (MiniCommons, CommonsConfig)
        model = factory(config(**spec["config"]), tape)
        for _ in range(spec["target_tick"]):
            await model.step()
        assert model.capture() == spec["expected_final_model"], path.parent.name
        assert model.metrics() == spec["expected_metrics"], path.parent.name
        if spec.get("expected_error"):
            before = model.capture()
            try:
                await model.step()
            except DecisionError as error:
                assert str(error) == spec["expected_error"]
            else:
                raise AssertionError("Expected the original failed decision")
            assert model.capture() == before
        assert tape.live_calls == 0
        checks.append({"case": path.parent.name, "tick": model.tick, "exact_checkpoint_and_metrics": True, "live_calls": 0})
        await tape.close()
    assert len(checks) == 5
    return {"source_commit": SOURCE_COMMIT, "checks": checks}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    arguments = parser.parse_args()
    print(json.dumps(asyncio.run(verify(arguments.input)), indent=2))
