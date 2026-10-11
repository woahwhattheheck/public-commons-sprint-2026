# Stellar Forge merchant and buyer toolkit

Deploy an API or data operation with Stellar x402 payments, let a buyer review
and purchase it, and keep the delivered resource and operating history usable
after an interruption.

The maintained product connects the merchant's existing application to the
original seller, catalog, buyer, spending ledger, native Stellar signer,
delivery receiver and operator tools. Start with the workflow you need below;
the numbered source directories identify implementation components.

## Choose your starting point

| Your task | Start here | What you retain |
| --- | --- | --- |
| Configure JSON resources in the browser | [Merchant front door](../../stellar-forge/developer-site/README.md) | Editable drafts, exact route prices and a complete native seller workspace export |
| Install the toolkit on an operator host | [Merchant distribution](distribution/README.md) | One source-versioned package, original commands and application imports |
| Expose an existing API | [Seller workspace](sf82-seller-pilot/README.md) and [upstream integration](sf30-seller-sdk/UPSTREAM.md) | Your OpenAPI operations, request bindings, backend and chosen prices |
| Sell a dataset or database query | [Versioned datasets](sf30-seller-sdk/dataset-refresh/WORKSPACE.md), [PostgreSQL workspace](sf30-seller-sdk/postgres/workspace/README.md), [SQLite workbench](sf30-seller-sdk/sqlite/workbench/README.md), [DuckDB and Parquet preparation](sf30-seller-sdk/duckdb/PREPARE.md) | Selected public fields, query rules and original data source |
| Prepare a buyer from a real offer | [Atlas](sf61-bazaar-explorer/README.md) or [buyer CLI and private workspace](sf88-operator-buyer-cli/README.md) | Source observation, concrete request, stable intent and your spending limit |
| Operate merchant and buyers together | [Commerce session](sf66-demo-launcher/COMMERCE.md) and [browser workspace](sf66-demo-launcher/COMMERCE_CONSOLE.md) | Prepared requests, outcomes, delivered files and merchant usage through restart |
| Sell and deliver a separate private file | [Approved order and paid-file workflow](sf101-merchant-receiver/CHECKOUT.md) | Original order, native delivery event, entitlement and exact completed bytes |
| Integrate an agent or customer application | [Durable MCP workspace](../../stellar-forge/mcp-paid-agent/DURABILITY.md), [customer SDK](sf30-seller-sdk/DEVELOPER.md), [Python buyer](sf88-operator-buyer-cli/python/README.md) | Original operation identity and the operator's configured payment authority |
| Change a live product or recover an incident | [Seller releases](sf82-seller-pilot/RELEASES.md), [buyer inbox](sf88-operator-buyer-cli/QUEUE.md), [operations](sf30-seller-sdk/operations/README.md) | Reviewed versions, original attempts, retained output and operating history |
| Stage and replace merchant releases | [Managed fleet workspace](merchant-fleet-gateway/workspace/README.md) and [release operator](merchant-fleet-gateway/RELEASE_OPERATOR.md) | Immutable original releases, reviewed traffic changes, drained sellers and restart rollback |
| Review merchant pricing and operating costs | [Merchant pricing workspace](sf97-merchant-revenue-ops/WORKSPACE.md) | Every configured payment option, the original operating capture, saved cost assumptions and financial reports |

## Install and open the merchant workspace

The examples use Node 24 and Python 3.11 or newer. Native buyer approval uses
the operator's POSIX terminal. Choose directories you own; replace the example
absolute paths below with those directories.

Install the supplied archive in your application directory:

```sh
npm install --ignore-scripts --offline --omit=optional /absolute/path/to/supplied-archive.tgz
npx --no-install starforge doctor
npx --no-install starforge init --dir ./merchant --template dataset
npx --no-install starforge run --workspace ./merchant -- --port 0
```

Open the printed seller developer page and operations URL. The dataset template
lets you inspect the actual operation, request contract and HTTP 402 offer.
Its initial asset and recipient are nonpayable example markers. Put your real
product and selected payment terms into the workspace before enabling native
payments. The same toolkit also supplies application-handler and existing-API
templates.

The archive is a local install, with its own source manifest. If you are starting
from a repository checkout, produce it with the original builder:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/new-release-directory --ref HEAD
```

Use the archive path printed by that command in the installation above. The
builder packages the selected committed source. Keep your merchant, buyer and
private state directories outside the installed package so a package update
preserves your work. The [distribution guide](distribution/README.md) covers
all command aliases, optional features and application exports.

## Connect the selected merchant and native payment runtime

Use the merchant's actual operation and data. The seller workspace can prepare
its original configuration from supported OpenAPI operations and upstream
bindings. Database workspaces preserve the source's selected public fields and
query policy. The original developer page shows the same operation and payment
options that the seller serves.

Install the accepted native packages in the same application directory:

```sh
npm install --ignore-scripts --no-audit --no-fund \
  @x402/core@2.28.0 @x402/stellar@2.28.0 @x402/extensions@2.28.0 \
  @stellar/stellar-sdk@16.3.0
npx --no-install starforge doctor --native
```

Configure the exact network, token contract, merchant recipient, atomic amount
and selected facilitator. The [native facilitator guide](native-facilitator/README.md)
covers the existing facilitator URL and self-facilitated seller paths. The
[commerce plan](sf66-demo-launcher/COMMERCE.md) composes that configuration with
the original merchant and operations service. Route the merchant's public HTTPS
origin to its configured listener; keep its operator consoles private.

## Review merchant pricing and operating costs

Open the [merchant pricing workspace](sf97-merchant-revenue-ops/WORKSPACE.md)
against the seller configuration and its original operations listener. From a
repository checkout:

```sh
node stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/workspace/cli.mjs \
  --config /absolute/private/merchant/seller-service.json \
  --state /absolute/private/merchant/pricing-workspace \
  --ops-url http://127.0.0.1:8424
```

Use the actual configuration path and listener printed by your seller. For a
retained operating capture, replace `--ops-url` with
`--snapshot /absolute/private/merchant/original-seller-traffic.json`.
The optional `--native-outbox` points at the same merchant's existing private
SF98 outbox and adds its native settlement companion.

The private browser workspace presents every configured payment option. Enter
your USD quote and basis, target request volume, fulfillment and challenge
costs, and fixed operating costs. The original SF97 analyzer calculates the
review; unspecified costs stay unknown. Save the review to retain its exact
source snapshot and terms, reopen the saved version, and download reusable
merchant terms and the original reports. Saved versions preserve the assumptions
behind a pricing decision through service restart and concurrent editing.

## Prepare the buyer's real request

Select a real catalog observation in Atlas or the buyer CLI. Supply its concrete
URL, method and request body, and review the selected asset, recipient and atomic
spending limit. A merchant's supplied [operation ticket](sf88-operator-buyer-cli/OPERATION_TICKETS.md)
and a [paid-file order handoff](sf101-merchant-receiver/CHECKOUT.md) use their
original preparation commands and remain attached to that request.

The [buyer workspace initializer](sf88-operator-buyer-cli/README.md) creates the
private operator policy, durable ledger and generated native signer module for
your existing account or trusted provider. Configure your output destination
before finalizing the signer-bound request. Use the existing
[native signer instructions](sf88-operator-buyer-cli/NATIVE_SIGNER.md) for
dependencies and provider setup, and [transport configuration](sf88-operator-buyer-cli/TRANSPORT.md)
when the operator host uses an explicit HTTPS proxy.

Review that same workspace, then add its generated configuration to the inbox:

```sh
npx --no-install starforge buyer --review-workspace --dir /absolute/private/operator
npx --no-install starforge inbox init --root /absolute/private/buyer-inbox
npx --no-install starforge inbox enqueue \
  --root /absolute/private/buyer-inbox \
  --config /absolute/private/operator/operator.json
npx --no-install starforge inbox show \
  --root /absolute/private/buyer-inbox --intent YOUR_STABLE_INTENT
```

Initialize an inbox only when it is new. Review reads the saved request. The
original execution path obtains fresh merchant terms and asks for terminal
approval before spending reservation and native signing:

```sh
npx --no-install starforge inbox execute \
  --root /absolute/private/buyer-inbox --intent YOUR_STABLE_INTENT \
  --workspace /absolute/private/operator
```

Keep the same intent, workspace and original result when an operation is
interrupted. The [inbox guide](sf88-operator-buyer-cli/QUEUE.md) gives the
existing recovery and reporting commands.

## Keep the whole operation in one session

For an operator running this merchant and its selected buyers together, prepare
the [commerce plan](sf66-demo-launcher/COMMERCE.md) from those same merchant,
facilitator and buyer files:

```sh
npx --no-install starforge commerce init \
  --plan /absolute/private/commerce-plan.json \
  --directory /absolute/private/merchant-session
npx --no-install starforge commerce start \
  --directory /absolute/private/merchant-session
```

The session's `status`, `review ID`, `execute ID`, `cancel ID` and `recover ID`
commands address its original stable intents. `quit` closes owned buyer work,
drains the merchant and retains the usage checkpoint. Start the same directory
again to continue with the same requests and results.

The [commerce browser workspace](sf66-demo-launcher/COMMERCE_CONSOLE.md) provides
selection, review, execution, saved-resource preview/download and recovery over
that same session. Start it instead of a second terminal session for the same
directory. Its original approval prompt remains in the terminal from which it
was launched.

## Stage, replace and restore a live merchant release

Use the [managed fleet workspace](merchant-fleet-gateway/workspace/README.md)
to operate several merchants from their original SF82 release stores. Prepare
the private plan and original startup releases with the
[release operator guide](merchant-fleet-gateway/RELEASE_OPERATOR.md). Each merchant
has independent stores on fixed ports and registered saved API workspace
packages for future staging. The merchant's public hostname and original
payment/runtime configuration stay attached to its released source.

From the installed application directory, open the existing fleet workspace:

```sh
npx --no-install starforge merchant-fleet-workspace \
  --releases /absolute/private/fleet/plan.json \
  --release-state /absolute/private/fleet/operator --port 8402
```

From a source checkout, the equivalent entry is
`node stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/server.mjs`
with the same arguments. The plan, saved packages, original release stores and
private state belong outside the software installation. The gateway state
defaults to the operator's `gateway/` subdirectory; pass its existing `--state`
directory when reopening a deployment that used a separate gateway location.

Stage a registered package in the selected replacement slot and compare its
actual routes, atomic payment terms and application changes with the serving
release. Start and prepare the reviewed source, then explicitly activate the
gateway candidate. Already-admitted work finishes on the original seller.
When that exact port has drained, retire the session this operator owns.

To return to a retained revision, review the original release comparison and
confirm restoration. The operator starts any stopped retained sellers on their
fixed ports before the gateway restores routing as a new revision. Normal
shutdown drains the gateway and closes its owned sellers; reopening the same
plan and directories restores the saved selection. Export status and source
links with the handoff. The browser and
[terminal release operator](merchant-fleet-gateway/RELEASE_OPERATOR.md#start-one-complete-foreground-session)
are alternative owners of that session.

## Deliver useful output and recover the failed step

A paid HTTP response can be saved through the original buyer
[response-file writer](sf31-buyer-client/SAVING_RESPONSES.md). Its result retains
the completed path, size and digest, or the original partial-file outcome.

For a separately downloadable product, the [paid-file workflow](sf101-merchant-receiver/CHECKOUT.md)
enrolls the merchant's real file and binds its order to the approved purchase.
Native settlement creates the original delivery event. The authenticated receiver
then grants the original entitlement. The customer retrieval command verifies
the promised size and digest before publishing the file. If those completed
bytes already exist locally, it recovers the same file and receipt without a
network request or another payment.

Use each original record for its job:

| Record | What it tells the operator |
| --- | --- |
| Buyer intent, reservation and native transaction observation | Which operation was approved and its observed financial outcome |
| Merchant outbox and entitlement | Whether the same order's delivery notification arrived and access was granted |
| Buyer response or downloaded-file result | Which complete bytes were saved, or where delivery stopped |
| Merchant usage and support export | Request/service behavior, retained history and the material needed to repair the incident |

Recovery keeps the original financial attempt and repairs its failed delivery
or operating step. The [seller operations guide](sf30-seller-sdk/operations/README.md)
and [support capture](sf93-seller-support-bundle/README.md) provide the existing
private handoff.

## Explore the local catalog without configuring a merchant

Use the [SF44 catalog and MCP preview](sf44-developer-onramp/README.md) for
loopback discovery, price preview and protocol inspection. It deliberately uses
a nonpayable local fixture. The installed merchant/buyer workflows above are the
entry points for an actual configured operation.

The repository's MIT license and each included component's native license
remain with their source. Current SCF program information is on the
[official awards page](https://communityfund.stellar.org/awards).
