# Paid paired scientific editions

The existing **waterQualityReview** paid function accepts a complete saved reporting-unit scientific edition with `mode: "scientific"`. The service receives the sealed bundle through the original file-input store, independently recomputes its current and selected previous source editions, and delivers the seven complete native exports in one portable ZIP.

Select reporting windows, concentration conversions, independently reported limits, qualification policy and the earlier scientific edition in the Water Quality workspace before checkout. The sealed scientific bundle is the complete reviewed selection for this job. The original review/Open Waters mode remains available in the same function.

## Prepare the selected study

Use **Scientific editions** in the Water Quality workspace, the existing `starforge water-quality scientific` commands, or the 39-tool managed WQX operator. Save the exact reviewed edition and download its complete scientific bundle.

The bundle contains the current native source and decision graph, the complete earlier scientific review preimage, and the earlier source graph when an edition comparison was selected. Original measurements and reporting-unit representations remain separate. Both analyses are recomputed by the service before it produces the result.

A source scientific edition keeps its original name and hash in this mode. To change its reporting window or unit/limit choices, save a new edition in the existing workspace and select that complete new bundle.

## Exact request

Use this request with the original `source` file slot:

```json
{
  "mode": "scientific",
  "reviewId": "THE_SAVED_SCIENTIFIC_REVIEW_ID",
  "expectedScientificReviewSha256": "THE_SAVED_SCIENTIFIC_REVIEW_SHA256",
  "expectedCaptureSha256": "THE_ORIGINAL_CAPTURE_SHA256",
  "expectedReviewSha256": "THE_ORIGINAL_SOURCE_REVIEW_SHA256"
}
```

| Field | Meaning |
| --- | --- |
| `mode` | `scientific` selects the complete paired-edition path. Omission or `review` uses the original review/Open Waters job. |
| `reviewId` | The exact scientific review name already in the selected bundle. |
| `expectedScientificReviewSha256` | Required exact scientific review hash, including its complete request, analysis and prior-review reference. |
| `expectedCaptureSha256` | Optional exact original capture identity. |
| `expectedReviewSha256` | Optional exact underlying source-review identity; this is separate from the scientific review hash. |
| `source` file | Required `application/json` complete `starforge.wqx-standardized-bundle.v1`, at most 128 MiB. |

The scientific mode uses the saved choices inside this source. It rejects the separate legacy `choices` slot and `planId`. The original mode continues to accept a review/Open Waters source up to 64 MiB and its optional 2 MiB replacement choices.

The shared function declares a 130 MiB combined input-file ceiling so both modes fit the existing file policy. The job JSON limit remains 256 KiB. The standard result ZIP remains bounded to 64 MiB compressed and 512 MiB expanded, with the same streamed compression and safe-member rules.

## Original checkout and delivery

Copy the installed `jobs/merchant.example.json` into the merchant-owned configuration and select its actual application path, HTTPS origin, payment network, asset, recipient, amount and facilitator. Its demo payment values remain deployment placeholders.

Start the existing merchant and worker through the installed jobs command:

```sh
export WQX_JOB_TEMP_ROOT=/srv/starforge/water-analysis/scratch

starforge jobs serve \
  --config /srv/starforge/water-analysis/merchant.json \
  --state /srv/starforge/water-analysis/merchant-state \
  --native-factory /srv/starforge/native-runtime.mjs \
  --start-worker
```

The same function ID and route are **waterQualityReview** and **/water-quality-review**. This extension changes the supported source mode; payment submission, request ownership, sealed input, checkout, worker state, result transfer and original SF88 recovery remain the existing job operations.

In the original **Request** application, load the merchant's HTTPS origin, choose waterQualityReview, enter the scientific-mode request, and select the complete bundle in `source`. Prepare checkout after the original file receiver has sealed the input. Review the configured offer and execute through the existing buyer. Follow that same job to its delivered ZIP in the Resource library.

The [shared input-file guide](../../jobs/inputs/README.md) provides the supported browser, CLI, local-file, chunk-resume and retained-result operations. Paid-job source uploads use the existing 262,144-byte file-input chunks. The private WQX managed workspace has its own 65,536-byte transfer chunks; each interface retains its original protocol.

## Complete delivered files

| Path | Content |
| --- | --- |
| `original/source-bundle.json` | Every byte of the sealed scientific input, with its actual SHA-256 and declared file metadata. |
| `original/scientific-selection.json` | Current and selected earlier review/decision identities and exact saved scientific requests. |
| `scientific/scientific-review.json` | Complete current scientific review, original/reporting analyses and selected prior review. |
| `scientific/paired-observations.csv` | Full paired values, units, reported limits, source pointers, qualification and arithmetic inclusion. |
| `scientific/paired-observations.tsv` | The same complete table as TSV. |
| `scientific/paired-groups.csv` | Exact original and reporting scientific group summaries. |
| `scientific/edition-changes.csv` | Source, decision and reporting-representation differences between the selected editions. |
| `scientific/report.html` | Complete scientific report. |
| `scientific/complete-scientific-review.json` | Native portable review with both selected source graphs. |
| `manifest.json` | Original job, source descriptors, scientific identities, selection, inventories and exact member/output hashes. |
| `README.md` | Standalone instructions inside the delivered archive. |

The result manifest uses `starforge.wqx-paired-scientific-job-result.v1`. Existing review/Open Waters results keep `starforge.wqx-scientific-job-result.v1`. The original ZIP verifier accepts both declared families and checks every member's byte count and SHA-256 before extracting a selected native bundle.

The current and previous source data remain distinct throughout receiving. Each complete native graph is verified, and both scientific analyses are independently reproduced. The job retains blank measured value/unit pairs, every separately reported limit, qualifications, estimated observations, optical units, explicit Keep reasons and exact original/reporting unit relationships.

## Receive in an independent workspace

Extract the delivered ZIP with a standard archive tool. Open the scientific report. To receive the complete study:

```sh
starforge water-quality scientific receive \
  --project /private/received-scientific-water \
  --bundle /absolute/unpacked/scientific/complete-scientific-review.json \
  --out /private/scientific-receiving-response.json

starforge water-quality scientific read \
  --project /private/received-scientific-water \
  --review THE_ORIGINAL_SAVED_SCIENTIFIC_REVIEW_ID
```

The browser's **Scientific editions → Receive** form uses this same receiver. Reopening that saved review retains the exact original operation. A changed source or selected review hash is rejected before the delivered edition can be accepted.

## Source-native receiving

The maintained `receive-scientific.mjs` driver consumes one already-prepared complete scientific bundle. It uses the original input-file store, policy, canonical input, terminable worker and ZIP verifier, then receives the actual result in a separate native project.

```sh
node --expose-gc --max-old-space-size=768 \
  stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/jobs/receive-scientific.mjs \
  --source /absolute/complete-scientific-review.json \
  --expected-source-sha256 EXACT_COMPLETE_FILE_SHA256 \
  --directory /private/paired-scientific-job-receiving \
  --scratch /private/paired-scientific-job-scratch \
  --python /absolute/python3
```

Keep the same paths, complete input bytes, configuration and receiving directory on continuation. The retained source/config identities are checked before staging. Sealed uploads resume their original chunks; the worker's same-job replay must produce identical ZIP bytes. The independent buyer project must reproduce all seven exports, close, reopen and reproduce them again. A complete receiving checkpoint reopens its retained result without another worker execution.

This local native driver executes the original job function and delivery interfaces. It makes no new source acquisition or payment submission. The merchant's actual checkout and any existing accepted paid-job operation retain their own original identities and execution receipts.

Use the existing host's capacity admission for the whole source/native operation. The full paired source, sealed input, extracted bundle and independent receiver remain complete. Size the retained operation from the actual selected source and member graph, and preserve its admitted resource selection when resuming.

The current complete 1,035-result Potomac study retains 1,112 original limits, 749 reviewed concentration records, 452 blank measurement/unit pairs (451 with supported converted limits), 1,089 converted limits and 413 default arithmetic observations. Those source-module results are already retained by the full scientific edition. This new paid-mode native receiving remains pending until its original worker produces its actual source, output and reopen receipts.
