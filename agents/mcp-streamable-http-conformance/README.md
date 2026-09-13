# MCP Streamable HTTP Conformance Kit

A side-effect-free conformance and security probe for **MCP 2025-11-25+ Streamable HTTP** servers. It is intended for self-hosted MCP builders, including Alexa+ projects, who need reproducible evidence that the transport handshake is correct without invoking application tools.

The Amazon Build, Ship, Shape Open Source mini-challenge explicitly rewards meaningful feature/test/integration contributions rather than README-only changes. This kit was built in-window as a reusable public contribution alongside a primary Alexa+ project.

## What it checks

- `initialize` version negotiation and a configurable minimum protocol revision;
- `notifications/initialized` lifecycle semantics;
- `ping`, `tools/list`, and advertised `resources/list` discovery;
- canonical JSON-RPC `-32601` for an unknown request method;
- invalid `Origin` rejection for DNS-rebinding defense;
- Streamable HTTP `GET` contract (`text/event-stream` or `405`);
- optional session issuance requirement, missing-session guidance, wrong-version rejection, and client session termination;
- optional latency budget;
- bounded bodies, request timeouts, no redirects, URL credential rejection, and bearer-secret redaction.

**It never invokes `tools/call`.** The probe does not purchase, send, book, mutate providers, or exercise application tools.

## Requirements

Node.js 20+; zero runtime dependencies.

## Run

```bash
cd mcp-streamable-http-conformance
npm test
node src/cli.mjs http://127.0.0.1:3000/mcp --require-session
```

Bearer-protected endpoint:

```bash
export MCP_PROBE_TOKEN='...'
node src/cli.mjs https://mcp.example.com/mcp --bearer-env MCP_PROBE_TOKEN
```

Useful gates:

```bash
node src/cli.mjs https://mcp.example.com/mcp \
  --min-version 2025-11-25 \
  --max-rtt-ms 500 \
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
  maxRttMs: 500,
});
```

`report.evidenceSha256` hashes the semantic evidence object, not volatile capture timestamps or measured timings. Reports include timings separately for diagnostics.

## Safety and limitations

Read [SECURITY.md](./SECURITY.md). The probe validates transport behavior only. It does not prove application correctness, OAuth-provider configuration, public internet reachability, Alexa account registration, cloud deployment, or end-to-end Alexa device behavior. RTT measurements are from the machine running the probe and should not be presented as Alexa production latency.

## Standards / sources

- MCP 2025-11-25 lifecycle: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- MCP 2025-11-25 Streamable HTTP transport: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- Amazon Build, Ship, Shape rules: https://amazonappdev2026.devpost.com/rules

## License

MIT, under the repository root license.
