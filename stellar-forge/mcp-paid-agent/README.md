# SF-32 · Stellar Bazaar MCP paid-tool bridge

**Status:** Original Node 22 source, not deployed, no paid transactions or SCF submission. MIT.

This module exposes a real MCP 2025-11-25 JSON-RPC tools endpoint over single-response
Streamable HTTP (no SSE, server-push, remote MCP tool execution, multi-round-trip or
protocol-level sessions). It connects to the existing Bazaar `/discovery/search`
handler rather than duplicating SF-23 ranking or the SF-26 marketplace binding.

Tool names: `bazaar_search`, `bazaar_preview`, `bazaar_execute_approved`,
`bazaar_status`, `bazaar_cancel`.

- Search: source-backed discovery GET and version-independent ephemeral resource handles.
- Preview: exact method, query inputs and selected payment terms, with origin and
  supported-transport checks, **no external merchant request**.
- Execute: requires an independent operator `approve()` callback AND externally supplied
  `signPayment()` callback. The model cannot authorize itself. The default server has
  neither, so calling execute cannot produce payment.
- For approved GET/HEAD resources, probe the actual endpoint, inspect canonical
  x402 v2 `PAYMENT-REQUIRED` base64 challenge, strictly match the quoted acceptance,
  ask the signer for a v2 payload, then retry once with `PAYMENT-SIGNATURE`.
  Parse `PAYMENT-RESPONSE` and return bounded response content and exact status.
- Signed requests whose outcome is unknown become `INDETERMINATE`; the tool will not
  automatically resubmit them. Cancelled prepayment quotes never call merchants.
- Only resource origins explicitly allowlisted by the operator are callable. Any
  `Origin` header on the MCP endpoint must be allowlisted, and MCP requires an operator
  bearer token. Bind server to loopback unless separately secured and authorized.

## Run a read-only local server

```
export BAZAAR_DISCOVERY_URL=https://YOUR-OWN-DISCOVERY-SERVICE.example
export MCP_ACCESS_TOKEN='A_LONG_RANDOM_OPERATOR_TOKEN'
export PAID_RESOURCE_ORIGINS=https://a-preapproved-resource.example
export MCP_CLIENT_ORIGINS=http://127.0.0.1:3000
node stellar-forge/mcp-paid-agent/serve.mjs
```

The standalone server intentionally cannot pay. To enable authorized paid calls,
embed `McpPaidToolBroker` in an operator-controlled application and supply both
`approve(quote)` and `signPayment({resource,accepted,paymentRequired})`, using a
canonical Stellar x402 signer and real out-of-band authorization. Protect keys
outside MCP and bound spend using SF-36. Do not send private keys in tool calls.

## Focused check

`node --test stellar-forge/mcp-paid-agent/agent-server.test.mjs`

Local source verification used first-party PR451/SF22 Bazaar catalog blob
`66beed7c3a4b617ab90680ec5fe8318e934e74f7` (byte-exact git hash-object)
and the original `createDiscoveryServer` route. Six focused checks passed:
MCP initialize/tools/list/tools/call, auth/Origin, actual local discovery
HTTP, hard base-unit payment filters, operator approval, canonical 402 header and signed-retry serialization,
conditional provider receipt, bad-quote rejection, cancellation and ambiguous
transaction replay suppression. All payment signer values/receipts in these
checks are explicit loopback fixtures, NOT genuine Soroban signatures/payments.

## Scope and interoperability

Supports HTTP GET/HEAD resources advertised by Bazaar. Remote MCP-discovered
seller tools are visible but execution is intentionally gated until SF-26
transport/schema binding and an authenticated, independently approved remote
client adapter exist. Unsafe POST/PUT/PATCH probing is not attempted: a probe
might execute a side effect before payment is even required.

Discovery and paid endpoints need operational authentication, DNS/rebinding
policy, API limits and independently verified seller/capability identity before
production deployment. In-memory quote state is per process; production workers
need shared idempotency state/transaction reconciliation and at-rest audit records.

Canonical source contracts, retrieved October 10, 2026:
- https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md
- https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md

No repository Actions/workflow execution is required by this code.
