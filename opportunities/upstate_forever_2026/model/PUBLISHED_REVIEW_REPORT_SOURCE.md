# Saved observation review → scientific report source

This component publishes an existing immutable Published studies review as an ordinary scientific report source. It uses the saved station, parameter, depth-stratum and calendar selection and the current interpretation returned by the maintained review/store engine. Its result enters the existing ordered report composer and selected editable Study transfer.

## Work in the operator

1. Open an original Published studies edition and select the records to review.
2. Save the review with its title, notes and original filter selection.
3. In the saved review's **Scientific report** card, choose **Prepare saved review source**.
4. The existing task queue captures the review and its current selected interpretation. Reopen a retained source edition or select **Open scientific composer** to place that exact source in the ordered report.
5. Save/render through the existing composer. Original tables and source links remain available in the completed report and editable Study export.

Changing a review produces the existing new immutable review identity. Changing interpretation code or the resulting native context produces a distinct scientific source edition. Earlier prepared editions remain independently inspectable and composable.

## Scientific scope

The recipe contains:

- Exact review title, notes, saved time, study edition and resolved station/parameter/stratum/year/month filters.
- Selected original activity chronology, result tokens, units, detection conditions, direction and reported limits.
- Original project/activity identities, methods, fractions, result bases, and complete result/activity/laboratory comments.
- Existing per-series quantified statistics and interval-support fields. Series preserve original method/unit/basis support; this producer introduces no new pooling, substitution or numerical estimator.
- Original published tables under their selected table support, including seasonal and continuous summaries. Published summaries retain their source cohort rather than being relabeled as statistics of a different activity selection.
- Native source notes and explicit calendar/filter support. Wider source coverage, calendars and full-study figures remain labeled as original source context.

The selected-context.json file preserves every native field and original row/source selector, including fields not repeated in formatted tables. Original Information Only and other comments remain visible without silently changing the existing engine's numerical inclusion rules.

The existing engine controls filter support. For a lake study, continuous month/year filters can apply to continuous summaries while published campaign activities retain their original campaign support. Generic observation studies can apply calendar filters to activity rows. The saved selection and exact temporal_support/selection_notes preserve this distinction.

## Complete original export and selected files

The original-review.zip is the unchanged complete archive from PublishedStudyReviews.export. Extract it to open review.html, the selected report, its complete relative source hierarchy, original full-study figures and original-study.zip. The ordinary saved-review receive command reopens it through the maintained store.

Every selected CSV is also copied unchanged into neutral numbered selected-records/*.csv members. The selected-records/index.json maps each file to its original export path with exact bytes and SHA256. When the exporter supplies selected-activities/index.json, its full row and metadata provenance becomes selected-records/original-row-index.json.

Neutral companion names preserve scientific scope: the maintained observed-report collector recognizes full original lake-source filenames and can reconstruct a campaign context. This recipe instead supplies the exact selected tables directly and contains full original reports inside their unchanged review ZIP.

The index.html is a standalone printable version of the selected scientific sections. Its relative links require the complete prepared source directory. The ordinary composer retains every member and rewrites its delivered links through the existing source machinery.

## Native CLI

Run from the installed application with its ordinary Python interpreter:

~~~sh
python -m model.published_review_report_source \
  --workspace "$ACTUAL_WORKSPACE" preview "$SAVED_REVIEW_ID"

python -m model.published_review_report_source \
  --workspace "$ACTUAL_WORKSPACE" prepare "$SAVED_REVIEW_ID" \
  --expected-preview-id "$PREVIEW_ID"

python -m model.published_review_report_source \
  --workspace "$ACTUAL_WORKSPACE" inspect "$SOURCE_EDITION_ID"

python -m model.published_review_report_source \
  --workspace "$ACTUAL_WORKSPACE" catalog --review-id "$SAVED_REVIEW_ID"
~~~

A review ID retains its review- prefix. A prepared source edition ID is a 64-character lowercase hexadecimal digest. Preparation can additionally receive --expected-review-sha256 to bind the exact saved review file shown in preview.

The CLI obtains the ordinary Workspace lock during preparation. An operator already holding that lock invokes prepare directly; the producer takes only its own per-edition lock.

## API contract

Module: model.published_review_report_source

- preview(workspace, review_id) returns id, identical preview_id, review_id, review_sha256, title, selection, counts, source binding, interpretation identity/snapshot comparison and implementation identities.
- prepare(workspace, review_id, *, expected_preview_id=None, expected_review_sha256=None) returns the complete verified retained source edition. A changed preview or review binding requires another preview.
- inspect(workspace, id) and get(workspace, id) reopen that exact edition without recomputing the current interpretation.
- catalog(workspace, *, review_id=None) returns {schema, items} with concise retained edition descriptors.

FOLDER is published-review-report-sources. Every result.files descriptor is relative to workspace.root / FOLDER / result.id. The source_choice contains the actual imported source_collection_id and document source_id. Completed products have state complete; unfinished operation directories stay out of the catalogue.

## Identity, interruption and receiving

The immutable identity binds the original project, exact review bytes, study/source collection/manifest inventory, resolved selection, normalized current context and original implementation files. Normalization uses the store's JSON representation, preserving native values and source-file field order while converting tuples to their ordinary JSON arrays. Only the location-dependent manifest resolver path becomes sources.json in that semantic context.

The original exporter produces timestamped ZIP bytes. Preparation captures the completed archive once and validates every declared member. A retry reuses that exact original-review.zip rather than replacing it with a fresh timestamped export. Export checkpoint, original review, source record/manifest, implementation files, selected CSV index and recipe stay together. Interrupted source import resumes against the same immutable bytes.

Normal complete-file tickets and the Workspace backup inventory carry these files. No new archive format is introduced.

## Editable Study lineage

The model.published_review_study_transfer.include_source helper runs only for an explicitly selected source of a saved scientific-report edition. The maintained scientific_report_study_transfer._source dispatcher calls it alongside existing typed handlers.

For a same-project source, it verifies and retains:

- The original completed source product, recipe, implementation and every selected/original companion.
- published_studies/reviews/<review-id>.json.
- The exact published_studies/<study-id>/<version-id>/record.json, sources.json and every declared original source file.
- The original Workspace source collection and its content-addressed bodies.

The store resolves the explicit study version without a mutable current.json pointer. The reopened review remains editable; saving changes produces the normal new review.

For a source imported from another project, transfer preserves the contained report/review archive and its original lineage. It does not substitute unrelated local records with matching-looking IDs.

The original Study receipt records source project, review/file identity, selected interpretation and source binding. Scientific-report ordering and generic source traversal remain unchanged.

## Installation and integration

Compose integration/component_fragments/published-review-report-source.json with the maintained Published studies family, scientific-report editions and Study transfer components. Python dependencies come from the existing original measurement/store and common modules.

The standalone Published studies installer preserves its current shared dispatcher and inserts only these lines immediately after the original native-process handler inside _source:

~~~python
from . import published_review_study_transfer
published_review_study_transfer.include_source(closure, collection_id, entry)
~~~

Retain the function's indentation and every other handler. Repeated installation recognizes the existing import/call. A changed or ambiguous anchor requires composing against that current original function rather than replacing the module with an older copy.

## Receiving the existing observation case

Use a real saved review from the already imported native observation study. Preview, prepare and inspect it, place its source_choice through the maintained composer, then use the existing selected Study export/reopen workflow. Retain the original review ID, source edition/collection/document IDs and reopened selection/counts. The same original observations continue throughout; preparation runs no new model.
