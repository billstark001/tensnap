# v0.3 protocol trajectories

Each JSON file is an ordered wire trajectory. Consumers validate every message
against `@tensnap/protocol`, then assert the named outcome without inventing
additional messages. The traces are transport-neutral and are checked by the
[root trace validator](../validate_traces.ts).
