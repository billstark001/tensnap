"""Build a wheel from a clean temporary source tree, preserving local outputs."""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]


def build_wheel(output: Path, *, isolated: bool = True) -> Path:
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="tensnap-wheel-build-") as directory:
        work = Path(directory)
        source = work / "source"
        shutil.copytree(
            PACKAGE,
            source,
            ignore=shutil.ignore_patterns(
                "build", "dist", "*.egg-info", "__pycache__", ".pytest_cache", ".venv"
            ),
        )
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "wheel",
                "--no-deps",
                *([] if isolated else ["--no-build-isolation"]),
                str(source),
                "-w",
                str(work),
            ],
            check=True,
        )
        wheel = next(work.glob("tensnap-*.whl"))
        destination = output / wheel.name
        shutil.copy2(wheel, destination)
        return destination


if __name__ == "__main__":
    build_wheel(PACKAGE / "dist")
