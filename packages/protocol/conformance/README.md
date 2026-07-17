# v0.3 conformance traces

Each JSON file is an ordered protocol trajectory. Consumers must validate every
message against `@tensnap/protocol`, then assert the named outcome without
inventing additional wire messages. The suite is intentionally transport-neutral
and is shared by renderer and binding tests.
