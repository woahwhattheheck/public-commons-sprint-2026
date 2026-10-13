# Delivery review and transfer

This chapter continues the guided operator journey after completed baseline and alternative runs are available. For the atlas and saved map-release workflow, use [Map atlas](MAP_ATLAS.md) and [Report/map releases](REPORT_MAP_RELEASES.md). Use **Maps and delivery** to assemble an edition, read its report, choose the files to share, and carry the same project to another machine.

The report follows the selected project and completed runs. Its study area, grid, source choices, model scope, annual quantities, scenario changes and map links come from those retained records.

## 1. Select the assessment to deliver

In **Maps and delivery**, use **Selected study cases** to choose the completed baseline and every completed alternative you want in this edition. Read the names and run identifiers together. The selected list determines which alternatives appear in the report and package; it can include all relevant completed alternatives.

Review the title and the selected source-water, high-quality-water and planning settings in the delivery form. Build the delivery from that selection.

| Do | See | Meaning | Bryce can say |
| --- | --- | --- | --- |
| Select the completed baseline and the required alternatives. | The actual run names and selected alternative list. | This edition has an explicit scientific basis that can be reopened later. | “Here is our baseline, and these are all the alternatives we are comparing in this assessment.” |
| Review the delivery settings and build. | A retained delivery appears in Maps and delivery with its report and package files. | The report, maps and GIS files describe the same selected assessment. | “This builds the report and the working handoff from the results we just reviewed.” |

The report's model-scope table names the selected models for each run. NDR supplies nutrient outputs; SDR supplies sediment outputs. A comparison needs the relevant output in both the baseline and the alternative. The full seven-map assessment uses the completed model outputs and supporting map layers required by that delivery.

## 2. Read the report in the same view

Open the delivery and choose **Read scientific report**. The application opens that delivery's retained HTML report in the same view. A transferred delivery appears as **Received copy**, with its report and map downloads ready to open. Use the report's section links to move between current exports, alternatives, map guidance, planning priorities, sources and receiving instructions.

Open a map link from the report. It should open the corresponding map PDF from the same delivery. The application resolves these links against the retained delivery files, so each report keeps its own maps when several editions exist.

| Do | See | Meaning | Bryce can say |
| --- | --- | --- | --- |
| Choose **Read scientific report**. | The readable report for the selected delivery. | You are reviewing the document attached to this edition. | “You can read the explanation here alongside the maps and downloads.” |
| Open a map link in the report. | That edition's retained map PDF, with its own title, legend and units. | The narrative and the map refer to the same selected results. | “This link takes us directly from the explanation to the map it describes.” |
| Read an alternative row with its signed change and shared-cell count. | Annual quantities, paired change, units and comparison scope. | The table explains both the modeled response and the area used to calculate it. | “This shows how the alternative changes the modeled annual export over the cells the two runs share.” |

The receiving-area section connects each selected source-water or water-resource target to its retained upstream HUC12 memberships. Read the complete upstream area, its part inside the reporting area, and the annual scenario table together. Those quantities describe land-origin export to the modeled stream network. The native GIS and membership tables let the next operator inspect the contributing land. When receiving areas share upstream land, use their geographic union for a combined area or total.

**Bryce can say:** “This shows which land contributes to each selected receiving area and carries the same annual quantities and coverage counts into the working tables.”

Use the report's study-area and model-scope sections before presenting a prepared case. Read the grid retained with the selected study: the original Gura input raster is 15 m in EPSG:32737, with 1,939 columns and 603 rows; an explicitly resampled Gura workspace can instead retain 300 m cells. The Upper Savannah RFP specifies a 30 m mapping grid. Fresh intake derives its geometry from the selected original land-use raster. The upstream context buffer is a separate choice. Reopening a retained study preserves that study's own grid and run identifiers.

## 3. Choose the right delivery files

The same delivery shows **Read scientific report**, **Open PDF**, **Download complete delivery**, and its **Retained files**. The retained files are grouped by how you use them:

| Group | Contents and purpose |
| --- | --- |
| **Client report** | PDF, HTML, editable Markdown and the structured report model. |
| **Complete delivery and working project** | The assembled delivery download and the working project archive used for continuation. |
| **Scenario and parcel tables** | Retained scenario summaries and the available parcel inventory and comparison tables. |
| **Map families** | The publication maps attached to this edition. |
| **GIS data and supporting files** | Physical GIS outputs, metadata, contributing-area files and other retained project assets. |

Choose the report format or package that fits the handoff:

| File | Use |
| --- | --- |
| **Report PDF** — `report.pdf` | Read, print or circulate the formatted report. |
| **Report HTML** — `report.html` | Read the report in a browser and follow its map links. Keep its relative map folders with it when moving it. |
| **Report Markdown** — `report.md` | Edit the narrative and tables in a text or Markdown editor. |
| **Report model JSON** — `report-model.json` | Inspect the structured report sections, original run identifiers, source choices and quantitative records used by the report. |
| **Download complete delivery** | Transfer the assembled deliverable with its maps, physical GIS outputs, metadata, report companions and registered project assets. |
| **Working project archive** — `scientific-workspace.zip` | Transfer the application, retained scientific workspace and the delivery snapshot so another operator can continue the project. |

Scenario summary JSON, CSV and Markdown remain available with the corresponding delivery assets. They carry the retained scenario comparison into other analysis or reporting workflows.

For a receiving operator, include the working project archive in the handoff. It carries the saved scientific inputs and completed runs; its delivery snapshot preserves the report formats, map folders, summaries, GIS files and other registered delivery assets. The complete-delivery download provides the assembled files for review and sharing.

**Bryce can say:** “The PDF is ready to read, the narrative is editable, and the working archive lets another operator reopen the project with its results.”

## 4. Build the current report edition from completed runs

For a **Received copy**, choose **Prepare complete copy** to create the receiving machine's complete-delivery and working-project archives from the original retained selection. The received report, maps and available tables can be reviewed while preparing that local copy.

When a delivery has an earlier report edition, choose **Create current report edition**. This action uses that delivery's original completed baseline and alternative run identifiers. It builds the current report and delivery presentation around those retained results.

Review the resulting edition in **Maps and delivery**, then choose **Read scientific report**. Confirm the study title, run selection, model scope and map links before choosing the files to share.

Use **Revise delivery choices** when you want to change which baseline, alternatives or delivery settings are selected. Review the restored selection in the form, make the intended changes, and build the revised delivery.

| Do | See | Meaning | Bryce can say |
| --- | --- | --- | --- |
| Choose **Prepare complete copy** on a **Received copy**. | Locally prepared complete-delivery and working-project downloads. | The receiving operator can share and continue the original selection from this machine. | “The report and maps are already here; this prepares the full working handoff from our receiving copy.” |
| Choose **Create current report edition** on an existing delivery. | A current report edition tied to the original completed run selection. | Report improvements can be applied to results already in the project. | “We can bring the report up to the current edition using these completed runs.” |
| Choose **Revise delivery choices** and review the form. | The delivery's baseline, alternatives and settings available for revision. | A changed delivery selection has a clear starting point. | “This brings the assessment choices back into the form so we can prepare another edition.” |

If the browser connection is interrupted during a build, reopen the project's action status and the resulting delivery. Resume or retry the existing delivery action when offered. The saved action request identifies the build so its continuation stays attached to the same operation.

## 5. Transfer and restore the working project

Keep the downloaded `scientific-workspace.zip` intact. Restore it into a new receiving directory using the application's restore command:

```bash
python application/model/cli.py restore /path/to/scientific-workspace.zip /path/to/received-project
```

Replace the two example paths with the archive location and the new receiving directory. Use the Python environment prepared for the delivered application. The restore operation returns the restored workspace, application and delivery locations.

The receiving layout preserves:

| Restored location | What it contains |
| --- | --- |
| `received-project/application/` | The application used to operate the project. |
| `received-project/workspace/` | Retained scientific inputs, source records, selections, completed native runs, comparisons and the registered received delivery. |
| `received-project/delivery/` | The delivery snapshot with the report formats, map folders, summaries and registered working assets. |

The restored delivery is registered with the original delivery identity and retained file records. It appears in the operator as **Received copy**, where **Read scientific report** and the map downloads open the transferred files. The standalone `delivery/report.html` also opens directly, with map links using the preserved relative folder layout. Use the report model and source records to review the baseline and alternatives behind the document.

Launch the restored application with the restored workspace. From `received-project/application/`, run:

```bash
python -B operator/server.py --workspace /path/to/received-project/workspace
```

Use the same prepared InVEST 3.20.0/GIS Python environment. This is an existing workspace, so launch it without `--create`. The server prints JSON containing `operator_url`. Open that complete URL, including its `#token` fragment, in the browser.

The operator's archive restore action registers a new workspace copy with a selector label ending in **· restored copy**. Select that restored project to continue its saved runs and comparisons. When launching a CLI-restored project directly as above, the supplied `--workspace` path selects that restored workspace.

In **Maps and delivery**, open the registered **Received copy** and choose **Read scientific report**. Use its retained-file groups to inspect the maps and tables. Choose **Prepare complete copy** to build local complete-delivery and working-project archives from the original selection. Choose **Create current report edition** when applying the current report presentation to that selection, or **Revise delivery choices** when changing the assessment choices.

**Bryce can say:** “The receiving machine gets the report, the maps and the saved working project, so the next operator can continue from the same assessment.”

## 6. Explain quantities and scenario changes accurately

### Use the grid printed in this report

The report reads the saved affine transform and coordinate system. Cell dimensions describe the actual grid. A 15 m by 15 m cell has an area of 0.0225 hectares; a 30 m by 30 m cell has an area of 0.09 hectares; a 300 m by 300 m cell has an area of 9 hectares. These examples explain why cell size affects the relationship between a per-hectare native result and a delivered per-cell quantity. Use the retained affine and cell area for the selected study when reading quantities; a change to the upstream buffer does not itself change the raster resolution.

The retained native adapter converts the model's per-hectare rate to annual mass per cell using the actual cell area. The report uses the recorded annual-mass raster totals. Its represented area comes from the valid-cell count and saved cell area.

### Keep the three pollutant quantities separate

| Quantity | Native rate | Delivered cell quantity | Report annual total |
| --- | --- | --- | --- |
| Nitrogen from NDR | kg per hectare per year | kg per cell per year | kg per year |
| Phosphorus from NDR | kg per hectare per year | kg per cell per year | kg per year |
| Sediment from SDR | metric tonnes per hectare per year | metric tonnes per cell per year | metric tonnes per year |

The NDR interpretation follows the selected model outputs: nitrogen includes modeled surface and subsurface export, and phosphorus uses modeled surface export. SDR sediment export describes overland sediment delivered to the stream network under the model's erosion and delivery assumptions. Read the saved sources and model profile with these annual estimates.

An annual total is the sum over that pollutant's valid reporting cells. A modeled zero remains zero. The valid-cell count and represented area show the geographical support behind the number.

**Bryce can say:** “The nutrient totals are kilograms per year, sediment is metric tonnes per year, and the report shows the actual grid and valid area used for each result.”

### Read change over the shared area

Signed change is **alternative minus baseline** over cells with valid values in both runs. A negative change means the alternative produces less modeled export on that shared area.

The annual total for each run uses that run's valid area. The paired change uses their shared area. Read the shared-cell count beside the change, especially when valid coverage differs. Percentage reduction is shown when the shared area covers both full supports and the baseline total is positive.

A renamed scenario with the same model assumptions retains that interpretation. A changed parameter profile is labeled as parameter sensitivity. Review the declared scenario changes before attributing a difference to land cover.

The combined pollutant planning layer uses a **dimensionless index** with retained normalization and weights. Use that index to compare planning priorities, and use the separate nutrient and sediment layers when discussing annual quantities.

**Bryce can say:** “A negative change means lower modeled export for the shared area, and the combined score helps us compare priorities under the weights shown here.”

## Source guidance

Scientific interpretations above follow the application's pinned InVEST 3.20.0 guides:

- [Nutrient Delivery Ratio model](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html).
- [Sediment Delivery Ratio model](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html).

The Upper Savannah production requirements are retained with the [issuer's original RFP](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf). Use the selected project's own source records, grid and run scope when presenting a prepared case.

## Current application edition in the working copy

A requested complete delivery binds the exact current application file inventory, including retained original source data, to `selection.application_sha256`. Selecting a newer application produces a new delivery identity, preserving previous completed packages. The working-archive capture checks that its application bytes match this selection before publication. Existing SQLite state is captured by the maintained online-backup path; original scientific source bytes remain unchanged.

## Composed current scientific report

The normal application uses its maintained `scientific_report` PDF/HTML/Markdown/JSON producer, including source-bound scenario analysis, original economic decisions, receiving-water quantities and the current map guide. The delivery review accepts its `report_data` binding and the earlier retained `report_model` format. The selected native alternatives use the application's original `scenario_run_ids` field. The current extension registry remains the sole Conservation action and browser owner.

The same delivery also builds the separate ED6E client companion under `client-report.*`. Its current edition3 science formatting composes the original edition2 namespacing API; the scientific report's four canonical filenames remain intact. Both reports open through the authenticated review endpoint, and all eight report files are included in the working snapshot and delivery assets.

## Current complete delivery inspection

The maintained delivery inspector owns the original report, source-context navigation, map/atlas actions and full file search. The client review controller adds the separately retained client companion and revision/received-copy controls to that same screen. Both use the current workspace and original delivery identity. Closing or replacing the detail view cancels the old inspector; returning from a companion preview reopens the same delivery.

## Compact catalogue, original companion and figure preview

The live delivery list and the open inspector share a small view of the same
original delivery record. That view contains its canonical revision, available
scientific/client report roles and report edition. An unchanged polling response
keeps the selected file page and open preview intact. A changed original record
refreshes the detail; the underlying full record and exact file inventory remain
available from the existing inspector.

The client companion controls use the inspector's declared file inventory.
They remain available with compact polling and do not require creating tickets
for the full GIS collection. Report reading creates at most the fixed ten
scientific/client report tickets. Local report references use the declared
member routes and receive their original ticket when opened.

The linked scientific HTML preview embeds its actual declared local images from
the original verified bytes. The isolated frame can therefore display retained
SVG and raster figures without a second authenticated request. This derived
preview preserves the authored report body and inline atlas scripts; the policy
admits the exact navigation bridge and embedded image data as needed. Original
HTML, SVG, raster and complete-archive downloads keep their exact contents.

Inline preview capacity is 16 MiB for the original HTML, 16 MiB per image and
64 MiB of image bytes across all rendered image occurrences. The complete
offline delivery and original downloads remain available for larger documents.
Paths resolve relative to the selected original report and must name a declared
member inside that same delivery. Original file hashes and sizes are verified
before their bytes are used.

Receiving should open both scientific and client HTML, follow one nested local
reference, view the retained observed SVG figures, change the original delivery
state, and leave an unchanged report open across a normal polling interval.
The source review executed the current JavaScript controller with 25,006 declared
files, complete report availability, stable and changed revisions, an older report
edition, and the original legacy response. Native report rendering continues in
the existing scientific Workspace.
