# WQX scientific application jobs

Run the complete original water-quality review as a managed merchant function. The customer supplies a native WQX review bundle or a complete Open Waters bundle through the existing Request application. The original job worker recomputes the selected scientific review and returns one ZIP containing the original inputs, both decisions, every native scientific export and the complete receiving bundles.

The function is exported as **waterQualityReview** from application.mjs. It uses the existing jobs input-file store, canonical input, worker, checkout and result delivery. The scientific methods and receiving operations are the existing water-quality project functions.

## Input contract

| Input | Exact meaning |
| --- | --- |
| source file | Required application/json. A complete starforge.wqx-review-bundle.v1 or starforge.wqx-open-waters-bundle.v1 document. Up to 64 MiB. |
| choices file | Optional application/json. A starforge.wqx-job-choices.v1 document bound to the actual source review SHA-256. Up to 2 MiB. |
| reviewId | Required new immutable review name: 1–96 letters, digits, hyphens or underscores, starting with a letter or digit. |
| planId | Optional new Open Waters plan name with the same syntax. When a receiving plan is selected, omission derives a stable plan name from the original job and review identity. |
| expectedCaptureSha256 | Optional exact source-capture SHA-256; the source receiver must return this identity. |
| expectedReviewSha256 | Optional exact original review SHA-256; the source receiver must return this identity. |

The original source file remains byte-for-byte intact in the result. Its SHA-256, byte count, declared filename, media type and policy hash are the original descriptors supplied by context.files.

The combined input-file limit is 66 MiB. Ordinary JSON input remains below the existing 256 KiB configured input limit. The worker output is application/zip with a 64 MiB compressed limit. The archive writer enforces a 512 MiB expanded total, at most 128 safe relative members and bounded compression streams.

### Select the original source

In the Water quality workspace, save the complete intended review and use its complete-review export. To include existing native receiving choices, export the selected Open Waters plan's **Complete bundle** instead.

The ordinary JSON review export contains the analysis alone. Choose the complete bundle so the job receives the original capture, source requests and required project revisions as well.

The application opens the source with receiveReviewBundle or receiveOpenWaters. Those maintained receivers validate the bundle identities and native members. The Open Waters receiver also reproduces the original plan from its actual source and saved choices before the application derives another review.

## Scientific and receiving choices

When choices is omitted, the application preserves the original requested analysis options, note, comparison capture and Open Waters options. The new review has its selected new name. Its source identities and original decision remain separately available.

A choices document has this shape:

~~~json
{
  "schema": "starforge.wqx-job-choices.v1",
  "sourceReviewSha256": "THE_ACTUAL_ORIGINAL_REVIEW_SHA256",
  "analysisOptions": {
    "window": { "start": "2025-03-01", "end": "2025-03-31" },
    "baselineWindow": { "start": "2025-01-01", "end": "2025-01-31" },
    "includeEstimated": false,
    "characteristics": [],
    "siteIds": [],
    "allowedQualifiers": []
  },
  "note": "The complete analyst decision."
}
~~~

The sourceReviewSha256 is required whenever this file is supplied. The actual original review identity is visible in the water workspace, its saved review and the complete source bundle. An optional sourcePlanSha256 binds the choices to the incoming Open Waters plan as well.

Each supplied choice replaces that complete native option or note. An omitted field inherits the original value. The exact choices bytes remain in original/choices.json; original/decision.json records the original scientific options, note and receiving choices.

The supported scientific fields are the original window, baselineWindow, includeEstimated, characteristics, siteIds and allowedQualifiers. Windows use local sample dates and retain the original times and time zones. A supplied options object passes the native normalizer, and unknown option or date-window fields are rejected.

Add openWatersOptions to supply the original Open Waters option object: organizationId, projectId, locationMode, identityMode, locationOverrides, activityOverrides, resultOverrides, fieldTranslations, limitMappings, referenceValues and notes. See [the native receiving guide](../OPEN_WATERS.md) for their complete meaning. The existing normalizer and plan builder govern the exact fields, methods, limits, aliases and receiving choices.

A plain review source produces the scientific outputs. Adding explicit openWatersOptions also produces all six receiving outputs. An Open Waters source carries its existing receiving choices into the new plan unless that complete option object is explicitly replaced.

## Result files

| Result path | Contents |
| --- | --- |
| original/source-bundle.json | Exact sealed source bytes. |
| original/choices.json | Exact supplied choices bytes, when selected. |
| original/decision.json | Original review and capture IDs, requested and normalized options, note and original receiving choices. |
| review/review.json | Complete resulting native saved review, with its scientific analysis and comparison. |
| review/report.html | The existing offline scientific report. |
| review/observations.csv | Native result projection, original result/activity/station records, all limits and source pointers. |
| review/observations.geojson | Native scientific GeoJSON with its original coordinate interpretation. |
| review/complete-review.json | Complete native review bundle for an empty water project. |
| open-waters/locations.tsv | Native monitoring-location import aliases and applicable rows. |
| open-waters/results.tsv | Native sample/result import aliases and applicable rows. |
| open-waters/crosswalk.json | Complete resulting plan, every selected original result, limits and receiving choice. |
| open-waters/receiving.html | Complete offline native receiving instructions and remaining choices. |
| open-waters/references.csv | Native reference and method requirements with exact values and contexts. |
| open-waters/complete-open-waters.json | Complete native plan, companion outputs, review, capture and source revisions. |
| manifest.json | Original file descriptors, job identity, original and resulting decisions, scientific inventory and member hashes. |
| README.md | Operator instructions for the delivered files and native receiving commands. |

The Open Waters folder appears when a receiving plan is selected. Native TSV exports contain rows meeting that importer's current field requirements. All selected rows and every original value remain in the crosswalk and complete source graph, together with the fields requiring a receiving choice.

The ZIP uses standard DEFLATE entries with fixed metadata and CRC-32, plus SHA-256 in the manifest. Compression and source copying are streamed. Native scientific exports are produced one at a time. The original job ID and selected review/plan IDs determine result identity; attempt-specific times are omitted so the same worker input reproduces the same output bytes on the same installed source.

## Run the merchant function

Keep application.mjs and archive.mjs under the installed complete water-quality source. Their relative imports use that maintained scientific implementation. Copy merchant.example.json to a merchant-owned configuration directory and set its application path to the actual installed application.mjs.

Set publicOrigin and the original payment fields to the merchant's actual HTTPS origin, network, asset, recipient, price and facilitator setup. The template payment values are explicit deployment placeholders. Its inputFiles declarations are executable constraints applied by the existing compiler and native input receiver.

Select a private scratch directory for the configured worker environment:

~~~sh
export WQX_JOB_TEMP_ROOT=/srv/starforge/water-analysis/scratch

starforge jobs serve \
  --config /srv/starforge/water-analysis/merchant.json \
  --state /srv/starforge/water-analysis/merchant-state \
  --native-factory /srv/starforge/native-runtime.mjs \
  --start-worker
~~~

The example config requests one worker, a 768 MiB worker heap and a ten-minute execution timeout. Select host capacity for the entire merchant, original worker and result delivery using the installed runtime's existing capacity controls. The 768 MiB value is a configured upper bound; native receiving records the actual selected environment and completion.

Each worker owns one temporary directory below WQX_JOB_TEMP_ROOT, named with a hash of the original job ID. The normal completion and error paths close the native project and archive and remove that owned scratch directory. The merchant's original sealed input store and retained job/result state keep their existing lifetime. After a forcibly terminated worker, the application owner can identify its inactive scratch directory from that job-hash prefix while retaining the sealed originals.

The function reads only the selected sealed files. Every source acquisition required for the scientific run is already in the complete native bundle.

## Customer Request and receiving

Open the existing managed Applications catalog or the installed customer Request landing. Load the merchant's actual HTTPS origin and choose waterQualityReview.

1. Enter the new review name and the expected source identities when known.
2. Save the request and select the complete source file in source.
3. Optionally select the bound decision document in choices.
4. Prepare the existing checkout after the original file receiver finishes.
5. Review and execute through the configured original operator.
6. Follow the job, receive its ZIP into the existing Resource library, and open the downloaded report.

The [shared input-file guide](../../jobs/inputs/README.md) contains the original browser, CLI, chunk-resume, library-selection and checkout commands. This application uses those same controls.

Extract the received ZIP with a standard archive tool. Open review/report.html. To continue the native review in another private project:

~~~sh
starforge water-quality receive \
  --project /private/received-water \
  --bundle /absolute/unpacked/review/complete-review.json

starforge water-quality serve \
  --project /private/received-water --port 0
~~~

For the complete selected receiving plan:

~~~sh
starforge water-quality water-receive \
  --project /private/received-open-waters \
  --bundle /absolute/unpacked/open-waters/complete-open-waters.json
~~~

The existing managed application can open that same independent received project. The original project receiver verifies source identities and reproduces the saved receiving exports.

## Retained real Potomac example

The supplied input.example.json and choices.example.json use the actual complete January–March 2025 capture at USGS-01646580, acquired October 11, 2026.

- Capture: cbb29504ab01598cddb21bde33c918ca92075aad7f53fdac4fb07581371d29d7.
- Original complete review: potomac-quarter-open-waters, SHA-256 ba122f919127c23f701dcbf9cb88314fee46cdace3fd881b971a23b959489631.
- Original receiving plan: potomac-quarter-open-waters-01, SHA-256 4f9b1f612d1f9cb5bf3c90720d67cc37b5bd8fcd0c51476e669a340cde514610.
- Original complete Open Waters file: 31,495,178 bytes, SHA-256 2b6ff2ca633860d8a83320a4c6dc072f54350dadf12449fd126cd353f9db618b.

The source contains 1,035 results, 13 activities, one station and 1,112 retained detection-limit records. The decision example uses the existing March-versus-January analysis options. The complete source remains available through the original [Open Waters receiving operation](../OPEN_WATERS.md).

Scientific behavior remains defined by the [analysis contract](../ANALYSIS.md): exact decimal summaries, distinct methods and units, original limits and censoring, explicit qualifier/estimate choices, and original coordinate datums.
