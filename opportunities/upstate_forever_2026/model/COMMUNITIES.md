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

## Receive and map an intervention programme

Open a saved plan and choose **Revise plan**, or open a new plan using the same retained community table. In **Receive an intervention programme**, select the original UTF-8 CSV and choose **Read file columns**. Map each plan field to the actual source column. Exact standard headings are selected automatically; other headings require an explicit choice. **Preview CSV changes** reads the complete file and shows source-row errors, added/changed/removed intervention counts, the programme rows, entered estimate subtotal and the retained field mapping.

An exported `interventions.csv` can still be previewed directly. Changing the selected file or a field mapping clears the earlier preview. Review the current mapping and preview again before loading rows. The already loaded intervention editor and its original import remain intact until a new preview is applied.

Choose **Load these intervention rows** after reviewing the preview. The imported rows appear in the existing intervention editor, where you can make further changes. **Save revised plan** creates the next immutable revision, retaining the previous plan, the import's selected geography and the exact received CSV filename, UTF-8 text, byte count and SHA-256.

Map an original column to `title`, `utility_id`, `watershed_id` and `reason`. Map `id` to preserve existing intervention identities; an explicitly unmapped or blank ID receives a stable ID derived from the original received file SHA-256 and source row. When using the original canonical CSV API without a mapping, its required `id`, `title`, `utility_id`, `watershed_id` and `reason` headers retain their original behavior. The existing priority, strategy and status choices still apply. Separate multiple GEOIDs with semicolons. Quoted commas and multiline notes are supported. Preserve geographic identifiers as text in a spreadsheet; leading zeros are restored only when the resulting HUC12 or GEOID matches the retained original table.

CSV row order determines intervention order. Exported `position`, `population_context` and `household_context` values are recalculated from the selected plan and source rows. Unmapped columns stay in the original received CSV. A missing optional column uses the existing native default: medium priority, investigate strategy, proposed status, selected membership for blank GEOIDs, and an unspecified cost. Known formula-text escapes from the preceding plan round-trip to the original text; edited text remains the received text.

A report built from the new revision contains the current `interventions.csv`, the exact `received-interventions.csv` and `INTERVENTION_IMPORT.json`, which records the import comparison and any later editor changes. For mapped intake it also retains the exact original headers and each plan field's source column, one-based column number and interpretation. The human report includes the same field mapping. Those files, the revised plan and its original source context travel in the existing workspace backup and restore.

The same revision is available directly from the original Community CLI:

~~~sh
python model/community_cli.py --workspace /path/to/upstate-workspace plan-revise-csv ORIGINAL_PLAN_ID edited-interventions.csv --title "Revised source-water programme"
~~~

The command retains the original table, community selection, scientific context and notes, then prints the newly saved plan. Use that plan's ID with the existing `report-build` command. A malformed row or invalid community membership returns its source-row error before a revision is saved.


For a client spreadsheet with different headings, pass `--column-mapping original-columns.json`. This JSON object names native plan fields on the left and exact original column headings on the right, for example:

~~~json
{
  "id": null,
  "title": "Work package",
  "utility_id": "System ID",
  "watershed_id": "HUC12",
  "reason": "Intended benefit",
  "owner": "Work owner",
  "next_step": "Next action",
  "cost_estimate_usd": "Planning estimate USD"
}
~~~

Unspecified mapping entries use an exact same-named source column when one exists, otherwise the native default. An explicit `null` ignores that field's source column; required title, utility, watershed and reason mappings must be provided. A mapped column must exist in the received file. Source names are exact, including case and spaces. Multiple plan fields may deliberately use the same source column, and each binding is retained.

The original file is never rewritten to manufacture canonical headings. The native validator reparses its exact retained bytes with the saved mapping, then applies the existing utility/watershed/GEOID membership rules, intervention choices and nonnegative two-decimal USD validation. Unknown estimates remain unspecified. Values are not reclassified or converted between currencies by a heading mapping. The imported record is preserved when a later revision edits its intervention rows, and the existing saved-change comparison records those edits.

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

## Run the retained-project walkthrough

The native walkthrough creates a useful draft programme inside an existing retained Workspace. It selects **Anderson Regional Joint Water System / Lower Six and Twenty Creek**, HUC12 **030601010704**, and binds the actual WBD focus-geometry source and original RFP community table.

The proposed work item is **Screen riparian restoration opportunities in Lower Six and Twenty Creek** (`ARJWS-L620-RIPARIAN-REVIEW`). Its strategy is `investigate`, its status is `proposed`, and its cost remains blank. The work calls for a desktop review of candidate riparian reaches and access constraints using the retained watershed, land-cover, stream and parcel sources. The CSV revision adds a ranked review map and a field reconnaissance checklist to that work programme.

### In the existing operator

1. Reopen the retained project. Under **Original sources**, select or import the actual source editions in `source/sources.json` and `source/communities-rfp-20261012/source-manifest.json`. Use the original `upstate-wbd-upstream-domain-20261012` collection already retained in the study, or the original four-focus source `usgs-wbd-focus-huc12-20261012`. The community table is `RFP_COMMUNITIES_2024_ACS`.
2. Open **Communities**, import the community table, and select ARJWS and Lower Six and Twenty Creek. Keep the six original whole block groups selected. Their retained Table 1 context totals 9,083 people, 4,108 households and 497 households below poverty.
3. Create a plan with the work item above. Keep its original HUC12, selected communities and source editions attached; bind actual native baseline and alternative runs when those results are part of the programme.
4. Save the plan and choose **Build complete report**. Download its actual `interventions.csv`.
5. Edit that work item's `next_step` to request a ranked desktop review map and field reconnaissance checklist, retaining the candidate reach references and landowner-access questions. Add the scope change to `notes`; keep the intervention identifier and geography unchanged.
6. Open the saved plan, choose **Revise plan**, receive the edited CSV and preview its changes. The preview shows one changed intervention. Load the rows into the original editor and save the revision.
7. Build the revised report. It contains the revised editable programme, the exact received CSV and its import comparison. Both saved plan editions remain in the Workspace.

### Run the same native product operations

From the maintained application directory:

~~~sh
python operator/community_csv_walkthrough.py --workspace /actual/retained-workspace --output /actual/community-csv-output
~~~

The command opens the existing Workspace, reuses its original upstream-domain or four-focus WBD collection, resolves the original RFP table, reads the actual HUC12 feature and saves the proposed programme. It exports the real saved report's CSV, edits that export, invokes `plan-revise-csv`, and builds the revised native report. Its output directory contains the original table and both saved plans, original/edited/revised CSVs, the selected WBD feature, the exact retained WBD geometry-source gzip, import comparison, complete report ZIP and `community-csv-workflow.json`.

If the original domain archive has been received locally but its source collection has not yet been imported, add `--geometry-manifest /actual/domain/sources.json`. The command imports that original manifest and its original companions into the existing Workspace. Its returned workflow record names the actual source collection, entry, stored hash, decoded hash and CRS.

To attach existing model results, pass `--baseline-run ACTUAL_BASELINE_ID` and repeat `--scenario-run ACTUAL_ALTERNATIVE_ID` as needed. The Workspace applies its existing grid and model-context checks.

The original WBD capture remains in its published EPSG:3857 source CRS. The walkthrough retains its geometry and attributes directly. Population and household values remain the original whole-block-group context described by the RFP table.

### Acquire the public focus geometry and open a working project

When the original study workspace is not present on the receiving host, the
maintained public-source entrypoint can create an actual working project, acquire
the four original RFP HUC12 features directly from the authoritative USGS WBD
service, and run the same saved-plan CSV workflow:

```sh
python operator/community_public_source.py \
  --workspace /actual/upper-savannah-community-workspace \
  --create-workspace \
  --capture-output /actual/retained-usgs-four-focus \
  --output /actual/community-csv-output
```

Omit `--create-workspace` to use an existing project. The capture reuses the
maintained `source/capture_upstream_network.py` response collector. It retains the
complete native Esri JSON response as gzip, the exact request URL, HTTP response
metadata, acquisition time, encoded and decoded hashes, and the original HUC12
and object-ID fields. The response must contain exactly the four RFP watersheds:
030601010703, 030601010704, 030601020502 and 030601020507, each with native polygon
geometry and a published spatial reference.

The fresh source edition uses its actual acquisition date and decoded SHA.
The source manifest and all response companions are imported through the normal
Workspace importer. The Community plan records that exact source collection
alongside the retained RFP demographic table, and the exported workflow includes
the complete unchanged native geometry file and all original source identities.
The proposed ARJWS programme and its CSV revision then use the same functions and
CLI as an existing retained project. Existing model runs can be bound with
`--baseline-run` and repeatable `--scenario-run` options.

The walkthrough also accepts `--geometry-source-id EXACT_ID` together with
`--geometry-manifest /actual/sources.json` for an explicitly selected fresh WBD
edition. Its default still reuses the original upstream-domain collection or the
retained four-focus edition when available.

## Native coverage in report editions

The printable HTML, editable Markdown and browser plan distinguish two spatial
supports: each original run's reporting-area total and each retained comparison's
common valid cells. The report displays original valid-cell counts and pixel area
in hectares when those fields exist. The scientific-context CSV retains the same
coverage fields, units, run/grid/profile/scenario identifiers and comparison ID.
Missing coverage metadata remains unspecified.

Community and intervention filters select whole source block groups. They leave
the original model reporting area unchanged. A native alternative-minus-baseline
difference is summed on cells valid in both runs; it can differ from subtracting
the two separately reported full-run totals. Negative change means lower modeled
export on that common support, and positive change means higher export. A changed
parameter profile remains a sensitivity comparison. These selections provide
scientific context alongside the communities.

Rebuilding the same saved plan with report format version 3 creates a new report
edition while preserving earlier reports. The original intervention CSV import,
plan revision lineage, received CSV and import record remain in their existing
report and portable Workspace paths.

## Use a completed regional watershed report in a Community plan

Receive or build the regional result in the existing **Watershed context**
workbench. Its original result and source identity remain in the project's
regional registry. In the Community plan editor, select that completed report
under **Regional watershed context → Retained regional report**, then save the
plan or its next revision. Use **Refresh regional reports** after receiving a new
regional result. The saved selection appears under **Original scientific context**.

The saved Community context contains only the HUC12 rows represented by the
selected block-group memberships. The plan preserves the original report ID,
exact regional JSON hash and source-input fingerprint. The full regional report
remains a single retained file in the project. Each Community report includes:

- A human-readable watershed planning table with original whole-HUC acres,
  state-portion acres, NRCS FY26 priority states and classified-water query scope.
- The separate original NRCS state records, including Ground, Surface or Both
  programme labels and the source resource concern.
- `watershed-planning-context.csv`, `watershed-state-portions.csv` and
  `selected-watershed-context.json` for editable use.
- `original-watershed-context.json`, copied byte for byte from the completed
  regional result and included in the normal report ZIP and file inventory.

The native command saves the same immutable revision:

```sh
python model/community_cli.py --workspace /actual/workspace \
  plan-attach-watershed ORIGINAL_PLAN_ID watershed-4592eb077b7164d59ba4
```

Use the actual completed report ID from that project's regional workbench.
The returned plan ID can be supplied to the existing report-build action.
Subsequent `plan-revise-csv` operations keep the selected regional report.

The retained 217-HUC result `watershed-4592eb077b7164d59ba4` includes all four
RFP focus watersheds. Its Lower Tugaloo row preserves 59,689.69 whole-HUC acres
and two FY26 High Priority Area records: 38,264.28633246 acres in Georgia and
21,425.42741381 acres in South Carolina. Each state record carries the original
Ground programme label and Water Quality resource concern. The report retains
the published difference between whole-HUC and summed state acres.

For all four focus HUCs that result records a complete membership query with
zero matches for ORW, ONRW, TN, TPGT and TPT under the publisher's HUC12 assignment.
Read those counts with their named class set and South Carolina jurisdiction;
use the corresponding assessment sources for condition and impairment decisions.
Community populations remain the RFP's whole block-group counts.

Original completed result: [ECO-WATERSHED13](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C9JNBA7EU).
Its regional JSON is 470,519 bytes, SHA-256
`54374a5b1feae5afda7217b27b7c796616d8654de8cc1fd8fc92831780e86e34`.


## Review the complete saved-plan revision

Build the report for a saved plan revision to compare it with its actual
immediate parent. The report's **Saved plan changes** register shows every changed
intervention field with its previous and current values, including order, owner,
priority, recorded status, watershed assignment, costs, next step and notes.
Added and removed interventions retain their complete original saved rows.
The current plan and its parent stay separately available.

The same report shows title, purpose, notes and scientific selection changes;
both editions' utility and watershed filters; the original selected block-group
GEOIDs and whole-group counts; and the saved source-context identities.
A change in selected population describes the chosen source geography. The
register does not interpret it as demographic growth or decline.

Entered planning estimates are compared with exact decimal arithmetic. Each
edition's known and unspecified estimate counts stay visible. The displayed
difference is the change in entered estimates; it does not treat missing costs
as measured zero or estimate savings or environmental benefit.

The normal report ZIP includes these additional editable companions:

- `plan-revision-summary.json`: the complete revision register, selection,
  entered-cost context, source identifiers and both plan identities.
- `plan-revision-changes.csv`: exact before/after intervention field values,
  encoded as JSON in separate columns so null, empty text and numeric text stay
  distinct.
- `previous-plan.json`: the original saved parent plan used for the comparison.

The original Community source must match between parent and child, and the
revision must point to its immediate predecessor. The existing **Add to scientific
report** workflow carries the same register and all three original companions into
the ordered scientific report.
