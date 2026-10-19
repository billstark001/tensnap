# Workbench windows and ownership

## Two boundaries

Web and the Tauri main Webview use one application React root. Toolbar, workspace, split panels and dialogs use `createPortal`, preserving their actual Context and provider instances. Split controllers own DOM geometry. React `Activity` pauses hidden panels' effects while retaining drafts; it is not a second content lifecycle or an external store for React children.

Settings, editing, confirmation, creation and recording replay stay in the owning Webview on both platforms. They do not need IPC, copied stores, serialized callbacks or a synthetic renderer session. `defineDialog` registers dimensions and captures a `DialogScope` when opened. The scope retains the original project's real providers and callbacks; updates from another active tab cannot replace them. Nested dialogs inherit that scope. Removing the owner project unmounts its dialogs. Callbacks can change normally while their owner remains the same.

Only **AgentDetailsDialog** and **SimulatorInfoDialog** have native tool windows. This allowlist is part of `auxiliary-protocol.ts`, not an incidental result of component registration. Each native tool has one bootstrap root. The main window is the only authority for projects, simulator connections, persistence and mutations; auxiliary bootstrap does not hydrate/write settings, initialize a filesystem, register models or create project/session stores. Auxiliary capabilities permit events and title updates, not file access, settings writes or child-window creation.

## Explicit protocol

The protocol has a versioned, validated request union:

| Message | Meaning |
| --- | --- |
| `initialize` | Obtain the initial tool projection, appearance and owner project ID |
| `inspect` | Read a selected agent's neighbourhood using radius, revision token and held asset hashes |
| `menu` | Dispatch a registered workbench command against the original project ID |
| `cancel` notification | Abort the operation identified by request ID |
| `close` notification | Ask the owner to close and release this tool |

There is no generic callback/invoke mechanism. Functions, DOM events, Maps, service instances, renderer sessions and arbitrary store methods cannot be encoded. The data codec supports plain records/arrays/primitives and explicit binary bytes. Records are tagged to avoid collisions with user data. Requests, response envelopes and state projections have runtime schemas; inspection replies are validated before reaching rendering code. Packets have an 8 MiB encoded limit and structural/depth limits. Large grids, trajectories and visible populations still contribute to this budget; the limit fails explicitly rather than creating an unbounded IPC allocation.

State packets contain a monotonic revision, immutable content ID and project ID, appearance, and exactly one tool's data. Information tools receive only handshake identity and metadata, never scenes or recording histories. Their subscriptions follow metadata/identity changes. Appearance subscriptions select locale/theme only. Inspector state carries only its target; scene data arrives through bounded inspection reads. There is no propsVersion coupling between connection status and recording playback.

`auxiliary-owner.ts` owns authority, subscriptions and inspection indexes. `auxiliary-content.tsx` owns presentation in the caller-provided root. `auxiliary-protocol.ts` is their complete wire contract. Adding a native tool requires an explicit projection, schema, command permissions and lifecycle tests; adding `defineDialog` alone does not create another IPC surface.

## Lifetimes and backpressure

The owner registers its request listener before creating the Webview. The receiver registers response/state listeners before initializing. Publication is coalesced at 100 ms and allows only one emit in flight. The receiver rejects ownership changes and ignores old/duplicate revisions.

Each RPC has a deadline, optional AbortSignal, and owned timer/listener. Timeout, cancellation and teardown remove pending requests and notify the owner to abort. Each side limits outstanding requests to 32. Cancellation ends a pending read or reply; it does not roll back a menu command already dispatched to the main window. Closing the owner aborts its operations, releases subscriptions/indexes/listeners and destroys the native window. Listeners acquired after cancellation are immediately stopped. Main-window close destroys its tools; native tools cannot own descendants.

The owner retains a spatial index only for the inspected layer when core inspection semantics require one; uniform and graph views do not build unnecessary spatial indexes. Structural changes and retargeting release the previous index. The receiver retains one inspection source per selected target. Unrelated appearance updates preserve controls and source identity. Retargeting cancels stale requests and resets asset acknowledgements. One read is in flight; successful polling waits 100 ms after completion. Transient failures retry with exponential backoff; five consecutive failures report an error and close the tool. Closure cancels all timers and reads. The receiver's small Scenario belongs to the inspection hook and resets on retarget/unmount, revoking Blob URLs. The codec never constructs Scenarios or owns image URLs.

Replay is local to its owning Webview. Its source is acquired in an effect and releases its rendering scene on cleanup. Activity/StrictMode reactivation recreates it at the retained cursor. Connection changes do not replace a recording.

Locale activation is serialized per auxiliary document, including across cancelled mounts. Mirrored appearance affects rendering only and never writes back into the authoritative settings store.

## Menus and geometry

Main and auxiliary native menu listeners use the same workbench command allowlist and main-side handlers. Unimplemented zoom/grid/shortcut placeholder menu items have been removed.

Dropdown and context menus share a DOM controller for positioning, keyboard navigation and focus return. React portals render actual menu attributes and handlers. Trigger handlers compose and respect preventDefault. There are no accepted-but-ignored Radix positioning parameters. Context menus add a real right-click interaction rather than an alias export.

Browser WinBox and native tools share logical-pixel geometry policy and per-type placement storage. Resizing a host does not remount content. Clearing saved positions changes a generation so open windows cannot resurrect cleared placements. Web uses localStorage; only the Tauri main owner writes native placement to plugin-store.

See [validation](workbench-validation.md) for commands and platform interaction checks.
