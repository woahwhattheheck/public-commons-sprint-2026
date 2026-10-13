# Selected watershed total and incremental accounting

The Source-water areas network exporter now includes an offline accounting report, tables and original HUC12 membership sets. The ordinary **Build original watershed network** action creates these companions alongside its existing map and saved source. Open **Total, incremental and utility-union accounting** from the network report. Report downloads and the existing portable package include the companions automatically through their file descriptors.

## Read the output

A **total** contains a selected anchor HUC12 and every retained HUC12 reaching that anchor through the original ToHUC graph. A group's **incremental** footprint is its total minus the union of all strictly upstream selected groups. Equal upstream sets, including anchors in a common source cycle, form one accounting group. The group's original anchor identifiers remain visible.

A utility's footprint is the **union of its selected anchors' totals**, not their sum and not the sum of their global increments. Selecting an upstream anchor for a different utility therefore does not remove that land from the downstream utility. The all-utility union counts every selected HUC12 once. Incremental groups partition that union. Selecting a different anchor set can change increments while leaving an individual anchor's total unchanged.

The report supports selecting an anchor, switching between total and incremental membership, identifying original polygons, reading the complete source table, and printing. It is self-contained and needs no hosted assets or external script. The application's printable preview retains all tables when scripts are removed. Original 12-character HUC12 strings, source feature IDs, original ToHUC values, utility associations and source provenance remain in JSON and CSV.

`total_huc12s`, `incremental_huc12s`, `immediate_upstream_group_ids`, and the exactly-one `incremental_group_id` per member support subsequent native output accounting. The latter is an accounting partition, not a replacement hydrologic network. A source graph's terminal labels and links outside the retained domain remain available.

## Receive an existing original network

From the application directory, use the saved original network path and a separate destination:

```sh
python -B -m model.receptor_accounting \
  --network /path/to/workspace/receptor-networks/ORIGINAL_NETWORK_ID \
  --output /path/to/delivery/receptor-accounting \
  --with-geometry \
  --equal-area-crs EPSG:5070
```

Omit `--with-geometry` for the standard-library report and membership tables. Geometry mode uses the application's existing Fiona, Shapely and pyproj runtime. EPSG:5070 is the explicitly selected CONUS Albers equal-area projection for the Upper Savannah case. Other regions must select an appropriate equal-area projected CRS in metres. The command validates that the chosen operation is equal-area before measuring full original polygon rings. It does not simplify scientific geometry, repair source geometry, clip to a model mask or snap a utility intake.

The result is saved under a deterministic selection digest. It retains the original network result, profile, geometry body and network records unchanged. Completed products reopen by file identity without recomputing geometry. The standalone receive command adds a derived edition and does not modify the original Workspace network or its result ID. The network builder's presentation version changes for newly created products; existing network editions remain readable.

### Files

| File | Purpose |
| --- | --- |
| `index.html` | Offline, printable selected-anchor report and map |
| `accounting.json` | Complete original membership accounting and source binding |
| `catchments.csv` | Each total and increment, equivalent anchors and immediate upstream groups |
| `incremental-memberships.csv` | One row per distinct selected HUC12, retaining total and utility memberships |
| `utility-unions.csv` | Distinct original HUC12 union for each utility |
| `watersheds.svg` | Editable overview drawn from original source coordinates |
| `catchments.gpkg` | Geometry mode: `total`, `incremental`, `utility`, `selected_union` layers |
| `projected-areas.json` | Geometry mode: complete measured areas and incremental polygon overlap |
| `original-*` | Standalone receiving: unchanged saved source, selection and producing network result |
| `result.json` | Deterministic product identity and complete file descriptors |

The tables distinguish sums of the original `areasqkm` attributes from measured projected areas. Published values retain their original rounding. `known_area_ha` includes only finite nonnegative source area values, and the companion counts expose missing values. Empty coverage stays unavailable. Geometry mode also reports any positive overlap between the incremental polygon areas and their union instead of hiding it with an arbitrary geometry allocation.

## Additive quantities

`aggregate_values(accounting, values, unit=..., source=...)` accepts a mapping from original HUC12 identifiers to one additive land-origin quantity per unit. The caller retains the actual unit and producing source. It returns total, incremental, utility-union and all-selected-union accounting on the same exact sets. Finite zero and negative differences are preserved; missing values are counted separately. Partial coverage has a `known_sum` but no complete `total`.

Use this for already-computed whole-HUC native mass or native mass differences on compatible masks. Do not pass cumulative outlet loads, concentrations, rates, or independently repeated upstream totals. Native raster aggregation must honor its actual grid, reporting mask, valid-cell coverage and output mass units before this set accounting step.

InVEST NDR describes land-origin nutrient movement to the modeled stream network and excludes in-stream processing. A retained HUC12 reporting footprint is not an intake-snapped delineation, reservoir-retained load, or treated-water concentration. Those quantities need the corresponding process and geometry calculations. [InVEST NDR user guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html)

## Original Upper Savannah receiving result

Source network `5a02c70737ff8b11c0a3ecf1faa83f76f5b96e3df53e3514caed27a04f944b81` retains 217 original units and four anchors within ARJWS and PRWD. The original geometry body SHA-256 is `6f49c2f1dc10709d7957e38e92642a1de4cda44e67e4d70a8bc2ff51388e6af9`.

| Original anchor | Total HUC12s | Incremental HUC12s | Published total area, ha | Published incremental area, ha |
| --- | ---: | ---: | ---: | ---: |
| Upper Six And Twenty Creek / 030601010703 | 1 | 1 | 7,741 | 7,741 |
| Lower Six And Twenty Creek / 030601010704 | 4 | 3 | 42,801 | 35,060 |
| Choestoea Creek / 030601020502 | 1 | 1 | 9,940 | 9,940 |
| Lower Tugaloo River / 030601020507 | 32 | 31 | 256,296 | 246,356 |

Summing the four anchor totals creates 38 membership entries for 36 distinct HUC12s and repeats 17,681 ha of published source area. The utility unions remain ARJWS 4 units and PRWD 32 units. Published distinct union area is 299,097 ha; the complete original polygons measured in EPSG:5070 yield 299,097.8721368647 ha. The native GeoPackage has four layers and the incremental polygon overlap measurement is 0 ha.

These numbers are the computed original-source receiving result, not new NDR/SDR numerical outputs. Existing model runs and their source editions remain with their producing workflows. The accounting module enters the application through the network exporter's static Python import; it needs no new hosted service, installer, numerical model solve or CI workflow.
