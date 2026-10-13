# Regional soil operator desk

**Needs expert review — scientific source interpretation and spatial coverage.**

This installed operator extension connects the maintained regional USDA capture,
native K preparation and HUC12 coverage modules to the existing task queue,
source browser, source object bank and Workspace import/export flow.

## Open and use the desk

Start the existing operator with its normal workspace and registered source
roots. The shared extension registry discovers
`operator/extensions/regional-soil.json` and adds **Regional soil** beside
**Prepare study inputs**. Its source browser reads the same authorized host
roots and imported source collections as the existing preparation desk.

Three operations form the workflow:

1. **Capture the original regional soil.** Select the retained 217-HUC
   `sources.json` with its original companions, or upload the complete original
   domain ZIP. The source identity is checked against
   `upstate-wbd-upstream-domain-20261012` and its retained native geometry SHA256.
   This operation uses the original USDA interpretation metadata already in
   the application. It runs before NLCD preparation.
2. **Continue or adopt the existing soil capture.** Browse to the original
   native capture's `plan.json`. The existing plan supplies its vintage,
   projected CRS, tile size, halo, request page size and rating batch size.
   The task writes to that same capture directory and reuses its retained
   request bodies. For the active GIS12/2799 operation, select that existing
   plan rather than starting another acquisition.
3. **Prepare K and regional coverage.** Choose a completed capture in this
   study, an imported `SOIL_K_NATIVE` source, or the existing native plan.
   Select the original numeric 30 m NLCD reference. An optional original
   reporting polygon allows separate reporting-area coverage. The operation
   prepares K, computes coverage and imports both scientific sources.

The normal task history exposes queued, running, failed, interrupted and
completed work. **Resume** uses the same task identity. Actual USDA progress
reports retained tiles, mapunits received and mapunits rated. No completion
percentage is estimated while the native source has no measured total.

## Scientific selections

The existing regional source selection uses EPSG:5070 capture geometry with
a 1,000 m buffer around the original upstream domain, 15 km capture tiles,
60 m request halo, 128 native geometries per page and 1,000 mapunits per
rating batch. The original domain has 217 HUC12 units; 116 intersect the
reporting area and 101 are additional upstream units. These reporting flags
remain original attributes; an actual reporting polygon is needed for
reporting-area pixel totals.

The regional capture retrieves native whole-soil K using
`chorizon.kwfact`, Dominant Condition / Surface Layer. Original nulls remain
explicit. Preparation applies the customary-to-SI factor 0.1317 once, uses
the actual reference grid and requires 30 m north-up projected cells.

The selectable `nlcd-water-zero` policy gives zero only to unresolved,
non-conflicting pixels identified by numeric NLCD code 11. Unresolved land
and conflicting soil geometry remain NoData. The `preserve` policy retains
all unresolved values. Coverage measures valid K, unresolved land, water,
reference gaps and grid omissions separately.

The coverage result displays the 217-unit counts and unresolved-land/grid
omission counts, and provides the complete JSON summary and per-HUC12 CSV
as ordinary task downloads. Buffered model-domain, original HUC12-union and
selected reporting-area summaries remain distinct. Source maps and the
coverage status raster stay in the imported edition.

## Retention, reuse and transfer

The extension uses the current SourcePreparation object's retained source
bank, immutable selections, checksummed members and Workspace source intake.
A complete capture imports its native geometry, original request bodies,
ratings, survey editions, domain and bindings as `SOIL_K_NATIVE`.
Preparation imports `K_FACTOR` and `SOIL_SOURCE_COVERAGE` together.

Completed capture banks travel with the Workspace. A receiving operator can
prepare them on a selected reference without retrieving the USDA bodies
again. Imported native captures retain the same path-relative companions,
so the desk can also use a capture selected from an existing source edition.

Native capture locations are indexed by original domain bytes, original
manifest bytes, scientific choices and interpretation metadata. Tasks for
the same selection share that capture location and its native lock. An
explicitly adopted existing capture is registered in the same index. Native
capture locks remain authoritative when another process is using that plan.

The extension's task and selection records live in
`WORKSPACE/regional-soil/TASK/`; native task work lives below
`OPERATOR/regional-soil/PROJECT/TASK/`. Capture-location indexes live below
`OPERATOR/regional-soil/captures/`. Temporary and unfinished native bodies
remain at the original capture path for the existing recovery operation.

## Installed interface

| Surface | Contract |
|---|---|
| Backend | `operator/regional_soil.py:RegionalSoil` |
| Shared UI | Configurable `createSourceWorkbench(host, configuration)`; existing defaults preserved |
| Regional UI | `operator/web/regional_soil.mjs:createRegionalSoilDesk` |
| Task actions | `regional-soil.prepare`, `regional-soil.compose` |
| Read routes | `/api/regional-soil/catalog`, `files`, `progress`, `result` |
| Methods | `regional-capture`, `regional-continue`, `regional-prepare` |
| Composition | Same source manifests and Workspace import as generic source preparation |

Actions use the existing `/api/actions` request envelope, real workspace
key and an ordinary operation ID. Their payload includes `method`,
`inputs`, `options`, optional `title` and `import_sources`.
Input selectors are the existing root/path, upload, bundled-reference or
collection/source selectors. Resume/cancel are the normal task endpoints.

Capture requires Shapely and pyproj; raster preparation and coverage also
use NumPy, Rasterio/GDAL and Fiona. The code composes the installed native
modules and their dependency environment. It introduces no paid runtime,
alternate task server or new simulation method.

## Source lineage and current operation

This desk builds on SourcePreparation 61,705 bytes, SHA256
9688464f33d224c0b375bdf0a5df7fa847b3f767f5923e797eab3760fae03850,
and the original shared workbench 53,230 bytes, SHA256
eb5d340e5a978c609613c226520a99c9a1107877de7f3aeb1958d5046ad89ffb.

The soil modules are the complete maintained eight-file component
F0C88M55E79, including the coverage successor merged in public PR2716.
Regional capture source selection is retained in Slack source reply
1791849808.106779 and the current same-capture assignment
1791854465.082639. The operator desk claim is Sales1791858095.790919.

The generic SourcePreparation backend remains the current installed owner
edition. The shared UI change adds configuration and a data-only result
summary; existing actions, routes, storage keys and default copy remain
unchanged. Registry discovery installs the regional descriptor without
editing server or application boot files.
