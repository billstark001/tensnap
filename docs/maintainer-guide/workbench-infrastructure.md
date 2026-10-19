# Workbench windows, menus, and synchronization

This guide describes the shared UI infrastructure and how to extend it. Rendering and simulator semantics remain owned by core; windows and menus own presentation and lifecycle only. See [architecture](architecture.md#workbench-content-and-auxiliary-windows) for the package boundary and [validation](workbench-validation.md) for automated commands and manual checks.

## Hosts and React ownership

There are three distinct trees: the DOM layout, React component ancestry, and the native window hierarchy. A portal changes DOM placement while retaining React ancestry and Context; it does not create a root.

```text
Application root
└─ Providers
   ├─ App
   │  ├─ Portal → toolbar DOM host
   │  │  └─ MenuBar / tools / project tabs
   │  ├─ Portal → workspace DOM host
   │  │  └─ ProjectPanel
   │  │     ├─ StatusBar
   │  │     └─ DOM splitters
   │  │        ├─ Portal → main view
   │  │        ├─ Portal → right panel
   │  │        └─ Portal → terminal
   │  └─ application dialogs
   └─ shared dialog anchors / toasts
```

`createWorkbenchShell` and `createSplit` own DOM placement and geometry. `ContentIsland` binds those slots to `ContentDefinition` through `mountContent`, using a portal. Resizing or moving the same slot must not remount its business UI. Hiding a panel preserves its content. Project tabs switch the active store/provider; they do not create a root for each tab.

Root ownership in a running application, excluding benchmarks and tests:

| Host | React roots |
| --- | --- |
| Web page | 2: application and independently initialized browser file picker |
| Tauri main Webview | 1: its bootstrap root |
| Each Tauri auxiliary Webview | 1: its bootstrap root, also rendering its business content |
| Tauri with N auxiliary windows | 1 + N |

Only the entry point creates a Tauri Webview's root. `TauriApp` supplies a render callback to `startNativeContent`; `mountNativeContent` / `reactContent` update that callback instead of calling `createRoot`. Disposing content renders `null` through that callback and releases its services. It does not unmount the bootstrap root. Cleanup must ignore callbacks after an aborted startup, including React StrictMode's setup/cleanup cycle. Never call `createRoot` again on `#root` or create a hidden second root for dialog content.

## Creating a window

Define the business component using `Dialog.Root`, then register it with a stable content ID and dimensions:

```tsx
function ExampleContent({
  open,
  onOpenChange,
  onSave,
}: DialogOpenProps & {
  onSave: () => void;
}) {
  const { _ } = useLingui();
  return (
    <Dialog.Root title={_(msg`Example`)} open={open} onOpenChange={onOpenChange}>
      <Dialog.Body>{/* Business content */}</Dialog.Body>
      <Dialog.Footer>
        <Dialog.Button variant="primary" onClick={save}>
          Save
        </Dialog.Button>
      </Dialog.Footer>
    </Dialog.Root>
  );
}

export const ExampleDialog = defineDialog('ExampleDialog', ExampleContent, {
  width: 680,
  height: 520,
  minWidth: 400,
  minHeight: 280,
});
```

The snippet shows the structure; import the normal Lingui macros and business dependencies in the owning module. The owner-provided `onSave` callback handles persistence, errors and any close-after-save policy. For native use, import that module in `workbench/native-content.tsx` so the auxiliary document registers its content ID. Choose a stable ID independent of the localized title. If the dialog needs project services, extend the existing `contentOwner` projection and callback scope rather than connecting a second simulator.

`DialogHost.create` returns a `ContentWindow` with a content element, `update`, and `dispose`. The host receives the title explicitly. Do not render a second body title or an extra X; use the host close control. Keep Save/Apply and meaningful confirmation decisions in the business content. `dismissible={false}` prevents chrome/Escape closure during a required decision or pending restore; it does not remove explicit business buttons.

Ordinary windows default to nonmodal, allowing the workbench and other agents to remain clickable. Explicit confirmation dialogs use `modal` for their Web focus trap. WinBox's built-in modal mode is not enabled: there is no modal class or backdrop pseudo-element, even for confirmations. Clicking outside a window does not close it. Native windows use their parent ownership and OS chrome; the current native host does not implement an application-wide modal lock.

Web windows keep a per-host activation order; the active dismissible window handles Escape after menus. Nested dialog React components retain their logical ancestry, but WinBox DOM shells are independent siblings rather than a separate persistent parent/child window tree. Native child windows use `parent: ownerLabel`; nested labels encode ancestry for destruction. Closing a project destroys its windows; closing an ancestor native window destroys its descendants.

`window-state.ts` owns shared logical-pixel defaults, minimums, viewport-clamped maximums, and saved placement validation. WinBox resize/maximize and native window options use those same limits. Native placement restores on the remembered display when it remains connected, otherwise fits the current display's work area. `SettingsPersistence` stores each type's geometry: localStorage on Web, plugin-store on desktop. Clearing positions enumerates only the window-placement prefix, preserves other settings, and changes a generation so old open windows cannot repopulate cleared memories.

## Creating a menu

Use `DropdownMenu.Root`, `Trigger`, `Content`, and `Item`; right-click menus use `ContextMenu`, which delegates to the same primitives. Put business actions in `onSelect`/`onClick`. Do not create a React root or attach document listeners in each menu component.

`openMenu` owns the DOM container, positioning, focus return, outside-click dismissal, and keyboard handling. It appends the container to the trigger's nearest `.content-island`, or the document body. `Menu.Content` portals the React items into it, preserving caller Context. Menu state is local to each document. Currently a newly opened root menu replaces the previous menu; a recursive submenu hierarchy is not implemented. Arrow keys, Home/End, typeahead, Escape and Tab are handled centrally. A menu consumes Escape before a dialog can close.

The desktop also has a separate Rust OS menu. Its locale labels live in `src-tauri/src/menu.rs`. A focused auxiliary window receives native menu events and proxies supported commands to its owner through `WorkbenchCommand`; commands carry the original project ID, so switching the main tab cannot redirect Save/Undo to another project. Text editing uses predefined OS menu items.

For host capabilities, extend `MenuBarConfig` instead of adding platform tests inside menu items. Documentation is the example: Web uses the GitHub docs URL with `window.open`; Tauri injects `openDocumentation`. Both the rendered menu and native menu use that adapter. Its fixed `open_documentation_handler` uses the official Rust Opener plugin to open GitHub in the system browser. The renderer cannot supply an arbitrary URL/path, and automatic JS link interception is disabled. Auxiliary documentation commands follow the existing owner command route. Do not use `window.open` as a native popup fallback.

## Cross-window state and commands

A native dialog has one channel UUID, an owner subscription, a `ContentCodec`, and a disposal scope. Register the request listener before creating its Webview. After the child registers response/state listeners, it sends `initialize`; state publishing starts only when the child is ready.

`ContentState` carries a registered content ID, props version, settings, and the selected project projection. It never carries executable component code. The child explicitly provides i18n and its disconnected scenario/history stores. The owner remains the authority for transport and mutations.

`ContentCodec` encodes supported values: plain data, bytes, maps/sets, callback references, cancellation signals, supported rendering/session facades, and static React markup where required. Callbacks are keyed within one content instance; `invoke` runs them on the owner. Do not put arbitrary service class instances in props or silently serialize them as plain objects. Bytes sent through JSON IPC are explicit byte arrays; recording-file MessagePack encoding is a separate concern.

Subscribed context/settings updates are coalesced with a 100 ms publisher. Business props have their own version, so receiving unrelated context does not decode fresh props and reset form state. Owner-local callbacks and operations stay bound to the project that opened the window. Requests have a 30 s timeout and abort propagation. Disposal cancels pending requests and polling, releases subscriptions/codecs/indexes, and destroys the owned native window. Every asynchronously acquired listener must be stopped even if startup has already been cancelled.

## Live agent inspection

`Environment2DView` and `UniformEnvironmentView` feed their selected agent/ref into an existing `AgentDetailsDialog`. Selecting another agent updates that window's target instead of requiring a close/reopen. Web reads shared local state; the normal window remains nonmodal. Radius/follow controls and shell geometry survive retargeting. A new target recenters the preview once even if live follow is off.

Native `contentOwner` keeps a retained `createAgentInspectionSource`. Its `retarget` switches the reference, invalidates the revision token, and reconciles retained spatial indexes. The owner publishes a new props version; the receiving hook cancels its old request, clears old source acknowledgements and reads the new target. Owner-project guards still prevent another tab from taking over the inspector.

Each read projects the visible neighbourhood with core `createAgentInspectionView`. Never call `Scenario.dump()` for an inspector or send the complete model on every tick. Requests include radius, revision token and hashes of assets actually held by the receiver. Responses carry only the projection and required missing bytes; the receiver prunes superseded or unreferenced assets. A single read is in flight; another starts 100 ms after completion. Target/radius changes and closure cancel stale responses. Unchanged reads return a token-only result. Output cost still depends on visible agents, grids and trajectories.

## Responsive status bar

The status bar is one line. Its left group is a keyboard-focusable horizontal scroller containing full status/metric/run text, with no truncation or word wrapping. The right control group does not shrink. A named container query hides Reconnect/Info/Settings text below 1000 CSS pixels; icons keep explicit accessible names and tooltips. Panel controls also have explicit names. Test the compiled layout at actual widths manually; jsdom does not implement container-query layout.

## Regression coverage

`react-content-root.test.tsx` counts root creation while exercising content mount/update/dispose, inherited Context and preserved drafts. Host tests cover backdrop-free windows, edge resizing, max bounds, keyboard close, and native lifecycle/abort ordering. Inspector tests cover same-window retargeting, persistent controls, cancellation, projection size and full-dump prohibition. Menu tests exercise browser/native documentation dispatch without launching a browser. Status tests check complete run text and independently accessible controls. Native Rust tests/builds never invoke the OS opener.
