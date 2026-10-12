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

