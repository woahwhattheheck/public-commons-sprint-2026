# Merchant settlement workspace

This local operator application keeps a merchant's reconciliations, imported original verification results, recovered original purchase outcomes, exception reviews, comparisons, and downloads together across restarts. It runs the existing `merchant-settlement-accounting/reconcile.mjs` engine and the existing CLI's report writer directly. The original SF98 journal reader, SF86 proof classifications, explicit recovered-settlement reader, multi-option identity, and exact monetary arithmetic remain the accounting source.

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

An existing original recovered-settlement collection can also be selected at startup with `--recovered-dir /private/merchant/recovered-settlements`, or connected through the source screen after opening the workspace. The collection must be separate from the workspace, outbox, and verification directories.

## Complete a merchant review

Enter the operator or reviewer name in the sidebar. It is recorded with imports, reconciliation runs, review decisions, and exported handoffs.

1. **Review sources and import original files.** The source screen shows the configured native paths. Import an original `stellar-forge.sf86.rpc-reconciliation.v1` JSON result or `stellar-forge.merchant-accounting-terms.v1` merchant terms. Imported files retain their exact bytes, SHA256, filename, and original verdict. Choose which imports will enter the next reconciliation. The configured SF86 directory is always included; imported terms can be selected or switched back to the original source file.
2. **Capture a reconciliation.** Give it a useful name and select *Reconcile current sources*. The application retains its input bytes and runs the original engine in the background. The run list shows queued, running, completed, failed, or interrupted work. Existing completed results remain available while a new run executes.
3. **Inspect every record.** The event ledger, payment options, exception queue, and verification files are paginated and searchable. Open a row to inspect its full native fields. Atomic amounts and merchant USD values remain exact decimal strings. Configured options with no events remain visible, and each actual option keeps its own atomic totals.
4. **Investigate exceptions.** Add a named review note, assignee, and status of open, investigating, or reviewed. Notes follow the same event and the same exception reason into later reconciliations. A new reason starts its own review. Review status stays separate from the original transfer classification.
5. **Compare retained runs.** Choose the current and baseline run. The comparison reports added, removed, and changed events, resolved and new exceptions, and complete before/after payment-option totals. Event changes include original delivery and verification fields as well as merchant terms, quote, and cost fields. The application displays original exact values side by side.
6. **Create the handoff.** Export a new review download from a completed run. The archive includes the original report files and a snapshot of the named exception notes. Existing exports remain unchanged. Select *Include private captured source files* when the recipient also needs the retained journal, terms, and verification files.

Refresh preserves unsaved form text. If another operator saved the same review or changed the workspace revision, the interface retains the draft and offers an explicit reload and reapply action. Completed background work can also advance the workspace revision. A stale write is never silently substituted for the newer saved state.

## Collect verification in the same workspace

The **RPC collections** area retains original reserved payment records and their read-only verification work alongside the accounting inputs. Use the merchant runtime's existing `@stellar/stellar-sdk` event decoder for network collection.

1. **Review original payment files.** Select SF81 record JSON or SF82 checkout evidence and enter the independently known payer account. Each upload retains its exact source bytes and validates the original reservation, receipt and payment terms. The default RPC endpoint comes from the shared network catalog. An optional endpoint must match that network's catalog or the original loopback replay format.
2. **Prepare the selected collection.** Choose the reviewed sources and name the collection. Preparation snapshots their exact bytes through the original SF86 batch API. Sources and prepared collections remain available after reopening.
3. **Collect and resume.** Start read-only verification and follow the per-record result and attempt count. Stop an active operation when necessary; completed original results stay retained. Resume collects only unattempted records. Select unsuccessful records to retry explicitly; earlier attempts remain unchanged. Two collection operations may progress at once, with further operations queued in the same workspace.
4. **Use current results in accounting.** Publish the selected collection's current original results. The workspace retains an immutable original export and imports its files through the existing accounting import API. Repeating publication reuses identical imported files and preserves an operator's inclusion choices. Interrupted publication can be resumed by publishing the current results again.
5. **Capture and export the reconciliation.** Capture current selected sources using the existing accounting workflow. The run includes selected collection results, native journal events and any connected recovered-payment collection. Review the original classifications, then download the original report or source-inclusive review archive. Each collection record also offers its current original verification JSON.

Uploaded sources support 4 MB per file and 2,000 retained sources. Collection input paths and progress live under the existing private workspace; the original batch engine owns its source snapshots and immutable attempts. On process restart, unfinished operations are marked interrupted and their completed attempt files are read through the original inspector. Current progress uses the retained batch results, with an in-memory view while an operation is active. Workspace revisions advance for meaningful operator and operation transitions rather than every network response.

For a host with an explicitly configured HTTPS CONNECT proxy, start or reopen with `--rpc-proxy-env HTTPS_PROXY`. The existing public HTTPS transport reads that environment variable on the host. Enter the variable name at startup; the browser handles the retained records and public account identities.

## Use a saved pricing decision

Open **Pricing decisions** to upload an original saved SF97 pricing report.
The existing converter retains every payment alternative, exact amount, unknown
cost, original quote description, and observation source. Review and compare
its accounting terms, select the approved choice, and capture a reconciliation
that retains both original files. Earlier runs keep their own pricing sources.
The [complete pricing workflow](PRICING.md) covers original downloads, selected
terms, source-inclusive export, revision conflicts, and reopening.

## Recover an already completed purchase

The original recovery module handles a completed SF31 purchase whose native request, outcome, and optional delivered response were retained outside SF98. Its input and source-binding format is documented in [the original recovery guide](../RECOVERY.md). It keeps that origin explicit and uses the original network-specific SF86 verifier.

1. **Connect the recovered collection.** Choose its absolute private directory on the machine running the workspace. A new collection is created at mode 0700. An existing collection is read through the original recovery reader, which checks the retained entries and their source files. The screen records the latest inventory time. Refresh the collection after another original process adds entries; ordinary UI polling reads the saved inventory instead of rereading large response files.
2. **Review the original request.** Select a `stellar-forge.merchant-recovery-request.v1` JSON configuration. Its outcome, request, terms, and optional response paths refer to files on the workspace host. The workspace retains the exact configuration bytes and invokes `reviewRecoveredSettlement`. Review the original route, method, network, selected payment terms, transaction, payer, source hashes, and response identity before importing. This review reads the selected files locally.
3. **Import the reviewed result.** The workspace starts the original `importRecoveredSettlement` operation in the background. The original importer verifies the transfer using the configured official RPC endpoint and retains its canonical entry, proof, and source files. A previously imported identical transaction returns `ALREADY_IMPORTED` and reuses its retained proof. The importer never sends another paid request. Progress and any original error remain in the workspace after navigation or restart.
4. **Continue or cancel an attempt.** An in-progress read-only import can be cancelled. If the original durable import already completed, its completed result is retained. Retry the same reviewed request after cancellation, interruption, or an operational error; native import identity prevents a duplicate entry. If an original file changed after review, review the request again to inspect its current binding.
5. **Reconcile the selected sources.** The next run captures the connected collection alongside its selected native outbox, terms, and verification files. The original engine reports native successes and recovered settlements separately. Recovered rows retain `RECOVERED_ORIGINAL_SF31_OUTCOME`, their import-time basis, original entry/proof identities, and saved-response status. The engine's existing duplicate-transaction handling spans both origins.
6. **Inspect and download the result.** The recovered-source view shows the entries frozen with the selected run. A saved response can be downloaded from the current collection or from a retained run. Downloads return the exact original saved bytes through the original reader. Disconnecting the collection affects future reconciliations; earlier runs, their captured files, and completed import history remain available.

The selected merchant accounting terms still determine the current run's route and payment-option mapping. A retained recovery has its own original terms file for source binding; it does not silently replace the workspace's selected accounting terms.

Recovered response downloads and source-inclusive review archives can contain the original delivered merchant data, request metadata, and public account addresses. Use the source-inclusive option when the recipient needs those originals. The default review archive contains accounting identities and named review notes without those private source bytes.

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
| `RECOVERED_ORIGINAL_SF31_OUTCOME` | Original retained SF31 outcome imported through the canonical recovery source |
| `RECOVERED_RESPONSE_SAVED` | The original delivered response bytes are retained with this recovered entry |
| `RECOVERED_RESPONSE_NOT_RETAINED` | This recovered entry has no original saved response file |
| Review status `reviewed` | An operator recorded a review note; the original classification remains visible |

Original duplicate-transaction, conflicting-proof, ambiguous legacy-recipient, and unknown-terms behavior is preserved. An identical imported file already present in the original proof directory is captured once; the import remains listed as a duplicate of that original file. Conflicting original files remain available to the original engine's conflict detection.

The original engine's `verifiedQuotedValueUsd` is the merchant's own quote for independently matched units. The UI preserves its label and exact decimal string. Payment-option atomic totals are never combined across different options or networks.

## What a run retains

The workspace captures a completed prefix of `deliveries.ndjson` before a completed prefix of `events.ndjson`. Native delivery records refer to events already appended by the original producer. This order includes the required event for each captured delivery status while allowing the merchant to keep appending new events. Later appends enter the next reconciliation. The two files are a retained capture, rather than a simultaneous global journal instant.

Missing or empty native journals represent an empty outbox. An incomplete trailing append fails the capture with a clear message; start a new reconciliation after the original producer finishes its append. A source file that is truncated during capture also fails the run. Imported choices and source-directory selections are retained with the queued run, and selected source bytes are frozen before the original accounting engine begins.

Each completed run contains:

| Retained path | Purpose |
| --- | --- |
| `sources/outbox/` | Captured native event and delivery journal bytes |
| `sources/proofs/` | Included original verification result bytes |
| `sources/terms.json` | The selected original merchant accounting terms |
| `sources/pricing-report.json` | Original uploaded pricing report for the selected reviewed terms, when present |
| `sources/recovered/` | Connected original recovery entries, proofs, source files, and any saved response bytes |
| `input-manifest.json` | Captured file paths, SHA256 values, original filenames, and verification descriptions |
| `report/` | The original six create-only accounting outputs |

The workspace records original report and manifest hashes. Downloads and exports check the retained original file hashes before returning them. The original CLI writes the same six report files: `report.json`, `ledger.csv`, `options.csv`, `exceptions.csv`, `review.html`, and `manifest.json`. Its ledger and option CSVs include additive original-source, recovery-identity, and recovered-amount columns; existing columns remain in place. The original HTML displays native and recovered counts separately.

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

If the archive contains `sources/recovered/`, add:

```sh
  --recovered-dir /private/extracted-review/sources/recovered
```

The explicit directory preserves the captured recovery source during reproduction, including an intentionally empty connected collection.

Workspace state is atomically replaced and fsynced under the existing Linux filesystem lease. One server owns a given workspace directory. Stopping and reopening preserves completed runs, imported files, recovery reviews and attempts, review history, and exports. If the process stops during a run, reopening marks that run interrupted and retains any captured files; the operator can capture current sources as a new run. An interrupted recovery import can be retried from its saved review, including a native entry completed immediately before the interruption. Earlier completed results and downloads stay available. Stop the server before copying the entire private workspace for an operating-system backup.

Limits follow the original accounting engine: up to 20,000 native events, 16 MB per source journal, 200 payment options, and 2,000 combined verification files. An imported SF86 file is limited to 80 KB and terms to 200 KB. The original recovered collection supports up to 2,000 entries, 200 KB per source JSON, and 64 MiB per saved response. The workspace retains up to 2,000 recovery reviews and 5,000 import attempts. Input manifests are limited to 16 MB, individual review archives to 256 MB, and workspace history to 32 MB with up to 5,000 runs. Archive a completed workspace and start another when those retention limits are reached.
