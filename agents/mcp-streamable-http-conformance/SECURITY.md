# Security model

This probe is designed for protocol validation, not application behavior testing.

- It never invokes `tools/call` and therefore never intentionally triggers a discovered MCP tool.
- It never follows redirects. This prevents bearer headers from crossing to a different location through redirect handling.
- Endpoint URLs containing userinfo credentials are rejected.
- Bearer tokens enter the CLI only through an explicitly named environment variable, are refused for non-HTTPS endpoints before network I/O, and are scrubbed from reports, including malicious server error text that echoes the credential.
- JSON response bodies are byte-bounded and every request has a hard timeout.
- Invalid-Origin checks target the same endpoint only and cover initialization plus established POST and GET traffic; DELETE is also covered when session termination is enabled.
- Session deletion affects only the session created by this probe; use `--no-delete` if that behavior is undesirable, noting that it also skips hostile-Origin DELETE coverage.

Do not point the probe at endpoints you are not authorized to test. Although the request set is intentionally non-destructive, it still creates protocol traffic and may appear in service logs.
