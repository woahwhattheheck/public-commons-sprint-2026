# MCP Streamable HTTP Conformance Kit

A side-effect-free conformance and security probe for **MCP Streamable HTTP at the explicitly supported protocol revision 2025-11-25**. It is intended for self-hosted MCP builders, including Alexa+ projects, who need reproducible evidence that the transport handshake is correct without invoking application tools.

This is deliberately *not* a 2026-07-28 modern-era checker. MCP 2026-07-28 removed the `initialize` handshake and session model; a server that reports a modern-era revision to this probe fails closed with a lifecycle-era diagnostic instead of being judged by obsolete handshake semantics.

The Amazon Build, Ship, Shape Open Source mini-challenge explicitly rewards meaningful feature/test/integration contributions rather than README-only changes. This kit was built in-window as a reusable public contribution alongside a primary Alexa+ project.

## What it checks

- a conformant `initialize` request pinned to supported revision `2025-11-25`, exact version agreement, required `InitializeResult` fields (`capabilities`, `serverInfo`), a configurable policy minimum, and an explicit supported-version table currently containing only `2025-11-25`;
- both legal request-response modes: `application/json` and SSE-framed `text/event-stream`, rejecting successful JSON-RPC request responses with any other or missing media type;
- `notifications/initialized` lifecycle semantics;
- `ping`, advertised `tools/list`, and advertised `resources/list` discovery;
- optional Alexa-style `--require-tools` gate without falsely failing generic MCP servers that do not advertise tools;
- canonical JSON-RPC `-32601` for an unknown request method;
- invalid `Origin` rejection for DNS-rebinding defense on fresh initialization and established POST/GET traffic, plus DELETE when session termination is enabled;
- Streamable HTTP `GET` contract (`text/event-stream` or `405`);
- optional session issuance requirement, missing-session guidance, wrong-version rejection, and client session termination;
- optional latency budget whose measured timings are diagnostic only and excluded from the semantic evidence hash;
- bounded bodies, request timeouts, no redirects, URL credential rejection, HTTPS-only bearer transmission, and bearer-secret redaction.

**It never invokes `tools/call`.** The probe does not purchase, send, book, mutate providers, or exercise application tools.

## Requirements

Node.js 20+; zero runtime dependencies.

## Run

```bash
cd mcp-streamable-http-conformance
npm test
node src/cli.mjs http://127.0.0.1:3000/mcp --require-session
```

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

Bearer credentials are refused for every `http:` endpoint before any request is sent. Unauthenticated HTTP remains available for local development and transport fixtures.

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

Read [SECURITY.md](./SECURITY.md). The probe validates the **explicitly supported 2025-11-25 handshake-era transport** only. `--no-delete` skips both hostile-Origin DELETE coverage and legitimate session termination. It does not prove application correctness, OAuth-provider configuration, public internet reachability, Alexa account registration, cloud deployment, end-to-end Alexa device behavior, or modern-era MCP 2026-07-28 conformance. RTT measurements are from the machine running the probe and should not be presented as Alexa production latency.

## Standards / sources

- MCP 2025-11-25 lifecycle: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- MCP 2025-11-25 Streamable HTTP transport: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP protocol-version eras: https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions
- Amazon Build, Ship, Shape rules: https://amazonappdev2026.devpost.com/rules

## License

MIT, under the repository root license.
