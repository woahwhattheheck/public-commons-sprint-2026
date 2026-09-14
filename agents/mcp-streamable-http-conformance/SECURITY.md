# Security model

This probe is designed for protocol validation, not application behavior testing.

- It never invokes `tools/call` and therefore never intentionally triggers a discovered MCP tool.
- It never follows redirects. This prevents bearer headers from crossing to a different location through redirect handling.
- Endpoint URLs containing userinfo credentials are rejected.
- Bearer tokens enter the CLI only through an explicitly named environment variable and are scrubbed from reports, including malicious server error text that echoes the credential.
- Authenticated probes are HTTPS-only: if an `Authorization` header is configured, a plain-HTTP endpoint is rejected before the first network request. Unauthenticated HTTP remains available for local development and conformance fixtures.
- JSON-RPC request responses must declare one of the protocol-permitted response media types: `application/json` or `text/event-stream`.
- JSON response bodies are byte-bounded and every request has a hard timeout.
- Invalid `Origin` is exercised on initialize, established POST, GET (including servers whose ordinary GET path is `405`), and session DELETE when deletion is enabled.
- If a hostile-Origin DELETE is accepted instead of rejected with `403`, the probe records a hard failure and suppresses its legitimate DELETE to avoid compounding ambiguous session state.
- Session deletion affects only the session created by this probe; use `--no-delete` if that behavior is undesirable.

Do not point the probe at endpoints you are not authorized to test. Although the request set is intentionally non-destructive, it still creates protocol traffic and may appear in service logs.
