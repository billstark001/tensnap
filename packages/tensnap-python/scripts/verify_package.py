"""Build clean source, install its wheel in a temporary target, and test both views.

Run with the repository's Python dev dependencies and python_llm requirements.
The active interpreter and any existing build directory are left unchanged.
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

from build_package import PACKAGE, build_wheel


def main() -> None:
    package = PACKAGE
    root = package.parents[1]
    with tempfile.TemporaryDirectory(prefix="tensnap-wheel-check-") as directory:
        work = Path(directory)
        wheel = build_wheel(work, isolated=False)
        expected = {
            path.relative_to(package).as_posix(): path.read_bytes()
            for path in (package / "tensnap").rglob("*.py")
        }
        with ZipFile(wheel) as archive:
            actual = {
                name: archive.read(name)
                for name in archive.namelist()
                if name.startswith("tensnap/") and name.endswith(".py")
            }
        if actual != expected:
            raise RuntimeError("Wheel Python sources differ from the checkout")
        installed = work / "installed"
        tests = root / "examples/python_llm/tests"
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--no-deps",
                "--target",
                str(installed),
                str(wheel),
            ],
            check=True,
        )
        environment = {
            **os.environ,
            "PYTHONPATH": os.pathsep.join([str(installed), str(root)]),
            "TENSNAP_USE_SOURCE": "0",
        }
        subprocess.run(
            [
                sys.executable,
                "-c",
                "import importlib.metadata as m, tensnap; "
                f"assert tensnap.__file__.startswith({str(installed)!r}); "
                "assert tensnap.__version__ == m.version('tensnap'); "
                "print('Installed wheel:', tensnap.__version__, tensnap.__file__); "
                "from examples.python_llm.common.cli import require_binding; "
                "require_binding(); "
                "import pytest, sys; raise SystemExit(pytest.main(sys.argv[1:]))",
                "--import-mode=importlib",
                str(package / "tests/test_environment.py"),
                str(package / "tests/test_item_snapshot_ownership.py"),
                str(tests),
                "-q",
                "-o",
                "addopts=",
            ],
            cwd=work,
            env=environment,
            check=True,
        )


if __name__ == "__main__":
    main()
