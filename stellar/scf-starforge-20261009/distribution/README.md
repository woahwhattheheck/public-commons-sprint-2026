# Starforge merchant toolkit

An installable distribution of the maintained Stellar x402 seller, buyer and
operator workflows. One local package supplies a merchant workspace, the original
seller and operations dashboard, OpenAPI import, buyer review and execution,
response downloads, generated customer clients, seller configuration releases,
database and object sources, merchant fleet operations, revenue reconciliation,
challenge capture, and private support export.

The package preserves the original source paths and bytes. Its command interface
starts those modules directly. It contains no alternative payment implementation,
install hooks, test suites or GitHub Actions configuration.

## Install the source archive

Use Node 22.16 or later. From a new application directory, install the supplied
`tokenjunkielabs-starforge-merchant-*.tgz` archive:

```sh
npm install --ignore-scripts --offline --omit=optional /absolute/path/to/the-package.tgz
npx --no-install starforge doctor
```

This is a local npm-compatible source distribution. It is marked `private` to
prevent an accidental registry publish; local installation and `npm pack` work
normally. This source-only installation omits optional packages. PostgreSQL
drivers and native payment packages have their own setup below.
Git and a Commons checkout are unnecessary on the merchant's machine.

### Prepare a complete customer runtime

The maintained installer selects dependencies from the original archive and keeps
its package intact. It creates a private runtime with exact versions, an npm lock,
and explicit source/dependency roots for the original host and container tools:

```sh
starforge runtime-install prepare --dir /srv/starforge/runtimes/merchant-01 \
  --archive /srv/starforge/downloads/original-merchant.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --native --feature postgres --operator
starforge runtime-install install --dir /srv/starforge/runtimes/merchant-01
starforge runtime-install run --dir /srv/starforge/runtimes/merchant-01 -- source
```

Choose the native and feature options required by that merchant. The same command
supports interrupted-install continuation, fresh-directory upgrades, recovery,
and original command launch. See [Customer runtime installation and recovery](RUNTIME_INSTALL.md)
for the complete workflow and [Runtime profiles](RUNTIME.md) for dependency selection.

### Versioned installation, upgrade and rollback

Use `starforge installation` to put a selected maintained package into the
original SF46 installation with durable `config/` and `state/` directories:

```sh
npx --no-install starforge installation inspect ./node_modules/@tokenjunkielabs/starforge-merchant
npx --no-install starforge installation install ./node_modules/@tokenjunkielabs/starforge-merchant \
  --home /absolute/private/starforge
npx --no-install starforge installation status --home /absolute/private/starforge
```

The first release becomes active. Later package installs are staged for explicit
activation, with the previous version available for rollback. The original
package manifest, source paths, commands and package metadata travel together.
The [managed package guide](../sf46-release/MANAGED_PACKAGE.md) covers manifest
selection, direct Node usage, merchant launch, optional dependencies, retained
portable preparation and interrupted-install recovery.

For an existing completed original runtime, use `starforge installation
adopt-runtime RUNTIME_DIRECTORY --home /absolute/private/starforge`. Its recorded
profile and lockfile become part of the managed release identity, with dependencies
retained at the original runtime location. The [runtime adoption guide](../sf46-release/MANAGED_PACKAGE.md#adopt-a-completed-runtime)
covers profile-based staging, source-level runtime inspection and rollback.

### Schema pattern support

Merchant request schemas that use regular-expression constraints load the
original `re2js` runtime. Its source manifest supplies the exact `2.8.6` version;
the original lockfile is included beside that manifest. If the archive was
installed with optional packages omitted, install this dependency in the same
application directory and check the original schema feature before serving:

```sh
npm install --ignore-scripts --save-exact re2js@2.8.6
npx --no-install starforge doctor --feature schema
```

The `schema` diagnostic checks local dependency resolution. Request matching
continues through the maintained schema validator and pattern compiler.

### OpenAPI YAML source support

The original OpenAPI importer accepts JSON and YAML documents. Its included
`sf61-openapi-seller-import/package.json` and lockfile pin `yaml` to `2.9.1`;
the maintained archive declares that dependency in its `openapi` feature.
If optional packages were omitted, install it in the same application directory:

```sh
npm install --ignore-scripts --save-exact yaml@2.9.1
npx --no-install starforge doctor --feature openapi
```

The diagnostic resolves the dependency from the original parser's installed
source directory. JSON input does not need the YAML engine. YAML import uses
the original YAML 1.2 core parser with unique keys and bounded aliases. The
workspace retains the exact source bytes in the prepared merchant; the terminal
importer records its original input SHA-256 in the compiled manifest.
The existing schema feature above supplies regular-expression matching when
the selected contract requires it.

## Start a merchant workspace

```sh
npx --no-install starforge init --dir ./merchant --template dataset
npx --no-install starforge run --workspace ./merchant -- --port 0
```

Two original startup lines report the seller and operations dashboard addresses.
The dashboard uses an available port unless `--operations-port PORT` is supplied
before `--`. The seller exposes its native `/_seller/docs` explorer,
`/_seller/openapi.json`, `/_seller/health`, `/_seller/offers`, and `/dataset`.

The starter uses the original SF30 example with deliberately nonpayable testnet
asset and recipient markers. An unpaid `/dataset` request returns the actual
native challenge-only `402` response. Change `merchant/data/catalog.json` to your
JSON dataset and restart to load the new snapshot. The data is not released by
challenge-only mode.

`init` requires a new directory and will not overwrite a previous workspace. It
creates ordinary editable `seller.json`, the selected application files, a small
`workspace.json` descriptor, and `.private/` for operator material. The starter's
README records its actual command. It does not copy the installed toolkit into
each workspace.

### Other application templates

| Template | Application source | Use |
| --- | --- | --- |
| `dataset` | `data/catalog.json` | An existing JSON data product, snapshotted by the original seller |
| `application` | `application.mjs` | A trusted Node handler, invoked by the original seller lifecycle |
| `upstream` | `upstreams.json` | An existing API, with original allowlisted query/header bindings |

For example:

```sh
npx --no-install starforge init --dir ./api-pilot --template upstream
# Edit api-pilot/upstreams.json to name your existing backend.
npx --no-install starforge run --workspace ./api-pilot -- \
  --port 0 --allow-loopback-upstream
```

The bundled upstream example points to an operator-owned loopback backend at
port 8425. No backend is invented or started for it. Use the original upstream
configuration and flags for your own HTTPS service.

## Prepare an existing API and hand a request to its buyer

Use the existing OpenAPI workspace on Linux with Node 22.16+ and util-linux
`flock`. Install the YAML feature above for a YAML source, then start the
workspace with an existing private parent for exported projects:

```sh
export STARFORGE_PRIVATE="$PWD/starforge-private"
install -d -m 700 "$STARFORGE_PRIVATE" "$STARFORGE_PRIVATE/merchant-projects"
npx --no-install starforge openapi-workspace \
  --out-parent "$STARFORGE_PRIVATE/merchant-projects" --port 0
```

Open the printed local URL. Import the provider's original OpenAPI 3.0 or 3.1
document, select its actual operation and server, and review the original
request and response contract. Set the merchant's public resource URL, method,
network, asset, recipient and atomic price. Configure the existing application
or upstream binding; private backend authentication stays in the selected
environment references. Save the merchant project and use its existing managed
seller controls to start, check, stop and reopen it.

The terminal importer accepts a merchant-ready JSON or YAML contract with
explicit selection and binding files. Its declared server must already name
the exposed service, and selected operations must not require unresolved
additional authentication:

```sh
npx --no-install starforge openapi \
  --spec "$STARFORGE_PRIVATE/merchant-openapi.yaml" \
  --config "$STARFORGE_PRIVATE/operation-selections.json" \
  --service-bindings "$STARFORGE_PRIVATE/application-bindings.json" \
  --upstream-bindings "$STARFORGE_PRIVATE/upstream-bindings.json" \
  --out "$STARFORGE_PRIVATE/merchant-projects/prepared-api"
```

The output directory must be new. Use the original compiler's selection and
binding formats described in the included
`sf61-openapi-seller-import/README.md`; omit an optional bindings flag when that
binding is not used. The compiler records the input digest, selected payment
terms and supported response contracts in its original outputs.

For a provider API that needs backend authentication or a different public
merchant origin, use the workspace's explicit upstream binding. It retains the
original provider source, authentication references and selected transformation,
then compiles its emitted `facade-openapi.json`, `selections.json` and
`route-bindings.json`. This is the saved package's merchant-facing contract;
`upstreams.json` retains the original bound provider request. Keep the complete
saved package together when reopening its seller.

### Retain a file request and issue its original ticket

For a source-declared multipart operation, select the local files and typed
fields in the merchant workspace. Review the exact body length, digest and
ordinary request headers before issuing its durable operation ticket. The
selected body includes the original multipart boundary and framing. The native
request ceiling is 16 MiB including framing, with the merchant binding's
configured cap applied as well. If the source permits the entire body to be
absent, that remains a distinct request with no body attachment.

Enter the actual merchant operation ID, customer and expiry, then use
**Download complete buyer request**. The private packet carries the original
discovery, exact body and ordinary headers, operation ticket and request
identity. Keep the packet private when handing it to the buyer. Reopening the
saved merchant retains those same bytes; selecting different files creates a
different request that needs its own review and ticket.

The included
`sf61-openapi-seller-import/workspace/FILE_INPUT.md` defines the supported
multipart manifest and standalone body-preparation commands. The workspace
keeps the existing seller and original buyer protocol throughout this flow.

### Receive, review and reopen the acquisition

Create an existing private directory for the receiver's source configurations.
Declare its actual operator in a private `0600` JSON file using the
`stellar-forge.buyer-runbook-operator.v1` format from the included
`buyer-runbook/WORKSPACE.md`. That preset records the receiver's actor, service,
public payer, Python executable, total and daily atomic limits, and either its
wallet environment-variable name or trusted signer-provider path.

```sh
install -d -m 700 "$STARFORGE_PRIVATE/acquisitions" "$STARFORGE_PRIVATE/acquisitions/buyer-configs"
npx --no-install starforge buyer-runbook workspace \
  --state "$STARFORGE_PRIVATE/acquisitions/workspace" \
  --configs "$STARFORGE_PRIVATE/acquisitions/buyer-configs" \
  --operator-settings "$STARFORGE_PRIVATE/acquisitions/local-operator.json" \
  --port 0
```

Choose **Receive merchant request** and open the original complete packet.
Review the body, headers, ticket expiry and actual discovery payment options;
choose the recipient, asset, network and atomic spending limits for this
request. **Save request review** and **Prepare local buyer** use the original
handoff importer and native operator initializer, including the Python spending
ledger. **Add to acquisition plan**, **Save and review draft**, and
**Initialize acquisition** retain the exact source configuration and body.
This preparation creates the local buying workspace. Execution uses its
existing native wallet, live terms, operator approval and payment lifecycle.

For a terminal-only initial import, use the same packet with the original buyer:

```sh
npx --no-install starforge buyer --import-operation \
  --file "$STARFORGE_PRIVATE/merchant-request.handoff.json" \
  --dir "$STARFORGE_PRIVATE/acquisitions/imported-request" --accept 0
npx --no-install starforge buyer \
  --review --config "$STARFORGE_PRIVATE/acquisitions/imported-request/review.json"
```

Choose `--accept` from the actual discovery list before importing. The import
directory must be new; use its emitted review configuration and the original
buyer workspace setup for subsequent native operation.

Stop the receiver and reopen it with the same original state path:

```sh
npx --no-install starforge buyer-runbook workspace \
  --state "$STARFORGE_PRIVATE/acquisitions/workspace" --port 0
```

Use the same absolute `STARFORGE_PRIVATE` value when opening a new terminal.
Its selected configuration directory and local operator preset are retained.
Keep the merchant and receiver's private files at their original paths outside
`node_modules` when updating the toolkit. An identical packet reopens the same
retained request; the saved acquisition preserves its initialized snapshots,
ledger and original operation identity.

## Sell selected Stellar RPC reads

The installed `jsonrpc` command prepares fixed, priced Stellar read operations
through the original SF30 seller, SF61 compiler, SF88 buyer and operations desk.
Each selected method becomes a `POST /stellar/METHOD` product. The merchant
chooses the methods, provider, data network and payment terms in one saved plan:

```sh
install -d -m 700 /private/stellar-rpc
npx --no-install starforge jsonrpc template > /private/stellar-rpc/plan.json
```

Replace the template's merchant origin, asset, recipient and every atomic price.
Review `dataNetwork` and `payment.network` separately. Keep only the intended
methods; the included original guide defines the supported transaction, event,
ledger and metadata contracts. `endpointEnv` names the private variable holding
the provider's complete HTTPS URL, including any API key in its path. Supply
that value through the service's existing private environment. The plan stores
the variable name. Header credentials and OAuth use the original upstream
declarations described in the included guide.

```sh
npx --no-install starforge jsonrpc inspect --plan /private/stellar-rpc/plan.json
npx --no-install starforge jsonrpc prepare --plan /private/stellar-rpc/plan.json \
  --out /private/stellar-rpc/prepared-v1
npx --no-install starforge jsonrpc diagnose \
  --plan /private/stellar-rpc/prepared-v1/plan.json
```

Inspection and preparation are offline. The new private package retains the
reviewed plan, original offers, OpenAPI, compiled seller and `RUN.md` commands.
Diagnosis reads the selected provider's network and health once each. Use its
current ledger window and actual transaction hashes or returned cursors for
history requests. Start with the existing native dependencies and facilitator:

```sh
npx --no-install starforge jsonrpc serve \
  --plan /private/stellar-rpc/prepared-v1/plan.json \
  --facilitator https://facilitator.merchant.example \
  --port 8423 --operations-port 8424 \
  --availability-dir /private/stellar-rpc/availability \
  --history-dir /private/stellar-rpc/history --state /private/stellar-rpc/delivery
```

The original seller verifies the data network before opening its local
listeners. Keep the existing merchant HTTPS ingress and private operations
listener. Original payment handling, bounded upstream transport, delivery
outbox, usage history and graceful shutdown remain one runtime. Retain the same
plan origin and separate state directories across restart; restart after a
provider credential rotation so the new connection is selected.

Save the actual method parameters as a private JSON object. For the template's
`getLatestLedger` product, that object is `{}`. Prepare the original buyer review:

```sh
npx --no-install starforge jsonrpc buyer \
  --package /private/stellar-rpc/prepared-v1 --method getLatestLedger \
  --body-file /private/stellar-rpc/request.json --intent-id rpc-ledger-001 \
  --out /private/stellar-rpc/buyer-review.json
npx --no-install starforge buyer --review --config /private/stellar-rpc/buyer-review.json
```

Continue through that buyer's original native workspace and approval workflow.
The successful response preserves the provider JSON-RPC envelope and exact
bytes, including large integers; method data is under `result`. Preserve the
same buyer intent when recovering its original delivery. A new page or purchase
uses a deliberately new intent.

Put startup's private `availabilityControl` URL in `SELLER_AVAILABILITY_URL`.
The existing `starforge availability status --url-env SELLER_AVAILABILITY_URL`
shows route IDs and the current revision. Its `pause` and `resume` commands take
the reviewed `--revision` and explicit `--route`; the private browser desk offers
the same controls. New requests for a paused product stop before payment, while
already admitted work drains. Saved pauses survive restart on Linux with the
original `flock` ownership.

The installed `sf30-seller-sdk/jsonrpc/README.md` contains the full method,
provider, request, recovery and embedding guide. `./seller/jsonrpc` exports
`startStellarRpcMerchant`; `./seller/jsonrpc/application` exports
`createStellarRpcApplication` for existing trusted hosts. The whole SF30/SF61/SF88
source and original `partners/getblock-stellar/product.mjs` request helper ship
together. This product uses the existing upstream and native dependencies.

## GetBlock Stellar merchant

The installed `getblock-stellar` command includes the complete original partner
product, application, CLI and guide. It prepares four selected priced operations:
`getTransaction`, `getTransactions`, `getEvents` and `getLedgerEntries`. These
return Stellar mainnet data; the merchant's payment network is a separate
explicit selection in its public plan. This is the maintained integration, with
the original SF61 compiler, SF30 native seller, SF82 releases and SF88 buyer.

Create a private parent for generated packages, and fill the original
plan template with the actual merchant origin, asset, recipient and every
selected atomic-unit price before inspecting or preparing it:

```sh
mkdir -m 700 /private/getblock
npx --no-install starforge getblock-stellar template > /private/getblock/plan.json
chmod 600 /private/getblock/plan.json
```

After editing the plan:

```sh
npx --no-install starforge getblock-stellar inspect --plan /private/getblock/plan.json
npx --no-install starforge getblock-stellar prepare \
  --plan /private/getblock/plan.json --out /private/getblock/stellar-reads-v1
```

The output directory must be new and its parent must have mode `0700`.
Preparation creates the actual original SF61 output in `compiled/`, public
OpenAPI/selections/bindings, a trusted handler entry and a package-specific
`RUN.md`. It makes no provider, facilitator, catalog or wallet request. Retain
the package and this immutable installed source: its generated handler imports
the original application module from this source location.

The plan stores only the selected endpoint environment-variable name, normally
`GETBLOCK_STELLAR_RPC_URL`. Supply its value through the existing operator
secret manager or private service environment. Use the exact Stellar mainnet
JSON-RPC endpoint selected in the GetBlock dashboard; the original application
retains the path token privately and keeps it out of public offers and buyer
artifacts. The original product guide documents its supported endpoint form.

Diagnosis is an explicit provider operation:

```sh
npx --no-install starforge getblock-stellar diagnose \
  --plan /private/getblock/stellar-reads-v1/plan.json
```

It calls `getNetwork`, then `getHealth` after the observed network matches
Stellar mainnet. Use the returned actual ledger window or a preceding result's
cursor for requests. OpenAPI input examples describe formats; they are not
current chain observations. Preparation, staging and buyer review do not run
diagnosis implicitly.

Use the generated `RUN.md` for the original seller or native operations/outbox
launcher. The installed original release store supports the same prepared
inputs:

```sh
npx --no-install starforge releases init --store /private/getblock/releases
npx --no-install starforge releases stage \
  --store /private/getblock/releases --id stellar-reads-v1 \
  --spec /private/getblock/stellar-reads-v1/openapi.json \
  --config /private/getblock/stellar-reads-v1/selections.json \
  --bindings /private/getblock/stellar-reads-v1/route-bindings.json \
  --handlers /private/getblock/stellar-reads-v1/handlers.mjs
npx --no-install starforge releases inspect \
  --store /private/getblock/releases --id stellar-reads-v1
npx --no-install starforge releases console \
  --store /private/getblock/releases --port 8425
```

The stage example retains the original challenge profile. Select the actual
`--facilitator` for native paid execution and install the existing native
dependencies described below. Activate using the store's current generation,
then operate the selected release from its original console or fleet. Changes
to prices or methods use a new prepared package and release. An existing process
retains its launch-time provider credential; stop and restart it after rotation.
Keep the complete transitive installed source alongside the native entry and
source inputs pinned by the release store.

Write actual parameters into a private JSON file and prepare their original
buyer review:

```sh
npx --no-install starforge getblock-stellar buyer \
  --package /private/getblock/stellar-reads-v1 --method getEvents \
  --body-file /private/getblock/events-request.json \
  --intent-id getblock-events-001 --out /private/getblock/events-review.json
npx --no-install starforge buyer \
  --review --config /private/getblock/events-review.json
```

The command validates the selected method's params object and passes its exact
body and original offer to SF88. Continue with the existing buyer workspace or
selected signer; the buyer still obtains the live challenge and retains its
original reservation, payment and recovery state. Each explicit next page is a
separate purchase using the actual returned cursor. Reconcile an uncertain
existing operation before creating another purchase for that request.

The installed `partners/getblock-stellar/README.md` describes all four method
contracts, admission, native response handling, credential rotation and complete
operator lifecycle. `./partners/getblock-stellar` exports the original
`prepareProduct` and request helpers; `./partners/getblock-stellar/application`
exports `createGetBlockApplication` for the same trusted host integration.
The component adds no new runtime dependency or payment engine.

## Cube report workspace

Open the browser workspace on the merchant's retained Cube member catalog:

```sh
npx --no-install starforge cube-workspace --state /private/cube-browser \
  --metadata /private/cube-meta.json --plan /private/merchant-plan.json
```

Omit `--plan` to compose a new merchant plan, or use the same `--state` alone to
reopen saved versions and exported packages after restart. The browser selects
actual Cube members, authors fixed reports and typed inputs, reviews every
complete payment option, and saves through the original onboarding compiler.
Atomic amounts stay exact strings.

The selected saved version can run its native backend read, export the runnable
merchant package and customer files, and prepare the original SF88 buyer review
for a chosen report and payment option. The operator URL remains on loopback.
Use `npx --no-install starforge cube-onboard` for the underlying capture, inspection and package
workflow. See [Cube workspace](../sf102-cube-paid-query-adapter/workspace/README.md)
for the full authoring and handoff flow.

## MongoDB report workspace

Use the original MongoDB driver to inspect collections, author fixed aggregation
reports, preserve BSON values and operate the merchant from one retained browser
workspace. The installed package exposes both the native command and browser:

```sh
npm install --ignore-scripts mongodb@7.7.0
npx --no-install starforge doctor --feature mongodb
npx --no-install starforge mongodb init --directory /private/mongodb-inputs
npx --no-install starforge mongodb-workspace \
  --state /private/mongodb-workspace \
  --source /private/mongodb-inputs/source.json \
  --plan /private/mongodb-inputs/merchant-plan.json
```

Edit the original source and plan for the merchant's database before opening the
workspace. The source names a URI environment variable, database and TLS policy.
Supply that variable through the existing host configuration; the browser retains
its name. Use a read-only database role. Node 22.16+ and Linux are required by the
native retained store; snapshot reads require a replica set or sharded MongoDB.

Open the complete loopback URL printed by the command. Inspect actual collection
metadata, sampled field types and indexes; define named fixed pipelines with
typed public inputs; review every original payment option; run a saved report;
download a complete merchant package; and operate the original seller and buyer
handoff. Int64, Decimal128, ObjectId, Date, missing fields and explicit null retain
their native meaning in canonical Extended JSON. Atomic prices remain strings.

Saving commits the whole source and merchant plan as one native revision.
Concurrent edits retain their original expected revision, and an operator can
reopen an older version and save it as a new head. Reopen later with only
`starforge mongodb-workspace --state /private/mongodb-workspace`.
Prepared packages and exact GET/POST buyer requests remain attached to that state.

The original application exports are `./seller/mongodb`, `/source`, `/prepare`,
`/onboarding`, `/workspace` and `/buyer`. They expose the same implementations used
by the CLI and browser. Full source, pipeline, package, buyer and operating guides
are included under `source/stellar/scf-starforge-20261009/sf30-seller-sdk/mongodb/`.
The optional driver pin is derived from that component's own `package.json`.

## Operate a retained Allium data product

The Allium commands package the original Explorer acquisition and the same
retained dataset, publisher and buyer workflow. Prepare the approved product
JSON using the included
[Allium operating guide](../partners/allium-explorer-pilot/workspace/OPERATING.md),
then create a new private workspace:

```sh
npx --no-install starforge allium-workspace create \
  --workspace /private/allium-product \
  --product /private/approved-allium-product.json --name "Allium Stellar data"
npx --no-install starforge allium-workspace serve \
  --workspace /private/allium-product --port 8447
```

Open the complete private URL printed by the command. Review product and
projection revisions, import the original saved Allium result or explicitly
start/collect its approved saved query, and explore the typed retained rows.
A native query uses the environment variable named by the product's
`apiKeyEnv`; imported results and local dataset operations work offline.

Select a completed acquisition and actual public merchant terms, publish its
original versioned dataset, and open the same publisher for source review and
original buyer preparation. The workspace owns its merchant and publisher
processes. Browser export stops them and retains the complete source,
product/acquisition history, versions and buyer records. After closing the
server, the equivalent offline handoff is:

```sh
npx --no-install starforge allium-workspace export \
  --workspace /private/allium-product --out /private/allium-product.json
npx --no-install starforge allium-workspace import \
  --workspace /private/reopened-allium-product --bundle /private/allium-product.json
npx --no-install starforge allium-workspace serve \
  --workspace /private/reopened-allium-product --port 8447
```

The new receiving directory opens stopped and retains the original source and
typed snapshots. `allium-explorer inspect/import/start/collect/status/recover`
exposes the underlying saved-query operator for terminal use. Application
imports use `./seller/allium`, `./seller/allium/workspace` and
`./seller/allium/workspace/server`.

## Native payment dependencies

For an actual payment-capable seller, install the native packages in the same
application directory:

```sh
npm install --ignore-scripts \
  @x402/core@2.28.0 @x402/stellar@2.28.0 @x402/extensions@2.28.0 \
  '@stellar/stellar-sdk@^16.3.0'
npx --no-install starforge doctor --native
npx --no-install starforge run --workspace ./merchant -- \
  --facilitator https://your-facilitator.example/facilitator
```

Replace the example payment identity in `seller.json` with your own verified
asset, recipient and exact atomic-unit prices before native operation. The
original `createNativeSellerServer` and configured facilitator own verification,
settlement, cancellation and response release. Existing request and response
limits apply unchanged.

The x402 pins are the original seller's accepted versions. The SDK peer range
matches the published dependency of
[`@x402/stellar@2.28.0`](https://registry.npmjs.org/@x402%2fstellar/2.28.0).
`doctor` checks local module resolution, Node, and Python availability; it neither
initializes a facilitator nor verifies a network transaction. The approved buyer
retains its original POSIX Python/TTY operator, private policy and journal,
trusted signer module, independent payer and chain-reconciliation requirements.

## Use all maintained commands

Arguments after a command go unchanged to its original entrypoint. Native
commands retain their own option validation, output, exit status and help. The
launcher forwards shutdown signals to the original child; it does not restart
or automatically retry a request.

| Command | Original workflow |
| --- | --- |
| `starforge seller` | SF30 JSON or application seller |
| `starforge upstream` | SF30 existing-API seller |
| `starforge jsonrpc` | Prepare, diagnose, sell and operate selected Stellar RPC reads with original buyer review |
| `starforge getblock-stellar` | Prepare a GetBlock Stellar read merchant, diagnose its selected provider and hand original releases/requests to seller and buyer |
| `starforge upstream-operation` | Issue, inspect and reconcile an original merchant operation ticket |
| `starforge operations` | SF30 seller plus live operations dashboard |
| `starforge dataset` | SF30 dataset API compilation |
| `starforge assets` | Inspect, package and catalog original immutable file products |
| `starforge postgres-workspace` | Existing database metadata to selected-query merchant package |
| `starforge postgres-publisher` | Review and publish complete query snapshots; keep the original data product current on a saved cadence |
| `starforge sheets-source` | Retain an actual Google cell response, inspect headers and prepare an explicit public projection |
| `starforge sheets-publisher` | Review and publish selected Sheet observations through the original retained dataset and buyer workflow |
| `starforge mysql` | Inspect actual MySQL/MariaDB metadata, preview approved queries and prepare or run a merchant |
| `starforge mysql-workspace` | Select database fields, review typed endpoints and payment terms, operate releases and export the customer client |
| `starforge mongodb` | Inspect native collections, prepare fixed BSON reports and operate the original MongoDB seller |
| `starforge mongodb-workspace` | Author, review, save and run MongoDB reports; export merchant packages and exact buyer requests |
| `starforge duckdb-workspace` / `duckdb-workbench` | One retained workspace for actual DuckDB/Parquet queries, merchant packages and operations |
| `starforge duckdb` / `duckdb-inspect` / `duckdb-prepare` | Launch or inspect the original local source; prepare, verify and reopen its merchant package |
| `starforge openapi` | SF61 OpenAPI offer and service configuration |
| `starforge openapi-workspace` | Select an API contract, prepare the merchant and use its native operator workflow |
| `starforge pilot` | SF96 original SF82 seller pilot, dashboard and SF93 support composition |
| `starforge buyer` | SF88 discovery, saved-source preparation, offline review and approved execution |
| `starforge commerce` | Persistent native merchant, operations and selected buyer session |
| `starforge merchant-mcp` | MCP staging, comparison, activation, seller lifecycle and customer SDK export through the original release system |
| `starforge mcp-native` | Initialize and operate the original native buyer MCP workspace |
| `starforge mcp-buyer` | Run the original private HTTP buyer with its retained quote and result workspace |
| `starforge mcp-results` | List, read, export or locally recover complete original MCP results |
| `starforge mcp-data` | Serve existing prepared SQLite, PostgreSQL, DuckDB or ClickHouse data products as native paid MCP tools |
| `starforge mcp-stdio` / `mcp-client-config` | Run and register that buyer in an existing local MCP host |
| `starforge merchant-mcp-stdio` / `merchant-mcp-client-config` | Run and register original merchant tools in an existing local MCP host |
| `starforge commerce-setup` | Prepare exact merchant requests and one shared native buyer workspace |
| `starforge commerce-console` | Browser workspace for prepared requests, execution and delivered resources |
| `starforge inbox` | Original durable buyer requests, outcomes and recovery |
| `starforge native-signer` | SF103 native buyer configuration, inspection and signer loading check |
| `starforge facilitator` | Original native Stellar facilitator or self-facilitated seller |
| `starforge capture` | SF85 original single HTTP 402 capture |
| `starforge import-headers` | SF85 original operator HTTP header-file importer |
| `starforge handoff` | SF96 captured challenge to original buyer review files |
| `starforge support` | SF93 private seller and operations support export |
| `starforge support-watch` | Original incident collection, acknowledgment, notification delivery and support-case handoff |
| `starforge support-console` | Retained merchant cases, runtime follow-up and original native reconciliation |
| `starforge client` | Export a standalone JavaScript client, TypeScript declarations and original OpenAPI |
| `starforge releases` | Stage, compare, select, run and roll back seller configurations; local operator console |
| `starforge merchant-host` | Generate original Caddy/systemd merchant services, inspect installed operation and run encrypted maintenance/cutover |
| `starforge buyer-inbox` | Prepare, review, execute and report retained original buyer jobs |
| `starforge buyer-node` | Review, execute and recover a generated-client purchase through the original Node buyer |
| `starforge dataset-delivery` | Export an original completed buyer job as a retained dataset delivery |
| `starforge merchant` / `delivery` | Original native seller with its retained fulfillment journal and event delivery |
| `starforge delivery-workspace` | Configure receiver revisions, operate the original worker and recover selected exhausted events |
| `starforge merchant-desk` | Private paid-file order inventory, enrollment, handoffs, access controls and support |
| `starforge paid-file-checkout` / `paid-file-purchase` | Original merchant file checkout and approved customer purchase/download |
| `starforge postgres-init` / `postgres-inspect` / `postgres` | Prepare a PostgreSQL source, inspect named queries and launch its seller/dashboard |
| `starforge sqlite-init` / `sqlite-inspect` | Prepare and inspect an original SQLite named-query source |
| `starforge dataset-refresh` | Publish, retain and activate CSV dataset versions while readers finish their pages |
| `starforge allium-explorer` | Inspect an approved Allium product and import, run, collect or recover its original saved query |
| `starforge allium-workspace` | Review retained Allium products/results, publish a versioned merchant, prepare its buyer and reopen a complete workspace |
| `starforge dataset-publisher` | Upload and publish CSV versions, select the actual offer and export original buyer preparation |
| `starforge buyer-dataset` | Acquire, pause, resume and deliver all pages of the selected original dataset |
| `starforge buyer-dataset-workspace` | Review original offers, operate dataset acquisitions, open retained files and use the analysis workspace |
| `starforge dataset-workspace` | Preview, refresh and select the retained dataset in its private browser workspace |
| `starforge catalog-serve` / `catalog` | Host live seller discovery and operate its existing single writer |
| `starforge catalog-withdrawal` | Prepare, sign and apply an existing seller withdrawal |
| `starforge catalog-workspace` | Review declarations, signed changes and retained outcomes with the existing catalog writer |
| `starforge checkout` / `purchase` | Enroll a private merchant file, prepare its order-bound purchase and retrieve delivery |
| `starforge buyer-object` | Prepare an object acquisition, retain chunks, resume and assemble the complete file |
| `starforge buyer-runbook` | Arrange revisioned acquisition plans, operate the original buyer and retain delivered resources |
| `starforge buyer-object-workspace` | Select and review original file acquisitions, operate retained parts and download the assembled file |
| `starforge merchant-fleet` / `merchant-fleet-control` | Serve multiple merchants and prepare, activate or roll back their routing |
| `starforge merchant-fleet-workspace` | Review serving and proposed fleet configurations in a private browser |
| `starforge fleet-release` | Stage and operate original seller releases with managed fleet rollout, draining and rollback |
| `starforge revenue-workspace` / `revenue-report` | Review pricing, original merchant traffic and the existing native journal |
| `starforge merchant-accounting` / `merchant-accounting-workspace` | Reconcile original settlement records, retain ledgers and review imports, comparisons and exceptions |
| `starforge merchant-accounting-pricing` | Import a saved original pricing report as validated accounting terms |
| `starforge merchant-accounting-recovery` | Review and retain an original completed purchase, verification and delivered response |
| `starforge s3` | Inspect selected object-store resources and export an original merchant configuration |
| `starforge python-merchant` | Inspect, initialize and serve a Python merchant through the original runtime |
| `starforge python-workspace` | Edit retained Python source revisions, run explicit private previews and operate original releases/customer handoff |
| `starforge availability` | Inspect, pause and resume selected routes through the running seller's original control |
| `starforge cube-onboarding` | Capture Cube metadata, prepare reviewed reports and export/run the original merchant package |
| `starforge graphql-onboarding` / `graphql-merchant` | Prepare approved GraphQL queries and run their original paid seller |
| `starforge graphql-workspace` | Review schemas, prepare query packages and operate the original merchant in its private browser |
| `starforge graphql-deployment` | Prepare, inspect and stage an original GraphQL merchant or generate its existing Linux host installation |
| `starforge woo-seller` / `woo-buyer` | Connect an existing WooCommerce product/order to original merchant and buyer checkout |
| `starforge woo-operator` | Retain native chain review, release the selected Woo order, recover and export |

For example, review an existing original buyer configuration without signing:

```sh
npx --no-install starforge buyer --review --config /absolute/private/operator.json
npx --no-install starforge source
```

For an original SF85 imported capture, `starforge handoff` also requires
`--headers-file /absolute/private/original.headers`. It retains that file and
verifies the same response through the original SF85 parser. The resulting
bundle goes directly to `starforge buyer --review`; import time remains separate
from the unknown HTTP capture time. See the original
[SF96 operator-header journey](../sf96-merchant-challenge-handoff/README.md).

### Prepare a merchant and its buyer workspace

Use `commerce-setup` with the merchant's existing seller and native facilitator
configurations, the operator's public testnet account and explicit request
selections. The bundled
`source/stellar/scf-starforge-20261009/sf66-demo-launcher/OPERATOR.md` defines the
complete `stellar-forge.commerce-setup.v1` input. Each purchase selects its real
route, ordered payment alternative, stable intent, method, path/query values and
private body file when required. The operator supplies total and daily atomic
budgets and the existing wallet environment-variable name or signer provider.

```sh
npx --no-install starforge commerce-setup review \
  --config /private/setup.json --directory /private/new-commerce
npx --no-install starforge commerce-setup prepare \
  --config /private/setup.json --directory /private/new-commerce
npx --no-install starforge commerce-setup inspect --directory /private/new-commerce
npx --no-install starforge buyer --diagnose-workspace \
  --dir /private/new-commerce/operator
npx --no-install starforge commerce-console start \
  --directory /private/new-commerce/session --port 8426
```

Review shows the exact original offers and requests. Preparation creates one
private SF88 workspace with its shared SF36 ledger and limits, then binds all
selected requests to the existing commerce inbox. It supports the original six
HTTP methods and preserves body bytes. The new destination contains `operator/`
and `session/`; start the commerce CLI or console against **`session/`**.
Preparation opens no merchant listener or wallet and does not approve a payment.
Load the configured buyer and facilitator key variables through the operator's
normal private environment before starting the native session. This preparation
workflow uses the original `stellar:testnet` configuration.

To keep an existing configured merchant and its selected buyer requests in one
foreground operator session, use the
[commerce operator guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf66-demo-launcher/COMMERCE.md):

```sh
npx --no-install starforge commerce init --plan /private/commerce-plan.json --directory /private/new-session
npx --no-install starforge commerce start --directory /private/new-session
```

The same original native facilitator, seller, operations observer and buyer
inbox run from the package. `review`, `signer`, `execute`, `cancel` and `recover`
operate on explicit stable intent IDs. Terminal approval remains in the original
SF88/SF81 workflow. `quit` drains the services; the next start reopens retained
requests and results. No repository checkout is required on the operator host.

Use the browser workspace with the same prepared session:

```sh
npx --no-install starforge commerce-console start \
  --directory /private/new-session --port 8426
```

Open its printed local operator URL. Select a request, inspect its exact terms,
review it, and start execution. The operator answers any payment approval in the
same terminal. The workspace shows retained results, cancellation and recovery,
and offers preview/download when the buyer has saved a response. Stop session
drains the owned runtime and leaves recorded outcomes available. Native signer
diagnostics remain available through the commerce terminal's `signer INTENT`
command. The packaged `source/stellar/scf-starforge-20261009/sf66-demo-launcher/COMMERCE_CONSOLE.md`
describes the complete browser workflow and application API.

The same session also supports the original paid-file checkout and Python
merchant applications. In an existing commerce plan, `seller.checkoutConfig`
selects the original checkout and each buyer's optional `paidFile` identifies
its frozen handoff, separate product destination and claim-token variable.
The browser and terminal `retrieve INTENT` action use the original entitled-file
retrieval, while the immediate paid HTTP response remains a separate result.
The installed `sf66-demo-launcher/COMMERCE_PAID_FILES.md` guide covers preparation,
review, retrieval, verified preview/download and local-file recovery.

For a Python application, select `seller.python` in the commerce plan using the
same declaration accepted by `starforge python-merchant`. Initialization freezes
the declaration, derived seller terms and application digest; native startup
opens the original worker pool, and shutdown reports its actual cleanup result.
Use the existing `commerce init`, `commerce inspect` and `commerce start` commands,
or `commerce-console start` for the browser. The installed
`sf66-demo-launcher/PYTHON_COMMERCE.md` guide covers application lifecycle,
configuration, request selection and reopening. Both guides are under the
package's `source/stellar/scf-starforge-20261009` directory.

`source` prints the exact source commit, original Git object and SHA-256 for each
packaged file, component inventory, archive version and optional dependency
declarations. It does not infer a grant submission, merchant onboarding, customer
payment, or settlement from installation or an HTTP response.

## Operate paid-file orders

The original SF101 merchant desk turns the existing checkout and access tools
into one local operator workflow. It lists enrolled orders and their current
delivery/access state, enrolls a selected approved file, exports or recovers the
same customer handoff, checks the original file, and performs revision-checked
access changes with the original reason and operation history. It uses the
merchant's existing SQLite store and checkout configuration.

Use Python 3.11 or newer on the merchant's existing POSIX host. Prepare the real
checkout configuration using the
[original paid-file guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf101-merchant-receiver/CHECKOUT.md).
Keep the approved files in a separate private directory. Files must already be
regular private files, at most 32 MiB. Provision the merchant's existing claim
token in its original environment; only its variable name is passed below.

```sh
npx --no-install starforge merchant-desk init \
  --dir /private/merchant/order-desk \
  --config /private/merchant/checkout.json \
  --files /private/merchant/approved-files \
  --claim-env SF101_CLAIM_TOKEN --actor merchant-operations
npx --no-install starforge merchant-desk inspect --workspace /private/merchant/order-desk
npx --no-install starforge merchant-desk start --workspace /private/merchant/order-desk
```

Open the printed private URL. Initialize the original store in the desk when
needed, select a file and order reference, then export the native buyer handoff.
An interrupted export can recover the enrolled order without enrolling or
charging again. Access changes include suspend, resume, expiry and claim-token
rotation; the original access implementation checks the displayed revision and
records the operation. Claim-token values never appear in the browser or handoff.

`init` creates only private launch settings and an export directory. It requires
a new workspace and preserves existing merchant state. `start` reopens that same
workspace. Files, exports, order state and delivery outbox have separate roots.
The desk can run beside the merchant's existing checkout and delivery processes;
it does not start a buyer, signer or payment. See the
[merchant desk guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf101-merchant-receiver/desk/README.md)
for the complete enrollment, recovery and customer handoff workflow.

For the original commands after handoff:

```sh
npx --no-install starforge paid-file-checkout serve --config /private/merchant/checkout.json
npx --no-install starforge paid-file-purchase inspect --handoff /private/customer/order.json
```

The original checkout guide supplies the native facilitator, authenticated SF98
delivery and existing receiver configuration for actual payment and file release.
The desk's order view does not infer settlement or payment from enrollment.

### Resume and recover the entitled file

Keep the customer's original handoff, selected output path and current private
claim-token environment variable. For retained interruption recovery, use Linux
with the `flock` utility available. The destination's parent must already exist
as the customer's private directory. The installed original command is:

```sh
npx --no-install starforge paid-file-purchase retrieve \
  --handoff /private/customer/order.json \
  --out /private/customer/downloads/report.bin \
  --claim-env SF101_CLAIM_TOKEN --timeout-ms 30000
```

After a timeout, lost connection, Ctrl-C or process loss, repeat that **same
command with the same handoff and destination**. The original SF101 transfer
record retains the original writer's private prefix. The matching receiver
returns the remaining range, and the original writer verifies the complete
file's approved size and SHA-256 before publishing it. A completed local file
is verified with zero merchant requests. Each new request uses the merchant's
current entitlement, access deadline, suspension state and claim token.

Read retained state locally with:

```sh
npx --no-install starforge paid-file-purchase transfer \
  --handoff /private/customer/order.json \
  --out /private/customer/downloads/report.bin
```

The result includes status, retained and expected bytes, attempt count, whether
the saved prefix can resume, and the original record location. The completed
file has its original `report.bin.sf101.json` receipt; transfer recovery uses
`report.bin.sf101-transfer.json` beside it. Keep those records with the selected
destination so reopening can recover the original generation. A live process
keeps its file lock; wait for that download to finish or stop before another
process uses the same output.

For a deliberate fresh start after reviewing a rejected or interrupted prefix:

```sh
npx --no-install starforge paid-file-purchase reset-transfer \
  --handoff /private/customer/order.json \
  --out /private/customer/downloads/report.bin
```

That local action clears the original unfinished download. A later `retrieve`
performs the fresh request for the same existing entitlement. Ordinary resume
needs only the original `retrieve` command. If the merchant denies a retry,
keep the retained prefix while its operator opens the existing `merchant-desk`,
inspects the exact order, and checks access and **File health**. Restore the
enrolled source when it changed, or configure the current claim token after a
rotation, then repeat the customer's original retrieval.

The original `commerce-console` provides the same recovery in **Purchased
file**: retained byte count, **Resume download**, completed-partial local
finish, and **Download progress and recovery**. **Discard retained download**
clears an idle partial through the original transfer API. The foreground
`commerce` console has `status`, `retrieve INTENT`, and `reset-transfer INTENT`.
Both interfaces bind the original frozen handoff and saved destination.
Reopen the same commerce session after loading a changed claim-token variable.

Applications use the existing public purchase exports:

```js
import {
  retrieveFile, inspectFileTransfer, resetFileTransfer,
} from '@tokenjunkielabs/starforge-merchant/buyer/paid-file';

const state = await inspectFileTransfer({handoff, destination});
const result = await retrieveFile({handoff, destination, token, timeoutMs:30000});
```

`@tokenjunkielabs/starforge-merchant/buyer/purchase` resolves to that same
original module. The maintained whole SF101 component includes
`resumable-transfer.mjs`, `receiver.py`, `access.py`, `RESUMABLE_TRANSFERS.md`
and `TRANSFER_SERVER.md`; the existing aliases forward all original arguments.
For the merchant upgrade, install the matching receiver and access source,
restart the original receiver with its retained state and secret, and preserve
`Range`, `If-Match`, `If-Range`, `ETag`, `Content-Range`, `Content-Length` and
identity bytes through its HTTPS proxy. Its health response identifies
`stellar-forge.sf101.byte-ranges.v1`. The bundled SF101 guides give the exact
server protocol and buyer state behavior; the original
`sf66-demo-launcher/COMMERCE_PAID_FILES.md` covers the complete browser workflow.


The matching [Python buyer guide](../sf88-operator-buyer-cli/python/README.md)
provides the same retained download state and reset operations for the existing
Python SDK and CLI. The joined source changes are the
[original receiver and buyer transfer implementation](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1103)
and [original Python consumer integration](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1118).

## Operate a multi-resource buyer runbook

The installed runbook combines selected original SF88 configurations into one
private acquisition. Keep the complete configurations in a dedicated private
directory on the existing operator host, preserving their native policy, ledger,
request-body, evidence and signer references. Each selected operation retains its
own stable native intent ID. The state directory's parent and configuration
directory must already exist at canonical absolute paths; private directories
use `0700` on POSIX systems.

Start the workspace from the controlling terminal used for native buyer approval:

```sh
npx --no-install starforge buyer-runbook workspace \
  --state /private/acquisitions/workspace \
  --configs /private/acquisitions/buyer-configs \
  --port 8460
```

Open the printed loopback URL. Use **New acquisition plan** to select and order
1–64 original configurations, assign operation IDs and optional saved filenames,
then **Save and review draft**. Each saved revision retains the exact native
request and terms, body hash and per-network/asset totals. **Initialize
acquisition** freezes the reviewed plan and copies its original private inputs.
If an input changes after review, save a new draft revision before initializing.

**Execute untouched operations** runs the original native buyer serially. Continue
its approval in the launching terminal. The workspace displays progress, original
outcomes and delivered files. **Cancel current execution** drains the current
owned native attempt and stops launching further work. **Recover retained
output** imports the original saved result. The acquisition preserves earlier
attempts when resumed. Saved resources, current state and the original HTML
report are downloadable from the same page.

Reopen using the same state directory; its configuration directory is retained.
An existing original runbook can also be registered in that workspace:

```sh
npx --no-install starforge buyer-runbook workspace \
  --state /private/acquisitions/workspace \
  --run /private/acquisitions/earlier-run
```

The registered run remains at its original path and stays available on later
restarts. Original terminal operations remain available through
`starforge buyer-runbook init`, `status`, `execute`, `recover` and `unlock`.
`starforge buyer-runbook --help` describes their exact options. Keep the private
state and original native configuration outside the installed software so
upgrading the package reopens the same acquisitions.

Applications can import the original runbook API from
`@tokenjunkielabs/starforge-merchant/buyer/runbook` and
`startRunbookWorkspace` from
`@tokenjunkielabs/starforge-merchant/buyer/runbook-workspace`. The workspace
accepts `{directory, configsDirectory, runs, port}` and returns
`{url, server, model, close}`. The packaged
`source/stellar/scf-starforge-20261009/buyer-runbook/WORKSPACE.md` describes the
complete native workflow and lifecycle. Its model, server and all browser assets
are included at their original relative paths.

## Run a merchant-issued operation

The installed merchant issuer is `starforge upstream-operation`. Its `issue`,
`status` and `recover` operations use the existing upstream binding and private
merchant operation store. For example, with the merchant's actual reviewed
request description, binding, subject, stable operation ID and expiry:

```sh
npx --no-install starforge upstream-operation issue \
  --upstreams /private/merchant/upstreams.json --binding createOrder \
  --request /private/merchant/issued-request.json \
  --id "$OPERATION_ID" --subject "$CUSTOMER_ID" --expires "$EXPIRY_ISO" \
  --out /private/merchant/order-ticket.json
```

The issuer's input contains the original request description; the customer's
body file contains just the request body. Deliver the private ticket through the
merchant's authenticated customer channel. Keep the received ticket and body in
the buyer's private directory, then select the exact saved offer and prepare its
request from the installed application:

```sh
chmod 600 /private/order-ticket.json /private/order-body.json
npx --no-install starforge buyer --prepare \
  --discovery /private/merchant-offers.json --row 0 --accept 0 \
  --intent-id merchant-order-17 --url https://merchant.example/orders \
  --method POST --body-file /private/order-body.json \
  --content-type application/json --ticket-file /private/order-ticket.json \
  --out /private/order-review.json
npx --no-install starforge buyer --review --config /private/order-review.json
npx --no-install starforge buyer --init-workspace \
  --config /private/order-review.json --dir /private/order-operator \
  --actor owner-operator --service merchant-orders \
  --payer "$BUYER_PUBLIC_ACCOUNT" --python /usr/bin/python3 \
  --secret-env SCF_BUYER_SECRET
npx --no-install starforge buyer --review-workspace --dir /private/order-operator
npx --no-install starforge inbox init --root /private/orders-inbox
npx --no-install starforge inbox enqueue --root /private/orders-inbox \
  --config /private/order-operator/operator.json
npx --no-install starforge inbox show --root /private/orders-inbox \
  --intent merchant-order-17
npx --no-install starforge inbox execute --root /private/orders-inbox \
  --intent merchant-order-17 --workspace /private/order-operator
```

Replace the example URL, offer indexes, intent and public account with the
operator's selected inputs. Preserve the issued method, URL/query, exact body
and ordinary headers. If this operator uses the original explicit HTTPS CONNECT
transport, add `--https-proxy-env HTTPS_PROXY` to `buyer --init-workspace` and
provide that variable in its private runtime environment. The original
initializer also accepts explicit aggregate spending limits and signer providers.

The workspace and inbox copy the original ticket privately; review shows its
safe metadata. Execution uses the original approval, shared budget and buyer
transport. Reopening the inbox preserves the attempted intent, outcome and
recovery history. The packaged `sf88-operator-buyer-cli/OPERATION_TICKETS.md`,
`QUEUE.md` and `FINALIZATION.md` describe the complete lifecycle. Prefix their
buyer and queue commands with `starforge buyer` and `starforge inbox` respectively;
the original merchant issuer guide uses `starforge upstream-operation`.

## Publish a changing dataset

`dataset-refresh` forwards the maintained versioned CSV service. Initialize it
from the merchant's existing dataset and payment declarations:

```sh
npx --no-install starforge dataset-refresh init \
  --state /private/dataset-state --dataset /private/inventory/dataset.json
npx --no-install starforge dataset-refresh configure \
  --state /private/dataset-state --payment /private/inventory/payment.json \
  --origin https://your-api.example --path /data --out /private/inventory/seller.json
npx --no-install starforge dataset-refresh serve \
  --state /private/dataset-state --seller /private/inventory/seller.json \
  --port 8423 --control-transport loopback
```

The operator can `refresh`, `activate`, `status` and `collect` through the same
command. Use the snapshot and revision from the current status when changing the
selection. Existing cursors finish against their retained version while new
queries use the new selection. The private operator control stays separate from
the public API. The package includes the service, version store and its complete
`source/stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/README.md`
with retention, parsed-cache limits and existing facilitator options.

Open the existing dataset workspace against that same retained store:

```sh
npx --no-install starforge dataset-workspace --state /private/dataset-state \
  --resource https://your-api.example/data --catalog /private/catalog --port 8430
```

Use the seller's exact compiled resource URL. Omit `--catalog` when no local
catalog is configured. The browser uses the original dataset control for schema,
typed previews, current selection, refresh and deliberate rollback. Retained
query selection and catalog status come from the same producer. Its original
`--dataset FILE` mode remains available for a file-backed workspace; the new
command forwards both modes unchanged.

### Publish a selection and acquire its complete dataset

The original publishing workspace adds CSV upload, retained-version inspection,
revision-checked publication and buyer configuration export to that running
versioned seller:

```sh
npx --no-install starforge dataset-publisher --state /private/dataset-state \
  --seller http://127.0.0.1:8423 --resource https://your-api.example/data --port 8431
```

To choose a retained snapshot before acquisition, configure the original seller
with its `--snapshot-selection` option. In the workspace, inspect the selected
version and typed query, load its actual offer, choose the payment alternative
and download the original buyer configuration. Review it and initialize the
existing private buyer workspace with the operator's actual payer, signer,
Python runtime and total/daily budgets. Then use that workspace for acquisition:

```sh
npx --no-install starforge buyer-dataset init \
  --session /private/acquisitions/inventory --workspace /private/dataset-buyer \
  --max-pages 20 --max-total-atomic 20000
npx --no-install starforge buyer-dataset run --session /private/acquisitions/inventory
npx --no-install starforge buyer-dataset deliver \
  --session /private/acquisitions/inventory --out /private/deliveries/inventory
```

The example limits are operator choices in the selected asset's atomic units.
Every new page uses the original review, approval, budget and execution path.
Completed pages remain available for resume and the original SF100 CSV/JSONL
delivery. `status` and `recover` inspect retained outcomes through the same
command. The packaged `sf30-seller-sdk/dataset-refresh/WORKSPACE.md` and
`sf88-operator-buyer-cli/DATASETS.md` contain the full original configuration,
publication, acquisition and recovery flow. The `./seller/dataset-publisher`
and `./buyer/dataset-acquisition` imports expose those original APIs.

### Receive datasets in the browser

The dataset customer workspace connects the original acquisition and data-room
commands to a local browser. Use the original private buyer operator preset
described in the bundled
[dataset customer guide](../sf88-operator-buyer-cli/dataset-workspace/README.md).
The preset supplies the payer, signer configuration, Python runtime and
total/daily atomic ceilings. Launch the same maintained source with:

```sh
npx --no-install starforge buyer-dataset-workspace \
  --state /private/customer-datasets \
  --operator-settings /private/dataset-operator.json \
  --analysis-python /absolute/path/to/python3 \
  --analysis-checkout "$PWD/node_modules/@tokenjunkielabs/starforge-merchant/source" \
  --analysis-directory /private/customer-analysis \
  --port 8439
```

Open the private local URL, upload the merchant's original offer JSON, choose
its dataset query and review the exact terms and page/row/spend limits. Create
the native acquisition, then continue it through the original terminal purchase
approval. Progress, stopped-page recovery and purchase continuation use that
same native session.

After completion, open the original SF100 data room to preview typed rows and
download its retained JSONL, CSV, review and manifest files. **Open analysis
workspace** registers that exact completed session and room with the existing
Python workspace before starting its server. Import the original delivery there
to select editions, run saved SQL and publish the maintained reports. The
launcher stops only its own analysis server before changing the registered
source; it does not open a second owner against another live database.

An existing completed acquisition can be attached with `--profile` using the
guide's session/room profile. Restart with the same `--state` to retain reviews,
acquisitions, delivered files and browser operation history. Keep the customer
and analysis directories outside the installed package during upgrades. The
three analysis options are optional as a group; file delivery works without
them. The `./buyer/dataset-workspace` public import exposes
`startDatasetWorkspace` from this same original server.

## Run live seller discovery

The package also includes the catalog operator and its existing catalog,
identity, trust, lifecycle, admission and withdrawal modules. Start it with the
operator's current seller policy, using an existing store or explicitly creating
an empty one:

```sh
npx --no-install starforge catalog-serve \
  --directory /private/catalog --policy /private/seller-policy.json \
  --port 8787 --control loopback --create-empty
```

In another terminal, `starforge catalog status --directory /private/catalog`
and `starforge catalog list --directory /private/catalog` read that live writer.
Its `admit`, `prepare-withdrawal` and `apply-withdrawal` operations preserve the
existing seller identities, signatures and sequence checks. The public service
serves discovery; local mutations use the private operator control. Seller-side
withdrawal signing is exposed by `starforge catalog-withdrawal --help`. Keep the
policy and durable store in the operator's private workspace through package
updates. The SF60 and SF95 guides are included with their source.

### Operate discovery in the browser

Attach the original catalog workspace to the already-running catalog writer:

```sh
npx --no-install starforge catalog-workspace \
  --directory /private/catalog --state /private/catalog-workspace \
  --launch-file /private/catalog-workspace-launch.txt
```

Catalog state and workspace state must be separate private directories. Open
the original URL from the new private launch file. The workspace browses the
same discovery, compares exact signed declarations, submits reviewed changes
through its existing single writer, and reopens retained operations and
outcomes. The packaged `sf60-durable-catalog-transaction/WORKSPACE.md` covers
signature inputs, withdrawal, recovery and operator lifecycle. The catalog's
configured seller keys and original admission rules remain authoritative.

## Deliver an approved merchant file

`checkout` and `purchase` expose the existing merchant receiver and buyer
handoff. They use the same Python application, order store, SF88 buyer and SF98
fulfillment delivery already included in this package. With the merchant's
existing private checkout configuration:

```sh
npx --no-install starforge checkout inspect --config /private/merchant/checkout.json
npx --no-install starforge checkout init --config /private/merchant/checkout.json
```

The merchant then enrolls its actual file and approved order, creates the order
handoff, and serves checkout with its configured facilitator. The customer uses
`purchase inspect`, `purchase prepare`, the existing buyer inbox with its
operator workspace, and `purchase retrieve`. The order reference remains bound
to the approved request; the separate private claim token stays with its
configured recipient. Delivery uses the existing enrolled file and entitlement.

Follow the bundled `source/stellar/scf-starforge-20261009/sf101-merchant-receiver/CHECKOUT.md`
for the complete configuration, enrollment, buyer, delivery-worker and retrieval
commands. From the installed application's directory, translate the guide's
source command prefixes as follows and retain every operation and argument:

| Source entrypoint | Installed command |
| --- | --- |
| `sf101-merchant-receiver/checkout.mjs` | `npx --no-install starforge checkout` |
| `sf101-merchant-receiver/purchase.mjs` | `npx --no-install starforge purchase` |
| `sf88-operator-buyer-cli/cli.mjs` | `npx --no-install starforge buyer` |
| `sf88-operator-buyer-cli/queue-cli.mjs` | `npx --no-install starforge buyer-inbox` |
| `sf98-merchant-delivery/deliver.mjs` | `npx --no-install starforge delivery` |

The receiver's Python commands use its installed source path:

```sh
STARFORGE_SOURCE="$PWD/node_modules/@tokenjunkielabs/starforge-merchant/source"
python3 "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf101-merchant-receiver/receiver.py" \
  serve --state /private/merchant/sf101 --port 8472
```

Use that same Python prefix for the guide's `receipt` command. The receiver and
checkout application use the Python standard library. The guide's final
contributor journey runs from a source checkout; the installed package contains
the operating workflow and excludes that development exercise. Applications
embedding `./merchant/checkout` can read and compile its configuration through
`./merchant/checkout/config`. Node native payment dependencies and the operator's
actual settings are supplied as described above.

### Receive and buy merchant files

The installed Object Buyer receives the merchant's public `objects.json` and
offers, prepares the customer's private native buyer, and operates the resulting
whole-file or chunked acquisition. Obtain `s3/objects.json` and `offers.json`
from the same selected S3 merchant release. The original seller's saved
`/_seller/offers` array and native saved-discovery envelopes are also accepted.

Use Node 22.16+, Python 3.11+ and util-linux `flock` on the operator's Linux host.
Install the original [native payment dependencies](#native-payment-dependencies)
in the same application directory. Declare the actual receiver in a private
`0600` file using the existing `stellar-forge.buyer-runbook-operator.v1` preset
from the installed
`source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-workspace/README.md`.
It records the actor, service, public payer, absolute Python executable, total
and daily atomic limits, and wallet environment name or trusted signer-provider
path. The preset can also retain the original RPC and managed-proxy settings.
Keep this file and the buyer state outside `node_modules`.

Create the private parent in the installed application:

```sh
STARFORGE_OBJECT_PRIVATE="$PWD/private-objects"
install -d -m 700 "$STARFORGE_OBJECT_PRIVATE"
```

Save the completed preset as `private-objects/operator.json` with mode `0600`,
then launch the existing command:

```sh
npx --no-install starforge buyer-object-workspace \
  --state "$STARFORGE_OBJECT_PRIVATE/workspace" \
  --operator-settings "$STARFORGE_OBJECT_PRIVATE/operator.json" --port 8438
```

Open the complete printed loopback URL and keep the terminal open. Choose
**New → Receive a merchant object**, load the two public merchant files, and
select the object and its exact offer. Review the recipient, network, asset,
per-request maximum, complete request count, snapshot and total/daily limits.
The selected limits must fit the receiver's preset.

| Merchant delivery mode | Original request and saved result |
| --- | --- |
| Whole file, including an empty file | One exact GET with no range query; HTTP 200 without Content-Range; complete expected length, selected snapshot and SHA-256 |
| Chunked file | Exact `offset`/`length` requests within the merchant's limit; retained contiguous ranges and original whole-object assembly |

**Review received download** binds the original merchant files and local preset.
**Create buyer and download** prepares the original operator, spending ledger,
native request configurations and saved session. **Start download** then runs
that session with the original terminal approval, live quote and payment
workflow. Load the selected wallet or signer through the operator's normal
private process environment before starting it. Whole-file mode uses the
merchant's original whole-response limit; an empty file still has one reviewed
request and its selected price.

After native completion, use **Save whole file** or **Assemble file**, then
**Download completed file**. The original response and final file retain their
length, snapshot and digest checks. **Purchase records** shows each original
request's financial status. **Finalize original purchases** operates those
existing attempts; **Download all purchase records** streams their native
accounting and receipts. Delivery and financial status remain separately visible.

Stop the launcher with Ctrl+C and reopen the same state from the installed
application, including after a package upgrade:

```sh
npx --no-install starforge buyer-object-workspace \
  --state "$PWD/private-objects/workspace" --port 8438
```

The saved preset path, received files, prepared products, completed parts,
original requests and purchase records reopen in place. Use the new printed
browser URL after each launch. A completed file can be downloaded again from its
retained assembly; its purchase records remain available if the delivered file
has moved. A changed preset requires a fresh review for new preparation.

For an already configured native buyer, the same command accepts
`--profile /absolute/private/object-products.json` with the original product
profile documented in `object-workspace/README.md`. Terminal acquisition,
resume, assembly and exports remain available through
`npx --no-install starforge buyer-object --help` and the installed `OBJECTS.md`.
Applications use the maintained `./buyer/object`, `./buyer/object-description`
and `./buyer/object-workspace` exports.

## Operate merchant delivery in the browser

Use the merchant's existing SF98 outbox and a separate private workspace for
receiver profiles and operator controls. Set the shared receiver secret in the
process environment before launch; each profile stores its environment-variable
name. The original Linux delivery lease requires `flock` from util-linux, with
Node 22.16 or later. The parent directories must already exist.

```sh
npx --no-install starforge delivery-workspace serve \
  --workspace /private/merchant/delivery-operations \
  --state /private/merchant/sf98 --port 8462
```

Open the printed loopback URL. Create a receiver profile with its public HTTPS
URL, exact allowed host and secret environment name, then review the selected
revision and delivery settings. Start the worker for ongoing delivery, or drain
one cycle. The event list and details show the original outbox state, attempts,
next delivery time and receiver outcome. Editing a receiver creates a new
revision; the running worker keeps its selected revision until changed explicitly.

Select exhausted events to prepare a recovery job. The workspace pauses its
owned worker, reconciles each exact selected event through the shared original
recovery helper, retains each result, and can resume delivery with the selected
receiver. An interrupted job reopens against those same event identities and
saved results. The original outbox remains the event and retry authority.

Restart with the same workspace and outbox to reopen receiver revisions,
maintenance history and retained controls. A saved running selection restarts
its worker; **Pause** persists the paused state across restart. When moving an
existing standalone delivery service into this workspace, stop that service
with its existing service controls first. The shared kernel lease coordinates
the original worker, drain and recovery paths on that outbox.

The complete `sf98-merchant-delivery` component, browser assets and
`WORKSPACE.md` are included in the archive. Its `SERVICE.md` retains the original
standalone worker deployment instructions. Applications can use the same
controller and browser server through the installed public entries:

```js
import { startDeliveryWorkspace } from
  '@tokenjunkielabs/starforge-merchant/seller/delivery/workspace';

const delivery = await startDeliveryWorkspace({
  directory: '/private/merchant/delivery-operations',
  outboxDirectory: '/private/merchant/sf98',
  port: 8462,
});
console.log(delivery.url);
// In the application's shutdown handler:
// await delivery.close();
```

`./seller/delivery/control` exposes `openDeliveryWorkspace`, including the
original SF30 recovery callback and retained batch controls.
`./seller/delivery/workspace` also exports `createDeliveryWorkspaceHandler` for
the host's private operator listener. The existing outbox API stays at
`./seller/delivery`; `./seller/delivery/worker` and `./seller/delivery/recovery`
expose the original worker and shared same-event recovery functions. Follow the
included workspace guide for mounting, allowed origins and lifecycle ownership.

## Deliver paid SSE and NDJSON streams

The existing seller, upstream and operations commands support finite streamed
responses. The original native payment flow determines when generation starts:
authorization completes and validates the source before settlement; an explicitly
offered and buyer-approved `upfront` flow settles before live generation. The
same request owns the source, deadlines, backpressure, cancellation and cleanup.

Embedded Node applications can return the original response descriptor through
the installed public import:

```js
import { streamingResponse } from '@tokenjunkielabs/starforge-merchant/seller/streaming';

export async function events(context) {
  return streamingResponse({
    format: 'sse',
    body: generateApplicationEvents(context.signal),
    maxBytes: 33554432,
    maxDurationMs: 120000,
    idleTimeoutMs: 30000,
  });
}
```

`generateApplicationEvents` is the application's async byte iterable and must
stop its source when the original signal is aborted. It emits complete UTF-8 SSE
records; NDJSON applications select `format: 'ndjson'`. Existing embedded hosts
also receive `streamingResponse` from `seller/embedded`. The included
`sf30-seller-sdk/STREAMING.md` defines the complete descriptor, source-close hook,
payment-flow selection, limits and operator lifecycle.

### Operate an Exa Answer customer deployment

The installed source includes a fixed Exa Answer product and its independent
buyer. Start from the supplied merchant configuration in your application:

```sh
SF_STREAM_SOURCE="$PWD/node_modules/@tokenjunkielabs/starforge-merchant/source/stellar/scf-starforge-20261009"
EXA_ANSWER_HOME=/absolute/private/research-merchant
install -d -m 700 "$EXA_ANSWER_HOME"
cp "$SF_STREAM_SOURCE/sf30-seller-sdk/examples/exa-answer-service.json" "$EXA_ANSWER_HOME/service.json"
cp "$SF_STREAM_SOURCE/sf30-seller-sdk/examples/exa-answer-upstreams.json" "$EXA_ANSWER_HOME/upstreams.json"
```

Set the merchant's actual HTTPS origin, Stellar network, asset, recipient and
fixed atomic price in `service.json`. Configure the existing native dependencies
and facilitator, and supply `EXA_API_KEY` through the merchant's private server
environment. Its existing Exa account retains normal API usage billing.
`EXA_FACILITATOR_URL` names the selected native facilitator. Then launch the
original seller and operations workspace:

```sh
EXA_ANSWER_UPSTREAMS="$EXA_ANSWER_HOME/upstreams.json" \
npx --no-install starforge operations \
  --operations-port 8424 --history-dir "$EXA_ANSWER_HOME/history" -- \
  --config "$EXA_ANSWER_HOME/service.json" \
  --handlers "$SF_STREAM_SOURCE/sf30-seller-sdk/examples/exa-answer-handlers.mjs" \
  --facilitator "$EXA_FACILITATOR_URL" --port 8423 \
  --max-in-flight 16 --drain-grace-ms 180000
```

The merchant admits only the defined query input before native payment and
creates the fixed private `/answer` request with the source model, streaming and
text policy. The included `sf30-seller-sdk/EXA_ANSWER.md` covers configuration,
deployment, customer acceptance, source billing and delivery recovery.

The public `@tokenjunkielabs/starforge-merchant/buyer/node` import supplies the
same `Buyer` and `BuyerResult` APIs. Select a reviewed `requestTimeoutMs` and
`responseFile.stream` in the original operation; the Node client retains the
capture inside its private operation directory. `result.events()` or
`result.ndjson()` verifies and reads that saved output. After interruption,
recover the same intent and explicitly select the complete-record prefix with
`allowPartial`; its original payment and delivery state remain available.
The included `sf88-operator-buyer-cli/node/STREAMS.md` explains these operations,
and `node/examples/exa-answer.mjs` provides review, execution, answer/citation
consumption and reopening in one runnable customer workflow.

## Give customers a usable client

Save the running seller's OpenAPI document using its printed listener address,
then export the client into a new directory:

```sh
curl --fail "$SELLER_URL/_seller/openapi.json" --output seller-openapi.json
npx --no-install starforge client \
  --openapi ./seller-openapi.json --out ./customer-client
```

The output includes `seller-client.mjs`, `seller-client.d.mts`, the unchanged
`seller-openapi.json`, `package.json` and an integration guide. It builds exact
requests for the advertised operations and supplies an application adapter for
the original buyer. The customer chooses a payment alternative when several are
advertised, and supplies the original buyer, explicit intent and atomic spend
ceiling. The generated guide explains these inputs with the exact exported
operation names and types. The seller's browser explorer also serves the client
downloads and generates usage from the operator's current inputs.

## Operate retained seller configurations

Use the same installed command to prepare the merchant's existing OpenAPI,
payment selections and application bindings:

```sh
npx --no-install starforge releases init --store ./seller-releases
npx --no-install starforge releases stage \
  --store ./seller-releases --id first \
  --spec ./api/openapi.json --config ./api/selections.json \
  --bindings ./api/bindings.json --port 0
npx --no-install starforge releases diff --store ./seller-releases --to first
npx --no-install starforge releases activate \
  --store ./seller-releases --id first --expect 0 --reason "Initial release"
npx --no-install starforge releases console --store ./seller-releases --port 0
```

Open the printed private operator URL. It shows prepared versions, exact price
and application changes, the selected configuration and the actually running
seller. Start or restart the selected version there. Selecting another version
keeps the current process running until restart; rollback selects a retained
version through the same generation check. The store stays in the merchant's
workspace when the toolkit package is upgraded.

For a terminal-only deployment, use `starforge releases run --store DIRECTORY`.
For application handlers, facilitator configuration, versioned entry paths,
shutdown and retained history, use the packaged
`source/stellar/scf-starforge-20261009/sf82-seller-pilot/RELEASES.md` guide.

### Operate a merchant from an MCP client

The existing merchant MCP service uses the same release store and original
customer client exporter. Initialize it from the operator's reviewed OpenAPI,
payment selections and application bindings, then serve its private endpoint:

```sh
npx --no-install starforge merchant-mcp init \
  --dir /private/my-merchant --spec /private/api/openapi.json \
  --selections /private/api/selections.json --bindings /private/api/bindings.json \
  --name "My merchant" --seller-port 0
npx --no-install starforge merchant-mcp serve \
  --config /private/my-merchant/merchant-mcp.json --port 3211
```

Supply the existing operator token through `MCP_ACCESS_TOKEN` or the original
`--token-env` option. Connect the client's Streamable HTTP transport to the
printed loopback URL with that bearer authorization. Twelve maintained tools
list configured sources, stage and compare releases, activate the reviewed
selection, run the owned seller, inspect its actual catalog, export customer
clients and roll back or stop the owned process. Their original generation,
digest and instance checks apply to each operation.

The packaged `source/stellar-forge/mcp-merchant-operator/README.md` describes
the complete client connection and host configuration, including trusted
handlers and native facilitator options. Its source-only exercise is excluded
from this installed runtime.

### Buy and serve native paid MCP tools

The installed toolkit includes the original remote MCP buyer and native Stellar
paid-tool server. The buyer connects to an explicitly configured Streamable HTTP
or SSE endpoint; the included seller uses Streamable HTTP. The exact MCP endpoint,
tool name, argument schema and `mcp://tool/<name>` payment resource remain bound
to the operator's reviewed quote.

The source archive installs its pinned MCP runtime as optional dependencies.
From the application directory where the archive is installed, check that feature:

```sh
npx --no-install starforge doctor --feature mcp
```

If optional dependencies were omitted, install the original component's pins in
that same application directory so both the MCP and native Stellar modules can
resolve them:

```sh
npm install @modelcontextprotocol/sdk@1.32.1 \
  @x402/core@2.28.0 @x402/stellar@2.28.0 \
  @x402/mcp@2.28.0 @x402/extensions@2.28.0
```

The feature check uses the SDK's actual exported client entry. The original
component manifest remains the source for all five runtime versions.

Use these public imports in the existing private operator or merchant module:

```js
import { connectRemoteMcp } from '@tokenjunkielabs/starforge-merchant/buyer/mcp/remote';
import {
  createNativeMcpOperator,
  createTerminalMcpApproval,
} from '@tokenjunkielabs/starforge-merchant/buyer/mcp/native-operator';
import {
  startNativePaidToolServer,
  createMerchantRecordTool,
} from '@tokenjunkielabs/starforge-merchant/merchant/mcp/paid-tools';
```

The complete original buyer setup is
`source/stellar-forge/mcp-paid-agent/REMOTE_MCP.md`: create the private approval
and signer adapter, configure the seller origin and discovery feed, then use the
existing HTTP or stdio host's `bazaar_search` → `bazaar_describe` →
`bazaar_preview` → `bazaar_execute_approved` tools. Preview binds explicit
arguments without contacting the seller. The native call uses the existing
durable quote store and original SF103 signer.

The matching merchant setup is
`source/stellar-forge/mcp-paid-agent/PAID_TOOLS.md`: supply the existing native
facilitator configuration and an actual merchant tool, start its original server,
then use the returned discovery URL and MCP endpoint. Its registered tools,
full payment terms and input schemas come from that same running server.
On shutdown, await the server's original `close()` to drain accepted work and
release native signer ownership. Operator configuration, wallet material and
retained purchase state stay in the operator's private directories.

### Serve prepared data through native paid MCP

The `mcp-data` command opens an existing prepared SQLite, PostgreSQL, DuckDB or
ClickHouse source through its original provider and native paid-tool server.
Create the private operator JSON from
`source/stellar-forge/mcp-paid-agent/DATA_TOOLS.md`. That guide covers the exact
source/service/bindings files, selected routes, payment terms, discovery, complete
query results and shutdown. The SQLite generated-handler mapping and original
public parameter schemas are consumed as documented there.

```sh
npx --no-install starforge doctor --feature mcp
npx --no-install starforge mcp-data --config /private/operator/data-mcp.json
```

The existing whole SF30 component includes all four dynamically selected provider
modules and their original worker/runtime files. Use the existing MCP dependency
setup above and the selected provider's original runtime:

| Provider | Runtime at the application installation root |
| --- | --- |
| SQLite | Node 22.16+ with its built-in SQLite module and original worker pool; no added driver. |
| PostgreSQL | `pg@8.23.1` and `pg-cursor@2.22.1`, derived from the provider's component manifest. Check `starforge doctor --feature postgres`. |
| DuckDB | Existing Python 3.10+ with `duckdb==1.5.6`, matching the included provider requirements.txt; select that interpreter's absolute path with `python` in the operator file. |
| ClickHouse | Original native HTTP adapter and configured endpoint/credentials; no added Node driver. |

If optional dependencies were omitted, install the MCP pins and any selected
PostgreSQL drivers at the application installation root. `doctor` checks Node
module resolution; the original provider performs its own database/source
preflight. DuckDB uses the explicitly selected Python environment.

Embedding applications can compose the same provider or private configuration:

```js
import { createDataSourceTools, startDataToolServer } from
  '@tokenjunkielabs/starforge-merchant/merchant/mcp/data-tools';
import { readDataMcpConfig, startDataMcpFile } from
  '@tokenjunkielabs/starforge-merchant/merchant/mcp/data-server';
```

### Open the buyer and consume saved results

`mcp-buyer` runs the original loopback HTTP workspace. Configure
`BAZAAR_DISCOVERY_URL`, `MCP_ACCESS_TOKEN`, `PAID_RESOURCE_ORIGINS` and private
`MCP_STATE_DIR`; paid execution also uses the existing absolute
`MCP_OPERATOR_MODULE`. The original README, REMOTE_MCP.md and CONSOLE.md under
`source/stellar-forge/mcp-paid-agent/` describe setup, independent approval and
the same-server browser. `MCP_PORT` selects its port.

```sh
npx --no-install starforge mcp-buyer
```

Use the original buyer's state directory to consume its complete saved native
results. These commands open its quote store read-only:

```sh
npx --no-install starforge mcp-results list \
  --state-dir /private/commerce/mcp-quotes
npx --no-install starforge mcp-results read \
  --state-dir /private/commerce/mcp-quotes --quote ORIGINAL_QUOTE_ID \
  --byte-offset 0 --max-bytes 32768
npx --no-install starforge mcp-results export \
  --state-dir /private/commerce/mcp-quotes --quote ORIGINAL_QUOTE_ID \
  --out /private/commerce/exports/tool-result.json
```

Range offsets count bytes; concatenate decoded ranges before UTF-8 decoding.
Export verifies the complete original hash and creates a new destination in an
existing private parent. `mcp-results recover` and `import` run after the writer
closes and use the original retained completion without a new merchant, signer
or ledger call. Complete options, MCP inbox tools and the saved-file API are in
`source/stellar-forge/mcp-paid-agent/RESULTS.md`.

```js
import { startMcpWorkspace } from '@tokenjunkielabs/starforge-merchant/buyer/mcp/server';
import { McpResultStore } from '@tokenjunkielabs/starforge-merchant/buyer/mcp/result-store';
import { runResultCommand } from '@tokenjunkielabs/starforge-merchant/buyer/mcp/result-cli';
```

### Connect native buying to an MCP host

Create the native MCP workspace from the operator's existing SF88 workspace and
the original catalog configuration JSON file. `--catalog` names that file:

```sh
npx --no-install starforge mcp-native init \
  --dir /private/commerce/native-mcp --workspace /private/commerce/original-buyer \
  --catalog /private/commerce/catalog.json
npx --no-install starforge mcp-native inspect --dir /private/commerce/native-mcp
npx --no-install starforge mcp-native serve --dir /private/commerce/native-mcp --port 3210
```

The generated operator module binds preparation, explicit native execution,
durable history, cancellation, recovery and saved-response reads to that same
buyer. The original operator workspace retains its signer, ledger, explicit
proxy configuration and terminal approval. The included
`source/stellar-forge/mcp-paid-agent/NATIVE_WORKSPACE.md` documents catalog JSON,
`call --input REQUEST_JSON`, reporting and the existing runtime prerequisites.

For a local MCP client, generate its registration on the host that will launch
the installed commands:

```sh
npx --no-install starforge mcp-client-config \
  --discovery https://actual-catalog.example --state /private/commerce/native-mcp/quotes \
  --origin https://actual-merchant.example \
  --operator /private/commerce/native-mcp/operator.mjs \
  --output /private/commerce/buyer-host.json
npx --no-install starforge merchant-mcp-client-config \
  --config /private/my-merchant/merchant-mcp.json \
  --merge /private/commerce/buyer-host.json \
  --output /private/commerce/buyer-and-merchant-host.json
```

Use the deployment's actual catalog and merchant origins. Generated registrations
contain that host's absolute Node and installed entry paths. The original
`--merge` option composes an existing host configuration into a separate new
output. `mcp-stdio` and `merchant-mcp-stdio` run the same original tools through
stdio; their included `STDIO.md` guides describe client integration and shutdown.
The merchant's original owned host process keeps compiler output separate from
the protocol. These adapters add no payment or framework dependency.

Add the merged file's `mcpServers.stellar-forge` and
`mcpServers.starforge-merchant` registrations to the local MCP host. Both
generators preserve existing host settings and server entries, reject a
conflicting server name, and create the new output with mode `0600`. Backend
credential variables continue to come from the MCP host environment. Regenerate
the registrations after moving the package or changing the Node executable.

Keep the same private quote directory across host and package restarts. The
buyer discovers offers, describes an exact offer, previews its request, and
retains quote history; its configured original operator owns approval,
signing, cancellation and recovery. The merchant tools use the same immutable
release store to inspect configured sources, stage and compare versions,
activate the exact digest at the current generation, start the owned seller,
read its catalog, and export the original customer SDK. A cancelled merchant
wait leaves an admitted change tracked by that operator; read its retained
status before continuing. EOF, signals and connection failure drain the
original owned workspace and seller.

Node applications can use the same installed transports directly:

```js
import { startMcpStdio } from '@tokenjunkielabs/starforge-merchant/buyer/mcp/stdio';
import { startMerchantMcpStdio } from '@tokenjunkielabs/starforge-merchant/merchant/mcp/stdio';
```

Both expose `close` and `closed` for their owned connection. The full host,
approval and reconnect contracts are included in
`source/stellar-forge/mcp-paid-agent/STDIO.md` and
`source/stellar-forge/mcp-merchant-operator/STDIO.md`. The complete merchant
component includes its child host, which redirects application output and
direct compiler stdout writes to stderr while keeping stdout for MCP messages.

## Install and recover a merchant host

The installed `merchant-host` command runs the original SF99 deployment and
maintenance implementation. It supports the existing API seller, order-bound
paid-file checkout/receiver/delivery group, and the retained seller with its
existing signed discovery identity. Keep the selected toolkit installation
immutable, with merchant state and secrets outside it. Generate this bundle on
the intended Linux host: its runtime and source paths refer to that installation.

Use the host's existing unprivileged merchant account, Node 22+, systemd, Caddy 2
and util-linux `flock`. Python 3.11+ is also required by the paid-file profile and
Python application releases. Native operation uses the original SDK dependencies
and the merchant's actual facilitator and payment terms. The host generator
does not install those system tools, provision credentials or execute payments.

For a retained merchant, stage and activate its actual fixed seller port through
`starforge releases`. Keep that store and the already prepared discovery setup
as separate private directories under the same state root. Inspect the active
generation and original public identity:

```sh
npx --no-install starforge releases status --store /private/merchant/state/releases
npx --no-install starforge releases catalog-inspect \
  --store /private/merchant/state/releases --setup /private/merchant/state/discovery
```

Save a private host plan using that exact generation and existing service
account. This example assumes the retained release already selects native
operation; use `challenge` when that original runtime is challenge-only:

```json
{
  "schema": "stellar-forge.merchant-host.v1",
  "merchant": "report-merchant",
  "serviceUser": "stellar-merchant",
  "kind": "release",
  "mode": "native",
  "privateRoot": "/private/merchant/state",
  "release": {
    "store": "/private/merchant/state/releases",
    "expectedGeneration": 1
  },
  "discovery": { "setup": "/private/merchant/state/discovery" },
  "environmentFile": "/private/merchant/config/service.env",
  "ports": { "discovery": 8473 }
}
```

The seller port, application, facilitator and lifecycle come from the retained
release. Omit `discovery` and `ports.discovery` to install a retained seller
alone. The original [host guide](../sf99-merchant-deploy/README.md) gives the API
and paid-file plans and the supported retained-source settings.

```sh
npx --no-install starforge merchant-host inspect --plan /private/merchant/host.json
npx --no-install starforge merchant-host generate \
  --plan /private/merchant/host.json --out /private/deployments/report-001
npx --no-install starforge merchant-host check --bundle /private/deployments/report-001
```

Read the generated `RUNBOOK.md`. It contains the exact account ownership,
root-owned service-readable bundle permissions, original unit installation,
existing Caddy import and reload, and component readiness commands. Stop a
foreground console/MCP owner before starting the installed original service
group. Configure the merchant's real DNS and HTTPS ingress using that runbook.
After installing and starting its declared group, inspect local and public
operation through the same command:

```sh
npx --no-install starforge merchant-host smoke --bundle /private/deployments/report-001
npx --no-install starforge merchant-host smoke --bundle /private/deployments/report-001 --public
```

The retained profile checks original process/source identity and exposes only
the original merchant route/method pairs, public documentation, discovery reads
and exact offer export. Its generated runbook also gives original publication,
withdrawal and private cache commands. Restart reopens the same signing key and
catalog journal; an unchanged listing requires no new publication.

The same original command carries encrypted backup and restored-state cutover:

```sh
npx --no-install starforge merchant-host maintenance template
npx --no-install starforge merchant-host maintenance inspect --plan /private/merchant/maintenance.json
npx --no-install starforge merchant-host maintenance backup \
  --plan /private/merchant/maintenance.json --id before-upgrade
npx --no-install starforge merchant-host maintenance migrate \
  --plan /private/merchant/maintenance.json --id move-stores \
  --destination /private/restored/report-001
```

Fill the original template with the actually installed bundle, imported Caddy
fragment, declared writer units and private operation root. Provision its named
passphrase through the private operator environment. Follow the included
[maintenance guide](../sf99-merchant-deploy/MAINTENANCE.md) for retained
`status`, `resume`, precommit `rollback`, external-writer templates and the
returned next-generation plan. Migration pauses this merchant, drains its
original components, verifies the encrypted snapshot and resumes the restored
state while preserving other merchants on the shared proxy. The retained
profile rebases the store/setup selections and preserves release, key and
journal bytes. The existing API profile owns absolute upstream-idempotency
path rebasing. Credentials keep their separate original recovery procedure.

Applications that operate this same host workflow can import `prepare`,
`generate` and `checkBundle` from `@tokenjunkielabs/starforge-merchant/merchant/host`,
and `runMaintenance` from
`@tokenjunkielabs/starforge-merchant/merchant/host-maintenance`.
These are the original implementations used by the installed command and do
not create another supervisor or recovery engine.

## Operate several merchants

The fleet commands package the existing merchant gateway and its private
workspace. Run each merchant's original seller on its own loopback port with
its own public HTTPS origin and payment configuration, then start the gateway
with the operator's private manifest and retained state:

```sh
npx --no-install starforge merchant-fleet \
  --manifest /private/fleet/current.json --state /private/fleet/state \
  --port 8400 --admin-port 8401
```

From another terminal in the same host and network namespace:

```sh
npx --no-install starforge merchant-fleet-control status --state /private/fleet/state
npx --no-install starforge merchant-fleet-workspace \
  --state /private/fleet/state \
  --manifest current=/private/fleet/current.json \
  --manifest next=/private/fleet/next.json --port 8402
```

Open the printed loopback URL. Prepare a registered manifest, compare the exact
serving and proposed merchants, and activate the reviewed candidate and current
revision. The gateway keeps already admitted requests on their prior seller,
tracks draining requests, retains configuration and supports deliberate rollback.
The workspace reopens that same gateway state. A changed seller runs on a new
port; keep its predecessor available until draining finishes and for the desired
rollback period. These commands manage routing and configuration; each seller
keeps its own lifecycle and native payment settings.

Durable fleet operation requires Linux with `flock` from util-linux on `PATH`.
The operator's existing HTTPS ingress fronts the merchant hosts; the workspace
and gateway administration stay local. The bundled
`source/stellar/scf-starforge-20261009/merchant-fleet-gateway/README.md` and
`workspace/README.md` provide the complete manifest, terminal prepare/activate/
rollback commands, retained-state recovery and private operator setup. Replace
their three Node entrypoint prefixes with `starforge merchant-fleet`,
`starforge merchant-fleet-control` and `starforge merchant-fleet-workspace`.

### Manage seller releases with the fleet

Use the original release operator when the fleet should own its seller
lifecycles as well as routing. Prepare the private plan described in the
included `merchant-fleet-gateway/RELEASE_OPERATOR.md`: each merchant has separate
original SF82 release stores and fixed ports, with reviewed saved packages for
future staging. Select one foreground interface:

```sh
npx --no-install starforge fleet-release start \
  --plan /private/fleet/plan.json --directory /private/fleet/release-operator
```

The browser entry for the same managed plan is:

```sh
npx --no-install starforge merchant-fleet-workspace \
  --releases /private/fleet/plan.json \
  --release-state /private/fleet/release-operator --port 8402
```

Stage and compare an original release, prepare its separate slot, activate the
reviewed routing, and retire its owned predecessor after the original gateway
reports that port drained. Rollback starts the exact retained original release
when necessary. Restart reopens the same plan, stores and retained selection.
The terminal and browser both own the original lifecycle, so run one of them
for that deployment. The `./merchant/fleet/releases` subpath exposes the same
`openFleetReleaseOperator` API.

### Pause selected merchant routes

The installed `availability` command uses the running seller's original private
operations control. Start the seller with its declared availability settings,
then inspect the actual endpoint and current revision before changing routes:

```sh
npx --no-install starforge availability status --url-env SELLER_AVAILABILITY_URL --json
npx --no-install starforge availability pause --url-env SELLER_AVAILABILITY_URL \
  --revision 0 --route inventory --reason maintenance
npx --no-install starforge availability resume --url-env SELLER_AVAILABILITY_URL \
  --revision 1 --route inventory
```

Use the current reviewed revision, actual route ID and private control URL from
the original launcher. The original writer rejects stale changes and does not
retry them. The included `sf30-seller-sdk/availability/README.md` describes
configuration, operator browser controls, draining and reopening with the same
seller state.

## Use existing database sources

PostgreSQL support uses the original named-query integration. Install its
production drivers in the application directory; they are independent of the
native payment packages. Driver pins and the PostgreSQL feature metadata derive
from the selected commit's original postgres/package.json, including pg-cursor.
They are optional runtime dependencies of the archive; development dependencies
are excluded:

```sh
npm install --ignore-scripts pg@8.23.1 pg-cursor@2.22.1
npx --no-install starforge doctor --feature postgres
npx --no-install starforge postgres-init --directory ./postgres-merchant
npx --no-install starforge postgres-inspect \
  --source ./postgres-merchant/source.json --describe
```

Edit the generated declaration and environment-variable name for the actual
database. `--describe` reads the local declaration; `--preflight` connects to that
database and checks the configured query projections. `starforge postgres --help`
shows the original source, seller, facilitator and dashboard options. Connection
values stay in the chosen environment variable. The original parameter binding,
read-only queries, projection, result limits and pool behavior remain in force.
Development-only PostgreSQL exercise and emulator sources are omitted from the
installed runtime.

For interactive merchant setup, configure the existing source connection policy
and run the maintained workspace:

```sh
npx --no-install starforge postgres-workspace \
  --source ./postgres-merchant/source.json --output ./merchant-packages
```

Select the actual table/view, public columns, typed filters, ordering and payment
terms. Each reviewed export creates a fresh private source.json/service.json
package and prints the original launch command. The same files also run through
the installed command catalog:

```sh
npx --no-install starforge postgres \
  --source /absolute/export/source.json --config /absolute/export/service.json
```

The source/workspace guides include the original role, certificate, capped-query
and facilitator setup. `doctor --feature postgres` checks imports at the original
adapter's path, including source checkouts with drivers installed in the postgres
directory. It does not connect to the database or require payment SDK packages.

SQLite uses Node's built-in database module and requires no PostgreSQL driver.
`starforge sqlite-init --directory NEW_DIRECTORY` creates the original example;
`starforge sqlite-inspect --help` exposes declaration/query inspection. The
bundled source guides cover application bindings and current Node requirements.

### Prepare and operate a ClickHouse merchant

The installed ClickHouse adapter uses the original SF30 HTTP transport and
merchant lifecycle. It requires an existing ClickHouse HTTP endpoint and a
dedicated account with SELECT access to the approved tables or views; it requires
no ClickHouse JavaScript driver. Source configuration, complete examples and the
query contract are included at
`source/stellar/scf-starforge-20261009/sf30-seller-sdk/clickhouse/README.md`.

For a retained browser workflow, set those source environment variables in the
launching terminal and open a private workspace:

    npx --no-install starforge clickhouse-workspace \
      --state /private/clickhouse-workspace --port 8443

Open the complete private URL printed by the original server. **Source & offers**
loads the existing source and merchant-plan JSON files, edits approved SQL and
typed input declarations, and retains both with every complete ordered payment
option. Each save compares the revision actually opened by that editor; another
window cannot silently replace current work. Actual connection values remain in
the server environment.

**Native review** displays the real ClickHouse version and zero-row result
schema, the original typed parameter contract, bounded private previews and the
compiled public offers. Review those queries and all payment terms, then choose
**Prepare merchant**. The original preparer creates its normal service and
generated client in an immutable retained folder attached to that revision and
review. **Resume preparation** continues the same interrupted preparation.

**Prepared merchants** starts and drains the original seller, opens its original
customer API, operations and availability interfaces, and downloads the
generated customer client or OpenAPI. The browser verifies each download's
returned SHA-256. SQL, probe values, private source and credential references are
excluded from the fixed customer archive. Restart the same workspace command to
reopen saved revisions, reviews and prepared merchants; restarting does not
automatically launch a seller.

The existing native facilitator is selected with `--facilitator HTTPS_URL` and the
same payment dependencies described below. The default serves the original
402 challenges. The workspace needs the standard Linux flock and tar utilities;
it adds no JavaScript driver or frontend build. Its complete guide is
`source/stellar/scf-starforge-20261009/sf30-seller-sdk/clickhouse/workspace/README.md`.
Embedding applications import `startClickHouseWorkspace` from
`@tokenjunkielabs/starforge-merchant/seller/clickhouse/workspace`, or
`createClickHouseWorkspace` from the adjacent `/model` package subpath.

For direct command-line preparation, start with its `examples/source.json` and
`examples/merchant-plan.json`. In the
private source, select the database, approved named queries, public columns,
typed parameters and actual preflight probes. The three `endpointEnv`, `userEnv`
and `passwordEnv` names resolve through the host's existing secret setup.
Ordinary connections use HTTPS with certificate verification; `allowLocal: true`
permits an explicitly selected loopback HTTP endpoint for a local database.
In the plan, set the actual public origin and full ordered payment terms. Replace
the conspicuous demonstration asset and recipient before customer deployment.

Prepare a new private directory, inspect the real source and start its seller:

```sh
npx --no-install starforge clickhouse-prepare \
  --source /private/clickhouse-draft/source.json \
  --plan /private/clickhouse-draft/merchant-plan.json \
  --directory /private/clickhouse-ready
npx --no-install starforge clickhouse \
  --directory /private/clickhouse-ready --inspect
npx --no-install starforge clickhouse \
  --directory /private/clickhouse-ready --port 8423 --operations-port 8424
```

Preparation is offline. It creates the original `source.json`, `service.json`,
`bindings.json`, reviewed `merchant-plan.json`, public `openapi.json` and complete
customer `client/` folder. Existing destinations are never replaced. Interrupted
preparation retains an `INCOMPLETE` marker and cannot be launched; prepare again
into a new directory. The complete folder is portable when the destination host
supplies the same named environment variables.

`--inspect` authenticates to the actual database, obtains its version and runs
each declared query with `LIMIT 0`. Every normal launch performs this preflight,
then prints the original seller, docs, health and operations URLs. For the
maintained payment path, install the [native payment dependencies](#native-payment-dependencies)
and add `--facilitator HTTPS_URL`. The default serves the original 402 challenges.
`--availability-dir PRIVATE_ABSOLUTE_DIRECTORY` preserves the existing route
controls. SIGINT/SIGTERM drain the original seller and close the source.

Send the customer the generated `client/` and public OpenAPI contract. The source
SQL, probes and database credentials stay with the merchant. The installed Node
Buyer consumes the original generated module, for example:

```js
import { fileURLToPath } from 'node:url';
import { Buyer } from '@tokenjunkielabs/starforge-merchant/buyer/node';
import { createSellerClient } from './client/seller-client.mjs';

const buyer = new Buyer({
  runtimeDirectory: fileURLToPath(new URL('../',
    import.meta.resolve('@tokenjunkielabs/starforge-merchant/buyer/node'))),
  stateDirectory: '/private/customer/buyer-state',
  operatorProfile: '/private/customer/operator-profile.json',
});
const api = createSellerClient({ buyer });
const result = await api.call('transfers', {
  body: { account: 'merchant-demo', after_ledger: '0', after_record_id: '0', minimum_amount: '0' },
}, { intentId: 'transfer-page-001', maxAtomic: '10000', acceptIndex: 0 });
const page = await result.json();
```

Use the actual operation, selected offer and independent customer cap. All
non-null ClickHouse values are strings; SQL null is JSON null. Preserve exact
integer and decimal text. The example's `(ledger, record_id)` cursor advances
from both values in the same last row, with the other filters unchanged. Each
request observes the current database rather than a frozen multi-page snapshot.
The source rejects changed column types, invalid input and completed results
above configured scan limits. Native query settings, HTTP deadlines, result
bytes, row limits and admission retain the complete source guide's bounds.

Application hosts can import `openClickHouseSourceFile` from
`@tokenjunkielabs/starforge-merchant/seller/clickhouse`, query compilation and
binding from `./seller/clickhouse/declaration`, `prepareClickHouseSeller` from
`./seller/clickhouse/prepare`, and `startClickHouseMerchant` from
`./seller/clickhouse/start`. The last three names are package subpaths of the
same `@tokenjunkielabs/starforge-merchant` package. These exports are the original
modules used by the installed commands; they retain SF30's existing payment,
approval, operations and customer execution contracts.

### Publish and maintain a PostgreSQL data product

The installed publisher turns an approved PostgreSQL query into a retained
dataset using the original read-only repeatable-read extraction, exact scalar
mapping, review and version writer. The running dataset seller keeps serving the
current version while the next candidate is extracted. Existing buyer cursors
remain bound to their original retained snapshots.

Use the PostgreSQL runtime setup above, Linux and util-linux `flock`. Start the
original dataset seller on its chosen state directory, then open a new private
publisher workspace using an existing approved source declaration:

```sh
npx --no-install starforge postgres-publisher serve \
  --workspace /absolute/private/inventory-publications --create \
  --source /absolute/private/postgres-merchant/source.json \
  --state /absolute/private/inventory-dataset --port 8442
```

Open the printed loopback address. Save the query, its parameters, exact public
column mapping, deterministic ordering and extraction limits. Extract the whole
result, inspect its typed rows, record a publication review against the displayed
current target, and publish those exact candidate bytes. A first publication can
also initialize a new dataset state; use the original dataset configure/serve
commands from the included publisher guide to start that target before enabling
recurrence. Native buyer preparation stays on the same retained candidate.

For continuing source updates, select the current published extraction and use
**Keep this data product current** on the same page. Save the publication policy:
interval, minimum/maximum rows, optional maximum percentage decrease, failure
action, responsible operator and note. Saving leaves the schedule paused.
**Enable using displayed target** binds the current snapshot/revision and starts
the saved cadence. **Run refresh now** requests one immediate refresh.

Every refresh uses that immutable plan and the original native candidate and
writer. Identical data records **UNCHANGED** without another dataset revision.
Source errors or candidates outside the configured row policy leave the last-good
version available. Manual target changes require explicit reconciliation against
the displayed current target. The original retention and version-capacity rules
continue to protect buyer snapshots.

**Pause after current refresh** stops future intervals while accepted work
drains. Stop and reopen the same private workspace to retain its policies and
original run identities:

```sh
npx --no-install starforge postgres-publisher serve \
  --workspace /absolute/private/inventory-publications --port 8442
```

Saved paused work stays paused. Enabled pending work resumes its original run;
an already-committed candidate can complete without querying again. Unknown
publication outcomes remain with the original recovery/continuation controls.
The browser's history opens the native extraction, review and candidate details.

Stop the server before using a separate CLI on its locked workspace.
`starforge postgres-publisher schedule --workspace /absolute/private/inventory-publications`
reads the saved policy and history. The same original command provides
`schedule-save`, `schedule-enable`, `schedule-pause`, `schedule-run` and
`schedule-continue`; `--help` lists their arguments. These commands forward
directly to the existing publisher and do not start a second worker.

The included original `sf30-seller-sdk/postgres/publisher/README.md` and
`SCHEDULES.md` cover policy JSON, source limits, exact version binding, recovery
and private storage. Applications can import
`@tokenjunkielabs/starforge-merchant/seller/postgres/publisher`, its `/server`
and `/schedule` subpaths. These expose the original open-publisher, browser
server and schedule controller; no additional dependency group is required.

### Build a SQLite merchant and retained data product

The original SQLite workbench is installed with the same package. Start from an
existing database and keep its saved source and configuration on the operator host:

```sh
starforge sqlite-workbench --database /private/inventory.sqlite \
  --workspace /private/sqlite-setup --port 0
```

Open the printed private launch URL. Select source columns, author the original
named query and typed parameters, preview actual rows, set public merchant terms
and deliberately public input examples, and export a named release. The exported
`source.json`, `service.json`, handler bindings and `launch.mjs` run the original
SQLite merchant. Repeating the same workbench command restores the saved draft
and completed exports. The database is referenced, not copied.

To sell a reviewed data product with stable pages, use that same exported source:

```sh
starforge sqlite-publisher serve --workspace /private/sqlite-publications --create \
  --source /private/sqlite-setup/exports/inventory/source.json \
  --state /private/inventory-dataset --port 8446
```

The publisher shares the maintained dataset review browser. Select the fixed query
and inputs, choose public scalar types and ordering, extract the complete native
read transaction, inspect the rows, record a review and publish. Exact 64-bit
identifiers and decimal text stay exact; private columns remain outside the public
mapping. Subsequent source changes can produce a new candidate while an older
published version stays available under the original retention policy.

After the first publication, configure the original seller with the merchant's
actual public payment terms and retained snapshot selection:

```sh
starforge dataset-refresh configure --state /private/inventory-dataset \
  --payment /private/inventory-payment.json --origin https://merchant.example \
  --path /data --snapshot-selection --out /private/inventory-seller.json
starforge dataset-refresh serve --state /private/inventory-dataset \
  --seller /private/inventory-seller.json --port 8423 --control-transport loopback
```

Native payment operation uses the original facilitator options and HTTPS
merchant deployment. Stop and reopen the publisher without `--create`, adding
`--seller http://127.0.0.1:8423 --resource https://merchant.example/data`.
Its Buyer handoff loads that running seller's actual terms and downloads the
original SF88 configuration pinned to the selected retained version. Use it in
the existing buyer workspace. Saved plans, candidates, publication reviews and
buyer files stay in the same publisher workspace across restart.

Applications can import `@tokenjunkielabs/starforge-merchant/seller/sqlite/workbench`
(`openWorkbench`), `/seller/sqlite/workbench/server` (`startWorkbench`) and
`/seller/sqlite/publisher` (`openSqlitePublisher`). These exports invoke the
original engines. The full native value/limit/recovery and seller/buyer instructions
ship in `source/stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/publisher/README.md`;
the original authoring guide is beside `sqlite/workbench/server.mjs`.

### Build and operate a MySQL or MariaDB merchant

The installed MySQL product uses the original native `mysql2` prepared-statement
source, `information_schema` catalog, exact parameter binder, merchant package,
SF30 seller, operations and customer exporter. Use Node 22.16 or later; the local
browser workspace also uses the Linux host's `flock` and `tar` commands for
retained release leases and customer archives. Install the original pinned driver
in the application directory:

```sh
npm install --ignore-scripts mysql2@3.24.5
npx --no-install starforge doctor --feature mysql
npx --no-install starforge mysql init --directory /private/mysql-draft
```

The parent directory must exist. `init` creates a new private source profile,
merchant plan, example input and sample SQL. Edit `source.json` for the existing
database, a SELECT-only reader and its actual TLS policy. Its `connection.passwordEnv`
names the environment variable supplied through the operator host's existing
secret injection. `verify-full` checks the certificate and host; an optional
`caFile` resolves relative to the source profile. `local-plaintext` is restricted
to a local database. The original source's complete configuration and named-query
guide is included at
`source/stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/README.md`.

Start the complete browser workflow with absolute source and state paths:

```sh
npx --no-install starforge mysql-workspace \
  --source /private/mysql-draft/source.json \
  --state /private/mysql-workspace
```

`starforge mysql workspace` forwards to this same original server. Open the full
URL printed by the launcher; it binds to `127.0.0.1:8439` by default and carries
the private tab capability in its fragment. `--port 0` chooses an available
workspace port. Source paths, database credentials and the state root are supplied
by the operator host.

1. Select an actual table or view and its approved public columns. The catalog
   shows native types, keys, nullability, collation and precision. Choose a stable
   order, including a unique key when appropriate.
2. Add an endpoint with its ID, GET or POST method, public path, description,
   limits and typed filters. Add it to the release, then repeat for the remaining
   routes. Save edited endpoints before reviewing the release.
3. Set a new release ID, the actual public HTTPS origin, and each ordered payment
   option's network, asset, recipient, atomic amount and timeout.
4. Review the complete original SQL, output aliases, typed examples, limits,
   merchant plan and public contract. Explicit private previews run the reviewed
   read against the actual database. Schema changes require a fresh review.
5. Prepare the release. The original preparer creates and verifies the private
   source, service, plan, OpenAPI, customer client, optional copied CA and manifest.
   A complete release is published atomically; repeated successful preparation
   reopens the same reviewed package.
6. Open **Saved releases**, select the package and choose **Start merchant**. Use
   the displayed API docs, original operations and availability controls. **Stop
   merchant** drains the running source while retaining its release and route
   policy. Reopen the same state directory for an explicit restart, or use the
   selected release as a new draft to prepare a changed contract.

The browser derives exact integer and decimal restrictions from the real schema.
Unsigned BIGINT values retain their full range through `18446744073709551615`.
`DECIMAL(p,s)` inputs retain decimal text and reject values requiring rounding or
excess integer capacity before native payment. Original results keep numbers and
dates as strings, binary values as `{ "base64": "..." }`, and SQL NULL as JSON
null. Each request runs its own read-only repeatable-read transaction, with the
original row, byte, queue and deadline limits. Database views can enforce the
approved row policy; appropriate indexes support the selected order and filters.

The original seller's default mode serves the configured `402` challenges. To run
its payment-enabled mode, use the [native payment dependencies](#native-payment-dependencies)
and add the actual `--facilitator HTTPS_URL` to the workspace command. Seller and
operations ports default to available ports and can be selected with
`--seller-port` and `--operations-port`. The workspace's **Download customer
client** exports `openapi.json` and the five original files in `client/`, using a
single-use download with its size and SHA-256 displayed in the browser.

Prepared packages also run independently through the installed original CLI:

```sh
npx --no-install starforge mysql verify \
  --directory /private/mysql-workspace/releases/catalog_v1/package
npx --no-install starforge mysql run \
  --directory /private/mysql-workspace/releases/catalog_v1/package \
  --port 8423 --operations-port 8424 \
  --availability-dir /private/mysql-workspace/availability/catalog_v1 \
  --facilitator https://facilitator.example
```

Use the actual retained release ID and facilitator. Keep the source's password
environment available in the destination process. `verify` and `run` use the
original file manifest; copied CA references remain relative when relocating the
package. The CLI also exposes `catalog --source FILE [--table NAME]`, offline
`describe --source FILE`, native `preflight --source FILE`, and private
`query --source FILE --query NAME --input FILE`. An operator-authored declaration
uses `prepare --source FILE --plan FILE --directory NEW_DIRECTORY`, followed by
the same `verify` and `run` flow. `serve --source FILE --config FILE` starts an
existing original configuration. Each command's `--help` shows its full options.

Extract the customer archive into the customer's application and follow the
generated `client/README.md`. The original Node Buyer consumes the generated
module directly; for the included `catalog` route example:

```js
import { fileURLToPath } from 'node:url';
import { Buyer } from '@tokenjunkielabs/starforge-merchant/buyer/node';
import { createSellerClient } from './client/seller-client.mjs';

const buyer = new Buyer({
  runtimeDirectory: fileURLToPath(new URL('../',
    import.meta.resolve('@tokenjunkielabs/starforge-merchant/buyer/node'))),
  stateDirectory: '/private/buyer-state',
  operatorProfile: '/private/buyer-profile.json',
});
const api = createSellerClient({ buyer });
const result = await api.call('catalog', {
  path: {}, query: { region: 'north', after_id: '0' },
}, { intentId: 'catalog-north-001', maxAtomic: '10000', acceptIndex: 0 });
const page = await result.json();
```

Use the generated operation ID, approved input, stable intent, selected payment
option and atomic cap for the actual reviewed offer. The original Buyer owns
review, native execution, recovery and verified response access. Keep exact
database values as strings in the customer integration.

Application hosts import `startMysqlSeller` and `createMysqlNativeFactory` from
`@tokenjunkielabs/starforge-merchant/seller/mysql`, or
`startMysqlMerchantWorkspace` from `seller/mysql/workspace`, using the trusted
host options in the included source guide. The complete browser operating and
lifecycle guide is included at
`source/stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/workspace/README.md`.
Both commands and public imports target these original implementations; the
driver dependency is derived from the selected source's `mysql/package.json`.

### Publish a MySQL or MariaDB data product

The same approved MySQL source can publish an immutable dataset with retained
buyer pages. This product uses the original MySQL pool and prepared statements,
the shared publisher browser and schedule, and the original dataset version
writer. Use the MySQL runtime above, Linux and util-linux `flock`.

```sh
npx --no-install starforge mysql-publisher serve \
  --workspace /private/catalog-publications --create \
  --source /private/mysql-workspace/releases/catalog_v1/package/source.json \
  --state /private/catalog-dataset --port 8447
```

Open the printed loopback URL. Choose the original named query and fixed inputs,
approve its public columns and dataset types, select ordering and extraction
limits, then save the plan. Extract the complete result, inspect the typed
candidate, record a reviewer and note, and publish against the displayed target.
The original endpoint page cap does not truncate this extraction. A row, byte,
type or deadline failure leaves the current published dataset available.

Use transactional source tables such as InnoDB for a consistent database view.
The extraction sets repeatable-read isolation and opens
`WITH CONSISTENT SNAPSHOT, READ ONLY`. Its native row stream waits for the
consumer and commits after the complete result is accepted. Nontransactional
tables retain their engine's own behavior. The candidate records the observed
server/connection/isolation, completed transaction, selected output and hashes.

Choose Text for exact DECIMAL values and large integer identifiers. Safe native
integers, finite native FLOAT/DOUBLE and integer or BIT boolean values have
explicit dataset mappings. Binary Text uses canonical base64. NULL requires a
nullable field; the original CSV format refuses an ambiguous real empty string
in that nullable column. Saved plans retain source/configuration bytes and a
copied CA, while passwords stay in their original environment reference.

After first publication, configure the original seller with the merchant's
actual payment terms and retained snapshot selection:

```sh
npx --no-install starforge dataset-refresh configure \
  --state /private/catalog-dataset --payment /private/catalog-payment.json \
  --origin https://merchant.example --path /data --snapshot-selection \
  --out /private/catalog-seller.json
npx --no-install starforge dataset-refresh serve \
  --state /private/catalog-dataset --seller /private/catalog-seller.json \
  --port 8423 --control-transport loopback
```

Use the existing facilitator and HTTPS deployment options for native paid
operation. Stop and reopen the same publisher with the running seller's actual
loopback address and advertised HTTPS resource:

```sh
npx --no-install starforge mysql-publisher serve \
  --workspace /private/catalog-publications --port 8447 \
  --seller http://127.0.0.1:8423 --resource https://merchant.example/data
```

In **Buyer handoff**, load the original seller's terms, select the payment
alternative and enter an intent ID. Download the original SF88 configuration
and open it in the existing buyer workspace. The selected retained snapshot is
pinned in the URL; the original buyer owns approval, acquisition and response
delivery. Later refreshes preserve older retained pages and cursors according
to the version store's retention policy.

The same browser and CLI offer the original saved publication policy, exact
target binding, row-change limits, pause/enable, retained history and recovery.
`starforge mysql-publisher --help` lists all manual and scheduled actions.
Reopen without `--create` to continue the same source/target-bound workspace.
The original MySQL command also forwards `starforge mysql publisher ...`.

The public `@tokenjunkielabs/starforge-merchant/seller/mysql/publisher` export
provides `openMysqlPublisher(options)`. It delegates to the one maintained
publisher engine with the trusted MySQL source driver. Complete transaction,
scalar, source/CA, native export, operator and customer instructions are included
at `source/stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/publisher/README.md`.
The existing `mysql` runtime group supplies the pinned driver; the shared
publisher source is already part of the whole SF30 component.

### Build a DuckDB or Parquet merchant

The DuckDB merchant workspace begins with actual local files and generates the
original source declaration. Use the distribution's supported Node runtime and
an existing Python 3.10+ environment containing the pinned DuckDB dependency. To
create that environment from the installed application's directory:

```sh
python3 -m venv /private/duckdb-env
/private/duckdb-env/bin/python -m pip install -r \
  node_modules/@tokenjunkielabs/starforge-merchant/source/stellar/scf-starforge-20261009/sf30-seller-sdk/duckdb/requirements.txt
npx --no-install starforge duckdb-workspace \
  --workspace /private/merchant-workspace \
  --data-dir /private/merchant-data \
  --database warehouse.duckdb \
  --parquet exports/events.parquet \
  --python /private/duckdb-env/bin/python
```

`duckdb-workbench` is a compatible command alias for this same workspace.
`--state` and `--workspace` select the same private saved directory. For Parquet
alone, omit `--database` and repeat `--parquet` for each approved file. Existing
native declarations use `--source /private/data/source.json`. The data directory
must permit private metadata writes; selected datasets remain stable regular
files under that directory. The workspace retains its SQLite ownership lock
while open.

Open the printed local URL. **Build a query** inspects actual schemas, selects
buyer-visible columns and adds typed filters and ordering through the original
native query author. Keep the query, preview actual rows, configure merchant
routes and payment terms, and save an immutable merchant/query revision. Review
the exact public choices and prepare the original merchant package, including
copied data and generated API/client files. Inspect, start and stop the merchant
from the same browser.

Reopen with the saved directory and Python environment; the retained source
selection, draft and packages remain available:

```sh
npx --no-install starforge duckdb-workspace \
  --workspace /private/merchant-workspace \
  --python /private/duckdb-env/bin/python
```

Add the original `--facilitator HTTPS_URL` option for native payment-enabled
sessions. On Linux, `--availability-dir /private/merchant-availability` enables
the original durable product pause/resume panel and its `flock` ownership.
**Product availability** opens that authenticated original panel beside the
existing operations console. Keep this directory when restarting the merchant
to retain its availability decisions.

The [complete operator guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/duckdb/workspace/README.md)
is included under the same `source/` path. Applications can import
`startDuckdbWorkspace` from
`@tokenjunkielabs/starforge-merchant/seller/duckdb/workspace` and
`createDuckdbWorkspace` from `seller/duckdb/workspace/model`. Existing
`startDuckdbWorkbench` and `openDuckdbWorkbench` application exports remain at
their original paths. Source, configuration, merchant, preparation, catalog and
query-authoring modules keep their maintained DuckDB export paths.

`doctor` reports optional feature availability and fails only for the requested
feature or native dependency group. It resolves modules without importing them
or opening a database connection.

## Publish a Google Sheets catalog

The installed Sheets source turns an explicitly selected workbook range into
the original versioned dataset product. It supports an authorized live read-only
Google connection and retained CellData from an existing connected Google
session. It uses the same typed publisher, candidate review, dataset versions,
buyer configuration and publication schedule as the database publishers. Use
Node 22.16+ and Linux util-linux `flock`; there is no additional npm dependency.

Create a private working directory outside the installed package. From the
existing connected Google session, save the original Spreadsheet resource for
one exact bounded range, including stable tab ID/title, literal header cells,
`userEnteredValue`, `effectiveValue` and `effectiveFormat.numberFormat`. The
[complete Sheets guide](../sf30-seller-sdk/sheets/README.md) gives the connected
request fields and live OAuth alternative. Retain the original response:

```sh
npx --no-install starforge sheets-source import \
  --resource /private/sheets/provider-resource.json \
  --range "'Catalog'!A1:H500" --directory /private/sheets/capture-001
npx --no-install starforge sheets-source headers \
  --capture /private/sheets/capture-001/capture.json
```

Review the actual headers and declared native types. Copy the packaged
[projection example](../sf30-seller-sdk/sheets/example-projection.json) to the
private workspace and select the intended public columns by absolute letter,
exact header, public alias and scalar type. Unselected columns remain private.
Text identifiers must be stored as actual Sheet text to preserve leading zeros
and large values; formula columns require explicit `formula: "effective"` to
publish Google's calculated result. Formatting is not a numeric conversion.

```sh
npx --no-install starforge sheets-source prepare \
  --capture /private/sheets/capture-001/capture.json \
  --projection /private/sheets/reviewed-projection.json \
  --query catalog --out /private/sheets/source.json
npx --no-install starforge sheets-publisher serve \
  --workspace /private/sheets/publications --create \
  --source /private/sheets/source.json --state /private/sheets/dataset --port 8452
```

Open the printed loopback URL. Review the source and public columns, save the
reviewed plan, extract it, and inspect the original typed candidate. Enter the
reviewer and change note, record the publication review, then publish against
the displayed target revision. Preparation and saving alone do not extract or
publish. A capture-backed saved plan retains its own original resource bytes.
The candidate records one Spreadsheet response, its range, receipt time and
hashes. Original type, header, formula, row and byte checks reject an incomplete
candidate before publication.

After the first publication, configure the native seller with the merchant's
actual payment terms and public HTTPS resource:

```sh
npx --no-install starforge dataset-refresh configure \
  --state /private/sheets/dataset --payment /private/sheets/payment.json \
  --origin https://merchant.example --path /data --snapshot-selection \
  --out /private/sheets/seller.json
npx --no-install starforge dataset-refresh serve \
  --state /private/sheets/dataset --seller /private/sheets/seller.json --port 8423
```

Use the original facilitator and deployment options for native paid operation.
Stop and reopen the same publisher without `--create`, adding that seller:

```sh
npx --no-install starforge sheets-publisher serve \
  --workspace /private/sheets/publications --port 8452 \
  --seller http://127.0.0.1:8423 --resource https://merchant.example/data
```

Choose the published extraction, load the seller's actual terms, select the
payment alternative and download the original buyer configuration. Continue
with the existing private buyer workspace and `starforge buyer-dataset`; its
approval, budgets, acquisition, recovery and delivery are described in the
packaged [dataset acquisition guide](../sf88-operator-buyer-cli/DATASETS.md).
The selected version is retained under the original seller's retention rules.

To update the product, obtain a new actual capture, prepare its reviewed source
revision, and deliberately replace the original private source file. **New
plan** loads that revision; previous saved plans keep their own observation.
A live source instead captures a fresh response on each explicit extraction.
Review and publish the new candidate through the same workspace. The original
saved publication schedule can maintain a live source; a retained capture
continues to represent its original observation. Reopening the same workspace
does not fetch Google data or publish a candidate. Use the original retained
result recovery for interrupted work and retain the workspace with its target.

`starforge sheets-source --help` and `starforge sheets-publisher --help` expose
the maintained CLI options. Application imports
`@tokenjunkielabs/starforge-merchant/seller/sheets`, `/seller/sheets/capture` and
`/seller/sheets/publisher` expose the original source, capture and
`openSheetsPublisher(options)` APIs. The whole SF30 component includes their
guides, examples and shared browser assets. Original captures, source identities,
credentials and operator state belong in the private workspace; the installed
package contains source and placeholder examples.

## Configure an object-store merchant

The original S3 operator uses the existing object source and the official AWS
client. Its exact production dependency comes from the packaged `s3/package.json`:

```sh
npm install --ignore-scripts @aws-sdk/client-s3@3.1149.0
npx --no-install starforge doctor --feature s3
npx --no-install starforge s3 describe --source /private/merchant/object-source.json
npx --no-install starforge s3 configure \
  --source /private/merchant/object-source.json \
  --payment /private/merchant/object-payment.json \
  --origin https://merchant.example --directory /private/new-object-merchant
npx --no-install starforge seller \
  --config /private/new-object-merchant/service.json \
  --handlers /private/new-object-merchant/handlers.mjs
```

The bundled `source/stellar/scf-starforge-20261009/sf30-seller-sdk/s3/README.md`
and `example-source.json` define the existing source declaration, explicitly
selected objects, retained snapshots, byte ranges and AWS credential provider.
`describe` reads actual object metadata; `inspect` retrieves the selected object
or chunk into a new local file. `configure` prepares a new original merchant
configuration and handler module for those exact objects and payment terms.

These operations use the operator's configured provider and actual storage
reads. `doctor` only checks module resolution. The seller retains its original
facilitator and native payment options. Generated handlers reference the
installed toolkit location, so create them on the intended operator host and
regenerate them if that installation moves. The `./seller/s3` and
`./seller/s3/config` package imports expose the same original source and
configuration APIs. Importing them does not itself load the AWS client or access
storage; opening the configured source uses its original provider.

## Review merchant pricing and operations

Use the original merchant pricing workspace, pricing importer and accounting
workspace from the same installed package. Keep their private state and the
merchant's original sources outside the package installation directory.

Use Node 22+ and the merchant's actual seller configuration and existing
operations listener:

```sh
npx --no-install starforge revenue-workspace \
  --config /private/merchant/seller-service.json \
  --state /private/merchant/pricing-workspace \
  --ops-url http://127.0.0.1:8424 --port 8457
```

Open the private browser URL printed by the original workspace. Replace the
configuration and operations port with that merchant's actual values. The parent
of each private state directory must already exist; pricing state uses a local
filesystem with atomic hard links and directory synchronization.

Choose the current session or retained history in the source panel. For live
history, select the actual UTC interval and optional original route filter. The
existing operations service supplies the retained history and effective range.
For saved exports, replace `--ops-url` with `--snapshot /private/original-session.json`
or `--history /private/original-history.json`; both file flags may be supplied to
switch between those fixed exports. File selections retain their exported range.
Add `--native-outbox /private/merchant/sf98-outbox` to include the original native
settlement companion for that merchant.

Refresh the selected source, enter the merchant's quoted USD values, quote
bases, known costs and monthly targets, and review every ordered payment option.
Calculate with the original analyzer, then save. A saved version retains the
exact seller, terms, original capture, report and optional native companion.
Compare saved periods with their original coverage and source identities; reopen
versions or reuse their assumptions for a new review. The monthly target applies
once to its original service scope. Unknown costs remain unknown, and observed
HTTP outcomes retain their original meaning.

After restart, reopen the same `--state` directory. To reproduce a retained-period
report, use the matched files from one saved version and a new output directory:

```sh
npx --no-install starforge revenue-report \
  --config /private/review/seller.json --terms /private/review/terms.json \
  --history /private/review/history.json --output /private/new-pricing-report
```

For a session review, replace `--history` with that version's `--snapshot` file.
The included [original pricing guide](../sf97-merchant-revenue-ops/WORKSPACE.md)
describes history enablement, range selection, source retention and comparisons.

### Turn a saved pricing review into a merchant price change

In **Saved reviews**, choose **Prepare price change**, enter the explicit atomic
amounts for the selected payment choices, and review every before-and-after term.
Save a named decision to retain the new seller configuration, a local launch
configuration with original file paths resolved, rebound merchant terms and the
complete original pricing inputs. USD quotes and cost assumptions keep their
entered values. Saved decisions reopen in the same pricing workspace.

For an existing API merchant package, start the same command with
`--source-package /private/merchant/original-api-package`. The decision then
includes a complete updated package produced by the original compiler. Add
`--release-store /private/merchant/releases` and, when configured,
`--release-runtime /private/merchant/release-runtime.json` to **Stage retained
release** from the saved decision. The original release console reviews,
selects and starts that retained version. A repeated stage recovers its original
release ID. The [pricing guide](../sf97-merchant-revenue-ops/WORKSPACE.md) covers
the full source, export, staging and recovery workflow. Applications use
`./merchant/revenue-model`, `./merchant/repricing` and
`./merchant/repricing-source` for these same implementations.

The original merchant MCP operator exposes this same workflow through its
`merchant_pricing_*` tools. A host-declared pricing connection selects saved
sources and release stores; `merchant-mcp init-pricing` connects an agent to the
existing workspace. See the included
[merchant pricing MCP guide](../../../stellar-forge/mcp-merchant-operator/PRICING.md)
for commercial reviews, explicit amount decisions, retained downloads and
release activation through the original operator.

## Operate merchant incidents and support cases

The original incident watcher follows the running seller and operations listener,
retains actionable incidents and measured recovery, and exports their original
captures into the existing merchant case desk. It requires Node 22+, Linux with
util-linux `flock`, and private local state supporting atomic rename and fsync.

Copy the included `source/stellar/scf-starforge-20261009/` file
`sf93-seller-support-bundle/examples/watch.json` from the installed package into
your private operator directory. Set its merchant IDs, labels and exact local
seller/operations addresses to those printed by your existing launchers. Make the
configuration private (mode 0600). For notifications, supply the configured URL
and signing-secret environment references to the watcher and operator commands;
the secret needs at least 32 UTF-8 bytes. Set `notification` to `null` when only
local incident operation is wanted.

```sh
npx --no-install starforge support-watch init \
  --config /private/operator/watch.json --state /private/operator/incidents
npx --no-install starforge support-watch run --state /private/operator/incidents
```

The state directory must be new and its parent must exist. Reopen that same
directory on later runs. One watcher owns its kernel lease; SIGINT/SIGTERM ends
its pending collection and finishes its state write. Keep the original seller
and operations processes running under their existing lifecycle.

In a second terminal, read the actual incident ID and revision, then acknowledge
ownership while collection continues:

```sh
npx --no-install starforge support-watch status \
  --state /private/operator/incidents --details
npx --no-install starforge support-watch ack \
  --state /private/operator/incidents --incident ACTUAL_INCIDENT_ID \
  --revision ACTUAL_INCIDENT_REVISION --by 'Merchant operator' \
  --note-file /private/operator/repair-note.txt
```

Acknowledgment retains ownership and notes; recovery follows subsequent usable
observations. The original commands also provide `notify`, `retry`, `cancel`,
`configure` and `prune`. Notifications retain event/body identity across retries
and pin their selected destination. Use an explicit `notify` to select a changed
destination for an incident. `INCIDENT_OPERATIONS.md` documents the exact signed
hook protocol, attempt/revision inputs, retention and restart behavior.

### Keep the original case and handoff

Open the existing local case desk with durable storage:

```sh
npx --no-install starforge support-console \
  --cases-dir /private/merchant-cases --port 8784
```

For a saved incident, select the existing private merchant workspace, an actual
captured route ID and the current incident revision:

```sh
npx --no-install starforge support-watch export \
  --state /private/operator/incidents --incident ACTUAL_INCIDENT_ID \
  --revision ACTUAL_INCIDENT_REVISION \
  --workspace /private/operator/merchant.merchant-workspace.json \
  --route ACTUAL_ROUTE_ID --out /private/operator/incident-handoff
```

The destination must be new. In the desk's **Runtime** stage, choose **Open a
complete support handoff**, open the exported `support-handoff.json`, then choose
**Open handoff as new case** and **Save case**. Original baseline/follow-up files,
incident identity, acknowledgment and session boundaries stay with that case.

The original one-shot packet command remains available:

```sh
npx --no-install starforge support \
  --seller http://127.0.0.1:8423 --ops http://127.0.0.1:8424 \
  --out /private/operator/merchant-before
```

Use the actual running addresses and a new destination with an existing parent.
Select all four packet files in **Runtime**, inspect them, choose the matching
route and attach them to the case. Attach a later packet as **After / follow-up**,
save the owner and next action, then reopen after restart or restore a saved
version. The same desk accepts original `history.json` with its matching SF97
`report.json` and optional original SF98 journals. **Prepare support handoff**
exports a readable report and complete importable case. Included SF74 guides
`RUNTIME_SUPPORT.md`, `CASE_DESK.md` and `WORKSPACES.md` cover collection, retained
periods, native reconciliation, saved versions and private-directory recovery.

The public module entries expose these unchanged original APIs:

| Import subpath | Original interface |
| --- | --- |
| `./merchant/incidents` | `runIncidentWatch` with caller-owned cancellation and environment |
| `./merchant/incidents/store` | `initializeIncidentStore` and `openIncidentStore` |
| `./merchant/incidents/operator` | Status, acknowledgment, notification operations, configuration, pruning and `exportIncident` |
| `./merchant/support-console` | `start` and `createConsoleServer` for the same case desk |

## Use saved pricing in merchant accounting

Download **Report JSON** from the chosen saved pricing version, or select its
private `versions/VERSION/report/report.json`. The original report supplies the
normalized payment options and calculated route values; pricing `terms.json` is
an input to that report and does not contain the complete accounting import.

```sh
npx --no-install starforge merchant-accounting-pricing \
  --report /private/merchant/pricing-workspace/versions/VERSION/report/report.json \
  --out /private/merchant/pricing-import-2026-10-11
```

Use a new output directory with an existing parent. The import retains the exact
original report as `pricing-report.json`, produces validated `accounting-terms.json`
and writes their identities and import summary to `manifest.json`. The directory
uses mode 0700 and files use 0600. If the quote basis needs a shorter accounting
reference, add `--reference "Approved merchant quote October 2026"`; the complete
original basis remains in the retained pricing context. The
[pricing import guide](../merchant-settlement-accounting/PRICING.md) documents the
reference rules and the exact mapping.

Every original option keeps its route, method, network, asset, recipient and
atomic amount. The quote and per-fulfilled variable cost become accounting unit
terms; unknown costs remain null. Shared fixed costs, challenge costs, targets
and the pricing observation interval remain attached pricing context. The
accounting event scope comes from the selected journals and verification inputs.

Open a new accounting workspace using those imported terms and the merchant's
actual original sources:

```sh
npx --no-install starforge merchant-accounting-workspace \
  --workspace /private/merchant/accounting-workspace \
  --outbox /private/merchant/sf98-outbox --proof-dir /private/merchant/sf86-results \
  --terms /private/merchant/pricing-import-2026-10-11/accounting-terms.json
```

For an existing workspace, open **Sources & imports**, select the generated
`accounting-terms.json` under **Merchant accounting terms**, and choose
**Import & select terms**. Then create a new capture from **Reconcile & review**.
Earlier runs retain their own terms and sources, so the existing comparison
shows which assumptions and settlement inputs changed. Search the ledger and
exceptions, retain review notes, and export the original reports and source TAR.
Reopen after restart with `--workspace` alone. The accounting workspace requires
Linux `flock` and `tar` in addition to Node 22+.

For a terminal review, the original accounting command consumes the same terms:

```sh
npx --no-install starforge merchant-accounting \
  --outbox /private/merchant/sf98-outbox --proof-dir /private/merchant/sf86-results \
  --terms /private/merchant/pricing-import-2026-10-11/accounting-terms.json \
  --out /private/merchant/new-accounting-review
```

The original outputs are `report.json`, `ledger.csv`, `options.csv`,
`exceptions.csv`, `review.html` and `manifest.json`. The included
[accounting workspace guide](../merchant-settlement-accounting/workspace/README.md)
covers retained imports, captures, review, comparison, export and restart.

### Include an original completed purchase

The same accounting workspace can connect an existing recovered-settlement
collection in **Sources & imports**, retain and review the original recovery
request, run the original import, and download the retained response. For CLI
operation, use the existing request configuration from the
[recovery guide](../merchant-settlement-accounting/RECOVERY.md):

```sh
npx --no-install starforge merchant-accounting-recovery review \
  --config /private/purchase/recovery-request.json
npx --no-install starforge merchant-accounting-recovery import \
  --config /private/purchase/recovery-request.json \
  --recovered-dir /private/merchant/recovered
npx --no-install starforge merchant-accounting-recovery list \
  --recovered-dir /private/merchant/recovered
npx --no-install starforge merchant-accounting-recovery response \
  --recovered-dir /private/merchant/recovered --id ACTUAL_RECOVERY_ID \
  --out /private/purchase/reopened-response.json
```

Use the original approved request, outcome, matching merchant terms, known payer
and optional saved response. Review checks those retained records. Import uses the existing native SDK and original verifier to read the
completed transaction from its declared public RPC, then retains the verified
entry and response. An identical retained import is reused. Use the recovery ID returned by import or list; `response` exports the saved
body to a new private file. This workflow operates the completed purchase's records.

Connect that collection in the workspace or add
`--recovered-dir /private/merchant/recovered` to its initial launch. The original
`merchant-accounting` command accepts the same optional input. Reports retain
separate captured and recovered origins and time bases, and apply the
existing verification and transaction matching rules across both. Pricing
imports and recovery records keep their own source identities in the same
merchant review.

### Exchange a completed reconciliation with an accountant

Open the same retained accounting workspace:

```sh
npx --no-install starforge merchant-accounting-workspace \
  --workspace /private/merchant/accounting-workspace --port 0
```

Choose **Accountant handoffs**. Select a completed reconciliation or an original
retained recorded-activity close, name the handoff, and supply the asset, atomic
unit and account labels for its actual payment options. Save, then download the
accountant CSV, offline review or complete handoff archive. The archive retains
the original report and manifests, handoff identity, and any selected original
close and frozen review notes.

The accountant edits only `externalStatus`, `externalBookRef`,
`externalAccountCode` and `externalNote`. Statuses are `UNREVIEWED`, `REVIEWED`,
`BOOKED` and `EXCLUDED`; `BOOKED` requires the accountant's external book
reference. Several events may share a reference for a batch entry. Keep the
original event, payment option, network, asset, native amount, evidence and
supplied labels intact. Numeric text beyond 15 digits is escaped for spreadsheet
precision, and the original source remains attached to every row.

Select the latest retained handoff version, upload the returned CSV and preview
its exact matches, changes, conflicts and omitted events. Save the preview to
retain the original returned bytes and complete results. Valid matching rows
update the accountant's returned information; conflicting and omitted events
retain their preceding assignments. A later partial return continues from that
saved version. Reopen any earlier version or download the latest complete CSV,
offline review and archive from the same workspace. The upload limit is 64 MiB.

Applications use the maintained public import:

```js
import { createHandoff, importReturn, inspectHandoff, renderCsv, renderHtml }
  from '@tokenjunkielabs/starforge-merchant/merchant/accountant';
```

These pure functions consume the original report bytes, original run/manifest
hashes, optional saved close bytes and retained labels. `importReturn` accepts
the previous immutable return as `parentRevision`; its result includes complete
assignments and row-level outcomes. The existing workspace supplies persistence,
preview/save and downloads. The included
[accountant contract](../merchant-settlement-accounting/accountant/SCHEMA.md)
defines the exact source and return schemas. Original verification, network,
atomic asset units and quoted USD remain visible beside the accountant's
reported external entry.

### Application imports

`@tokenjunkielabs/starforge-merchant/merchant/revenue-workspace` exports the
original `startWorkspace`; its `directory` is the CLI's private `--state`.
`./merchant/accounting` and `./merchant/accounting-workspace` expose the original
reconciler and retained workspace. `./merchant/accounting-pricing` exports
`createAccountingTermsFromPricingReport`, `preparePricingReportImport` and
`writePricingReportImport`; use the byte preparation or writer when retaining
original report provenance. `./merchant/recovery` exposes the same original
review, import, retained-entry and response APIs used by the CLI. The pricing
and accounting join adds no package dependency; recovery uses the existing
native SDK setup.

### Recover a completed buyer purchase

The original recovery command joins a completed SF31 purchase to this same
merchant accounting workspace. Use the actual retained buyer outcome, original
approved request, exact merchant terms, known payer and original saved response.
The included [recovery guide](../merchant-settlement-accounting/RECOVERY.md)
defines the private request file and canonical network/RPC selection.

```sh
npx --no-install starforge merchant-accounting-recovery review \
  --config /private/purchase/recovery-request.json
npx --no-install starforge merchant-accounting-recovery import \
  --config /private/purchase/recovery-request.json \
  --recovered-dir /private/merchant/recovered
npx --no-install starforge merchant-accounting-recovery response \
  --recovered-dir /private/merchant/recovered --id ACTUAL_RECOVERY_ID \
  --out /private/purchase/reopened-response.json
```

Use the recovery ID returned by the original import and a new response output.
An identical import reopens the retained entry without repeating its RPC reads.
`list --recovered-dir /private/merchant/recovered` reopens the collection locally.
The initial import uses the original Stellar observer and records its actual
network-specific transfer result; it does not purchase the resource again.

Connect that private collection in the existing accounting browser, or append
`--recovered-dir /private/merchant/recovered` to its initial workspace command.
Review the original request, retain import progress and capture a reconciliation.
The workspace keeps native and recovered source counts and time bases separate,
provides the exact saved response, compares retained payment-option totals and
exports the same original reports with optional captured sources. Its ordinary
`merchant-accounting` command accepts the same optional `--recovered-dir`.
The public `./merchant/recovery` entry exposes the original importer, collection
reader and saved-response export for applications embedding this workflow.

## Run an existing Python merchant

The maintained Python merchant entrypoint is included alongside the buyer
application. With the operator's existing Python merchant configuration:

```sh
npx --no-install starforge python-merchant inspect --config /private/merchant/python.json
npx --no-install starforge python-merchant diagnose --config /private/merchant/python.json
npx --no-install starforge python-merchant serve \
  --config /private/merchant/python.json --port 8423 --operations-port 8424
```

`inspect` reads configuration. `diagnose` imports the configured application,
initializes its workers and closes them without invoking a public function.
`serve` uses the original SF30 seller and operations lifecycle, with its existing
facilitator options for native execution. Use the packaged
`sf30-seller-sdk/python/README.md` for the complete application, worker and
preview interface. The `./seller/python` and `./seller/python/config` package
subpaths expose the same runtime and configuration functions to applications.

### Author and operate a Python merchant workspace

Use Node 22.13 or later for the original workspace's built-in SQLite store and
the Python interpreter selected by the merchant declaration. The existing SF30
and SF82 source components include its browser, retained source model, private
preview runner and native release lifecycle. No additional workspace dependency
or browser build is required.

Select the existing declaration and, when the application imports local helpers,
its explicit source root. Keep the new workspace outside that source root:

```sh
npx --no-install starforge python-workspace create \
  --workspace /private/python-authoring \
  --config /private/application/merchant.json \
  --python-root /private/application --label "Python merchant"
npx --no-install starforge python-workspace serve \
  --workspace /private/python-authoring --port 0
```

Open the printed operator URL. The browser binds to loopback and uses its native
token and origin boundary. Create and import require new destination directories.
Omitting `--python-root` captures only the original entry module. Selecting it
retains the original permitted helpers/assets: at most 512 files and 32 MiB,
with the original 8 MiB asset and 2 MiB entry limits.

Use **Application** and **Functions & terms** to edit retained source, the entry
module and complete raw declaration. The structured function editor preserves
fields that do not have their own form controls. Saving creates an immutable
revision with the expected current head; an intermediate declaration retains
the original compiler diagnostic. Historical revisions remain read-only until
an explicit restore creates another revision.

**Try a function** executes the selected saved source with explicit input through
the original Python workers. Private preview is application execution outside
the customer payment request path. Its retained operation ID binds the exact
revision, function and input; replay returns the same saved operation. Complete
result bytes and native pool/shutdown details remain downloadable. Creating,
editing, inspecting and staging source do not import the Python application.

The equivalent terminal preview uses the saved revision ID from `status` or the
browser and an existing JSON input file:

```sh
npx --no-install starforge python-workspace status --workspace /private/python-authoring
npx --no-install starforge python-workspace preview \
  --workspace /private/python-authoring --revision r-saved-revision-id \
  --function summarize --input /private/summary-input.json \
  --operation summary-preview-001 --out /private/new-summary-result.json
```

In **Releases**, stage a selected revision under a new native release ID, inspect
its retained source, and compare it with another release or no previous release.
Activate using the displayed original selection generation, then run the
selected release. Activation selects source; restarting changes this console's
owned running instance. The original generation, stop, drain and rollback
semantics apply. The terminal stage and first-release comparison are:

```sh
npx --no-install starforge python-workspace stage \
  --workspace /private/python-authoring --revision r-saved-revision-id \
  --id python-001 --port 8423
npx --no-install starforge python-workspace diff \
  --workspace /private/python-authoring --to python-001
```

The example stages the original challenge profile. Select the actual native
`--facilitator` when staging a merchant that should execute paid requests.
Without one, its native runtime is `CHALLENGE_ONLY` and imports no Python app.
The browser's customer handoff exports the original client from the owned
running seller's `/_seller/openapi.json`; its JavaScript, declarations, OpenAPI,
package metadata and guide remain retained under an explicit export name.

The browser commits local drafts and exact pending mutations to IndexedDB under
the immutable workspace ID. Reopening retains unsaved edits and source-bound
preview outcomes. An unfinished preview whose owner ended becomes interrupted;
it is not automatically executed again. Interrupting the foreground console or
preview waits for its owned original workers and seller manager to close.

Export the full history and reopen it at a new path:

```sh
npx --no-install starforge python-workspace export \
  --workspace /private/python-authoring --out /private/python-handoff.json
npx --no-install starforge python-workspace import \
  --workspace /private/python-reopened --bundle /private/python-handoff.json
npx --no-install starforge python-workspace serve \
  --workspace /private/python-reopened --port 0
```

The original portable bundle retains raw declarations, source/output blobs,
all revisions and previews, native release files and selection history, stage
mappings and completed customer exports. Import verifies retained bytes and
source hashes; the reopened runtime is stopped. Old absolute source paths are
not refreshed on the new host. The existing 256 MiB bundle limit leaves all
history available in the original local workspace if an export is too large.

Applications can embed the same model and console through the maintained public
entries:

```js
import { createWorkspace, openWorkspace, importWorkspace }
  from '@tokenjunkielabs/starforge-merchant/seller/python/workspace';
import { startPythonWorkspace }
  from '@tokenjunkielabs/starforge-merchant/seller/python/workspace/server';

const consoleServer = await startPythonWorkspace('/private/python-authoring', {port: 0});
console.log(consoleServer.operatorUrl);
// Await consoleServer.close() when the owning application shuts down.
```

The included `sf30-seller-sdk/python/workspace/README.md` documents the original
source patches, complete CLI, retained operation states and HTTP API. The
installed command forwards directly to that original entrypoint.

## Turn Cube reports into a merchant

The installed `cube-onboarding` command uses the original Cube metadata capture,
reviewed fixed-query compiler, private plan and portable merchant package.
Prepare the actual backend metadata and merchant plan using the included
`sf102-cube-paid-query-adapter/onboarding/README.md`, then run:

```sh
npx --no-install starforge cube-onboarding prepare \
  --metadata /private/cube-meta.json --plan /private/cube-plan.json \
  --dir /private/cube-merchant
npx --no-install starforge cube-onboarding export \
  --dir /private/cube-merchant --out /private/cube-package
npx --no-install starforge cube-onboarding launch \
  --package /private/cube-package -- --port 8423 --operations-port 8424
```

Capture and probe contact the explicitly configured Cube backend. Preparation,
review, export and buyer-draft creation use retained inputs. The installed alias
resolves its own original SF30/SF88 runtime. If launching the exported package
directly, its `launch.mjs --runtime` option accepts the installed package's
`source/stellar/scf-starforge-20261009` directory. The `./seller/cube/onboarding`,
`./seller/cube/package` and `./seller/cube/runtime` subpaths expose the same
original workspace, packaging and lifecycle APIs. Cube adds no npm dependency.

## Publish approved GraphQL queries

The original GraphQL product captures the actual schema, validates approved
queries and payment terms, then emits the original merchant service, query
configuration and generated customer client. Its maintained package manifest
supplies the exact optional `graphql` dependency. Install the original pinned
dependency in the application directory and check it before onboarding:

```sh
npm install --ignore-scripts --save-exact graphql@16.14.2
npx --no-install starforge doctor --feature graphql
npx --no-install starforge graphql-workspace \
  --workspace /private/graphql-merchants --port 0
```

The browser requires Linux, Node 22+ and util-linux `flock`. It manages the
original private schema/query workspace and seller, with retained review,
export and reopening. The equivalent terminal preparation is:

```sh
npx --no-install starforge graphql-onboarding prepare \
  --schema /private/schema-source.json --queries /private/approved-queries.json \
  --plan /private/graphql-plan.json --directory /private/graphql-release
npx --no-install starforge graphql-merchant \
  --seller /private/graphql-release/service.json \
  --queries /private/graphql-release/queries.json --check
```

Use the included `sf105-subquery-graphql-merchant/README.md`,
`onboarding/README.md` and `workspace/README.md` for actual schema capture, backend
configuration, native serving and buyer preparation. The GraphQL runtime adds
no SubQuery server or database fixture dependency to the installation.
`./seller/graphql`, `./seller/graphql/schema`, `./seller/graphql/onboarding`
and `./seller/graphql/workspace` expose their existing module APIs.

### Compare and revise a retained merchant

Use the provider's new served schema and a complete previously prepared merchant
directory to review changes to approved queries, selected contracts and native
payment terms. Compare the explicit candidate before exporting its replacement:

```sh
npx --no-install starforge graphql-onboarding compare \
  --previous /private/graphql-release --schema /private/new-served-schema.json \
  --queries /private/revised-queries.json --plan /private/revised-plan.json
npx --no-install starforge graphql-onboarding revise \
  --previous /private/graphql-release --schema /private/new-served-schema.json \
  --queries /private/revised-queries.json --plan /private/revised-plan.json \
  --directory /private/graphql-revision
```

Omit `--queries` or `--plan` to retain the corresponding original source file.
The new revision directory must not exist; its parent must exist and it must be
outside the previous merchant package. Review `revision/review.html` and
`merchant/review.html` inside that directory. The original exporter creates the
replacement in `merchant/` and preserves the complete prior package in
`previous/`. Use `graphql-merchant` with the replacement's `merchant/service.json`
and `merchant/queries.json`; use `merchant/` as `--previous` for another revision.
These comparison and preparation commands operate offline. Selecting the prior
package still requires a provider that serves its original query contract.

Applications can use the same file-based review and preparation APIs through
the public revisions entry:

```js
import {
  reviewSubQueryRevision,
  prepareSubQueryRevision,
} from '@tokenjunkielabs/starforge-merchant/seller/graphql/revisions';
```

The module also exports `readSubQueryMerchantBundle` and
`compareSubQueryMerchantSchemas` for retained-package and in-memory schema review.
The included `sf105-subquery-graphql-merchant/onboarding/REVISIONS.md` documents
their exact arguments, return values, compatibility statuses and retained files.

### Deploy the reviewed GraphQL merchant

The installed `graphql-deployment` command uses the original deployment compiler
over a complete reviewed merchant directory, including the `merchant/` output
of the revision workflow. It reopens the original manifest and retained files,
recompiles the served schema, queries and plan, and prepares the original SF82
release inputs and SF99 host handoff. Use the same original pinned GraphQL
dependency and `doctor --feature graphql` check described above.

Prepare on the intended host or at its intended absolute source/configuration
paths: the native release and host retain those paths. Use new destinations with
existing parents:

```sh
npx --no-install starforge graphql-deployment prepare \
  --merchant /private/graphql-revision/merchant \
  --directory /private/graphql-deployment-001
npx --no-install starforge graphql-deployment inspect \
  --directory /private/graphql-deployment-001
```

An explicitly selected same-host HTTP GraphQL backend uses the original
`--allow-loopback-upstream` preparation option. Preparation and inspection
retain the original adapter identity, approved queries, exact ordered payment
choices and credential names. They make no upstream request or credential-value
read. The prepared directory includes the unchanged merchant package, named
handler entry, original SF61 release inputs, source identity and `RUN.md`.

Initialize a new original release store once, or use the existing operator
store. Stage and inspect the same prepared source through installed commands:

```sh
npx --no-install starforge releases init --store /private/graphql-releases
npx --no-install starforge graphql-deployment stage \
  --directory /private/graphql-deployment-001 \
  --store /private/graphql-releases --id graphql-001 --port 8423
npx --no-install starforge releases inspect \
  --store /private/graphql-releases --id graphql-001
npx --no-install starforge releases diff \
  --store /private/graphql-releases --to graphql-001
npx --no-install starforge releases console \
  --store /private/graphql-releases --port 8425
```

The example stages a challenge profile. Supply the actual selected
`--facilitator` to stage the existing native merchant, and provide any named
GraphQL credential in the launching environment. Use the original release
console or fleet for selection, activation, run, stopping and rollback. Their
current generation and instance ownership stay authoritative; a prepared
deployment does not start another supervisor. All original ordered payment
choices retain their atomic amount strings and complete native fields.

For the original Linux host path, supply its normal host-settings JSON, then
prepare the existing installation:

```sh
npx --no-install starforge graphql-deployment host \
  --directory /private/graphql-deployment-001 \
  --plan /private/graphql-host-settings.json \
  --destination /private/graphql-host-001
```

The compiler supplies the inspected API config and handler paths to SF99.
Select the native service user/group, private root, environment-file path,
ports and actual facilitator in the host settings. If queries name a credential,
the original host requires its private environment file before installation.
Use the generated `installation/RUNBOOK.md` for the existing host check,
service-account access, Caddy/systemd installation, lifecycle, recovery and
public smoke workflow. Choose the release-store or host lifecycle appropriate
to the installation; their ports must not overlap.

The private GraphQL workspace includes the original browser deployment flow.
Its retained merchant and deployment identities reopen through the same APIs.
Applications can use the compiler's structured results through:

```js
import {
  prepareSubQueryDeployment, inspectSubQueryDeployment,
  stageSubQueryDeployment, prepareSubQueryHost,
} from '@tokenjunkielabs/starforge-merchant/seller/graphql/deployment';
```

Use `sf105-subquery-graphql-merchant/deployment/README.md` for native host settings,
exact returned paths/identities, preparation limits and release representation.
The maintained package includes the original deployment compiler and browser
source alongside their SF30, SF61, SF82 and SF99 dependencies.

## Connect a WooCommerce checkout

The complete original bridge is included under
`source/stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge`.
Install its nine plugin files together on the merchant's existing
WordPress/WooCommerce host: `starforge-sf98-woo.php`, `checkout-gateway.php`,
`checkout-admission.php`, `merchant-console.php`, `merchant-console.js`,
`merchant-console.css`, `merchant-operator.php`, `OPERATIONS.md` and
`NATIVE_REVIEW.md`. The maintained Site packet copies this complete folder.
The plugin requires PHP 8.0+ and the host's existing WordPress MySQL/MariaDB
connection; it has no Composer or separate browser build dependency.

Use its included `GATEWAY.md` to configure the original classic/Blocks checkout,
map the actual product, and export that merchant route. Prepare and inspect it
through the installed command:

```sh
npx --no-install starforge woo-seller prepare \
  --route /private/woo-product-route.json --store-origin https://shop.merchant.example \
  --outbox /private/merchant-sf98 --out /private/woo-merchant.json
npx --no-install starforge woo-seller inspect --config /private/woo-merchant.json
npx --no-install starforge woo-seller serve \
  --config /private/woo-merchant.json --facilitator https://facilitator.merchant.example \
  --port 8423 --operations-port 8424
```

Use the deployment's actual origins and original native SDK/facilitator setup.
Serving loads the existing shared `SF98_WEBHOOK_SECRET` from the environment.
`woo-buyer inspect` and `woo-buyer prepare` import the actual Woo order handoff
into original SF88 review or its existing workspace. The original SF98 delivery
worker and Woo merchant review remain the fulfillment flow. The full source
guide includes those commands, retained order generations and recovery.
`./seller/woocommerce` and `./buyer/woocommerce` expose the same original APIs.

### Review the original transfer and complete the selected Woo order

The installed `woo-operator` command joins a manager-authenticated WordPress
order, its original SF98 outbox event, the successful native receipt and the
existing SF86 Stellar transfer verifier. Save the operator config described in
`sf104-woocommerce-merchant-bridge/NATIVE_REVIEW.md`, using the store's exact URL,
private source outbox, review directory and existing Application Password
environment names. Then run:

```sh
npx --no-install starforge woo-operator inspect \
  --config /private/woo-operator.json --order 456
npx --no-install starforge woo-operator review \
  --config /private/woo-operator.json --id order-456-native --order 456 \
  --record /private/original-native-record.json --payer G_TRUSTED_PAYER
npx --no-install starforge woo-operator release \
  --config /private/woo-operator.json --id order-456-native --confirm-order 456
npx --no-install starforge woo-operator show \
  --config /private/woo-operator.json --id order-456-native --live
npx --no-install starforge woo-operator export \
  --config /private/woo-operator.json --id order-456-native --out /private/order-456-handoff
```

Use the actual original native record and valid payer address. Review preserves
the selected source before its read-only RPC work, so `resume` continues that
same operation after interruption. Release rechecks the current order, invokes
the original locked Woo controller and independently reads back the paid order,
accepted event and retained review. `show`, `history` and `export` reopen saved
work offline. The `./merchant/woocommerce` export exposes the same application
functions. All nine plugin files, the CLI and their original dependencies ship
from the selected package source.

## Embed in an application

### Add a merchant to an existing Node or Express application

The `@tokenjunkielabs/starforge-merchant/seller/embedded` package entry exposes
the original SF30 seller as Node, Connect or Express middleware, with TypeScript
declarations. The host application keeps its listener, authentication, free
endpoints and process lifecycle. It uses the same compiled offers, original
facilitator client and paid handlers as the standalone seller.

```js
import { createEmbeddedSeller } from
  '@tokenjunkielabs/starforge-merchant/seller/embedded';
import { createNativeSellerServer } from
  '@tokenjunkielabs/starforge-merchant/seller/native';

const merchant = await createEmbeddedSeller({
  routes: applicationPaidRoutes,
  nativeFactory: compiled => createNativeSellerServer(compiled, {
    facilitatorClient: applicationFacilitatorClient,
  }),
  contextFromRequest: req => ({ account: req.account }),
  maxInFlight: 32,
  drainGraceMs: 60000,
});

app.use(existingAuthentication); // Complete authentication without parsing the body.
app.use(merchant.middleware);
app.use(express.json());
app.use(existingApplicationRoutes);
```

`applicationPaidRoutes` is the application's original SF30 route list: each route
has an `id`, a complete `offer` or `definition`, and its existing `handler` plus
optional readiness `admit`. The original handler receives the request's method,
URL, query, body, path parameters, headers, signal and deadline. It executes the
application operation through the original native payment workflow. Existing
API-key authentication, entitlements and current quote policy remain in the
host's chosen request path. Mount the seller before body parsers for paid paths;
unknown paths continue through the application's existing middleware.

`getEmbeddedRequestContext()` from the same package entry returns the explicitly
selected account/context throughout asynchronous admission and handler work.
An Express mount preserves the complete `originalUrl`, including its query.
Configured paid paths retain ownership across wrong-method and equivalent-path
requests. The original merchant explorer, OpenAPI, client downloads, health,
offers and readiness remain available under `/_seller`.

A plain Node server can `await merchant.handle(req, res)` and continue to its
existing handler when it returns `false`. `await merchant.close()` drains this
merchant while the host's listener and other routes stay available. Observe its
original drain error and close the host listener in the application's own
shutdown handler when the entire application should exit.

Run the packaged example without installing Express or another payment engine:

```sh
node ./node_modules/@tokenjunkielabs/starforge-merchant/source/stellar/scf-starforge-20261009/sf30-seller-sdk/embedded/example-node.mjs
```

The example serves `/health`, the original `/api/dataset` challenge and
`/_seller/docs` from one listener. The installed `sf30-seller-sdk/embedded/README.md`
contains the complete native facilitator, mount-path, request-context and drain
guide. Node 22.16+ is required; native execution uses the existing optional
dependencies described above.

### Optional Python buyer applications

The original Python 3.11+ buyer adapter and its install metadata are included.
Its runtime root is the installed package's `source` directory, so no separate
Git checkout is needed:

```sh
python3 -m pip install \
  ./node_modules/@tokenjunkielabs/starforge-merchant/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python
export STELLAR_FORGE_CHECKOUT="$PWD/node_modules/@tokenjunkielabs/starforge-merchant/source"
stellar-forge-buyer --state /absolute/private/data-buyer list
```

The Python guide covers original configuration import, review, explicit
operator execution, restart recovery, JSON/CSV streaming and verified file
exports. It uses the same installed Node buyer and operator modules. Keep its
private application state outside `node_modules` so it survives package updates.

### JavaScript applications

The original Node customer adapter is available from
`@tokenjunkielabs/starforge-merchant/buyer/node`, with its original TypeScript
declarations. Its `Buyer` accepts the installed original runtime directory and
private application state. `starforge buyer-node` runs its existing generated
client example through review, execution, recovery and listing:

```sh
npx --no-install starforge buyer-node list \
  --runtime "$PWD/node_modules/@tokenjunkielabs/starforge-merchant/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli" \
  --state /absolute/private/customer-purchases
```

`--runtime` identifies the installed `sf88-operator-buyer-cli` directory.
The included `sf88-operator-buyer-cli/node/README.md` explains the existing
operator profile, generated-client interface, durable intent, explicit native
approval and recovery. Keep customer state outside the installed package.

The installed package exposes complete customer and operator workflows as well
as the original seller primitives:

```js
import { readSellerConfig, startSellerService, startSellerOperations }
  from '@tokenjunkielabs/starforge-merchant';

const config = await readSellerConfig('./merchant/seller.json');
const seller = await startSellerService({ config, port: 0 });
const operations = await startSellerOperations(seller, { port: 0 });
console.log({ seller: seller.url, dashboard: operations.url });
// Retain both original close functions in the application's shutdown handler.
```

Public subpaths expose the original seller compiler, HTTP adapter, native
factory, operations server, buyer client and its TypeScript declarations,
public buyer transport, response-file writer, operator bridge and support
capture. The developer portal, client generator/exporter, release manager,
release console, SQLite/PostgreSQL sources and buyer inbox also have explicit
subpaths in `package.json`. The main import exports the original client, release
and inbox functions for applications that manage their own UI and lifecycle.
Optional database drivers load only when their original source is opened.

## Maintainers: produce an immutable distribution

Commit the distribution sources in a current public sprint checkout, then run:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/new-release-directory --ref HEAD
```

For partial-clone acquisition, cached batch reads, offline rebuilding and native
phase progress, use the [release-building guide](BUILDING.md). The final receipt
includes source acquisition counts and timing alongside the original archive
identity.

This packaging command needs Node, npm and Git. It reads only the chosen commit
through Git, independently of modified or untracked worktree files. It copies
explicit product components and their required shared schema/Python modules,
checks declared entrypoints and static relative ESM dependencies, and runs
`npm pack --ignore-scripts`. The source commit determines the package version.
The new output directory contains the archive, its SHA-256/SRI receipt, and the
inspectable staged package. The builder never runs a suite, contacts a merchant,
publishes to npm, changes the source checkout, or enables hosted CI.

Concurrent source work is preserved: choose the merged commit you intend to
distribute. A later native component release becomes a new archive and source
manifest; an existing archive is not silently rewritten. The package preserves
all included native licensing and the repository's MIT license.

The maintained original product entry guide is retained at
`source/stellar/scf-starforge-20261009/README.md`. The explicit support inventory
also includes required non-JavaScript runtime files such as the complete
WooCommerce PHP plugin. Exact declared runtime support files may override the
filename heuristic for tests; directory exclusions, supported extensions,
explicit exclusions and regular-file checks still apply. This keeps the native
MCP buyer's imported `mcp-buyer-acceptance.mjs` implementation in the archive
without selecting acceptance runners from whole components.

Static imports and re-exports in `.mjs` and `.js` sources are parsed with Node's native
[`vm.SourceTextModule`](https://nodejs.org/api/vm.html#class-vmsourcetextmodule)
in a separate parse-only process. It does not link or evaluate application code.
Generated code examples in template strings therefore remain ordinary text.
The builder follows those relative imports transitively and includes their
permitted, tracked runtime files from the same immutable Git commit. Shared
source helpers therefore travel with their original importing product. Every
added file retains its exact Git bytes and mode in the source manifest and
passes the same directory, filename, explicit-exclusion and size limits.
Missing, excluded or non-regular dependencies still fail the build. Files are
read only through the selected Git tree; imports never resolve from an operator
workspace, untracked checkout state or a remote application URL. A partial Git
clone may fetch a missing pinned source blob through its configured Git remote.
Dynamic runtime families and browser assets are retained through the explicit
component inventory; operator-selected application and signer modules remain
external inputs. This parser adds no package dependency.

## Receiving readiness and native operations

Review every payment option in the original seller configuration before starting
the merchant. This command binds the exact advertised SAC, network, recipient
and amount to native contract state and the original account evaluator:

```sh
starforge merchant-readiness \
  --config /private/merchant/seller-service.json \
  --asset-map /private/merchant/sac-assets.json \
  --out /private/merchant/receiving-review
```

Use the installed `source/stellar/scf-starforge-20261009/sf101-merchant-account-readiness/asset-map.example.json`
as the starting map for the actual configured assets. The complete
`MERCHANT_READINESS.md` in that directory explains RPC selection, the explicit
`--https-proxy-env` option, exact option-level statuses, private output and
reopening saved reports. The component uses the existing Stellar SDK; its
accepted native journey and declared component dependency use version 16.3.1.

Embedding applications can import `./merchant/readiness` for the original
configuration review, `./merchant/recipient-readiness` for
`createSacRecipientReviewer`, and `./merchant/assets` for the original SF16
`AssetRegistry`. The reviewer evaluates the exact amount on every call and its
`validate(terms, registry)` method returns the original SF16 accepted terms with
the corresponding receiving result.

### Keep receiving reviews in the operator browser

Open the receiving desk with the existing installed command:

```sh
npx --no-install starforge merchant-readiness workspace \
  --directory /private/merchant/receiving-desk --port 8408
```

The parent directory must exist. The command creates or reopens the same private
receiving directory and prints its loopback browser URL. Save the merchant's actual
seller JSON and its optional asset/RPC maps, inspect the compiled payment choices,
and choose **Run live review**. Each option keeps its exact advertised amount,
network, token, recipient and the original receiving action. Saved history supports
comparison, offline replay of a completed capture, and complete JSON export/import.
The installed `source/stellar/scf-starforge-20261009/sf101-merchant-account-readiness/RECEIVING_DESK.md`
covers configuration, account actions, cancellation, retained captures and recovery.

One process owns a receiving directory. Normal shutdown drains an accepted review
and releases the original lease; queued requests resume when that directory reopens.
Keep the private directory outside `node_modules` so installed source updates retain
the merchant's configurations and history. Live reads use the existing optional
Stellar SDK and operator-selected RPC environment. Replay consumes the original
capture's resolved endpoints and response bytes after that environment is removed.

An application can open the same standalone desk through its public server entry:

```js
import { startReceivingWorkspace } from
  '@tokenjunkielabs/starforge-merchant/merchant/receiving-server';

const receiving = await startReceivingWorkspace({
  directory: '/private/merchant/receiving-desk',
  port: 8408,
  basePath: '/merchant/receiving',
});
console.log(receiving.url);
// In the application's shutdown handler:
await receiving.close();
```

For an existing operator listener,
`@tokenjunkielabs/starforge-merchant/merchant/receiving-workspace` exports
`openReceivingWorkspace`; the adjacent `merchant/receiving-server` entry exports
`createReceivingWorkspaceHandler({workspace, origins, basePath, token})`. Pass that
one controller to the handler, register the operator's exact allowed origins, and
mount before body parsing so the handler owns its bounded JSON input. The handler
returns `false` for paths outside its mount. The host retains the controller's
lifetime and closes its original lease with `await workspace.close()` during
shutdown. Controller integrations can retain IDs for profile creation, imports and
review requests; equal retries recover the original saved objects.

The existing facilitator command also provides RPC readiness and shared signer
ownership from the same native implementation:

```sh
starforge facilitator --probe --config /private/facilitator.json
starforge facilitator --serve --config /private/facilitator.json --port 5101 \
  --state /srv/starforge/facilitator-owners --require-ready
```

Use the same private state directory and operating-system user for cooperating
processes on one Linux host. The original `OPERATIONS.md` under the installed
`source/stellar/scf-starforge-20261009/native-facilitator` directory covers
`flock`, key-free probing, `/readyz`, admission, graceful drain and retained
ownership while already accepted SDK work completes. The existing
`./facilitator` API retains its runtime entrypoints; `./facilitator/readiness`
exposes the original RPC probe directly.
