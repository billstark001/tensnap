from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from python_dqn import evidence


class EvidenceSourceTests(unittest.TestCase):
    """Exercise the publication check against a real, Git-visible result tree."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="tensnap-fire-source-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.git("init", "--quiet")
        self.write("model.py", "steps = 500\n")
        self.write("benchmark-results/previous.csv", "value\n1\n")
        self.git("add", ".")
        self.git(
            "-c",
            "user.name=Evidence Test",
            "-c",
            "user.email=evidence@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--quiet",
            "-m",
            "test fixture",
        )
        self.output = self.root / "custom results [v1]/batch"
        root_patch = patch.object(evidence, "REPOSITORY_ROOT", self.root)
        root_patch.start()
        self.addCleanup(root_patch.stop)
        env_patch = patch.dict(
            os.environ,
            {
                "TENSNAP_EVALUATION_OUTPUT_DIR": str(self.output),
                "TENSNAP_EVALUATION_WORK_DIR": str(self.root / "scratch [v1]"),
                "TENSNAP_EVALUATION_CACHE_DIR": str(self.root / "cache"),
            },
        )
        env_patch.start()
        self.addCleanup(env_patch.stop)

    def git(self, *args: str) -> str:
        return subprocess.check_output(
            ["git", *args], cwd=self.root, text=True, stderr=subprocess.PIPE
        ).strip()

    def write(self, relative: str, text: str) -> None:
        file = self.root / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)

    def test_generated_outputs_remain_excluded_without_hiding_source_edits(
        self,
    ) -> None:
        evidence._require_clean_source(self.output)
        for relative in (
            "benchmark-results/previous.csv",
            "benchmark-results/current/batch.json",
            "evaluation-results/report.csv",
            "custom results [v1]/batch/summary.json",
            "scratch [v1]/runtime.json",
            "cache/compiled.bin",
        ):
            self.write(relative, "generated\n")
        self.assertTrue(self.git("status", "--short"))
        evidence._require_clean_source(self.output)
        self.write("model.py", "steps = 501\n")
        with self.assertRaisesRegex(SystemExit, "clean Git source tree"):
            evidence._require_clean_source(self.output)

    def test_untracked_source_still_invalidates_publication(self) -> None:
        self.write("new_model.py", "seed = 7\n")
        with self.assertRaisesRegex(SystemExit, "clean Git source tree"):
            evidence._require_clean_source(self.output)

    def test_direct_output_is_excluded_without_an_environment_override(self) -> None:
        self.write("standalone output/evidence.json", "generated\n")
        evidence._require_clean_source(self.root / "standalone output")

    def test_repository_root_cannot_be_excluded(self) -> None:
        with self.assertRaisesRegex(SystemExit, "repository root"):
            evidence._require_clean_source(self.root)

    def test_external_output_does_not_change_repository_exclusions(self) -> None:
        self.assertEqual(
            evidence._source_pathspecs([self.root.parent / "outside"]),
            evidence._source_pathspecs(),
        )


if __name__ == "__main__":
    unittest.main()
