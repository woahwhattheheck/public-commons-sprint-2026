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
| `starforge upstream-operation` | Issue, inspect and reconcile an original merchant operation ticket |
| `starforge operations` | SF30 seller plus live operations dashboard |
| `starforge dataset` | SF30 dataset API compilation |
| `starforge postgres-workspace` | Existing database metadata to selected-query merchant package |
| `starforge openapi` | SF61 OpenAPI offer and service configuration |
| `starforge openapi-workspace` | Select an API contract, prepare the merchant and use its native operator workflow |
| `starforge pilot` | SF96 original SF82 seller pilot, dashboard and SF93 support composition |
| `starforge buyer` | SF88 discovery, saved-source preparation, offline review and approved execution |
| `starforge commerce` | Persistent native merchant, operations and selected buyer session |
| `starforge merchant-mcp` | MCP staging, comparison, activation, seller lifecycle and customer SDK export through the original release system |
| `starforge commerce-setup` | Prepare exact merchant requests and one shared native buyer workspace |
| `starforge commerce-console` | Browser workspace for prepared requests, execution and delivered resources |
| `starforge inbox` | Original durable buyer requests, outcomes and recovery |
| `starforge native-signer` | SF103 native buyer configuration, inspection and signer loading check |
| `starforge facilitator` | Original native Stellar facilitator or self-facilitated seller |
| `starforge capture` | SF85 original single HTTP 402 capture |
| `starforge import-headers` | SF85 original operator HTTP header-file importer |
| `starforge handoff` | SF96 captured challenge to original buyer review files |
| `starforge support` | SF93 private seller and operations support export |
| `starforge client` | Export a standalone JavaScript client, TypeScript declarations and original OpenAPI |
| `starforge releases` | Stage, compare, select, run and roll back seller configurations; local operator console |
| `starforge buyer-inbox` | Prepare, review, execute and report retained original buyer jobs |
| `starforge dataset-delivery` | Export an original completed buyer job as a retained dataset delivery |
| `starforge merchant` / `delivery` | Original native seller with its retained fulfillment journal and event delivery |
| `starforge merchant-desk` | Private paid-file order inventory, enrollment, handoffs, access controls and support |
| `starforge paid-file-checkout` / `paid-file-purchase` | Original merchant file checkout and approved customer purchase/download |
| `starforge postgres-init` / `postgres-inspect` / `postgres` | Prepare a PostgreSQL source, inspect named queries and launch its seller/dashboard |
| `starforge sqlite-init` / `sqlite-inspect` | Prepare and inspect an original SQLite named-query source |
| `starforge dataset-refresh` | Publish, retain and activate CSV dataset versions while readers finish their pages |
| `starforge dataset-workspace` | Preview, refresh and select the retained dataset in its private browser workspace |
| `starforge catalog-serve` / `catalog` | Host live seller discovery and operate its existing single writer |
| `starforge catalog-withdrawal` | Prepare, sign and apply an existing seller withdrawal |
| `starforge checkout` / `purchase` | Enroll a private merchant file, prepare its order-bound purchase and retrieve delivery |
| `starforge buyer-object` | Prepare an object acquisition, retain chunks, resume and assemble the complete file |
| `starforge merchant-fleet` / `merchant-fleet-control` | Serve multiple merchants and prepare, activate or roll back their routing |
| `starforge merchant-fleet-workspace` | Review serving and proposed fleet configurations in a private browser |
| `starforge revenue-workspace` / `revenue-report` | Review pricing, original merchant traffic and the existing native journal |
| `starforge s3` | Inspect selected object-store resources and export an original merchant configuration |
| `starforge python-merchant` | Inspect, initialize and serve a Python merchant through the original runtime |

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

Use the original merchant pricing workspace with its actual seller configuration
and existing operations listener:

```sh
npx --no-install starforge revenue-workspace \
  --config /private/merchant/seller-service.json \
  --state /private/merchant/pricing-workspace \
  --ops-url http://127.0.0.1:8424 --port 8457
```

For a retained export, replace `--ops-url` with
`--snapshot /private/merchant/original-seller-traffic.json`. Select exactly one
source. Add `--native-outbox /private/merchant/existing-sf98-outbox` to include
the matching original fulfillment journal in saved reviews. The state directory's
parent must exist; the workspace creates private state on a local filesystem
supporting atomic hard links and directory synchronization.

Refresh actual operations, enter the merchant's quoted USD values, costs and
volume targets, review every ordered payment choice, then calculate and save.
The workspace retains complete immutable reviews and can reopen their reports,
reuse assumptions, and download original terms and operations. Calculations
preserve decimal inputs and original atomic amounts. Commercial targets remain
planning assumptions; observed requests and journal events retain their actual
operational meaning. The workspace neither changes live prices nor starts a
seller or payment.

Reproduce a saved review with that version's matched seller, terms and traffic:

```sh
npx --no-install starforge revenue-report \
  --config /private/review/seller.json --terms /private/review/terms.json \
  --snapshot /private/review/snapshot.json --output /private/new-report
```

The complete native `sf97-merchant-revenue-ops/WORKSPACE.md` and its analyzer are
included. Applications may import `startWorkspace` from
`@tokenjunkielabs/starforge-merchant/merchant/revenue-workspace`; its `directory`
option is the same private state passed to CLI `--state`. This workflow adds no
npm dependency.

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

## Embed in an application

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

Static imports and re-exports are parsed with Node's native
[`vm.SourceTextModule`](https://nodejs.org/api/vm.html#class-vmsourcetextmodule)
in a separate parse-only process. It does not link or evaluate application code.
Generated code examples in template strings therefore remain ordinary text.
Dynamic runtime families and browser assets are retained through the explicit
component inventory; operator-selected application and signer modules remain
external inputs. This parser adds no package dependency.
