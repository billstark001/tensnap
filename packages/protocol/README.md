# @tensnap/protocol

TenSnap's renderer/simulator contract: Zod schemas, inferred TypeScript types, JSON/MessagePack codecs, and conformance traces.

- [SPECIFICATION.md](./SPECIFICATION.md) contains the cross-message lifecycle, transaction, ordering, and failure rules that cannot be expressed locally in code.
- `src/*.ts` contains the payload schemas and their field-level documentation.
- `dist/protocol-types.md` is the generated schema/type reference.
- [Root conformance suite](../../conformance/README.md) contains canonical wire traces, executable binding probes, and the cross-binding evidence matrix.
- `src/codec.ts` owns strict encoding, runtime validation, and the only legacy compatibility boundary.

Renderer persistence, project sources, snapshots, view layout, and painting are not wire protocol. Those contracts live in `@tensnap/core` and host packages.

## Session codecs

Retain a `ProtocolCodec` (or `createProtocolCodec()` result) per session rather than calling the one-shot `encodeProtocolMessage()` / `decodeProtocolMessage()` helpers on every frame. A session codec retains legacy transaction correlation and lazily reuses MessagePack encoder/decoder state. Separate directional validation policies can use separate codecs. JSON-only sessions do not allocate MessagePack scratch buffers.

MessagePack output owns its bytes: subsequent encodes cannot overwrite an earlier frame, so it can be queued for asynchronous sending. Decoded binary fields may view the input frame; do not mutate or recycle that input while its decoded values are in use. Oversized frames (over 1 MiB of encoded output or input backing storage) and failed MessagePack operations discard the relevant cached instance instead of retaining its buffers for the session's lifetime. This is a scratch-retention policy, not a message-size limit.

Wire records contain portable `ProtocolValue` data plus dedicated binary fields. Class instances, custom serialization hooks, and other non-portable objects must be projected before reaching the codec; disabling validation does not make them supported wire values. JSON's serializer already omits undefined object properties and writes undefined array entries as null. The wire MessagePack encoder uses `ignoreUndefined: true` and nil array entries for the same result, avoiding a redundant recursive clone before encoding. Optional undefined schema fields therefore behave identically in both formats. The legacy decoder still removes optional undefined fields introduced by alias conversion.

The generic `encodeMessagePack()` / `decodeMessagePack()` persistence helpers retain the upstream default semantics, including encoding undefined map values as nil; they do not apply wire-specific optional-field normalization.

Run focused, validation-off codec benchmarks with:

```bash
pnpm --dir packages/protocol bench:codec
# Select just one fixture size/encoding:
pnpm --dir packages/protocol bench:codec -t 'msgpack, 10000 nested items'
```

These measurements time encoding and decoding separately, without model projection, sockets, semantic oracles, or rendering. They are not substitutes for end-to-end evaluation.

Generate schema-derived type documentation with:

```bash
pnpm --dir packages/protocol export:protocol
```

The generated schema descriptions use unwrapped Markdown paragraphs; the TypeScript code blocks retain their source formatting. The output lives in the ignored `dist/` build directory.
