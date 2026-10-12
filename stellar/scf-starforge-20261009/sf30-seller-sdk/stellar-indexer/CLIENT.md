# Stellar client workspace

The client workspace operates Creit’s original Stellar Indexer SDK and the existing Soroban event engine together. It saves the exact native query selection, captures original service pages, retains parsed editions, compares later results, operates recurring event services and delivers a complete editable receiving package.

The browser and headless CLI use the same native stores. The original SDK owns request validation, protocol parsing and service behavior. The original event workspace owns Stellar RPC, ledger windows, continuation cursors, event identity and publication. Source receiving preserves those records and binds private connections to the receiving host.

## Install and open

Select **Stellar client workspace** in an installed runtime containing the complete source. The source-owned command is **stellar-indexer-workspace**; **stellar-indexer** exposes the full headless operator.

For an existing source checkout, invoke the original module directly:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-indexer/cli.mjs open \
  --workspace /absolute/private/client-workspace \
  --connections-file /absolute/private/indexer-connections.json \
  --event-connections-file /absolute/private/event-connections.json
~~~

Open the complete local session URL printed by the command. The process remains in the foreground. SIGINT or SIGTERM drains active native source operations before the host closes.

The private client root contains indexer/ for original Indexer state and events/ for the original Soroban workspace. Use --event-workspace with an absolute original event directory when the client already has a retained service. Keep private state outside the installed source tree. The readonly Applications identity check reopens the original Indexer workspace UUID after startup.

An operator can open a received workspace without a service token:

~~~sh
stellar-indexer open --workspace /absolute/private/received-client
~~~

Its retained queries, source pages, editions, comparisons and receiving history remain available. New native source calls use the aliases configured on that host.

## Original SDK and runtime

The exact publisher source is retained at source/stellar-indexer-sdk-0.0.13.json: all 28 released files with the original JSR manifest, native schemas, five protocol families, dependency declarations and license. Each file retains its published path, full bytes and SHA256.

The Node package uses JSR’s original npm compatibility distribution:

~~~json
{
  "dependencies": {
    "@stellar-indexer/stellar-indexer-sdk": "npm:@jsr/stellar-indexer__stellar-indexer-sdk@0.0.13"
  }
}
~~~

Configure its original registry:

~~~ini
@jsr:registry=https://npm.jsr.io
~~~

The retained publisher metadata at source/npm-registry-metadata.json identifies compatibility revision 11:

~~~text
https://npm.jsr.io/~/11/@jsr/stellar-indexer__stellar-indexer-sdk/0.0.13.tgz
sha512-Rn0X2OJNow6SKQrSSwGZ3rYJpgj/HFPg+e7KwjSDfpeXr6c+DVYYMvglU6UlgGxjjiyo7mHK6IUuVrYKc+LqwQ==
~~~

### Select an installed SDK project

Install the original alias in an ordinary project before that project is retained. A separate SDK project lets an already selected managed merchant runtime keep its original package and lock binding. In the chosen existing project directory, run:

~~~sh
npm config set @jsr:registry https://npm.jsr.io --location=project
npm install --save-exact '@stellar-indexer/stellar-indexer-sdk@npm:@jsr/stellar-indexer__stellar-indexer-sdk@0.0.13'
~~~

Pass that actual project to the operator:

~~~sh
stellar-indexer open \
  --workspace /absolute/private/client-workspace \
  --installation-directory /absolute/private/stellar-sdk-project \
  --connections-file /absolute/private/indexer-connections.json \
  --event-connections-file /absolute/private/event-connections.json
~~~

Every CLI command accepts --installation-directory. The Applications form exposes **Existing SDK installation project** and verifies the selected directory again in the startup receipt. When omitted, the engine resolves the installation from its executing source folder. The selected project supplies the original installed SDK and dependency tree; the executing application still supplies its own maintained source and publisher capsule.

The native engine retains the selected original package graph before importing it. A complete received application uses its associated retained runtime binding, including the six original SDK entrypoints and the selected original payment packages. Receiving reopens those original bindings for the copied application source.

Installed runtime retention records the actual selected package, all six native exported subpaths, its transitive dependency files and their original resolution links before SDK import. A complete delivery retains that actual runtime and the original publisher source. Receiving reconstructs the selected runtime from those files. The original publisher manifest and installed dependency closure have separate identities.

## Private connections

Indexer connections are an alias-to-configuration JSON object:

~~~json
{
  "client": {
    "network": "stellar:pubnet",
    "apiUrl": "https://api.stellarindexer.com",
    "consumerTokenEnv": "STELLAR_INDEXER_CONSUMER_TOKEN"
  }
}
~~~

Supply the existing service token through that environment variable. An existing private consumerToken value is also accepted. Choose one token source. Each connection declares stellar:pubnet or stellar:testnet. The source engine selects the original service and network from that configuration.

The browser and saved queries select the alias. Tokens remain in private host configuration. consumerTokenEnv is resolved by the host process; it is not copied into a query or receiving manifest.

Original Stellar RPC aliases use the existing native connection object:

~~~json
{
  "testnet": {
    "network": "stellar:testnet",
    "rpcUrl": "https://soroban-testnet.stellar.org"
  }
}
~~~

This is an actual public testnet endpoint. Select the client’s real contract/network before operating a service. An archive connection is a separately configured existing provider alias. Private header values can be supplied through headerEnv, mapping an actual header name to an existing environment variable. The original RPC engine validates its network against the returned network passphrase.

A publication map selects original local publisher destinations:

~~~json
{
  "client-events": {
    "directory": "/absolute/private/client-event-publisher",
    "label": "Client contract events"
  }
}
~~~

Use --event-publications-file to load that map. Browser watch configuration selects publicationAlias. Headless watch JSON also accepts the original native descriptor. The underlying publisher retains its existing feed, source, signing, delivery and buyer identities.

## Save a native query

The **Queries** page displays the actual method catalog returned by the source engine: 34 native methods across base, StellarDomains, Blend, Axis Markets, Reflector and xBull Swap, plus the full owner-domain composition. Each entry shows its original ordered arguments, pagination slot, constructor options and result shape.

A saved version pins the native method or explicitly named composition; original ordered SDK arguments; original protocol constructor options; private connection alias and network; and all-pages or one-call paging, starting page and native limit.

The original service decides which package the configured account can access. Contracts’ Data is the relevant service for the published StellarDomains extension. The catalog also preserves the SDK’s other read methods so an existing authorized account can select its actual product.

The included examples/query-contract-data.json uses the registry contract published by the original 0.0.13 StellarDomains source. Replace the selection with the client’s actual contracts when commissioning their application.

~~~sh
stellar-indexer state --workspace /absolute/private/client-workspace \
  --connections-file /absolute/private/indexer-connections.json

stellar-indexer query-save --workspace /absolute/private/client-workspace \
  --connections-file /absolute/private/indexer-connections.json \
  --input /absolute/private/client-query.json \
  --request client-query-01 --revision 0
~~~

The revision in the example is the initial Indexer revision. Read the current state.indexer.revision for a later command. The query-configure command with --query UUID and --input JSON creates another pinned version without changing source already captured under an earlier version.

The query editor uses complete JSON for native arguments. Displayed method labels show their order. A method without native pagination uses one original call. Paged methods place the requested page and limit in the original method’s options argument.

### Full owner-domain handover

Use **stellardomains.resolveOwnedDomains** for a complete ownership handover. Its arguments are an array containing the original owner address and native options. The example file requires the actual G or C owner address.

The original getDomainsOwnedByAddress method reuses the owner page number during its registry join. Its empty owner selection can also reach the registry with an empty value filter. This workspace retains that native method, its original source calls and returned projection as one separate catalog choice.

The full composition reads the original owner page, resolves its selected token IDs through complete registry paging from zero and uses the original published domain schema/parser. Empty owner pages complete that selection without an unrelated global registry query. Source history distinguishes the native method from this explicit composition.

## Capture, continue and compare

Start a capture from a saved query in **Captures & editions**. The browser first saves the native capture identity, then runs its original source pages in the host. Pause and status remain available while that operation runs.

~~~sh
stellar-indexer capture-start --workspace /absolute/private/client-workspace \
  --connections-file /absolute/private/indexer-connections.json \
  --query ORIGINAL_QUERY_UUID --request client-capture-01 --revision CURRENT_INDEXER_REVISION
~~~

The CLI prints the retained capture first and then awaits the selected source pages. --query-version N pins an earlier saved version. --max-pages N performs a finite amount of the same original capture; capture-run continues its retained progress.

~~~sh
stellar-indexer capture-status --workspace /absolute/private/client-workspace \
  --capture ORIGINAL_CAPTURE_UUID

stellar-indexer capture-run --workspace /absolute/private/client-workspace \
  --connections-file /absolute/private/indexer-connections.json \
  --capture ORIGINAL_CAPTURE_UUID --max-pages 20

stellar-indexer capture-pause --workspace /absolute/private/client-workspace \
  --capture ORIGINAL_CAPTURE_UUID --request client-pause-01 --revision CURRENT_INDEXER_REVISION

stellar-indexer capture-resume --workspace /absolute/private/client-workspace \
  --connections-file /absolute/private/indexer-connections.json \
  --capture ORIGINAL_CAPTURE_UUID --connection-alias client \
  --request client-resume-01 --revision CURRENT_INDEXER_REVISION
~~~

Every capture retains the pinned query, original attempts, source pages, observed row counts and pagination checkpoint. A source failure leaves the original attempt available for inspection and later continuation. Successful completion creates an immutable data edition.

The row view provides a readable native projection and its complete lossless value. Big integers, dates, bytes, maps, sets, undefined values and nested objects have explicit tagged forms in retained source. Complete row inspection also shows the original key, row hash, source page and attempt identity.

Select two completed editions in **Compare**. Both remain original immutable sources; the comparison pages their retained changes. Headless equivalents are:

~~~sh
stellar-indexer rows --workspace /absolute/private/client-workspace \
  --edition ORIGINAL_EDITION_UUID --offset 0 --limit 100

stellar-indexer compare --workspace /absolute/private/client-workspace \
  --before ORIGINAL_BASELINE_EDITION_UUID --after ORIGINAL_CORRECTED_EDITION_UUID \
  --offset 0 --limit 100
~~~

## Operate original event services

In **Event services**, save the actual contract IDs, original topic filters and selected ledger range. The native event engine owns getEvents validation and complete ledger-window progression.

Create a recurring watch from that saved plan. Choose its primary alias, optional recovery alias, window length, polling interval, ending ledger and original publication destination. A blank starting ledger uses the saved plan’s starting point or the original source’s observed latest ledger.

The service can start, pause and continue the same retained watch; catch up a finite number of native windows; repair a retention gap from retained original editions or a compatible archive alias; and change future configuration while preserving earlier versions. Complete watch receiving retains a partial native capture, its cursor, completed editions and original publisher snapshots.

~~~sh
stellar-indexer event-plan --workspace /absolute/private/client-workspace \
  --event-connections-file /absolute/private/event-connections.json \
  --input /absolute/private/original-event-plan.json \
  --request event-plan-01 --revision CURRENT_EVENT_REVISION

stellar-indexer watch-save --workspace /absolute/private/client-workspace \
  --event-connections-file /absolute/private/event-connections.json \
  --input /absolute/private/client-watch.json \
  --request client-watch-01 --revision CURRENT_WATCH_REVISION

stellar-indexer watch-start --workspace /absolute/private/client-workspace \
  --event-connections-file /absolute/private/event-connections.json \
  --watch ORIGINAL_WATCH_UUID --request watch-start-01 --revision CURRENT_WATCH_REVISION
~~~

watch-start enables the selected watch and runs it in the foreground. watch-daemon runs already enabled watches and stays available while they are paused. Stopping the foreground process drains its current native operation; the saved desired state remains available for the next host.

watch-catch-up performs 1–1000 finite native windows, including for a paused watch. watch-pause commits the pause and lets the active original window drain. The native runner lease prevents a competing caller from issuing the same window twice.

watch-repair accepts original editionIds and/or recoveryConnectionAlias in its input JSON. Select real retained source and an actual compatible configured provider. Event identities, full RPC objects and raw XDR remain original throughout recovery.

Use state.events.revision for event plan/capture/edition mutations and state.watches.revision for watch mutations. These are independent of the Indexer revision.

## Deliver and receive a whole client workspace

The **Handover** page selects completed SDK editions, additional partial captures and original watch IDs. The combined native delivery retains their complete original source and installed runtime. Each manifest records every declared file’s path, byte count, SHA256, total count and total bytes.

Original SDK pages and original Soroban windows remain separate source engines inside that one client delivery. A receiving watch preserves its earliest source namespace and returns paused. Rebinding the receiving host’s private aliases and publisher directories leaves its original editions and source identity intact.

~~~json
{
  "editionIds": ["ORIGINAL_BASELINE_EDITION_UUID", "ORIGINAL_CORRECTED_EDITION_UUID"],
  "captureIds": [],
  "watchIds": ["ORIGINAL_WATCH_UUID"]
}
~~~

~~~sh
stellar-indexer delivery-export --workspace /absolute/private/client-workspace \
  --input /absolute/private/client-delivery.json \
  --request client-delivery-01 --revision CURRENT_INDEXER_REVISION
~~~

Retain that complete export JSON. **Save complete source folder** streams every declared file through the existing original source transport and verifies each complete hash. It can reuse byte-identical existing files after interruption. The original manifest is included alongside all selected source, runtime and native publication files.

The headless equivalent uses the original range downloader:

~~~sh
stellar-indexer source-folder --workspace /absolute/private/client-workspace \
  --input /absolute/private/client-delivery-export.json \
  --output /absolute/private/client-receiving-source
~~~

The output must contain the complete declared folder. Existing different files require a different destination or selection of the correct original export. Large publication snapshots are streamed.

On the receiving host, configure its existing service and RPC aliases, select the complete folder and original manifest SHA, then receive:

~~~sh
stellar-indexer delivery-receive --workspace /absolute/private/received-client \
  --connections-file /absolute/private/receiving-indexer-connections.json \
  --event-connections-file /absolute/private/receiving-event-connections.json \
  --source-directory /absolute/private/client-receiving-source \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --watch-connections-file /absolute/private/receiving-watch-connections.json \
  --request client-receive-01 --revision CURRENT_INDEXER_REVISION
~~~

The watch map selects each original watch by ID:

~~~json
{
  "ORIGINAL_WATCH_UUID": {
    "connectionAlias": "client-rpc",
    "recoveryConnectionAlias": "client-archive",
    "publicationDirectory": "/absolute/private/received-publications"
  }
}
~~~

Only include aliases that actually exist in the receiving host’s private configuration. The publication directory is the private receiving base; the original watch receiver preserves separate historical publication targets beneath it.

The browser uses the same native receive operation for a folder already available to its local host. After receiving, inspect the original edition hashes, page counts, watch windows, paused state and retained source. Start the original received watch from **Event services** when the host is ready to continue it.

source-export and source-receive operate on one original SDK capture or edition. event-export, event-receive, watch-export and watch-receive expose the existing individual engines. source-file with the indexer, events or watches source selection copies one exact declared file with complete hash/count verification.

### Reopen the received application with its original runtime

A source or combined receive result includes `installations`. Each entry binds one retained application source to one retained native runtime. It records the original application/runtime identities, both manifest hashes and the local runnable paths:

~~~json
{
  "installations": [{
    "id": "INSTALLATION_SHA256",
    "applicationId": "ORIGINAL_APPLICATION_SHA256",
    "runtimeId": "ORIGINAL_RUNTIME_SHA256",
    "directory": "/absolute/private/received-client/indexer/installations/ORIGINAL_APPLICATION_SHA256/ORIGINAL_RUNTIME_SHA256",
    "sourceDirectory": "/absolute/private/received-client/indexer/installations/ORIGINAL_APPLICATION_SHA256/ORIGINAL_RUNTIME_SHA256/source",
    "manifestSha256": "ORIGINAL_APPLICATION_MANIFEST_SHA256",
    "runtimeManifestSha256": "ORIGINAL_RUNTIME_MANIFEST_SHA256",
    "entrypoint": "/absolute/private/received-client/indexer/installations/ORIGINAL_APPLICATION_SHA256/ORIGINAL_RUNTIME_SHA256/source/stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-indexer/server.mjs",
    "cli": "/absolute/private/received-client/indexer/installations/ORIGINAL_APPLICATION_SHA256/ORIGINAL_RUNTIME_SHA256/source/stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-indexer/cli.mjs",
    "indexerDirectory": "/absolute/private/received-client/indexer"
  }]
}
~~~

Save the complete receive result. Select the entry for the application/runtime pairing used by the capture you are continuing, and use the exact returned `cli` or `entrypoint` path. The receiver has copied the original application source and bound its verified retained package roots into that copy. Its original SDK exports and installed native dependency source are available there.

For example, set these two task variables to the selected receipt's exact local paths, then inspect and open the received workspace:

~~~sh
CREIT_RECEIVED_CLI=/absolute/path/from/the/selected/installation/cli.mjs
CREIT_RECEIVED_SERVER=/absolute/path/from/the/selected/installation/server.mjs

node "$CREIT_RECEIVED_CLI" state --workspace /absolute/private/received-client

node "$CREIT_RECEIVED_SERVER" --workspace /absolute/private/received-client \
  --port 0 --startup-format json
~~~

The command's `--workspace` is the private operator root, `/absolute/private/received-client` in this example. The receipt's `indexerDirectory` identifies its `/indexer` child. Keep the original event directory selection when a separate event workspace was configured.

The server emits its ready receipt and private session URL. The full original query, row, edition comparison, event and receiving interface runs from that retained source copy. Reading retained editions and source works with the installed runtime already received. To continue live source work, add the receiving host's private `--connections-file` and `--event-connections-file` selections to the same command. Reuse the original query/watch identities and configured aliases when resuming.

The same returned CLI supports `capture-status`, `capture-run`, `capture-resume`, `watch-catch-up`, `watch-repair`, later delivery exports and source downloads. A newly installed SDK project is selected through `--installation-directory` for deliberate future capture work; the received application/runtime pairing is already bound to its retained original packages.

## Interrupted requests and private operation

Every mutation takes a request ID and expected revision. Keep the complete original body. Retrying that same request returns its retained native result even after the workspace advances. A changed body uses its own request identity.

The browser saves each exact request before dispatch together with its original Indexer workspace ID and the selected Indexer, event or watch workspace ID. **Recover an interrupted response** replays that original body on those same workspaces. The server checks the recorded identities before applying the request, so reopening another customer workspace on the same local port keeps its earlier requests separate. A retained request without a recorded workspace identity stays available for full-body review and reconciliation with its original native result.

An explicit `REVISION_CONFLICT` refreshes the selected original workspace. After reviewing its current source, use **Retry with current revision** to replace only the revision precondition; the request ID and every native input remain unchanged, and the previous complete body and rejection stay in the retry history. Busy operations, pending watch requests and interrupted responses retain their exact original body. Concurrent clicks for the same saved request share one browser dispatch. Once the native operation returns successfully, a later failed state refresh leaves that acknowledged result successful.

Source capture and watch progress live in their original native stores, so browser reloads preserve retained source and window checkpoints. Reopening another workspace clears the earlier transient row, capture and export selections while retaining every recorded request under its original identity.

The server binds to the local host. Its printed private session URL selects the existing bearer-protected operator flow; the browser removes the session fragment from the address after opening. Connection tokens and provider headers stay in the host configuration.

## Source references

- Original released SDK: https://jsr.io/@stellar-indexer/stellar-indexer-sdk/0.0.13
- Exact publisher manifest: https://jsr.io/@stellar-indexer/stellar-indexer-sdk/0.0.13_meta.json
- Original SDK repository: https://github.com/Creit-Tech/Stellar-Indexer-SDK
- Native service product: https://stellarindexer.com/
- Original SDK npm metadata: https://npm.jsr.io/@jsr/stellar-indexer__stellar-indexer-sdk
- JSR Node compatibility: https://jsr.io/docs/npm-compatibility
- Native Stellar RPC getEvents contract: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents
