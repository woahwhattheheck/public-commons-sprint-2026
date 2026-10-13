# Prepared Upper Savannah tributary annual references

This directory reproduces the complete seven-record tributary edition already prepared in `../prepared-tributaries/`. The prepared directory is directly consumable by the application's maintained annual-reference binding command. It includes the original national calibration tables, publisher reach crosswalk, release metadata, original NLDI reach/basin responses, selected annual rows, complete catchments, observation metadata and ordinary native source manifest.

## Admit the prepared edition into an existing workspace

Run from `opportunities/upstate_forever_2026` in the actual cumulative application:

```sh
python -B -m source_tools.sparrow_reference bind \
  --workspace /absolute/path/to/existing-workspace \
  --prepared source/usgs-southeast-sparrow-2012/prepared-tributaries
```

The command verifies the retained preparation digest and all 25 described members, imports the two ordinary source entries, and admits all seven original annual-reference records. It writes `binding-<workspace-id>.json` into the prepared directory, including the actual admitted observation ID and catchment source collection/entry IDs. Use those returned IDs in the existing Annual references / Calibration workflow; the record IDs in the source table identify original references, not existing workspace records.

The same command is also exposed by `source_tools.usgs_annual bind`, which is the maintained implementation called by the regional helper. The prepared input directory must be writable for its new workspace binding file. Copy the complete directory to the native host's writable source area if its application checkout is read-only.

The retained preparation ID is:

`4deee902904529bf1f1ecac709451de7a67158174edd1e4cde0811e431be6ddb`

The source ID is:

`430f1c2185f2cf14a88c992f270b729e81d9de5cecd20ec67def1c26ff86cc03`

## Actual original regional targets

| Publisher station identifier | Native parameter | Published annual target | Original unit | Published COMID |
| --- | --- | ---: | --- | --- |
| comb600_6269342 | nitrogen | 270438.4381 | kg/year | 6269342 |
| scSV-354 | nitrogen | 139789.3642 | kg/year | 11730084 |
| comb665_6269342 | phosphorus | 96111.0042 | kg/year | 6269342 |
| 02192000 | phosphorus | 223025.1307 | kg/year | 6280111 |
| scSV-354 | phosphorus | 19086.9896 | kg/year | 11730084 |
| 02177000 | sediment, original TSS 00530 | 7201.8484 | metric_tonnes/year | 6269342 |
| 02192000 | sediment, original TSS 00530 | 141611.9058 | metric_tonnes/year | 6280111 |

These values are the original mapper's ACTUAL/ACTUAL_MT calibration targets from [USGS release 10.5066/P9A682GW](https://doi.org/10.5066/P9A682GW). Full original attributes retain the separately named model predictions PLOAD_TOTA/PLOAD_MT. The latter are never used as observed references. The mapper's TSS_CONV predictor coefficient is also retained only as original context; it does not transform an already published ACTUAL_MT target.

The release identifies **2012 reference conditions** and a **source-global water-year 2000–2014 target horizon**. The native rows preserve 1999-10-01 through exclusive 2014-10-01. These already annualized rates are not multiplied by 15. Individual station sampling windows, final annual-estimator identities and target standard errors are not exposed by the mapper; each original uncertainty value remains null. Published model prediction error cannot supply that missing target uncertainty.

There are three spatial catchments, not seven independent geographic samples. Nitrogen has targets in Chattooga and Stevens; phosphorus in all three; sediment in Chattooga and Broad. Preserve whole station/catchment groups when selecting calibration and held-out references. The existing application determines common valid native raster coverage and exclusions and keeps actual model/scenario vintages visible.

## Complete original catchments

| Basin | Published COMID | Original coordinates | WGS84 geodesic area, m² |
| --- | --- | ---: | ---: |
| Chattooga River | 6269342 | 960 | 526778591.1475625 |
| Broad River | 6280111 | 2209 | 3678651459.3063245 |
| Stevens Creek | 11730084 | 1310 | 1470231483.6203814 |

Each exact original NLDI response contains one complete Polygon with one closed exterior ring. Component 0 is retained in full; no other component is omitted. The source requests explicitly use `simplified=false&splitCatchment=false`, so these remain upstream basins associated with published reaches. They are not a new gauge-specific split. Every coordinate is preserved, the original reach LineString intersects the returned basin, and nonadjacent polygon edges were checked for intersections.

Areas were actually calculated with the author's unchanged GeographicLib 2.2.0 WGS84 geodesic polygon implementation. The original HTML source pages and exact extracted JavaScript are vendored with their copyright and MIT/X11 notices. All selected geometry coordinates and source identities are independent of the display precision of the area table.

## Reproduce or check every prepared byte

The checked-in preparation kernel was executed against the 20 pinned original inputs. It follows the regional helper's existing record, catchment, plan, source-manifest and native binding contracts. It performs source selection and packaging; it does not rerun SPARROW or estimate new annual loads.

With Node.js available, run:

```sh
node source/usgs-southeast-sparrow-2012/preparation/prepare-tributaries.mjs --check

node source/usgs-southeast-sparrow-2012/preparation/prepare-tributaries.mjs \
  --output /absolute/path/to/prepared-tributaries
```

The default application root is inferred from this script's location. `--application-root` can select another complete application checkout. The immutable input manifest fixes original input byte lengths and SHA-256 hashes, GeographicLib source hashes, the actual original preparation timestamp, and all 26 output hashes. The command checks all those identities before writing. Existing identical members are reused; differing members are rejected, and writes use temporary files plus exclusive links. A completed native binding file may coexist with the original 26 prepared members.

The pure preparation kernel and vendor calculation have been run in the available JavaScript runtime. The resulting full cohort reproduced exactly on a second run. Seven CSV rows round-tripped through the original JSON source records without value, qualifier, uncertainty or provenance loss; both source entries and every companion passed exact hash verification. The receiving operation supplies the actual Python workspace import and its resulting source/observation IDs.

## Files and provenance

- `prepare-tributaries-core.mjs`: complete source-specific preparation algorithm.
- `prepare-tributaries.mjs`: Node filesystem wrapper, input verification and immutable output.
- `input-manifest.json`: all exact original input and output identities.
- `geometry-checks.json`: actual complete geometry/area results.
- `vendor/geographiclib-2.2.0/`: unchanged original sources, complete HTML source captures, license.
- `../prepared-tributaries/`: complete 26-file native input cohort.

The native source manifest carries all original source companions. Source table URIs and the release dictionary are retained in each annual record. Current NLDI geometry is preserved separately from the release's published COMID/REACHCODE attribution. Reference selection can therefore be traced through exact row, original table, publisher reach, original basin and admitted native source edition.
