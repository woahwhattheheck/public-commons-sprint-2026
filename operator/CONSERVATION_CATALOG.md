# Conservation candidate catalog

This extension reads a completed original Conservation study through a source-bound SQLite index. It supports county-scale candidate pages, exact scientific filters, retained all-matching selections, manual changes, and complete filtered exports while keeping the original study, candidate records, plan store, geometries and native runs authoritative.

The four additive files are:

- model/conservation_catalog.py
- operator/conservation_catalog.py
- operator/extensions/conservation-catalog.json
- operator/CONSERVATION_CATALOG.md

Copy these files to the maintained application with its existing extension registry. The descriptor registers the provider without changing the shared server. The current full Conservation study endpoint and command-line APIs keep their existing behavior. The Conservation browser owner composes the separate paging interface in the existing conservation.mjs.

## Original source and physical meaning

The input is the original completed study's files.candidates descriptor. The index identity includes the original study ID, complete descriptor and catalog format version. Preparation verifies the original hash and byte count, streams all candidate records, retains each original record intact, checks the original total/eligible counts, then publishes the completed SQLite file atomically.

The index stores original physical quantities and separate units. N/P remain kg/year and sediment remains metric tonnes/year as declared by the native Conservation engine. It does not recompute raster mass, assign missing quantities zero, change resolution, infer an unavailable model stage, or combine pollutant units. Native baseline, alternative and common-support fields stay in each original record. Alternative quantities and paired changes retain their distinct supports. Context-only studies preserve unbound null physical quantities.

The index is a derivative reading surface. Plans still call conservation.save_plan; full GeoPackage and decision packets still use the original Conservation export. No new geometry or plan store is created.

## Model functions

All functions receive the existing Workspace object.

- prepare(workspace, study_id): queued one-time streaming index build; returns complete catalog status, original source identity, full counts and files.index.
- status(workspace, study_id): passive catalog state, original count/summary, source identity, metric cases and supported filter fields.
- query(workspace, study_id, selection=None, retained=None): paged unchanged original candidate records and optional retained-cohort membership.
- candidate(workspace, study_id, candidate_id): exact original record without loading the full original array.
- select(workspace, study_id, selection=None): queued retention of ALL matching original IDs. The returned metadata has selection_id, count and files.selected_ids; the ID array remains in that retained JSON file.
- get_selection(workspace, study_id, selection_id, include_ids=False): reopen exact source-bound selection metadata; server consumers may explicitly request the IDs.
- save_selected_plan(workspace, value): resolves the retained ID set and small manual additions/removals, then calls the original manual-plan API.
- export_rows(workspace, study_id, selection=None, retained=None): queued complete filtered CSV and JSON export, independent of the visible page.

Every result identifies its original study. Candidate pages/details preserve the original candidate body without inserting selection flags into it.

## Queued operator actions

Use the ordinary current operator queue with the same workspace identity and task protocol.

| Action | Payload |
| --- | --- |
| conservation.catalog.prepare | {"study_id": "..."} |
| conservation.catalog.select | {"study_id": "...", "selection": {...}} |
| conservation.catalog.plan.save | {"study_id": "...", "selection_id": "...", "plan": {...}, "include_ids": [], "exclude_ids": []} |
| conservation.catalog.export | {"study_id": "...", "selection": {...}, "retained": {...}} |

Select and export use every matching row; offset and limit only govern query pages. Preparing a previously completed index verifies its retained file and returns reused=true. Retaining the same immutable source/filter selection reopens the same selection ID.

Each selection is stored below conservation/<study-id>/catalog-selections/<selection-id>/ with selection.json and selected-ids.json. The full ID file is downloadable through the original ticket service. Its source/index/query identity and hash are retained. Large selections do not pass through a browser-to-server plan request.

The plan.save result is:

    {
      "schema": "upstate.conservation-catalog-plan/v1",
      "study_id": "...",
      "selection": { "...retained metadata without ID array...": "..." },
      "plan": { "...original conservation.save_plan result...": "..." },
      "plan_id": "...",
      "resolved_count": 217
    }

The provider adds _conservation.study_id and _conservation.plan_id for the existing study/plan task buttons and exposes both retained selection and original plan files through existing downloads.

## Passive routes

The extension registers GET and POST for:

- /api/conservation-catalog/study
- /api/conservation-catalog/status
- /api/conservation-catalog/query
- /api/conservation-catalog/candidate
- /api/conservation-catalog/selection

POST bodies use the existing workspace routing plus study_id and the fields below. GET accepts selection and retained as JSON-encoded strings. POST is preferable for full scientific filters.

Study returns conservation.inspect(workspace, study_id, include_candidates=False). It keeps the actual source/run/score/normalization/criteria state without loading candidates.

Status returns state unprepared/building/failed/complete, original_count, original_summary, source_inventory, unit_type, planning_unit_label, metric_cases, pollutants, sort_fields, numeric_filters and metric_filter_fields. A building state reports streamed rows/total. A failed build retains its actual error.

Candidate accepts candidate_id and returns:

    {
      "schema": "upstate.conservation-candidate-detail/v1",
      "study_id": "...", "index_id": "...", "source_inventory": {...},
      "candidate": {...original candidate...}
    }

Selection accepts selection_id and returns the retained metadata/count/files. Reads do not create new selections.

## Query schema

POST /api/conservation-catalog/query:

    {
      "study_id": "...",
      "selection": {
        "filters": {
          "search": "",
          "eligible": "yes",
          "reporting_area_ha": {"min": 1},
          "source_water_fraction": {"min": 0.05}
        },
        "sort": "rank",
        "direction": "asc",
        "offset": 0,
        "limit": 100
      }
    }

The supported filters are:

| Filter | Meaning |
| --- | --- |
| search | Case-folded substring of original ID, label or original attributes |
| eligible | all, yes or no |
| ids | Explicit original string IDs; unknown IDs fail; an empty list matches none |
| rank | Inclusive min/max original rank |
| score | Inclusive min/max original score |
| area_ha | Inclusive min/max WHOLE source-unit area |
| reporting_area_ha | Inclusive min/max within-reporting area |
| cost | Inclusive min/max genuinely supplied original cost |
| protected_fraction | Inclusive min/max original protected overlap fraction |
| source_water_fraction | Inclusive min/max original source-water overlap fraction |
| metrics | Conjunction of original pollutant/case quantity, support or availability filters |

Every filter is combined with AND. Missing quantities remain SQL NULL and do not satisfy numeric ranges. A bound has min, max or both; neither may be null/nonfinite. Costs retain the original study's supplied currency, and queries do not invent absent costs.

Each metrics element accepts:

    {
      "pollutant": "nitrogen_export",
      "case": "baseline",
      "field": "coverage_fraction",
      "min": 0.9,
      "availability": "modeled"
    }

pollutant is nitrogen_export, phosphorus_export or sediment_export. case is baseline or one actual original alternative run ID listed in status.metric_cases. field is value, coverage_fraction, delta, reduction or common_coverage_fraction. Paired delta/reduction/common coverage require an alternative case. Baseline value uses original baseline; alternative value uses the original alternative's own-support quantity. Availability is modeled, not_selected or unbound. Each metric filter requires a range or availability.

Sort fields are id, label, rank, score, area_ha, reporting_area_ha, cost, protected_fraction and source_water_fraction, nitrogen_export, phosphorus_export and sediment_export. The three pollutant sorts use the exact original baseline quantity and retain nulls last. Direction is asc/desc. The default is rank ascending. ID/label/rank default ascending; other numeric sorts default descending. NULL sorts last; original ID provides stable ties.

Page limits are 1 through 1000; this bounds a response and never truncates the inventory. Offset is a nonnegative integer. Response:

    {
      "schema": "upstate.conservation-candidate-page/v1",
      "study_id": "...", "index_id": "...", "source_inventory": {...},
      "filters": {...normalized filters...}, "sort": "rank", "direction": "asc",
      "request": {...normalized request including offset/limit...},
      "total": 217, "original_count": 217,
      "offset": 0, "limit": 100, "next_offset": 100,
      "candidates": [...unchanged original records...],
      "selected_ids_on_page": [],
      "retained": null
    }

## Retained cohort, manual edits and selected-only pages

After the select task completes, query/export can include:

    {
      "study_id": "...",
      "selection": {"filters": {}, "offset": 0, "limit": 100},
      "retained": {
        "selection_id": "...",
        "include_ids": [],
        "exclude_ids": [],
        "selected_only": false
      }
    }

Query returns selected_ids_on_page separately from the unchanged candidate bodies. retained echoes selection_id, index_id, original_count, resolved_count, selected_ids_file, include_ids, exclude_ids and selected_only. Membership uses the original immutable source-bound filter in SQL plus the explicit additions/removals. It does not return the full cohort to the browser. selected_only restricts the visible page and filtered export to that cohort.

Changing search or page does not replace a retained selection. A new select task explicitly replaces the cohort using its supplied selection filters, independently of any previous retained cohort. An ID cannot be both added and removed, and foreign or mistyped IDs fail. Manual changes retain original text identities.

Save the cohort through conservation.catalog.plan.save:

    {
      "study_id": "...",
      "selection_id": "...",
      "include_ids": [],
      "exclude_ids": [],
      "plan": {
        "title": "Selected source-water priorities",
        "mode": "manual",
        "objective": "score",
        "include_ineligible": false,
        "limits": {"area_basis": "whole_units"}
      }
    }

The server verifies/reopens the retained ID file, resolves the explicit edits, and supplies the complete original IDs to conservation.save_plan. It preserves catalog_selection in the original plan.selection with the selection/source/file references and resolved count. It cannot change the originating study or switch this action to ranked mode. Ordinary small manually checked sets continue to use the existing conservation.plan.save action.

Original manual-plan rules still apply: select at least one unit, satisfy eligibility or explicitly opt in, obey supplied area/count/cost constraints, and preserve the genuinely supplied cost source. Both whole-unit and reporting union areas remain visible in the original plan. The catalog does not silently trim a manual selection to fit a budget.

## Export and persistence

Filtered JSON retains complete original candidates, attributes, practices, criteria, baseline/alternative/paired quantities and all source references. CSV exposes identity, rank, score, separate whole/reporting area, supplied cost/currency and individual baseline pollutant/unit/coverage columns. Complete pollutants/attributes/practice/exclusion objects are retained as JSON-valued CSV columns. Text cells are escaped for spreadsheet formula interpretation; the JSON original strings remain unchanged.

The export result contains count and files.json/files.csv with original relative paths, byte lengths and SHA256. Files live below conservation-exports/catalog/<source-query-digest>/. Export identity binds the source and normalized filter/order and, where supplied, retained cohort/manual edits. Visible-page offset/limit do not affect the export identity or contents.

Index publication is atomic after the SQLite connection closes. Preparation verifies original hash, exact streamed bytes, source schema/study identity, all original IDs, original metric cases/units and total/eligible counts. Candidate IDs are SQLite primary keys. The immutable read index checks exact metadata binding on every page and its descriptor size; preparation/reuse verifies its full hash. Retained selections and exported files use full descriptor verification on reopen. Failed preparation preserves a usable error record and never publishes an incomplete completed index.

## Existing-workspace receiving

Use the same already completed real regional or parcel study. Do not prepare another native model run for this browsing extension.

From the maintained application root:

    python -m model.conservation_catalog --workspace /actual/workspace --study-id ACTUAL_STUDY_ID prepare
    python -m model.conservation_catalog --workspace /actual/workspace --study-id ACTUAL_STUDY_ID status
    python -m model.conservation_catalog --workspace /actual/workspace --study-id ACTUAL_STUDY_ID query --selection /actual/query.json
    python -m model.conservation_catalog --workspace /actual/workspace --study-id ACTUAL_STUDY_ID select --selection /actual/query.json
    python -m model.conservation_catalog --workspace /actual/workspace --study-id ACTUAL_STUDY_ID selection ACTUAL_SELECTION_ID
    python -m model.conservation_catalog --workspace /actual/workspace --study-id ACTUAL_STUDY_ID query --selection /actual/query.json --retained /actual/retained.json
    python -m model.conservation_catalog --workspace /actual/workspace --study-id ACTUAL_STUDY_ID plan-save --spec /actual/plan.json
    python -m model.conservation_catalog --workspace /actual/workspace --study-id ACTUAL_STUDY_ID export --selection /actual/query.json

Receiving should compare complete paged IDs/counts against the retained original candidate file, inspect one source-context null physical record and one available native record when that existing study is ready, retain an eligible all-matching set, make one explicit manual adjustment, save through the original plan engine, reopen with a fresh Workspace, and verify original plan selection plus CSV/JSON descriptors. The browser continuation can then exercise the same study with the ordinary queued prepare/select/plan.save/export actions and passive pages. This is an extension of the current receiving operation.
