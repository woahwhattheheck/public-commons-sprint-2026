# Receive original utility reports and Monitoring in one native course

The receiver carries the original source collection through the same Regional watersheds provider used by the operator, then prepares the exact utility Monitoring networks and reopens their saved products in a fresh Workspace reader.

## Run the complete source-to-network course

Use the existing scientific Workspace and its GIS environment. Keep the application checkout fixed for the duration of each course.

~~~sh
python -B source_tools/receive_utility_monitoring.py \
  --workspace /absolute/existing/scientific-workspace \
  --operation /absolute/existing-operation/utility-monitoring
~~~

The operation directory must be outside both the application and the Workspace. The default receives ARJWS and PRWD/Pioneer. Repeat --utility ARJWS or --utility PRWD to select one. The original sampled station locations are included; --without-microbial creates an explicitly station-free edition.

The Workspace must contain the original 217-HUC polygon source. If its original upstate.sources/v1 manifest is available but not imported, supply --domain-manifest /absolute/original-domain/sources.json. Selection still verifies the original decoded geometry SHA256; this option does not substitute a different domain.

The course uses source/water_context/20261013/complete-native-sources.json by default. It verifies and imports that complete original source edition, including its 303-record native topology and original companions. --context-directory and --source-manifest can identify an existing complete retained edition on the receiving host.

## What completes

1. Import the verified complete source edition into the existing Workspace.
2. Invoke the current Regional watersheds analysis provider and save its original regional report.
3. Select each original available utility profile and invoke the same saved-export provider used by the browser.
4. Prepare the native whole-HUC receiving-water footprint, original datum-aware station view and Monitoring network.
5. Retain the complete source report ZIP, selected watershed JSON, original utility profile and preparation method in the external receiving directory.
6. Open a fresh Workspace reader and verify the regional report, every original report file, utility export, receiving plan, native network, full domain membership and utility candidate membership.

The output receiving.json gives actual saved report, source collection, utility export, receiving plan, Monitoring bridge and network IDs, with original HUC lists, station-assignment issues, scientific scope and reopened identities. state.json exposes the current phase and first exception. It identifies an actual execution only after this native command runs.

The Regional watersheds desk lists the saved report and exports. The existing Monitoring desk can open the returned network ID directly. Its original design/campaign controls retain the exact prepared geography.

## Supply an actual programme when ready

--programme /absolute/actual-programme.json additionally solves the supplied native design and creates an editable campaign when its result is feasible. The receiver supplies no budget, calendar dates, setup/visit costs, station credit or upstream representativeness assumption.

The file has this structure; configuration is the complete original Monitoring configuration from the reviewed programme:

~~~json
{
  "schema": "upstate.utility-monitoring-programme/v1",
  "title": "Actual reviewed utility programme",
  "utilities": {
    "ARJWS": {
      "title": "Actual ARJWS programme title",
      "configuration": {}
    }
  }
}
~~~

Replace the empty configuration object with the real native configuration before execution. The original solver requires a complete calendar and budget; its ordinary cost and design validation remains authoritative. Include PRWD with its own title/configuration for a second selected programme. A programme may name only utilities selected by this receiving command.

The receiver retains the exact original programme bytes and both supplied/effective configurations. It unions the prepared context-HUC exclusions into the effective excluded_ids, preserving any additional original exclusions. This keeps candidate selection inside the selected utility footprint while the full original graph remains available. Required IDs, station choices, costs, calendars, strata and other native constraints are passed unchanged and validated by the existing solver.

The actual native solver result is retained with its original status and diagnostics. A feasible/optimal result creates its campaign with a deterministic original operation identity. Infeasible or time-limited results retain their real status. A resume reuses an already saved result for the exact original decision, including one saved immediately before a process stopped writing its course checkpoint.

The returned design records include the original plan ID, selected IDs, status, original/effective configuration and, when created, exact campaign/revision IDs. No field event or sample is generated.

## Continue that saved campaign through fieldwork

The maintained native fieldwork course takes the actual IDs returned above:

~~~sh
python -B source_tools/receive_monitoring_fieldwork.py \
  --workspace /absolute/existing/scientific-workspace \
  --operation /absolute/existing-operation/utility-fieldwork \
  --campaign-id ACTUAL_CAMPAIGN_ID \
  --revision-id ACTUAL_REVISION_ID
~~~

It receives the original campaign into Implementation, retains the field report and original packet, transfers the complete application/Workspace and verifies the exact revision after fresh receiving. Keep separate operation directories for distinct utility campaigns. Actual field events, meeting notes, station commitments and sample results remain recorded through their existing native controls.

The utility source briefing remains in its original saved export and complete ZIP. The source-report → actual Meeting notes → Implementation path is documented in docs/UTILITY_SOURCE_BRIEFING.md. It can support the same utility work alongside the Monitoring campaign.

## Scope and interpretation

ARJWS retains its four original whole HUC12s. PRWD/Pioneer retains its 32 original whole HUC12s, including their cross-state context. The saved source report uses the original 303-record topology; the native Monitoring network retains the complete 217-polygon graph. Differences are present in the preparation method and must inform outlet-context interpretation.

Monitoring target weight is EPSG:5070 vector overlap hectares with the selected whole-HUC footprint. Original NRCS designation areas, sampled microbial concentrations, regional nutrient/flow observations and native annual pollutant masses keep their distinct source meanings.

The historical five/31 station assignments come from original utility-source membership. Native polygon assignment and any outside-domain/boundary issues remain visible. Historical presence alone grants no existing-programme credit. The 589 regional nutrient records retain their original regional scope.

## Resume and source preservation

selection.json binds the original Workspace, exact original domain source edition, selected utilities, exact original source manifest/input hashes, exact programme bytes and all composing source files. Resume the same path with the same pinned implementation and inputs. The retained domain choice is reopened explicitly, so an unrelated imported edition cannot change automatic source selection during resume. Use a new operation directory for a deliberately changed source or programme edition.

Native report/export/preparation records remain owned by their existing maintained engines. The receiver's external state records coordinate those products; they do not replace them. A fresh read verifies original source files before completion. Errors are retained with their actual type/message, then raised to the native caller.

The complete source-to-network course reads existing originals and executes native vector/network preparation. It does not download another source family or run InVEST.
