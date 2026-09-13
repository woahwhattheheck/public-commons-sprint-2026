# Hearthline-compatible profile

A self-hosted Alexa+ MCP endpoint using the **2025-11-25 handshake-era protocol** can be checked without executing any of its tools:

```bash
node src/cli.mjs https://example.invalid/mcp \
  --min-version 2025-11-25 \
  --require-session \
  --require-tools \
  --max-rtt-ms 500
```

For a bearer-protected endpoint, keep the credential outside shell history and reports:

```bash
export MCP_PROBE_TOKEN='...'
node src/cli.mjs https://mcp.example.com/mcp --bearer-env MCP_PROBE_TOKEN
```

The tool deliberately does **not** invoke `tools/call`. Discovery is read-only; the only state it creates is its own MCP transport session, which it asks the server to terminate with `DELETE` when supported.

MCP 2026-07-28 is a different lifecycle era (no `initialize` handshake or MCP session header). This profile intentionally fails closed if a server tries to negotiate that modern revision through the legacy handshake.
