# @tensnap/protocol

TenSnap renderer/simulator v0.3 contract: strict Zod schemas, inferred types,
JSON/MessagePack codecs, and conformance traces.

- [V0.3-DRAFT.md](./V0.3-DRAFT.md) is the finalized protocol specification.
- [BEHAVIOR.md](./BEHAVIOR.md) contains only cross-message rules; field
  semantics live in the Zod schema comments.
- [conformance/](./conformance/) contains canonical parseable wire traces.
- `src/codec.ts` owns the only legacy boundary. Normal v0.3 code accepts and
  emits only canonical snake_case messages.

Generate schema-derived type documentation with:

```bash
pnpm --dir packages/protocol export:protocol
```
