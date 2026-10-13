# Implementation source import

The helper in model/implementation_sources.py converts selected original records into portable implementation candidates and source links. It has native adapters for actual Community plans and Conservation portfolios, plus explicit mappings for other source exports. Its Community adapter follows the actual save_plan, _interventions and _context functions from communities.py blob dd7785ad8633af7b038857b83408534166b0c8cb. The source API is:

https://api.github.com/repos/woahwhattheheck/commons/git/blobs/dd7785ad8633af7b038857b83408534166b0c8cb

Repository path: opportunities/upstate_forever_2026/model/communities.py.

The result joins the existing upstate.implementation-plan/v1 store. It contains complete retained source data and candidate rows, plus task proposals for explicit operator selection. It calls no Workspace methods, remote services, model engines or optimizer.

## Public call

    from model.implementation_sources import import_selection

    imported = import_selection(
        original_source_document,
        source_id,
        kind,
        source_ref=original_reference,
        selected_ids=None,
        field_mapping=None,
        method_mapping=None,
    )

All inputs and results are JSON-compatible. Python 3.10 or newer and the standard library are sufficient. The helper never mutates the caller's input.

The return object has:

| Field | Meaning |
| --- | --- |
| schema | upstate.implementation-source-import/v1 |
| source_digest | SHA256 of the original source object's canonical UTF-8 JSON after removing only the top-level _downloads presentation field |
| source_links | One source link containing its ID, kind, label, optional reference, original source ID, digest, exact field mapping, and whole source snapshot |
| candidates | Selected candidate records compatible with the implementation plan |
| proposed_task_inputs | Proposed title, original owner and next step, optional explicitly mapped catalog method, source planning context, and null duration |
| selection | Source kind/ID, source row count, selected count, selected original IDs, and selection basis |

Merge candidates and source_links through the existing implementation store using the current plan revision. The returned object itself is a selection-import envelope, not a full plan document.

## Native community plan

Use kind community_plan. The alias community_plans is accepted and normalized to community_plan, matching the operator's collection name.

Pass the complete saved community plan document returned by the native operator item lookup. The source requires title, purpose, table_id, revision_number, source, metadata, selected_groups, context and interventions. Its retained context includes snapshots, physical_totals and snapshot_sha256. A raw planning form or a demographic table alone is a different document shape.

The following field mappings are grounded in the inspected native implementation:

| Actual export field | Implementation use |
| --- | --- |
| interventions[*].id | Original row identity, retained in candidate.source |
| interventions[*].title | Candidate label and proposed task title |
| interventions[*].status | Default selection filter |
| interventions[*].strategy | Explicit method_mapping lookup key |
| interventions[*].owner | Proposed assignee text for operator review |
| interventions[*].next_step | Proposed next-step text |
| interventions[*].utility_id, watershed_id, geoids | Original intervention geography and planning context |
| interventions[*].community_context | Original demographic context in the frozen row |
| interventions[*].cost_estimate_usd | Original decimal-string planning estimate in the frozen row and proposal |
| context.source_collection_ids, grid_id, baseline_run_id, scenario_run_ids, delivery_id, snapshot_sha256 | Original model/source references copied into candidate.source.model_context |
| context.snapshots and context.physical_totals | Original whole-plan model context retained in the source-link snapshot |

Default selection includes status selected, in_progress or complete. Status proposed is omitted by that default. Supplying selected_ids explicitly replaces the status filter, so the operator can deliberately import a named proposed intervention. Supplying an empty selected_ids array imports zero candidates and retains the source link. Unknown IDs and duplicate IDs produce an actionable error; they are never silently skipped.

No per-intervention area or physical benefit exists in the inspected native export. Native candidates therefore omit area_ha and have modeled_benefits: []. The source's physical_totals explicitly use the original run's reporting-area raster before demographic selection. They stay with that original whole-plan context. The importer does not apportion them to an intervention, group, household or person.

The source plan status also stays separate from implementation progress. Importing an intervention with status complete does not create completed implementation tasks, visits, activities or observations.

Example native call:

    original = operator.item(workspace, "community_plans", original_plan_id)
    imported = import_selection(
        original,
        original_plan_id,
        "community_plan",
        source_ref="workspace:community_plans/" + original_plan_id,
        selected_ids=["buffer-site-7", "intake-review-3"],
        method_mapping={
            "protect": "protect-land",
            "investigate": "source-investigation",
        },
    )

The source reference in this example is a caller-defined workspace reference; an actual deployment may supply its own original file or native record reference. The importer retains it verbatim.

Mapping restore automatically to riparian-buffer would impose an unverified action meaning. Choose the appropriate catalog method from the actual intervention details. Methods can be chosen later in the workbench; unmapped method keys leave method_id null.

## Native conservation portfolio

Use kind conservation_portfolio for the original portable JSON with schema upstate.conservation-portfolio/v1. This adapter follows build, save_plan, _aggregate, get_plan and the portfolio export in conservation.py at commit f2c43c5530bc30b0c7aa6133c796ecc140c02566, blob 961a444d0d8f3608592601819d62ca4a90ae927c:

https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/f2c43c5530bc30b0c7aa6133c796ecc140c02566/opportunities/upstate_forever_2026/model/conservation.py

The corresponding source operating guide is retained at:

https://api.github.com/repos/woahwhattheheck/public-commons-sprint-2026/git/blobs/10d6da058f88e95a8c580323f08b93ad57c50f2f

The actual portable document contains id, study_id, selected_ids, summary, selected_candidates, skipped and selection_steps. Its saved plan is a different original document with schema upstate.conservation-plan/v1, a complete state, selection settings and files descriptors. Passing the saved plan alone does not supply the selected candidate rows; the native adapter resolves its files.portfolio descriptor.

Every original selected_candidates row is imported by default, in its original order. selected_ids can explicitly choose a subset. The document's selected_candidates IDs must exactly match its original selected_ids; the helper does not choose eligible or higher-ranked substitutes. A deliberately saved selection that included an ineligible candidate remains that original selection.

| Original field | Retained meaning and implementation use |
| --- | --- |
| id and label | Original candidate identity and display label |
| source_identity.source_collection_id, source_id, native_id | Original retained source edition and native feature identity |
| unit_type | Actual parcel, watershed or management_unit type |
| area_ha | Whole original unit area; copied to candidate.area_ha |
| reporting_area_ha | Clipped reporting-footprint area; separately retained on the candidate |
| pollutants | Original candidate reporting-footprint inventory and scenario comparison records, retained in row_snapshot |
| cost and currency | Original supplied whole-unit cost and currency, retained as source planning context |
| original_attributes and geometry_corrections | Original attributes and recorded geometry corrections |
| eligible, exclusion_reasons, score and rank | Original study eligibility and planning score results |
| summary | Original portfolio union quantities, footprint accounting, supplied-cost accounting and context |
| skipped and selection_steps | Original selection decisions and successive whole/reporting union areas |

The imported candidate explicitly carries area_basis: whole_original_unit. Its source.conservation_context keeps the original source identity, portfolio and study IDs, pollutant scope, and original summary pointer. Candidate reporting_area_ha is a separate value. These areas are retained as supplied; the helper performs no geometric union, clipping or conversion.

The original pollutants object carries units such as kg/year and metric_tonnes/year, baseline quantities, availability, coverage, structural-stream omissions, missing support and scenario alternatives. Alternatives retain their run IDs, signed delta/reduction, common-support quantities and profile-change flags. These records remain complete in source.row_snapshot.pollutants. They are not a native modeled-benefit array, so candidate.modeled_benefits stays empty.

The original summary distinguishes reporting union_area_ha, whole_unit_union_area_ha, individual area sums, overlap, budget_area_ha and area_budget_basis. Physical quantities were recomputed by the source engine on the selected reporting-area union. Supplied costs apply to complete original units, regardless of the area-budget basis. The importer keeps those source quantities and their meanings separate. It neither sums overlapping candidate pollutant records nor treats a full-unit cost as a cost for a clipped reporting footprint.

When selected_ids imports a subset of an existing portfolio, the retained source summary still describes the original complete portfolio. It is not a new summary for the imported subset. The result's selection.selected_ids and selected_count identify exactly what was imported.

### Native context envelope

A portable portfolio retains study and source IDs, selected rows, and its original summary. A native workspace import can also preserve the complete saved plan and selection file, including original model-run/source bindings, methodology and the selected footprint descriptor. Supply this declared adapter envelope:

    {
      "schema": "upstate.implementation-conservation-source/v1",
      "portfolio": "<complete original portfolio.json object>",
      "plan": "<complete original plan.json object>",
      "selection": "<complete original selection.json object>"
    }

The angle-bracket text here stands for whole JSON objects, not strings in the actual input. The envelope is an implementation adapter contract; its three member documents retain their original schemas and content.

The helper verifies their shared portfolio/study IDs, selected IDs, summary, selection steps, skipped records and plan_selection. It retains the complete study_selection with its spec and bindings, plus method and normalization. The plan's portfolio, selection and footprint descriptors retain their original path and SHA256. The native adapter resolves and verifies those files before invoking this pure helper.

Actual native loading uses the source module's existing public helpers:

    from model import conservation
    from model.implementation_sources import import_selection

    original_plan = conservation.get_plan(workspace, original_plan_id)
    if original_plan["state"] != "complete":
        raise ValueError("Complete the original conservation portfolio")

    portfolio_path = conservation.verify_file(
        workspace.root, original_plan["files"]["portfolio"]
    )
    selection_path = conservation.verify_file(
        workspace.root, original_plan["files"]["selection"]
    )
    source_document = {
        "schema": "upstate.implementation-conservation-source/v1",
        "portfolio": conservation.read_json(portfolio_path),
        "plan": original_plan,
        "selection": conservation.read_json(selection_path),
    }
    imported = import_selection(
        source_document,
        original_plan_id,
        "conservation_portfolio",
        source_ref=str(portfolio_path),
    )

The original get_plan validates plan identity and saved selection identity. Its caller checks the complete state. verify_file resolves descriptors relative to Workspace.root and verifies the retained original artifacts. The helper itself performs no filesystem access.

The original files.footprint descriptor names the selected_union layer of the GeoPackage and describes the selected reporting-area union. The context envelope preserves that descriptor on each candidate's conservation_context as well as in the whole source snapshot. It also retains pointers to the original model/source bindings and method description. This lets the workbench hand the actual retained footprint to an existing scenario or GIS workflow without constructing a replacement geometry.

Conservation candidates have no native owner, next-step or intervention-method field. Their task proposals leave those operational choices open, carry null duration, and retain original unit type, metric state, eligibility, score and rank. A supplied original cost is exposed as source_planning_estimate with its original numeric value, currency and whole-unit basis. Task, commitment and actual-expense creation stay with the implementation operator.

A raw portable portfolio and a complete native context envelope are distinct retained source editions. Each produces its own deterministic source identity. Repeating either identical form preserves its existing IDs.


## Custom conservation, portfolio and other selections

Supported kind names conservation_selection, portfolio_selection and mapped_selection use an explicit field_mapping. They have no guessed native field aliases. This is useful for existing exports whose schema or revision differs, and for source-native selected-row exports from adjacent work.

The document must be an object. For an export consisting solely of a row array, retain the original artifact reference and wrap that array as a named property before invoking the helper. The wrapper becomes the imported snapshot, so preserve the original artifact separately when its byte identity is needed.

Field paths use RFC 6901 JSON pointers. The rows and source_title pointers are relative to the document; the other pointers are relative to each row. Escape a slash within a field name as ~1 and a literal tilde as ~0. Dot-separated paths and automatic aliases are not supported.

| Mapping key | Required | Contract |
| --- | --- | --- |
| rows | Yes | Pointer to the row array |
| id | Yes | Pointer to a nonempty string or safe integer original ID |
| label | Yes | Pointer to a nonempty string |
| source_title | No | Document pointer to a nonempty source title; otherwise source_id is used |
| selected | Conditional | Object with pointer and nonempty values array; values are explicit JSON scalar values |
| all_rows | Conditional | true explicitly means every mapped row is part of this selection |
| area_ha | No | Pointer to a numeric nonnegative area already expressed in hectares, or null |
| modeled_benefits | No | Pointer to the original per-row array of modeled benefit records |
| method_key | No | Pointer to a source action or method key for method_mapping |
| assignee | No | Pointer to proposed owner/assignee text |
| next_step | No | Pointer to proposed next-step text |

At least one selection mechanism is required: selected_ids, selected, or all_rows: true. selected_ids takes precedence over a mapped filter. selected and all_rows: true cannot be combined. Values match canonical JSON scalar representations, so true, 1 and "1" remain distinct selection values.

The importer copies a mapped benefit array exactly. It does not construct benefit records, convert units, infer direction, total across records, reinterpret scope or substitute physical totals from a parent run. Configure modeled_benefits only when the named field already contains the original modeled records at the selected row's declared spatial and temporal scope. If that structure is absent, omit the mapping; the candidate receives an empty array and retains the complete source row for review.

An omitted area mapping yields no area field. A mapped null area remains unknown and is omitted. A mapped area in acres, an area string with units, or a cost field cannot be silently interpreted as hectares. Preserve or obtain an explicitly converted source-native area field before mapping it.

Here is a concrete mapping example for an explicitly declared custom input contract; the field names are not claims about a current ALLOC or conservation export:

    {
      "rows": "/selected_rows",
      "id": "/candidate_id",
      "label": "/title",
      "source_title": "/title",
      "all_rows": true,
      "area_ha": "/area_ha",
      "modeled_benefits": "/modeled_benefits",
      "method_key": "/action"
    }

For a source with both accepted and rejected rows, an explicit selector could instead be:

    {
      "rows": "/rows",
      "id": "/id",
      "label": "/label",
      "selected": {"pointer": "/selected", "values": [true]}
    }

Numeric IDs are exposed as their ordinary string representation in selected_ids, while original_row_id and row_snapshot preserve their original JSON value. A source containing both numeric 42 and string "42" is rejected as an ambiguous ID set.

A configured pointer that is absent is an error. This protects against silently importing the wrong revision of an export. An unknown mapping key is likewise an error, making misspelled mappings visible.

## Source and candidate identity

The source digest is computed from:

    json.dumps(
        source_without_top_level_downloads,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")

Object key ordering therefore does not change its digest. Array order, values and numeric representations are retained. The digest describes the parsed JSON snapshot; an original PDF, raster, CSV or saved JSON file's byte hash remains whatever the original source export records. The importer does not replace or recompute those upstream file hashes.

The source-link ID hashes a versioned identity containing source kind, caller source ID, whole source digest, supplied source reference and exact field mapping. Candidate IDs hash that link identity with each original row ID. All generated IDs are 64 hexadecimal characters and satisfy the implementation core's portable identifier limits.

Consequences:

1. Repeating the same source import produces the same link and candidate IDs.
2. Adding another selected ID from the same unchanged source preserves the earlier candidate IDs.
3. Changing source content, its source reference, source kind or field interpretation produces a new source edition and new candidate IDs.
4. Changing method_mapping only changes the task proposals; it does not change scientific source identity or candidate IDs.
5. Top-level _downloads changes do not affect retained source identity.
6. Original row snapshots, modeled benefits and area remain suitable for the core's immutable candidate checks.

Keep source_id and source_ref stable for a native original record. Do not use an ever-changing download URL or today's label as a new source reference on each repeat import.

Only the top-level _downloads key is removed. Nested properties are preserved as original data. Each candidate stores a row pointer and a full row snapshot; the source link stores the full document once. This preserves both the selected evidence and its original context through offline exports.

The helper validates finite JSON numbers, safe integers, JSON object keys, source shapes, pointers, distinct IDs and explicit selection. It enforces the same 16 MiB JSON ceiling as the portable implementation core, counting both the original source and the final import envelope. The merged plan still needs the core's full validation, because preexisting plan content also contributes to its size.

## Integrating the native queued operator action

The implementation adapter can load Community plans and verified Conservation portfolio context using their actual source modules. It can:

1. Read the actual source through its existing item lookup, or accept a complete uploaded source document. The current native adapter supplies the original ws.root/community-plans/<id>.json path as source_ref.
2. Call import_selection with the original source ID/reference and explicit options.
3. Merge candidates and source_links by ID, preserving existing equal records.
4. Save through the implementation store with the caller's current base revision and its operation-id protection.
5. Return proposed_task_inputs so the operator can choose methods, owners and durations.

The helper does not own plan revisions or merge conflicts; the existing store performs those operations. Do not overwrite a reused candidate ID with altered source, modeled_benefits or area_ha. Import the changed source edition and retain its distinct identity.

Task proposals contain title, proposed assignee, next_step, evidence_refs, optional method_id, and duration_days: null. The UI should instantiate a chosen method from implementation-method-catalog.json and ask the operator to complete the operational fields. Planning estimates are retained as source_planning_estimate.amount_original decimal strings; the operator creates budget, commitment or actual records when there is a corresponding planning decision or document. No estimate is automatically made into an actual expense.

## Focused integration check

Use one actual saved community plan that has an intervention selected in the existing workspace:

    from copy import deepcopy
    from model.implementation_sources import import_selection

    original = operator.item(workspace, "community_plans", original_plan_id)
    imported = import_selection(
        original, original_plan_id, "community_plan",
        source_ref=original_reference,
    )
    assert imported["candidates"]
    assert all(row["modeled_benefits"] == []
               for row in imported["candidates"])
    assert imported["source_links"][0]["snapshot"]["context"] == original["context"]
    assert "_downloads" not in imported["source_links"][0]["snapshot"]

    changed_view = deepcopy(original)
    changed_view["_downloads"] = {"temporary": "another-presentation-value"}
    repeated = import_selection(
        changed_view, original_plan_id, "community_plans",
        source_ref=original_reference,
    )
    assert repeated == imported

Merge this result into a working implementation plan and save one revision using the native store. A subsequent offline export/import round trip should preserve the candidates and their source link. This checks the real integration seam and source-preservation behavior without adding a large implementation-mirroring test suite.

## Related operating package

The full implementation method catalog, field forms, operating guide, canonical data contract and empty plan are retained in:

https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C88DDUUFR

This importer extends that package by connecting native source selections to the implementation workbench.
