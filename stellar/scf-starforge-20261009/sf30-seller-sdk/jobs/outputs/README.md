# Named result files for paid application jobs

A merchant function can return a report, a spreadsheet, and supporting files as one completed job. The buyer receives one verified ZIP package and can open or download each declared file from the existing Jobs view and Resource library. The original job, accepted price, payment, completed attempt and result digest remain attached to every file.

Existing JSON and byte functions keep their current result format. A function selects named outputs explicitly with `output.format: "package"`.

## Declare the files the application will produce

The merchant owns the output contract. Configure a name, media type, size limit and requiredness for each output slot:

~~~json
{
  "maxOutputBytes": 8388608,
  "output": {
    "format": "package",
    "filename": "invoice-reconciliation.zip",
    "files": {
      "report": {
        "filename": "invoice-reconciliation.json",
        "contentType": "application/json; charset=utf-8",
        "maxBytes": 6291456
      },
      "totals": {
        "filename": "currency-totals.csv",
        "contentType": "text/csv; charset=utf-8",
        "maxBytes": 65536
      },
      "exceptions": {
        "filename": "selected-exceptions.csv",
        "contentType": "text/csv; charset=utf-8",
        "maxBytes": 2097152
      }
    }
  }
}
~~~

Each slot is required unless `required: false` is declared. At least one slot must be required. A package can declare up to 16 files. The function's `maxOutputBytes` bounds the complete ZIP, including its manifest and ZIP overhead, and cannot exceed 64 MiB. Each file also has its own limit. Leave room for the manifest and archive overhead when choosing those limits; the sum of allowed member sizes does not guarantee that the complete package fits.

Filenames are portable ASCII basenames: letters, digits, periods, underscores and hyphens, beginning with a letter or digit. They cannot contain directories, end with a period, duplicate another filename ignoring case, use a reserved Windows device name, or use the reserved manifest name `job-result.json`. A slot identifies a file in the application API; it is never interpreted as an output path.

The customer sees the declared filenames, types, limits and required files in Request. Merchant configuration stays with the merchant. Changing the contract changes the original configuration and catalog identity; a saved request must retain or refresh its own original selection before preparing a new ticket.

## Return the complete file contents

The handler returns one plain object whose keys are the declared slots. A value is UTF-8 text or a `Uint8Array`, including a Node Buffer:

~~~js
export async function analyze(input, context) {
  context.signal.throwIfAborted();
  const report = await performAnalysis(input, context);
  return {
    report: JSON.stringify(report, null, 2) + '\n',
    totals: createTotalsCsv(report),
    exceptions: createSelectedExceptionsCsv(report)
  };
}
~~~

The supplied [example-application.mjs](./example-application.mjs) is a complete implementation. It calls the original streamed invoice reconciliation application and returns:

| File | Contents |
| --- | --- |
| invoice-reconciliation.json | Complete report, source-file descriptors, totals, discrepancy counts and the selected exception detail |
| currency-totals.csv | Every currency total, including priced and unpriced line counts and exact minor-unit amounts |
| selected-exceptions.csv | The exception rows selected by the original `maxExceptions` input |

Amounts remain decimal strings in their original currency's minor units. No exchange rate or floating-point conversion is introduced. The exception CSV intentionally follows the requested detail limit. The JSON report's `exceptionCount` and `omittedExceptions` show the total discrepancy count and how much detail was omitted; totals include every valid source row.

Keep the example in the received source layout with its sibling `inputs/example-application.mjs`, or retain that original dependency and update the import in your own merchant application before selecting its configuration. [example-merchant.json](./example-merchant.json) supplies the full two-input, three-output function. Set its original HTTPS origin and payment asset, recipient, network and price to the merchant's actual configuration. Its unverified demonstration payment values are visible configuration fields.

Use the original ledger, price book and JSON input from the [input-file application](../inputs/README.md). Its complete Request and CLI instructions cover uploading both files, resuming interrupted chunks and approving the original checkout.

For example, after selecting the merchant configuration:

~~~sh
starforge jobs serve \
  --config /srv/starforge/reconciliation/example-merchant.json \
  --state /srv/starforge/reconciliation/merchant-state \
  --native-factory /srv/starforge/native-runtime.mjs \
  --start-worker
~~~

Prepare the request through the installed customer Request application, review its original ticket and complete the existing operator approval. The worker validates every returned slot and required file before publishing any completed result. An undeclared slot, missing required file, unsupported value or exceeded limit fails that original attempt. It does not publish a partially completed package.

## Receive and use the files in the browser

After the original job completes, select **Retrieve result** in Jobs. The customer downloads the original complete result, verifies its digest and receives all declared files into its private state. Select **Show output files** to view the received files.

Each file has its own Preview, Download and Open in library actions. Filenames, file types and sizes are primary. Expand **Technical details** to inspect the complete file hash, output slot, media type and parent package hash. Preview uses the existing Library renderer; unsupported preview types still have verified downloads.

Open a file in Resource library to add notes, tags or a star, or include it in a collection alongside the complete ZIP and other resources. A collection export preserves the original package and member relationship. Receiving that collection independently keeps the original job, acceptance and settlement metadata.

The merchant workspace exposes the same declared files under a completed job. **Show output files** verifies the package against the original completed attempt before offering a file download. The complete original result is still available above it. Configured output files appear as ordinary rows; the full compiled contract is available under Technical contract details.

The customer host drains its current receiving task on close or cancellation. An interrupted receive retains the original archive and verified file selection. Reopen the same customer workspace and retrieve the result again to finish receiving its missing files. This continues delivery of the accepted job.

## Use the installed commands

A standalone command owns the same original directory lease as its foreground service. Close the relevant browser service normally before running commands against that directory.

Inspect the merchant's package, or save one declared file to a new path:

~~~sh
starforge jobs outputs \
  --config /srv/starforge/reconciliation/example-merchant.json \
  --state /srv/starforge/reconciliation/merchant-state \
  --id invoices:2026.10

starforge jobs output-file \
  --config /srv/starforge/reconciliation/example-merchant.json \
  --state /srv/starforge/reconciliation/merchant-state \
  --id invoices:2026.10 --slot totals \
  --out /srv/starforge/delivered/currency-totals.csv
~~~

The member command publishes a new file only. It refuses to overwrite an existing destination. Its printed receipt contains the selected job, slot, bytes and original digest.

The customer workspace can receive or inspect all files through its accepted job entry:

~~~sh
starforge job-workspace fetch \
  --state /srv/starforge/customer-jobs --entry "$JOB_ENTRY_ID"

starforge job-workspace outputs \
  --state /srv/starforge/customer-jobs --entry "$JOB_ENTRY_ID"
~~~

The second command reopens the verified package and returns the member resource IDs, file paths and current Library verification status. It does not purchase another job.

A direct buyer can receive a portable private directory from its existing accepted result:

~~~sh
starforge jobs-buyer outputs \
  --state /srv/starforge/buyer

starforge jobs-buyer receive-outputs \
  --state /srv/starforge/buyer --out /srv/starforge/received-files

starforge jobs-buyer reopen-outputs \
  --state /srv/starforge/buyer --out /srv/starforge/received-files
~~~

Use `receive-outputs` after the original buyer result has been downloaded. Repeat it with the same destination to resume; `reopen-outputs` validates the complete received directory against that original buyer. Preserve the entire directory when moving it. A receiver can also reopen it independently with the public output API.

## Receive through the original merchant MCP export

The existing paid-job export still includes one authoritative `result.bin`. For a package result, its original job metadata supplies the ZIP filename and media type. Download and reopen continue to verify all original job, input, case, customer-receipt and accounting documents before validating the output package.

After downloading that complete export, receive its named outputs into a separate private directory:

~~~sh
merchant-paid-jobs outputs \
  --dir /srv/starforge/received-case \
  --out /srv/starforge/received-files \
  --manifest-sha256 "$JOB_EXPORT_MANIFEST_SHA256"

merchant-paid-jobs reopen \
  --dir /srv/starforge/received-case \
  --manifest-sha256 "$JOB_EXPORT_MANIFEST_SHA256"
~~~

These operations use the saved files offline. The output and original export directories must be distinct and cannot contain each other, including through an existing path alias. Repeat `outputs` to verify and reuse completed members. The same interface is available as `merchant-mcp jobs outputs`.

The [complete MCP receiving guide](../../../../../stellar-forge/mcp-merchant-operator/PAID_JOBS_RECEIVING.md) covers the original endpoint, configured workspace alias, retained export ID and whole-export download recovery.

## Portable receiving and validation

The received directory contains the exact package, its canonical manifest, complete named files, and the original receive intent and completion receipt:

| Path | Purpose |
| --- | --- |
| package.zip | Exact immutable original job result |
| job-result.json | Original job, completed attempt, settlement, output policy and member inventory |
| files/ | Complete verified named output files |
| receive-intent.json | Frozen package and selection identity used for continuation |
| received.json | Completion receipt written after every member verifies |
| staging/ | Only this receiving operation's incomplete bytes |

Preserve those files together. The receiver uses the original private-directory lease. It verifies existing complete members and finishes only matching partial work. It refuses a different package, unexpected files, a changed complete member, or another receive intent. It checks both whole-package and per-file byte counts and SHA-256 hashes, bounded ZIP contents, the canonical manifest and the exact original ZIP writer representation.

The archive API reuses the maintained laboratory ZIP reader and writer. ZIP inspection is bounded by the 64 MiB complete-result limit and uses in-memory buffers; it is not a streaming ZIP parser. Local file writes and the existing whole-export transport use bounded chunks. Size the worker and customer process for the selected package limit, input processing and these bounded buffers.

The installed typed entry is `@tokenjunkielabs/starforge-merchant/seller/jobs/outputs`:

~~~js
import { receiveResultPackage, reopenResultPackage } from
  '@tokenjunkielabs/starforge-merchant/seller/jobs/outputs';

const received = await receiveResultPackage({
  source: originalResultPath,
  directory: privateReceivingDirectory,
  expected: originalResultMetadata,
  job: originalCompletedJobIdentity,
  signal
});
const reopened = await reopenResultPackage({
  directory: received.directory,
  expected: originalResultMetadata,
  job: originalCompletedJobIdentity
});
~~~

`expected` is the retained original `{bytes, sha256, contentType, filename}`. `job` binds the job ID, function, canonical input digest, configuration and application digests, HTTPS origin, completed attempt and native settlement. A fully independent local reopen can omit those external expectations and still checks its own frozen receive intent and package; supplying the original expected identity additionally confirms which purchased result was selected.

## Run the complete named-output operating journey

The maintained checkout launcher has a distinct `--output-files` mode. It consumes the original completed merchant fixture and uses a separate child directory and job reference. Run it through the existing native controller with the selected installed runtime:

~~~sh
python stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/checkout/native-continuation.py \
  --retained /absolute/original/completed-merchant-fixture \
  --node /absolute/installed/node \
  --approval browser --output-files \
  --browser-module /absolute/installed/playwright/index.mjs \
  --browser-executable /absolute/installed/chromium \
  --out /absolute/existing/results/output-files-result.json
~~~

The browser module and executable must be actual installed paths and must be selected together. Omit both to run the complete native HTTP, CLI and receiving journey without claiming a rendered browser review. With them present, the existing live customer and merchant are reviewed at 1440px and 390px: eighteen screen captures and four actual member downloads retain their paths, byte sizes and hashes. The browser closes before the original hosts drain.

The distinct operation is `SCF-JOB-RESULT-PACKAGES-0B8D-20261012`; its original job is `output-files:2026.10`, under `checkout-output-files-continuation`. The earlier completed core and its other checkout/input operations remain at their retained identities.

The full run:

1. Receives the original 6,000-row ledger and supplier price book through the maintained file workflow, including customer restart, one retained successful chunk response and merchant restart.
2. Reviews and approves one original native checkout, then runs the original worker.
3. Verifies the JSON report and two CSV files through merchant and customer HTTP downloads and previews.
4. Annotates the report, exports a collection containing the complete package and all three files, receives it independently, then reopens the same customer.
5. Drains the original hosts and continues that paid job through its original resolution, accounting and merchant MCP export.
6. Receives and reopens the named files through the merchant, direct buyer and MCP command interfaces. It moves the portable receiving directory and confirms the original job and settlement outbox are unchanged.

The example report contains 6,000 rows and 4,000 discrepancies, with 20 selected details and 3,980 explicitly omitted. This is the supplied operating application with local protocol settlement and verified local TLS/CONNECT transport. Its result records those boundaries; it is not a live Stellar transfer.

The maintained cloud runner accepts the same `--output-files`, optional browser paths and existing `--applications` flags. For this mode it selects the actual `tjlabs-stellar-merchant-workspace` repository; `--source-repository` can explicitly select that repository or the legacy `public-commons-sprint-2026` source. The selected URL is frozen in the run record alongside its exact commit, and an existing checkout must have that same origin. Existing modes retain their legacy default. Select `--input-mode completed-core`, the exact completed-core capsule and SHA, the full source commit and a distinct native validation operation. It adopts the earlier completed core, installs the original selected dependency profile, runs the customer and named-output continuation, optionally receives the built installed Applications product twice, and captures complete original state and phase outputs. The original runtime and capacity controller own admission and recovery. When the original capsule's historical path is unavailable, select `--retained-directory` inside the same private native project, outside its source, runtimes and outputs. The destination keeps the original fixture basename. The original verified capsule receiver and merchant source-binding adapter preserve historical configuration, paid jobs and settlement bytes while recording the actual executable location; the returned capsule retains both the original core identity and this physical binding.

For this bounded 8 MiB example, request 1 GiB plus the existing 256 MiB reserve for the native workflow without a rendered browser. When selecting an actual Chromium review, request 1.5 GiB plus the same reserve for the complete process group. These are capacity requests, not measured peaks. Include actual installed dependencies, browser storage and output placement in the existing native declaration. Retain the whole operation and its output-save boundary in the same live caller when using temporary storage.
