# Hearthline-compatible profile

A self-hosted Alexa+ MCP endpoint that implements MCP 2025-11-25 can be checked without executing any of its tools:

```bash
node src/cli.mjs https://example.invalid/mcp \
  --min-version 2025-11-25 \
  --require-session \
  --max-rtt-ms 500
```

For a bearer-protected endpoint, keep the credential outside shell history and reports:

```bash
export MCP_PROBE_TOKEN='...'
node src/cli.mjs https://mcp.example.com/mcp --bearer-env MCP_PROBE_TOKEN
```

The tool deliberately does **not** invoke `tools/call`. Discovery is read-only; the only state it creates is its own MCP transport session, which it asks the server to terminate with `DELETE` when supported.
