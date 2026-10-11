# Operate merchant accounting and recovered purchases through MCP

The existing merchant MCP service operates the same retained accounting workspace
as the [merchant accounting browser](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/README.md).
It uses the original source capture, classifier, report writer, recovery importer,
review notes and exclusive workspace lease. The agent can inspect an already
completed payment, retain its original verification, reconcile merchant activity,
and retrieve the exact delivered response without purchasing it again.

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

## Exact files and bounded delivery

`merchant_accounting_file` returns a file name, full byte count, full SHA256,
base64 `data`, chunk offset, `bytesRead`, and `nextOffset`. Decode each chunk and
append its bytes in offset order. The first request defaults to 65,536 bytes and
may request up to 196,608. Every later request must include the returned SHA256 as
`expectedSha256`; continue until `nextOffset` is `null`. Verify the complete byte
count and hash before using the assembled file.

For original reports, use `kind:"report"`, the completed `runId`, and one of
`report.json`, `ledger.csv`, `options.csv`, `exceptions.csv`, `review.html` or
`manifest.json`. Every read delegates to the original report-manifest or
recovered-response verification. Chunking changes only transport framing.

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
accepted calls. The accounting adapter stops owned read-only recovery work,
finishes retained captures and outstanding file reads, and releases only its own
workspace leases. Existing seller, fleet, discovery and support ownership retain
their original lifecycle. A later process reopens the same original state.
