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

See [workbench infrastructure](workbench-infrastructure.md) for creation and synchronization contracts. Root-lifecycle tests verify one caller-owned root, inherited context and persistent drafts. Retarget tests verify that an already-open inspector switches agent without a full dump. Menu tests stub browser/native capabilities; they never open a real browser.

Web tests cover both file encodings, batch import into an empty tab, destination capture across tab switches, project recording extraction without connecting a source, duplicate/corrupt-file isolation, and undo. The native integration test mocks only the Tauri SDK and canvas, and exercises real owner, protocol, receiver and UI content across JSON IPC. Lifecycle tests additionally cover listener-before-window ordering, initialization failure, cancellation and disposal. Protocol tests reject callbacks/services/events and preserve binary and tagged user data. Scope tests verify local confirmations and project-bound mutations after switching tabs. Inspection tests forbid full-scene dumps and compare payload size for 1,000 and 100,000 agents with the same visible region.

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

These measurements cover the projection's plain JSON representation, not the tagged transport envelope, real Tauri IPC or paint. They show that distant population does not enlarge the selected view; they do not establish an end-to-end native latency budget. Grid/trajectory output and visible population can still increase cost.

## Native and browser interaction checks

These steps require interactive UI access and are separate from the automated tests. Launch `pnpm --filter @tensnap/web dev` for the browser and `pnpm --filter @tensnap/tauri dev` for desktop (or open the built app).

1. Create a built-in model, record several steps, export both JSON and MessagePack with assets. Open both through Open File and drag both onto the workbench. Each opens a new offline tab with its complete timeline. Repeat with an older JSON recording.
2. Drop both files onto Snapshots. Verify they join the captured tab, preserve all frames/assets and can be undone per file. Try a duplicate ID and a corrupt file together with a valid file. Close all tabs and repeat to verify one new offline tab for the batch.
3. In the browser, move/resize a dialog and both splitters while editing an unsaved field. Verify its draft and inspection radius/follow state survive. Check keyboard separator arrows, menu arrows/Home/End/typeahead, disabled items, Escape, backdrop non-dismissal and returned focus. Open a nested confirmation and Select; only the top dialog/menu should dismiss.
4. On desktop, open Agent inspection and Simulator Info. Verify they are independent native windows. Open Settings, About, replay and editing; verify they stay in the main Webview. Move/resize them, switch the main project tab, then edit a field or invoke a native menu command. It must affect the original project. Inspect the model connection count to verify one connection per project. Close the owning project and verify its auxiliary windows close.
5. Desktop: drag files onto workbench versus Snapshots, including paths containing spaces/non-ASCII characters and a file outside previously authorized directories. Repeat on a scaled display and after moving to a display with another scale factor. Verify drop highlighting and destination match the pointer, and cancellation/errors do not create partial tabs.
6. Close a native window during initialization and during an asynchronous action; repeatedly reopen/close an inspector. Verify no orphan windows, duplicate updates or unhandled errors. Exit the main window and verify auxiliary windows exit too.

macOS builds do not establish Windows/Linux window-manager behavior; run these interaction checks on each target platform before release.

For the window chrome and replay follow-up, also check:

1. macOS: the main window retains the overlay title bar and system window buttons. The menu occupies the same top row as the system controls, with an 80 px left reservation and no extra title row. Resize the window, enter/exit fullscreen, drag the empty menu-row area and double-click it; menu commands must remain clickable and the left reservation must disappear in fullscreen.
2. Web: open a dialog in light and dark themes. Its header, border and body follow the application theme; only its header title is visible. Tab to the header Close control and press Enter or Space. Move/resize a modal dialog and confirm that its draft remains intact.
3. Replay: verify the slider is above one button row, that previous/next navigate actual retained frames, first/last buttons respect endpoints, manual navigation pauses playback and Play at the end restarts. Repeat with a nonzero initial frame and a single-frame capture.
4. Custom Data: open tree/table/text values containing long strings, indentation and line breaks. Check that their contents are complete, rows do not overlap and the horizontal table scrollbar still reveals additional columns.

For window sizing and persistence, also check:

1. Open Create New Project, Agent Details, Settings and a small confirmation in both hosts. Only the host title appears; initial sizes differ by content, and dark native windows paint the entire client area without a white strip. Shrink each window to its minimum and enlarge it to its maximum; controls remain reachable by scrolling.
2. Web: drag each edge/corner resize handle, including its outermost pixels. Neither resizing nor clicking the backdrop closes the window. The titlebar Close control and Escape still close dismissible windows; a pending restore stays open.
3. Move/resize two different dialog types, close and reopen them, then reload/restart. Each type restores its own placement. Reduce the browser viewport or remove a monitor and reopen: the window fits the available area. Repeat on displays with different scaling.
4. Settings → Clear saved window positions. Keep an inspector open during the reset, then close it; reopening must use its default placement. Other settings, projects and recordings stay intact.
5. Open the first item of each menu in light/dark themes with mouse and keyboard; focus text and background remain readable. Verify Save/Apply/Create and confirmation choices remain available despite removal of redundant dismissal buttons.

For the responsive workbench and single-root follow-up:

1. Resize the workspace to roughly 640, 900, 1100 and 1400 CSS pixels in English, Chinese and Japanese. Generate a long run summary. Status labels/badges stay on one line; scroll/focus the left status group to read all values. The right controls remain visible, with icon-only labels below the container threshold. Verify reconnect, info, settings and panel toggles still work.
2. Web: open an inspector, change its radius and disable Follow. Click another agent in the originating view: the same window shows the new agent and recenters once while preserving radius/follow/geometry. Continue interacting with the workbench and confirm there is no dimming overlay. Repeat with uniform agents.
3. Tauri: repeat inspector retargeting during an active simulation. Switch project tabs: the inspector must remain tied to its owner. Repeatedly open/close an auxiliary tool, including during initialization; the console must have no duplicate-root warning and each child must release its listeners.
4. Help → Documentation from the rendered menu, the native menu and an auxiliary window's native menu must open the GitHub docs in the system browser on desktop, or a browser tab on Web. No extra native popup should appear. These OS/browser interactions are manual checks; automated tests intercept their adapters.
