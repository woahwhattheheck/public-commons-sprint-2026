# Independent comparison domain and original Workspace receiving

Operation: ECO-INDEPENDENT-COMPARISON-B3909-20261013. Additive WO-28 component in the original Upper Savannah application.

## Ordinary operation

Open the original authenticated operator, select a saved native observation-comparison, and select an original reference CSV from that Workspace's retained source inventory. The selected run must already be complete. This component verifies its original export/stream/argument custody; it never runs a model or performs a new raster aggregation.

Inspect the original table columns and rows. Map the source's record, catchment/reach, constituent, value, unit, period, qualifier, method, uncertainty and source-record fields. A mapped original column wins even when the value is blank. Defaults apply only when no original column is selected. Exact parameter labels can be explicitly mapped to nitrogen, phosphorus or sediment; the original label remains visible.

Declare the evidence kind separately from physical support, quantity, fraction, temporal basis, source period, spatial basis, method and shared-reference lineage. Select original pairs and explain quantity, fraction, spatial and temporal compatibility. All original rows remain available, including unpaired rows, source exclusions and context. Matching labels or annual units alone do not establish comparable support.

Preview preserves the analyst's requested decision and the actual resulting decision. Known support, fraction, qualifier, value, period and unit problems keep a pair context-only. Context-only pairs are useful saved results and do not block the remainder of the comparison. No TSS/SSC transformation, concentration-to-load conversion, point-source adjustment, native rerun or calibration is performed.

Save with a title, author, attributed interpretation and notes. A revised selection names parent_id; both original and successor remain immutable and selectable. Different successors are retained branches, not overwritten histories. Repeating the same complete selection reopens its exact original result.

## Exact domain contract

Exports in model/independent_comparison.py:

- catalog(workspace) returns schema, project_id, native_comparisons, reference_sources, reference_catalog and editions.
- inputs(workspace, selection) accepts native_comparison_id and reference source selector. Returns full native_comparison, native_rows, reference.columns/reference.rows, original_run/profile/grid/observations, catchment_entry/native_files, input_sha256 and producers.
- preview(workspace, complete_selection) returns the complete direct result; no wrapper and no writes.
- build(workspace, complete_selection) returns the complete immutable edition.
- inspect(workspace, id) returns {edition,data,inputs}; it verifies every original file, result identity and retained Study source.
- overview(workspace) returns all saved summaries; verify_all(workspace) verifies each full saved edition.
- analyze(inputs, selection) is the pure numerical function; callers use inputs from the original Workspace.

Native catalog entries are {id,run_id,observation_id,title,rows,parameters,model_period}. Reference entries are {source_collection_id,source_id,source_sha256,bytes,title,uri,vintage,kind}. Catalog table presence is not a scientific eligibility claim or proof it is CSV.

Selection schema: upstate.independent-comparison-selection/v1.

Required keys:
schema,title,author,interpretation,notes,parent_id,native_comparison_id,reference,input_sha256,producers,pairs.

Reference:
{source_collection_id,source_id,source_sha256,format:"csv",columns:{...},defaults:{...},parameter_map:{original_label:"nitrogen"|"phosphorus"|"sediment"},definition:{evidence_kind,quantity,source_support,fraction,temporal_basis,spatial_basis,method,source_period,lineage,reference_ids:[]}}.

Columns/default keys:
record_id,catchment_id,parameter,value,unit,period_start,period_end,qualifier,method,uncertainty,source_records,parameter_code,species,source_constituent.

Evidence kind:
field_load_estimate,external_model_estimate,reported_effluent,concentration,other.

Source support:
landscape_to_stream,station_catchment_load,reach_incremental,reach_accumulated,point_source_discharge,concentration,other.

Comparable annual reference definitions use quantity annual_mass_rate and the actual matching total_nitrogen, total_phosphorus or total_sediment fraction. These are explicit scientific declarations, not labels inferred by this engine. A different original definition remains as context. Native NDR/SDR support stays landscape_to_stream. Explicit retained analytical codes come from the unchanged observation_support.reference_basis helper.

Pair:
{id,native_observation_id,reference_row_number,decision:"comparable"|"context-only",assessment:{quantity:"same"|"different"|"unknown",fraction:...,space:...,time:...},rationale}.
Reference data rows are numbered from1; original CSV text is retained separately. Pair IDs and exact original pair selections are unique.

Result pair:
{id,native_observation_id,reference_row_number,native,reference,requested_decision,decision,assessment,rationale,issues,notes,conversion,converted_reference_value,difference,relative_difference,relative_difference_reason,units}.
Original native and reference records remain complete. Difference is native minus converted reference; relative difference is a ratio, not an already multiplied percentage. Zero reference has no relative difference. Descriptive statistics group by constituent/unit and retain the exact pair IDs, repeated native support and repeated reference rows. They do not claim independent validation.

## Saved outputs and original Study integration

Each complete edition retains selection.json, inputs.json, comparison.json, original-files.json, pairs.csv, report.html, original source table and companions, original catchment source and companions, original observation input and selected original native export/stream/argument files. It also retains the exact installed domain, original helper sources, methods guide and reference catalog. The comparison ZIP contains every retained member once. It is a complete comparison record; the original Workspace backup remains the complete executable scientific project.

The original Workspace.import_sources receives model-sources.json. The result is an ordinary observed_context source with full report sections and complete members, selectable through the original Study source/report routes. No second source database or scheduler is introduced. Existing portable Workspace backup carries the complete comparison directory and original source objects; the original receiver adds verify_all to its scientific receiving hook.

An interrupted build keeps its original immutable directory/build plan; same selection resumes original source registration. A complete receipt reopens exact old files without recomputing them under later implementation code. New selections require freshly matching input_sha256 and producers from the current inputs response.

## Focused receiving

Use the existing original native Workspace and saved observation-comparison. Select an actual retained external source table/dictionary and verify its source mapping. Exercise a comparable explicitly matched source when scientific support permits, a context-only external-model/outlet pair, qualified or zero values, complete report/source download, same-selection replay, attributed successor and original Study export/reopen. Preserve actual scientific sources and native IDs. Engineering examples used to check arithmetic must stay labeled examples and cannot replace the original-source receiving course.

No exact outgoing application/report/archive is claimed visually ready from source checks. The original equipped receiver must open and operate the assembled desktop/narrow product, view actual screenshots, open every delivered report and archive, and reopen the original Study, applying the complete rule below.

## Current direction

Read the complete current AGENTS.md and CURRENT_OWNER_DIRECTION.md v2026-10-13.4. The later ECO-POSTCALL-20261013 owner work orders in F0C8R2SQ0NP release the browser and supersede the historical cutoff. Continue original teaching12/regional12/38F0 scientific identities, native queues and current owners. Do not send Tim anything externally, start another cloud session, publish private customer inputs, use private GitHub or Actions, or change native model behavior in this component.


<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->
