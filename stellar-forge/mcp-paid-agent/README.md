# Stellar Bazaar MCP buyer and paid tools

This component connects an MCP client to Bazaar discovery, an operator-approved
purchase, native Stellar signing, and the returned merchant content. It also
provides a paid MCP server for existing merchant functions. MIT; Node 22.13+.

The buyer keeps the original SF32 quote lifecycle and SQLite history. HTTP
purchases and remote MCP purchases use that same workspace. The SF43 tool also
connects the original SF88 native HTTP buyer, spending ledger, inbox and returned
files through the [native workspace](NATIVE_WORKSPACE.md).

## Choose the integration

| Task | Entry point |
| --- | --- |
| Connect a desktop, editor or agent host | [Stdio launcher and client configuration](STDIO.md) |
| Run a private HTTP MCP workspace | `serve.mjs`, with the configuration below |
| Browse, review quotes and use complete results in a local browser | [Buyer operator console](CONSOLE.md), on the same server at `/console/` |
| Discover and purchase remote MCP tools | [Remote MCP buyer and native operator](REMOTE_MCP.md) |
| Expose an existing merchant function as a paid MCP tool | [Native paid tool server](PAID_TOOLS.md) |
| Use the existing SF88 native HTTP purchase and returned-file workflow | [Native workspace](NATIVE_WORKSPACE.md) |
| Preserve and inspect quote history across restart | [Durable workspace](DURABILITY.md) |
| Read, export and recover complete remote MCP results | [Result inbox and native Node API](RESULTS.md) |
| Sell existing SQLite, PostgreSQL, DuckDB and ClickHouse query results over MCP | [Original data providers](DATA_TOOLS.md) |

The local buyer's HTTP endpoint implements the MCP 2025-11-25 JSON response
transport. The stdio launcher connects the same tools to a host subprocess.
Remote seller connections use the official MCP SDK, including Streamable HTTP
sessions and SSE response framing. Install the pinned shared dependencies as
described in [REMOTE_MCP.md](REMOTE_MCP.md) before using native remote tools.

## Tools and purchase flow

| Tool | Result |
| --- | --- |
| `bazaar_search` | Search the configured discovery service and obtain temporary resource handles. |
| `bazaar_describe` | Inspect the original declaration, input schema, examples, output and complete payment alternatives. |
| `bazaar_preview` | Bind a selected alternative to the exact HTTP request or remote MCP invocation; create a quote. |
| `bazaar_execute_approved` | Request approval from the trusted operator, then execute that quote once if approved. |
| `bazaar_status` | Read the original quote's current state and retained result. |
| `bazaar_history` | Page through this workspace's original and recovered quotes. |
| `bazaar_cancel` | Cancel an unexecuted quote, or retain an uncertain signed outcome for reconciliation. |
| `bazaar_results` | Page through complete saved native MCP results and their original receipts. |
| `bazaar_read_result` | Read verified bytes from one saved result, with explicit range continuation. |
| `bazaar_recover_result` | Restore an original local completion from its result file and manifest. |
| `sf43_discover_review_and_pay` | Use the separately configured original SF43/SF88 native buyer workspace. |

Search performs a discovery GET. Describe and preview use the cached result;
neither calls a merchant or signs a payment. Execute requires both an independent
host-owned approval callback and a signer. Model-supplied approval fields do not
authorize a purchase. The default launcher can search, inspect and preview; it
has no connected payer.

Once approved, the broker sends an unsigned request, reads the original payment
challenge, and sends at most one signed request. A successful free response ends
the operation without signing. HTTP resources use canonical x402 v2 headers.
Remote MCP tools use native `tools/call` arguments, `x402/payment` request metadata
and `x402/payment-response` result metadata.

A returned settlement claim becomes `CONFIRMED_BY_SERVER` only when it includes
the quoted network and a transaction hash. Independent chain reconciliation is a
separate operation. An uncertain signed request becomes `INDETERMINATE` and is not
automatically resubmitted. Repeating execute on an already attempted quote returns
its retained state.

With `MCP_STATE_DIR`, complete remote MCP results are saved beside the quote
database. The inbox, terminal and Node API can consume their structured content,
text, embedded resources and original receipt after the buyer restarts. The
64 KiB status preview remains compact; the result file retains the full native
`CallToolResult` up to the transport's 2 MiB limit. See [RESULTS.md](RESULTS.md).

## Start the local HTTP workspace

```sh
export BAZAAR_DISCOVERY_URL=https://your-discovery-service.example
export MCP_ACCESS_TOKEN='A_LONG_RANDOM_OPERATOR_TOKEN'
export PAID_RESOURCE_ORIGINS=https://your-approved-merchant.example
export MCP_STATE_DIR=/private/operator/quotes
node stellar-forge/mcp-paid-agent/serve.mjs
```

The listener binds to `127.0.0.1:3210`; `MCP_PORT` selects another port. Open its
`/console/` address and enter the same operator access token for the browser
workflow. The static shell contains no quote data or token. Every MCP data
request requires the bearer token; the server allows its exact loopback origin.
Configure `MCP_CLIENT_ORIGINS` for other clients that send an `Origin` header.
Paid endpoints must match `PAID_RESOURCE_ORIGINS`,
and all discovery and HTTP merchant redirects are rejected.

For paid execution, set an absolute `MCP_OPERATOR_MODULE` path and a durable
`MCP_STATE_DIR`. That trusted JavaScript module exports `approve`, `signPayment`
and optionally `close`, `fetchImpl`, `remoteMcpPolicies` and `agentCommerce`.
Its code and credentials belong to the operator; paths and credentials never
arrive through MCP tool arguments. Set `MCP_PROVIDER_TIMEOUT_MS=120000` for a
native purchase that needs signing, verification and settlement time. The allowed
range is 1–300000 milliseconds; the default is 8000.

The [remote operator guide](REMOTE_MCP.md) includes a complete native signing
configuration and a terminal approval option. Its native adapter enforces the
configured network, asset, recipient, per-payment cap and timeout. An embedding
operator supplies aggregate budget reservations when required; the adapter does
not silently substitute a new ledger for the existing SF36 HTTP workflow.

## Construct the exact request

Call `bazaar_describe` with a handle from search. Its `bazaar` field preserves the
original extension, including schema, input examples and output declaration.
`accepts` retains complete eligible alternatives in the order used by preview's
`acceptIndex`. `source` records the discovery URL, observation time and original
resource representation. A native URL string is also represented as a resource
object for the existing broker interface.

### Remote MCP arguments

```json
{
  "handle": "HANDLE_FROM_SEARCH",
  "input": {"arguments": {"recordId": "native-demo-record"}}
}
```

The seller advertises its tool name, input schema and `streamable-http` or `sse`
transport. Preview retains canonical typed JSON arguments, byte count, argument
hash and schema hash. After connecting, the broker compares the actual
`tools/list` schema with that declaration before making a tool call.

The endpoint and payment resource are separate identities: a server may listen
at `https://merchant.example/mcp` while its payment resource is
`mcp://tool/get_merchant_record`. An exact host-configured policy can select the
transport and resource URI. The approved challenge and native payload preserve
the complete selected terms and original resource; there is no transport fallback
or automatic signed-call retry. Completed Streamable HTTP sessions are terminated
before local client closure.

### HTTP query arguments

```json
{
  "handle": "HANDLE_FROM_SEARCH",
  "input": {"query": {"symbol": "XLM"}}
}
```

The direct SF32 HTTP path accepts GET/HEAD and advertised query keys, with values
as strings. A discovered POST/PUT/PATCH operation requires the original body-aware
native buyer path described in [NATIVE_WORKSPACE.md](NATIVE_WORKSPACE.md).

Preview checks the direct required query names at
`bazaar.schema.properties.input.properties.queryParams.required` against the final
URL. Existing fixed URL parameters count. Examples and defaults are not copied
into a request, and an empty string counts as present. This presence check does
not implement the seller's complete JSON Schema validation. Describe exposes
these names through `preview.input.requiredKeys`; malformed direct declarations
return `requiredKeysError`, and preview rejects them with
`INPUT_SCHEMA_UNSUPPORTED`.

For HTTP, `resource` remains the catalog URL and `requestUrl` is the exact URL
with chosen query values. Both the payment challenge and signer payload must
bind to that concrete URL. The discovery base's path prefix is retained when
appending `discovery/search`.

## Lifecycle and recovery

Handles expire after their original observation lifetime or cache eviction;
search again after `RESOURCE_STALE`. Returned metadata is detached from the
private cached record. A quote becomes `APPROVAL_PENDING` before awaiting its
approval callback, so simultaneous execute calls cannot independently sign it.
Cancellation and expiry are rechecked after approval. Denial leaves the quote
available for an explicitly initiated later review.

The optional SQLite store checkpoints before side effects and before signed
dispatch. It preserves MCP invocation identity as well as existing HTTP quotes.
Restart inspection never dispatches a payment. Interrupted unsigned work and
uncertain signed work retain distinct states. A change to the configured discovery
service, allowed origins or remote MCP policy invalidates unexecuted old quotes.
Use one local writer for a workspace and await its close operation on shutdown.

The original SF33 recovery contract adds actionable error metadata without
changing x402 wire messages. Preserve the original quote and transaction when
reconciling an uncertain outcome. The [durability guide](DURABILITY.md) describes
history inspection and retained response metadata.

## Primary protocol references

- [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
- [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [x402 HTTP transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md)
- [x402 MCP transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/mcp.md)
- [Bazaar extension](https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md)

No GitHub Actions execution is required by this component.
