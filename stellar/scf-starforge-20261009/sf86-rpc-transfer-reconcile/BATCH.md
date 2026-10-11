# Retained merchant transfer collection

Prepare original checkout records once, collect both Stellar networks, resume
an interrupted session, and deliver the current proof set to the original
merchant accounting report. The collector imports the existing SF82 evidence
reader, SF86 verifier, SF43 official Stellar decoder and SF98 Linux kernel
lease. It reads chain state and writes private local result files.

## Prepare the original records

Use Node 22+ on Linux with `flock` from util-linux. Reuse the original merchant
runtime's installed `@stellar/stellar-sdk`; preparation, status and export do
not require a network connection or signing configuration.

Save an operator plan outside the repository. Each source is either an original
stripped SF81 record (`sf81-record`) or an original SF82 evidence envelope
(`sf82-evidence`). The payer is the independently known original wallet account.
The following shows the plan shape; replace the paths and payer with your own
original records:

```json
{
  "schema": "stellar-forge.sf86.collection-plan.v1",
  "jobs": [
    {
      "id": "merchant-order-1042",
      "kind": "sf82-evidence",
      "sourceFile": "/private/checkout/original-evidence.json",
      "payer": "YOUR_ORIGINAL_TRUSTED_G_ADDRESS",
      "rpcEndpoint": "https://soroban-rpc.mainnet.stellar.gateway.fm",
      "maxEventPages": 24
    }
  ]
}
```

Mixed testnet/public-network records can share a plan; each selects its own
[approved network provider](NETWORKS.md). The source's exact terms determine
the network. Job IDs are stable and unique within a collection. Source files
are at most 4 MB each, plans support up to 2,000 jobs, and original event-page
limits remain configurable per job. Preparation reads one source at a time.

```sh
node stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/batch-cli.mjs \
  prepare --plan /private/merchant-collection.json \
  --directory /private/collections/october-11
```

The collection directory must be new. It contains the original plan, copied
source bytes, source hashes, selected network/provider and original transaction
identity. Preparation verifies the original record and SF82 envelope binding
before publishing its manifest. The retained sources remain usable after the
input files move. Directories are mode 0700 and files are mode 0600.

## Collect and resume

```sh
node stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/batch-cli.mjs \
  collect --directory /private/collections/october-11
node stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/batch-cli.mjs \
  status --directory /private/collections/october-11
```

Each original verification runs once and publishes an immutable result file.
The command reports progress on stderr and a complete JSON summary on stdout.
Exit 0 means every selected read completed without unresolved results; exit 2
means unresolved or unattempted records remain. The summary separates actual
provider matches, local development replays, failed reads and unattempted jobs.

SIGINT/SIGTERM cancels the current read after saving completed attempts. The
command exits 130. Running `collect` again processes only unattempted jobs.
The original kernel-backed lease releases when the collector exits or dies,
so there is no stale PID lock to delete. A collection has one writer; the
merchant's original outbox stays with its existing writer.

For an explicit new read of an unsuccessful job:

```sh
node stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/batch-cli.mjs \
  collect --directory /private/collections/october-11 --retry merchant-order-1042
```

Repeated `--retry JOB_ID` options select several unsuccessful jobs. Earlier
attempt files remain, and each later result records the previous result's
SHA-256. Completed successful matches cannot be selected for retry. Create a
new collection when selecting a different provider or original source record.
An operator inspecting the same collection sees its exact source and attempt
history, including a failed read followed by a successful read.

## Produce the original merchant report

Supply the existing native SF98 outbox and original merchant pricing terms:

```sh
node stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/batch-cli.mjs \
  report --directory /private/collections/october-11 \
  --outbox /private/merchant/sf98-outbox \
  --terms /private/merchant/pricing.json \
  --output /private/reviews/october-11
```

The new output directory contains `proofs/`, an export manifest binding each
result to its original source and attempt, and `accounting/`. The accounting
subdirectory comes from the original writer: `report.json`, `ledger.csv`,
`options.csv`, `exceptions.csv`, `review.html` and its existing manifest.
Open `accounting/review.html` for option-level reconciliation and exceptions.
The original merchant accounting workspace can also load `proofs/` directly.

For proof export alone, use `export --directory COLLECTION --output NEW_PATH`.
Exports copy one current original SF86 result per attempted job. They preserve
the successful, unresolved or local-replay verdict without changing it. New
exports never overwrite previous reports. If accounting is interrupted after
export, repeat the same `report` command with `--resume`. The retained export is
checked against its original attempt files before use. A complete report is
reopened after its original manifest hashes match; incomplete or changed
report files are preserved under `interrupted/` and the original writer creates
a fresh `accounting/` view. That view uses the same selected proof set and the
current original outbox and terms at the originally chosen paths. A source/path
change requires a fresh explicit export/report request.

To include completed native purchases retained by the original recovery
importer, add `--recovered-dir /private/merchant/recovered` to `report` and
repeat that same path when resuming. The original accounting engine loads
the recovery store alongside SF98 events and the selected SF86 files. Recovered
settlement and response counts remain visible with their source identity;
duplicate transaction handling spans both kinds of merchant records. See the
[completed-purchase recovery workflow](../merchant-settlement-accounting/RECOVERY.md)
for original request/outcome/response import and response reuse.

## Application API

`batch.mjs` exports `prepareBatch({planFile,directory})`,
`inspectBatch({directory})`, `collectBatch({directory,retryIds,signal,onResult})`
and `exportBatch({directory,output})`. `inspectBatchExport({directory,output})`
reopens a retained proof export. `batch-report.mjs` supplies
`reportBatch({directory,output,outboxDir,termsFile,recoveredDir,resume})` through the original
accounting writer. `collectBatch` returns per-job status and
network-separated verdicts; `onResult` runs after the immutable attempt has been
published. `exportBatch` returns `proofDirectory` for the existing
`runOriginalAccounting` or original accounting CLI. It preserves the complete
original result schema with one additive `collector` lineage object.
