# Official ARJWS / PRWD public-water source integration

This supplement feeds the current receiving-water implementation with the two RFP utilities' actual public intake records and published protection polygons. It also corrects the NRCS table entry in the earlier eight-file source package so the existing source viewer opens the typed CSV.

## Captured utility identities

| Utility | Public system | Intake | Intake OBJECTID | Protection OBJECTIDs |
| --- | --- | --- | --- | --- |
| Anderson Regional Joint Water System | SC0420011 | S04101 | 6 | 11: 1500 ft; 12: 200 ft |
| Pioneer Rural Water District | SC3720001 | S37109 | 50 | 131: 1500 ft; 132: 200 ft |

The source is SCDES Public_Water_Supply:
https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer

All captured public-water layers use EPSG:26917. Intake source PWSNO includes the SC prefix; protection source SYSTEM omits it. Both utilities' captured public-system and intake status fields equal A. The complete intake query contains 71 original points and the complete protection attribute inventory contains 136 original records.

The source's published description defines its surface-water protection areas as 15 miles upstream of the intake. BUFFER_FT separately distinguishes the 200-foot and 1500-foot feature records. Retain both attributes and original polygons. The receiver's source_area relation uses each complete polygon without constructing an additional buffer. The existing family union handles overlapping footprints once for family totals.

## Run the complete native receiving operation

The existing model Workspace and its complete delivery selection can run through the entire retained source path with one command:

```bash
/opt/pyvenv/bin/python source_tools/receive_designation_delivery.py \
  --workspace /ABSOLUTE/PATH/TO/EXISTING/WORKSPACE \
  --delivery /ABSOLUTE/PATH/TO/current-complete-delivery-selection.json \
  --output /ABSOLUTE/PATH/TO/designation-operation
```

The command imports the bundled public sources, prepares the four utility receptors, saves the two separate and combined utility choices, receives the complete 377-feature river case, verifies its saved selections and archive, then imports the actual river selection into the model Workspace and builds the combined delivery with the original engine.

The output is an input-specific request directory containing the full operation journal, every issued command and its stdout/stderr, the input selection, the actual saved source/selection IDs, the original seven-map delivery result and its source table. The same input returns to the same request directory. Re-running uses the original commands and their retained objects and caches, with a new attempt log; an active operation holds the original application's exclusive file lock. Different input delivery bytes select a new request directory.

For the actual browser journey, the running operator must already expose that model Workspace. Add its retained startup JSON, the existing browser executable and, when needed, its registered Workspace key:

```bash
  --operator-start /ABSOLUTE/PATH/TO/operator-start.json \
  --workspace-key ACTUAL_REGISTERED_MODEL_WORKSPACE_KEY \
  --browser /usr/bin/chromium
```

The browser opens the real saved designation, retains its complete source/rule association, traverses the installed Map atlas or original delivery editor, and submits the original delivery build. Its screenshots, complete exports, native task result and browser report remain under the same operation directory. Use `--playwright-path` when the existing Playwright package needs an explicit import path; `--timeout-seconds` controls the browser's native-build wait.

The individual commands below remain available for an existing receiver that has already completed part of this operation.

## Original polygon source

The complete original four-polygon response is bundled at `raw/scdes-arjws-prwd-source-water-protection-original.json`. Its 2,389,556 bytes retain SHA256 `ddac0feb1c704ca5e95336e21961e08beede1f83b6b820423dffa5a63bd8e285`, the native EPSG:26917 coordinates, and original OBJECTIDs 11, 12, 131 and 132. `sources.public-native.json` binds that exact local file together with the original intake response and publisher metadata.

The retained source attachment and metadata are also available on:
https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e

The source dictionary retains its original attachment reference and exact official query URL. The bundled bytes let the native importer use this retained edition directly. To recover the same captured edition from the attachment, use its current ordinary download URL and verify the recorded byte count and SHA256 before use. A later live service response is a separate edition if its bytes differ.

Exact original query:
https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2/query?objectIds=11,12,131,132&outFields=*&returnGeometry=true&orderByFields=OBJECTID&f=pjson

The package itself includes the complete 25,984-byte original intake source, all 136 original protection attribute rows, full layer 0/2/3 metadata, and a complete layer 3 polygon example. The well example belongs to CAMP GRAVATT (SYSTEM 0270677); the named RFP utility plan uses their actual surface-water sources.

## Prepare the native source-water plan

The complete bundled-source route uses the existing native GIS interpreter and existing Workspace:

```bash
/opt/pyvenv/bin/python source_tools/prepare_public_source_water.py \
  --model-root /ABSOLUTE/PROJECT/ROOT \
  --workspace /ABSOLUTE/PATH/TO/EXISTING/WORKSPACE \
  --out /ABSOLUTE/PATH/TO/public-water-native
```

This imports `sources.public-native.json`, binds the actual returned source collection, prepares all four original source-area receptors, and writes `public-water-preparation.json`, `receiving-waters-spec.json` and `scenario-source-areas.json`. The source-areas file keeps each original polygon and receptor identity available to the scenario-analysis desk.

The companion command below defaults to the bundled original polygon file, accepts the same captured bytes through an explicit path, and can intentionally create a new Workspace when requested. It verifies the captured byte count and SHA256 before importing. Both preparation routes use the same original geometry and downstream preparation fields.

Extract the package under its declared opportunities/upstate_forever_2026 root while preserving relative paths. Use the native GIS interpreter that already runs the model. The command below accepts the existing workspace and the directory containing the existing model package as explicit arguments:

```bash
/opt/pyvenv/bin/python source_tools/prepare_public_water.py \
  --model-root /ABSOLUTE/PROJECT/ROOT \
  --workspace /ABSOLUTE/PATH/TO/EXISTING/WORKSPACE \
  --protection-areas /ABSOLUTE/PATH/TO/scdes-arjws-prwd-source-water-protection-original.json \
  --out /ABSOLUTE/PATH/TO/public-water-native
```

The default source directory is source/water_context/20261012/public-water next to this project's source_tools directory. Supply --source-dir if the host keeps the captured source tree elsewhere. Use --create-workspace only when intentionally creating a new workspace; the normal command uses the existing one.

The script reads the original source bodies, preserves their native geometry and CRS, checks all four protection attributes against the retained source dictionary, and binds both intake features to their exact original records. It writes the established upstate.sources/v1 manifest, imports it through Workspace.import_sources, fills the actual returned source_collection_id, and calls model.receiving_waters.prepare.

The command returns the source collection ID, completed plan ID/state, all four receptor IDs, original source counts and actual polygon SHA256. It saves receiving-waters-spec.json and public-water-preparation.json beside sources.json. These are the values the current delivery builder and receiving-water inspector can consume.

The four receptors are:
- arjws-swpa-1500
- arjws-swpa-200
- prwd-swpa-1500
- prwd-swpa-200

Each receptor uses family critical_drinking_water and relation.method source_area with its exact original OBJECTID, INTAKE and numeric BUFFER_FT selector. Intake references and complete original intake features remain in each receptor's metadata. The source-only preparation uses the existing Fiona/Shapely/pyproj path; model results can be analyzed against the completed plan when the native result is available.

The protection polygons define their published footprint. Full upstream HUC catchments remain a separate analysis scope tied to actual intake geometry and the retained WBD network. NRCS FY26 Ground / Water Quality rows stay in the contextual HUC table.

## Source viewer correction included

Replace source_tools/water_context_cli.mjs with this supplement's complete revised file. The NRCS manifest entry now uses the existing matched CSV as its primary table, sets source_format to CSV, reports the matched row count and retains the full original NRCS JSON and domain-HUC list as companions. The existing source_info viewer uses csv.DictReader for table primaries.

Re-run that CLI against the retained original HUC domain and original NRCS/SCDES bodies to create the corrected import collection. All other original source content from the earlier F0C9J6KRJDN package remains available there.

## Native source and field dictionary

source-dictionary.json preserves official field names, aliases, types, domains, source spatial references, original renderer labels, per-layer description, source URLs, original features and stable file references. None of the three layer metadata responses publishes editingInfo; the observed source capture date is separate from an unstated dataset edition.

Layer 3 uses the exact field DESC_ for its name. Its ZONE values are 0 (low-volume buffer), 1 (one-year travel), 2 (five-year travel) and 3 (ten-year travel); BUFFERDIS is feet and ACRES is the publisher area field. These metadata and the original polygon example are available to the existing source compiler.

## Carry the utility choices into the designation desk and delivery

Use the preparation result from the same model Workspace to save separate ARJWS, Pioneer and combined choices:

```bash
/opt/pyvenv/bin/python source_tools/prepare_utility_designations.py \
  --model-root /ABSOLUTE/PROJECT/ROOT \
  --workspace /ABSOLUTE/PATH/TO/EXISTING/WORKSPACE \
  --preparation /ABSOLUTE/PATH/TO/public-water-native/public-water-preparation.json \
  --out /ABSOLUTE/PATH/TO/utility-designations
```

The native designation engine retains the original source edition and full geometry. ARJWS and Pioneer each select their two published buffer records; `both-utilities.selection.json` selects all four for the single drinking-water overlay. The saved choices reopen in the designation desk and enter the installed Map atlas through the existing native apply action.

To combine that choice with an already prepared complete model delivery, preserve the actual baseline, alternatives, reporting sources and print settings:

```bash
/opt/pyvenv/bin/python source_tools/prepare_designation_delivery.py \
  --workspace /ABSOLUTE/PATH/TO/EXISTING/WORKSPACE \
  --delivery /ABSOLUTE/PATH/TO/current-complete-delivery-selection.json \
  --selection /ABSOLUTE/PATH/TO/utility-designations/both-utilities.selection.json \
  --output /ABSOLUTE/PATH/TO/utility-delivery \
  --build-delivery
```

This calls the original delivery engine and writes the complete resulting selection and source table alongside the native build result. A river designation can be included with another `--selection`; when imported from a separate Workspace, supply its retained original `sources.json` with `--source-manifest`. All original source IDs, source hashes, selected feature identities and legal context travel through the saved overlay into the report.
