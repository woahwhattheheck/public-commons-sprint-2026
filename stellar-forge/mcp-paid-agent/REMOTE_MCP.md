# Remote paid MCP tools

The original SF32 buyer can search a seller's registered tool feed, inspect its
schema, prepare an exact invocation, obtain independent operator approval, and
execute a native x402 MCP payment. It keeps the existing quote IDs, private
SQLite history, cancellation and restart behavior.

The official MCP SDK handles initialization, protocol versions, sessions,
Streamable HTTP and SSE. SF32 owns the quote and paid dispatch. The original
SF103 adapter and official x402 Stellar SDK create the payment envelope.

## Install in the existing source checkout

Use Node 22.13+ or 24 and install these pinned dependencies at the **checkout
root**, where both the MCP component and original Stellar components can resolve
them. A release distributor can include the same dependencies at its package root.

```sh
npm install --no-save --package-lock=false \
  @modelcontextprotocol/sdk@1.32.1 \
  @x402/core@2.28.0 @x402/stellar@2.28.0 \
  @x402/mcp@2.28.0 @x402/extensions@2.28.0
```

The HTTP-only broker and native SF43 workspace do not load the remote client SDK.
The local `package.json` records this component's dependency versions; its source
still imports the original sibling Stellar modules from the complete checkout.

## Endpoint and payment resource

These are separate identities in native x402 MCP:

| Field | Meaning | Example |
| --- | --- | --- |
| `requestUrl` / `invocation.endpoint` | Actual HTTP endpoint contacted by the official MCP client | `https://merchant.example/mcp` |
| `invocation.toolName` | Exact advertised MCP tool | `read_record` |
| `invocation.arguments` | Explicit JSON arguments, saved before approval | `{"recordId":"order-17"}` |
| `invocation.paymentResourceUrl` | Original resource URI in the payment challenge | `mcp://tool/read_record` |

The default payment URI is the official wrapper's `mcp://tool/<toolName>` form.
The seller must configure that resource when wrapping its handler. A different
seller URI or a missing transport declaration can be supplied as a trusted
operator override for one exact endpoint and tool:

```js
export const remoteMcpPolicies = [{
  endpoint: 'https://merchant.example/mcp',
  toolName: 'read_record',
  transport: 'streamable-http',
  paymentResourceUrl: 'mcp://tool/read_record',
}];
```

Supported transport values are `streamable-http` and `sse`; no automatic fallback
replays a tool. These overrides participate in the existing operator scope hash.
Changing them invalidates pending quotes from the old configuration. Previously
saved HTTP workspaces with no overrides retain their original scope hash.

## Discover, review and call

Use the same [HTTP or stdio client entrypoints](STDIO.md) as other SF32 tools.
`BAZAAR_DISCOVERY_URL` identifies the existing discovery service or the
[paid seller's registered-tools feed](PAID_TOOLS.md).

1. Call `bazaar_search` with a query. MCP rows include the tool name, endpoint,
   prices and whether their origin is allowed by the operator.
2. Call `bazaar_describe` with the returned handle. Read the original
   `bazaar.info.input.inputSchema`, examples and complete payment alternatives.
3. Call `bazaar_preview` with explicit `input.arguments`:

   ```json
   {
     "handle": "HANDLE_FROM_SEARCH",
     "acceptIndex": 0,
     "input": { "arguments": { "recordId": "order-17" } }
   }
   ```

4. Review the returned endpoint, tool, arguments, resource URI and price. Preview
   contacts no seller and creates no payment.
5. Call `bazaar_execute_approved` with the quote ID. The trusted operator callback
   receives the complete invocation and full selected payment terms.

Arguments are canonical JSON objects, limited to 64 KiB and 32 nesting levels.
Their original bytes and SHA-256 are retained with the quote. Required values and
defaults remain the caller's explicit input. The remote `tools/list` schema must
match the advertised schema before a tool call is made; the seller validates
argument values through its registered tool handler.

Execution opens one initialized connection and sends the actual unsigned
`tools/call`. A successful free result completes the quote without signing. An
ordinary tool error becomes `PROBE_REJECTED`. For a payment-required result, the
broker prefers `structuredContent`, with the first text content item as fallback,
and matches the original resource plus the **complete** selected payment option,
including timeout and `extra` fields.

After signing, the broker persists `signedRequestDispatched` before issuing one
paid `tools/call` with the original envelope in `params._meta["x402/payment"]`.
It reads settlement metadata from `result._meta["x402/payment-response"]`.
The resource URI is preserved throughout; no payment HTTP header translation is
involved. The SDK client has no automatic payment or OAuth retry wrapper.

## Connect the native Stellar operator

`native-mcp-operator.mjs` composes the existing SF103 signing engine. A trusted
operator module exports its `approve`, `signPayment` and `close` functions. This
example uses the local controlling terminal for approval; an existing business
approval and spend-reservation service can supply `approveQuote` instead.

Create this module in the operator's private configuration directory and replace
the two import prefixes with the absolute checkout path:

```js
import {loadNativeSdk} from '/absolute/checkout/stellar/scf-starforge-20261009/sf103-native-buyer-signer/adapter.mjs';
import {createNativeMcpOperator, createTerminalMcpApproval} from '/absolute/checkout/stellar-forge/mcp-paid-agent/native-mcp-operator.mjs';

const sdk = await loadNativeSdk();
const network = 'stellar:testnet';
const signer = sdk.createEd25519Signer(process.env.STELLAR_PAYER_SECRET, network);
const operator = await createNativeMcpOperator({
  payer: signer.address, signer, sdk, rpcUrl: process.env.STELLAR_RPC_URL,
  limits: {
    network,
    asset: process.env.STELLAR_PAYMENT_ASSET,
    payTo: process.env.STELLAR_MERCHANT_ACCOUNT,
    maxAtomic: '50000',
    maxTimeoutSeconds: 60,
  },
  approveQuote: createTerminalMcpApproval(),
});
export const {approve, signPayment, close} = operator;
```

Configure the existing workspace launcher:

```sh
export BAZAAR_DISCOVERY_URL=https://merchant.example
export PAID_RESOURCE_ORIGINS=https://merchant.example
export MCP_STATE_DIR=/absolute/private/mcp-state
export MCP_OPERATOR_MODULE=/absolute/private/operator.mjs
export MCP_PROVIDER_TIMEOUT_MS=120000
node stellar-forge/mcp-paid-agent/stdio.mjs
```

The HTTP launcher also needs `MCP_ACCESS_TOKEN`; stdio generates its private
transport token automatically. Host credentials and RPC configuration stay in
the operator process. The model supplies tool arguments and quote IDs.

The native adapter enforces explicit network, asset, recipient, per-payment atomic
cap, timeout, sponsored authorization and one signing attempt for that approval.
It binds the approved endpoint and arguments separately from the original
`mcp://` resource. Its terminal shows the complete invocation before accepting
`APPROVE <quoteId>`. Application operators can attach their existing aggregate
budget and reservation logic to `approveQuote`; the per-payment cap and quote
database are not an aggregate spending ledger.

An embedding application can pass its existing trusted `fetchImpl`. The workspace
launcher also accepts a `fetchImpl` export from its operator module. That fetch
must honor the supplied abort signal and `redirect: 'manual'`; the remote client
rejects redirects and any endpoint change outside the approved origin. Streamable
HTTP stays on the exact endpoint; SSE permits its negotiated same-origin message
endpoint. Each transport response is limited to 2 MiB. Status includes a 64 KiB
preview with an explicit truncation flag. A durable workspace also retains the
complete native `CallToolResult` JSON in its [result inbox](RESULTS.md).

## Status, cancellation and recovery

`bazaar_status` returns the saved invocation, state and receipt metadata.
`bazaar_history` and the existing [private reports](DURABILITY.md) include remote
quotes. Persisted result bodies are represented by their byte count and SHA-256,
as in the original HTTP quote store. Complete native result files and recovery
manifests are stored privately under `MCP_STATE_DIR/results`. Use
`bazaar_results`, `bazaar_read_result`, or `result-cli.mjs` to consume and export
the original data. Payment payloads and live session credentials are not written
to the quote store or its recovery manifest.

Cancelling before signed dispatch aborts the remote request and closes its
connection. A cancellation, transport error or shutdown after signed dispatch
retains `INDETERMINATE` so the original payment can be reconciled. Re-executing any
consumed quote returns its saved state without sending another tool call. Restart
recovers interrupted quotes through the original durable-workspace state machine.
When a complete result file and manifest survived an interrupted SQLite update,
`bazaar_recover_result` restores their recorded server completion locally. The
terminal importer can also attach an original result retained by an older host.

`CONFIRMED_BY_SERVER` requires a successful MCP result plus a successful settlement
claim for the quoted Stellar network with a valid transaction hash. It describes
the server's claim. Independent chain reconciliation remains the authority for
financial finalization, as with existing HTTP purchases.

## Primary contracts

- [x402 native MCP transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/mcp.md)
- [Official x402 MCP package](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mcp)
- [MCP SDK v1 client](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x/src/client)
- [Original SF103 signer](../../stellar/scf-starforge-20261009/sf103-native-buyer-signer/adapter.mjs)
