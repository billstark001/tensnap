# Frontend presentation and restore behavior

This is the behavior contract for Web, Tauri and agent CLI renderers. Wire protocol 0.3, language bindings, checkpoint encodings and recording formats are unchanged. Shared rendering rules belong to `@tensnap/core/scenario`; hosts supply presentation preferences and rendering budgets.

## Identity and editing

A layout view's `id` identifies that view. `view.data.id` references an existing simulator object in the current live or offline scene. Editing the reference selects an existing object and never renames the simulator object. View IDs and simulator declarations are read-only in the scene editor. Missing references remain visible as unavailable, so opening an incomplete/offline project does not silently rebind it. Creating a view requires an existing source object.

Titles, button text, continuous scheduling and geometry belong to the view. Environment display type selects a renderer without changing the declared environment type or converting simulator state. Binding an environment clears preferences for its previous layers; binding a chart clears its previous series preferences. A custom title is retained; a title that followed the previous object's label follows the replacement label.

Parameter values are applied through the existing session parameter-change operation on save. Types, options, bounds and runtime permissions remain simulator-owned. Runtime restrictions, value types, numeric bounds and enum membership are checked before sending. A disconnected view cannot apply a simulator value. Concurrent edits merge unrelated view fields and reject conflicting edits.

## Layers and force layout

Environment views persist sparse `data.layerOverrides` keyed by layer ID. CLI contexts persist the same field map per environment in `presentation.json`. Only registered presentation fields are editable. Unknown metadata and topology are inspectable but read-only. Absent fields use simulator metadata or the renderer default; clearing an override resumes inheritance. Invalid fields, types, ranges and missing layer references produce explicit errors. Reset-all remains available if a source removes a layer.

| Effective edge `link_distance` | Renderer behavior |
| --- | --- |
| Omitted | Default target length 4; force layout enabled |
| Finite value >= 0 | Force layout enabled, including a zero target length |
| Finite value < 0 | Entire force layout disabled, including charge, centering, collision and initial scattering |

The GUI force switch writes -1 when disabled. Within the editor it remembers the previous nonnegative target length, including zero. Reopening a disabled editor and enabling uses the simulator's nonnegative target length or default 4. Users can set any finite target length directly. Existing saved nonnegative settings retain their meaning.

Disabling keeps current coordinates; it does not recover earlier simulator coordinates. Source updates can still change coordinates. Persistent `fx`/`fy` pins remain fixed during layout and survive a temporary drag. Pan/zoom and appearance-only agent/edge updates do not reheat layout. Topology changes and layout configuration changes may reheat it.

Agent storage has one force writer: the most recently created interactive edge renderer controls the force settings, and each distinct enabled edge storage contributes links once. Other renderers follow position flushes; disposing the writer promotes the newest remaining renderer. Views sharing agent storage therefore share computed coordinates. Read-only inspection never becomes a writer. The CLI renders detached snapshots and cannot change live simulator coordinates.

Only agent layers connected to an enabled force layout allow node dragging. Grid layouts and disabled force layouts pan the canvas, including when dragging over an agent. A node gesture exclusively owns the pointer until release, removal or teardown, so it cannot also pan the canvas. Drag deltas use scene coordinates, including zoom and Y-axis orientation. Replacing an agent icon does not add new gesture handlers.

Headless live renders use deterministic initial placement without extra force iterations by default. `--layout-ticks` accepts integers 0–10000; a positive value explicitly budgets synchronous force iterations, while zero also skips initial placement and renders existing coordinates. Fixed-frame exports preserve recorded coordinates by default; explicitly setting a positive budget opts into relayout. Negative `link_distance` disables layout regardless of tick budget. These controls do not add protocol fields or invoke simulator actions.

Grid axes/color, background interpolation and trajectory width/color overrides are passed to renderer instances without changing their underlying storages. Trajectory retention length is read-only because it changes retained data. Overrides do not copy agent arrays, chart history or trajectory history.

## Charts, checkpoints and monitors

Chart views persist an optional `data.chartSeries` display list. Omission follows the published series; an empty list hides all series. Source IDs are read-only. Local entries do not create simulator data sources. Changing labels or removing local entries never deletes shared history columns. Clearing the display list preference resumes inheritance.

GUI restore and CLI frame restore use the same `RendererSession.restoreFrame` policy. The default is `replace` with the selected frame's chart history. The GUI switch selects replace/preserve; the policy selector additionally offers truncate. `preserve` retains live history; `truncate` drops points after the frame's model time and requires a known time. Chart changes commit only after successful simulator restore. Checkpoint restoration sends the opaque checkpoint without adding projected time, parameters or environments; truncate time is a local history option.

Monitors are current observations rather than append-only chart history. Offline replay uses recorded values. Online restoration discards old values in the staging scene and accepts fresh simulator publications; monitors not republished have no value after success. Failure leaves live observations intact. Monitor render hints inherit current simulator metadata unless `data.renderHint` explicitly overrides it. Clearing that preference resumes inheritance.

When recording a successful online restore, renderer-local monitor invalidation and chart history operations are recorded using existing monitor/chart messages. Forward playback and keyframe seeks therefore reproduce the committed renderer state without adding archive fields or changing wire messages sent to the simulator.

Layout preferences survive restore. Simulator-projected agent icons are restored only when included in the simulator's restored scene; the checkpoint does not restore GUI layout or view styling. Asset availability continues to follow the existing asset synchronization and offline recording rules.

## Shared UI and distribution

All switches, including system theme, boolean parameter controls and scene-edit fields, use the shared accessible Switch component. Its dimensions, colors and thumb motion follow the original Settings theme switch. Major content viewports, dialogs, tab strips and structured inspectors use native scrolling with thin, transparent-track CSS scrollbars; there are no JavaScript scrollbar tracks or extra viewport wrappers. Thumb visibility follows hover/focus, with native colors for touch and forced-color environments. Overlay placement and any narrow scrollbar gutter follow the operating system/browser; CSS does not force a separate layout change on hover. Dialog content fills the available height, while footer actions stay outside scrolling and at the bottom with the standard window padding. Environment viewport reset appears after Copy and before the Edit separator in the context menu, including replay previews. Standard form controls retain platform editing behavior. Escape closes an open select before its containing dialog. The same shared UI is bundled by Web and Tauri. Application-owned static styles use vanilla-extract, including workbench chrome, scrollbar styling and animations. Do not add plain CSS or CSS modules. The WinBox dependency retains its own distributed stylesheet for drag/resize/window mechanics, avoiding a fork of third-party styles.

All native selects share padding and theme-aware styling, including restore dialogs and diagnostic filters. Custom select triggers and items use the same spacing; caller attributes preserve their shared styles. View color fields offer a native color picker alongside CSS color text, retaining existing named, shorthand and alpha values until explicitly edited.

Windows Tauri hides its native menu bar and keeps the HTML menu bar. Native menu accelerators remain registered. Startup, auxiliary windows and locale changes preserve this policy. Other platforms keep their existing menu behavior. The existing Tauri release action uploads the plain Windows executable alongside installers. It still requires the usual Windows WebView2 runtime; this change does not create a separate packaging pipeline.

## Recording memory scope

The first part of [issue #36](https://github.com/billstark001/tensnap/issues/36) is addressed by transferring recorder ownership at stop, borrowing immutable history only inside synchronous encoding, avoiding a whole-archive clone for JSON, using typed RLE buffers, and avoiding a second full scene clone during capture. Public detached snapshot/asset-extraction contracts remain intact; existing archives remain readable.

Full decoded archive retention, segment spooling, indexed-store full-scene encoding per boundary and a store-v2 design remain separate work. This change does not claim constant-memory recording or solve the whole issue.
