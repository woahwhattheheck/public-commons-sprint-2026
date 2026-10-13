# Complete jurisdiction assessment reports and selected Study receiving

This course continues the **existing North Carolina and Georgia assessment receiving operations** into one saved, ordered scientific report, its original report-file ZIP, and an independently reopened selected Study. It uses the ordinary Scientific Reports publisher and Study transfer implementation. It keeps the current assessment normalizers, native geometry join, source registry and receiving project.

## Required source and application

Use the complete current application, including the `nc-ga-original-assessment-source`, `scientific-report-editions` and `study-transfer` components. The assessment report continuation is selected by `integration/component_fragments/assessment-report-receiving.json`. A file-only overlay without these component dependencies cannot run the full receiving course.

The original source course first produces:

- `nc-assessment-operation.json` from `source_tools/receive_north_carolina_assessment.py`.
- `ga-assessment-operation.json` from `source_tools/receive_georgia_assessment.py`.

Each operation must be complete in the same actual Workspace. It must retain its normalized assessment table, typed scientific recipe and original regional geographic layer together. The receiver reads the actual collection/source IDs from these existing records. It resolves every original body and companion through the maintained Workspace source reader.

## Complete the report after both source operations

Run this from the installed application's root using its current Python environment. Set the variables to the existing operation's actual paths:

~~~sh
"$UPSTATE_PYTHON" -B -m source_tools.assessment_report_receiving \
  --application "$UPSTATE_APP" \
  --workspace "$UPSTATE_WORKSPACE" \
  --operation "$UPSTATE_NC_OUTPUT/nc-assessment-operation.json" \
  --operation "$UPSTATE_GA_OUTPUT/ga-assessment-operation.json" \
  --output "$UPSTATE_ASSESSMENT_REPORT_RECEIVING" \
  --title "Upper Savannah jurisdiction assessment context"
~~~

The output directory must sit outside both the application and Workspace. Reuse that exact directory after interruption. The order of `--operation` arguments sets the order of newly selected jurisdiction sources.

A report can begin from one completed jurisdiction and add the other in a subsequent explicitly selected report. Each ordered selection has its own retained report edition and receiving directory.

Use `--selection ACTUAL_SCIENTIFIC_SELECTION.json` to preserve an existing ordered source list and append these jurisdiction sources once. The selection can use the publisher's `sources` list or the delivery's existing `observed_context_sources` and `source_roles.OBSERVED_CONTEXT` fields. The source pair is always:

~~~json
{"source_collection_id": "ACTUAL_RETAINED_COLLECTION_ID", "source_id": "ACTUAL_RETAINED_SOURCE_ID"}
~~~

An existing title/contact is retained unless `--title` explicitly supplies the report title. Other delivery fields remain owned by the existing full delivery workflow. This receiving course publishes a scientific report edition from the selected sources.

## Continue directly from either original source command

Both original NC and GA receiving commands accept:

~~~text
--report
--report-with-operation /ABSOLUTE/OTHER_COMPLETED_ASSESSMENT_OPERATION.json
--report-selection /ABSOLUTE/EXISTING_ORDERED_SCIENTIFIC_SELECTION.json
--report-title "Upper Savannah jurisdiction assessment context"
~~~

`--report` completes the original geography/import first, then calls the same report continuation. The other flags refine that explicit report request. The main command's JSON includes `scientific_delivery`; its durable full report result is written under the original output's `scientific-report/assessment-report-<selection>/receiving.json`. The original source operation remains the source-import record.

When the source operations are already complete, use the standalone continuation above. It reads their retained records and continues directly through the report publisher.

## What the operation completes

1. It checks each original source-operation project, schema, table/report IDs, table summary, geographic entry and report inputs. Both the normalized table and exact geographic body must be present in the typed recipe's retained inputs.
2. It preserves the original ordered source selection and publishes through `model.scientific_report_editions.preview/render`. The publisher retains the exact original rendering sources, source binding and output identity.
3. It exports the ordinary `report-files.zip` with PDF, HTML, Markdown, tables, figures and all original selected source members supplied by the publisher.
4. It selects the saved `scientific-report-editions/<id>` root through the existing Study transfer API. That archive carries the selected original report, source records and original application.
5. It restores into a separate `reopened/` directory. A fresh `python -I -B` child imports the **archived application**, checks the original Study receipt and saved report, and resolves every selected source body and companion in the received Workspace.

A completed output is reused only for its exact original selection. Report generation, archive creation, restore and independent reopening each retain their own phase in `receiving.json`. Native exceptions point to the current phase and original cold-opening log. A changed source selection produces another retained receiving record; existing selected archives remain intact.

## Open the result in the operator

The completed `receiving.json` contains the actual:

- `scientific_report_edition_id`, `report_directory` and original `report_files`.
- `report_archive` from the ordinary publisher.
- `selected_study.id`, archive path, bytes and SHA256.
- `received.workspace`, `received.application`, `received.report_directory` and received file paths.
- `operator_selection.sources` in the original report order.

Open the original Workspace in the current operator. The source recipes are ordinary Scientific Reports choices. Open the saved report edition by its returned ID, inspect its source order, and use its native downloads. For a new ordered report, the shared extension capability is:

~~~javascript
host.openScientificReport({
  workspace_key: actualWorkspaceKey,
  sources: originalOrderedSources,
  title: actualReportTitle
});
~~~

Use the received application's normal operator with `received.workspace` to open the independently retained edition and selected Study. The cold-opening check does not start a model run or change any assessment determination.

For an existing modeled delivery, preserve its original ordered source choices and append these exact NC/GA pairs through the maintained delivery form. Keep `source_roles.OBSERVED_CONTEXT` equal to the first ordered pair and let the existing delivery preparation compute its binding. The saved scientific edition remains available separately.

## Scientific interpretation that travels with the source

| Original quantity | Meaning retained through report and transfer |
| --- | --- |
| NC final-2022 jurisdiction edition | The edition label belongs to the published assessment source. Individual parameter records keep their own assessment cycle, approval/status, collection year, method and original raw attributes. |
| NC assessment units and geometry | The 110 native unit identities remain distinct from their 110 stream and 34 polygon representations. The 77 parameter determinations retain their original row identities. |
| GA approved-2024 publisher edition | The 295 original publisher Savannah-basin reaches remain separate from the actual Upper Savannah project subset. Publisher overall assessment, overlapping categories, cause and designated-use context retain their original meanings. |
| Original station geography | Source station IDs and publisher HUC labels retain their original fields. A native point or reach relationship is identified separately from a publisher basin label. |
| Regional geographic membership | Positive line length or polygon area in the original 217-HUC domain establishes membership. Boundary-only contacts are separate. A reach may cross several HUCs; sums of HUC memberships do not replace distinct-reach totals. |
| Original criteria and units | Criteria labels, concentrations, fish-tissue units, causes and use determinations stay in their original source rows. This workflow performs no conversion into nutrient/sediment annual loads or model calibration targets. |
| Report source order | Each jurisdiction's original recipe is namespaced by the maintained collector. Identical member names such as `assessments.json` remain separate original editions. |

The source normalizers and original publisher references supply these distinctions. The report continuation preserves their complete inputs and source text without merging unlike categories or inferring unreported uses.

## Required human-facing operation

Follow the current application `AGENTS.md` rendered-product instruction. On the equipped receiving session, actually open the outgoing populated operator, report pages, maps and **every outgoing attachment**. Look at the rendered pages and actual screenshots at presentation and narrow widths. Operate the relevant source choices, map controls, downloads, saved-report opening, selected Study export and independent reopening. Check the relevant loading/empty/error paths when they occur. Repair visible clipping, unreadable tables, broken links or controls in the maintained owner code.

Open the report-file ZIP and selected Study as ordinary user deliverables. Inspect PDF page breaks, long original cause/use text, original category labels, geographic source links and the separate NC/GA source sections. Source hashes, successful imports and a cold subprocess establish the retained source identity; the actual outgoing interface and attachments still need to be viewed and used.
