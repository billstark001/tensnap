"""User CLI over NetLogo study code shared with its benchmark adapter."""

from __future__ import annotations

import argparse
from pathlib import Path

from netlogo_study import (
    add_study_arguments,
    create_workspace,
    format_study_csv,
    import_pynetlogo,
    options_from_args,
    run_study,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Headless NetLogo Schelling threshold sweep.")
    add_study_arguments(parser, default_model_path=Path(__file__).with_name("schelling.nlogox"))
    options = options_from_args(parser.parse_args())
    py_netlogo = import_pynetlogo()
    workspace = create_workspace(py_netlogo, options)
    try:
        result = run_study(workspace, options)
    finally:
        workspace.kill_workspace()
    print(format_study_csv(result))


if __name__ == "__main__":
    main()
