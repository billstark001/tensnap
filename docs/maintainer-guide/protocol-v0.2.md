# TenSnap Protocol v0.2

The canonical protocol v0.2 documentation now lives with the package that owns
the protocol source:

- [`packages/protocol/README.md`](../../packages/protocol/README.md)
- [`packages/protocol/src/types.ts`](../../packages/protocol/src/types.ts)
- [`packages/protocol/src/schemas.ts`](../../packages/protocol/src/schemas.ts)
- [`packages/protocol/src/codec.ts`](../../packages/protocol/src/codec.ts)

`@tensnap/protocol` is the source of truth for renderer/simulator payload
shapes, runtime schemas, and JSON/MessagePack codecs. Higher-level packages
import protocol definitions directly from `@tensnap/protocol`; `@tensnap/core`
is not a compatibility alias for protocol.
