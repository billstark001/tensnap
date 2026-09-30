"""NetLogo 7 Schelling in-memory render benchmark with a PNG audit oracle.

NetLogo's ``export-view`` primitive necessarily encodes and writes a PNG.  This
adapter instead calls the public ``HeadlessWorkspace.exportView()`` Java method,
which paints into a ``BufferedImage`` and performs no PNG encoding or file I/O.
Only the final in-memory frame is encoded once, outside all timed intervals, so
the retained screenshot can still be checked against the NetLogo patch state.
"""

from __future__ import annotations

import argparse
import base64
from io import BytesIO
from hashlib import sha256
import json
import os
from pathlib import Path
import platform
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


def _headless_workspace(link: pynetlogo.NetLogoLink):
    """Unwrap PyNetLogo's bridge to its NetLogo HeadlessWorkspace.

    PyNetLogo exposes only command/report methods, but its bridge stores the
    public NetLogo workspace in a private Java field.  Reflection is confined
    here and the exact runtime class is checked before any measurement.
    """
    field = link.link.getClass().getDeclaredField("workspace")
    field.setAccessible(True)
    workspace = field.get(link.link)
    class_name = str(workspace.getClass().getName())
    if class_name != "org.nlogo.headless.HeadlessWorkspace":
        raise RuntimeError(f"expected HeadlessWorkspace, received {class_name}")
    return workspace


def _rgba_pixels(image) -> list[tuple[int, int, int, int]]:
    width = int(image.getWidth())
    height = int(image.getHeight())
    values = image.getRGB(0, 0, width, height, None, 0, width)
    return [
        (
            (int(value) >> 16) & 0xFF,
            (int(value) >> 8) & 0xFF,
            int(value) & 0xFF,
            (int(value) >> 24) & 0xFF,
        )
        for value in values
    ]


def _raster_groups(image, width: int, height: int) -> tuple[list[int], int, int]:
    image_width = int(image.getWidth())
    image_height = int(image.getHeight())
    if image_width % width or image_height % height:
        raise RuntimeError(
            f"rendered view {image_width}x{image_height} is not divisible by {width}x{height} patches"
        )
    pixels = _rgba_pixels(image)
    patch_width = image_width // width
    patch_height = image_height // height
    reverse_colors = {color: group for group, color in GROUP_COLORS.items()}
    groups: list[int] = []
    for row in range(height):
        for column in range(width):
            left = column * patch_width
            top = row * patch_height
            colors = {
                pixels[y * image_width + x]
                for y in range(top, top + patch_height)
                for x in range(left, left + patch_width)
            }
            if len(colors) != 1:
                raise RuntimeError(f"patch ({column}, {height - 1 - row}) was not rendered as one color")
            color = next(iter(colors))
            if color not in reverse_colors:
                raise RuntimeError(f"unexpected NetLogo view color {color}")
            groups.append(reverse_colors[color])
    return groups, image_width, image_height


def _render_view(workspace):
    started = time.perf_counter_ns()
    image = workspace.exportView()
    return image, _milliseconds(started)


def _encode_png(image) -> bytes:
    pil_image = Image.new("RGBA", (int(image.getWidth()), int(image.getHeight())))
    pil_image.putdata(_rgba_pixels(image))
    output = BytesIO()
    pil_image.save(output, format="PNG")
    return output.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--netlogo-home", default=None)
    parser.add_argument("--density", type=float, default=0.8)
    parser.add_argument("--balance", type=float, default=0.5)
    parser.add_argument("--threshold", type=float, default=0.8)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--warmup-actions", type=int, default=5)
    parser.add_argument("--measured-actions", type=int, default=495)
    args = parser.parse_args()
    if args.warmup_actions < 0 or args.measured_actions <= 0:
        raise SystemExit("warmup actions must be non-negative and measured actions positive")

    home = _netlogo_home(args.netlogo_home)
    workspace = pynetlogo.NetLogoLink(gui=False, netlogo_home=str(home))
    model_ms: list[float] = []
    recolor_ms: list[float] = []
    raster_ms: list[float] = []
    total_ms: list[float] = []
    final_image = None
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
        headless = _headless_workspace(workspace)

        for _ in range(args.warmup_actions):
            workspace.command("advance")
            workspace.command("recolor")
            final_image, _ = _render_view(headless)

        for _ in range(args.measured_actions):
            action_started = time.perf_counter_ns()
            stage_started = time.perf_counter_ns()
            workspace.command("advance")
            model_ms.append(_milliseconds(stage_started))
            stage_started = time.perf_counter_ns()
            workspace.command("recolor")
            recolor_ms.append(_milliseconds(stage_started))
            final_image, raster_elapsed = _render_view(headless)
            raster_ms.append(raster_elapsed)
            total_ms.append(_milliseconds(action_started))

        if final_image is None:
            raise RuntimeError("NetLogo did not produce an in-memory view")
        width, height, groups = _model_groups(workspace)
        raster, image_width, image_height = _raster_groups(final_image, width, height)
        if groups != raster:
            raise RuntimeError("NetLogo patch state and in-memory view raster differ")
        # PNG encoding is deliberately outside every warmup and measured action.
        png_bytes = _encode_png(final_image)

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
                        "actionToInMemoryViewMs": total_ms,
                        "patches": width * height,
                        "pngBytes": len(png_bytes),
                        "satisfiedPct": float(workspace.report("satisfied-pct")),
                        "segregationIndex": float(workspace.report("segregation-index")),
                    },
                    "stagesMs": {
                        "modelTransitionMs": model_ms,
                        "patchRecolorMs": recolor_ms,
                        "viewRasterizationMs": raster_ms,
                    },
                    "state": {
                        "instrumentation": "headless-in-memory-view",
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
