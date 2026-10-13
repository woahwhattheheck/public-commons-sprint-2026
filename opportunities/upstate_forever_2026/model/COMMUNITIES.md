# Utility and community planning

The Communities workspace joins the original RFP Table 1 to a complete intervention work program. It runs inside the scientific Workspace and its existing browser operator. Its source editions, immutable plans, full reports and application files travel in the existing portable workspace archive.

## Open the original application

From the `upstate_forever_2026` directory:

~~~sh
python operator/server.py --workspace /path/to/upstate-workspace --create --source-manifest source/communities-rfp-20261012/source-manifest.json
~~~

Open the printed local operator URL. Under **Original sources**, import the registered **RFP Appendix F community and utility context** edition. Then open **Communities** and choose **Import community table**.

The table keeps all seventeen original rows. The initial edition totals 27,448 people, 11,001 households and 1,014 households below poverty. Ten of the seventeen block-group medians are below the RFP's 72,350 USD reference. The full original PDF capture and transcription method are identified in the source provenance.

## Compare and build the work program

Select the source table, compare the utilities and filter by utility, watershed or GEOID. A utility and watershed selection must describe the same original membership. Each unique block group is counted once in the selected total. Every block group's original median household income remains visible.

Create a plan with a purpose and its selected communities. Add a complete intervention for each intended work item: title, utility, watershed, block groups, priority, strategy, status, rationale, owner, next step, optional cost estimate and notes. An empty intervention block-group list uses the plan's groups in that exact utility/watershed membership.

The cost is an operator-entered planning estimate. A blank estimate is retained as unspecified. The cost summary reports the count of entered estimates alongside their subtotal.

The plan can bind original source editions, an existing grid, completed or in-progress native runs and a delivery. The original baseline and alternative runs must use the same grid. Completed original run-comparison records supply signed differences over their common valid cells. Parameter-profile changes remain labeled as sensitivity comparisons.

Saving a revision retains the previous plan and binds the new selection. To change the underlying table edition, create a new plan.

## Receive an edited intervention programme

Open a saved plan and choose **Revise plan**. In **Receive an edited intervention programme**, select the report's edited `interventions.csv` and choose **Preview CSV changes**. The preview shows every source-row error, added/changed/removed intervention counts, the programme rows and the entered estimate total.

Choose **Load these intervention rows** after reviewing the preview. The imported rows appear in the existing intervention editor, where you can make further changes. **Save revised plan** creates the next immutable revision, retaining the previous plan, the import's selected geography and the exact received CSV filename, UTF-8 text, byte count and SHA-256.

Keep the exported column headings. `id`, `title`, `utility_id`, `watershed_id` and `reason` are required. Existing intervention IDs retain their identity; a blank ID receives a stable ID derived from the received file and source row. The existing priority, strategy and status choices still apply. Separate multiple GEOIDs with semicolons. Quoted commas and multiline notes are supported. Preserve geographic identifiers as text in a spreadsheet; leading zeros are restored only when the resulting HUC12 or GEOID matches the retained original table.

CSV row order determines intervention order. Exported `position`, `population_context` and `household_context` values are recalculated from the selected plan and source rows. Additional columns stay in the original received CSV. Known formula-text escapes from the preceding plan round-trip to the original text; edited text remains the received text.

A report built from the new revision contains the current `interventions.csv`, the exact `received-interventions.csv` and `INTERVENTION_IMPORT.json`, which records the import comparison and any later editor changes. Those files, the revised plan and its original source context travel in the existing workspace backup and restore.

The same revision is available directly from the original Community CLI:

~~~sh
python model/community_cli.py --workspace /path/to/upstate-workspace plan-revise-csv ORIGINAL_PLAN_ID edited-interventions.csv --title "Revised source-water programme"
~~~

The command retains the original table, community selection, scientific context and notes, then prints the newly saved plan. Use that plan's ID with the existing `report-build` command. A malformed row or invalid community membership returns its source-row error before a revision is saved.

## Deliver and reopen

Choose **Build complete report** from the saved plan. The report contains the complete narrative, utility and watershed summaries, source rows, intervention program, original scientific context and interpretation notes.

| File | Purpose |
| --- | --- |
| community-report.html | Printable report and integrated browser preview |
| community-report.md | Editable narrative and tables |
| community-report.json | Complete report, original table and saved plan |
| communities.csv | Selected whole-block-group rows |
| utilities.csv | Utility summaries and separate service population estimates |
| watersheds.csv | HUC12 summaries |
| interventions.csv | Current work program, owner, rationale, next step and estimate |
| received-interventions.csv | Exact edited CSV received with an imported revision |
| INTERVENTION_IMPORT.json | Import comparison, geographic normalization and later editor changes |
| scientific-context.csv | Original model totals and native comparison differences |
| plan.json | Exact saved plan and context selection |
| original-community-source.csv | Byte-for-byte original input table |
| REPORT.json | Report file index |
| community-report.zip | All report members together |

Use **Back up workspace** and **Restore an archive** for the complete working application. Restoration checks the retained source, immutable plans and all report members. The received application includes the Communities module and the original spatial/model/source tools.

## Command line

The same operations are available from the original CLI:

~~~sh
python model/cli.py --workspace /path/to/upstate-workspace source-import source/communities-rfp-20261012/source-manifest.json
python model/cli.py --workspace /path/to/upstate-workspace community-table-import table-selection.json
python model/cli.py --workspace /path/to/upstate-workspace community-plan-save plan-selection.json
python model/cli.py --workspace /path/to/upstate-workspace community-report-build report-selection.json
~~~

A table selection contains `source_collection_id` and `source_id` (`RFP_COMMUNITIES_2024_ACS`). A report selection contains `plan_id` and an optional title. The full plan payload is retained in the browser operation and downloadable saved plan. `python model/community_cli.py --help` exposes the table, plan and report readers as well.

## Interpreting the original source

The source describes whole census block groups assigned to four focus HUC12s in the RFP. The application does not apportion those counts by watershed area. Utility service population describes a different population and is displayed separately.

The state-income reference is the RFP's descriptive comparison. Whole-block-group medians are never averaged into a utility median. Original printed poverty percentages are preserved beside ratios calculated from the printed household counts; differences become visible source notes.

Original modeled pollutant totals retain their actual units and spatial coverage. A demographic filter changes the community selection. It does not allocate pollutant mass, exposure or treatment savings to individuals. The original model and spatial workflows remain the source of physical results.
