"""Run from the repository root: python -m examples.python_llm.mini_commons_harvest."""

from ..common.cli import main
from .model import CommonsConfig, MiniCommons


def add_arguments(parser):
    """Declare this model's grid, growth and baseline options."""
    parser.add_argument("--width", type=int, default=12)
    parser.add_argument("--height", type=int, default=9)
    parser.add_argument("--regrowth", type=float, default=0.35)
    parser.add_argument(
        "--rule", choices=["greedy", "conserve", "signal"], default="greedy"
    )
    parser.add_argument(
        "--protocol", choices=["legacy", "factorial-v1"], default="legacy"
    )
    parser.add_argument("--message-delivery", choices=["on", "off"], default="on")
    parser.add_argument("--drought-start", type=int, default=0)
    parser.add_argument("--drought-duration", type=int, default=0)
    parser.add_argument("--drought-multiplier", type=float, default=0.1)


def load_view():
    """Import rendering declarations only when starting a TenSnap server."""
    from .viz import CommonsView

    return CommonsView


if __name__ == "__main__":
    main("mini_commons_harvest", MiniCommons, CommonsConfig, add_arguments, load_view)
