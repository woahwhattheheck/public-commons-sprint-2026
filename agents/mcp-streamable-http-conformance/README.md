# MCP Streamable HTTP Conformance Kit

A side-effect-free conformance and security probe for **MCP Streamable HTTP at the explicitly supported protocol revision 2025-11-25**. It is intended for self-hosted MCP builders, including Alexa+ projects, who need reproducible evidence that the transport handshake is correct without invoking application tools.

This is deliberately *not* a 2026-07-28 modern-era checker. MCP 2026-07-28 removed the `initialize` handshake and session model; a server that reports a modern-era revision to this probe fails closed with a lifecycle-era diagnostic instead of being judged by obsolete handshake semantics.

The Amazon Build, Ship, Shape Open Source mini-challenge explicitly rewards meaningful feature/test/integration contributions rather than README-only changes. This kit was built in-window as a reusable public contribution alongside a primary Alexa+ project.

## What it checks

- a conformant `initialize` request pinned to supported revision `2025-11-25`, exact version agreement, required `InitializeResult` fields (`capabilities`, `serverInfo`), a configurable policy minimum, and an explicit supported-version table currently containing only `2025-11-25`;
- both legal request-response modes: `application/json` and SSE-framed `text/event-stream`, with request responses rejected if they declare neither permitted media type;
- `notifications/initialized` lifecycle semantics;
- `ping`, advertised `tools/list`, and advertised `resources/list` discovery;
- optional Alexa-style `--require-tools` gate without falsely failing generic MCP servers that do not advertise tools;
- canonical JSON-RPC `-32601` for an unknown request method;
- invalid `Origin` rejection for DNS-rebinding defense on initialize, established POST, GET (including ordinary-GET `405` servers), and session DELETE when enabled;
- Streamable HTTP `GET` contract (`text/event-stream` or `405`);
- optional session issuance requirement, missing-session guidance, wrong-version rejection, and client session termination;
- optional latency budget whose measured timings are diagnostic only and excluded from the semantic evidence hash;
- bounded bodies, request timeouts, no redirects, URL credential rejection, HTTPS-only bearer transport, and bearer-secret redaction.

**It never invokes `tools/call`.** The probe does not purchase, send, book, mutate providers, or exercise application tools.

## Requirements

Node.js 20+; zero runtime dependencies.

## Run

```bash
cd mcp-streamable-http-conformance
npm test
node src/cli.mjs http://127.0.0.1:3000/mcp --require-session
```

Unauthenticated plain HTTP is supported for local development/conformance fixtures. If bearer credentials are configured, the endpoint must be HTTPS and a plain-HTTP target is rejected before the first network request.

Alexa+/tool-server profile:

```bash
node src/cli.mjs https://mcp.example.com/mcp \
  --min-version 2025-11-25 \
  --require-session \
  --require-tools \
  --max-rtt-ms 500
```

Bearer-protected endpoint:

```bash
export MCP_PROBE_TOKEN='...'
node src/cli.mjs https://mcp.example.com/mcp --bearer-env MCP_PROBE_TOKEN
```

Useful transport bounds:

```bash
node src/cli.mjs https://mcp.example.com/mcp \
  --max-bytes 262144 \
  --timeout-ms 3000
```

Exit codes: `0` = no hard conformance failures, `2` = report contains hard failures, `1` = CLI/configuration error before a report can be produced.

## Library API

```js
import { probeMcpEndpoint } from './src/index.mjs';

const report = await probeMcpEndpoint({
  endpoint: 'https://mcp.example.com/mcp',
  minimumProtocolVersion: '2025-11-25',
  requireSession: true,
  requireTools: true,
  maxRttMs: 500,
});
```

`report.evidenceSha256` hashes semantic evidence, not `capturedAt` or measured timing values. Reports include the timing array separately for diagnostics.

## Safety and limitations

Read [SECURITY.md](./SECURITY.md). The probe validates the **explicitly supported 2025-11-25 handshake-era transport** only. It does not prove application correctness, OAuth-provider configuration, public internet reachability, Alexa account registration, cloud deployment, end-to-end Alexa device behavior, or modern-era MCP 2026-07-28 conformance. RTT measurements are from the machine running the probe and should not be presented as Alexa production latency.

A hostile-Origin DELETE is sent only when session termination is enabled. If a non-conforming server accepts that hostile request, the probe fails closed and does not send its ordinary DELETE afterward, because the session may already have been mutated.

## Standards / sources

- MCP 2025-11-25 lifecycle: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- MCP 2025-11-25 Streamable HTTP transport: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP protocol-version eras: https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions
- Amazon Build, Ship, Shape rules: https://amazonappdev2026.devpost.com/rules

## License

MIT, under the repository root license.
