# Saved Published Studies reviews

A review saves a named reading of one exact retained study edition. Open Published studies, select its original stations, parameters, depth strata and dates, then save a title and working notes. Reopen that review to recover the same source edition and filters. Save a revision to preserve the earlier review and link the new one to it; save a new review when changing study edition.

## What the record retains

Each immutable review binds its study ID and version, native source collection, original source-manifest SHA-256 and the complete source-file inventory SHA-256. It also retains the selected table, canonical station/parameter/stratum/year/month selection, title, notes, original coverage and sampling-support snapshot, parent review identity when applicable, and save time. Empty parameter, stratum or month arrays retain the original “all” meaning. The original context reader expands an empty station selection to the actual station IDs, so a later edition cannot silently expand a saved cohort.

The record is content addressed as `review-<SHA256>`. Repeating the same save returns the existing immutable record. Saving changed notes or filters with a parent creates another record; it does not modify the parent. A parent must refer to the same source binding. An independently saved identical review can have its own save timestamp; receiving the same content preserves the receiving project's existing record and timestamp.

A review does not pool analytical fractions, measurement types, methods or units. The maintained PublishedStudyStore remains the sole table and report producer. Original observations keep their source row IDs, response columns, qualifiers, reporting limits and source hashes. In the source observation studies, date filters apply to actual sampling dates. In the published lake study, year/month filters apply to its continuous summaries while seasonal campaign tables retain their published sampling support. The original report explains that applicability alongside its data.

## Open, revise and share

The saved-review list shows exact study editions, saved titles and save times. Open review restores every saved station, parameter, depth stratum, year, month and table. Parameters, strata and months support multiple values; their All buttons clear the corresponding filter. Explicit saved values remain visible even if absent from the usual options or producing an empty cohort. Manual station filtering requires at least one selected station.

After opening a review, edit its title, notes, filters or table and choose Save review to create a linked revision. Save as new review creates an independent record; New review starts a fresh title and notes with the current selection. A manual switch to another study starts a new draft. Save edits before exporting when those edits belong in the shared review.

Working notes remain separate from scientific source records. Leaving the desk preserves its in-memory draft separately for each workspace, including its filters, table, title, notes and last opened review. Native saves are durable. Late responses or task completion can refresh the catalogue without replacing a newer edit, another review or a later workspace visit. Accepted tasks remain tracked across remounts and retries retain their original operation identity.

The complete review download is `saved-review.zip`. Extract it into a new directory and open `review.html`. The package contains:

- `review.json`: the exact immutable review, source binding, saved coverage and sampling-support snapshot.
- `selected/study-report.html` and its complete selected CSV/HTML/source-companion tree, produced by the existing selected-study exporter.
- `original-study.zip`: the entire bound study, original source files and native manifest.
- `review-export.json`: exact archive member sizes/hashes and whether the current interpretation agrees with the saved snapshot.

All relative report links remain within that extracted package. The operator offers the complete ZIP and exact selection JSON through its existing authenticated file tickets. A raw standalone HTML download is not substituted for the complete report tree.

If the maintained interpretation later changes coverage or sampling-support presentation, opening the review still verifies its exact original source edition and cohort. The interface and offline HTML explicitly identify that difference. The original snapshot remains in review.json, and the current selected report retains the actual current interpretation. Source-binding or selection mismatches are errors.

Use Import saved review to receive a complete review ZIP. The native importer validates every declared archive member, restores the original study through its maintained importer, resolves the exact saved cohort, and publishes the immutable review only after those checks. Receiving an older review preserves an existing current study edition. A fresh workspace receives the original edition as its first current study. The review itself opens by its exact version rather than by the current-study alias.

## Existing Workspace portability

Saved records are normal retained files beneath `published_studies/reviews/`, inside the existing Published Studies portable root. Existing complete project backup/restore therefore carries them with the original study and source collections. Source resolution uses the restored Workspace root and the native source manifest; review records contain no absolute source-folder dependency.

A standalone review ZIP carries the original study needed for its own reopening. Its parent review ID is provenance; importing an earlier parent is not required to open the exported review. A full project transfer retains every local parent edition.

## Native API and command line

Existing source routes and report producers are unchanged. The catalogue additionally returns `reviews`. The read-only endpoint is:

`POST /api/published-studies/review` with `{workspace, review_id}`.

It returns the exact `review`, the existing fully decorated `context`, and `interpretation_matches_snapshot`. The normal team viewer policy permits this read; queued mutation/export tasks keep the operator's existing write authorization.

Use the existing task API for:

- `published-study.review.save`: `{study_id, version_id, title, notes, table, selection, parent_review_id?}`.
- `published-study.review.export`: `{review_id}`.
- `published-study.review.import`: `{source:{source_collection_id,source_id}}` or the existing administrator source-folder selector `{source:{root_id,relative_path}}`.

Every task retains the original accepted task/operation identity and returns the saved review plus exact study/version/selection/table. Existing task decoration creates authenticated artifact tickets.

The full native course is available without a browser:

```bash
python -B -m measurement_workspace.study_reviews --workspace "$WORKSPACE" list
python -B -m measurement_workspace.study_reviews --workspace "$WORKSPACE" --result "$OUTPUT/saved.json" save --selection "$OUTPUT/review-request.json"
python -B -m measurement_workspace.study_reviews --workspace "$WORKSPACE" --result "$OUTPUT/opened.json" open --review-id "$REVIEW_ID"
python -B -m measurement_workspace.study_reviews --workspace "$WORKSPACE" --result "$OUTPUT/exported.json" export --review-id "$REVIEW_ID" --out "$OUTPUT/review-export"
python -B -m measurement_workspace.study_reviews --workspace "$RECEIVING_WORKSPACE" --result "$OUTPUT/received.json" receive --source "$OUTPUT/review-export/saved-review.zip" --operation-id "$ORIGINAL_RECEIVING_OPERATION"
```

The save request is ordinary JSON. Set the exact IDs returned by the native catalogue; for example:

```json
{
  "study_id": "ACTUAL_RETAINED_STUDY_ID",
  "version_id": "ACTUAL_RETAINED_STUDY_VERSION",
  "title": "Upstream sampling review",
  "notes": "Working notes about this original selected cohort.",
  "table": "observed",
  "selection": {
    "site_ids": [],
    "parameters": [],
    "strata": [],
    "year": null,
    "months": []
  }
}
```

For the existing native receiving operation, use an already imported original study, save an actual station/parameter/date selection, export it, receive the complete ZIP in the original receiving workspace, and reopen the same review ID. Compare its source binding and canonical selection, verify original selected CSV rows and report links, then include it in the existing project archive/restore course. This is a continuation of the maintained Published Studies operation; no model execution or source recapture is required.
