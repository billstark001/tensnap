"""Run from the repository root: python -m examples.python_llm.naming_game."""

from ..common.cli import main
from .model import NamingConfig, NamingGame


def add_arguments(parser):
    """Keep naming-specific CLI options beside the model they configure."""
    parser.add_argument(
        "--topology",
        choices=["complete", "ring", "mixed", "community"],
        default="complete",
    )
    parser.add_argument("--exploration", type=float, default=0.05)
    parser.add_argument("--degree", type=int, default=4)
    parser.add_argument("--committed", type=int, default=0)
    parser.add_argument("--committed-name", choices=["Q", "M"], default="M")
    parser.add_argument("--label-order", choices=["QM", "MQ"], default="QM")
    parser.add_argument("--rule", choices=["wsls", "frequency"], default="wsls")


def load_view():
    """Load TenSnap only for serving; headless rules need no binding dependency."""
    from .viz import NamingView

    return NamingView


if __name__ == "__main__":
    main("naming_game", NamingGame, NamingConfig, add_arguments, load_view)
