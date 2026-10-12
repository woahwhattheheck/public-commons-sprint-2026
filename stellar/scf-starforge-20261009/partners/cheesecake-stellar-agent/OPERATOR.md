# Stellar agent application workshare

This receiving application connects an original merchant request handoff to the maintained native Node buyer and MCP transport. It gives the receiving engineer a complete request list, exact offline review, original execution, saved-operation recovery and verified response consumption. The supplied industrial browser and MCP endpoint use the same application and native intent.

The complete integration source is included. The original runtime is pinned to
`f8db4d8cff51ace62bb7b25655131aaed78bdde8`; its source, dependencies and operating instructions travel in the complete kit.

## Start with the supplied receiving reference

The included `reference/buyer-handoff` is the retained original Gateway Stellar testnet request selection from the installed merchant operation. It contains one transaction request, one ledger-entry request and two explicit event pages. Its original release is `CHALLENGE_ONLY`, and its original merchant origin is `https://merchant.example`. The source responses in `reference/provider-observation` retain the actual selected Gateway observations. The reference operation exercises intake, native review, body preservation, application state, MCP transport and reopening.

Use Node 22 or newer, Python 3.11 or newer, and the original runtime's selected dependencies. Install the exact included archive into a chosen existing application directory:

```sh
npm install --ignore-scripts --offline --omit=optional --no-audit --no-fund \
  /absolute/kit/runtime/tokenjunkielabs-starforge-merchant-0.1.0-source.gf8db4d8cff51.tgz
```

The original package supplies its full source. Select its absolute SF88 path:

```text
/absolute/application/node_modules/@tokenjunkielabs/starforge-merchant/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli
```

Create one private receiving state directory, copy `application.example.json` into your private operating directory and set its actual paths:

```sh
install -d -m 0700 /srv/private/selected-stellar-client/application
```

| Configuration field | Meaning |
| --- | --- |
| `applicationId` | Stable name for this receiving application. |
| `runtimeDirectory` | Absolute directory of the complete original SF88 runtime. |
| `handoffDirectory` | Absolute, private, real directory containing the original `handoff.json`, requests and clients. |
| `stateDirectory` | Existing empty private directory on first open; reuse it for every later operation. |
| `subject` | The explicitly selected receiving operator identity for the standalone CLI/server. |
| `operatorProfile` | Optional absolute path to the receiving operator's existing native profile. It supplies original operator, signer and transport settings. |
| `authorizationModule` | Optional trusted local module exporting the application's current authorization lookup. |

State and received handoff directories use mode `0700`. Paths must be canonical and must identify real directories. Run `realpath` on an existing installed location before selecting it. The native state keeps its original absolute paths through ordinary reopen. For host relocation, use the original workspace recovery instructions and review the receiving installation paths.

### Verify and review

From the kit's `source` directory:

```sh
node cli.mjs verify-source --config /srv/private/selected-stellar-client/application.json
node cli.mjs list --config /srv/private/selected-stellar-client/application.json
node cli.mjs review --config /srv/private/selected-stellar-client/application.json \
  --intent native-transaction-001
node cli.mjs status --config /srv/private/selected-stellar-client/application.json \
  --intent native-transaction-001
```

Review imports the selected public buyer configuration with its exact retained body. The original SF88 buyer validates the request and terms. The application saves a binding between the handoff, native intent, body, native configuration and receiving subject. A repeated review reopens that same operation.

The source list exposes the actual network, release mode, URL, payment alternative, byte count and body text. Atomic-unit ceilings remain decimal strings. Event page 2 is a separate retained request containing the original cursor; select and review it explicitly.

## Browser and MCP operating flow

Launch the loopback server with the same private configuration. Set a protected access token with at least 24 characters in the receiving process environment:

```sh
export STELLAR_APP_ACCESS_TOKEN="$(openssl rand -hex 32)"
node server.mjs --config /srv/private/selected-stellar-client/application.json --port 8767
```

Open the printed local URL. Enter the token in the browser's connection field; it stays in browser memory and the Authorization header. The flow is Requests → Review → Operation → Result. Select a request, inspect its actual terms/body, retain the original review, then use the explicit execute action when the receiving native operator is configured. Status and recovery keep the original intent.

The server uses the original authenticated `createMcpToolHandler` from `stellar-forge/mcp-paid-agent/http-tools.mjs` at `/mcp`. Its native protocol version is `2025-11-25`. The client supplies `Authorization: Bearer …`, `Content-Type: application/json`, `Accept: application/json, text/event-stream`, and the protocol-version header after initialize.

| Tool | Application behavior |
| --- | --- |
| `stellar_requests` | List selected requests and this subject's current original operation state. |
| `stellar_request_review` | Import or reopen one selected request and save the original offline review. |
| `stellar_request_execute` | Recheck current host authorization and invoke the original reviewed attempt, or recover its existing native outcome. |
| `stellar_request_status` | Inspect the same original operation and available result. |
| `stellar_request_recover` | Reopen the original saved outcome. |
| `stellar_request_read` | Verify and read saved JSON, text, base64 or file metadata. |

The selected request's original `intentId` is the tool argument. The host configuration selects source paths, payer profile, merchant and payment terms. Tool calls cannot replace them.

A standard native request looks like:

```json
{
  "jsonrpc": "2.0",
  "id": "review-transaction",
  "method": "tools/call",
  "params": {
    "name": "stellar_request_review",
    "arguments": {"intentId": "native-transaction-001"}
  }
}
```

Use a separate client request ID for response correlation while retaining the same native buyer intent for the purchase.

## Execute and consume an agreed installation

For an accepted client deployment, prepare a new original merchant handoff from the selected endpoint, merchant HTTPS origin, network, payment asset/recipient, actual atomic prices and release. The original installed `chainstack-stellar` installer composes SF30, SF82, SF88 and SF99; its `create`, `request` and `handoff` operations are described in the included runtime's `partners/chainstack-stellar/README.md`.

Select the new handoff in a new receiving application state. The original handoff preserves public request configuration and exact bytes. The receiving host supplies its own operator profile and signer through the existing SF88 setup. Keep the original spending ledger and evidence directory shared according to that operator's configuration.

```sh
node cli.mjs execute --config /srv/private/selected-stellar-client/application.json \
  --intent ORIGINAL_SELECTED_INTENT
node cli.mjs recover --config /srv/private/selected-stellar-client/application.json \
  --intent ORIGINAL_SELECTED_INTENT
node cli.mjs read --config /srv/private/selected-stellar-client/application.json \
  --intent ORIGINAL_SELECTED_INTENT --format json
node cli.mjs export --config /srv/private/selected-stellar-client/application.json \
  --intent ORIGINAL_SELECTED_INTENT --out /srv/private/selected-stellar-client/new-response.json
```

Execution enters original SF88/SF81 approval, the original SF36 budget/ledger, and the receiving operator's native signer and transport. Launch from the operator's controlling terminal when its selected approval method uses that terminal. The application never turns a browser confirmation or model field into a signer approval.

The original native attempt marker controls concurrency and interruption. A later execute on an already attempted intent reopens its outcome; recovery preserves original process, HTTP, native outcome and saved-file states. A verified response can be read or exported once its original native response metadata is available. Export uses the original exclusive destination publication.

## Connect to an existing application

The core module can be embedded in a Node or TypeScript backend without the standalone server. Each tenant/application selects its own private receiving state and handoff. Supply a stable tenant-qualified subject from the existing authenticated request context.

```js
import { openApplication } from './application.mjs';

const purchases = await openApplication({
  applicationId: 'existing-client-stellar-data',
  runtimeDirectory: settings.originalRuntime,
  handoffDirectory: settings.selectedMerchantHandoff,
  stateDirectory: settings.privateApplicationState,
  operatorProfile: settings.originalOperatorProfile,
  authorize: async ({context, action, request}) => {
    return await existingAuthorization.canUsePaidData({
      subject: context.subject,
      action,
      intentId: request?.intentId,
      merchant: request?.url,
      acceptedTerms: request?.acceptedTerms,
    });
  },
});

const context = {subject: authenticatedTenant + ':' + authenticatedSubject};
const review = await purchases.call(context, 'review', selectedOriginalIntent);
const state = await purchases.call(context, 'recover', selectedOriginalIntent);
```

The `existingAuthorization` call is the application's integration seam. Connect it to the actual grant/permission service and revocation source. A trusted `authorizationModule` exports this same `authorize` callback for the standalone receiving host. Authorization is checked on every operation and checked again immediately before native execution. The original financial approval and policy still run independently.

The standalone server has a `contextForRequest` integration point after its transport authentication. The existing product should derive that context from its own authenticated session and keep one configured private application instance per tenant. Identity/custody contracts and agent grants remain the client's source of authority.

For the original LangGraph/LangChain integration, the runtime also exports `BuyerAgent`, compiled graph and standard structured tools under its existing `node/agents` interfaces. These use the same original native operation and can be composed by the receiving application's selected agent framework. Their original optional dependencies and instructions are in `sf88-operator-buyer-cli/node/FRAMEWORKS.md`.

## Recovery and operating ownership

Keep the complete handoff, application directory and original native operator workspace together in the operating backup. The application state stores source selection, subject and native bindings; the original native directories store reviews, attempt and response. Reopen using the same configuration and subject.

A changed handoff or application identity is a new selection and requires a separate application state. A changed body/configuration is rejected by the original buyer before execution and during recovery. An interrupted preparation retains its original files for inspection; an in-progress call owns its original operation. Close the owning process cleanly before transferring write ownership.

The merchant continues through its original SF82 controls: select, run, pause, drain, restart, compare releases and rollback. SF99 provides the maintained host/container deployment and operating recovery. The application connects to those lifecycle controls through the original installation; it stores the exact selected release with each received request.

## Source map

| Responsibility | Original source |
| --- | --- |
| Three Stellar request contracts and provider response preservation | `sf30-seller-sdk/jsonrpc` |
| Merchant version selection, runtime and lifecycle | `sf82-seller-pilot/releases.mjs` |
| Portable selected-request/client handoff | `partners/chainstack-stellar/installation.mjs` |
| Request preparation, original review, one attempt and saved output | `sf88-operator-buyer-cli/node/client.mjs` |
| Bound agent operation and response consumption | `sf88-operator-buyer-cli/node/agents/operation.mjs` |
| Original MCP HTTP authentication and JSON-RPC transport | `stellar-forge/mcp-paid-agent/http-tools.mjs` |
| Original approval, budget, signer and response bytes | `sf81`, `sf36`, `sf103`, `sf31` selected by SF88 |

Pinned runtime source:
https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/f8db4d8cff51ace62bb7b25655131aaed78bdde8

The completed receiving results and selected raw-source identities are in `native` and `reference` in the delivered kit.


## Governed remote MCP tools in this application

The optional remote backend adds selected paid MCP tools to the existing request
list, browser, authenticated HTTP API and MCP endpoint. The retained HTTP handoff
and its original buyer continue to use their existing request IDs and operator
profile. Each remote request has a distinct application intent ID and an original
native quote UUID.

Add one absolute path to the receiving application's existing configuration:

```json
{
  "remoteMcp": "/private/receiving/remote-mcp.json"
}
```

Keep the other application configuration fields. The runtime must include the
governed native MCP source and its existing SDK dependencies. A complete installed
launch and configuration procedure is provided in INSTALLED.md.

The selected remote configuration uses
`stellar-forge.application-remote-mcp.v1`:

| Field | Receiving-host value |
| --- | --- |
| discoveryUrl | The original HTTPS Bazaar discovery base URL. |
| allowedResourceOrigins | Exact HTTPS origins permitted for the selected provider endpoints. |
| operatorModule | Absolute path to the private module created by the original native spending setup. |
| timeoutMs | Optional transport timeout from 1,000 to 300,000 ms; default 30,000. |
| requests | One to 24 explicitly selected requests with distinct application intent IDs. |

Each request contains the following fields:

| Field | Meaning |
| --- | --- |
| intentId | A stable application identifier, distinct from every existing HTTP request. |
| label | Optional operator-facing name. |
| query | Discovery search text used to find this original advertised tool. |
| endpoint | The exact advertised, normalized HTTPS MCP endpoint. |
| toolName | The exact MCP tool name. |
| transport | `streamable-http` or `sse`. |
| paymentResourceUrl | The exact resource that the tool's original payment challenge uses. |
| arguments | The complete selected JSON arguments object. |
| acceptedTerms | One complete original accepted payment option, including scheme, network, asset, amount, payTo, maxTimeoutSeconds, and any additional fields. The governed native path uses the exact scheme. |
| inputSchemaSha256 | Optional SHA-256 pin for the advertised tool input schema. The original broker also compares the retained advertised schema with the live tool schema before dispatch. |

Copy the selected endpoint, tool name, transport and complete payment option from
the original merchant's discovery result. The receiving application checks the
complete selected terms against the original discovery offer; a similar price,
recipient or URL is insufficient. The host selects this configuration and the
operator module. Application tools accept the selected intent ID and action
options.

### Operator setup

The original spending host configuration selects the existing public payer,
signer environment-variable name, native per-payment limits, and the original
SF36 policy, ledger, actor and service. It also selects the original Stellar RPC
endpoints. Create the private operator module using the original product command:

```sh
node /source/stellar-forge/mcp-paid-agent/native-spend-workspace.mjs \
  setup /private/native-spending.json /private/receiving/native-operator.mjs
```

Set the remote configuration's operatorModule to that generated file. Its
approve, signPayment, spendingStatus, reconcilePayment and close exports are
required. Newly generated modules also export an openOperator factory and their original readiness metadata.
The embedded application uses a factory instance with its own approval state and
lifetime, so it can close and reopen within one process. Regenerate older modules
to obtain this factory; a legacy module's singleton is scoped to one application
lifetime in its process.
The application displays that metadata when present; the host's selected
callbacks remain authoritative for approval, signing and spending.

The application creates its own private remote-mcp state directory beneath the
existing application state. It retains the selected configuration hash, each
subject/intent/quote binding, and the original quote and result databases.
The spending policy and ledger stay at the host-configured original paths, so
concurrent buyers share the same aggregate budget.

### Review, execute and receive

Open the application normally. HTTP requests keep their RPC and POST labels.
Remote entries show the actual tool, MCP transport, endpoint, payment resource,
complete arguments, argument hash, input schema hash and selected terms.

1. **Run original review.** The application searches the selected discovery
   service, finds the exact tool and complete payment option, and creates an
   original durable native quote. It then shows the aggregate spending estimate.
   The merchant tool is invoked when execution begins.
2. **Execute or recover.** The original operator reviews the complete native
   quote and budget. The application's host authorization callback is consulted
   for execution, after the operator's review, and immediately before the
   governed signer reserves funds and signs a live payment challenge.
3. **Read or download the result.** The original result store verifies retained
   bytes before the application returns JSON, text, base64 or file metadata.
   Remote results support the original full 2 MiB limit, including downloads and
   exclusive local exports. HTTP responses retain their original 1 MiB limit.
4. **Inspect spending and reconcile payment.** The Operation tab exposes the
   original budget estimate or reservation, transaction reference, original
   transfer observation and final spending outcome.

A repeat execution operates on the same original quote UUID. The native broker
does not dispatch it twice. Closing and reopening the process preserves that
same identity. Review can replace an expired, completely unattempted quote only
after the original spending host confirms it has no reservation; the previous
quote IDs remain in the application's retained request record. An attempted or
cancelled quote keeps its original identity.

Current status, cancellation and spending inspection remain available while a
remote execution is waiting. Cancellation uses the original broker's cancellation
path, including its terminal-approval abort. Existing reservations and received
results remain attached to their original quote.

### Additional commands and authenticated endpoints

```sh
node cli.mjs verify-source --config /private/application.json
node cli.mjs review --config /private/application.json --intent SELECTED_REMOTE_INTENT
node cli.mjs execute --config /private/application.json --intent SELECTED_REMOTE_INTENT
node cli.mjs spending --config /private/application.json --intent SELECTED_REMOTE_INTENT
node cli.mjs reconcile --config /private/application.json --intent SELECTED_REMOTE_INTENT
node cli.mjs read --config /private/application.json --intent SELECTED_REMOTE_INTENT \
  --format json --limit-bytes 2097152
node cli.mjs export --config /private/application.json --intent SELECTED_REMOTE_INTENT \
  --out /private/received/original-tool-result.json
node cli.mjs cancel --config /private/application.json --intent SELECTED_REMOTE_INTENT
```

Source verification includes both the retained HTTP handoff and selected remote
definitions. The three additional MCP tools are stellar_request_cancel,
stellar_request_spending and stellar_request_reconcile. They are advertised when
the remote backend is configured. The existing read tool advertises the larger
remote result ceiling in that configuration.

| HTTP endpoint | Body |
| --- | --- |
| POST /api/requests/{intentId}/cancel | {} |
| POST /api/requests/{intentId}/spending | {} |
| POST /api/requests/{intentId}/reconcile | {}, or {"transaction":"ORIGINAL_64_HEX_HASH"} for a retained attempt whose receipt omitted its transaction |
| POST /api/requests/{intentId}/read | {"format":"json","limitBytes":2097152} for a remote result |
| GET /api/requests/{intentId}/download | Complete retained bytes; the response includes X-Response-SHA256. |

Reconciliation reads the retained transaction, runs the original SF86 transfer
verification, and passes its matching facts to the original SF36 finalization
path. A supplied transaction must match an existing retained receipt. The result
shows the original observation and spending outcome even when the original
purchase status was indeterminate.

### Embed with current host authority

loadApplication keeps the existing authorizationModule integration. Embedded
hosts may also call attachRemoteMcpApplication directly with an existing
openApplication instance, configurationFile, sourceRoot, stateDirectory and the
same authorize callback. The base application exposes selectedIntentIds to
the trusted composition layer so it rejects HTTP/MCP ID collisions before routing.

Authorization receives the same applicationId, authenticated context, action and
selected request view used by the existing HTTP flow. Remote request views add
requestKind "mcp", toolName, transport, paymentResourceUrl and responseByteLimit.
The retained request binds its first authorized subject to the original quote.
Hosts can revoke grants in their own current authorization lookup; the application
checks that lookup again after a human approval wait and before original signing.

The common operation result keeps phase, source, binding, operation and result
fields for existing browser consumers. Remote outcomes additionally contain the
original quote, with local result paths reduced to verified metadata. A spending
action adds the original spending report; reconciliation appears in the original
quote and returned result. read and export return the complete retained MCP
CallToolResult representation, including its original content, structuredContent
and payment response metadata.

