# Native paid MCP tools

`paid-tool-server.mjs` turns existing merchant functions into paid remote MCP tools.
It uses the official MCP SDK for initialization, sessions, JSON-RPC and Streamable
HTTP; `@x402/mcp` owns the payment wrapper. The original native facilitator in
`stellar/scf-starforge-20261009/native-facilitator` owns Stellar verification,
settlement, fee limits, RPC readiness and signer ownership.

The included `get_merchant_record` tool reads an existing merchant record. Its
arguments identify the one configured record; callers cannot select a filesystem
path, payment network, amount, signer or RPC endpoint. It returns the actual record
ID, label and revision, including Unicode content. It does not modify that record.

[Existing prepared data products](DATA_TOOLS.md) use the same server through
`data-tools.mjs` and the `data-serve.mjs` launcher. SQLite, PostgreSQL, DuckDB and
ClickHouse retain their original query engine, schemas, admission and limits.

## The three addresses

These are distinct values in one workflow:

| Value | Example | Purpose |
| --- | --- | --- |
| Seller discovery feed | `http://127.0.0.1:4100/discovery/search` | Lists the server's actual registered paid tools and complete terms. |
| MCP endpoint | `http://127.0.0.1:4100/mcp` | SDK initialization, `tools/list`, `tools/call`, session handling and result transport. |
| Payment resource | `mcp://tool/get_merchant_record` | The exact resource in the native x402 challenge and payment payload. |

The discovery row's `resource.url` is the MCP endpoint. Its official Bazaar
extension declares `type: "mcp"`, the tool name, `transport: "streamable-http"`
and the same `inputSchema` returned by `tools/list`. The payment challenge retains
the explicit `mcp://tool/<name>` URI. There is no HTTP 402 translation.

## Install and compose

Use the component's pinned dependencies: MCP SDK `1.32.1` and x402 packages
`2.28.0`, on Node `22.13.0` or newer. Install at the **complete checkout root**
(or the cumulative distribution's package root), so the original native
facilitator and SF103 sibling modules resolve the same dependencies:

```sh
npm install --no-save --package-lock=false \
  @modelcontextprotocol/sdk@1.32.1 \
  @x402/core@2.28.0 @x402/stellar@2.28.0 \
  @x402/mcp@2.28.0 @x402/extensions@2.28.0
```

The component's `package.json` records the pins; installing exclusively in
`mcp-paid-agent/node_modules` does not supply its sibling modules. The
[buyer installation guide](REMOTE_MCP.md#install-in-the-existing-source-checkout)
uses the same root installation.

The native facilitator must already have an operator-selected network, RPC URL,
funded signer and permitted merchant terms. This adapter does not create accounts
or fund them.

The following operator module reads public configuration from a local file and
gets the existing facilitator secret through the original `secretEnv` binding.
Keep that operator module and its configuration outside the source checkout.

```js
import {readFile} from 'node:fs/promises';
import {
  startNativePaidToolServer,
  createMerchantRecordTool,
} from '/absolute/source/stellar-forge/mcp-paid-agent/paid-tool-server.mjs';

const facilitatorConfig = JSON.parse(
  await readFile('/private/operator/facilitator.json', 'utf8'),
);
// Explicit operator-selected base units; this must fit the facilitator policy.
const accepts = [{
  scheme: 'exact',
  network: facilitatorConfig.network,
  asset: facilitatorConfig.payments.assets[0],
  payTo: facilitatorConfig.payments.recipients[0],
  amount: '50000',
  maxTimeoutSeconds: 60,
  extra: {areFeesSponsored: true, paymentFlow: 'authorization'},
}];

const seller = await startNativePaidToolServer({
  facilitatorConfig,
  environment: process.env,
  host: '127.0.0.1',
  port: 4100,
  tools: [createMerchantRecordTool({
    recordPath: '/private/merchant/merchant-record.json',
    recordId: 'native-demo-record',
    accepts,
  })],
});

console.log({endpoint: seller.endpoint, discoveryUrl: seller.discoveryUrl});
process.once('SIGTERM', async () => { await seller.close(); });
process.once('SIGINT', async () => { await seller.close(); });
```

The merchant file has this shape; the returned content is read from the file at
execution time:

```json
{"recordId":"native-demo-record","label":"Current merchant record","revision":1}
```

The record reader bounds the opened file to 64 KiB and returns only those three
fields. It uses one open file descriptor for the read and checks the configured
record ID. Unknown arguments are rejected before payment verification or handler
execution. A record read failure returns an ordinary tool error through the native
payment wrapper's failure path.

## Server API and operating behavior

`startNativePaidToolServer(options)` returns:

| Member | Behavior |
| --- | --- |
| `endpoint` | Actual MCP URL, including an allocated port when `port: 0`. |
| `discoveryUrl` | Actual `/discovery/search` URL. |
| `tools()` | Fresh copies of registered MCP descriptors. |
| `catalogRows()` | Fresh copies of the same rows served by discovery. |
| `status()` | Counters, active calls, sessions and original facilitator status. |
| `probeReadiness(options)` | Original native read-only RPC probe. |
| `close()` | Stop admission, finish accepted tool/payment work, close sessions, and drain the original facilitator while retaining its signer lease. |

Each tool descriptor supplies `name`, `description`, an object `inputSchema`, one
or more complete `accepts`, and `handler(arguments, {toolName, signal})`. Optional
`example` must pass the same schema validator; optional `annotations` are passed
through to MCP discovery. Optional `admit(arguments, {toolName, signal})` runs
before payment verification inside the reserved active-call slot. It returns
`true` or an ordinary native `CallToolResult` with `isError: true`; rejection never
enters the payment wrapper. The handler returns a native MCP `CallToolResult`, for
example `content` plus `structuredContent`. Its result is checked and bounded
before the payment wrapper performs successful after-handler settlement.

The default validator is the official SDK's `AjvJsonSchemaValidator`, with no
argument coercion or default insertion. A trusted operator may supply another
SDK-compatible `jsonSchemaValidator` for a specific JSON Schema dialect. Schema
and terms are copied at startup, so subsequent changes to caller-owned objects do
not alter the advertised tool or an accepted call.

Default limits are 32 sessions, 15 minutes of session inactivity, one active paid
wrapper, 512 KiB request bodies and 1 MiB handler results. The configurable handler maximum is 1,984 KiB
(2,031,616 bytes), leaving 64 KiB below the buyer's complete 2 MiB transport limit
for the original payment receipt and protocol framing. Oversized handler results
fail before successful settlement. Active tool calls are
excluded from idle session expiry. Invalid arguments, unknown tools, unsupported
task execution and exhausted capacity are rejected before the handler. Session
initialization, protocol versions, GET streams and DELETE semantics come from the
official SDK. Responses use the SDK's SSE transport by default;
`enableJsonResponse: true` selects its supported JSON response mode.

The listener defaults to loopback. To bind externally, configure both `host` and
an explicit HTTPS `publicEndpoint` ending in the selected MCP path. Terminate TLS
at the operator's existing ingress. Requests must carry the configured public or
local authority in `Host`; a supplied `Origin` must exactly match the advertised
origin. The SDK also applies its Host/Origin protection. Credential-bearing URLs,
query strings and fragments are rejected for the advertised MCP endpoint.

`GET /health` returns read-only status. `GET /discovery/search` and
`GET /discovery/resources` list only this server's actual registered rows. Search
supports a simple name/description substring, `network`, `scheme`, `asset`,
`maxAmount`, `limit` and a returned numeric cursor. These filters select rows and
retain each selected row's complete original `accepts`. The feed does not write an
index, rank outside resources or call a separate discovery service.

## Payment and buyer integration

An unpaid `tools/call` returns the official `PaymentRequired` object in
`structuredContent`, with `isError: true` and its JSON text in `content`. It does
not invoke the merchant function. The buyer preserves that challenge, its full
selected payment option and the exact approved tool arguments.

The paid call places the original payment object in
`params._meta["x402/payment"]`. The official wrapper verifies it through the
native facilitator, runs the handler in the selected authorization flow and
settles through that same facilitator. The result contains the original native
receipt in `_meta["x402/payment-response"]`. No signed request is retried by this
adapter and no receipt is manufactured.

Use the original durable buyer in `agent-server.mjs`, `remote-mcp.mjs` and
`native-mcp-operator.mjs` for discovery, approval, signing and execution. Its
configured origin/transport policy must cover the actual endpoint. An initial
read-only SDK inspection can use:

```js
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';

const client = new Client({name: 'merchant-inspection', version: '1.0.0'});
const transport = new StreamableHTTPClientTransport(new URL(seller.endpoint), {
  requestInit: {redirect: 'manual'},
});
await client.connect(transport);
const listed = await client.listTools();
const challenge = await client.request({
  method: 'tools/call',
  params: {name: 'get_merchant_record', arguments: {recordId: 'native-demo-record'}},
}, CallToolResultSchema);
await transport.terminateSession();
await client.close();
```

Use `client.request` with the native result schema for an unpaid probe: the
challenge's structured content differs from a tool's successful application
output. Let the durable buyer control the eventual paid call rather than adding
an automatic payment or retry loop around this inspection.

## Shutdown and retained work

Configure `operations.requireReady` in the original facilitator when each
verification and settlement must pass its cached native network/ledger readiness
probe. Configure one private `operations.ownershipDirectory` shared by cooperating
facilitators that use the same signer on a host. The original Linux signer lease
prevents those cooperating processes from owning the account simultaneously.

Await `seller.close()`. It stops new admission and waits for accepted wrappers,
then closes SDK sessions, drains the original facilitator and waits for native
work to release signer ownership. Do not replace that sequence with an immediate
process exit. A client disconnect or cancellation cannot prove that an accepted
payment was cancelled; the original buyer's retained operation state and native
receipt/ledger reconciliation remain the source of that outcome.

## Primary implementation references

- [Official x402 MCP transport specification](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/mcp.md)
- [Official paid-tool wrapper](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mcp/src/server/paymentWrapper.ts)
- [Official Bazaar MCP declarations](https://github.com/x402-foundation/x402/blob/main/typescript/packages/extensions/src/bazaar/mcp/types.ts)
- [Official MCP SDK v1 Streamable HTTP server](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/server/streamableHttp.ts)
