# Paid KiWIS commissioning and complete customer receiving

The existing **waterQualityReview** function accepts a complete saved KiWIS commissioning review with `mode: "commissioning"`. The service receives the exact sealed source, reconstructs the original KiWIS and counterpart inputs through their native receivers, reproduces the saved review and returns all eight native commissioning exports.

This is the same merchant function, route, input store, checkout, worker, job history and result transport used by the existing WQX review and paired scientific modes. The saved commissioning review supplies the station, parameter, timestamp, window, quality and correspondence choices. The job preserves those choices and their reasons.

## Select the complete original review

In **Water Quality → KiWIS commissioning**, select the intended source and saved review, then download its complete bundle. The source file must be a complete `starforge.kiwis-commissioning-bundle.v1` document, including its original capture, complete counterpart and immutable saved review.

The counterpart can be an original WQX review, saved reporting-unit scientific edition, complete Laboratory EDD result or original KiWIS water-quality response. Each uses its existing native decoder and receiving contract. A table of selected rows or a review-only JSON file does not contain the complete receiving source.

Use the supplied source-selection command to derive the actual request. It reads the entire file and checks the bundle, saved review, source and decision hashes:

~~~sh
starforge water-quality-commissioning-job source \
  --source /absolute/selected-complete-commissioning.json \
  --expected-source-sha256 ACTUAL_COMPLETE_FILE_SHA256 \
  --out /private/commissioning-request.json
~~~

The same source command is available before installation:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/jobs/commissioning-cli.mjs \
  source --source /absolute/selected-complete-commissioning.json \
  --expected-source-sha256 ACTUAL_COMPLETE_FILE_SHA256 \
  --out /private/commissioning-request.json
~~~

The resulting file contains the following four actual fields. The command fills them from the selected source; a local source pathname is not part of the job's ordinary JSON.

| Field | Exact meaning |
| --- | --- |
| `mode` | `commissioning` selects this existing-function path. |
| `reviewId` | The immutable review name already saved in the selected bundle. |
| `expectedCommissioningSavedSha256` | Exact hash of the complete saved record, including its name, source ID, title and review. |
| `expectedCommissioningReviewSha256` | Exact hash of the complete native review, original source pair, normalized decisions and every record disposition. |
| `source` file slot | Complete `application/json` commissioning bundle, at most 128 MiB. The original input controller supplies its full descriptor in `$files.source`. |

A changed source, mapping, timestamp interpretation, quality decision or correspondence belongs in a new saved review. Select that complete new bundle when another job is intended. Reusing the same source and request retains the same original reviewed work.

Commissioning mode rejects the separate `choices` slot, legacy `planId` and expected WQX/scientific hashes. Its full decision document is already inside the source. Review/Open Waters mode and paired scientific mode retain their original inputs and identities.

## Merchant setup and original checkout

Use the complete installed Water Quality source with `jobs/merchant.example.json`. Set the application's actual installed path and the original merchant's HTTPS origin, Stellar network, asset, recipient, price and facilitator configuration. The template retains its explicit deployment values; commissioning adds no new payment scheme.

The existing declared function is `waterQualityReview` at `/water-quality-review`. Its ordinary JSON limit is 256 KiB. The shared file policy has a 128 MiB source slot, optional 2 MiB legacy choices slot and 130 MiB total ceiling. Commissioning uses only its source slot. The result remains a 64 MiB ZIP with a 512 MiB expanded ceiling, at most 128 safe members and a 256 MiB member ceiling.

The original worker's convenience `files.read` accepts at most 64 MiB. Larger declared scientific and commissioning inputs use its existing held-file `files.stream`, retaining the original 262,144-byte chunks and source-identity checks. The application uses that stream both for preserving the exact original source and for bounded complete JSON intake.

Set `WQX_JOB_TEMP_ROOT` to the merchant's private job scratch directory. The example keeps one original worker, a 768 MiB worker heap and a ten-minute execution timeout. The host's existing capacity controls must cover the merchant, worker, complete inputs and outputs together.

Continue the original customer workflow:

1. Open the installed Request application or existing managed paid-job workspace and select the original merchant and `waterQualityReview`.
2. Enter the generated commissioning request and save it under the existing request reference.
3. Select the complete source file in the original `source` slot. Resume its original upload if interrupted.
4. Prepare checkout after the original upload reaches `SEALED`. Review and execute through the existing operator approval and payment flow.
5. Follow that job's original worker and result. The existing worker Stop drains its owned execution; job cancellation/retry uses the original current revision and state rules.
6. Receive the complete result ZIP into the existing Resource library or download the complete immutable paid-job export through the maintained caller below.

The original [input-file guide](../../jobs/inputs/README.md) documents file selection, retained references, chunk resume and checkout. Existing job preparation and payment approval are unchanged.

### Existing MCP operation

The existing merchant MCP tools already accept the exact function and its ordinary JSON. `merchant_jobs_prepare` keeps the original request UUID, uploaded-file reference and claim. `merchant_jobs_job` reads the job and current revision; `merchant_jobs_worker` starts or stops the original worker.

Once the original job is complete, `merchant_jobs_export` retains the complete result, exact input file, native job record, buyer receipt and applicable case/accounting records. Supply its current job and case revisions and keep that export's original request UUID. `merchant_jobs_manifest` supplies the export ID and manifest SHA-256 for the customer caller. No commissioning-specific payment or upload provider is added.

## Complete ZIP delivery

| Path | Complete content |
| --- | --- |
| `original/source-bundle.json` | Every exact sealed input byte, including full raw response bodies, receipts and native counterpart. |
| `original/commissioning-selection.json` | Original saved name, both review hashes, complete input/source identities and the entire saved decision document. |
| `commissioning/complete-commissioning.json` | Complete native portable commissioning bundle. |
| `commissioning/commissioning-review.json` | Entire immutable saved review and every physical source record disposition. |
| `commissioning/decisions.json` | Full editable source-bound mapping, time, quality and correspondence choices with reasons. |
| `commissioning/observations.csv` | Every original KiWIS observation and its retained fields, types and source pointers. |
| `commissioning/counterparts.csv` | Every complete counterpart record with its independent original context and identity. |
| `commissioning/correspondences.csv` | All chosen, unresolved, ambiguous, separate and review-required relationships. |
| `commissioning/series.csv` | Complete selected series, metadata, request coverage and quality interpretation. |
| `commissioning/report.html` | Full human-readable review, choices, counts and source bindings. |
| `manifest.json` | Original job/function/request, full source descriptor, saved selection and exact hashes of every member and native export. |
| `README.md` | Instructions retained inside the result. |

The manifest schema is `starforge.wqx-commissioning-job-result.v1`. The independent original ZIP verifier validates every CRC, size, SHA-256 and the entire member set before exposing selected output files.

A native request timestamp and a laboratory sample timestamp remain separate fields. Numeric JSON values, literal strings, nulls, original units, limits, qualifiers and repeated physical records retain their source meanings. The application does not select a new timezone, convert units or resolve an ambiguous match implicitly. Unresolved records remain complete delivered review work with their actual status and candidates.

## Receive the downloaded result

The commissioning customer receiver validates the whole ZIP against its exact hash, checks the complete original source/request and saved choice document, then receives the portable bundle into an independent project. It recomputes and byte-compares all eight native exports, closes that project, reopens it and compares all eight again.

~~~sh
starforge water-quality-commissioning-job receive \
  --archive /absolute/water-quality-commissioning-review.zip \
  --expected-archive-sha256 ACTUAL_COMPLETE_RESULT_SHA256 \
  --job-id ORIGINAL_JOB_ID \
  --directory /private/commissioning-customer \
  --python /absolute/python3 \
  --out /private/commissioning-customer-receipt.json
~~~

The directory retains the complete original source and all eight outputs under `files/`, the independent `received-project`, exact binding, independent ZIP verification and complete receiving result. Repeating the same command reopens those original files and project. An existing result bound to another source, job or ZIP is rejected; complete output files are never overwritten with different bytes.

To continue work in the ordinary Water Quality application, open that `received-project` through the existing managed application. The native browser **Receive** form also accepts `files/commissioning/complete-commissioning.json`. The original native CLI is available directly:

~~~sh
starforge water-quality kiwis receive \
  --project /private/another-commissioning-project \
  --bundle /private/commissioning-customer/files/commissioning/complete-commissioning.json \
  --out /private/another-commissioning-receipt.json

starforge water-quality kiwis read \
  --project /private/another-commissioning-project \
  --review ORIGINAL_SAVED_REVIEW_ID
~~~

## Typed complete paid-job download and reopen

The application-specific caller composes the original complete paid-job downloader with the same native customer receiver. It keeps the full original job/MCP export; the result ZIP and sealed source remain separate original files inside that download.

~~~js
import {
  inspectCommissioningJobSource,
  downloadCommissioningJob,
  reopenCommissioningJob,
} from '@tokenjunkielabs/starforge-merchant/seller/water-quality/commissioning-job';

const selected = await inspectCommissioningJobSource({
  sourceFile: '/absolute/selected-complete-commissioning.json',
  expectedSourceSha256: process.env.KIWIS_COMPLETE_SOURCE_SHA256,
});
// Pass selected.input and the actual source file to the existing request/upload controls.

const received = await downloadCommissioningJob({
  url: process.env.WATER_MCP_URL,
  tokenEnv: 'WATER_MCP_TOKEN',
  workspace: 'water',
  exportId: process.env.WATER_JOB_EXPORT_ID,
  expectedManifestSha256: process.env.WATER_JOB_EXPORT_MANIFEST_SHA256,
  directory: '/private/commissioning-paid-job',
  receivingDirectory: '/private/commissioning-paid-customer',
  python: '/absolute/python3',
});

const reopened = await reopenCommissioningJob({
  directory: '/private/commissioning-paid-job',
  receivingDirectory: '/private/commissioning-paid-customer',
  workspace: 'water',
  exportId: received.transport.exportId,
  expectedManifestSha256: received.transport.manifestSha256,
  python: '/absolute/python3',
});

console.log(reopened.commissioning.receivedProject);
~~~

An existing connected typed client can be passed as `client` instead of a URL. Every original MCP file is downloaded through its retained manifest and file hashes. The wrapper then requires a completed `waterQualityReview` commissioning job, its exact sealed source and the declared complete ZIP. It checks the original job input and source descriptor against the ZIP's native saved selection before receiving.

The command-line equivalent uses the same client:

~~~sh
starforge water-quality-commissioning-job download \
  --url "$WATER_MCP_URL" --token-env WATER_MCP_TOKEN \
  --workspace water --export-id "$WATER_JOB_EXPORT_ID" \
  --expected-manifest-sha256 "$WATER_JOB_EXPORT_MANIFEST_SHA256" \
  --directory /private/commissioning-paid-job \
  --receiving-directory /private/commissioning-paid-customer \
  --python /absolute/python3

starforge water-quality-commissioning-job reopen \
  --directory /private/commissioning-paid-job \
  --receiving-directory /private/commissioning-paid-customer \
  --python /absolute/python3
~~~

MCP uses its original retained-file chunk limit of 196,608 bytes; sealed job uploads keep 262,144-byte chunks. The caller preserves both interfaces. An interrupted complete download resumes the same export; offline reopen rehashes every retained file and reuses the original independent project.

## One native worker receiving operation

The maintained `receive-commissioning.mjs` driver takes the actual complete bundle exported by the original commissioning programme. It uses the original input store, policy, canonical input, worker and native customer receiver.

~~~sh
node --expose-gc --max-old-space-size=768 \
  stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/jobs/receive-commissioning.mjs \
  --source /absolute/selected-complete-commissioning.json \
  --expected-source-sha256 ACTUAL_COMPLETE_FILE_SHA256 \
  --directory /private/commissioning-job-receiving \
  --scratch /private/commissioning-job-scratch \
  --python /absolute/python3
~~~

Use `--config` for the actual complete installed merchant definition. The driver retains one stable job reference derived from the original source hash, its upload claim and canonical input. It runs the original worker once, retains the complete ZIP atomically and replays the same job and input through the original worker. Both complete archive hashes must match. It then invokes the same customer receiver, including all eight native exports, independent receive and cold reopen.

`receiving.json` is the private continuation record. `result.json` records the complete source/config/application bindings, original job, sealed descriptor, same-job replay, full archive, all sixteen export comparisons and the independent project path. SIGINT/SIGTERM propagate into the original worker cancellation and retirement, and cleanup drains that invocation before closing its input store and lease.

Continue with the same source, configuration, directory and operation. Saved source and output identities are checked before a pending phase is resumed. A completed operation verifies the retained ZIP and reopens the original customer project without another worker execution. The existing host owner admits the entire selected operation; this source driver adds no controller or watcher.

### Actual source and execution state

The retained MCWD TP acquisition has already been accepted through the original native KiWIS importer: all 371 TP observations, every original cell/type, the complete 66-series catalogue, eight quality rows, two release rows and two station rows. Its exact retained source uses TP series 3112010, `period=complete`, an explicit provider-default datasource and the original request URLs. The full WQM response remains its original 4,713 physical rows and 96 fields; its timestamp and sample timestamp are independent.

This paid receiver is designed to consume the complete saved bundle produced by that same original commissioning source/workspace/browser programme. The accepted source-import result is retained separately from the paid worker, customer-receiving and payment states. Until that original receiving operation reports completion, no native paid result or settled checkout is implied by this guide or the source publication.
