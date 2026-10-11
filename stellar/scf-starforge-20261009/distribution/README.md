# Starforge merchant toolkit

An installable distribution of the maintained Stellar x402 seller, buyer and
operator workflows. One local package supplies a merchant workspace, the original
seller and operations dashboard, OpenAPI import, buyer review and execution,
response downloads, generated customer clients, seller configuration releases,
database sources, challenge capture, and private support export.

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
| `starforge operations` | SF30 seller plus live operations dashboard |
| `starforge dataset` | SF30 dataset API compilation |
| `starforge postgres-workspace` | Existing database metadata to selected-query merchant package |
| `starforge openapi` | SF61 OpenAPI offer and service configuration |
| `starforge pilot` | SF96 original SF82 seller pilot, dashboard and SF93 support composition |
| `starforge buyer` | SF88 discovery, saved-source preparation, offline review and approved execution |
| `starforge commerce` | Persistent native merchant, operations and selected buyer session |
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
| `starforge postgres-init` / `postgres-inspect` / `postgres` | Prepare a PostgreSQL source, inspect named queries and launch its seller/dashboard |
| `starforge sqlite-init` / `sqlite-inspect` | Prepare and inspect an original SQLite named-query source |
| `starforge dataset-refresh` | Publish, retain and activate CSV dataset versions while readers finish their pages |
| `starforge catalog-serve` / `catalog` | Host live seller discovery and operate its existing single writer |
| `starforge catalog-withdrawal` | Prepare, sign and apply an existing seller withdrawal |
| `starforge checkout` / `purchase` | Enroll a private merchant file, prepare its order-bound purchase and retrieve delivery |
| `starforge buyer-object` | Prepare an object acquisition, retain chunks, resume and assemble the complete file |

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
