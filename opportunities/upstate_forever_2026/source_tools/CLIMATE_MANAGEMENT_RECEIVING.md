# Receive a complete original climate-management course

TokenJunkieLabs · Current owner direction: `CURRENT_OWNER_DIRECTION.md` version 2026-10-13.4

`source_tools/receive_climate_management.py` turns actual prepared forcing entries and existing completed native role runs into the ordinary Climate studies, native runs, Management result, Scientific Report, editable selected Study, and complete Workspace. It independently restores both portable archives and cold-opens each through the application actually inside that archive.

The default invocation verifies the input configuration and every original source entry, primary raster and companion. It writes an input review and a durable receiving journal. Add `--execute` to carry that exact selection through the installed original engines and queue. The script does not create a replacement project, synthetic precipitation, invented management scenario, or substitute model result.

## Scientific selection

Choose a completed original reference run and a completed original treatment run. A control is optional, but when chosen it participates in every period. All roles must share the original physical grid, parameter profile, model scope and InVEST version; their scenario IDs retain the actual original management choices.

For each period, select prepared precipitation and/or independently prepared rainfall erosivity entries with explicit period labels, temporal basis and interpretation. The same period override is applied to all selected roles. The original Climate model performs its existing exact grid, unchanged DEM/LULC/K, model/reporting masks, prepared land-cover, native-version, units, nonnegative forcing and finite-support checks.

Each original source entry is imported through its own deterministic source composition. Adding the normal-period entry later does not change the annual entry's source collection, prepared grid or completed native run identity. Keep the same entry bytes, source-root location and original role runs when expanding a one-period course.

The Management model receives an explicit role→study/case mapping for each period. It uses one common finite mask across every selected period and role for each pollutant/reporting area. It also retains independent totals, exclusions and common hectares. Benefit is reference minus treatment; optional control-adjusted benefit is control minus treatment; interaction is selected-period benefit minus the explicitly selected reference-period benefit. These are model comparisons, not causal observational estimates.

NDR automatic normalization uses the original valid model-domain runoff-proxy mean. A uniform multiplier can cancel under that mode. A fixed original `runoff_proxy_av` has different behavior; the existing native argument and diagnostic records remain authoritative. Do not infer an event response, climate trend or future projection from annual spatial-pattern cases. NOAA R remains an independent erosivity input: do not derive annual R by scaling annual precipitation.

## Required actual application and inputs

Use the original qualified scientific interpreter and a coherent complete installed application. The maintained `climate-management` component requires Climate forcing, Study transfer, Scientific Report review, the original queue/extension host and GIS. It includes this driver and its composer dependency. Preserve current native supervisor/worker and Study successors when composing source.

The runtime must already support the selected original native models and the report renderer. Receiving a source-only Workspace or installing Python/rasterio alone does not establish an InVEST-ready original project. Keep current writers, model processes and existing accepted operations under their original owner.

Prepare each source with its maintained source tool and retain the complete `source-entry.json` plus every original ZIP, XML, capture/lineage and raster companion declared there. Existing guidance is [CLIMATE_FORCING_PERIODS.md](CLIMATE_FORCING_PERIODS.md), [CLIMATE_FORCING.md](../operator/CLIMATE_FORCING.md), and [CLIMATE_MANAGEMENT.md](../operator/CLIMATE_MANAGEMENT.md). The annual `prism_period` preparer and historical-normal `raster_sources prism` preparer have different source identities; never pass the annual ZIP through the normal preparer.

The configuration's `source_manifest_directory` must be an existing directory above every selected entry and all its declared files. The original composer writes `forcing-source-<entry-SHA256>.json` there. Original native source files remain in place. Keep the application, original Workspace, receiving state and downloaded output directories separate.

All prepared entries require their real byte count and SHA256. Every primary and companion descriptor must retain its original byte count and SHA256. The driver hashes and checks those exact files before importing them. It also freezes the completed original role selections, artifacts and `run.json` identities before a new native case can begin.

## Complete configuration

The receiving configuration uses `upstate.climate-management-course/v1`:

- `project_id`: the actual existing native project UUID.
- `title` and `purpose`: explicit course and interpretation labels.
- `source_manifest_directory`: source directory described above.
- `sources`: original source entries, each with `key`, `entry`, `bytes`, `sha256`. Entry paths may be absolute or relative to the configuration file.
- `roles`: `reference`, `treatment`, and optional `control`, each containing the actual `baseline_run_id`.
- `periods`: ordered `id`, `label`, `overrides`. Each override is keyed `PRECIPITATION` or `R_FACTOR` and contains `source_key`, `period_label`, `temporal_basis`, `interpretation`.
- `reference_period_id`: one actual selected period.
- `reporting_areas`: the existing native reporting selections; an empty list uses the original grid's reporting area.
- `difference_maps`: a boolean, normally true for the complete mapped receiving course.

No source collection or derived run ID is guessed in this file. They come from the actual native import and preparation.

### Configure the original 5156 two-role course

The following script binds existing source entries to the independently retained original 5156 reference/treatment IDs. It does not execute a model or change a scientific input. Supply the real source directory, prepared annual/normal/erosivity entry paths and desired configuration path as command arguments. Use `-` for the normal entry only while that original is still unavailable.

The original 5156 domain is a **1,296 ha simulated teaching square**, with retained simulated terrain/LULC/K/coefficients. Adding real PRISM/NOAA forcing does not make those other physical fields observed or turn this into the separate regional Upper Savannah case. The selected MFD/122 profile and actual riparian treatment remain unchanged.

```bash
"$ECO_PYTHON" - "$SOURCE_DIRECTORY" "$ANNUAL_ENTRY" "$NORMAL_ENTRY_OR_DASH" "$R_ENTRY" "$COURSE_CONFIG" <<'PY'
import hashlib,json,sys
from pathlib import Path
root,annual,normal,erosivity,destination=sys.argv[1:]
def source(key,filename):
    path=Path(filename).resolve(strict=True)
    raw=path.read_bytes()
    return {"key":key,"entry":str(path),"bytes":len(raw),
            "sha256":hashlib.sha256(raw).hexdigest()}
sources=[source("annual_2025",annual),source("noaa_r",erosivity)]
r={"source_key":"noaa_r","period_label":"NOAA R-Factor, 1975–1997",
   "temporal_basis":"Long-term annual rainfall erosivity",
   "interpretation":"Same original independently prepared NOAA R in every period and management role; no annual precipitation scaling."}
def period(key,label,precipitation_key,basis,interpretation):
    return {"id":key,"label":label,"overrides":{
        "PRECIPITATION":{"source_key":precipitation_key,"period_label":label,
                         "temporal_basis":basis,"interpretation":interpretation},
        "R_FACTOR":dict(r)}}
periods=[]
if normal!="-":
    sources.append(source("normal_1991_2020",normal))
    periods.append(period("normal_1991_2020","PRISM 1991–2020 annual normal",
        "normal_1991_2020","1991–2020 mean annual precipitation",
        "Original PRISM 1991–2020 normal spatial proxy; not a measured annual runoff field."))
periods.append(period("annual_2025","PRISM 2025 annual precipitation",
    "annual_2025","2025-01-01 inclusive to 2026-01-01 exclusive; annual precipitation",
    "Original PRISM 2025 spatial precipitation pattern used as an annual runoff proxy; sensitivity against the selected normal, not a climate-trend or future-projection claim."))
value={"schema":"upstate.climate-management-course/v1",
    "project_id":"1b6a344c-df5a-4986-a5e4-47a2d158324b",
    "title":"Original 5156 management under retained PRISM forcing",
    "purpose":"Compare the original reference and riparian treatment across actual retained annual forcing patterns on the original simulated teaching domain, with independently fixed NOAA erosivity.",
    "source_manifest_directory":str(Path(root).resolve(strict=True)),
    "sources":sources,
    "roles":{
      "reference":{"baseline_run_id":"3a6abae8e11be1efd431271cd477b8e2caa1adf5f730f5266e861a8769be11be"},
      "treatment":{"baseline_run_id":"eec05ecad2039776803cc2760f92f2e1bedcb8244c6808a7af04f2dc73024938"}},
    "periods":periods,"reference_period_id":periods[0]["id"],
    "reporting_areas":[],"difference_maps":True}
out=Path(destination)
with out.open("x",encoding="utf-8") as stream:
    json.dump(value,stream,ensure_ascii=False,indent=2,allow_nan=False)
    stream.write("\n")
print(str(out.resolve()))
PY
```

Only use these IDs when they exist in the received original project. The driver rejects another project or missing/incomplete original runs. For a different genuinely retained programme, deliberately supply that programme's actual project and original role IDs; preserve its scientific scope and labels.

The original matched control is available only if deliberately selected: `7ab4309b9b7d5b93c6decf8412c0648f4dfa5d51ada5591aa5800c3157e8aa53`. Adding it requires the corresponding native forcing case for every period. The default course above contains two roles, not a fabricated control.

## Execute and resume the same accepted operation

Use the installed driver in the existing application. The first call produces `input-review.json` and pins the journal without creating new scientific grids/runs:

```bash
"$ECO_PYTHON" "$ECO_APP/source_tools/receive_climate_management.py" \
  --application "$ECO_APP" \
  --workspace "$ECO_ORIGINAL_WORKSPACE" \
  --state-directory "$ECO_CLIMATE_STATE" \
  --output "$ECO_CLIMATE_OUTPUT" \
  --config "$COURSE_CONFIG"
```

After the actual input review, continue the same command with `--execute`. User authorization for the original native course and the first accepting host's ownership still apply.

```bash
"$ECO_PYTHON" "$ECO_APP/source_tools/receive_climate_management.py" \
  --application "$ECO_APP" \
  --workspace "$ECO_ORIGINAL_WORKSPACE" \
  --state-directory "$ECO_CLIMATE_STATE" \
  --output "$ECO_CLIMATE_OUTPUT" \
  --config "$COURSE_CONFIG" \
  --execute
```

Each accepted task's actual task ID, requested and accepted operation IDs, exact payload, completed result and error state are persisted before waiting. `run.start` receives the original `climate_forcing.run_request` payload, including the native donor/context contract. Existing complete run IDs are verified and reused without another solver submission. The original NativeInputMatcher and stage cache decide which individual stages are scientifically reusable; eligibility is not claimed as an observed reuse result.

Run the same command after a dropped response or shell interruption. Add `--resume-failed` only to resume the original retained failed/interrupted/cancelled task. The script never replaces a queued/running task with another native request. The original Operator owns locking and orderly shutdown; a task wait timeout is not proof that its worker stopped. Preserve its saved task and reconcile it before another issuer acts.

Completed Scientific Report ZIP tickets are re-registered in the new Operator process from their original verified export receipt. Original archive uploads are journaled and reused, avoiding unnecessary repeated large-file ingestion. `receive_upload` itself retains the original stable SHA/filename/media-type identity.

If a reviewed implementation repair changes the Management or Scientific Report preview, `--refresh-incomplete-preview management` or `--refresh-incomplete-preview scientific` retains the failed predecessor and saves the new explicit preview. Only incomplete failed/interrupted/cancelled attempts qualify, and a new observed implementation revision must exist. Completed report effects remain bound to their original request. Source/grid/native phases do not receive replacement previews.

### Annual first, normal later

A one-period configuration performs the two native annual cases and saves their ordinary forcing reports. It returns `single-period-native-complete` with no cross-period Management result. It does not claim the full receiving course complete.

When the original normal source arrives, create a **new configuration and separate receiving state/output** containing both periods. Keep the original source entry files, source root, original role runs and annotations unchanged. Each entry's independent deterministic collection and the original native grid/run identity permit the completed annual cases to be reused. The new full course adds only the missing normal cases and proceeds through Management, report, delivery and reopening. Keep the first course's journal and reports intact.

## What the complete course performs

1. Validates actual project, role runs, source entries, primary rasters and every original companion; freezes their identities.
2. Uses the maintained composer and `Workspace.import_sources` to register each original prepared source.
3. Previews and queues one original Climate study per role, preparing each period through the existing grid/source APIs.
4. Reuses complete cases or queues their exact original native requests, then retains each role's original forcing report.
5. Builds the explicit all-period/all-role Management comparison, including support, signed benefits/interactions, figure data, categorical figures, original arguments, map rasters and complete companions.
6. Uses the existing Scientific Report preview/render/export actions on the Management report's registered source. This produces the original renderer's HTML/PDF, figure/source companions and complete report ZIP.
7. Reads every downloaded member through the original authenticated file ticket and verifies its complete bytes and SHA256.
8. Exports a selected editable Study containing the Management result, every selected Climate family and the Scientific Report edition, then makes a full Workspace backup with intermediates.
9. Downloads, uploads and restores each original archive through the existing Operator. Verifies exact project, frozen study selections/state, native run records, original result/source records, figures and all selected report downloads.
10. Closes the original Operator and starts an independent process using **each archive's copied application**. Reopens the retained products and all downloads again, checks the received Study receipt, and compares its copied application source identities.

The final `climate-management-receiving-result.json` records actual source collections, study IDs, native case IDs/reuse, Management and Scientific Report IDs, all accepted tasks, exact archive/download identities, both received paths and cold-process results. `native-course-complete` is written only after both cold reopens succeed.

A partial result or journal is an actionable continuation record. It is not a substitute for actual native completion or rendered acceptance.

## Open, look at and use the real delivery

The driver verifies native files; it does not claim visual inspection. The producing/receiving operator must open the actual retained application at desktop and a narrow/390 px width and use the original controls:

- Climate: open each original study, inspect the source period/units, exact native arguments and observed reuse status.
- Climate Management: open the saved report; select reporting areas and metrics, review the original period/role matrix, common hectares, exclusions, benefits, interactions and categorical figure labels. Verify that zero and unavailable support remain distinct.
- Scientific Reports: open the actual HTML and **every PDF page**, inspect original figures/source tables, and download the complete source/report files.
- GIS: use the saved Management report's original GIS handoff, retain the full source/companions, inspect layers and units in the existing GIS workflow.
- Study transfer: open both original portable downloads, restore with the native receiver, open the actual copied application, then read/edit the original received study through its maintained desk.
- Open the outgoing SVGs, CSV/JSON, source files, ZIP contents and map rasters in appropriate viewers. Inspect the final media personally; screenshot capture or a source review alone does not establish a successful rendered result.

Keep the exact actual receiving result and final inspected artifacts in the same original source/receiving operation. Do not launch another model or alternative project just to produce a completion message.


## Browser continuation of the completed native course

The maintained browser course is source_tools/receive_climate_management_browser.mjs, with its direct support helper source_tools/climate_management_browser_support.py. Run it after the same native driver records native-course-complete and both actual copied-application reopens. It consumes that exact result and the original journal's complete products snapshot; it does not substitute a new project or make another model request.

Use the existing qualified Python, Node, Playwright module and Chromium. The Python retains the original application dependencies, including rasterio, Fiona, NumPy and Matplotlib. Every actual PDF page is rendered using installed PyMuPDF when available, or an explicitly selected installed pdftoppm executable. A missing PDF renderer is a concrete receiving exception; no page is silently skipped. Preserve the qualified Python invocation path, including a legitimate environment executable link, so its original environment remains active.

Create a control file outside the original application and Workspaces. All values below are actual paths returned by the accepting receiver, not source IDs or replacement example data. Export PDFTOPPM only if that installed executable is needed.

~~~bash
"$ECO_PYTHON" - "$CLIMATE_NATIVE_RESULT" "$ECO_PYTHON" \
  "$ECO_PLAYWRIGHT_MODULE" "$ECO_CHROMIUM" "$ECO_BROWSER_OUTPUT" \
  "$CLIMATE_BROWSER_CONTROL" <<'PY'
import json,os,sys
from pathlib import Path
native,python,playwright,chromium,output,destination=sys.argv[1:]
value={"schema":"upstate.climate-management-browser/v1",
       "native_result":str(Path(native).resolve(strict=True)),
       "python":str(Path(python).absolute()),
       "playwright_module":str(Path(playwright).resolve(strict=True)),
       "chromium":str(Path(chromium).absolute()),
       "output":str(Path(output).absolute())}
if os.environ.get("PDFTOPPM"):
    value["pdftoppm"]=str(Path(os.environ["PDFTOPPM"]).absolute())
with Path(destination).open("x",encoding="utf-8") as stream:
    json.dump(value,stream,ensure_ascii=False,indent=2)
    stream.write("\n")
print(str(Path(destination).resolve()))
PY

"$ECO_NODE" "$ECO_APP/source_tools/receive_climate_management_browser.mjs" \
  "$CLIMATE_BROWSER_CONTROL"
~~~

By default, the course uses the actual journal and copied application/Workspace paths recorded by the native result. If those complete original files have deliberately moved, the same control may provide journal and locations with both selected-study and complete-workspace, each containing the actual application and workspace paths. All original project, native-run, report, download and copied-source identities still have to match. Moving paths does not authorize replacing any source edition.

### What the browser actually operates

For each original received archive, the course calls the unchanged original verify_products and selected-Study receipt verifier, then starts that copied application's original loopback Operator in a separate receiving state directory. It authenticates using that process's actual private session. Private capability URLs are kept in process memory; receiving records contain original product IDs and file identities.

The browser opens every selected Climate study and its actual native-run details, clicks every original report download, and reviews the recorded source periods, normalization and native reuse. It opens the exact Management edition and exercises every area/metric combination, checking that visible signed benefits and interactions match the saved scientific rows. It exercises a temporary editable title and refresh, restores the title, opens the original Study selection and previews its complete source closure. Preview is a read operation; the course does not press export or start new scientific jobs.

The Management GIS button opens the existing GIS desk with its original selected source basket. The browser downloads the complete working choices, checks every original source field and description, opens the same file, and downloads it again to verify an unchanged round trip. It preserves the original title, display CRS, source ordering and documented empty defaults. It does not press Build complete GIS project; creating another GIS edition is a separate original product operation.

The Scientific Reports desk opens the exact already-rendered edition. The course follows every real section anchor, verifies its figures load, downloads every original member and the already-exported ZIP, and checks the report-to-Study selection. Desktop and 390 px views retain the actual tables, controls and horizontal overflow regions. All original run records and copied native source files are checked again after the Operator closes. Browser network guards reject model, preparation, report-build, backup, restore and other mutation submissions.

### Actual attachments and visual review

Every downloaded file is read and checked against its original byte count/SHA256. CSV/TSV rows, JSON, XML/SVG, complete ZIP/ODT/XLSX member inventories and native GPKG layers are opened. ZIP members are read through CRC checking and individually hashed without extracting arbitrary paths. Each PDF page receives its own rendered PNG. Original TIFFs receive a labelled nearest-neighbour display of band 1; this is a display preview, with original dimensions, coordinate system and units retained, and does not calculate or replace scientific model results.

The browser opens the actual HTML, SVG, rendered PDF pages, raster displays and complete text/inventory views. Attachments use an ephemeral 127.0.0.1 static viewer because some equipped hosts block file: navigation. The viewer serves only explicitly selected verified files and generated display files; it excludes Operator state and private capabilities. Complete original relative report companions remain together. External requests are blocked.

The output contains:

- browser-receiving.json: exact native-result/journal binding, both original application paths, actions, downloads, errors and screenshot identities.
- OPEN_BROWSER_RECEIVING.html: the actual original files, all rendered attachment views and desktop/phone captures, ready for human inspection.
- attempts/<id>/: complete receiving downloads, original GIS working choices, PDF pages, raster previews, inventories and screenshots.

The browser output's complete flag means the automated receiving segment completed. Its explicit human-look-required state remains until the producing operator opens and inspects the application and every outgoing attachment. Open editable ODT/XLSX/GIS files in their appropriate original applications; a ZIP inventory does not claim those applications were operated. Preserve this distinction in the final handover.

The output directory holds a single active-course lock. An interrupted attempt stays recorded; rerunning the same control creates a new observation attempt without resubmitting native tasks or rewriting prior captures. A live owner on the same or another recorded host must be reconciled before a second browser issuer starts. Existing native and browser processes remain separately owned.


Document receiving covers the complete rendered document at both viewport widths. The driver records distinct scroll positions and tiles long pages, complete escaped text/CSV displays, PDF page images, figures, and horizontally overflowing table columns; it retains each original file beside those views. Scientific Report section anchors are operated in the actual iframe, then its same original HTML URL is opened in the same authenticated browser context for full-document tiling. The loopback attachment viewer returns an empty successful response for Chromium’s optional `/favicon.ico` request; this does not expose another file. Captures remain evidence for human review, not an assertion that anyone has looked at them.
