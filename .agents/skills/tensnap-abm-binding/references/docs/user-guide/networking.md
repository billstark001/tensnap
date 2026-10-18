# IPv4 and IPv6 connections

All simulator listeners and renderer WebSocket connections accept the same local `ip_family` policy: `auto` (default), `ipv4`, or `ipv6`. This setting is not sent in protocol messages and does not change model identity or project file versions.

| Policy | Simulator and CLI control listeners | Renderer connection |
| --- | --- | --- |
| `auto` | Listen on both available families for `localhost` or an omitted host, using one port | Let the browser or Node choose an address |
| `ipv4` | Open IPv4 listeners only | Connect using IPv4 only |
| `ipv6` | Open IPv6 listeners only | Connect using IPv6 only |

An explicit address still limits the binding scope: `127.0.0.1` is IPv4 loopback, `::1` is IPv6 loopback, `0.0.0.0` is IPv4 wildcard, and `::` is IPv6 wildcard. To request both wildcard families, omit the host (JS/Go) or use an empty host (Python/Julia). `ip_family` never expands an explicit literal into another family. A conflicting literal and policy is an error.

Python and Julia default to `localhost`; the CLI control API also defaults to `localhost`. The JS simulator's omitted host and Go's `:8765` listen on all interfaces. IPv6 sockets are IPv6-only; auto uses a separate IPv4 socket. If the platform lacks one family, auto can use the remaining family for default/localhost bindings. Port conflicts, permission failures, and explicitly requested unavailable families fail startup. Partial startup rolls back all listeners, so a foreign service on the other family cannot silently split one endpoint between models.

For `port=0`, the first available listener chooses a port and the other listener uses that same port. Local listener creation tries IPv4 first; this determines the primary reported endpoint when both exist. Renderer auto connections retain the underlying library's address selection.

## Simulators

Python:

```python
scenario = SimulationScenario(host="localhost", port=8765, ip_family="ipv6")
# Low-level API: TenSnapServer(host="localhost", port=0, ip_family="auto")
```

`TenSnapServer.port` contains the selected port after startup; `listening_addresses` contains the actual bound socket addresses while running.

Go uses its normal exported-field convention:

```go
server.Run(ctx, server.Options{
    Addr: "localhost:8765",
    IPFamily: server.IPv6, // server.IPAuto (or zero value), server.IPv4, server.IPv6
}, model)
```

For `Addr: "localhost:0"`, `OnListen: func(addresses []net.Addr) { ... }` reports actual addresses after binding. The callback should return promptly.

Julia:

```julia
scenario = Scenario(host = "localhost", port = 8765, ip_family = "ipv6")
run!(scenario)
```

`scenario.port` and `scenario.listening_addresses` expose the actual port and addresses while running.

JavaScript/TypeScript:

```ts
const host = createWebSocketTransportHost({
  sessionFactory,
  serverOptions: { host: 'localhost', port: 0 },
  ip_family: 'auto',
});
await host.ready;
console.log(host.url); // Primary reachable endpoint, derived from the actual listener
console.log(host.urls); // All endpoints, with the same port
await host.close();
```

Always await `ready` before reading an ephemeral endpoint. `ready` rejects startup conflicts. For an externally supplied `server`, `serverOptions.server`, or `noServer` upgrade handler, configure the owning listener's family yourself and leave the host policy at `auto`; the transport cannot enforce socket options on an external server.

The JS example runner accepts `--ip-family auto|ipv4|ipv6` and `--port 0`.

## CLI renderer

```bash
pnpm cli:agent runtime up --context local --simulator-url 'ws://localhost:8765' --ip-family ipv6
```

The flag applies to both the Node WebSocket client and its local HTTP control listener, including background daemons. Node can force a family for domain names through DNS/socket options; it never falls back to the other family when forced. The control API's `POST /v1/runtime/connect` accepts `{ "simulatorUrl": "ws://localhost:8765", "ip_family": "ipv6" }`; omitted policy retains the runtime's current setting. Control listener policy is selected when starting the daemon.

IPv6 literals require brackets in URLs: `ws://[::1]:8765` and `http://[::1]:12345`. Generated simulator and control URLs include them automatically.

## Browser and desktop frontend

Open **Settings → System Settings → IP family** to choose the browser/desktop renderer's policy. It uses the same setting-row layout and selector as the other system options and is persisted as the application setting `ip_family`, defaulting to auto. It applies to all projects' next connections and reconnects, including automatic retries. Existing open sockets remain connected until they reconnect. Project files keep their original URLs and do not contain this machine-local preference.

Browser WebSocket APIs do not expose a DNS/address-family option. Forced policies work with matching literal IP addresses. For local unencrypted `ws://localhost`, TenSnap rewrites the connection to `127.0.0.1` or `[::1]`, retaining the URL path and query. Other domain names with a forced policy produce an explicit validation error; use auto or enter a matching literal IP. This also applies to the Tauri frontend's browser WebSocket transport.

`wss://localhost` cannot be rewritten safely while preserving its TLS hostname. Use auto, or supply a literal IP with a certificate valid for that IP. TenSnap explains the limitation instead of silently ignoring the selected policy.

## Model mismatch diagnostics

A model mismatch remains an identity error: do not disable identity checks to work around it. JS host URLs now use the actual bound address, avoiding accidental IPv4 connections to another simulator when the intended host listens on IPv6. The benchmark checks `simulator_info.model.id` before sending state sync and reports expected/received identities and the endpoint. If it still fails, check the process owning each family/port and the project's expected model identity.
