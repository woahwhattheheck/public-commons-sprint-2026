# Retained scenario analysis in the original GIS delivery

This addition connects a completed fixed-scale scenario analysis to the existing
seven-family native scientific delivery. It uses the original operator form,
original delivery builder, original receiving-water engine and original report
formatter. It reads retained analysis results and copies their verified GIS
assets; it does not execute or approximate InVEST.

## Installed source

- model/scenario_analysis_delivery.py: original cohort binding, exact copied
  assets, readable append-only report sections and package-asset registration.
- operator/scenario_analysis_delivery_operator.py: authenticated read adapter.
- operator/extensions/scenario-analysis-delivery.json: additive GET route and
  module asset registration; no new queued calculation or competing view.
- operator/web/scenario_analysis_delivery.mjs: delivery continuation controller.
- operator/web/scenario_analysis.mjs: complete successor of the retained-result
  desk, adding the GIS delivery tab and original prepared-plan navigation.
- This guide.

The scenario analysis numerical engine, existing analysis backend, bridge and
stylesheet remain the current retained-result/observed-version edition. Receive
that edition first: the predecessor desk is 72,333 UTF-8 bytes, SHA-256
e5efeac861209004df85a4efab571407b9d2978647f4fa4199e0696a424fe6ca.
The new desk imports scenario_analysis_delivery.mjs; install its descriptor and
static asset before opening that desk.

The shared root integration owns changes to operator/web/app.mjs and
model/delivery.py. Compose the exact hooks below into the latest source; retain
its S1 source_report_id binding, receiving_water_delivery hooks, scientific
report formatting, source metadata, map captions, archives and current draft
guards. No other delivery builder should replace it.

## Actual operator journey

1. Prepare original published source areas in the actual regional Workspace.
   Retain the original collection, plan, source/receptor IDs and typed filters.
2. Complete the geographically overlapping regional native model cohort and
   retain its original fixed-scale analysis. The South Carolina polygons must
   intersect that baseline's reporting grid. Gura retains its own geography.
3. Open Scenario analysis, select the completed analysis, then GIS delivery.
   The authenticated continuation inspects its exact original native cohort.
   A full original delivery needs nitrogen, phosphorus and sediment from the
   baseline and at least one same-grid, same-profile land-cover alternative.
   Baseline-only, selected-model and parameter-sensitivity analyses remain
   usable in their analysis views; the continuation lists the exact remaining
   cohort choices before the seven-family release can be created.
4. Optionally choose a verified prepared receiving-water plan. The chooser
   compares each original receptor's source edition, layer, typed filter,
   family and published-source-area relationship with the retained analysis.
   Edited preparation selectors or added buffers are shown as issues instead
   of being silently reused.
5. Continue to the original delivery form. Its existing source-role, overlay,
   contact, layout and map-priority choices remain in that form. Saved original
   caps and selected weights seed map settings; zero caps and zero weights
   remain actual zeros. Operators may choose different map settings while the
   attached analysis preserves its own original settings and support.
6. The existing delivery.build operation copies the original analysis JSON,
   every declared original raster, CSV and GeoPackage, a source-area inventory,
   a reimportable source-area selection and an exact delivery-binding JSON.
   These are registered as original GIS project assets and original downloads.
7. Reopen the analysis's GIS delivery tab and refresh to see original linked
   release statuses; open the selected release through openItem('deliveries',id).

Selecting a prepared plan means selecting its full original receptor collection.
The chooser explicitly names additional plan receptors not represented by the
saved analysis zones. Native receiving-water family unions count overlapping
land once. The attached analysis keeps each overlapping source area's independent
physical quantities. Neither adapter adds those area totals into a family mass
balance. A prepared plan and a receptor-network product are distinct namespaces.

## Selection and authenticated read contract

GET /api/scenario-analysis-delivery/selection?workspace=KEY&analysis_id=ID

Backend entry point:

    read(operator, workspace_key, operation, payload)

The descriptor sets operation='selection'. It returns:

    {
      schema: "upstate.scenario-analysis-delivery/v1",
      workspace_key: KEY,
      source_analysis: {
        analysis_id, analysis_sha256, analysis_bytes, analysis_title,
        project_id, baseline_run_id, scenario_run_ids, grid_id, profile_id,
        pollutants, normalization, coverage, native_version, input_binding,
        areas, source_area_origins, source_plan_ids, source_files, interpretation
      },
      selection: {
        source_scenario_analysis_id: ID,
        source_scenario_analysis_sha256: SHA,
        baseline_run_id,
        scenario_run_ids: [exact ordered original alternatives],
        title,
        map_settings: {caps: original saved caps, weights: selected saved weights}
      },
      ready, cases, issues,
      prepared_plans: [{
        id, title, record_sha256, matched_receptor_ids, additional_receptor_ids,
        receptor_count, scope,
        selection: {plan_id: ID, quantity_scope: "reporting"}
      }],
      prepared_plan_issues,
      releases: [{id,title,state,created_at,completed_at}],
      release_issues, remaining_choices
    }

The client caches by current workspace and analysis ID. The explicit continuation
refreshes this read before opening the form, checks the original workspace again
after the asynchronous read, and validates the selected prepared-plan option
against that fresh result.

Original source analysis identity is independent of S1's source_report_id and
source_report_sha256. Either or both may be present if each original binding
accepts the exact selected cohort.

## Required original application hooks

The existing shared extension host passes all original capabilities through.
Add these capabilities to its host context:

    openDelivery: selection => deliveryForm(undefined, selection),
    openReceivingPlan: id => receivingWaters.openPlan(id)

The current original receiving-water controller already supports both callbacks;
complete its constructor context:

    const receivingWaters = attachReceivingWaters({
      ...currentOriginalCallbacks,
      navigate,
      openDelivery: selection => deliveryForm(undefined, selection)
    });

Its public openPlan(id) and openAnalysis(id) read the original receiving-water
namespace and navigate to the existing receiving-waters view. Do not route a
receiving-water plan ID to the distinct source-water receptor-network desk.

The current original deliveryForm(id,initialSelection) uses
saved?.selection || initialSelection. Preserve these original selection fields
when reconstructing submission:

- source_report_id and source_report_sha256, where present.
- source_scenario_analysis_id and source_scenario_analysis_sha256, where present.
- Additional original source-role/overlay selector metadata and other actual
  original supported delivery choices.
- An explicitly selected receiving_waters.plan_id with quantity_scope:'reporting'
  when it has not been replaced or explicitly detached in the original form.

Display the attached analysis title/ID and exact native cohort. When attached,
keep its original baseline and ordered alternatives; the backend enforces this
binding as well. Provide an explicit independent-delivery action if the operator
wants another cohort, clearing only this analysis attachment's two identity
fields rather than silently retaining stale metadata. Respect the existing
workspace draft guard and verify the workspace after any asynchronous reads.

The current receivingWaters.deliveryFields()/deliverySelection() represents
completed receiving-water analysis IDs. A new prepared-plan seed is not one of
those analysis IDs: the root form must explicitly retain/show the selected plan,
or provide a deliberate replace/detach choice. A blank completed-analysis select
alone must not erase the original prepared-plan seed.

## Required original model hooks

Keep the exact existing S1 and native receiving-water calls. Add:

    from . import scenario_analysis_delivery as analysis_delivery

Before computing delivery identity:

    analysis_link = analysis_delivery.bind_analysis(workspace, selection)
    if analysis_link is not None:
        selection["source_scenario_analysis_sha256"] = analysis_link["analysis_sha256"]

bind_analysis returns None for ordinary independent deliveries. For an attached
analysis it verifies every declared original output, the original saved record
hash, exact ordered cohort, complete model outputs, common grid/profile,
land-cover alternatives, native raster SHA/bytes/units, original run selection
and saved native execution provenance. It preserves the actual observed version;
older requested-only runs retain their explicit legacy provenance.

Inside the original retained build try block, before report assembly:

    analysis_product = analysis_delivery.retain_analysis(
        workspace, directory, state, analysis_link)

This is safe for None and repeated original operation resume. It sets
state['source_scenario_analysis'] and files with prefix scenario_analysis_.
Original verified file transfer uses the maintained copy_verified implementation.
Companion inventory/selection/binding files use immutable writes.

When assembling report sections:

    sections.extend(analysis_delivery.report_sections(analysis_product))

These are the original formatter's (heading, blocks) sections. Table blocks use
kind='table', columns, rows, widths, caption. All quantities and scores are read
directly from the retained analysis. They include original execution provenance,
each source-area's exact lineage and typed predicate, baseline/alternative mass,
signed annual change, actual common cells/area, fixed-scale planning values and
weight sensitivity. NoData remains Unavailable and zero remains zero. There is
no source-area aggregation. Native family-union sections remain supplied by
receiving_water_delivery/scientific_report.

Place this before the original scientific formatter refines/prints sections so
its PDF, offline HTML and structured report companions share the same blocks.
That formatter preserves independently appended headings.

Before writing the original delivery manifest:

    analysis_delivery.extend_assets(manifest, state)

This adds a compact binding reference plus every scenario_analysis_ file to
project_assets once. The manifest reference retains the original analysis ID,
SHA-256/bytes/title, grid, baseline and ordered alternatives, source-area count,
original plan IDs and binding_artifact descriptor. Full area definitions, original
source metadata, native input bindings, coverage and fixed-scale provenance stay
in the immutable delivery-binding.json and original analysis.json assets. This
avoids repeating the potentially large provenance object inside the manifest.
The existing original package builder and archive then carry the actual assets;
the existing workspace backup already retains the original immutable analysis.

## Verification and receiving

The new client and full successor desk parsed in the actual V8 execution runtime.
One focused actual-client journey exercised the authenticated selection response,
explicit full prepared-plan choice, original seeded delivery callback, original
plan/release namespaces and asynchronous workspace switch. It preserved the
analysis hash, native order, zero cap, zero weight and untouched retained payload.
The fake API supplied native-shaped records solely for this interface check.

The native receiving host should compile the two new Python modules, receive
the shared root integration, and exercise one real completed regional analysis:

    python -B -m py_compile model/scenario_analysis_delivery.py \
      operator/scenario_analysis_delivery_operator.py
    python -B -c 'from model.workspace import Workspace; from model.scenario_analysis_delivery import describe; import json; print(json.dumps(describe(Workspace("ACTUAL_WORKSPACE"), "ACTUAL_ANALYSIS_ID"), indent=2))'

Then use its original operator form or original delivery-build command with the
actual sources/contact selection. Inspect the resulting original delivery state,
scientific report and project_assets; reopen/download the declared original
analysis members and prepared plan. Native execution belongs to the existing
regional receiving lane. The source bank contains no regional result IDs or
substitute native quantities.

The formatter indexes physical, selected-priority and sensitivity rows by area
once, preserving full content while avoiding repeated full-table scans per area.
The new authenticated read carries provenance and descriptors rather than full
physical arrays. Full native quantities remain in the original retained analysis
and copied assets.
