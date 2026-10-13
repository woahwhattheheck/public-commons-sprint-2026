# Saved Conservation portfolios in Scientific Reports

This producer brings an existing completed Conservation portfolio into the application's existing Scientific Reports composer. It retains the original study, selected unit IDs, union results, decision rules, full decision packet and original planning sources. The composer supplies the existing preview, PDF, HTML and portable report delivery. Preparing a report source reads retained results; it does not run a native scientific model or save another portfolio.

## Use the operator

Open **Conservation**, then an existing saved portfolio. Choose **Prepare scientific report**. The ordinary queued task retains and imports its source document. When it completes, choose **Compose scientific report**. The same source remains in **Scientific report sources** when the portfolio or all-records view is reopened.

**Source and original files** opens the verified source receipt and downloads. The original-plan control returns to the same saved portfolio. The existing composer can combine this source with other retained scientific sources in the chosen order, set its report title, generate the existing PDF and HTML, and retain the report and companions in the original Workspace.

The source title defaults to the saved portfolio title. The report source's exact source_collection_id and source_id are passed to the composer; a browser does not infer another catalogue key or import another copy.

## Native entrypoint

From the installed application root:

~~~sh
/opt/pyvenv/bin/python -m model.conservation_report_source_cli \
  --workspace /ABSOLUTE/EXISTING/WORKSPACE \
  prepare --plan-id ORIGINAL_64_HEX_PLAN_ID

/opt/pyvenv/bin/python -m model.conservation_report_source_cli \
  --workspace /ABSOLUTE/EXISTING/WORKSPACE \
  inspect --id RETURNED_64_HEX_REPORT_SOURCE_ID

/opt/pyvenv/bin/python -m model.conservation_report_source_cli \
  --workspace /ABSOLUTE/EXISTING/WORKSPACE \
  list --plan-id ORIGINAL_64_HEX_PLAN_ID
~~~

The original equipped regional course uses /mnt/data/eco-cohort-resume/received/application and /mnt/data/eco-cohort-resume/received/workspace. Its independent reopened project is under /mnt/data/eco-cohort-resume/regional-complete-reopened. Its completed protection study is 2b0e6ae0c186dedceceb10a189cfddae2d893e58d0f07b89b0223aeb19d6ec13 and saved plan is 51de867031a4365cab5090693cc4d534399225c31a3f0731368431ee2b77cc8a. Those are actual retained inputs for continuing this operation, not defaults for other workspaces.

The completed regional plan uses 12 of the original 217 watershed units and the exact four original published source-water polygons. Its retained vector source-water overlap is 15,189.437123 hectares. The full selected reporting footprint and source-water overlap are separate report rows; the native geographic binary-grid area remains a separate result from the vector intersection. This is a source-context plan, with unbound nitrogen, phosphorus and sediment values. Those values stay unavailable in the report.

## Model interface

model.conservation_report_source.prepare(workspace, spec) accepts:

~~~json
{"plan_id":"ORIGINAL_64_HEX_PLAN_ID","title":"Optional report source title"}
~~~

The completed receipt has schema upstate.conservation-report-source/v1 and edition conservation-saved-plan-report/1. It returns id, state, plan_id, study_id, title, source, files, packet and created_at. Its source is exactly {source_collection_id, source_id}, naming the actual imported document. Its files.recipe, files.manifest and files.source_bundle are original Workspace-relative descriptors with path, bytes and sha256. The receipt additionally retains its full immutable selection, every source companion descriptor and the observed-context binding.

get(workspace, report_source_id) verifies and reopens that same receipt, its recipe, manifest, source ZIP and every companion. It verifies the actual imported source document and exact companion membership, then checks the existing observed_context.bind result against the saved binding.

list_sources(workspace, plan_id=None) returns completed metadata rows with id, study_id, plan_id, title, state, source, created_at and files. It checks receipt identity without hashing large source bodies during ordinary overview polling. Explicit source opening uses get.

The browser calls the existing ingress:

~~~javascript
host.openScientificReport({
  workspace_key: originalWorkspaceKey,
  sources: [result.source],
  title: result.title
});
~~~

The original provider handles conservation.report.source.prepare and the passive report-source read. Existing queue identity, interruption/resume and verified download tickets remain the operator's responsibility.

## Retained content

The imported document uses the maintained upstate.observed-report/v1 schema and OBSERVED_CONTEXT role. Its sections carry:

- Original plan, study, purpose, planning-unit type, analysis CRS and packet identity.
- The actual selected reporting union and full original-unit union, overlap, declared source-water/protection/designation relations and supplied-cost coverage.
- Original ordering, limits, eligibility rules, scoring choices and normalization.
- Every selected original unit, with its area, geographic overlap, score and supplied cost; the complete candidate inventory remains attached.
- Separate nitrogen, phosphorus and sediment quantities, availability and support. Each alternative's own total remains separate from its common-support baseline/alternative values and paired difference.
- The original producing-model execution version, provenance basis, requested version and completed-stage time; full runtime/reuse records remain in the attached study snapshot.
- Exact original planning and criterion source editions, body hashes, complete source bodies and all declared companions.

The document's inputs list binds every companion by source-relative path, byte count and SHA-256. The native importer retains these members through the original Workspace.import_sources contract. Original native raster references remain in the study/packet; model recomputation uses the complete original Workspace. This report-source delivery carries its retained reporting inputs and does not duplicate all native raster inputs.

The original existing decision-packet.zip remains a complete companion. It includes editable geodata, the full selected portfolio, all candidate rows, the current decision presentation, published criterion details and source register. The new source ZIP contains sources.json, conservation-report.json and every companion, preserving each original source's relative sidecar layout under its own collection/source namespace.

Receiving that ZIP means extracting its exact members into a native folder and calling the existing Workspace.import_sources with its sources.json; source paths and hashes are unchanged. The imported choice can immediately open in the existing Scientific Reports composer. A full Workspace backup also carries the source receipt, original plan/study and imported objects for independent reopening.

## Identity and interruption

The report-source identity includes the original project, plan and study IDs, exact plan/study files, complete existing packet identity, original planning-source entries, execution metadata, title and producer source hash. Titles or source/presentation editions produce separate report sources. A repeated identical request returns the existing verified receipt.

Files are copied through the maintained independent verified reuse helper. Large ZIP members stream to disk. The complete source ZIP has stable member names and fixed ZIP timestamps. Source construction uses a per-operation lock; original source import follows the Workspace's own immutable collection protocol. A partial preparation can continue using the same deterministic identity and already-retained files. The completed receipt is written last.

Earlier saved plans remain unchanged. Some historical source-context plans retain a generic modeled-case wording field; the report derives its explanatory scope from the study's actual mode and keeps source-context quantities unavailable. New scientific report sources never treat that wording as evidence of a modeled run.

## Scientific interpretation

Area is the actual saved vector union/intersection in the declared analysis CRS. A source-water overlap area is not the whole selected portfolio footprint. Published protection polygons, geographic watershed focus and modeled hydrologic connectivity remain distinct relations.

A supplied budget is evaluated on its original whole-unit costs and explicit footprint basis. Unknown costs remain unknown and the known subtotal is shown separately. The report does not turn missing costs, unavailable model outputs or unknown criterion values into zero.

For native-model studies, retained N/P/sediment outputs keep their original units and producing-model version. A paired difference uses common support. A selected-footprint contribution from a complete scenario does not establish the isolated effect of changing only those selected units; creating and executing that actual footprint scenario remains the existing scenario workflow.

## Receiving checks for the same original operation

On the actual equipped Workspace, prepare the completed original plan once, inspect the returned report source, then call the existing observed_report_render.prepare(workspace, [result["source"]], title=result["title"]) and its maintained render entrypoint. Verify its original source choice, complete HTML/PDF and copied companions. Reopen the original Workspace and the report-source receipt; IDs, selected units and original source hashes must match.

Use the existing native scientific-report/archive receiving course for the resulting report. Source-context receiving requires no NDR/SDR execution. Native-model reports consume the already-completed original runs and paired quantities. The current browser course remains attached to the same original plan and Workspace.
