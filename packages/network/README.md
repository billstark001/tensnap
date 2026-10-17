# @tensnap/network

Shared local networking policy for TenSnap, version 0.3.0. Independent of the wire protocol, simulator bindings, and renderer state. No runtime dependencies.

The browser-safe root exports `IPFamily`, `parseIPFamily`, `validateIPFamily`, `urlHostname`, `listenerUrl`, and `browserWebSocketUrl`. Node-only helpers live in `@tensnap/network/node`: `listenIPServers`, `closeIPServers`, `unavailableIPFamily`, `normalizeWebSocketData`, `webSocketByteLength`, `waitForWebSocketOpen`, and `closeWebSocket`. Browser bundles must use the root entry.

```ts
import { browserWebSocketUrl } from '@tensnap/network';
import { listenIPServers, closeIPServers } from '@tensnap/network/node';
import { createServer } from 'node:http';

browserWebSocketUrl('ws://localhost:8765/path', 'ipv6'); // ws://[::1]:8765/path
const servers = await listenIPServers(createServer, {
  host: 'localhost',
  port: 0,
  ip_family: 'auto',
});
// Each server has an actual address(), using the same ephemeral port.
await closeIPServers(servers);
```

Listener helpers bind separate IPv4/IPv6-only sockets, deduplicate DNS addresses, preserve host scope, roll back partial failures, and never hide port conflicts. Auto only tolerates unsupported local/default address families. Forced policies reject conflicting literals and unavailable families. See the complete [networking guide](../../docs/user-guide/networking.md).

`normalizeWebSocketData(data, isBinary)` decodes text Buffer/byte views without a preliminary copy, concatenates fragments before UTF-8 decoding (including split multibyte characters), and preserves contiguous binary views and their offsets without copying. Fragmented binary input is concatenated once. Inputs are read-only during normalization; returned binary views can share their input memory.

`webSocketByteLength(data)` counts UTF-8 string bytes, contiguous buffers/views, ArrayBuffers and fragments without joining them. `listenerUrl(address, protocol)` formats an actual IP listener as a reachable URL, mapping wildcard addresses to loopback and bracketing IPv6.

`waitForWebSocketOpen(socket, { signal, timeoutMs, label })` rejects early closure, errors, cancellation or timeout (30 seconds by default), removing its listeners on completion. It does not own the socket: callers close it on failure. `closeWebSocket(socket, { timeoutMs, code, reason })` gracefully closes an open socket, terminates a pending handshake, and terminates a stalled close after five seconds by default. Concurrent callers each wait for their own close completion. Error guards stay installed through asynchronous handshake termination; a nonconforming adapter that never emits `close` is released after termination and one event-loop turn. A throwing `terminate()` rejects after listener/timer cleanup. Both use a structural Node socket interface; `ws` is only a development dependency for tests and benchmarks. Browser EventTarget sockets and protocol/renderer state remain in their existing layers.

Transport callers import these helpers directly from network. Old JS/CLI normalizer exports and compatibility aliases are removed.

Development commands:

```bash
pnpm --filter @tensnap/network lint
pnpm --filter @tensnap/network format
pnpm --filter @tensnap/network test
pnpm bench:network
pnpm --filter @tensnap/network build
```

Root workspace lint, format, test and build discover this package through `packages/*`; CI also checks it explicitly. `bench:network` measures the current implementation only: normalization and byte counting for exact 1 KiB/64 KiB text, binary, fragmented and subview input (64 frames per timed batch), plus listener listen/close and 1 KiB WebSocket echo RTT for IPv4, IPv6 and auto. Lifecycle fixtures use HTTP/WebSocket transport only, with no simulator model or renderer dependency. It is a network benchmark, not model or renderer performance evidence. Avoid enforcing timing thresholds in CI.

The package releases independently using `pnpm release:network <version>` and `network-v<version>` or the manual JS publish workflow. Publish it before dependent packages. A first npm publish needs the same maintainer setup described in the [release guide](../../docs/maintainer-guide/versioning.md).
