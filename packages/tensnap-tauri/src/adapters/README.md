# Tauri adapters

The desktop shell supplies three native adapters to the shared web UI:

- `TauriSettingsPersistence` stores UI settings in `settings.json` in Tauri's
  app-data directory via `@tauri-apps/plugin-store`.
- `TauriFilePicker` imports `open` and `save` from
  `@tauri-apps/plugin-dialog`.
- `TauriFileSystemAdapter` uses `@tauri-apps/plugin-fs` for scoped read, write,
  list, metadata, mkdir, and delete operations.

## File access model

The application has no custom Rust command that accepts a renderer-provided
path. A path selected with the native open/save dialog is dynamically added to
the fs scope, then the filesystem adapter can operate only within that scope.
The official Rust `persisted-scope` plugin records that scope in the app-data
directory and restores it after restart, so an already-authorized project can
be reopened without granting blanket filesystem access.

`src-tauri/capabilities/main.json` is the single capability declaration. Keep
it minimal: dialog `open`/`save`, the fs operations used by the adapter, store
`load`/`get`/`set`, and the existing window/event APIs. Do not add a wildcard
filesystem scope or enable `withGlobalTauri`.

## Registration

`TauriApp.tsx` configures persistence before hydrating shared settings, then
registers the filesystem adapter and picker:

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

When adding an adapter API, prefer the official Tauri plugin API. If a custom
Rust command is unavoidable, it must not accept arbitrary paths; enforce a
canonical, symlink-safe, session-scoped allowlist and update the capability
documentation and tests in the same change.
