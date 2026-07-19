"""NetLogo 7 Schelling state/render benchmark with an independent PNG oracle.

NetLogo is not browser based, and its GUI may intentionally skip display
updates while a forever button runs.  This adapter therefore uses the public
headless ``export-view`` primitive after every action.  The measured metric
includes model transition, patch recoloring, PNG encoding, and file I/O; it is
descriptive and must not be paired with browser requestAnimationFrame latency.
"""

from __future__ import annotations

import argparse
import base64
from hashlib import sha256
import json
import os
from pathlib import Path
import platform
import tempfile
import time
from typing import Iterable

from PIL import Image
import pynetlogo

EXAMPLE_DIR = Path(__file__).resolve().parents[5] / "examples" / "python_mesa"
DEFAULT_MODEL = EXAMPLE_DIR / "schelling.nlogox"
GROUP_COLORS = {
    0: (255, 255, 255, 255),
    1: (52, 93, 169, 255),
    2: (215, 50, 41, 255),
}


def _netlogo_home(value: str | None) -> Path:
    candidates = [
        value,
        os.environ.get("NETLOGO_HOME"),
        "/Applications/NetLogo 7.0.4",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_dir():
            return Path(candidate).resolve()
    raise SystemExit("Set --netlogo-home or NETLOGO_HOME to a NetLogo 7.0.4 installation.")


def _milliseconds(started_ns: int) -> float:
    return (time.perf_counter_ns() - started_ns) / 1_000_000


def _rle(values: Iterable[int]) -> list[list[int]]:
    runs: list[list[int]] = []
    for value in values:
        if runs and runs[-1][0] == value:
            runs[-1][1] += 1
        else:
            runs.append([value, 1])
    return runs


def _model_groups(workspace: pynetlogo.NetLogoLink) -> tuple[int, int, list[int]]:
    frame = workspace.patch_report("group")
    x_values = sorted(int(value) for value in frame.columns)
    y_values = sorted((int(value) for value in frame.index), reverse=True)
    groups = [int(frame.loc[y, x]) for y in y_values for x in x_values]
    if any(group not in GROUP_COLORS for group in groups):
        raise RuntimeError("NetLogo model reported an unknown Schelling patch group.")
    return len(x_values), len(y_values), groups


def _raster_groups(path: Path, width: int, height: int) -> tuple[list[int], int, int]:
    image = Image.open(path).convert("RGBA")
    if image.width % width or image.height % height:
        raise RuntimeError(
            f"exported view {image.width}x{image.height} is not divisible by {width}x{height} patches"
        )
    patch_width = image.width // width
    patch_height = image.height // height
    reverse_colors = {color: group for group, color in GROUP_COLORS.items()}
    groups: list[int] = []
    for row in range(height):
        for column in range(width):
            left = column * patch_width
            top = row * patch_height
            colors = {
                image.getpixel((x, y))
                for y in range(top, top + patch_height)
                for x in range(left, left + patch_width)
            }
            if len(colors) != 1:
                raise RuntimeError(f"patch ({column}, {height - 1 - row}) was not rendered as one color")
            color = next(iter(colors))
            if color not in reverse_colors:
                raise RuntimeError(f"unexpected NetLogo view color {color}")
            groups.append(reverse_colors[color])
    return groups, image.width, image.height


def _export_view(workspace: pynetlogo.NetLogoLink, path: Path) -> float:
    started = time.perf_counter_ns()
    workspace.command(f'export-view "{path}"')
    return _milliseconds(started)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--netlogo-home", default=None)
    parser.add_argument("--density", type=float, default=0.8)
    parser.add_argument("--balance", type=float, default=0.5)
    parser.add_argument("--threshold", type=float, default=0.7)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--warmup-actions", type=int, default=5)
    parser.add_argument("--measured-actions", type=int, default=20)
    args = parser.parse_args()
    if args.warmup_actions < 0 or args.measured_actions <= 0:
        raise SystemExit("warmup actions must be non-negative and measured actions positive")

    home = _netlogo_home(args.netlogo_home)
    workspace = pynetlogo.NetLogoLink(gui=False, netlogo_home=str(home))
    model_ms: list[float] = []
    recolor_ms: list[float] = []
    export_ms: list[float] = []
    total_ms: list[float] = []
    try:
        workspace.load_model(str(args.model_path.resolve()))
        workspace.command(
            " ".join(
                [
                    f"set density {args.density:.17g}",
                    f"set balance {args.balance:.17g}",
                    f"set similarity-threshold {args.threshold:.17g}",
                    f"set seed {args.seed}",
                    "setup",
                ]
            )
        )
        netlogo_version = str(workspace.report("netlogo-version"))
        if netlogo_version != "7.0.4":
            raise RuntimeError(f"expected NetLogo 7.0.4, received {netlogo_version}")

        with tempfile.TemporaryDirectory(prefix="tensnap-netlogo-render-") as directory:
            png = Path(directory) / "view.png"
            for _ in range(args.warmup_actions):
                workspace.command("advance")
                workspace.command("recolor")
                _export_view(workspace, png)

            for _ in range(args.measured_actions):
                action_started = time.perf_counter_ns()
                stage_started = time.perf_counter_ns()
                workspace.command("advance")
                model_ms.append(_milliseconds(stage_started))
                stage_started = time.perf_counter_ns()
                workspace.command("recolor")
                recolor_ms.append(_milliseconds(stage_started))
                export_ms.append(_export_view(workspace, png))
                total_ms.append(_milliseconds(action_started))

            width, height, groups = _model_groups(workspace)
            raster, image_width, image_height = _raster_groups(png, width, height)
            if groups != raster:
                raise RuntimeError("NetLogo patch state and exported view raster differ")
            png_bytes = png.read_bytes()

        tick = int(float(workspace.report("ticks")))
        canonical = {
            "width": width,
            "height": height,
            "tick": tick,
            "groupsRle": _rle(groups),
        }
        raster_canonical = {
            "width": width,
            "height": height,
            "tick": tick,
            "groupsRle": _rle(raster),
        }
        digest = sha256(png_bytes).hexdigest()
        print(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "timingsMs": total_ms,
                    "metrics": {
                        "actionToPngMs": total_ms,
                        "patches": width * height,
                        "pngBytes": len(png_bytes),
                        "satisfiedPct": float(workspace.report("satisfied-pct")),
                        "segregationIndex": float(workspace.report("segregation-index")),
                    },
                    "stagesMs": {
                        "modelTransitionMs": model_ms,
                        "patchRecolorMs": recolor_ms,
                        "pngExportMs": export_ms,
                    },
                    "state": {
                        "instrumentation": "headless-export-view",
                        "imageWidth": image_width,
                        "imageHeight": image_height,
                    },
                    "correctness": {
                        "valid": True,
                        "actionCount": args.warmup_actions + args.measured_actions,
                        "state": canonical,
                        "expectedState": raster_canonical,
                    },
                    "visual": {
                        "checkpoints": {"final": digest},
                        "inlinePngBase64": {"final": base64.b64encode(png_bytes).decode("ascii")},
                    },
                    "runtime": {
                        "python": platform.python_version(),
                        "pynetlogo": pynetlogo.__version__,
                        "netlogo": netlogo_version,
                        "pillow": Image.__version__,
                        "javaHome": os.environ.get("JAVA_HOME", "auto"),
                    },
                },
                sort_keys=True,
            )
        )
    finally:
        workspace.kill_workspace()


if __name__ == "__main__":
    main()
