# Regional terrain and climate: complete source receiving course

This course supplies the original terrain, PRISM and NOAA source tools needed by the existing Upper Savannah application. It completes the same regional intake, `ES-20261012-RECOVERY-SCIENCE-2329`, using the receiver's existing GIS interpreter, retained inputs and original regional Workspace. The complete owner direction `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`, applies to this existing course and is reproduced below. Native execution of the actual-geography simulated case remains the immediate priority with its current producer; this terrain/climate source work advances alongside it without occupying its scientific Workspace. The owner sprint cutoff is **14:00 UTC on 13 October 2026**.

The adjacent `source-bank.json` contains **40 original files / 501,902 UTF-8 source bytes** from application commit `20cb09d8831bed229f75b268830d8c93f008c85c`: twelve source modules, the complete nine-tile USGS metadata inventory and eighteen original XML/index bodies, original PRISM/NOAA transfer metadata, and the complete current owner instruction. Each member has its original Git object, byte count and SHA-256. Bank SHA-256: `ddcf1b3102f0c364ecb5ee42ac4b587d0fca12a91790f2409f43d225ff6e96dc`.

The bank is a source-family supplement to an existing complete application. The receiver's `model.common`, `model.rasters` and `model.workspace` remain its maintained shared implementation. The source commands below explicitly check their relevant functions and actual imports before a dependent phase. The course does not install an old application or use the component assembler bootstrap.

## Keep the original operation and actual inputs

First reconcile the original terrain log/PID in the receiving thread. Reuse an admitted acquisition, original store and saved plan. The previous DD6B store was `/workspace/scratch/dd6ba48a0dcb/source-inputs/terrain-native`; use it only where it actually exists on the receiving host. An absent path on another host is not a completed transfer.

Set these variables to the receiver's actual paths. Use ordinary persistent disk for the source store and prepared rasters. Keep the staged source bank separate from both the application and the scientific Workspace.

```bash
export APP=/absolute/path/to/current/upstate_forever_2026
export GIS_PYTHON=/absolute/path/to/existing/gis/python
export PROJECT_ROOT=/absolute/path/to/original/regional-source-operation
export NATIVE_WORKSPACE=/absolute/path/to/original/regional-workspace
export BANK=/absolute/path/to/source-bank.json
export TOOLS="$PROJECT_ROOT/terrain-climate-source-ddcf1b3102f0c364"
export TERRAIN_STORE="$PROJECT_ROOT/terrain-native"
export GDAL_CACHEMAX=64
export GDAL_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export OMP_NUM_THREADS=1
```

Use the already received corrected 2025 NLCD raster and original 217-HUC domain. The corrected NLCD body is 9,443,751 bytes, SHA-256 `3fa517b4cc3251b9e1bd31e51b54b036a875c09e5f1075511da7c8e951656670`; the original domain body hash is `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`. Collection IDs are the actual receiving Workspace's IDs. Preserve the regional **1,000 m** buffer. The source reference raster and maintained grid writer determine the final CRS, transform and extent; the old EPSG:5070 acquisition-plan bounds are not a replacement model grid.

## Stage the complete original source family

The following standard-library command checks the bank and every original file, including the original Git object hash, before publishing the separate source directory. Re-entry verifies the same completed directory. It does not replace application modules.

```bash
"$GIS_PYTHON" -I -B - "$BANK" "$TOOLS" <<'PY'
import hashlib, json, os, shutil, stat, sys, tempfile
from pathlib import Path, PurePosixPath

bank = Path(sys.argv[1]).resolve(strict=True)
target = Path(sys.argv[2]).absolute()
expected = "ddcf1b3102f0c364ecb5ee42ac4b587d0fca12a91790f2409f43d225ff6e96dc"
raw = bank.read_bytes()
if hashlib.sha256(raw).hexdigest() != expected:
    raise ValueError("Select the exact complete terrain/climate source bank")
data = json.loads(raw)
if data["schema"] != "commons.source-bank/v1" or data["file_count"] != 40:
    raise ValueError("Unexpected source bank")
prepared = {}
for item in data["files"]:
    name = PurePosixPath(item["path"])
    if (name.is_absolute() or not name.parts or any(x in ("", ".", "..") for x in name.parts)
            or str(name) != item["path"] or "\\" in item["path"] or item["encoding"] != "utf-8"
            or item["mode"] != "100644" or item["path"] in prepared):
        raise ValueError("Invalid or duplicate source member")
    body = item["content"].encode("utf-8")
    if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
        raise ValueError("Source bytes differ: " + item["path"])
    git = hashlib.sha1(b"blob " + str(len(body)).encode("ascii") + b"\0" + body).hexdigest()
    if git != item["git_blob"]:
        raise ValueError("Original Git object differs: " + item["path"])
    prepared[item["path"]] = body
if len(prepared) != 40 or sum(map(len, prepared.values())) != data["source_bytes"]:
    raise ValueError("Incomplete source family")
inventory = json.loads(prepared["source/terrain/20261013/inventory.json"])
for item in inventory["retained_members"]:
    body = prepared[item["path"]]
    if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
        raise ValueError("Original terrain metadata differs")
target.parent.mkdir(parents=True, exist_ok=True)
if target.is_symlink():
    raise ValueError("Use an owned regular source directory")
def verify(folder):
    for name, body in prepared.items():
        path = folder / name
        if (path.is_symlink() or not path.resolve(strict=True).is_relative_to(folder.resolve())
                or not stat.S_ISREG(path.stat().st_mode) or path.read_bytes() != body):
            raise ValueError("A staged original source changed: " + name)
if target.exists():
    verify(target)
else:
    temporary = Path(tempfile.mkdtemp(prefix="terrain-source-", dir=target.parent))
    try:
        for name, body in prepared.items():
            path = temporary / name
            path.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
            try:
                view = memoryview(body)
                while view:
                    written = os.write(descriptor, view)
                    if written <= 0:
                        raise OSError("Source write made no progress")
                    view = view[written:]
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        verify(temporary)
        os.rename(temporary, target)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
print(json.dumps({"state": "source_staged", "source_bank_sha256": expected,
                  "source_directory": str(target.resolve()), "files": len(prepared),
                  "source_bytes": sum(map(len, prepared.values()))}))
PY
```

Read the complete staged `AGENTS.md` and retain those owner instructions in this active receiving assignment. Where the installed application's owner file has newer text, preserve it. The banked owner body is Git `46be323017be913780d0d2850b7658861744508d`, with SHA-256 `27e178ba2e5769624667016941c40c8eca9b202752c64c6283ca0be92184da9c`. Keep existing policies; do not replace newer instruction files with a historical copy.

## Invoke original modules against the actual receiving application

Define this shell function once in the receiving shell. It directs only the carried `source_tools` family to its verified directory and leaves all shared model imports in the actual installed application. It does not launch a service, a scheduler or a model.

```bash
native_source() {
  "$GIS_PYTHON" -I -B - "$APP" "$TOOLS" "$@" <<'PY'
import importlib, inspect, json, runpy, sys
from pathlib import Path

app, source = [Path(x).resolve(strict=True) for x in sys.argv[1:3]]
action, arguments = sys.argv[3], sys.argv[4:]
sys.path.insert(0, str(app))
package = importlib.import_module("source_tools")
if not Path(package.__file__).resolve().is_relative_to(app):
    raise ValueError("source_tools did not load from the selected application")
package.__path__.insert(0, str(source / "source_tools"))
modules = [
    "terrain_catalog", "terrain_io", "terrain_prepare", "terrain_workspace",
    "terrain_cli", "terrain_portable", "terrain_report",
    "raster_sources", "source_transfer", "erosivity_sources", "climate_region",
]
allowed = {"terrain_cli", "raster_sources", "erosivity_sources", "climate_region"}
if action.startswith("check-"):
    phase = action.removeprefix("check-")
    if phase not in {"acquire", "prepare", "climate"}:
        raise ValueError("Select check-acquire, check-prepare or check-climate")
    selected = (["terrain_catalog", "terrain_io", "terrain_prepare", "terrain_cli", "terrain_portable"]
                if phase == "acquire" else modules)
    loaded = {}
    for name in selected:
        module = importlib.import_module("source_tools." + name)
        path = Path(module.__file__).resolve()
        if not path.is_relative_to(source):
            raise ValueError("An original source module is missing: " + name)
        loaded[module.__name__] = str(path)
    dependencies = ["numpy", "rasterio", "pyproj"]
    if phase == "prepare":
        dependencies += ["fiona", "shapely", "affine", "PIL.Image"]
    if phase == "climate":
        dependencies += ["affine"]
    for name in dependencies:
        importlib.import_module(name)
    if phase != "acquire":
        from model import common, rasters
        for module in (common, rasters):
            if not Path(module.__file__).resolve().is_relative_to(app):
                raise ValueError("Shared model did not load from the selected application")
            loaded[module.__name__] = str(Path(module.__file__).resolve())
        names = ("atomic_bytes", "atomic_json", "describe_file", "digest", "file_digest",
                 "held", "now", "read_json", "relative_file", "retain_file", "verify_file")
        for name in names:
            if not callable(getattr(common, name, None)):
                raise ValueError("Receiving model.common lacks " + name)
        for name in ("vector_geometry", "polygon_union", "grid_definition", "align_source"):
            if not callable(getattr(rasters, name, None)):
                raise ValueError("Receiving model.rasters lacks " + name)
        signature = inspect.signature(rasters.align_source)
        for name in ("conversion", "checkpoint_directory", "source_identity"):
            if name not in signature.parameters:
                raise ValueError("Receiving raster aligner lacks " + name)
        if phase == "prepare":
            from model.workspace import Workspace
            for name in ("source_file", "sources", "import_sources"):
                if not callable(getattr(Workspace, name, None)):
                    raise ValueError("Receiving Workspace lacks " + name)
            loaded["model.workspace"] = str(Path(inspect.getfile(Workspace)).resolve())
    print(json.dumps({"state": "source_imports_ready", "phase": phase,
                      "interpreter": sys.executable, "application": str(app),
                      "modules": loaded, "native_imports": dependencies}, indent=2))
else:
    if action not in allowed:
        raise ValueError("Select one of the retained source command modules")
    module = "source_tools." + action
    found = importlib.util.find_spec(module)
    if not found or not Path(found.origin).resolve().is_relative_to(source):
        raise ValueError("Selected command did not resolve to the retained original")
    sys.argv = [module, *arguments]
    runpy.run_module(module, run_name="__main__")
PY
}
```

The import checks cover conditional dependencies used by this course. In particular, terrain preparation calls the carried `terrain_report` renderer and actual Pillow, the saved-domain reader uses Fiona, and the PRISM handoff calls the installed `retain_file`/atomic writer. Climate alignment uses the installed windowed aligner, including its checkpoint and source identity parameters. Its unrelated scenario and priority-statistics functions are not invoked by this course. A missing shared API should be repaired in the existing maintained application; preserve its current full source and all scientific records.

## Receive the nine original USGS terrain tiles

```bash
native_source check-acquire
native_source terrain_cli --store "$TERRAIN_STORE" discover \
  --bounds -83.89 33.32 -81.47 35.27 \
  --title "Upper Savannah retained 3DEP source edition"
```

Keep discover's actual `catalog_path`. If the original catalogue already exists, use that retained catalogue rather than manufacture a new identity. Then:

```bash
native_source terrain_cli --store "$TERRAIN_STORE" acquire \
  "$TERRAIN_STORE/$ACTUAL_CATALOG_PATH" --workers 2
```

The retained edition lists **nine original TIFFs totaling 519,255,250 bytes**, covering n34/n35/n36 × w082/w083/w084. Original GeoPackage/XML companions add about 3.2 MB. The source units are metres and the vertical datum is NAVD88; retain each tile's actual publication and acquisition dates. The current publisher directory is `https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/1/TIFF/current/`.

An acquire command can exit normally with `state: interrupted` and individual tile errors: read its JSON before proceeding. Reinvoke the same catalogue to resume retained HTTP entities. Select only the actual completed tile source IDs. If current publisher bytes or metadata differ from the original inventory, retain the actual new edition and describe that change; do not label it the original frozen edition.

## Prepare the exact regional DEM and import its original source record

Use the actual collection/source IDs opened in the existing Workspace. The reference source is the corrected native NLCD raster, and the domain source is the original 217-HUC domain. If a source collection contains more than one edition, pass each selected acquired `--source-id` explicitly.

```bash
native_source check-prepare
native_source terrain_cli --store "$TERRAIN_STORE" plan-workspace \
  --workspace "$NATIVE_WORKSPACE" \
  --reference-collection-id "$NLCD_COLLECTION_ID" --reference-source-id "$NLCD_SOURCE_ID" \
  --domain-collection-id "$DOMAIN_COLLECTION_ID" --domain-source-id "$DOMAIN_SOURCE_ID" \
  --buffer-m 1000 --resampling bilinear --chunk-size 1024
```

Retain this command's complete JSON as `$PROJECT_ROOT/terrain-plan.json`, with its actual `plan_id` and `grid`. For an already saved plan, reuse its exact original JSON and plan ID. Then:

```bash
native_source terrain_cli --store "$TERRAIN_STORE" prepare "$TERRAIN_PLAN_ID" \
  --workspace "$NATIVE_WORKSPACE" --progress
```

The normal result contains the actual DEM path/hash, source manifest and Workspace source collection/source IDs. Its inspector is `prepared/<plan_id>/inspector/report.html` beneath the terrain store. The producer keeps source footprints, native bounds/CRS, vertical datum, coverage and nodata, and does not fill gaps silently. Preparation uses disk-backed windows/chunks; process-level GDAL limits above also cover the initial normalization and final assembly. Native NDR/SDR execution remains the existing model operation after its real source roles are complete.

## Reuse original PRISM and NOAA archives on that same grid

Use the original already retained archives. The source bank contains their completed transfer descriptors and NOAA metadata, not the archive bodies.

| Input | Original bytes | Original SHA-256 |
| --- | ---: | --- |
| PRISM 1991–2020 annual precipitation, nominal 800 m | 62,685,097 | `763f97b677711112ff7b1082c794476e2d9b7abe1f6e55dd4f1166e32523ccd3` |
| NOAA CONUS R-factor, 2013 publication | 47,143,128 | `157bbcaa54b445f96506fb1caffda4bbaea6b28f71bc7199235705e69cd00596` |

Set `PRISM_ARCHIVE` and `NOAA_ARCHIVE` to their actual existing files. The original producers verify those files against the completed transfer records and retain their companions. Existing prepared source-entry directories can be reused directly; do not repeat a completed intake.

```bash
native_source check-climate
native_source raster_sources prism --output "$PROJECT_ROOT/prism" \
  --archive "$PRISM_ARCHIVE" \
  --transfer "$TOOLS/source/prism-precipitation-1991-2020/source-transfer.json"

native_source erosivity_sources receive --output "$PROJECT_ROOT/r-factor-capture" \
  --archive "$NOAA_ARCHIVE" \
  --transfer "$TOOLS/source/noaa-r-factor-conus-2013/source-transfer.json" \
  --metadata "$TOOLS/source/noaa-r-factor-conus-2013/metadata.html" \
  --metadata-receipt "$TOOLS/source/noaa-r-factor-conus-2013/metadata.html.capture.json"

native_source erosivity_sources prepare --output "$PROJECT_ROOT/r-factor" \
  --capture-directory "$PROJECT_ROOT/r-factor-capture"

native_source climate_region --project-root "$PROJECT_ROOT" \
  --grid "$PROJECT_ROOT/terrain-plan.json" \
  --precipitation-entry "$PROJECT_ROOT/prism/source-entry.json" \
  --erosivity-entry "$PROJECT_ROOT/r-factor/source-entry.json"
```

Both original preparers write `source-entry.json` at the specified output directory. Keep the selected grid, prepared entries, original files and companions beneath `PROJECT_ROOT`, as the climate importer checks this containment. It writes a normal `upstate.sources/v1` manifest and returns its exact path/hash and regional source IDs. Import that manifest using the existing Workspace's source import, reusing an identical original-manifest SHA if already imported.

Set `CLIMATE_MANIFEST` to that returned manifest path, then complete its ordinary Workspace import:

```bash
"$GIS_PYTHON" -I -B - "$APP" "$NATIVE_WORKSPACE" "$CLIMATE_MANIFEST" <<'PY'
import json, sys
from pathlib import Path
app = Path(sys.argv[1]).resolve(strict=True)
sys.path.insert(0, str(app))
from model.workspace import Workspace
from model.common import file_digest, read_json
workspace = Workspace(sys.argv[2])
manifest = Path(sys.argv[3]).resolve(strict=True)
original = read_json(manifest)
stamp = file_digest(manifest)
same = [x for x in workspace.sources()
        if x.get("original_manifest", {}).get("sha256") == stamp]
collection = same[0] if same else workspace.import_sources(manifest)
received = []
for entry in original["entries"]:
    path, saved = workspace.source_file(collection["id"], entry["id"])
    if file_digest(path) != entry["sha256"]:
        raise ValueError("Received climate input differs")
    received.append({"source_id": saved["id"], "role": saved["role"],
                     "path": str(path), "sha256": saved["body"]["sha256"], "units": saved["units"]})
print(json.dumps({"state": "sources_received", "workspace_id": workspace.project["id"],
                  "source_collection_id": collection["id"], "manifest_sha256": stamp,
                  "reused": bool(same), "entries": received}, indent=2))
PY
```


PRISM's nominal 800 m source information remains explicit after alignment to 30 m. NOAA's original 1975–1997/AH703 source lineage and 2013 publication remain explicit. Its unit conversion is **17.02 times the original band scale, once**, from original US erosivity units to MJ·mm/(ha·h·year), applied by the maintained aligner. The regional output has SI units and no second pending conversion. Retain the source band scale, conversion reference and actual original resolutions.

## Complete the original source delivery and recipient inspection

Open the populated terrain inspector and operate its map, source selection and downloads. Inspect actual prepared DEM/coverage, the nine native source footprints, original metadata and the climate source entries. Use the existing native terrain `pack` and `receive` commands for its portable source delivery:

```bash
native_source terrain_cli --store "$TERRAIN_STORE" pack "$TERRAIN_PLAN_ID" \
  --output "$TERRAIN_ARCHIVE"
native_source terrain_cli receive "$TERRAIN_ARCHIVE" \
  --output "$INDEPENDENT_TERRAIN_RECEIVE" --sha256 "$ACTUAL_TERRAIN_ARCHIVE_SHA256"
```

Use the pack result's actual archive hash and a receiving destination for this source delivery. Open the received inspector and its contained numeric/source downloads. The normal regional Workspace source import remains editable through the original application.

The producing seat follows the complete banked/current owner instructions for all outgoing attachments: literally open and use the final populated HTML, relevant PDF pages, tables, maps, images and project/archive contents; view the actual pixels and operate important controls, downloads and reopen flows. Check desktop/screenshare and narrow layouts where relevant. Fix broken, cramped, clipped or unreadable output with plain industrial presentation. Screenshots captured without viewing, source inspection, metadata, HTTP success and peer review do not replace recipient use. For media, use available natural professional generative TTS and actually watch/listen for pronunciation, pacing, timing and alignment, preserving attribution, licences and authorization. Preserve current application/workspace identities and completed results; no restart, watcher or new execution queue is introduced.

Return actual host/interpreter, admitted PID/log or first exception in the same terrain thread, followed by acquired source IDs, the exact grid and completed DEM/climate paths. A source package, import check and finished numeric preparation are separate states; record the actual stage reached. Preserve all completed work at the owner's 14:00 UTC cutoff.

## Complete current owner direction

Original application path: `CURRENT_OWNER_DIRECTION.md`; Git object `8cd1c1f3d371a2fb75471813844e31f489aa8272`. Carry this complete text onward in the same active worker assignment, preserving later owner updates.

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Current project instructions

Execute the prepared simulated model and deliver a relevant, usable application and presentation that demonstrate the actual work and elapsed delivery time. Continue active work while checking progress. Carry the current demonstration, presentation and Ecosystem instructions through the existing coordination surfaces and onward to participating workers.

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.
