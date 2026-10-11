# Stellar RPC merchant workspace

Keep a merchant's selected Stellar RPC products, original plans, reviewed prices,
prepared packages and observed provider state in one private workspace. The
browser composes the original RPC compiler, SF61 package preparation, SF88 buyer
review and SF30 merchant lifecycle. The original native runtime continues to
own payment, upstream credentials, request admission and product availability.

## Create or reopen

Use Node 24. The installed `jsonrpc` command includes the workspace subcommand:

```sh
npx --no-install starforge jsonrpc workspace \
  --dir /absolute/private/rpc-workspace --create \
  --plan /absolute/private/rpc-plan.json
```

From a full source checkout, the equivalent command is:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/jsonrpc/cli.mjs workspace \
  --dir /absolute/private/rpc-workspace --create \
  --plan /absolute/private/rpc-plan.json
```

Omit `--plan` to retain the original editable starter. Its example recipient,
asset and atomic prices must be completed before the original compiler can
produce a usable review. Drafts can retain unfinished edits.

Open the complete private URL printed by the launcher. Its fragment carries a
local session capability and is removed from the address bar after opening.
The workspace listens only on IPv4 loopback. Each new process uses a fresh
capability; reopen through its newly printed URL. Browser copies in the same
session can retain distinct unsaved drafts.

Reopen a saved workspace using the same directory:

```sh
npx --no-install starforge jsonrpc workspace \
  --dir /absolute/private/rpc-workspace
```

The original SQLite merchant store holds an operating-system-owned exclusive
runtime lock. A second process receives `WORKSPACE_ALREADY_OPEN`; a stopped or
crashed process releases its lock without PID-based takeover. A workspace's
merchant, buyer and private state stay outside the software installation.

## Edit and retain public plans

The form edits public merchant origin, data network, payment network, asset
contract, recipient, timeout, selected fixed methods, atomic prices and request
limits. The complete JSON editor preserves original `headerEnv`, `oauth2` and
`upstreamAvailability` declarations and supports unfinished configuration.
Use **Apply JSON to editor**, then **Save version**, after changing complete JSON.

Every save adds an immutable version. The editor sends its expected current
revision; a concurrent save returns a conflict and preserves the draft. Open
the latest version for comparison, or explicitly keep the retained editor as a
new version after it. Opening an older version and saving it creates a new
version while preserving its original source identity.

**Import a plan** retains that file's exact UTF-8 bytes under its SHA-256 and
saves its parsed plan as a new version. The selected version can download its
original source separately from its current formatted public plan. Revisions
that began with another imported file retain that different original source.
File imports and plan saves make no provider request.

## Review products and prepare the original package

The review invokes the original `prepareProduct` compiler on the selected saved
version. It shows every selected method, concrete resource URL, exact native
payment option, configured bounds and credential environment references. Data
and payment networks remain separate selections. Incomplete plans retain their
compiler finding and remain editable.

Use **Compare saved versions** for exact changes to products, amounts,
recipient, networks, authentication references and limits. Each review ID binds
its source hash, saved plan hash and original compiled service/specification.
Prepare, diagnose, buyer and start actions require that exact saved review.

**Prepare merchant package** calls the original RPC `preparePackage`. Its
original `plan.json`, OpenAPI, selections, bindings, seller offers, trusted
handler entry, `RUN.md` and SF61 `compiled/` outputs are retained unchanged in
`packages/OPERATION_ID/`. The browser downloads each complete original file.
Package actions read back the retained file set and hashes before buyer
preparation, merchant startup or export. An edited file returns
`PREPARED_PACKAGE_CHANGED` and preserves the original record for investigation.

The trusted handler entry in the original package references the source
installation that prepared it. Retain that immutable source installation with
the package. Create a new package after updating the software. Original
`RUN.md` supplies the normal source-based run and release integration commands.

## Diagnose the declared provider

Supply the provider URL and optional authentication values through the
launcher's existing private environment. Only the variable names belong in
the public plan. The workspace never presents fields for provider secrets.

**Read provider network and health** explicitly invokes the original RPC
application's `diagnose()`: one `getNetwork` and one `getHealth` read. The saved
operation retains its reviewed plan identity, observed network/protocol,
retention window and timestamp. Reopening or downloading this operation uses
the retained result. Requesting another diagnosis creates another explicit
operation and provider read.

Completed and failed actions retain stable IDs. Repeating the same action ID
with the same input returns its retained result. A changed payload for that ID
returns a conflict. An action interrupted by process loss stays `INTERRUPTED`;
it is available for review without automatically issuing another provider
request. The browser retains the current operation ID across an uncertain
transport failure and the saved-operation list provides reconciliation.

## Prepare the buyer's original request

Select a package for the current saved version, a selected method, an actual
params object and the purchase's stable intent. The original method admission
checks the request before the original SF88 preparation runs.

The saved buyer operation retains `request.json` and `buyer-review.json` in
`actions/OPERATION_ID/`, with original configuration identity and atomic terms.
Download them individually or use the retained absolute local paths shown in
the operation. The generated review refers to its retained request file on
this host. On another host, place the request at the buyer's chosen private
path and prepare the original review there using the normal RPC buyer command.
Continue in **Native commerce** below, or use the original buyer initializer,
signer and review commands directly.

Metadata products use `{}`. Transaction reads require a current actual hash;
history reads use a provider-retained ledger window or the previous returned
cursor. Each deliberately new page or purchase uses a new intent.

## Prepare and reopen native commerce

The same workspace can now carry completed buyer reviews into the original
SF66/SF88 preparation, operator ledger and commerce console. Choose the private
operator/facilitator profile in the launching process:

```sh
npx --no-install starforge jsonrpc workspace \
  --dir /absolute/private/rpc-workspace \
  --commerce-profile /absolute/private/rpc-commerce-profile.json
```

The profile is a private regular JSON file. Its `prepare` section uses the
original operator initializer's actual actor, service, public payer, Python
executable, signer reference and atomic budgets. Use the existing reviewed
native facilitator configuration and actual public payer. For example:

```json
{
  "schema": "stellar-forge.rpc-commerce-profile.v1",
  "prepare": {
    "facilitatorConfig": "/absolute/private/facilitator.json",
    "operator": {
      "actor": "rpc-pilot-operator",
      "service": "stellar-rpc-pilot",
      "python": "/usr/bin/python3",
      "payer": "REPLACE_WITH_THE_EXISTING_PUBLIC_PAYER",
      "secretEnv": "STELLAR_BUYER_SECRET",
      "totalAtomic": "100000",
      "dailyAtomic": "100000"
    },
    "sellerPort": 8423,
    "operationsPort": 8424,
    "requestTimeoutMs": 120000,
    "responseMaxBytes": 8388608,
    "responseTimeoutMs": 30000
  },
  "consolePort": 8426,
  "existing": []
}
```

Set this file to mode `0600` and its private parent to `0700`. Supply the actual
wallet and provider environment values through the original host's private
environment. The profile contains their references. `signerProvider` can replace
`secretEnv` with the original trusted provider declaration. `httpsProxyEnv` uses
the original explicit CONNECT transport when that host requires it. An optional
top-level `finalityNode` selects the existing trusted absolute executable for
the original finality observer; the default is the launching Node executable.
These executable, directory and signer choices stay in the launch profile.

Unspecified seller, operations and console ports use free loopback ports.
Keep the public merchant origin stable and route the existing HTTPS ingress to
the reported listener. The profile rejects colliding nonzero listener ports.
The original native preparation currently uses Stellar testnet payment terms;
the RPC data network remains the independently declared network in the plan.

The `requestTimeoutMs` default is 120,000 ms and is retained in each generated
SF88 buyer configuration. It covers the original complete paid HTTP request.
The separate `responseTimeoutMs` controls saving the returned response body.
Both values appear in the retained native review. The original SF88 validators
check their actual supported ranges before initializing the operator.

### Browser workflow

1. Save and review the public merchant plan, then prepare its original package.
2. Prepare each actual buyer request above. Select the package in **Native
   commerce**, then explicitly select the completed requests to include.
3. Choose **Create a new retained preparation** and **Review selected commerce
   requests**. Review the exact intent, method, parameters hash, payment option,
   payer and shared total/daily budget. The native setup adds its original
   `Accept: application/json` header; the handoff retains both header maps.
   An omitted payment flow uses the original operator's `authorization`
   default when comparing the saved buyer with the prepared native request.
4. Choose **Prepare native workspace**. The original initializer creates one
   operator workspace and one retained commerce session. Every selected intent
   is reserved to that preparation in the existing authoring database before
   initialization begins.
5. Open the retained preparation with **Open original commerce**, then follow
   **Original commerce console** under **Merchant operation**. The original
   console provides review, explicit purchase execution, current accounting,
   saved-response preview/download and paid-response recovery.
6. **Drain and stop** closes that console and its original merchant resources.
   Reopen the workspace with the same profile, select the retained preparation,
   and open it again. Its operator keys, ledger, queue, payment attempts and
   saved responses continue from their existing records.

Preparations are scoped to an immutable saved plan/package and the complete
selected buyer set. The same intent cannot be initialized into a second
preparation in this workspace. Reopen its existing record to continue it.
Preparing a deliberately new purchase requires a deliberately new intent.
Review and preparation are offline; opening performs the original provider
network check before acquiring its native merchant resources. The original
console's **Execute** remains the action that starts a purchase.

### Attach an existing original preparation

An existing SF66 prepared setup can be named in the private launcher profile:

```json
{
  "schema": "stellar-forge.rpc-commerce-profile.v1",
  "consolePort": 8426,
  "existing": [
    {
      "id": "retained-rpc-pilot",
      "label": "Original RPC pilot",
      "directory": "/absolute/private/original-rpc-prepared"
    }
  ]
}
```

The `prepare` section is optional when the host only opens named existing
preparations. Keep the original directory at its original canonical path. Import
its retained `jsonrpc.json` as the workspace's public plan and prepare that
merchant package. Prepare buyer reviews with the original intent IDs and exact
request bytes, select the complete original buyer set, choose **Attach: Original
RPC pilot**, then review and **Retain existing session**.

Attachment checks the complete normalized original plan, all methods, exact
payment options, original request bytes and resulting headers against the
original prepared setup and inbox. It retains the independent original plan,
`prepared.json` and `session/session.json` hashes. It reuses that existing
operator workspace and ledger. A settled original attempt therefore opens its
existing result and response recovery in the original console. That console
keeps the original paid-attempt time and a subsequent recovery-read time
separately for mutable RPC reads.

Named attachments must remain present in the current launch profile when
reopened. Browser requests select the profile's stable IDs. The original host
resolves the private directories. The preparation history provides the original
handoff download and a read-only **Inspect retained session** action.

### Retention and concurrent operation

The same native SQLite owner lock covers plan authoring, intent reservations
and preparation records. The original action history retains independent
review, prepare, inspect and open identities. Duplicate completed operations
return their original result. A retained complete preparation found after a
process interruption is checked against the original review, payer, budget,
facilitator and source before being marked ready.

For an interrupted preparation, choose **Reopen preparation review**, then
**Prepare native workspace** again. The same original initializer resumes its
unfinished stages with the retained input bytes, operator keys, ledger and
reserved intents. A completed original setup is read and matched to that review
before the authoring workspace marks it ready. Keep the retained preparation
and its original operator directory together when restoring a private backup.

Only one original merchant or commerce session can run through this workspace
at a time. A stop identifies the precise current instance. Closing from either
the workspace or original commerce console drains accepted original work and
updates the same runtime record. Reopening after a process interruption uses
the retained preparation; a new start is explicit. Provider credentials are
captured afresh at each open. The provider closes after the native seller and
observer complete their original shutdown.

Earlier buyer reviews, preparations and operations have independent paginated
history controls. **Reopen preparation review** restores the original selected
version and buyer identities. Unsaved plan edits stay in the editor until the
operator explicitly saves or discards them.

## Start, operate, drain and reopen

Choose the runtime mode in the launcher. For a local offer preview:

```sh
npx --no-install starforge jsonrpc workspace \
  --dir /absolute/private/rpc-workspace --challenge-only \
  --seller-port 8423 --operations-port 8424
```

For native sales, use the merchant's actual selected facilitator:

```sh
npx --no-install starforge jsonrpc workspace \
  --dir /absolute/private/rpc-workspace \
  --facilitator https://YOUR_ACTUAL_FACILITATOR \
  --seller-port 8423 --operations-port 8424
```

The browser chooses a reviewed prepared package, then **Start selected
merchant** invokes the original command with the original private availability,
retained history and native delivery-outbox directories. Startup checks the
data network before opening the original seller and operations listeners.
The public merchant origin remains the declared HTTPS ingress; the local
listeners bind to loopback. Unspecified seller and operations ports use
OS-selected free ports, which the browser reports.

Open the original merchant explorer, operations and product-availability desk
from the workspace. Availability pauses, native delivery and retained traffic
history continue to use those original engines. **Drain and stop** identifies
the exact current merchant instance, drains admitted work and closes its
original resources. A stale browser cannot stop a replacement instance.

Stopping the workspace also drains its owned merchant. Reopening retains
plans, packages, diagnoses, buyer requests, product pauses and original
history. It presents any interrupted prior runtime for review. Starting again
is an explicit action on the retained package. To rotate provider credentials,
drain the merchant, close the workspace and reopen it with the updated private
environment.

The optional original `--history-days`, `--max-in-flight` and `--drain-grace-ms`
values configure the host. `--allow-loopback-upstream` and
`--allow-local-facilitator` are explicit development-only launch choices. Public
browser plans cannot change runtime ports, facilitator, provider values,
executable paths or the private workspace root.

## Embed and retain

For deployment and release management, take the prepared directory shown by
the selected package action into the existing
[RPC release lifecycle](../../../sf82-seller-pilot/JSONRPC_RELEASES.md):
`starforge releases stage --store PRIVATE_STORE --id RELEASE --jsonrpc-package PREPARED_DIRECTORY`.
The release keeps all ten original files and runs the same merchant through its
existing process owner. Its console and MCP tools provide version comparison,
activation, rollback, original operations and availability controls. Stop the
workspace's owned merchant before starting the release on the same public ingress.

`startRpcWorkspace` in `server.mjs` accepts the same directory, creation/import
and host settings, including `commerceProfileFile`, and returns
`{ origin, url, model, close }`. The model in
`model.mjs` exposes the saved plan, review, comparison, preparation, diagnosis,
buyer, start/stop and verified artifact workflow for an existing trusted host.
`commerceBuyers`, `commerceReview`, `commercePrepare`, `commercePreparations`,
`commerceInspect` and `commerceOpen` compose the same original preparation and
console. Review/prepare/open inputs carry the saved revision/review ID and
operation ID; preparation additionally selects the exact retained commerce
review ID/hash, and open/inspect select a retained preparation ID.
Close it after its last action; it closes the original native merchant before
releasing the store.

Keep the complete workspace directory for recovery or private backup. It
contains the original native SQLite revision store and RPC operation records,
exact imported plans, prepared packages, buyer request files and the original
merchant availability/history/outbox directories. Stop its owning process
before copying live database files. The source distribution must retain the
whole original SF30, SF61 and SF88 closure, including the reused
`duckdb/workspace/store.mjs`; that store uses Node's built-in SQLite and does
not load the DuckDB engine.

Native commerce also uses the maintained original SF66/SF36/SF43/SF81/SF103 and
native-facilitator closure. The original native modules load when the host
selects commerce review/preparation/open. Keep the complete maintained merchant
distribution and its original native runtime dependencies. The existing
`jsonrpc workspace` command reaches this workflow through the same dispatcher.

