"""Canaries for the publication harness, separate from the runnable example."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from experiments.fire_dqn_replay.run import ROOT, run, verify


def test_live_wire_and_evidence_canaries(tmp_path):
    output = tmp_path / "evidence"
    args = SimpleNamespace(
        output=output,
        policy=ROOT / "examples/python_dqn/checkpoints/dqn_latest.pt",
        seeds=1,
        seed_start=5000,
        capture_step=2,
        horizon=4,
        encodings=["json", "msgpack"],
    )
    asyncio.run(run(args))
    rows = json.loads((output / "trials.json").read_text())
    assert all(row["exactActions"] and row["exactPolicy"] for row in rows)
    # Same seed, configuration, and policy must produce the same paired outcomes.
    assert rows[0]["dqnEvacuated"] == rows[1]["dqnEvacuated"]
    assert rows[0]["noGuideEvacuated"] == rows[1]["noGuideEvacuated"]
    summary = output / "summary.json"
    saved = summary.read_bytes()
    summary.write_text("{}")
    with pytest.raises(ValueError, match="checksum mismatch"):
        verify(output)
    summary.write_bytes(saved)
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["plan"]["seeds"] = 2
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="seed matrix"):
        verify(output)
