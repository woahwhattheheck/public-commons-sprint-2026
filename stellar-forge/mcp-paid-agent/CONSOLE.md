# Buyer operator console

The original local MCP workspace includes a browser console at `/console/`.
It connects discovery, exact quote review, host approval, original quote history
and the complete saved native MCP result through the same authenticated tools.
There is no separate browser purchase backend or result database.

## Open your workspace

Start [the HTTP workspace](README.md#start-the-local-http-workspace) with
`BAZAAR_DISCOVERY_URL`, `MCP_ACCESS_TOKEN` and, for retained quotes and results,
`MCP_STATE_DIR`. The launcher prints both its MCP address and console URL:

```text
http://127.0.0.1:3210/console/
```

Use the printed port if `MCP_PORT` differs or is `0`. Enter the existing operator
access token in the connection form. The token remains in this tab's memory;
reloading or disconnecting requires connecting again. The server adds only its
exact loopback origin to its original MCP client-origin allowlist. Other clients
continue to use `MCP_CLIENT_ORIGINS` and the same bearer authentication.

The installed component must include `operator-console.mjs` and all four files
under `operator-ui/`. The server serves these fixed files; the shell contains no
token, quote, private configuration or returned data. No external script, font
or analytics service is loaded. The console uses the original JSON-response MCP
transport, including initialization and the advertised tools list.

## Discover and review the exact invocation

Search the configured live catalog. Optional network, asset and maximum amount
filters use the original advertised values. Inspect a resource to read its
complete declaration, source observation, input schema and payment alternatives.
The catalog's continuation cursor loads another page without replacing existing
rows.

Choose an original payment alternative and enter the actual tool arguments as
a JSON object. HTTP resources use the declared query object with string values.
The form does not copy examples or defaults into a request. IDs and decimal
values declared as strings remain strings. Integers outside JavaScript's safe
range are rejected before preview instead of being silently rounded; use the
source's declared string representation when available.

**Review exact quote** invokes `bazaar_preview`. Review its original resource,
concrete endpoint, method, tool, canonical arguments, timestamps and full selected
payment terms. Amounts retain the asset's base units. The additive `acceptedTerms`
field in quote status/history exposes the complete retained alternative,
including extra payment-flow terms; `selected` retains its existing compact
shape. Creating a quote calls neither the merchant nor a signer.

## Request host approval and continue the original quote

**Request host approval** sends only the original `quoteId` to
`bazaar_execute_approved`. Payment still requires the independently configured
host's approval callback and signer. The console does not accept a private key,
approve on the host's behalf, supply approval flags or configure an operator
module. Use [the original native operator](REMOTE_MCP.md) for paid execution.

While the host decides, refresh that quote's status or request cancellation.
The original lifecycle decides whether cancellation can stop unsigned work or
must retain a dispatched payment for reconciliation. The execute action is
available only for a `PREVIEWED` quote and cannot dispatch concurrent browser
requests for that quote. If a request loses its response, refresh the same quote
before taking another action. There is no automatic retry or periodic polling.

Quote history supports the original status filter and cursor. Opening a quote
uses `bazaar_status`, including after a workspace restart. Displayed states and
receipts remain the original server values: `CONFIRMED_BY_SERVER` is the native
receipt state, not an independent chain reconciliation. Disconnecting the tab
stops its pending reads; it does not cancel an operation in the server.

## Use the complete saved result

The quote's **Payment transaction** panel shows the original receipt's transaction,
network, payer and failure details directly. **Read transaction outcome** uses
the host's original SF86 read-only adapter and saves the observation on this quote.
It displays a failed transaction, a missing RPC record or an exact matched
transfer with its ledger and endpoint. Download the complete observation from
the same panel. If an older response lost its hash, enter its original transaction
reference; that source remains explicitly labeled. See [payment recovery](PAYMENT_RECOVERY.md)
for operator setup, including a workspace with no signing function.

The native result and the transaction observation remain separately visible.
Refreshing quote status is still a local read. Transaction inspection occurs
only when selected and does not start another payment or purchased tool call.

**Saved results** lists the original `bazaar_results` inbox. Open a result to
read every byte through `bazaar_read_result`; the client follows the explicit
range cursor and verifies the final SHA-256 against the original file identity.
The result remains attached to its original quote, invocation and receipt.

The result has three working views:

| View | Behavior |
| --- | --- |
| Structured data | Select an actual returned array, filter its records and page through 40 rows at a time. Open any record for all its fields. IDs and decimal strings remain unchanged. Complete structured JSON is also available. |
| Content | Read native text and embedded resources, view embedded PNG/JPEG/GIF/WebP images or supported audio, and download embedded bytes. Resource links open only when selected; the console does not fetch them automatically. Every original content item can be expanded. |
| Complete JSON | Inspect the full native `CallToolResult`, including original metadata, content and structured content. **Download complete JSON** saves those exact verified bytes. |

Table cells are previews and the grid shows at most 32 columns. The complete
record, complete structured content and original JSON retain every field.
Collection discovery examines up to eight object levels and 64 arrays; deeper
or additional data remains in those complete views. Complete native results
retain the original transport's 2 MiB limit, independently of the compact status
preview. See [result custody and recovery](RESULTS.md).

For an attempted quote with retained files, **Recover saved files** invokes the
original `bazaar_recover_result`. It can restore a matching local completion and
manifest without contacting a merchant or submitting a payment. An original
missing or mismatched file error is shown directly; history remains available.

## Runtime and installation

`startMcpWorkspace()` returns `consoleUrl` alongside the unchanged MCP `address`,
broker and close function. The console shares that server's startup, workspace
writer and graceful shutdown. Use one writer for a durable workspace, as in the
existing [durability contract](DURABILITY.md).

The neutral interface is served locally with a restrictive content policy and
no persistent browser storage. Native text is rendered as text, never executed
as markup. The console does not add CORS access, arbitrary filesystem routes,
external resource fetching or a new authentication mode. Existing stdio clients
continue to connect through their private subprocess and original transport.
