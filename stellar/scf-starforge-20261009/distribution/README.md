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

## Prepare an existing API in the browser

The original OpenAPI workspace can also prepare the merchant's native API
configuration. Start it with an existing private parent for exported projects:

```sh
mkdir -m 700 /private/merchant-projects
npx --no-install starforge openapi-workspace \
  --out-parent /private/merchant-projects --port 0
```

Open the printed local URL and use the existing API contract, explicit operation
selections and original application bindings. The workspace uses the maintained
importer, seller lifecycle and request review modules. Its files and browser
assets are included under
`source/stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/`;
the README there covers the complete preparation and operator lifecycle.

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
| `starforge upstream-operation` | Issue, inspect and reconcile an original merchant operation ticket |
| `starforge operations` | SF30 seller plus live operations dashboard |
| `starforge dataset` | SF30 dataset API compilation |
| `starforge assets` | Inspect, package and catalog original immutable file products |
| `starforge postgres-workspace` | Existing database metadata to selected-query merchant package |
| `starforge duckdb-workspace` / `duckdb-workbench` | One retained workspace for actual DuckDB/Parquet queries, merchant packages and operations |
| `starforge duckdb` / `duckdb-inspect` / `duckdb-prepare` | Launch or inspect the original local source; prepare, verify and reopen its merchant package |
| `starforge openapi` | SF61 OpenAPI offer and service configuration |
| `starforge openapi-workspace` | Select an API contract, prepare the merchant and use its native operator workflow |
| `starforge pilot` | SF96 original SF82 seller pilot, dashboard and SF93 support composition |
| `starforge buyer` | SF88 discovery, saved-source preparation, offline review and approved execution |
| `starforge commerce` | Persistent native merchant, operations and selected buyer session |
| `starforge merchant-mcp` | MCP staging, comparison, activation, seller lifecycle and customer SDK export through the original release system |
| `starforge mcp-native` | Initialize and operate the original native buyer MCP workspace |
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
| `starforge dataset-publisher` | Upload and publish CSV versions, select the actual offer and export original buyer preparation |
| `starforge buyer-dataset` | Acquire, pause, resume and deliver all pages of the selected original dataset |
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
| `starforge availability` | Inspect, pause and resume selected routes through the running seller's original control |
| `starforge cube-onboarding` | Capture Cube metadata, prepare reviewed reports and export/run the original merchant package |
| `starforge graphql-onboarding` / `graphql-merchant` | Prepare approved GraphQL queries and run their original paid seller |
| `starforge graphql-workspace` | Review schemas, prepare query packages and operate the original merchant in its private browser |
| `starforge woo-seller` / `woo-buyer` | Connect an existing WooCommerce product/order to original merchant and buyer checkout |

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

Large object acquisition uses `starforge buyer-object --help` and the bundled
`source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/OBJECTS.md` guide.
The operator selects an object from its description, reviews a whole-download
atomic cap, and uses the existing buyer for each prepared range. Saved chunks,
snapshot identity and attempts survive reopening; assembly streams the retained
contiguous bytes into a new destination. The same command provides the offline
report and exports. Application APIs are available through `./buyer/object` and
`./buyer/object-description`.

### Operate large-file acquisition in the browser

The original object workspace uses the existing merchant `objects.json`, exact
buyer configuration and private SF88 workspace. Prepare the profile described
in `sf88-operator-buyer-cli/object-workspace/README.md`, then launch:

```sh
npx --no-install starforge buyer-object-workspace \
  --state /private/download-workspace --profile /private/object-products.json --port 8438
```

Select the original product, review its range requests and spending limits,
operate the retained acquisition, and preview/download the assembled file.
Every range remains an original inbox job with its existing approval, ledger
and native outcome. Restart uses the same state and original acquisition;
completed parts remain available. The `./buyer/object-workspace` subpath exposes
the original `startObjectWorkspace` API.

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

## Connect a WooCommerce checkout

The complete original bridge is included under
`source/stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge`.
Install its three PHP files together in one plugin directory on the merchant's
existing WordPress/WooCommerce host: `starforge-sf98-woo.php`,
`checkout-gateway.php` and `checkout-admission.php`. The plugin requires PHP 8.0+
and the host's existing WordPress MySQL/MariaDB connection; it has no Composer
or separate browser build dependency.

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

Static imports and re-exports are parsed with Node's native
[`vm.SourceTextModule`](https://nodejs.org/api/vm.html#class-vmsourcetextmodule)
in a separate parse-only process. It does not link or evaluate application code.
Generated code examples in template strings therefore remain ordinary text.
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
