"""Run from the repository root: python -m examples.python_llm.mini_commons_harvest."""

from ..common.cli import main
from .model import CommonsConfig, MiniCommons


def add_arguments(parser):
    """Declare this model's grid, growth and baseline options."""
    parser.add_argument("--width", type=int, default=12)
    parser.add_argument("--height", type=int, default=9)
    parser.add_argument("--regrowth", type=float, default=0.35)
    parser.add_argument("--rule", choices=["greedy", "conserve"], default="greedy")


def load_view():
    """Import rendering declarations only when starting a TenSnap server."""
    from .viz import CommonsView

    return CommonsView


if __name__ == "__main__":
    main("mini_commons_harvest", MiniCommons, CommonsConfig, add_arguments, load_view)
