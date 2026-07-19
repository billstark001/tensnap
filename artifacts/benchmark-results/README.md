# Benchmark result artifacts

This directory retains verified benchmark outputs by execution environment.
The current data set is documented in
[`macos-15.7.5-arm64/README.md`](macos-15.7.5-arm64/README.md).

Each profile directory contains a manifest, raw samples, derived analyses, a
human-readable report, and any visual checkpoints required by the profile.
Append-only execution journals are intentionally excluded after final artifact
assembly. Generated results are committed here only after `bench verify`
succeeds.
