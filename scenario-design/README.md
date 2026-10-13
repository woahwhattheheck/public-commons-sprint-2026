# ECO Scenario Design

An offline field-geometry and explicit-input authoring workbench. It complements the maintained ECO Python Workspace, scenario compiler and experiment/results consoles: design original field inputs here, then use the original ECO pipeline to evaluate them.

## Start

Python 3.10+ with Shapely 2.x and pyproj 3.5+ is required. The browser has no network dependencies, map tiles, telemetry, API keys, build step or package manager.

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python server.py --workspace ./saved-designs --port 8848
```

Open `http://127.0.0.1:8848` in a browser on that machine. The service binds loopback. Keep the original model server on its existing port; this additive editor is independent of its renderer and routes. Use `python` rather than `python3` on Windows, and activate `.venv\Scripts\activate` there.

## Complete operator workflow

1. **Import fields** loads the original WGS84 GeoJSON FeatureCollection. Use the maintained native workspace's exact field dataset when preparing native registration. Original features, identifiers, unrelated properties, multipart polygons, holes and Z coordinates remain in the saved baseline.
2. **New** creates an independently editable alternative. Give it a name and design intent. The baseline itself is not editable.
3. Select a field. **Bind** turns a chosen numeric source property into an explicit control with a label, units and optional limits. Changes do not run a response formula. Add a field note and inspect the complete before/after ledger.
4. **Edit vertices** exposes vertices for every polygon part and hole. Drag to move, double-click an edge to insert, or select a vertex and press Delete. **Edit coordinates** supports complete Polygon/MultiPolygon JSON. Invalid rings, self-intersections and implausible longitude wrapping are rejected before saving.
5. **Draw polygon** creates an additional field with a unique identifier. Its name and identifier are editable in the inspector. Excluding a field changes only that alternative. Use duplicate, undo/redo, baseline outline and fit/zoom/pan as needed.
6. **Save** persists a revision. Autosave also runs after editing pauses. **Projects** reopens saved work; **Revisions** receives an earlier revision as a separate editable project. Browser recovery and **Local copy** retain unsaved work across interrupted sessions.
7. **Export handover** sends the complete project, original parsed GeoJSON, every realized alternative, full action ledger, standalone HTML summary and checksums. **Receive project** verifies the ZIP and creates a new project identity; subsequent receiving-side edits leave the sender unchanged. The JSON local copy is also receivable.
8. **ECO scenario** exports a native plan. Confirm every original-property-to-native-factor mapping. Choose original `field_id` or GeoJSON `id` selectors. Geometry changes select a separately received input edition. Use the native bridge below to complete registration or receiving.

## Current Upstate conservation scenarios

Choose **Import saved plan** to receive the original complete conservation binding, edit an independent geometry alternative, and export a complete **Land-cover scenario** handover. `conservation.py` uses the current original `Workspace.import_sources`, `save_scenario` and `prepare_run` interfaces, preserving selected native IDs, source editions, projected-area context and original binding bytes. See [CONSERVATION.md](CONSERVATION.md) for browser/CLI operation and exact native receiving.

## Earlier v5 field-factor bridge

The interface is the maintained v5 `model.scenarios.scenario_from_dict` → `Workspace.put_scenario` contract documented in the private ECO source canvas `F0C8F3MKR3M`. Native actions have this shape:

```json
{
  "kind": "set_factor",
  "layer": "fields",
  "selector": {"field_id": ["A1"]},
  "params": {"factor": "forest_density_multiplier", "value": 0.9}
}
```

The bridge preserves original identifier types and checks uniqueness across the effective field population. It will not silently omit an edited control that lacks a mapping. Create a mapping file, for example `factor-map.json`:

```json
{"forest_density_multiplier": "forest_density_multiplier"}
```

The names must come from the actual maintained model configuration. The example is the published v5 forest-density factor; other source properties need their own correct factor names. Alternative IDs are in `project.json`, not their editable display names.

Create a complete native plan without writing a native workspace:

```sh
python eco_bridge.py editable-project.json \
  --alternative alt_YOUR_ID --factor-map factor-map.json \
  --output native-plan.json
```

Register a factor-only alternative through the original maintained writer:

```sh
python eco_bridge.py editable-project.json \
  --alternative alt_YOUR_ID --factor-map factor-map.json \
  --eco-source /path/to/ecodss/python/source \
  --native-workspace /path/to/saved/native/workspace --register
```

Use the exported ZIP in place of `editable-project.json` for direct verified receiving. The source field dataset must match the imported baseline. Scenario IDs are content-derived and repeat registration is idempotent; conflicting existing IDs are never overwritten. This operation adds a scenario to the selected workspace through its original writer. Do not run a concurrent native manifest edit during this file-writer operation.

For reshaped, added or excluded fields, receive a separate complete native input edition:

```sh
python eco_bridge.py editable-project.json \
  --alternative alt_YOUR_ID --factor-map factor-map.json \
  --materialized-inputs \
  --eco-source /path/to/ecodss/python/source \
  --native-workspace /path/to/saved/native/workspace \
  --receive-workspace /path/to/new/geometry-edition
```

Every original workspace file is copied. The new edition retains the original workspace manifest, original field bytes and full editable design under `design-handover/`. Its field dataset expresses the geometry/inclusion changes; numeric changes remain native `set_factor` actions. A derived dataset ID and source provenance distinguish this changed input population. Only its intended new scenario is registered, rather than relabeling original scenarios over changed geometry. Original model and uncertainty parameters are preserved. New destination creation is exclusive and existing destinations are refused. Datasets must reside inside the original workspace and symlinks must be resolved to ordinary portable files first.

The receiving bridge does not start model runs. Open the received edition in the maintained ECO Workspace and evaluate it with the same original experiment runner used by the rest of the product. Pairing/independent-evaluation rules and calibrated data remain the responsibility of that original evaluation workflow.

## Storage and portability

`--workspace` contains `projects.sqlite3`, using SQLite WAL and transactionally retained revisions. Each save supplies an expected revision. A stale browser gets an explicit conflict rather than overwriting newer work. Original baseline changes are refused for existing projects. To back up a live store, use SQLite's backup API or stop the editor and copy its workspace; do not copy only the main database while WAL writes are active.

Export without starting HTTP:

```sh
python server.py --workspace ./saved-designs \
  --export PROJECT_UUID --output editable-handover.zip
```

`baseline.geojson` preserves the parsed original collection, not its input whitespace. Original input byte hashes identify source text when available. Integral floating-point JSON values are canonicalized consistently with browser JSON serialization before hashing, so `1.0` and `1` cannot create a false immutable-baseline conflict.

## Geometry and operating range

Input is WGS84/CRS84 longitude/latitude Polygon or MultiPolygon GeoJSON. There is no automatic CRS guessing or reprojection. Areas are ellipsoidal geodesic measurements from pyproj; displayed totals sum field areas and include overlap. This is a regional planar editing view with geodesic measurement, not a global/antimeridian editor. Imported collections must span less than 180 degrees longitude. The engine admits up to 25,000 features, 1,000,000 vertices, 100 alternatives and 250 parameter bindings; these are validation ceilings, not measured interactive performance guarantees. Requests and project ZIPs have explicit size limits. Search narrows the field list; the first 500 matching field labels are rendered.

## Engineering checks

```sh
python tests/test_journey.py
python tests/test_native_bridge.py
python tests/test_conservation_journey.py
node --check web/app.js
```

The two native-adapter tests use the exposed v5 writer contract and real filesystem receiving. They do not load the complete installed ecological modeling dependency tree. The editor test journey covers full export/receiving, geometry parts/holes/Z, revisions, input validation and tampering.

Optional Chromium/Playwright GUI journey, with this editor running on port 8848:

```sh
python tests/browser_journey.py
```

The automated GUI test loads the original application DOM/JS into an offline browser document and forwards fetches through Python to the actual HTTP server. This leaves managed Chromium network policy unchanged. It exercises pointer editing, polygon drawing, controls, saving, actual Blob downloads, handover receiving and independent editing. Direct Chromium navigation to loopback in the build container returned `ERR_BLOCKED_BY_ADMINISTRATOR`; the browser test transport is described explicitly rather than reported as direct navigation. Desktop and phone-width screenshots were visually inspected.

## Integration placement

Keep this directory additive as `scenario-design/` alongside the maintained ECO Python source. Link the original workbench navigation to this editor's operator URL; no replacement renderer, schema rename or copied modeling engine is needed. For the current Upstate application, use `import_binding`, `export_landcover` and `register_landcover` in `conservation.py`; see CONSERVATION.md. The separately named earlier field-factor entry points are `compile_plan`, `register_original` and `receive_materialized` in `eco_bridge.py`. The revision store closes each per-request SQLite connection after commit/rollback.

## Larger-project throughput

Repeated unchanged geometry validation and geodesic measurement now share a content-keyed summary cache. Changed coordinates always get a new validation. Entries retain only geometry keys up to 16 KiB and numeric summaries, with an 8,192-entry ceiling; returned results are defensive copies. `GET /api/health` includes hit/miss/entry counters. This does not cache model outputs or change the ecological pipeline.

On the included complete 2,500-field / six-alternative capacity journey, separate cold Python processes measured **21.129 → 8.690 seconds** (58.9% lower elapsed time). The initial save measured **2.361 → 0.789 seconds**. Peak RSS was **142,252 → 144,128 KiB**. The journey includes full source construction, revision saving, all-alternative export, verified receiving, independent edits and native-plan compilation. These are one-run observations on authored editor workloads; `PERFORMANCE.json` records the environment and each stage.

```sh
python tools/capacity_journey.py
```
