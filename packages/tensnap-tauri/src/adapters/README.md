# Tauri adapters

The desktop shell supplies three native adapters to the shared web UI:

- `TauriSettingsPersistence` stores UI settings in `settings.json` in Tauri's app-data directory via `@tauri-apps/plugin-store`.
- `TauriFilePicker` imports `open` and `save` from `@tauri-apps/plugin-dialog`.
- `TauriFileSystemAdapter` uses `@tauri-apps/plugin-fs` for scoped read, write, list, metadata, mkdir, and delete operations.

## File access model

The application has no custom Rust command that accepts a renderer-provided path. A path selected with the native open/save dialog is dynamically added to the fs scope, then the filesystem adapter can operate only within that scope. The official Rust `persisted-scope` plugin records that scope in the app-data directory and restores it after restart, so an already-authorized project can be reopened without granting blanket filesystem access.

For project Save As, the shared toolbar supplies a JSON or MessagePack filter and the proposed final filename to `save(...)`. The adapter writes exactly the path returned by that dialog. Do not append an extension after the dialog or create its parent directory speculatively: Tauri scopes the path the user actually selected, not a later rewritten sibling path.

`src-tauri/capabilities/main.json` grants the main Webview dialog `open`/`save`, the fs operations used by the adapter, store `load`/`get`/`set`/`keys`/`delete`, and the required window/event APIs. `src-tauri/capabilities/auxiliary.json` applies only to `dialog-*` tools and grants event listen/unlisten/emit-to and title updates. Keep these grants separate and minimal; do not add a wildcard filesystem scope or enable `withGlobalTauri`.

## Native menu localization

`useTauriMenuEvents` observes the shared settings locale and calls `set_menu_locale_handler` whenever it changes, including after settings hydration. The Rust menu builder owns the native labels because operating-system menus are outside the renderer's Lingui runtime. Its `en`, `zh`, and `ja` label tables must stay complete and the menu unit test must cover every supported renderer locale when adding a new language.

## External documentation and auxiliary windows

`common.openDocumentation` invokes the fixed `open_documentation_handler`; the Rust Opener plugin opens the GitHub documentation in the system browser. The command accepts no renderer-provided URL/path. Automatic JS link interception is disabled and no broad opener capability is granted. Rendered and native menus share this adapter; auxiliary menu commands proxy to the original owner.

Each auxiliary Webview uses its bootstrap React root for all business content. Pass its render callback through `startNativeContent`; do not create another root on `#root`. See the [workbench infrastructure guide](../../../../docs/maintainer-guide/workbench-infrastructure.md) for window registration, menu ownership, projections and RPC cancellation.

## Registration

Only the main `TauriApp.tsx` bootstrap configures persistence and hydrates settings, then registers the filesystem adapter and picker:

```ts
configureSettingsPersistence(new TauriSettingsPersistence());
await hydrateSettings();

await registerFileSystemAdapter({
  name: 'tauri',
  description: 'Native file system access via Tauri',
  supported: true,
  create: () => new TauriFileSystemAdapter(),
});
await registerFileSystemPicker(new TauriFilePicker());
```

## Development checks

```bash
pnpm --filter @tensnap/tauri typecheck
cd packages/tensnap-tauri/src-tauri && cargo check
```

When adding an adapter API, prefer the official Tauri plugin API. If a custom Rust command is unavoidable, it must not accept arbitrary paths; enforce a canonical, symlink-safe, session-scoped allowlist and update the capability documentation and tests in the same change.

Read-only auxiliary tools do not initialize these adapters, mirror writable stores, or receive file/settings capabilities. Their only authority is the validated data/command protocol described in the [workbench guide](../../../../docs/maintainer-guide/workbench-infrastructure.md).
