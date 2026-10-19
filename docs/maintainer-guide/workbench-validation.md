# Workbench and recording validation

Run from the repository root:

```sh
pnpm --filter @tensnap/core test
pnpm --filter @tensnap/web test
pnpm --filter @tensnap/web-adapter test
pnpm --filter @tensnap/agent test
pnpm --filter @tensnap/agent test:recording-workflow
pnpm --filter @tensnap/agent test:package
pnpm lint:js
pnpm -r typecheck
pnpm --filter @tensnap/web build
pnpm --filter @tensnap/tauri exec tauri build --debug --bundles app --no-sign
```

The recording workflow starts a real seeded Schelling WebSocket model and built CLI runtime. It verifies default JSON behavior, explicit MessagePack run/manual recording, catalog discovery, full recording export/read, mixed-format fixed-frame comparison, checkpoint restore/rerun and identical offline images. It writes a machine-readable report under `.tensnap/recording-acceptance-*/acceptance.json`. The model and runtime are stopped in cleanup.

Web tests cover both file encodings, batch import into an empty tab, destination capture across tab switches, project recording extraction without connecting a source, duplicate/corrupt-file isolation, and undo. Native-host tests mock only the Tauri SDK and check listener-before-window ordering, callback routing, initialization failure, cancellation and disposal. Codec tests exercise actual JSON IPC representations, binary values and callback cancellation. Inspection tests forbid full-scene dumps and compare payload size for 1,000 and 100,000 agents with the same visible region.

For a local projection diagnostic:

```sh
pnpm --filter @tensnap/agent exec tsx ../tensnap-web/scripts/measure-inspection.mts
```

This measures indexed owner-side inspection, projection, JSON encode/decode and local receiver load. It excludes native IPC latency and canvas painting. The first spatial-index setup is reported separately. It is a diagnostic, not a cross-machine performance threshold.

## Local diagnostic result

On 2026-10-19, macOS with Node 26.8.1, 100 samples after 20 warmups, a fixed 25-agent visible region produced:

| Total agents | Plain projection JSON | Initial index setup | Local inspect median | Projection/JSON/receive median | p95 |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 1,654 B | 0.567 ms | 0.020 ms | 0.057 ms | 0.069 ms |
| 10,000 | 1,654 B | 2.619 ms | 0.019 ms | 0.055 ms | 0.071 ms |
| 100,000 | 1,654 B | 20.152 ms | 0.018 ms | 0.050 ms | 0.085 ms |

These measurements cover the projection's plain JSON representation, not the content callback envelope, real Tauri IPC or paint. They show that distant population does not enlarge the selected view; they do not establish an end-to-end native latency budget. Grid/trajectory output and visible population can still increase cost.

## Native and browser interaction checks

These steps require interactive UI access and are separate from the automated tests. Launch `pnpm --filter @tensnap/web dev` for the browser and `pnpm --filter @tensnap/tauri dev` for desktop (or open the built app).

1. Create a built-in model, record several steps, export both JSON and MessagePack with assets. Open both through Open File and drag both onto the workbench. Each opens a new offline tab with its complete timeline. Repeat with an older JSON recording.
2. Drop both files onto Snapshots. Verify they join the captured tab, preserve all frames/assets and can be undone per file. Try a duplicate ID and a corrupt file together with a valid file. Close all tabs and repeat to verify one new offline tab for the batch.
3. In the browser, move/resize a dialog and both splitters while editing an unsaved field. Verify its draft and inspection radius/follow state survive. Check keyboard separator arrows, menu arrows/Home/End/typeahead, disabled items, Escape, outside dismissal and returned focus. Open a nested confirmation and Select; only the top dialog/menu should dismiss.
4. On desktop, open Settings, About and Agent inspection. Verify they are independent native windows. Move/resize them, switch the main project tab, then edit a field or invoke a native menu command. It must affect the original project. Inspect the model connection count to verify one connection per project. Close the owning project and verify its auxiliary windows close.
5. Desktop: drag files onto workbench versus Snapshots, including paths containing spaces/non-ASCII characters and a file outside previously authorized directories. Repeat on a scaled display and after moving to a display with another scale factor. Verify drop highlighting and destination match the pointer, and cancellation/errors do not create partial tabs.
6. Close a native window during initialization and during an asynchronous action; repeatedly reopen/close an inspector. Verify no orphan windows, duplicate updates or unhandled errors. Exit the main window and verify auxiliary windows exit too.

macOS builds do not establish Windows/Linux window-manager behavior; run these interaction checks on each target platform before release.
