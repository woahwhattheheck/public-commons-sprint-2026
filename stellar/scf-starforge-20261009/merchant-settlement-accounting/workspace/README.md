# Merchant settlement workspace

This local operator application keeps a merchant's reconciliations, imported original verification results, exception reviews, comparisons, and downloads together across restarts. It runs the existing `merchant-settlement-accounting/reconcile.mjs` engine and the existing CLI's report writer directly. The original SF98 journal reader, SF86 proof classifications, multi-option identity, and exact monetary arithmetic remain the accounting source.

## Open on the merchant host

Use Node 22 or later on Linux, with `flock` and `tar` available. The source checkout supplies all JavaScript modules; this workspace adds no package dependencies. The existing merchant outbox and SF86 result directory must be private directories with mode 0700. Select the original merchant accounting terms JSON described in [the accounting guide](../README.md).

From the repository root:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/server.mjs \
  --workspace /private/merchant/accounting-workspace \
  --outbox /private/merchant/sf98-outbox \
  --proof-dir /private/merchant/sf86-results \
  --terms /private/merchant/accounting-terms.json
```

The workspace directory must be separate from its original input directories. It is created at mode 0700, with new retained files at mode 0600. Open the printed `http://127.0.0.1:8446` address. Set `--port 8450` to choose a different local port.

The browser has no account creation, login, or token entry. The server binds to loopback and validates its local Host header; writes use same-origin JSON requests with the workspace header. Run it in the merchant's private operating-system session. It is a local application, with filesystem access under the account that starts it.

Reopen the same retained work later:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/server.mjs \
  --workspace /private/merchant/accounting-workspace
```

Original source paths are retained in the workspace. Import another terms file through the interface when the merchant's approved terms change. Use a separate workspace directory for a different source outbox.

## Complete a merchant review

Enter the operator or reviewer name in the sidebar. It is recorded with imports, reconciliation runs, review decisions, and exported handoffs.

1. **Review sources and import original files.** The source screen shows the configured native paths. Import an original `stellar-forge.sf86.rpc-reconciliation.v1` JSON result or `stellar-forge.merchant-accounting-terms.v1` merchant terms. Imported files retain their exact bytes, SHA256, filename, and original verdict. Choose which imports will enter the next reconciliation. The configured SF86 directory is always included; imported terms can be selected or switched back to the original source file.
2. **Capture a reconciliation.** Give it a useful name and select *Reconcile current sources*. The application retains its input bytes and runs the original engine in the background. The run list shows queued, running, completed, failed, or interrupted work. Existing completed results remain available while a new run executes.
3. **Inspect every record.** The event ledger, payment options, exception queue, and verification files are paginated and searchable. Open a row to inspect its full native fields. Atomic amounts and merchant USD values remain exact decimal strings. Configured options with no events remain visible, and each actual option keeps its own atomic totals.
4. **Investigate exceptions.** Add a named review note, assignee, and status of open, investigating, or reviewed. Notes follow the same event and the same exception reason into later reconciliations. A new reason starts its own review. Review status stays separate from the original transfer classification.
5. **Compare retained runs.** Choose the current and baseline run. The comparison reports added, removed, and changed events, resolved and new exceptions, and complete before/after payment-option totals. Event changes include original delivery and verification fields as well as merchant terms, quote, and cost fields. The application displays original exact values side by side.
6. **Create the handoff.** Export a new review download from a completed run. The archive includes the original report files and a snapshot of the named exception notes. Existing exports remain unchanged. Select *Include private captured source files* when the recipient also needs the retained journal, terms, and verification files.

Refresh preserves unsaved form text. If another operator saved the same review or changed the workspace revision, the interface retains the draft and offers an explicit reload and reapply action. Completed background work can also advance the workspace revision. A stale write is never silently substituted for the newer saved state.

## Original result classifications

The interface uses the existing engine's result fields without interpreting a review note as payment evidence:

| Original field or classification | Operator meaning |
| --- | --- |
| `OFFICIAL_TRANSFER_MATCHED` | Existing SF86 official proof matched the original recorded network and payment option |
| `NATIVE_SUCCESS_UNVERIFIED` | Native settlement success still needs independent matching verification |
| `PUBLIC_NETWORK_PENDING` | The original engine reports a public-network event awaiting compatible verification |
| `LOCAL_RPC_REPLAY_MATCHED` | Original local replay result remains excluded from official transfer counts |
| `WEBHOOK_ACCEPTED_NOT_FULFILLED` | Native delivery received a webhook acknowledgment |
| `DELIVERY_EXHAUSTED` | The original delivery worker exhausted its attempts |
| Review status `reviewed` | An operator recorded a review note; the original classification remains visible |

Original duplicate-transaction, conflicting-proof, ambiguous legacy-recipient, and unknown-terms behavior is preserved. An identical imported file already present in the original proof directory is captured once; the import remains listed as a duplicate of that original file. Conflicting original files remain available to the original engine's conflict detection.

The original engine's `verifiedQuotedValueUsd` is the merchant's own quote for independently matched units. The UI preserves its label and exact decimal string. Payment-option atomic totals are never combined across different options or networks.

## What a run retains

The workspace captures a completed prefix of `deliveries.ndjson` before a completed prefix of `events.ndjson`. Native delivery records refer to events already appended by the original producer. This order includes the required event for each captured delivery status while allowing the merchant to keep appending new events. Later appends enter the next reconciliation. The two files are a retained capture, rather than a simultaneous global journal instant.

Missing or empty native journals represent an empty outbox. An incomplete trailing append fails the capture with a clear message; start a new reconciliation after the original producer finishes its append. A source file that is truncated during capture also fails the run. Imported choices are retained with the queued run, and selected source bytes are frozen before the original accounting engine begins.

Each completed run contains:

| Retained path | Purpose |
| --- | --- |
| `sources/outbox/` | Captured native event and delivery journal bytes |
| `sources/proofs/` | Included original verification result bytes |
| `sources/terms.json` | The selected original merchant accounting terms |
| `input-manifest.json` | Captured file paths, SHA256 values, original filenames, and verification descriptions |
| `report/` | The original six create-only accounting outputs |

The workspace records original report and manifest hashes. Downloads and exports check the retained original file hashes before returning them. The original CLI still writes the same six report files, using its unchanged formats: `report.json`, `ledger.csv`, `options.csv`, `exceptions.csv`, `review.html`, and `manifest.json`.

## Export and reopen

A review download is a standard TAR archive with the six original accounting files, `review-notes.json`, `input-manifest.json`, and `START.txt`. Source-inclusive exports also contain `sources/`. The review notes are captured at export time; later note edits do not alter earlier archives. The browser also provides individual downloads for all six original accounting files.

To reproduce a source-inclusive export using the same original checkout, extract it into a private directory and run:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/cli.mjs \
  --outbox /private/extracted-review/sources/outbox \
  --proof-dir /private/extracted-review/sources/proofs \
  --terms /private/extracted-review/sources/terms.json \
  --out /private/reproduced-accounting-report
```

The output path must be new. Exported operator notes remain in their separate file; the original engine computes the accounting result from the retained native sources.

Workspace state is atomically replaced and fsynced under the existing Linux filesystem lease. One server owns a given workspace directory. Stopping and reopening preserves completed runs, imported files, review history, and exports. If the process stops during a run, reopening marks that run interrupted and retains any captured files; the operator can capture current sources as a new run. Earlier completed results and downloads stay available. Stop the server before copying the entire private workspace for an operating-system backup.

Limits follow the original accounting engine: up to 20,000 native events, 16 MB per source journal, 200 payment options, and 2,000 combined verification files. An imported SF86 file is limited to 80 KB and terms to 200 KB. Workspace history is limited to 32 MB, with up to 5,000 retained runs. Archive a completed workspace and start another when those retention limits are reached.
