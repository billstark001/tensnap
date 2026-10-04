# @tensnap/protocol

TenSnap's renderer/simulator contract: Zod schemas, inferred TypeScript types, JSON/MessagePack codecs, and conformance traces.

- [SPECIFICATION.md](./SPECIFICATION.md) contains the cross-message lifecycle, transaction, ordering, and failure rules that cannot be expressed locally in code.
- `src/*.ts` contains the payload schemas and their field-level documentation.
- `dist/protocol-types.md` is the generated schema/type reference.
- [Root conformance suite](../../conformance/README.md) contains canonical wire traces, executable binding probes, and the cross-binding evidence matrix.
- `src/codec.ts` owns strict encoding, runtime validation, and the only legacy compatibility boundary.

Renderer persistence, project sources, snapshots, view layout, and painting are not wire protocol. Those contracts live in `@tensnap/core` and host packages.

Generate schema-derived type documentation with:

```bash
pnpm --dir packages/protocol export:protocol
```

The generated schema descriptions use unwrapped Markdown paragraphs; the TypeScript code blocks retain their source formatting. The output lives in the ignored `dist/` build directory.
