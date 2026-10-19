"""Serve original configurations with rules or immutable tapes; no live client."""
import argparse
import asyncio
import json
from pathlib import Path

from original_models import install_original_models

install_original_models()

from examples.python_llm.common.llm import DecisionTape
from examples.python_llm.common.viz import build_scenario
from examples.python_llm.naming_game.model import NamingConfig, NamingGame
from examples.python_llm.naming_game.viz import NamingView
from examples.python_llm.mini_commons_harvest.model import CommonsConfig, MiniCommons
from examples.python_llm.mini_commons_harvest.viz import CommonsView


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('spec', type=Path)
    parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    spec = json.loads(args.spec.read_text())
    naming = spec['example'].endswith('naming_game')
    model_type, config_type, view = (
        (NamingGame, NamingConfig, NamingView) if naming
        else (MiniCommons, CommonsConfig, CommonsView)
    )

    class OriginalPromptTape(DecisionTape):
        """Apply only the original, explicitly recorded prompt branch schedule."""
        async def decide(self, system, observation):
            if ('system_suffix' in spec and
                    observation.get('tick', -1) >= spec['system_suffix_from_tick']):
                system += spec['system_suffix']
            return await super().decide(system, observation)

    tape = OriginalPromptTape(replay=Path(spec['tape'])) if spec.get('tape') else None
    assert tape is None or (tape.config is None and tape.mode == 'replay')
    model = model_type(config_type(**spec['config']), tape)
    scenario, _ = await build_scenario(model, view, args.port)
    print(f'OFFLINE READY ws://127.0.0.1:{args.port}', flush=True)
    try:
        await scenario.run()
    finally:
        if tape:
            assert tape.live_calls == 0
            await tape.close()


if __name__ == '__main__':
    asyncio.run(main())
