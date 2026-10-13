# Utility sources to a report review and editable follow-up

The Regional watershed desk exports the actual saved source selection as a complete report and an offline meeting briefing. The briefing starts from the original watershed brief, retains its table values and interpretations, and adds exact microbial and regional nutrient method groups from the retained observed source. Its report kind is explicitly source context.

## Operate the complete journey

1. Open Regional watersheds and the retained regional report. Choose ARJWS or Pioneer, or select the original HUC12 rows for the intended source footprint.
2. Export the selection. The export retains selected-watersheds.json/CSV, the original watershed brief, original utility profile where selected, and complete installed observation companions. Four additional files are created: source-context-report.html, source-context-report-model.json, source-context-report-briefing.html and source-context-report-briefing.json.
3. Download utility-watershed-packet.zip and extract it. Open source-context-report-briefing.html. Choose Agenda or All sections, present the original tables, and open the complete report or source files at their retained relative paths.
4. Record the actual meeting or internal review in Meeting notes. Each question, decision and action keeps its original report page. Enter the actual owner, deadline and status; export the meeting JSON.
5. Open Implementation & fieldwork → Source selections → Receive briefing follow-up. Choose the saved utility source briefing from Saved report or utility source briefing and upload the original meeting file. An exported delivery can instead use its original source-context-report-model.json plus source-context-report-briefing.json.
6. Preview the selected follow-up against the saved plan revision. Actions are selected initially; choose questions or decisions only when they should become work. Receive reviewed follow-up retains the original report/index/notes and creates or updates the editable tasks in one revision.
7. Continue actual durations, dependencies, work methods and costs in Work plan. Generate the native HTML/CSV report, then use Transfer and restore to reopen the same revision and its original attachments.

For Tim: “We can review the actual source footprint and measurements, record what your team wants to do, and carry those actions into the working project with the exact source page attached.”

## Source scopes and scientific meaning

The installed original utility source has a 217-HUC model-domain selection from 303 retained USGS network records. ARJWS uses four whole HUC12s; Pioneer uses 32. The saved original profile and selected membership define each individual report. These utility source footprints retain their upstream and cross-state context.

NRCS Ground, Surface and Both remain original programme designations. Designated state-HUC acreage, whole-watershed acreage and upstream contributing summaries keep separate labels. Selected SCDES records retain the published jurisdiction and query coverage. An absence outside source jurisdiction does not become a measured absence.

The installed microbial edition has 142 ARJWS records and 588 Pioneer records. The briefing preserves the exact station/year/method/activity/unit groups: 15 and 70 respectively. Numeric minimum, median and maximum use only each group's explicitly counted measured subset. Detection states, limits, missing data, Information Only comments and field replicates remain visible. The complete source selection retains every original row reference and the separate view excluding Information Only records.

The 589 regional nutrient records form 19 original station/characteristic/fraction/method/unit groups. They remain regional stream context with their original geographical relationships; they are not silently reassigned to either utility. The same source keeps original daily-flow coverage, sampling dates and high-flow sampling gaps. Concentrations and samples retain their original units and temporal meaning. Annual NDR/SDR land-origin delivery quantities belong to a separate modeled report.

These published counts describe the installed retained edition. Later source editions are read from their own verified selections; the report builder does not hard-code these totals.

## Exact source and edition binding

Source reports use upstate.source-context-report/v1. source_binding retains the original selected-watersheds.json byte count/SHA256, its canonical content identity, context/export IDs, utility ID and original ordered HUC12 selection. The complete source_selection and source_markdown are retained inside the report model.

The original client-briefing renderer accepts this explicit source kind and retains the report's complete original-byte digest. Source pages describe the source footprint and do not assign a modeled baseline, scenario count, native grid or modeled profile. Existing upstate.client-report/v1 binding and default digest behavior remain compatible.

The original watershed brief is converted to ordered presentation sections. Original paragraph/table ordering and all displayed cells remain unchanged. The source report adds the exact method-group tables from source_selection.observed_context. Complete original files remain beside the report in the ordinary offline ZIP.

A presentation edition participates in the watershed export identity. Older saved export files and their hashes remain intact; a new export contains the new briefing. A report's saved historical page index is used during follow-up receiving, so later renderer changes cannot silently renumber an earlier meeting entry.

## Native operating course

The existing original-source receiver now creates both complete source briefings using ordinary Python:

    python -B source_tools/receive_utility_source_context.py \
      --out ACTUAL_EXISTING_OPERATION/utility-receiving

It uses the installed original source/input manifests, retains every native original and returns the actual new receiving.json, utility directories and all report/index/packet descriptors. Its implementation inventory includes the briefing adapter and renderer.

For an actual saved source export and actual meeting notes:

    python -B source_tools/receive_briefing_followup.py \
      --workspace ACTUAL_WORKSPACE \
      --plan-id ACTUAL_PLAN_ID --revision ACTUAL_REVISION \
      --source-export-id ACTUAL_SOURCE_EXPORT_ID \
      --notes ORIGINAL_MEETING_NOTES.json \
      --output NEW_PREVIEW.json

Add --apply after selecting actual work; repeated --entry ORIGINAL_ENTRY_ID selects an explicit subset. For exported source files use --report-model and --briefing-index instead of --source-export-id. The importer preserves local edits, task deletion and exact repeat/retry semantics as described in BRIEFING_FOLLOWUP.md.

Carry the resulting saved plan through the maintained native report/transfer/independent-reopen course:

    python -B source_tools/receive_implementation.py \
      --workspace ACTUAL_WORKSPACE \
      --plan-id ACTUAL_PLAN_ID --revision ACTUAL_RECEIVED_REVISION \
      --operation ACTUAL_EXISTING_OPERATION/briefing-fieldwork-receiving

The operation output belongs outside the Workspace and application. The original report and actual notes remain the source of the tasks throughout this journey.
