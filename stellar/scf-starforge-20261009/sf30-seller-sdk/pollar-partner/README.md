# Pollar partner workspace

A complete partner application for Pollar onboarding, wallet provisioning, balances, payments, activity and customer reports. The customer portal calls the publisher's browser SDK. The operator runs the documented server API and scoped MCP tools, retains each request and response, and delivers an independently reopenable application, workspace and runtime.

The source includes a monochrome operator, customer portal, terminal interface, JavaScript API, saved application versions, verified participants, recoverable operations, complete source downloads, reports and streamed archive receiving.

## Start from the complete source

Use Node.js **22.16.0 or newer** and npm. Node 24 is suitable. Keep the surrounding source directories in the checkout: they contain the maintained journal, Applications lifecycle and source-selected distribution used by this product.

The commands below run from the repository root. An installed selected package also supplies the direct **stellar-pollar-partner** executable. [APPLICATIONS.md](APPLICATIONS.md) describes package construction and managed launch.

Build the original Pollar browser runtime into separate private directories:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/pollar-partner/cli.mjs runtime-build \
  --installation-directory /srv/pollar-sdk \
  --runtime-directory /srv/pollar-runtime \
  --node-heap-mb 512
~~~

This selects the complete licensed publisher source in [source/pollar-sdk-source.json](source/pollar-sdk-source.json), runs its original npm lock and the core, React and Accesly build scripts, and retains the resulting package graph before the browser imports it. The exact source selection is **pollar-xyz/pollar@b67e306439511df00f63374445e315b68fa36b92**; the selected packages are **0.12.0-rc.1** and retain their Apache-2.0 license and notices. The source lock declares npm 10.9.4. An explicit installed npm entrypoint can be selected with --npm-executable.

Keep the complete build result, runtime ID and manifest SHA256. The build uses a durable operation beside the installation, including every native command, stdout, stderr, source identity and completed compiled-file selection. Repeating the same build command continues that operation. A completed source stage is checked against its original files before reuse.

Create the private configuration:

~~~sh
mkdir -p /srv/pollar-private
cp stellar/scf-starforge-20261009/sf30-seller-sdk/pollar-partner/examples/connections.example.json \
  /srv/pollar-private/connections.json
chmod 600 /srv/pollar-private/connections.json
~~~

Edit the application ID in that file to the actual selected Pollar application. Its server secret and scoped MCP personal access token use explicit environment references in the example. Set those values through the existing private host environment, or use private absolute file references. Keep the configuration and credential files outside the workspace and runtime export roots.

Start the complete application:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/pollar-partner/cli.mjs serve \
  --workspace /srv/pollar-workspace \
  --connections-file /srv/pollar-private/connections.json \
  --runtime-directory /srv/pollar-runtime \
  --port 8778 \
  --startup-format json
~~~

The startup JSON contains the private operator URL, customer portal base URL, exact workspace ID, revision, runtime selections and process identity. Open the complete operator URL, including its token fragment. The browser retains that operator token in session storage and removes it from the address bar.

Port **8778** gives the customer portal and its recovery journal a stable origin. For this local installation, the customer origin is **http://127.0.0.1:8778** and the OAuth redirect URI is **http://127.0.0.1:8778/portal**. The selected Pollar application's allowed origins and redirect URIs must include those exact values. The native update-domain and update-redirect actions replace the publisher's full lists, so retain existing approved entries when changing them.

The server binds to 127.0.0.1 or ::1. Its operator and customer endpoints use separate authorization. Browser authentication, passkeys, DPoP storage, signing and wallet recovery stay in the actual Pollar browser SDK.

## Save the partner application

In **Applications**, select the retained browser runtime and save the public application configuration. Supply the actual publishable key, provider application ID and network. A testnet key starts with pub_testnet_; a mainnet key starts with pub_mainnet_. The key prefix and stellarNetwork must agree.

[examples/partner-application.template.json](examples/partner-application.template.json) is the corresponding terminal input. Replace its key and provider ID, then select the runtime ID returned by the build:

~~~sh
stellar-pollar-partner application-save \
  --workspace /srv/pollar-workspace \
  --connections-file /srv/pollar-private/connections.json \
  --runtime-directory /srv/pollar-runtime \
  --runtime-id ACTUAL_RUNTIME_ID \
  --input /srv/pollar-private/application.json
~~~

The host returns its own application UUID and immutable version. That UUID selects saved configurations and customer links; the provider application ID remains the original Pollar ID inside configuration. Saving a following version preserves the provider ID and network, while allowing the operator to change the name, runtime, public SDK options or redirect selection.

The **Open customer portal** link selects the exact saved host application and version. Customer sessions, operations and reports retain that selection. An older operation therefore continues to refer to the configuration under which it began.

The public configuration supports the actual SDK API endpoint, request and submission timeouts, device label, OAuth redirect, retry and logging options. Runtime module URLs are generated from the retained runtime ID. Public configuration contains only the publishable key; server secrets and MCP tokens belong to the private operator connection.

## Customer onboarding and wallets

The portal's **Connect** tab uses the original Google, GitHub, email, passkey and external-wallet SDK actions. Email entry, code delivery and code verification are distinct native SDK steps. A void-returning login call remains pending until the SDK's own authenticated-state transition supplies the result.

After authentication, the portal obtains the current verified SDK access token in memory and submits it to the host's session-verification endpoint. The host uses the original POST /v1/tokens/verify response to bind the actual user ID, application ID and network. Its HttpOnly customer cookie grants access to that participant's application records. The token is excluded from the saved workspace, browser operation journal and reports.

**Wallet** shows provisioning, the selected wallet addresses, balances and enabled assets. Create wallet and Refresh call the original SDK methods; deferred wallet creation remains visible through its real provisioning state. Receive information keeps the original network and address. Trustline operations use the chosen asset identity. The advanced SDK controls expose the rest of the selected publisher methods without substituting their wallet or authorization behavior.

Original public React passkey ceremony and signer helpers are retained with the core SDK. A host integration can additionally supply the original external wallet adapters, Accesly signing callback, auth URL opener or ramp-signing handlers through the JavaScript bridge. These callbacks stay in browser memory. The bridge describes which native adapters and signers are actually registered.

## Payments, activity and uncertain outcomes

The **Send** form preserves amount strings and the native asset representation:

| Chain | Native input |
| --- | --- |
| Stellar | Decimal amount string, G/M/C destination accepted by the original SDK, and native XLM or an explicit credit asset code and issuer. |
| Solana | Integer base-unit amount string, destination and optional original token mint. |
| Additional publisher flows | Their original action schema and chain selection in Advanced SDK. |

An operation first retains its complete browser intent and the host dispatch boundary. The bridge then calls the actual SDK. Native transaction IDs, signatures and provider status are carried forward from its callbacks. The selected chain determines the wallet used for scope binding, including when the account has wallets on several chains.

If a response is interrupted, **Pending** keeps the same operation and private checkpoint. On reopening, reconciliation reads the original transaction status, history, provisioning or ramp state. It does not create a second payment from an unknown outcome. Signed XDR, submission tokens, transaction events and complete collected history pages remain in the private browser checkpoint where the original SDK action can use them. The host retains public provider identifiers, artifact hashes, actual states and complete permitted observations.

The browser's host-request journal stores each method body or original uploaded File before sending it. If the response is lost after the host commits, reloading reuses the same UUID and complete body. The native workspace returns its original result. A revision rejection can be refreshed and retried because the server explicitly rejected that write. An uncertain write retains its original identity and body until resolved.

**Activity** uses the publisher's offset/limit/chain history request. Fetch a page or collect all pages. Every page and its original next parameters remain in the private SDK checkpoint; the host receives the selected complete observation. The screen presents transaction counts, retained page counts, total availability and completion. Original provider JSON is available under Details.

**Sessions**, requirements, swap, earn, liquidity, KYC/PIX and ramp-signature operations are available through the complete 75-action browser catalogue. Each operation displays the original argument schema. Private one-time login codes and provider authentication payloads are passed transiently to the SDK and removed from retained arguments. A ramp that requires an external signature stays pending until the registered original handler or explicit native signature submission completes it.

## Operator connections and complete native operations

The private connection selects the documented server API and scoped MCP endpoint. Its stable public binding includes provider application ID, network, endpoint and credential-reference labels. Credentials are added only for transport.

The native catalogue contains the five documented server operations, sixteen documented MCP tools and original MCP tool discovery. It covers user registration, testnet funding, signer rotation, application and wallet inventory, balances, transaction and user paging, asset enablement, distributions, wallet roles, readiness, full origin/redirect updates and key creation. Scope requirements and original source references accompany each action.

Run **catalogue** or open **Operations** to inspect the exact current schema. A native operation is prepared under a saved application version. Its connection application ID and network, and any application-scoped MCP ID, must match that version.

For example, edit the selected host UUID and provider ID in [examples/operator-operation.template.json](examples/operator-operation.template.json), then prepare and collect the original transaction history:

~~~sh
stellar-pollar-partner operation-prepare \
  --workspace /srv/pollar-workspace \
  --connections-file /srv/pollar-private/connections.json \
  --input /srv/pollar-private/operation.json

stellar-pollar-partner operation-collect \
  --workspace /srv/pollar-workspace \
  --connections-file /srv/pollar-private/connections.json \
  --operation-id ACTUAL_OPERATION_UUID \
  --request-id ACTUAL_COLLECTION_REQUEST_UUID
~~~

The prepared request, provider request ID, JSON body, endpoint, cursor or offset, and source selection are frozen before dispatch. Each attempt retains its complete request and permitted raw response bytes. operation-collect follows every native page unless an explicit --max-pages is supplied. The original collection execution retains its child request IDs, completed pages and continuation across interruptions.

Use operation-read for the full operation, operation-pause to stop its continuation, and operation-resume for the same original arguments. operation-reconcile selects the latest unresolved native attempt, preserving its provider request and page. A prepared operation that has never been dispatched can be canceled.

MCP transport retains the original initialization/session exchange, JSON or SSE responses, and complete tool-list pages. Provider errors, incomplete successful mutations and transport uncertainty remain distinct outcomes. The exact native result determines completion. A late cancellation does not overwrite an already received successful RPC result.

An API key created by the original native tool is returned once to the authorized caller. Its value is removed before the workspace source, durable outcome and browser request result are written. The operation retains the original body hash and redacted result so later review can identify the event without duplicating the credential.

## Sources, snapshots and reports

**Sources** lists every retained native or accepted customer observation. Source metadata identifies the saved application, participant where applicable, native action, operation, request and runtime. Complete original JSON and raw response bytes are available through the browser and terminal.

~~~sh
stellar-pollar-partner source-file \
  --workspace /srv/pollar-workspace \
  --source-id ACTUAL_SOURCE_UUID \
  --part response \
  --output /srv/pollar-private/provider-response.bin
~~~

Downloads use bounded ranges and check the final byte count and SHA256 against the selected original descriptor.

A snapshot freezes a complete application or participant selection, its operations, provider identities, source records and decisions. Create a report from that snapshot to obtain HTML, JSON and CSV:

~~~sh
stellar-pollar-partner snapshot-create \
  --workspace /srv/pollar-workspace \
  --application-id ACTUAL_HOST_APPLICATION_UUID \
  --name "Partner activity"

stellar-pollar-partner report-create \
  --workspace /srv/pollar-workspace \
  --snapshot-id ACTUAL_SNAPSHOT_UUID

stellar-pollar-partner report-file \
  --workspace /srv/pollar-workspace \
  --report-id ACTUAL_REPORT_UUID \
  --format html \
  --output /srv/pollar-private/partner-activity.html
~~~

The customer portal scopes its snapshots, reports and source reads to the verified participant and selected application. The operator can make complete application-level reports. Each report preserves its snapshot ID and source identity rather than recomputing a historical edition from current provider state.

## Complete archive and independent receiving

A workspace export carries the entire original state and journal, saved application versions, verified participant records, operations and attempts, permitted raw provider sources, snapshots, decisions and reports. It includes the exact application source cohort and every retained runtime referenced by the exported applications, operations or sources.

~~~sh
stellar-pollar-partner workspace-export \
  --workspace /srv/pollar-workspace \
  --connections-file /srv/pollar-private/connections.json \
  --runtime-directory /srv/pollar-runtime \
  --destination /srv/pollar-delivery \
  --request-id ACTUAL_EXPORT_REQUEST_UUID
~~~

Keep the returned **exportId** and **manifestSha256**. Export selection is pinned before the files are copied, so later live workspace activity does not change that delivery. A retry uses the original pinned state and completed copies, then acknowledges the export into the current journal.

Create and independently unpack the complete archive:

~~~sh
stellar-pollar-partner package-archive \
  --source-directory /srv/pollar-delivery \
  --expected-manifest-sha256 ACTUAL_MANIFEST_SHA256 \
  --output /srv/pollar-private/pollar-delivery.tar.gz

stellar-pollar-partner package-unpack \
  --file /srv/pollar-private/pollar-delivery.tar.gz \
  --destination /srv/pollar-received-source \
  --expected-manifest-sha256 ACTUAL_MANIFEST_SHA256

stellar-pollar-partner package-inspect \
  --source-directory /srv/pollar-received-source \
  --expected-manifest-sha256 ACTUAL_MANIFEST_SHA256

stellar-pollar-partner package-receive \
  --source-directory /srv/pollar-received-source \
  --destination /srv/pollar-independent \
  --expected-manifest-sha256 ACTUAL_MANIFEST_SHA256 \
  --request-id ACTUAL_RECEIVING_REQUEST_UUID
~~~

Archive writing and receiving stream complete file bytes. The manifest checks paths, sizes, modes and SHA256 values; package receiving verifies the source journal and runtime selections before publishing the destination. Stable destination locks and original request receipts allow an interrupted receive to continue without overwriting a different installation.

The receiving result returns **workspace.directory**, **application.directory**, **application.cli**, **application.server**, and **application.runtimeConnections**. Launch the returned CLI against the returned workspace directory. Add the returned runtime directories and expected hashes to the receiving host's private configuration, and attach its existing matching Pollar connection.

The received workspace preserves original application, user, operation, attempt, provider, source and snapshot identities. Unfinished operations and page collections arrive paused with their exact native requests and cursors. Choose the original paused operation explicitly when continuing work.

Browser authentication and private signing checkpoints continue in the customer's original SDK/browser storage. Reopening a received host asks that browser to verify its current SDK session against the same provider application and network. The complete host delivery contains accepted public customer observations and native operator history; it keeps the customer portal, original runtime and source needed for that verification.

A report export contains only the selected report manifest and complete rendered members. Use it for an individual report handoff. Use workspace export when the receiving installation needs the whole application and operating history.

## JavaScript and managed Applications

The JavaScript entrypoint is:

~~~js
import {openPollarPartnerOperator, loadPollarPartnerConfiguration} from './operator.mjs';

const workspaceDirectory = '/srv/pollar-workspace';
const configuration = await loadPollarPartnerConfiguration({
  workspaceDirectory,
  connectionsFile: '/srv/pollar-private/connections.json',
  runtimeDirectory: '/srv/pollar-runtime'
});
const operator = await openPollarPartnerOperator({workspaceDirectory, configuration});
try {
  const current = await operator.describe();
  const methods = await operator.methods();
  // Invoke one exact method with its complete arguments and original request ID.
  console.log({workspaceId: current.workspaceId, revision: current.revision, methods});
} finally {
  await operator.close();
}
~~~

The operator exposes the same 31 methods used by the browser and CLI. Mutations carry requestId and expectedRevision; package.receive has its own original request and independent destination identity. Direct HTTP operator writes additionally select X-Pollar-Workspace-ID. Customer writes use the same workspace guard with their verified customer session.

[APPLICATIONS.md](APPLICATIONS.md) covers the maintained launcher, exact process selection, complete source recipe and runtime receiving APIs. Original SDK and documentation source capsules retain their publisher URLs, commits and whole-file hashes. [source/contracts.json](source/contracts.json) records the selected native endpoints, response semantics and source references.
