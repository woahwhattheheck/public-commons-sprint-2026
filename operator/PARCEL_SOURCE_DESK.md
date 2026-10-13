# Parcel sources — operator and receiving handoff

TokenJunkieLabs · ECO-PARCEL-DESK-D4065-20261013  
Parent delivery: UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012

## Open the working application

**Parcel sources** connects original county acquisition, complete native preparation, saved source editions, full inventory browsing, native GIS, downloads, Conservation plans, and the existing map delivery.

Use the receiving owner's current application directory and GIS-enabled Python interpreter as `ECO_APPLICATION` and `ECO_PYTHON`. Preserve that operator's registered Workspace, state directory and source roots. Open its printed `operator_url`, then click **Parcel sources** in the existing navigation. After authentication, `/#parcel-sources` opens this desk directly.

The receiving owner registers the actual retained parcel plan/capture directory with the existing repeated `--source-root` option. That directory contains `parcel-plan.json`, `plan-transfer.json`, `parcel-masks.json`, original reporting/county context and retained `layers/<provider>/layer-capture.json` files. A registered parent also works; the desk browses its subdirectories. A received saved edition opens without registering its former acquisition directory.

The normal existing server command is:

~~~sh
cd "$ECO_APPLICATION"
"$ECO_PYTHON" -B operator/server.py \
  --workspace "$ECO_WORKSPACE" \
  --operator-state "$ECO_OPERATOR_STATE" \
  --source-root "$ECO_PARCEL_CAPTURE" \
  --port 0
~~~

Use the receiving owner's actual retained directories for these variables. Preserve the startup URL in the local receiving session. The source acquisition owner supplies the current original reporting plan; the desk continues its native provider requests.

## Demonstrate the complete workflow

| Bryce's action | What appears and what it means | One sentence for Tim |
| --- | --- | --- |
| Open **Sources and captures**, choose the registered source directory, browse to the retained plan and click **Open this parcel capture**. Expand **County source and classification details**. | Every county required by the original reporting polygon, its provider, native record count, native ID field, publication context, CRS and retained classification. | “We keep each county source and its publication context attached to the parcel data.” |
| For pending counties, choose whether to retry retained provider failures and click **Continue original county acquisition**. Open the operation. | The existing queued receiver continues the same capture and retained native requests. Completed counties stay available for preparation. | “We can continue receiving county data while keeping the completed editions usable.” |
| Name the edition and click **Prepare and import these completed sources**. | The original queue retains the exact selected completed county inputs, calls the original preparation engine, imports its source manifest and indexes the complete original tables. A saved source edition appears when complete. | “This creates the parcel GIS and complete inventory from the source edition we selected.” |
| Open **Saved editions**, choose the prepared edition and inspect its county table. | Expected reporting hectares, cadastral coverage, parcel-only coverage, uncovered area and overlap excess are actual independent measures. The map gap classes separate pending source acquisition from gaps in a completed source. | “We can see where the available parcel geometry covers the reporting area.” |
| Choose **Inventory**, **County** and a search term. Click **Search complete inventory**, **Next page**, and **Inspect** on a row. | Original parcel, cadastral, excluded, county or source rows, with both matching and complete-table counts. The index covers every original row. Local references retain leading zeros and blanks; qualified parcel IDs preserve county, provider and native OID. | “Every parcel remains traceable to its original local record.” |
| Click **Open parcel map**, **Open county coverage map** or **Open source gap map**. | The existing Spatial review opens that exact retained layer with its original point inspection, filters, overlays, saved views and printable map controls. | “We can inspect the original parcel geometry alongside the reporting boundary.” |
| Under **Use this edition in Conservation plans**, set the inventory title and mode, then click **Build the original conservation inventory** and **Open conservation inventory**. | The existing conservation engine receives the same source collection, parcel source, layer and qualified ID field. Source-context mode computes actual geometry/reporting coverage; native-model mode also binds the selected completed baseline and alternatives. | “These same parcels now enter the conservation planning workflow.” |
| In Conservation plans, inspect candidates and use its manual or ranked portfolio controls, area/cost limits and original scenario controls. | The original application computes portfolio selection, union quantities and the saved-plan land-cover mask. Whole parcel area, reporting overlap and selected union area remain distinct. | “We can turn a defined conservation portfolio into an explicit land-cover scenario.” |
| Click **Use this parcel source in map delivery**. | The existing delivery form receives the edition's exact PARCEL role and parcel overlay collection/source/layer. Complete its baseline, alternatives, remaining inputs and delivery settings. | “The map delivery uses the parcel edition we just inspected.” |
| Download the GeoPackage, full CSVs, county source table and printable report. Click **Reopen this saved edition**; close/reopen the browser; transfer the project using the original full workspace backup/restore. | Actual editable GIS, complete tables, methods and source context download through original verified file tickets. The same saved edition and index reopen in the received workspace. | “The recipient can reopen the same source edition and continue the analysis.” |

### Vocabulary and choices

**Capture** is the original retained acquisition. **Source edition** is the exact completed-county selection prepared and saved in the workspace. **Parcel candidates** follow the retained provider classification; **cadastral context** contains its separately classified original records. **Whole-feature hectares** describe the full analytical source parcel polygon. **Reporting hectares** describe its positive-area intersection with the original Upper Savannah reporting polygon. **Cadastral coverage** is the unique union of available eligible cadastral geometry. **Parcel coverage** uses parcel candidates alone. **Uncovered hectares** and **overlap excess** have separate original quantities and map interpretations.

Native source CRS and analysis CRS have different roles: original response companions retain native coordinates, while prepared analytical polygons and area measurements use EPSG:5070. Provider metadata retains the original source edition.

The operator chooses a source capture, completed county edition, readable title, table/search/county selection and study mode. Scientific choices stay explicit in the original Conservation and scenario controls: purpose, accepted source classification, required contexts, eligibility thresholds, scoring weights, area or cost limits, actual native baseline/alternatives, land-cover codes, change reason, grid/profile and original run inputs.

The initial source-context inventory has zero context weights because no context is yet selected; it still computes original geometry and coverage. The native-model bridge binds actual completed runs and the selected quantity basis, scale and pollutant weights from this desk. Conservation retains those settings with the study; continue its controls to define further contexts and portfolio rules before interpreting a priority score.

## Continue, recover and receive

**Existing operation:** use **Original operations** or the shared Operations drawer. Open the actual task record. Failed/interrupted tasks offer **Resume this operation**, preserving the original request and retained progress.

**A source arrives during preparation:** the job retains one immutable input set before preparation. Later county arrivals remain available for a later edition. Once its snapshot exists, an interrupted preparation can resume without the former acquisition directory.

**An edition changes between preview and preparation:** refresh the capture and choose its current completed counties. Completed saved editions retain their original source selection.

**A provider exception:** inspect the county's actual exception and original task log; continue the original receiver with the retry control when the source is available. Source owners supply provider/catalog successors while the prior capture keeps its original declared edition.

**A transferred project:** open the received operator and choose **Parcel sources → Saved editions**. The edition, original source selection, prepared outputs and complete search index reopen from the received workspace. Register a new capture source root when undertaking further acquisition or preparing a later edition.

## Install the complete desk

This extension owns nine distinct paths. Its installer accepts the original edition, an identical current edition, or a source with the declared exact predecessor; a different concurrent body requires composition:

- `model/parcel_source_desk.py`
- `model/parcel_source_cli.py`
- `operator/parcel_source_desk.py`
- `operator/extensions/parcel-sources.json`
- `operator/web/parcel_source_desk.mjs`
- `operator/web/parcel_source_desk.css`
- `operator/install_parcel_source_desk.py`
- `operator/parcel_source_receiving.py`
- `operator/PARCEL_SOURCE_DESK.md`

The existing ECSA host reads the new descriptor and assets. Its original queue, authentication, registered source roots, task recovery, verified downloads and receiving hooks perform the integration.

~~~sh
"$ECO_PYTHON" -B "$ECO_PARCEL_SOURCE/operator/install_parcel_source_desk.py" \
  --application "$ECO_APPLICATION" \
  --source-root "$ECO_PARCEL_SOURCE"
~~~

The installer parses Python, validates the registration, checks the current application and whole-parcel engine, and reports changed files with exact prior/postimage hashes. `--dry-run` previews the same composition. An already overlaid identical source bank is accepted. A concurrently authored different source is identified for composition.

### Continue the selected quantitative study

A source-context inventory uses the original parcel geometry and reporting overlap. For a quantitative inventory, select **Completed native model quantities**. The baseline selector shows original InVEST 3.20.0 runs with completed NDR and SDR stages and all three retained export quantities. Choose any completed alternatives on that same grid.

Select the priority quantity explicitly:

| Control | Original Conservation quantity |
| --- | --- |
| Current export | The selected baseline's N, P and sediment export. |
| Reduction | Positive baseline-minus-alternative reduction; the original engine floors increases to zero for this priority. |
| Increase | Positive alternative-minus-baseline increase; the original engine floors reductions to zero for this priority. |
| Whole parcel reporting total | Actual mass within each original polygon's reporting overlap. |
| Per reporting hectare | The same retained quantity divided by the relevant reporting area. |

The separate pollutant weights are visible and editable. The engine retains original pollutant units and records its 95th-percentile normalization. Select at least one positive weight. A change priority selects one of the study's checked alternatives; all checked alternatives still remain in the study.

For Bryce: choose the source edition and county, complete the native run/priority controls, then build the inventory. The operator carries the exact saved source binding into the original Conservation queue. Open the completed task's inventory to inspect original quantities and continue the existing portfolio/scenario workflow.

Sentence for Tim: “These priorities use the retained native model results over the original parcel footprints, with the source edition, run comparison and scoring settings available for review.”

Study settings are retained separately for each source edition. Reloading restores the selected baseline, alternatives, quantity basis and weights. The original preparation and study task IDs and request identities are also retained so reopening continues the submitted operation. The parcel, county-coverage and source-gap map controls each open their exact original source layer.

### Current source dependencies

| Owner/source | Required retained contract |
| --- | --- |
| Complete original application and ECSA | [Public PR2672](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2672); Workspace, ExtensionRegistry, registered source roots and browser host. Existing interface: `operator/EXTENSIONS.md`. |
| Full-reporting county parcel acquisition | [Public PR2682](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2682); `reporting_parcels.py`, `domain_overlays.py`, county catalog and source collector. |
| Whole original parcel successor | [Merged public PR2755](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2755); engine SHA256 `fa83e647f45a2e9d77e5486389c12ca29a7810d1ff2f85cb7e06e24016963a27`, preparation method `upstate.reporting-parcels/whole-original-polygons/v2`. The desk consumes returned fingerprint/source IDs and `geometry_scope=whole_source_polygons`. |
| Original collector/native CRS | [F0C8NA49K46](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8NA49K46); collector SHA256 `2f1934ee2a153a09d5d03a14343aca9a0a8dcb68c6ef548a3d5353affe3e94f5`. Native CRS is requested explicitly where published map CRS differs. |
| Original domain/catalog dependency | [F0C9JNHAXU0](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C9JNHAXU0); retain later ES26 provider/catalog changes when composing. |
| Conservation application | [Public PR2635](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2635), current model/operator/browser and `conservation.build`. Existing plan and scenario adapters own portfolio selection and scenario creation. |
| Original delivery parcel reducer | Current `model/priorities.py` must retain the selected or entry-declared ID field. The cumulative integration supplies `selection.get("id_field") or entry.get("id_field")` for the existing delivery form. |

### Original APIs

`model.parcel_source_desk` supplies `preview(capture_directory)`, `operate(workspace, capture_directory, selection, title=..., operation_id=..., locator=...)`, `overview(workspace)`, `get(workspace, edition_id)`, `rows(workspace, edition_id, table=..., county=..., query=..., offset=..., limit=...)`, `study_selection(workspace, edition_id, settings)` and `verify_workspace(workspace)`.

`ParcelSourceDesk(operator, fault, source_roots)` provides `read(workspace_key, operation, payload)`, `invoke(task)`, `state(workspace_key)` and `decorate_task(task)`. Its original queued actions are `parcel.source.receive` and `parcel.source.prepare`.

| Route under `/api/parcel-sources/` | Request/result |
| --- | --- |
| `catalog` | Workspace → roots, editions and original operation progress. |
| `directories` | Root ID, relative path, offset → original directory browser. |
| `capture` | Root ID and path → actual plan/county state and exact selected input identity. |
| `edition` | Edition ID → native inventory, source bindings, tables and verified downloads. |
| `rows` | Edition ID, table, county, query, offset, limit → complete-table count and original rows. Default 100 and maximum 500 per page. |
| `study-selection` | Edition ID and spec → existing Conservation study specification. |

The browser factory `createParcelSourceDesk(host)` exposes `mount`, `update` and `detach`. Delayed replies stay with the initiating workspace. Ordinary title/search/selection drafts survive task progress refreshes. The full SQLite index preserves each original CSV row as text; it travels with the source edition.

The same model operation is available through the CLI:

~~~sh
"$ECO_PYTHON" -B -m model.parcel_source_cli \
  capture "$ECO_PARCEL_CAPTURE" --output "$ECO_SOURCE_PREVIEW"

"$ECO_PYTHON" -B -m model.parcel_source_cli \
  --workspace "$ECO_WORKSPACE" prepare "$ECO_PARCEL_CAPTURE" \
  --selection "$ECO_SOURCE_PREVIEW" --title "Upper Savannah county parcel edition"

"$ECO_PYTHON" -B -m model.parcel_source_cli \
  --workspace "$ECO_WORKSPACE" rows "$ECO_PARCEL_EDITION" \
  --table parcels --limit 100
~~~

## Record the actual running journey

`operator/parcel_source_receiving.py` drives Chromium through the running original application and actual retained data. It opens the original capture, submits native preparation/import, closes and reopens the browser while the original task continues, searches/pages the full inventory, downloads original outputs, opens the native spatial map, builds the original conservation inventory and reopens the saved edition.

The output contains real stage durations, original task/source/edition IDs, downloads, browser screenshots and a journey video.

~~~sh
"$ECO_PYTHON" -B operator/parcel_source_receiving.py \
  --operator-url-file "$ECO_OPERATOR_LAUNCH_JSON" \
  --capture-directory "$ECO_PARCEL_CAPTURE" \
  --title "Upper Savannah original county parcel edition" \
  --output "$ECO_PARCEL_JOURNEY"
~~~

The launch file may contain the single original JSON object or the original server stdout with its launch JSON line. The recording omits the startup capability. `--chromium-executable` can select the receiving host's installed Chromium.

For a quantitative parcel journey, choose an actual completed NDR + SDR baseline and alternatives whose retained reporting grid overlaps the South Carolina parcel reporting polygon. The original Conservation engine checks the parcel intersection against that selected native reporting geometry. Use the Gura source fixture for its separate original native benchmark workspace and journey. The default parcel journey uses source-context mode and the actual South Carolina county inventory.

For the completed South Carolina run pair, add the original IDs to the same parcel journey:

~~~sh
--baseline-run "$ECO_BASELINE_RUN" \
--alternative-run "$ECO_ALTERNATIVE_RUN" \
--score-basis scenario_reduction \
--scoring-alternative "$ECO_ALTERNATIVE_RUN" \
--score-scale total
~~~

The journey selects these values in the real browser form, builds the original quantitative inventory, and records the returned study summary and reopened study controls. Omit the native run options to build the source-context inventory from actual parcel geometry.

After the original full workspace backup/restore, use the same edition ID against the received operator:

~~~sh
"$ECO_PYTHON" -B operator/parcel_source_receiving.py \
  --operator-url-file "$ECO_RECEIVED_OPERATOR_LAUNCH_JSON" \
  --edition-id "$ECO_PARCEL_EDITION" \
  --output "$ECO_RECEIVED_PARCEL_JOURNEY"
~~~

When the received workspace is registered alongside another workspace, also supply its actual `--workspace-key`. This journey opens the saved edition from the received project.

Keep the journey JSON, screenshots, video and original downloads alongside the cumulative ECO receiving packet. Publish the native result to [the current full-product thread](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791724121853269), with [receiving continuation 1791855147.061539](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791855147061539?thread_ts=1791724121.853269).

## Retained source structure

Input snapshots live in `parcel-source-inputs/<selection-id>`. The original engine prepares its inventory and source manifests there. Indexes live in `parcel-source-indexes`; saved editions use the original `parcel-source-editions` collection; operation progress lives in `parcel-source-operations/<original-task-id>`.

These are ordinary retained workspace members. The original portable archive includes them and the installed source under model/operator. The ECSA receiving verifier validates saved source collections and the original retained outputs before registering the received workspace.

The native county and Conservation engines retain ownership of their scientific calculations. The desk connects their exact source selections, quantities and files to working operator controls.
