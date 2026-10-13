# Saved field observations in the scientific workspace

The Implementation & fieldwork desk can register one exact saved plan revision in the original Observed water quality registry. Each edition retains the full plan, original field rows and their site, visit, activity, sample and custody relationships. A companion observed-context report is available in the source collection for the normal client-report workflow.

## Operator journey

1. Open the original native workspace and its saved implementation plan. In **Field records**, enter actual visits, sample/activity identities, collection timestamps, methods and original result values. Keep units, chemical basis, fraction, detection and quantitation limits, qualifiers and quality flags. Text, censored and missing results remain distinct from numeric measurements.
2. Choose **Review saved field observations**. If the browser contains edits or a new plan, choose **Save and review field observations**: the original native save/import operation runs first, and the preview then reads the exact saved revision. A newer edit made during that save remains a browser draft; save and review it when ready.
3. Review the original record counts, numeric/censored/text/missing counts, distinct sites and activities, records missing a collection timestamp and sites missing coordinates. The preview names the saved revision. Only an activity's recorded collection time supplies the observation date; a planned visit is not a collection timestamp.
4. Choose **Register saved field observations**. The retained operator task registers the original source collection, observation edition and report source. A connection interruption keeps the same task and operation ID. Use **Retry original operation** or **Resume original task** as offered by the original queue.
5. After completion, choose **Open observed data**. The existing Observed water quality view opens the actual observation ID, original rows and series. **Open retained source and report** opens the original source collection, including the complete field plan and its observed-context report. **Inspect observation edition** shows the saved plan/revision, source and observation identities, report binding and delivery selection.
6. Choose **Prepare client report** to open the existing delivery form with this exact observed-context source and binding already selected. Complete the remaining project choices in that form. Finish an already-open report or field editor first so its choices remain intact. The report source contains field records and their stated interpretation; it does not turn observed concentrations or categorical results into annual modeled export.
7. Continue editing the implementation plan normally. A later saved revision can register a distinct observation edition. The earlier saved edition remains tied to its original plan revision. The native project transfer retains the source collections, observed registry, complete plans and report companions through the existing application/Workspace packaging paths.

The standalone field workbench supports the original offline capture and JSON return. Registering observations requires receiving the returned JSON into the original native workspace, then using this saved-revision workflow.

## Installed source and API

Install the complete current application or run its maintained `install_implementation.py --application ACTUAL_APPLICATION --source-root RECEIVED_SOURCE`. Its required files include `model/implementation_observations.py`, and its supplied `operator/web/implementation_workbench.html` is rebuilt from the same browser source. The existing observed registry and observed-context/report modules remain the destination; this feature adds no parallel scientific store.

The extension descriptor owns these additions:

- `GET /api/implementation/observations-preview?workspace=KEY&plan_id=ID&revision=N`
- queued action `implementation.observations.import`, also exposed by `POST /api/implementation/observations-import`

The action payload is `{plan_id, revision, document_digest, observation_operation_id}`. The digest and observation operation ID come from the authenticated preview of the exact historical saved plan. The operation also binds available original attachments and the selected report context; a changed source selection requires a new preview before any import writes. The provider rejects incoming documents or uploaded replacements in this path. It does not mutate the plan or reuse a plan-save event as a scientific import receipt.

Both preview and completion return `upstate.implementation-observation-context/v1`, original plan identity and source-type/coverage summary. Completion returns actual `source_collection_id`, `observation_ids` and `report_source`. The top-level source collection retains the original field input; `report_source.source_collection_id` names the separate bound report collection, including the field source companions. The operator adds `workspace_key`, `plan_id`, `revision` and the original `document_digest`; the browser checks these against the retained task before presenting its result.

The browser uses the existing core `openItem('observations', id)` and `openItem('sources', report_source.source_collection_id)` capabilities after a native state refresh. Workspace guards prevent a delayed response from opening in a different study. The original field editor, native revision history, economic-source import and portable JSON return remain in the same planner.

## Exact result mapping

| Original field | Native observation/source meaning |
|---|---|
| Observation ID | Original record ID, unique within the saved plan |
| Site ID and label | Station ID plus original label; no label-based remapping |
| Site latitude/longitude | Original recorded values in CSV/full revision; no unstated datum or modeled catchment assignment |
| Activity ID, visit ID, sample ID, custody reference | Original relationship fields, retained separately |
| Activity collected_at | Full original timezone-qualified timestamp; its recorded local calendar date indexes the native dated review |
| Visit visited_at and planned_date | Separate original fields; neither substitutes for sample collection time |
| Parameter, unit, basis and fraction | Original strings; no chemical-species or unit conversion |
| Numeric result | Saved finite numeric value; original result text retained independently |
| Censored, text or missing result | Nonnumeric display value with explicit original result-type prefix; original text remains verbatim |
| Qualifier, detection limit and quantitation limit | Separate original fields; limits are not substituted for measurements |
| Observation method and activity method | Separate fields; an activity method does not silently replace an absent observation method |
| QA status and notes | Original values, with no silent QA-based row removal |

The native importer tries to parse numeric-looking CSV values. For this reason the derived `display_value` column is the numeric value only when the saved result type is numeric. Otherwise it is `[censored] `, `[text] ` or `[missing] ` followed by the exact original text. Thus a text result of `123` cannot become an observed measurement. The `original_text` column and complete original JSON remain unchanged.

The observation metadata declares `value_basis=context`, `measurement_support=other_context` and original collection-time support. The displayed start/end date is the same collection calendar date and is not an averaging period. The maintained annual-load comparison continues to require its existing explicit annual-mass-rate admission. This import computes no pollutant load and makes no model-fit claim.

The dated source grouping separates basis, fraction, observation method, activity method, QA status and original result type, in addition to the native parameter and unit axes. Censored/text/missing rows remain in the original table and CSV. Detection and quantitation limits remain distinct; the adapter does not guess which limit defines a plot bound.

## Public Python contract

```python
from model.implementation import ImplementationStore
from model.implementation_observations import (
    preview_observation_context, import_observation_context,
)

saved = ImplementationStore(workspace).get(plan_id, revision=revision)
preview = preview_observation_context(workspace, saved)
received = import_observation_context(
    workspace, saved, expected_operation_id=preview["operation_id"],
)
```

Both functions accept optional `existing_report_selection=` containing the actual existing native delivery selection. They validate the exact saved revision through `ImplementationStore.get` and `document_digest`. Import also accepts `expected_operation_id=` from the preview. It checks this complete source identity before writing, so recovered attachments or another report context require a refreshed preview. Public validation failures use `ImplementationError`.

The serializable preview contains:

```json
{
  "schema": "upstate.implementation-observation-context/v1",
  "edition": "field-observations-20261013-v1",
  "plan": {"id": "original plan ID", "revision": 1, "sha256": "original digest", "title": "original title"},
  "operation_id": "digest of the original bound operation",
  "summary": {
    "row_count": 0,
    "numeric_count": 0,
    "censored_count": 0,
    "text_count": 0,
    "missing_count": 0,
    "site_count": 0,
    "activity_count": 0,
    "collection_time_missing_count": 0,
    "coordinate_missing_site_count": 0
  },
  "source_collection_id": null,
  "observation_ids": [],
  "report_source": null
}
```

This is a shape example, not an observation dataset. Summary additionally includes first/last collection dates, source-attachment availability counts and time/coordinate interpretation.

Import fills the actual `source_collection_id`, `observation_ids` and `report_source`. An empty saved observation collection retains its revision and report source without attempting to ingest an empty CSV as an observation edition.

`report_source` contains the actual source collection/source ID, role, original binding, new binding, complete native `delivery_selection` object, workspace-relative `delivery_selection_path`, directory and verified file descriptors. The top-level `files` list covers the whole original operation and its report members. The receipt includes `state=imported` and the returned `reused` flag distinguishes reconnection from first completion.

## Original source and restart behavior

The operation directory is:

```text
<workspace>/implementation/observed-context/<operation_id>/
```

It preserves the exact original revision JSON bytes, canonical original plan, original attachment inventory, available declared local-file attachments, derived field CSV, native source manifest, observation metadata and complete report source. The CSV's `source_records` value binds each original observation, activity, visit and site by exact ID and JSON pointer into the complete retained original plan, with its plan digest. Unknown source fields remain intact in that original plan and revision. Compact pointers avoid repeating large site, activity or visit documents in every CSV record.

Local files are read only from the original workspace with their declared SHA256 and byte length. Incomplete descriptors or unavailable original files remain explicit inventory records, while actual available files are verified and retained. Changed declared source bytes raise an error. The operation identity binds the original revision file, attachment inventory and selected report context; a later attachment recovery creates a distinct source operation.

The source manifest excludes each entry's own body from its companions. This matches the existing Workspace source importer and avoids native path collisions. The report entry has `metadata.report_schema=upstate.observed-report/v1`, so it appears in the maintained report picker.

Source and observation identities are immutable. A restart after an intermediate import reuses the same deterministic IDs. A completed receipt verifies all retained member hashes and byte lengths, original observation operation IDs and actual report binding before reopening. Its paths remain relative to the workspace, supporting the ordinary restored-workspace layout.

When an existing observed report is selected, every original source member and original inline scientific figure specification is retained under `existing-context/`. The adapter rebases report link and SVG/spec selection paths, then appends field sections. The shared scientific formatter and delivery collector remain the original maintained modules.

Selecting the same composed field report again unwraps its retained original context before composing, preventing recursive copies of an identical field edition. Other delivery-selection fields remain intact. Report tables show all original rows up to 200 and clearly link the complete CSV and saved revision for larger collections; grouped result counts cover every row.

## Integration ownership

- `model/implementation_observations.py` owns only original saved-source mapping, native observation import and bound report-source composition.
- The existing FIELD12 provider owns authenticated preview/import actions and the durable task queue.
- The existing FIELD12 browser owns save/preview/confirm/result navigation.
- The existing Observed water quality desk, source picker, scientific formatter, delivery collector and portable Workspace retain their established contracts.


## Review results and actual measurement support

The field planner's results section supports search across original result/sample identifiers and text, exact site/parameter/result-type/QA/source/unit filters, original-local collection date filters, and consistent paging. The export actions retain every matching row across all pages. Blank QA and unit values remain distinct selectable values. Inspecting a result shows its current edited values beside the original CSV cells, original collection activity and source records. The source inspector and full matching JSON retain original IDs.

The native Observed report now describes the support of the selected saved revision in four sections: exact measurement definitions and numeric support; declared campaign coverage and sample follow-up; original collection calendar and metadata availability; and original detection, quantitation and source-labelled limit records. Numeric ranges use numeric results in the exact original site/parameter/unit/basis/fraction/laboratory-method/collection-method/QA/qualifier stratum. Censored, text and missing results have separate counts.

Campaign coverage joins original results through visits explicitly linked to the campaign. Its site/parameter pairs come from the saved declaration. Collection dates use each original timestamp's local calendar, while first/last observations are ordered by the actual instant. A saved frequency description is retained as text. Original QA codes and reporting-limit labels remain unchanged.

Complete downloadable companions accompany the source and native report:

- `quality/summary.json`
- `quality/comparison-strata.csv`
- `quality/definition-variants.csv`
- `quality/campaign-coverage.csv`
- `quality/sample-followup.csv`
- `quality/sampling-calendar.csv`
- `quality/source-limits.csv`
- `quality/metadata-availability.csv`

These files retain the original observation identifiers and source pointers. The rendered tables show a manageable first set of records; the companions include all rows. The observation source edition is `field-observations-20261013-v2-quality`. Original earlier derived editions remain available. The Eighteenmile receiving command includes this observation edition in its operation identity, reconnects the same original laboratory-applied revision, and writes a separate derived receiving result for the new edition.

See [Results review](IMPLEMENTATION_RESULTS_REVIEW.md) for the editor and [Laboratory results](IMPLEMENTATION_LAB_RESULTS.md) for original CSV intake.

### Initialize the original observed workspace

The original source case can run before a modeled workspace archive is received. Use the explicit creation option to initialize a dedicated native workspace, then import the original Eighteenmile samples, laboratory results and observed report sources:

```text
python source_tools/receive_wqp_field_results.py --workspace ACTUAL_DEDICATED_OBSERVED_WORKSPACE --create-workspace
```

Its default workspace title is `Eighteenmile original field observations`; `--workspace-title` accepts an explicit alternative. Repeating the command retains the same workspace identity and reconnects the original applied laboratory revision and current observation edition. Without `--create-workspace`, select an already existing workspace.
