# @tensnap/agent

Headless control and rendering for TenSnap simulators. Keep a local runtime connected to a Python/Mesa, Go, Julia, or JS/TS simulator; inspect its scene, edit parameters, invoke actions, run bounded simulations, and save images or recordings.

Requires **Node.js 22 or newer** (`engines.node: >=22.0.0`; build target: Node 22). Headless rendering uses `canvas`; platforms without a prebuilt binary need the [node-canvas build prerequisites](https://github.com/Automattic/node-canvas#compiling). If your package manager restricts dependency install scripts, allow `canvas` to install its native binary.

## Install and connect

```sh
npm install --global @tensnap/agent
tensnap-agent --version
tensnap-agent --help
tensnap-agent run start --help

# Start your TenSnap simulator separately, then connect:
tensnap-agent runtime up --context demo --simulator-url ws://127.0.0.1:8765
tensnap-agent scene inspect --context demo
tensnap-agent action list --context demo
tensnap-agent param list --context demo
tensnap-agent run start start --max-actions 100 --context demo
tensnap-agent run status --context demo
tensnap-agent scene render --env main --output ./main.png --context demo
tensnap-agent runtime down --context demo
```

Use action, parameter, and environment IDs from your simulator's inspection results. `start` and `main` above are example IDs. For a project dependency, use `npm install --save-dev @tensnap/agent` and invoke `npx --no-install tensnap-agent ...` from that project. No source checkout or pnpm workspace is required.

State and captures live under `.tensnap/contexts/<context>/` by default; `--context-dir <path>` changes the storage root. `action run <id>` dispatches once; `run start <id>` requires `--max-actions` and supports `--stop-when`, `--max-wall-time-ms` and `--record`. Add `--wait` for correlated completion; recorded runs can use `--until persisted`. `run wait <run-id>` and `action wait <request-id>` retain identity across later operations. Timeouts cancel only the wait. Use `--output-version 1` for versioned JSON results and errors on stdout; diagnostics go to stderr.

Use `--help` on any command or command group for generated help, including commands with required arguments. Help and `--version` also support `--output-version 1`. Use `--` before positional values that begin with a dash, for example `tensnap-agent param set label -- --literal`.

## Recordings and evidence

```sh
tensnap-agent run start start --max-actions 20 --record --wait --until persisted --context demo
tensnap-agent recording list --context demo
tensnap-agent recording export <recording-id> --output run.tensnap-recording.json --context demo
tensnap-agent recording info run.tensnap-recording.json
tensnap-agent recording export-frame run.tensnap-recording.json --frame 10 --env main --output evidence
tensnap-agent frame save --checkpoint required --env main --output saved --context demo
tensnap-agent frame restore saved --mode checkpoint --history replace --context demo
tensnap-agent frame compare saved evidence
```

Offline commands need no simulator or daemon and select actual retained frames. Model time requires an explicit matching rule. Evidence directories own their scene, optional checkpoint and images, with a verified manifest committed after all requested artifacts succeed. Existing evidence is never overwritten. Independent recordings open directly in an empty GUI. See the [runtime guide](../../docs/user-guide/agent-runtime.md) for format, capability, retention and failure semantics.

Published automatic recording IDs are immutable within a runtime context, including after restart and across JSON/MessagePack. Files publish under `recordings/id-<URI-encoded-id>/recording.tensnap-recording.<format>`; use the returned path. Legacy flat files remain readable and reserve their IDs. Manual and bounded recording writes share admission and format ownership. Disconnect/runtime shutdown settle actions, finalize manual/run recordings and drain writes before finishing; repeated shutdown calls join the same operation. See [runtime persistence guarantees](../../docs/user-guide/agent-runtime.md#library-ownership-and-file-commits) for temporary-directory cleanup and crash limitations.

Recording files default to JSON. Use `--recording-format msgpack` with `run start --record`, `recording start`, `recording export`, `frame save`, or `recording export-frame` to select MessagePack. This flag is independent of image `--format png|jpeg`, and filename extensions do not select encoding. Catalogs, offline readers and evidence restore/compare accept both encodings; evidence manifests identify either `state.recording.json` or `state.recording.msgpack`. CLI result output remains JSON.

## Install the bundled skills offline

The package includes two stable skill names and their reference files, matched to the CLI version:

| Skill                 | Purpose                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `tensnap-agent`       | Inspect, control, and render a running simulator                    |
| `tensnap-abm-binding` | Implement and debug Python/Mesa, Go, Julia, or JS/TS model bindings |

```sh
tensnap-agent skills list
tensnap-agent skills install tensnap-agent
tensnap-agent skills install tensnap-abm-binding --scope user
tensnap-agent skills install --all --project-dir /path/to/model --output-version 1
tensnap-agent skills install --all --agent claude-code --scope user
```

Every install is non-interactive. Select exactly one name or `--all`; no confirmation flag is needed. Installation copies the entire skill and references from the installed npm package, makes no network requests, and survives removal of the package's original installation directory. Bindings and simulator executables remain separate dependencies.

| Target                         | Project scope (default) | User scope (`--scope user`) |
| ------------------------------ | ----------------------- | --------------------------- |
| `codex` (default), `universal` | `<cwd>/.agents/skills/` | `~/.agents/skills/`         |
| `claude-code`                  | `<cwd>/.claude/skills/` | `~/.claude/skills/`         |

`--project-dir` selects a project explicitly and cannot be combined with user scope. Codex uses the shared Agent Skills directory here; legacy `~/.codex/skills` and `CODEX_HOME` are not changed. Restart or reload your coding agent after installing skills if it caches discovery. Results identify the absolute destination, package version, per-skill status, and any backup path. `skills list` lists bundled skills and their source path; it does not enumerate other installed skills.

### Reinstall, upgrade, and local edits

Re-run `skills install` after upgrading the CLI. Each installed directory has a `.tensnap-skill.json` receipt with its package version, file hashes, and executable-file list.

- Same version and contents: `unchanged`, no rewrite.
- Unmodified managed skill from another CLI version or snapshot: `upgraded` to the invoking CLI's bundle. This also permits an intentional downgrade by invoking an older CLI.
- An existing name without a valid receipt, added/deleted/modified files or directories, or changed executable bits: exit 2 (`input_error`); existing content is preserved. Selecting `--all` checks every target before replacing any. Edits detected during staging abort the install; retry after the edit is complete. Executable bits are tracked on Unix; Windows does not use that check.
- `--force`: replace conflicting content and return `replaced`, after moving the original entry to the sibling `.agents/.tensnap-skill-backups/` (or `.claude/.tensnap-skill-backups/`). Upgrades also retain a backup. Backups are outside the skills discovery directory; review or remove them manually when no longer needed.

Symlinked skill entries count as conflicts. Forced replacement backs up the link itself and leaves its target intact. Symlinks in destination `.agents`, `.claude`, or `skills` directories are rejected. Copies are staged outside the skills discovery directory, checked against the bundled hashes and executable list, and renamed into place.

Concurrent installs into the same destination are locked. Ordinary write failures roll back the invocation. If a rollback itself fails, other targets are still restored, the original backups are retained, and exit 6 reports the affected paths and keeps the recovery lock. Restore those paths before removing that lock. Cleanup failures also report remaining paths without hiding the original error. After an interrupted process, inspect the lock and any backups before removing the lock and retrying. This does not promise crash recovery across multiple directory renames.

## Alternative: Vercel skills

The [Vercel skills CLI](https://github.com/vercel-labs/skills) can install either skill directly from this repository, independently of the TenSnap CLI installer. Run project installs from the model project's directory:

```sh
# Discover available names (requires network):
npx skills add billstark001/tensnap --list

# Select one skill for Codex in the current project:
npx skills add billstark001/tensnap --skill tensnap-agent --agent codex

# Or select both:
npx skills add billstark001/tensnap --skill tensnap-agent --skill tensnap-abm-binding --agent codex

# User-level, non-interactive installation for Claude Code:
npx --yes skills add billstark001/tensnap --skill tensnap-agent --agent claude-code --global --copy --yes

# Confirm installed skills in the selected scope:
npx skills list --agent codex
npx skills list --agent claude-code --global

# Or use the exact local bundle path returned by `tensnap-agent skills list`:
npx --yes skills add /absolute/path/to/installed/agent/skills --skill tensnap-agent --skill tensnap-abm-binding --agent codex --copy --yes
```

`--skill` selects names, `--agent` selects the coding agent, and `--global` changes project scope to user scope. `--copy` requests independent copies. The first `--yes` bypasses npm's package-download prompt; the last bypasses the skills tool's prompts. Repository skills follow the chosen Git revision; use a GitHub tree URL at a released tag or commit to pin them.

The local npm bundle matches the installed CLI version. Vercel `skills` itself must already be installed/cached for offline local-source use. Its lock files, updates, and overwrite policies are independent: it does not write a TenSnap receipt. Installing over a Vercel-managed destination with `tensnap-agent` therefore reports a conflict unless `--force` is explicitly requested; Vercel's installer does not provide TenSnap's receipt checks or backup guarantee.

## Detailed references and source builds

The npm package includes the [runtime guide](../../docs/user-guide/agent-runtime.md), [protocol specification](../protocol/SPECIFICATION.md), and binding API references inside `skills/tensnap-abm-binding/references/`. These links are rewritten to the bundled copies during the build. [TenSnap on GitHub](https://github.com/billstark001/tensnap) contains the source and runnable simulators.

From a checkout:

```sh
pnpm install
pnpm --filter @tensnap/agent skills:sync  # refresh checked-in skill reference snapshots
pnpm --filter @tensnap/agent build        # checks snapshots and stamps the package version
pnpm --filter @tensnap/agent test:package # pack, install, and smoke-test outside the checkout
pnpm --filter @tensnap/agent test:recording-workflow # seeded model, restore/re-run, and offline evidence
pnpm --filter @tensnap/agent test:package:ecosystem # also verify the Vercel skills local-source fallback
```

The recording workflow test runs seeded Schelling through the built public CLI. It verifies recording persistence, checkpoint restore, chart history, deterministic re-run, classified target failure and identical offline rendering after shutdown.

The publishing artifact is `packages/tensnap-agent/dist`, with its own npm manifest and README. Pack that directory with `npm pack ./packages/tensnap-agent/dist`, then install the resulting `.tgz` with npm. Packing the workspace source manifest directly with npm is unsupported because it contains `workspace:*` dependencies. The acceptance script builds and packs `network`, `protocol`, and `core` using the release workflow's pnpm pack step, then installs all artifacts with npm into an isolated directory and HOME. This permits testing unpublished dependency versions without modifying the registry. Publishing remains a separate release operation. The workspace development toolchain still requires Node 24; the installed agent package supports Node 22.

MIT licensed.

For typed scene/monitor queries, explicit diff policies, trigger collection, incremental stores and offline recovery/range commands, see the [runtime guide](../../docs/user-guide/agent-runtime.md#bounded-queries-and-explicit-comparison). Store format, ownership and resource limits are in the [storage contract](../../docs/api-reference/recording-storage.md).
