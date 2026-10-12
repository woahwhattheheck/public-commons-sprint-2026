# Review, prepare and receive a provider connection

The Blockscout merchant can use the documented PRO token-detail API or an
explicitly reviewed operator-controlled Blockscout installation. A connection
selects the real HTTPS origin, data chain, authentication mechanism, credential
environment reference and provider account. Its provider route is visible
alongside the original Stellar merchant route before preparation.

Use the current provider documentation for the selected installation. Blockscout
directs its operated public API traffic to PRO. Instance mode is for a separately
operated installation whose token response and authentication you have checked.
The exact contract and first-party references are in [CONTRACT.md](CONTRACT.md).

## Connection and account identities

| Selection | PRO | Operator-controlled instance |
| --- | --- | --- |
| Provider origin | https://api.blockscout.com | Explicit HTTPS origin |
| Token route | /{chain_id}/api/v2/tokens/{address} | /api/v2/tokens/{address} |
| Data chains | Configured plan chains | One selected existing plan chain |
| Authentication | Authorization bearer token | Bearer, x-api-key, or anonymous |
| Local accounting | Configured PRO credits per attempt | One request per attempt |
| Account observation | Available PRO credit and rate headers | Available rate headers |
| Credential value | Server environment | Server environment when required |

The instance origin must be distinct from the public merchant origin. The
existing SF30 transport applies its original destination and DNS checks to
each provider request. An instance still returns the documented Blockscout
token-detail schema; the existing merchant validates token identity, nullable
fields and numeric strings before retaining and delivering the response.

The account alias and connection identify a provider ledger. Changing its
origin, mode, authentication mechanism or instance data chain requires another
account alias and a fresh merchant state directory. The application checks that
identity when opening an existing ledger. Changing the environment variable
that supplies the same account's credential retains its history. Its selected
prices and local limits can also change through a new reviewed package.

Plans created before connection setup retain their original normalized bytes
and plan hashes. They resolve to the original PRO route. Their displayed
connection has no fabricated review timestamp. The first explicit connection
review records the actual review time.

## Browser workflow

Open the existing private provider-desk URL printed by the merchant launcher,
or open the original Blockscout application in the installed Applications
workspace. The **Provider connection** section loads the active plan.

1. Select PRO or an operator-controlled instance. Enter the actual provider name
   and origin. For an instance, select the indexed chain from the current plan.
2. Set the provider account alias and authentication. Enter the environment
   variable's name for an authenticated connection. The actual credential
   belongs in the receiving server's private environment.
3. Enter the source URL used to review the endpoint. Record its actual review
   time in UTC, including milliseconds and Z. **Record current review time**
   records the time of this review.
4. Set the local daily, per-second and concurrent request limits. PRO also
   exposes the configured credit tariff, daily credit ceiling and minimum
   observed balance. Instance mode uses one local request per attempt.
5. Select **Review deployment changes**. Inspect the setting comparison,
   resolved provider/merchant routes, selected data chains, payment terms and
   account-state instructions.
6. Select **Prepare deployment package**. The desk retains the complete package
   and its reviewed source/target plans. Download it from the result or reopen
   it under **Saved deployment packages**.

Changing the form invalidates the prior review. Preparation checks the active
plan hash and reviewed candidate. If a response is lost, the browser reads the
same saved package by its review identity. Reopening the desk lists the retained
packages with pagination; download uses the exact saved bytes and digest.

Prepare and review operate locally. Activate the selected package through the
original merchant lifecycle after the required environment and account state
are ready.

## Prepare through the original CLI

Use a complete matching source checkout or installed source distribution with
Linux, Node 24 or newer, Python 3.11 or newer and flock. The original dependency
lockfiles and installation instructions apply.

Run from the source repository root. Replace the directory below with an
existing private directory owned by the operator:

```sh
umask 077
BS=stellar/scf-starforge-20261009/partners/blockscout-stellar-pro-api
node "$BS/cli.mjs" connection-template \
  --plan /private/blockscout/current-package/plan.json \
  > /private/blockscout/connection-changes.json
```

Edit that changes document. It contains the current account alias, credential
environment name, local limits and a connection object. PRO keeps its exact
origin and bearer mechanism. Fill the actual reviewedAt value; a legacy plan's
template intentionally leaves it null.

For an instance, set connection.mode to instance, connection.origin to the
actual operator origin, connection.chainId to one of the plan's indexed chains,
and connection.authentication to the actual mechanism. Set a different account
alias when changing connection identity. Set creditsPerAttempt to 1,
minProviderCredits to 0, and dayCredits equal to dayAttempts. These fields are
the existing local accounting representation of one request per attempt.

The connection document accepts:

```json
{
  "schema": "stellar-forge.blockscout-connection.v1",
  "mode": "instance",
  "origin": "https://explorer.your-company.example",
  "chainId": "8453",
  "authentication": {
    "kind": "api-key-header",
    "header": "x-api-key"
  },
  "providerName": "Your operated explorer",
  "sourceUrl": "https://explorer.your-company.example/api-docs",
  "reviewedAt": "2026-10-12T08:00:00.000Z"
}
```

This illustrates the fields. Use the actual deployment origin, indexed chain,
authentication, documentation and review time. Bearer uses
{"kind":"bearer"}; anonymous uses {"kind":"none"}. Credential values belong only in the receiving server's private environment.
The connection document permits the declared fields, selected authentication
mechanisms and credential-free documentation URLs.

Create and inspect the full review:

```sh
node "$BS/cli.mjs" connection-review \
  --plan /private/blockscout/current-package/plan.json \
  --changes /private/blockscout/connection-changes.json \
  > /private/blockscout/connection-review.json
```

Read that file's sourcePlanSha256, reviewSha256, resolved routes, setting changes
and requiresNewMerchantState. Use those exact two hashes to prepare a new
package:

```sh
node "$BS/cli.mjs" connection-prepare \
  --plan /private/blockscout/current-package/plan.json \
  --changes /private/blockscout/connection-changes.json \
  --expected-plan-sha256 EXACT_REVIEWED_SOURCE_PLAN_SHA256 \
  --review-sha256 EXACT_REVIEW_SHA256 \
  --out /private/blockscout/connection-package-v2
```

The destination parent must already be private. Preparation writes under a
private staging directory, flushes the complete files, and publishes the
finished directory atomically. An interrupted operation continues against its
same output and durable review marker. A completed retry verifies the original
saved package and returns PREPARED_RECOVERED. A different candidate requires a
different destination.

The package contains the original eight generated deployment files, their
manifest, and connection-package.json. The latter carries the full reviewed
source and target plans, change summary, all eight exact generated files and
their byte counts/digests. Preserve the sibling .connection-review.json marker
when retaining a local preparation for recovery.

## Receive on another installation

Transfer connection-package.json to a private location on the receiving
installation. Inspect its full reviewed selection:

```sh
node "$BS/cli.mjs" connection-inspect \
  --bundle /private/incoming/blockscout-connection.json
node "$BS/cli.mjs" connection-receive \
  --bundle /private/incoming/blockscout-connection.json \
  --review-sha256 EXACT_REVIEW_SHA256 \
  --out /private/blockscout/received-package
```

The receiver verifies the source/target plan hashes, review changes, account
state decision, manifest and every exported file. It compiles a fresh trusted
entry against the receiving installation's actual source path. Generated
handlers from the sending installation are retained for review and are never
evaluated during receiving. The received package has its own exact manifest
and runnable RUN.md.

Repeated receiving into that same completed destination returns
RECEIVED_RECOVERED after checking the original files. Preparation and receiving
use the existing Linux flock mechanism to keep one writer per destination.

## Activate and continue account operations

Set the selected credential environment in the actual private server
environment. Use the original facilitator and prepared package:

```sh
node "$BS/cli.mjs" serve \
  --package /private/blockscout/received-package \
  --state /private/blockscout/merchant-for-this-account \
  --facilitator https://YOUR_ORIGINAL_FACILITATOR
```

When the review requires a new merchant state, initialize that separate private
state directory. For the same account and connection, pause/drain the original
merchant, close it, and restart with the selected package and retained state.
The original provider database preserves attempts, quota history, reconciled
interruptions and response bytes. The original merchant and buyer workspaces
continue to own payment, settlement and delivery.

Use the provider desk's existing **Read provider once** only when an actual
provider diagnostic is wanted. It consumes the configured provider-attempt
budget and retains its original outcome. Buyer preparation, purchase, recovery,
response downloads, backup and restore use the same existing implementations.

## Installed command and module interfaces

The existing source-owned blockscout distribution contribution includes the
original Applications provider, blockscout command/help, seven explicit module
exports and the desk's browser-asset manifest. The existing builder follows
the actual source imports and serves the exact HTML, module and stylesheet
declared by that manifest.

```sh
starforge registrations --source blockscout
starforge blockscout connection-inspect --bundle /private/incoming/blockscout-connection.json
```

Node consumers can import the existing product, application, launch, accounting
and customer exports, plus ./partners/blockscout/connection and
./partners/blockscout/connection-setup. The latter exports reviewConnection,
prepareConnectionPackage, inspectConnectionBundle, receiveConnectionBundle,
retainConnectionPackage, readRetainedConnection and listRetainedConnections.

The private desk endpoints implement the same operations:

| Method and route | Operation |
| --- | --- |
| GET /api/connection | Active plan and resolved connection |
| POST /api/connection/review | Source-hash checked candidate review |
| POST /api/connection/prepare | Exact reviewed package preparation |
| GET /api/connection/history | Paged retained package metadata |
| GET /api/connection/packages/{reviewSha256} | Exact retained package bytes |

All endpoints use the original loopback host/origin restrictions and operator
capability. Review/prepare accept explicit connection, account, environment
reference and limits fields; they use the active plan's existing payment terms
and selected chain prices.

## Receiving packages from the first connection release

An implicit legacy PRO plan has no recorded operator review time. Its connection summary now returns `reviewedAt: null`; preparing an explicit connection still requires the actual ISO timestamp selected by its operator. The original plan bytes, account identity and payment history stay bound to that plan.

The first connection release used a fixed display placeholder in the **before** connection summary. Receiving accepts that exact historical representation only for an unchanged implicit legacy source, while checking the complete original source, target, review hash, routes and changes. Existing package bytes and saved review identities remain usable. Newly created reviews always use the current summary.

`inspectConnectionBundle(bundle).review` returns the reconstructed current review for a receiving interface. Display that review and retain the original bundle for receiving, history and downloads. Its verified target plan, review identity and operator-supplied review time are unchanged.
