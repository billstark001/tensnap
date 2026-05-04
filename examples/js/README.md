# TenSnap JavaScript Examples

This workspace package is the new home for runnable JavaScript examples and built-in local simulator manifests.

Initial scope for phase 4:

- define a stable example manifest surface
- move built-in model registrations out of `packages/web-models`
- add worker/session entrypoints per example

The first scaffold intentionally exports an empty manifest so consumers can switch package boundaries before model migration lands.
