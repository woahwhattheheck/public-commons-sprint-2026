# Coastal studies, delivery and receiving

The **Studies & receiving** page operates inside the existing Coastal Source Operations workspace. It selects already-retained NOAA editions and the actual receiving convention. It does not start a second service or change a source measurement.

A study can contain up to five stations, 64 edition windows and five calendar years. Historical-capture parts are ordinary selectable editions. Observations and predictions have separate study files. The study records ordered windows, source hashes, requested datum/time/unit basis, original station evidence and a saved mapping revision.

## Staff workflow

1. **Retain the source first.** Use the original Capture sources, Historical capture or source-package import controls. Inspect original station metadata, request outcomes and measurement coverage. An unavailable request remains unavailable.
2. **Choose receiving columns.** Open Model-input mappings and inspect the actual requested headings. Import a supplied mapping JSON through the existing file comparison, or save an explicit entered mapping. The bundled `examples/study-input-columns.json` is a public-reference convention; it is not a buyer's private model.
3. **Prepare the study.** Open Studies & receiving. Name the study, actual project or public-reference purpose, responsible team and engineering question. Select a saved mapping for the observation or prediction table.
4. **Select each original window.** Choose an edition, inclusive first/last calendar dates and its exact products. Add historical parts or other stations as separate ordered members. Move members explicitly to define file order. The full edition archive remains accessible through Load older retained editions.
5. **Preview and save.** Preview checks source membership, exact saved mapping, source-file hashes, selected request outcomes, overlap and native bases. Save uses the preview digest and the original study revision. A changed mapping or decision requires a new preview. Editing a saved study appends its preceding revision.
6. **Review the exact revision.** Open the saved study, inspect its original rows and full context, then record the actual reviewer and a reasoned note. Decisions start unselected. Every generated basis/coverage warning must be acknowledged for Reviewed. A later Follow-up decision prevents a new delivery from using the earlier reviewed decision. Existing deliveries remain unchanged.
7. **Create the delivery.** The original action streams complete CSV and JSONL, a standalone HTML report, a JSON manifest and a TAR containing all selected original source editions and response bodies. Request completion, selected row count and populated numerical value count remain separate.
8. **Retain a returned file.** Select the exact delivery and its actual returned CSV or JSONL. The native workspace retains sequential one-MiB chunks with hashes. A browser reload requires reselecting the original file; the complete already-retained prefix is checked before new chunks are accepted. The original pending action must be reconciled before another action.
9. **Compare complete bytes.** The comparison seals the returned original, processes every selected row and records changes, additions, missing rows, unchanged rows and ambiguous duplicate identities. Row reordering is allowed. The complete JSONL comparison is downloadable; the page shows bounded examples.
10. **Record receiving.** Inspect the actual comparison and record an operator, decision and note covering the changed, added or missing content. An incomplete or ambiguous comparison requires Follow-up. Acceptance records a receiving decision; it does not replace NOAA evidence or alter an earlier release.

A saved study, review, delivery, file intake and receiving decision remain in the same original workspace after normal stop/reopen. Earlier study revisions, reviews, source files, returned originals and comparison exports remain selectable.

## Source and physical meaning

The receiving mapping must retain these original columns (headings may be explicitly renamed):

| Purpose | Original fields |
| --- | --- |
| Exact original row | editionId, recordId, sourcePageSha256, sourceRecord |
| Station and product | stationId, product |
| Time basis | timestamp, timeZone |
| Vertical and quantity basis | datum, units, unit |
| Value state and flags | value, valueType, quality, flags |

Additional columns such as timestampUtc, sigma, inferred, excludedSamples, flagMeaning, sourceObservedAt and sourceUrl can be selected without transformation.

Each selected window must lie inside its original edition. Overlapping windows for the same station, native basis and product are rejected; the operator narrows windows or chooses an edition. The application does not silently discard repeated observations.

**Matching datum names at different stations do not establish a common vertical surface.** Multi-station studies always carry that review point. Uniform requests require equal requested datum/unit/time/prediction-interval settings. Explicitly separated mixed native bases remain long-form data with their original basis columns. No conversion, interpolation, global time sort, cross-station subtraction or project boundary condition is supplied.

Coverage in an edition's retained summary describes that whole edition. The study explicitly labels this scope. Its released counts cover only selected rows. Empty strings, original null/missing value types, numerical lexical precision, raw quality and flags survive the mapping.

Official definitions remain in the original source contract:
- NOAA Data API: https://api.tidesandcurrents.noaa.gov/api/prod/
- Original response and flag meanings: https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html
- Station and datum metadata: https://api.tidesandcurrents.noaa.gov/mdapi/prod/

## Complete delivery files

| File | Content |
| --- | --- |
| CSV | Exact ordered selected rows with the saved headings, all values represented as original strings |
| JSONL | The same rows and headings, one string-valued object per line |
| HTML | Self-contained study context, actual counts, native-basis warnings, review and mapping |
| Manifest JSON | Study/revision/hash, source and mapping identity, review, every source receipt and member digest |
| TAR | Manifest, reviewed study, review, mapping, original mapping input when supplied, each complete selected edition, all original accepted/failed response bodies, CSV, JSONL and HTML |

The manifest inventories every archive member except itself. Its separately retained export SHA identifies its exact bytes; the TAR export has its own complete hash. Shared response bodies appear once per SHA with all source uses recorded. Archives use plain USTAR members; there are no symlinks or executable members.

Import CSV columns as text when opening a spreadsheet to preserve identifiers and numerical precision. JSONL is the lossless string-based receiving form. Neither export evaluates spreadsheet formulas.

Every file is produced through the existing native immutable export writer and is available through the original download ticket, CLI download, or Merchant retained-file chunk tools. A completed export is reused by its original operation identity after a lost reply.

## Returned-file rules and scale

A returned file selects CSV or JSONL from one exact release. CSV headings and order must match the released mapping. JSONL must have exactly the same distinct headings and string values; object-key order may differ. A UTF-8 BOM and ordinary CSV quoted fields/CRLF are accepted. Empty, null or typed numerical JSON values are not silently coerced to original strings.

Identity is the exact mapped tuple **editionId + recordId + sourcePageSha256 + sourceRecord**. A changed value, flag, basis or other selected field is reported against that identity. Changing an identity produces an added/missing pair. Duplicate identities remain ambiguous; occurrence order is not substituted for identity.

The complete comparison is streamed through 256 temporary identity partitions under the original workspace. Each side of a partition is bounded to 16 MiB. One logical returned record is bounded to 2 MiB and each identity component to 2,048 bytes. The source/return/export file bound is 1 GiB. If a format or partition bound prevents complete comparison, the original return and an explicit unresolved comparison are retained; smaller source windows can be selected for a new study. No partial comparison is called accepted.

On a process interruption, the original finish operation owns its deterministic private partition directory. Reopening through the native writer checks that only its expected private partition files remain, clears those reproducible partitions, and resumes the exact original comparison. Unknown files or changed file ownership/type are preserved for inspection. Source and returned byte objects are not removed.

Displayed comparison examples are bounded by count and total bytes. The complete file retains every difference. Completed browser history stores compact receipts for chunks, while an uncertain pending request retains its exact original bytes until native completion is reconciled.

## Native API and operation identity

The same private bearer token, loopback origin checks, native writer lease and operation journal are used.

Read-only routes:
- `POST /api/study-preview` with the explicit study selection.
- `GET /api/study-rows?studyId=…&revision=…&offset=0&limit=100`.
- `GET /api/view` includes studies, studyReviews, studyReleases, studyUploads, studyReturns and studyReceivings.
- Existing `GET /api/operation?operationId=…` returns original disposition. For an interrupted study finish it also exposes its exact resumeRequest, allowing the staff page to resume that same native operation after browser-journal loss.

Every write is the original envelope:

```json
{
  "operationId": "an-original-retained-operation-id",
  "expectedRevision": 42,
  "action": "study.export",
  "payload": {
    "studyId": "the-actual-saved-study-id",
    "studyRevision": 2,
    "studySha256": "the-actual-previewed-study-digest",
    "reviewId": "the-actual-retained-reviewed-decision"
  }
}
```

The IDs above are explanatory placeholders, not seeded work. Read the actual current schema/view and use its saved identities.

| Action | Original selection |
| --- | --- |
| study.save | Complete fields/members, expectedStudyRevision when editing, expectedPreviewSha256 |
| study.review | Exact study ID/revision/hash, expectedReviewId, actual actor/note/status and warning IDs |
| study.export | Exact study ID/revision/hash and current reviewed decision |
| study.return.start | Immutable release, filename, format, byte count and source note |
| study.return.chunk | Upload ID, one-MiB-aligned offset and original canonical base64 bytes |
| study.return.finish | Original upload ID; it retains one original finishing operation |
| study.receive | Exact return/comparison hash, expectedDecisionId, actual actor/note/status |

Reservation pins mutable targets before asynchronous work. First materialization compares that pinned target under the original mutation. Completed-operation replay returns its original materialized result before checking any later edits. Study reviews and receiving decisions are append-only; their expected prior decision prevents a stale note from silently superseding a newer review.

## CLI and Merchant access

Keep a running staff console and use its existing private startup descriptor:

```sh
node coops/cli.mjs --session /private/coastal-startup.json study-preview --file /selected/study-selection.json
node coops/cli.mjs --session /private/coastal-startup.json action --request /selected/original-study-save.json
node coops/cli.mjs --session /private/coastal-startup.json study-rows --study-id ACTUAL_ID --study-revision 1 --offset 0 --limit 100
node coops/cli.mjs --session /private/coastal-startup.json study-return --study-release-id ACTUAL_RELEASE_ID --format csv --file /selected/returned.csv --operation-id retained-return-20261012 --note "Actual receiving source and purpose"
node coops/cli.mjs --session /private/coastal-startup.json download --export-id ACTUAL_EXPORT_ID --output /selected/new-output-file
```

Use the same return prefix and exact original file to resume. The CLI checks every retained prefix chunk and the file's open-handle size/time identity before finishing. It reuses the original finish operation. Do not open a second direct workspace writer beside a running console.

The existing Merchant contribution advertises `merchant_coops_study_preview`, `merchant_coops_study_rows`, and one corresponding tool for each study action. Complete source/archive/return/comparison files use the existing `merchant_coops_files` and `merchant_coops_file_read` contract with export IDs and verified chunk continuation.

## Installation and receiving status

The study code and assets are part of the original CO-OPS contribution and normal source package. There is no extra database, server, browser profile, dependency installation or formula engine.

This guide describes delivered source behavior. An actual station capture, independent source review, browser journey, third-party model use or buyer acceptance is reported only when that original operation has completed. The public-reference mapping is an authored exchange convention over NOAA source fields. A buyer supplies their actual project, model headings and review decisions.
