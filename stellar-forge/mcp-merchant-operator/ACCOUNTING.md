# Operate merchant accounting and recovered purchases through MCP

The existing merchant MCP service operates the same retained accounting workspace
as the [merchant accounting browser](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/README.md).
It uses the original source capture, classifier, report writer, recovery importer,
RPC collection, pricing, recorded-activity periods, accountant handoff and exclusive
workspace lease. The agent can inspect a completed payment, retain its original
verification, reconcile merchant activity, close a saved period, prepare the
accountant's original packet and apply a reviewed return. The exact delivered
response remains retrievable throughout that operation.

The complete [Bitwave Data Fusion workflow](./BITWAVE.md) uses the same owned
workspace and accountant instance. Its thirteen additional tools operate declared
customer organizations and native tables, retained delivery/capture and repair,
concurrent-bookkeeping return review, exact file transfer and browser/MCP handover.

The complete [cancellation and refund workflow](./ADJUSTMENTS.md) uses the same
original adjustment controller, retained verification jobs and workspace lifetime.
Its nine additional tools carry reviewed requests, native returned amounts and
exact request/proof downloads through the original close and accountant history.

The complete [QuickBooks and Xero workflow](./ACCOUNTING-PLATFORMS.md) uses those
same original accountant and maintenance lifetimes. Its 34 tools carry native
company/source review, retained journals, original provider operation and response
reconciliation, accountant return recovery and exact files. The
[shared customer SDK and durable CLI](./ACCOUNTING-PLATFORMS-CLIENT.md) preserve
reviewed commands and original identities across an uncertain connection.

The same [QuickBooks host workflow](./ACCOUNTING-PLATFORMS.md#use-a-reviewed-quickbooks-oauth-company)
also accepts the original reviewed OAuth company selection. It reuses the native
connection registry and provider inside this accounting lifetime. Retained plans,
accountant returns and files remain available after a grant is revoked; explicit
provider operations require the selected current authorization. Existing token
environment configuration remains supported.

The host selects files and directories. MCP arguments use declared aliases,
retained object identities and current revisions. Payment signing and settlement
remain in the original buyer, seller and facilitator.

## Attach the original accounting sources

Add an optional `accounting` object to the existing private merchant MCP JSON.
Paths in this object resolve relative to that configuration file. Declare the
existing native outbox directory, original SF86 proof directory and original
merchant accounting terms, including their actual network and asset. Declare
each workspace directory once.

```json
{
  "accounting": {
    "workspaces": {
      "sales": {
        "label": "Merchant sales",
        "directory": "./accounting-workspace",
        "outboxDir": "../merchant/outbox",
        "proofDir": "../merchant/proofs",
        "termsFile": "../merchant/accounting-terms.json",
        "recoveredSources": {
          "completed": "../merchant/recovered"
        },
        "recoveryRequests": {
          "delivered-order": "../merchant/recovery-request.json"
        },
        "proofFiles": {
          "rpc-result": "../merchant/original-sf86-result.json"
        },
        "termsFiles": {
          "reviewed-pricing": "../merchant/reviewed-accounting-terms.json"
        }
      }
    }
  }
}
```

This fragment extends the existing merchant configuration; retain its original
schema, merchant name, release store, export directory, sources and any catalog or
fleet configuration. Empty source maps can be omitted. The host may declare up to
16 accounting workspaces and 64 aliases in each source map. The normal merchant
initializer also accepts `--accounting ACCOUNTING_JSON`, where that file contains
the object inside `accounting`; its paths resolve relative to that file and are
stored as absolute host paths in the generated merchant configuration.

For collection, pricing and accountant returns, add the following optional fields
inside the chosen workspace. Replace the payer placeholder with the complete
original Stellar public account from the retained payment. The file paths identify
the original source files that the host has selected.

```json
{
  "collectionInputs": {
    "delivered-order": {
      "file": "../merchant/original-payment-record.json",
      "kind": "sf81-record",
      "payer": "<full original Stellar payer public key>",
      "maxEventPages": 24
    }
  },
  "pricingReports": {
    "retained-month": "../revenue-period/report/report.json"
  },
  "accountantReturns": {
    "reviewed-return": "../accountant/returned.csv"
  }
}
```

A collection input can instead use `kind:"sf82-evidence"` for an original SF82
checkout evidence file. Its optional `rpcEndpoint` is host-selected; omission uses
the original network profile. The original verifier checks the selected source,
payer and endpoint. `maxEventPages` accepts 1–100. Optional workspace field
`collectionHttpsProxyEnv:"HTTPS_PROXY"` selects the environment-variable name used
by the original public transport. Endpoint URLs contain no credential values.
Collection settings are retained with each imported input; changing a host alias
does not change an already prepared collection.

`pricingReports` points to the original saved SF97 report, up to 64 MiB.
`accountantReturns` points to a returned original CSV, up to 64 MiB. Both source
maps contain file paths, as do `proofFiles` and `termsFiles`. Source inspection
returns these aliases; a caller cannot supply an arbitrary path or RPC URL in a
tool invocation. Full source bytes are read by the host into the existing
controller, so large reports and CSVs do not need to fit inside an MCP argument.

Use separate private directories with mode `0700` for the accounting workspace,
native outbox, original proofs and recovered collection. The original workspace
validates its paths and source terms when opened. Original recovery request and
retained entry files use mode `0600`. The browser and MCP share the original
exclusive lease: close one interface before opening the same workspace in the
other. A different workspace may capture the same original source collection.

Prepare `recovery-request.json` using the
[original recovery guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/RECOVERY.md).
Its original schema binds the completed SF31 outcome, exact request/body, merchant
terms, payer and optional delivered response. Files inside that request retain
the original absolute-path contract. The same original network profile and
declared RPC endpoint are used by verification. An optional proxy is selected by
environment-variable name; credential values do not belong in the configuration.

For an existing accounting operation without a staged seller, put the object
inside `accounting` in a standalone private `ACCOUNTING_JSON` file and initialize
the same provider. No dummy API or paid endpoint is required:

```sh
starforge merchant-mcp init-accounting --dir /absolute/new/merchant-operator --accounting /absolute/private/accounting.json
starforge merchant-mcp serve --config /absolute/new/merchant-operator/merchant-mcp.json
```

An existing merchant starts its usual `serve --config MERCHANT_MCP.json` command
with the added accounting object; its source, fleet and catalog settings stay in
the same host configuration.

Supply its existing bearer credential in `MCP_ACCESS_TOKEN`; the listener remains
on loopback. Existing merchant MCP stdio launchers expose the same registered
tools. The accounting integration adds no server, dependency or payment adapter.

## Back up and restore the owned accounting operation

The [operator client](./ACCOUNTING-MAINTENANCE-CLIENT.md) prepares, executes and
reconciles this workflow over the same MCP connection. Add an optional `recovery`
object inside the declared accounting workspace:

```json
{
  "recovery": {
    "stateRoot": "..",
    "backupRoot": "../../private-accounting-backups",
    "passEnv": "STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE",
    "startPaused": false
  }
}
```

Choose the actual private state root containing the original workspace and inputs.
Use owner-private directories (0700); the backup catalog must be separate from
captured sources. Paths resolve relative to the host configuration. Supply the
passphrase through the named host environment variable, never a tool argument.
Each workspace has its own catalog. Existing configurations without this object
keep their ordinary accounting behavior.

Open the alias with `merchant_accounting_open`. All tools below use the prefix
`merchant_accounting_maintenance_` and require `workspace`:

| Tool suffix | Original operation and required selection |
| --- | --- |
| `status` | Read mode, review, backup inventory and retained progress. |
| `pause` | Drain accepted calls/readers and close owned controllers. |
| `review` | Review the complete paused source closure. |
| `backup` | Pin `expectedReviewId`; acknowledge `externalWritersStopped:true`; optional `label`. |
| `verify` | Select `backupId` and exact `expectedSha256`. |
| `restore` | Same backup pins plus `externalWritersStopped:true`. |
| `resume` | Reopen the original complete accounting operation. |
| `job` | Read retained `jobId` without executing it. |
| `cancel` | Request cancellation of the selected `jobId`. |

Every mutation requires `actor` (1-160 characters) and a stable UUID `requestId`.
Its response is `{accepted,job,state}`; follow that job until terminal. Repeating
the same ID and inputs reconciles a lost reply. Changed inputs require a new ID.
Stop external source writers before approving backup or restore. Backup rechecks
the reviewed source; an altered review requires another explicit review.

A stopped host retains jobs and the native recovery marker. Configure
`startPaused:true` to open maintenance with an absent or incomplete workspace.
Continue an interrupted restore with the SAME backup and a new request ID.
Resume succeeds only after the original workspace reopens. Closing MCP waits for
accepted maintenance work and releases its leases; it retains all original data.
After resume, retrieve the existing response, close and accountant packet using
their original IDs and digest. Start a new owned file read after pause.

Status summaries show 25 backups, 10 jobs and 25 sources per kind with exact counts.
Use `view:backups|jobs|sources`, `offset` and `limit` for pages. Jobs lists cover
the original latest 50; older retained IDs remain readable with `job`.

## Complete a recovered-purchase workflow

1. Call `merchant_accounting_sources` and select a declared workspace. Call
   `merchant_accounting_open` with `{"workspace":"sales"}`. Opening initializes
   or reopens the original retained state and acquires its lease. It makes no RPC
   or paid-resource request.
2. Read `merchant_accounting_status`. Use the returned `revision` on the next
   revision-based change. If the recovered collection is not connected, call
   `merchant_accounting_recovered_source` with the workspace, current revision,
   `source:"completed"` and an explicit `actor`. A previously connected collection
   stays selected when the workspace reopens; keep that path declared in the
   host's `recoveredSources` map.
3. Call `merchant_accounting_recovery_review` with the current revision,
   `source:"delivered-order"`, a descriptive `name` and `actor`. Review reads the
   original files and returns the retained `previewId`, exact input hashes,
   receipt binding and original response identity. Inspect those actual terms.
4. Call `merchant_accounting_recovery_import` with that `previewId`, the new
   revision and `actor`. The original asynchronous job checks that the reviewed
   inputs are unchanged. For an identical existing recovered entry it returns
   `ALREADY_IMPORTED`; a new import uses the original official verifier for the
   completed transfer. Follow `merchant_accounting_status` with `view:"jobs"`
   until the job reports its real completion, failure, interruption or
   cancellation. `merchant_accounting_recovery_cancel` requests cancellation by
   retained `jobId`; it does not reverse or resend a ledger transaction.
5. Call `merchant_accounting_capture` with the current revision, a run name and
   `actor`. The original workspace retains the selected native outbox prefix,
   terms, proofs and recovered entries before running its existing accounting
   engine. Follow the returned `runId` with `merchant_accounting_run`.
6. Inspect original tables with `merchant_accounting_rows`. Supported views are
   `ledger`, `options`, `exceptions`, `proofs` and `recovered`, up to 200 rows per
   page. The optional method filter follows the shared GET, HEAD, POST, PUT,
   PATCH and DELETE contract. Network, route, transfer, delivery and text filters
   use the original row values.
7. Retrieve the already-delivered result with `merchant_accounting_file`,
   `kind:"response"`, the original `recoveryId` and the completed `runId`.
   Supplying the run selects its immutable captured source. Without a run, the
   original current collection supplies the response. No merchant is called.
8. Export the original report and named reviews with `merchant_accounting_export`
   using the current revision, completed run, actor and explicit
   `includeSources:false` or `true`. Read the retained archive with
   `merchant_accounting_file`, `kind:"export"` and its returned `exportId`.
9. Call `merchant_accounting_close`, then reopen the same configured workspace
   when needed. Its runs, input identities, import status, reviews, exports and
   response snapshots remain original retained state.

All revision-based mutations return a compact current state. Original background
imports and reconciliations also advance the revision; refresh after observing
their completion. If the original workspace returns `STALE_WORKSPACE`, review the
current state before reapplying the intended change.

## Collect original payment verification

The collection controller operates original retained SF81 payment records and
SF82 checkout evidence. Its [native guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/README.md#collect-verification-in-the-same-workspace)
describes the source and verifier contract. Completed SF31 outcomes use the
recovery workflow above, preserving their recovered origin.

1. Call `merchant_accounting_collection_source` with a declared `source` alias,
   `name`, current workspace `revision` and `actor`. Inspect the returned original
   source ID, hash, network, payer, transaction and endpoint. Import retains the
   file and checks its native terms without calling RPC.
2. Call `merchant_accounting_collection_prepare` with the current revision, name,
   actor and an explicit array of distinct retained `sourceIds`. The original plan
   preserves all input hashes and network profiles.
3. Call `merchant_accounting_collection_start` with its `collectionId`, current
   revision, actor and `operation:"collect"`. Follow
   `merchant_accounting_status` with `view:"collectionJobs"`; the returned job
   retains its processed count, total, status and error. The original controller
   schedules at most two collection operations within this workspace.
4. Inspect `merchant_accounting_collection` for that ID. Its `view:"sources"`,
   `"results"`, `"proofs"` and `"jobs"` are paged up to 200 items. Result rows
   expose the original verdict and attempt history. A resumed collect processes
   unattempted records. To retry failures, explicitly supply only their source IDs
   in `retryIds`; the original controller accepts records whose current verdict
   is `NOT_RECONCILED`. No payment transaction is sent by collection.
5. Stop an owned operation with `merchant_accounting_collection_cancel` using its
   job ID and actor. Completed attempts remain retained. Once the operation is
   inactive, `merchant_accounting_collection_refresh` rereads its durable results
   and commits current totals using the original revision.
6. Call `merchant_accounting_collection_start` with `operation:"publish"` and the
   current revision. The original publisher imports the exact latest result files
   through the same proof importer. Existing proof identity and inclusion choices
   survive duplicate publication. Read the original proof file with file
   `kind:"collection"`, `collectionId` and `sourceId`.

These operations preserve the verifier's original distinction between supported
network RPC results and local RPC replay results. Reconciliation uses the existing
proof eligibility and classification. Status views `collectionSources`,
`collections` and `collectionJobs` expose the retained operation after reopening.

## Review pricing and capture its original provenance

Call `merchant_accounting_pricing_review` with a host-declared pricing source,
name, current revision and actor. It returns the retained `review.id`, original
report SHA256 and the derived terms identity. An optional `accountingReference`
is the original short accounting label: 3–100 letters, numbers, spaces or
`_ . : / -`. The full original price basis remains in the retained provenance.

Use `merchant_accounting_pricing` with the review ID to page all original payment
options. Supply `baselineSelection:"source"` or a retained terms ID to inspect
the original added, removed and changed option comparison. Select the reviewed
version explicitly with `merchant_accounting_pricing_select`, current revision
and actor. Future captures use those terms and retain the complete pricing report
inside the original input manifest. Earlier runs keep their existing inputs.

Read the retained original report or terms with file `kind:"pricing"`, `reviewId`
and `file:"report"` or `"terms"`. After capture, use that completed `runId` in place
of `reviewId` to retrieve the exact original pricing inputs captured by that run.
The selected report's quoted USD and source costs remain its original values;
asset labels and this MCP integration do not create exchange rates. See the
[original pricing import guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/PRICING.md).

## Close a recorded-activity period

Periods use the original native capture time or recovered-entry import time.
Their UTC bounds include `from` and exclude `until`; the original
[recorded-activity contract](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/PERIODS.md)
describes the exact selection and retained source scope.

1. Call `merchant_accounting_period_save` with current revision, actor, name,
   explicit UTC `from`/`until`, optional note and `select:true`. It retains the
   definition ID and its new immutable version. To revise a definition, pass its
   `id` and current `expectedVersion`. Status `view:"periods"` lists latest
   versions; `merchant_accounting_period_definition` pages a selected definition's
   full version history.
2. `merchant_accounting_period_select` chooses an exact `{id,version}` or `null`
   for all recorded activity. Read the workspace's returned `periodSelection`.
3. Call the existing `merchant_accounting_capture` with the current revision,
   run name, actor and `expectedPeriodSelection` set to that exact object or null.
   The original workspace checks the choice and captures complete original
   sources before applying its recorded-activity filter. Follow the run and
   inspect its native totals, selected rows, exclusions and exceptions.
4. Call `merchant_accounting_period_close` with the completed run ID, current
   revision, close name, actor, optional note and explicit `includeSources`.
   The run must have captured a saved period. The original export writer freezes
   the report, input manifest and current named review notes into a retained close.
5. `merchant_accounting_period` reads that `closeId`, its frozen versus current
   review counts, changes and previous close. `view:"notes"` pages the original
   frozen exception notes beside their current reviews. An open or investigating
   exception remains visible in the close.

Download the exact `period-close.json`, `review-notes.json` or original `archive`
using file `kind:"period"` and `closeId`. A later source capture, review edit or
period revision does not rewrite an earlier close. Existing run comparison remains
available for the same period or different explicit versions.

## Prepare an accountant handoff and apply a returned CSV

The [original accountant contract](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/SCHEMA.md)
owns the CSV, protected source fields, external assignments, return history and
packet files. This workflow uses the same open accounting workspace and revision.

1. Call `merchant_accounting_accountant_prepare` with a completed `runId` or a
   retained `closeId`. A supplied run and close must identify the same original
   reconciliation. Review the returned source hashes, original totals, row count
   and paged payment options.
2. Generate and retain a stable UUID for the handoff. Call
   `merchant_accounting_accountant_create` with that `id`, selected run or close,
   current workspace revision, name and actor. Optional `labels` is an array of
   objects containing an actual `optionId` and any of `assetLabel`, `unitLabel`,
   `accountCode`, `accountName` (each up to 160 characters). Labels identify the
   source unit and account; the original atomic amount stays exact.
3. Read `merchant_accounting_accountant` with its `handoffId`. Detail views
   `revisions`, `files`, `issues` and `labels` are paged; status `view:"handoffs"`
   lists retained handoffs and latest returns. `merchant_accounting_accountant_rows`
   pages original ledger rows beside the selected external assignments. Download
   `accountant.csv` or `accountant-handoff.tar` using file `kind:"accountant"`,
   that handoff ID and `revisionId:"initial"` for the immutable initial packet.
4. The accountant edits the original CSV's four external columns:
   `externalStatus`, `externalBookRef`, `externalAccountCode`, `externalNote`.
   Available statuses are `UNREVIEWED`, `REVIEWED`, `BOOKED`, `EXCLUDED`.
   `BOOKED` records an accountant-reported external entry and requires its book
   reference. Original amounts, source identity, classifications and retained
   labels remain protected. Place the returned file at a declared
   `accountantReturns` alias.
5. Call `merchant_accounting_accountant_preview` with `handoffId`, source alias,
   actor, return name and `expectedParentId:null` for the first return, or the
   actual latest saved return ID. Inspect its original summary and paged
   `results`, `issues`, `assignments` or `missingRows`. To read more pages of this
   same proposed revision, repeat its returned `revision.id`, `revision.createdAt`
   and `source.sha256` as `id`, `createdAt`, `sourceSha256`, together with the same
   source, name, actor and expected parent. Preview does not save a return.
6. Explicitly save the reviewed proposal with `merchant_accounting_accountant_apply`.
   Copy these values from that preview; keep the source, handoff, name and actor
   unchanged:

   | Apply argument | Original preview field |
   | --- | --- |
   | `id` | `revision.id` |
   | `createdAt` | `revision.createdAt` |
   | `revision` | `workspaceRevision` |
   | `expectedParentId` | `expectedParentId` |
   | `sourceSha256` | `source.sha256` |
   | `previewSha256` | `revision.integrity.sha256` |

The original controller applies matching rows while retaining protected-field
conflicts and unmatched records. Rows omitted from a return inherit their prior
assignments. Read the returned summary and issues before treating the imported
file as complete. A changed source file, newer parent or stale workspace revision
requires a current preview. A lost response to create/apply can be recovered by
repeating the same stable ID and exact original arguments; a different request
under that ID is rejected.

Download a specific saved return using its `revisionId`. Omission selects the
latest return; an explicit ID keeps later process reopening tied to that exact
packet. The retained return adds `returned.csv` and `return.json` alongside its
complete current CSV, offline HTML, original source documents and TAR. Close and
reopen the same MCP workspace to continue these original assignments and retrieve
the already-delivered paid response. Creating a handoff or importing a CSV does
not send an accounting entry to a third-party service.

## Exact files and bounded delivery

`merchant_accounting_file` returns a file name, full byte count, full SHA256,
`readId`, base64 `data`, chunk offset, `bytesRead`, and `nextOffset`. Decode each chunk and
append its bytes in offset order. The first request defaults to 65,536 bytes and
may request up to 196,608. Every later request must include the returned SHA256 as
`expectedSha256`, together with the same `readId`; continue until `nextOffset` is `null`. Verify the complete byte
count and hash before using the assembled file.

Use the original source selectors for the chosen kind. Other selector fields are
rejected; keep the same selection on every continued chunk.

| Kind | Source selectors | Original file |
| --- | --- | --- |
| `response` | `recoveryId`, optional captured `runId` | Retained delivered response |
| `report` | `runId`, `file` | `report.json`, `ledger.csv`, `options.csv`, `exceptions.csv`, `review.html`, `manifest.json` |
| `export` | `exportId` | Original retained review TAR |
| `collection` | `collectionId`, `sourceId` | Latest retained original verification result |
| `pricing` | Exactly one `reviewId` or captured `runId`, `file` | `report` or `terms` |
| `period` | `closeId`, `file` | `period-close.json`, `review-notes.json`, `adjustments.json`, `adjustments.csv`, `adjustments.html`, `archive` |
| `accountant` | `handoffId`, optional `revisionId`, `file` | A filename from the original packet's file list, including retained adjustment companions |
| `adjustment` | `adjustmentId`, optional original `jobId`, `file` | `request.json`, or `proof.json` with its completed verification job |

Accountant filenames are `handoff.json`, `accountant.csv`, `review.html`,
`original-report.json`, `original-manifest.json`, `input-manifest.json`,
`packet-manifest.json`, `accountant-handoff.tar`, optional `period-close.json` and
`review-notes.json`, and a saved return's `returned.csv` and `return.json`.
Opening a read delegates once to the selected original owner's verification.
Continued chunks use that exact verified snapshot.

The accounting interface retains at most four reads and 256,000,000 bytes of verified
snapshots in total. Files up to 32 KiB stay in memory; larger files use private
temporary descriptors unlinked immediately after materialization. Persistent
snapshot memory is therefore at most 128 KiB, alongside a chunk buffer and the
original verifier's temporary whole-file buffer. Whole-file materialization is
serialized. The last chunk frees its snapshot; `merchant_accounting_file_release`
abandons a selected read without changing its original file. Two minutes of idle
time, workspace close, provider close and process exit also release snapshots.
Status shows active read identities, expiry, storage type and the count of
original file-reader invocations.

After expiration or process restart, omit `readId` and open a new original read
with the same `expectedSha256` and desired byte offset. The original file is
verified again once before that resumed transfer. A changed file returns an
explicit identity conflict.

Exports with `includeSources:true` contain the actual captured private source
files and any retained response bytes. Select that explicitly when a full
merchant handoff is intended. The default report-only handoff keeps the original
report, named review notes and source identities. Reproduction uses the original
accounting CLI with the captured source directories, including `--recovered-dir`
when `sources/recovered` is present.

## Original proofs, pricing, exceptions and comparison

Use `merchant_accounting_input_import` with `kind:"proof"` or `"terms"` and a
host-declared source alias. The original workspace checks proof eligibility and
compiles terms. `merchant_accounting_input_select` chooses an imported proof's
`included` state, a retained terms ID, or `selection:"source"` for original terms.
Terms do not introduce invented fiat prices; the original report retains its
actual asset amount and any explicitly supplied pricing provenance.

For an actual exception row, `merchant_accounting_review` requires its returned
exception ID and current note `version`, a status (`open`, `investigating` or
`reviewed`), note and named actor. Optional assignment is retained alongside the
original note history. Reviews do not change the original transfer classification.

`merchant_accounting_compare` takes current and baseline run IDs and pages original
`changed`, `added`, `removed` or `options` rows. The state view exposes the latest
100 original history records and counts for all retained runs, imports and
exports. Detailed status views are paged; original complete files remain available
through verified file retrieval.

Closing the original provider first rejects new operations, then waits for its
accepted calls. The accounting adapter stops its owned collection controller
before closing the original accounting workspace, then that workspace drains its
recovery work and retained captures. Outstanding original file reads are released
and only its own workspace leases close. Pricing, periods and accountant returns
use that same lease and state. Existing seller, fleet, discovery and support
ownership retain their original lifecycle. A later process reopens the same
original state.
