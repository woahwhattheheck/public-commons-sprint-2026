# SF-32 · Stellar Bazaar MCP paid-tool bridge

**Status:** Original Node 22 source, not deployed, no paid transactions or SCF submission. MIT.

This module exposes a real MCP 2025-11-25 JSON-RPC tools endpoint over single-response
Streamable HTTP (no SSE, server-push, remote MCP tool execution, multi-round-trip or
protocol-level sessions). It connects to the existing Bazaar `/discovery/search`
handler rather than duplicating SF-23 ranking or the SF-26 marketplace binding.

Tool names: `bazaar_search`, `bazaar_describe`, `bazaar_preview`, `bazaar_execute_approved`,
`bazaar_status`, `bazaar_history`, `bazaar_cancel`.

The existing broker supports a [durable operator workspace](DURABILITY.md):
saved quote history, checkpoints before side effects, restart recovery,
an operator-module launcher and private JSON/CSV/HTML inspection. It uses Node's
built-in SQLite on Node 22.13+ or 24; memory-only embedding remains available.

- Search: source-backed discovery GET and version-independent ephemeral resource handles.
- Describe: original input examples/schema, output declaration and complete eligible
  payment alternatives from the cached handle, with no network request.
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

The configuration above cannot pay. To connect authorized paid calls, use the
durable launcher's `MCP_OPERATOR_MODULE` described in [DURABILITY.md](DURABILITY.md),
or embed `McpPaidToolBroker` in an operator-controlled application and supply both
`approve(quote)` and `signPayment({resource,accepted,paymentRequired})`, using a
canonical Stellar x402 signer and real out-of-band authorization. Protect keys
outside MCP and bound spend using SF-36. Do not send private keys in tool calls.

## Discover the required inputs before previewing

Use `bazaar_search` to find a resource, then `bazaar_describe` with that result's
`handle`. For example, an MCP client sends this ordinary `tools/call` request:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "bazaar_describe",
    "arguments": { "handle": "HANDLE_FROM_BAZAAR_SEARCH" }
  }
}
```

The returned structured content contains:

- `resource`: the resource object used by the existing bridge. Native provider
  URL strings are represented as `{ "url": "..." }`; their original string or
  object remains available under `source.resource`.
- `bazaar`: the complete original Bazaar extension, including `info.input`
  examples, `schema`, `info.output` and any other advertised extension fields.
- `accepts`: complete payment alternatives in the same filtered order as the
  search result. `acceptIndex` for preview indexes this array. Timeout and
  `extra` fields remain attached to their original alternative.
- `source`: the exact discovery request URL, observation time and original
  resource representation. `expiresAt` is the existing handle-expiry timestamp
  in Unix milliseconds.
- `preview`: the bridge's existing input/transport limits and configured
  `allowedOrigin` status, separate from the seller's declaration.

Read `bazaar.schema` for required inputs and inspect `bazaar.info.input` for the
seller's examples. Pass selected query values as **strings** under
`bazaar_preview`'s `input.query`, even when the advertised example is numeric.
Only advertised query keys are accepted. The existing bridge still supports
HTTP GET/HEAD previews; describing an MCP tool, POST operation, additional input
container or unapproved origin does not enable its execution.

Before creating a quote, preview checks the direct required query names at
`bazaar.schema.properties.input.properties.queryParams.required`. Each name
must be present in the **final request URL**: an existing fixed URL parameter
counts, or supply an explicit string under `input.query`. Missing names return
`INPUT_REQUIRED` with the names to supply. Neither examples nor schema defaults
are copied into the request. An empty string is present; this check does not
enforce types, `minLength`, refs or conditional schema requirements.

Describe exposes the same names under `preview.input.requiredKeys`. A malformed
direct declaration (including duplicate names or requirements beyond the existing
30-key/100-code-unit limits) returns `requiredKeys: null` with
`requiredKeysError`; preview rejects it with `INPUT_SCHEMA_UNSUPPORTED`. The
full original metadata remains inspectable and other search results remain
usable. An absent direct declaration gives an empty list, not assurance that a
request meets every seller constraint. Required names absent from the advertised
query key list can only be satisfied by an existing fixed URL parameter; the
existing allowed-query-key restriction remains in force.

Descriptions use the original observation and the same handle lifetime as
preview. They do not refresh the provider, create a quote or inspect a merchant.
An expired or evicted handle returns `RESOURCE_STALE`: search again to obtain a
new handle. Returned metadata is a detached snapshot; changing it cannot change
the bridge's cached resource or terms.

The advertised schema helps construct the request; describing it is not schema
validation, seller authentication, payment approval or settlement verification.
The original origin, payment-term, approval, signing and recovery boundaries remain in place.

Preview and status keep `resource` as the original catalog URL for source
traceability. `requestUrl` is the concrete normalized URL after the chosen query
values; review it before approval. Both the payment challenge and signer payload
must bind to that exact `requestUrl`, including its query, as the existing SF30
seller does. Describing metadata does not construct or approve a request.

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
production deployment. Default in-memory quote state is per process. The optional
durable workspace preserves the same quote identities across restarts and records
dispatch before the signed request. It does not replace the original budget ledger
or independent transaction reconciliation. Distributed workers still need a shared
operation/approval coordinator; this workspace has one local writer.

Canonical source contracts, retrieved October 10, 2026:
- https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md
- https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md

No repository Actions/workflow execution is required by this code.

## SF-33 agent recovery envelopes

The MCP bridge now imports the released SF-33 error contract from
`stellar/scf-starforge-20261009/sf33-failure-contract/contract.mjs`.
Tool failures keep the existing `code` and `reason` fields and add a sanitized
`recovery` envelope with machine-readable next steps. `RESOURCE_STALE` and
`CHALLENGE_MISMATCH` require fresh terms and authorization; unknown errors stop.
An `INDETERMINATE` quote status includes a `settle`-stage recovery envelope
requiring ledger/provider reconciliation. A returned transaction hash is never
considered confirmed by this module; no auto payment retry or signature occurs.
The SF-33 source is maintained independently, and this bridge never alters
canonical x402 `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `/verify` or `/settle` wire bodies.

Focused boundary check: `node --test stellar-forge/mcp-paid-agent/recovery-overlay.test.mjs`
(no paid network requests, local fake transport only).

## Outbound redirect origin fence

All three native HTTP fetch edges (configured Bazaar discovery GET, operator-allowed
merchant GET/HEAD quote probe, and signed PAYMENT-SIGNATURE execution) explicitly
set Node Fetch RequestInit `redirect: 'error'`. A seller-controlled 3xx cannot
re-route the request to a different origin after the original operator allowlist
check, nor forward a signed custom payment header. A redirect in the post-signing
phase leaves the quote INDETERMINATE and requires externally verified settlement
before considering another authorization. This intentionally also rejects same-
origin redirects; merchants/catalog operators must publish their final canonical
endpoints. Custom `fetchImpl` injections MUST honor the supplied redirect setting.

Focused non-payment local network regression:
`node --test stellar-forge/mcp-paid-agent/redirect-fence.test.mjs`
uses actual loopback 302/307 responses and asserts no unauthorized receiver hit.

## Asynchronous approval single-flight

A quote becomes `APPROVAL_PENDING` synchronously **before** awaiting the
independent operator callback. Another `bazaar_execute_approved` call for the
same quote observes that state, rather than separately requesting approval or
signing. Cancelling during the pending approval immediately marks the quote
`CANCELLED`; when the callback eventually resolves, no merchant fetch or
signature occurs. Expiry is rechecked after approval. Denial or an approval
callback error restores `PREVIEWED` for an explicitly initiated new attempt,
without issuing a payment request. This closes the concurrent-MCP-call race in
the previously separate sequential replay guard.

Focused offline original broker check:
`node --test stellar-forge/mcp-paid-agent/approval-singleflight.test.mjs`.
It exercises one 402+signed retry, a simultaneous same-quote call, cancellation
during a delayed approval, and denial. Responses are in-memory Node Fetch
fixtures, not real Stellar payments.

## Discovery path-prefix preservation

`McpPaidToolBroker.search()` appends `discovery/search` to the operator-configured `discoveryUrl` path. A base of `https://facilitator.example/x402` or `https://facilitator.example/x402/` searches `https://facilitator.example/x402/discovery/search`. A root base still resolves to `/discovery/search`. Leading-slash absolute construction is not used, so a configured prefix is never discarded. Existing query filters, origin guards, redirect policy, and constructor rejection of credentials/query/fragment remain unchanged.

Focused regression: `node --test stellar-forge/mcp-paid-agent/discovery-prefix.test.mjs`

