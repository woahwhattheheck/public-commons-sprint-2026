# Regional matched control on the original geographic grid

This source preparation supports the current Upper Savannah geographic headwaters producer. It retains the original computational domain, South Carolina reporting mask and the actual treatment raster, then chooses a disjoint control with exactly the same changed area in each original land-cover class. The physical input fields remain explicitly simulated. The existing geographic producer, native NDR/SDR queue and completed original square case keep their identities.

The controlling owner direction is `CURRENT_OWNER_DIRECTION.md`, edition `2026-10-13.3`. The actual 217-catchment geographic course and the completed 120×120-cell square are separate studies.

## Producer integration

The geographic producer's six-argument seam is implemented directly:

```python
from source_tools.geographic_matched_control import prepare_control

control = prepare_control(
    original_nlcd_path,
    actual_restored_nlcd_path,
    entire_corridor_mask_path,
    original_reporting_mask_path,
    original_precipitation_path,
    ordinary_disk_output_directory,
    seed=original_recipe_seed,
    progress=existing_progress_callback,
)
control_mask_path = control["mask_path"]
```

The restored input is the actual restored land-cover raster. It is not a binary mask. The corridor and reporting rasters are binary masks whose only selected value is literal 1. The producer's `-9999` nodata is excluded; interpreting nonzero as selected is incorrect.

All five inputs must be single-band rasters on exactly the same projected metre grid, with orthogonal 30-metre cells, affine transform and dimensions. The adapter derives the computational mask from finite, valid original baseline NLCD pixels, then the core checks every required input on that support. The full original raster bodies and hashes are retained. No polygon is invented or inferred from a utility protection buffer.

The target consists of actual baseline class 81 or 82 changing to 41, inside reporting value 1 and the entire corridor. Any other actual restoration change, including a change outside the reporting mask, is rejected. Control candidates have the same original class, remain unchanged in the treatment raster, lie inside reporting value 1, and lie outside every corridor pixel. This preserves the actual producer's class/area and geographic support contracts.

The returned object includes:

| Field | Meaning |
| --- | --- |
| `mask_path`, `path` | Absolute path to the completed control GeoTIFF |
| `control_mask`, `mask` | Path, bytes, SHA-256, selected value 1, nodata 255 |
| `changed_cells`, `class_counts` | Exact total and original-class counts; class keys are strings |
| `hectares`, `changed_hectares` | Exactly changed cells × 0.09 hectares |
| `matching_method` | Explicit algorithm identifier |
| `rainfall_by_class` | Target/control sums and paired residuals for every class |
| `source_manifest`, `source_id` | Ordinary native source collection input and mask source identity |
| `preparation_path` | Complete retained preparation JSON |
| `summary_path`, `pairs_path` | Summary and every target/control pairing |
| `preparation` | Full core result for optional existing-Workspace adoption |

Output mask value 1 selects the control, 0 is unchanged computational-domain support, and 255 is outside the domain. Use equality to 1 when reading the mask.

The seed is retained as a producer-recipe identity. Matching uses no random draw. Equal input bytes, configuration and implementation snapshots produce the same preparation key and selection.

## Direct command

Run from the original application root with its existing GIS interpreter:

```sh
python -m source_tools.geographic_matched_control \
  --nlcd /actual/inputs/nlcd.tif \
  --restoration /actual/inputs/restored-nlcd.tif \
  --corridor /actual/inputs/corridor-mask.tif \
  --reporting-mask /actual/inputs/reporting-mask.tif \
  --precipitation /actual/inputs/precipitation.tif \
  --destination /ordinary-disk/regional-control \
  --seed 20261013
```

Use the actual saved recipe seed and original physical paths. The example paths are placeholders. Progress reports stage, elapsed time, scanned rows, matching class and completed pair counts. The final JSON contains original source paths, actual output descriptors and the preparation state.

## General core API

`source_tools.regional_matched_control.prepare(configuration, configuration_directory, output, *, progress=None)` accepts:

```json
{
  "schema": "upstate.regional-matched-control-input/v1",
  "sources": {
    "NLCD": {"path": "nlcd.tif", "bytes": 123, "sha256": "ACTUAL_SHA256"},
    "PRECIPITATION": {"path": "precipitation.tif", "bytes": 123, "sha256": "ACTUAL_SHA256"},
    "RESTORATION_MASK": {"path": "entire-corridor.tif", "bytes": 123, "sha256": "ACTUAL_SHA256"},
    "MODEL_DOMAIN_MASK": {"path": "model-domain.tif", "bytes": 123, "sha256": "ACTUAL_SHA256"},
    "RESTORED_NLCD": {"path": "restored-nlcd.tif", "bytes": 123, "sha256": "ACTUAL_SHA256"},
    "REPORTING_MASK": {"path": "reporting-mask.tif", "bytes": 123, "sha256": "ACTUAL_SHA256"}
  },
  "from_codes": [81, 82],
  "to_code": 41,
  "window_size": 256,
  "sort_records": 262144,
  "title": "Original geographic headwaters: simulated matched control",
  "source_binding": {
    "producer": "model.geographic_headwaters",
    "original_geographic_edition": "ACTUAL_RETAINED_ID"
  }
}
```

Both optional roles `RESTORED_NLCD` and `REPORTING_MASK` must appear together. Without them, the explicitly declared target is eligible original classes inside `RESTORATION_MASK == 1`, within the declared computational mask. The geographic headwaters adapter always supplies both, preserving actual treatment and reporting support.

Do not pass the reporting mask as `MODEL_DOMAIN_MASK`. These scopes differ scientifically and are checked separately during native adoption.

The configuration is snapshotted before work. Each original file is checked against its declared bytes and SHA-256 before calculation and again before retention. Code, guide, adapter and owner-direction bytes are snapshotted before the long calculation and included in the binding. A concurrently published successor cannot change the code retained under an earlier preparation identity.

## Matching method, resources and interpretation

Method: `class-stratified-ascending-target-nearest-available-precipitation/v1`.

1. Read original rasters in bounded windows. Select actual treatment targets and eligible disjoint candidates separately for every original class.
2. Write one 16-byte little-endian record per target/candidate: float64 precipitation and uint64 original row-major cell index.
3. Sort bounded chunks by precipitation, then original index. Merge with at most 32 input streams.
4. Visit targets in that sorted order. Pick the nearest unused candidate precipitation of the same class. Lower candidates use a disk-backed stack; the upper candidate uses a streaming iterator.
5. Write every pair and signed rainfall residual to CSV. Write selected indices to disk.
6. Build the final control mask through a disk-backed byte array and windowed GeoTIFF writes. Recount every class and verify exclusion against the original corridor, actual restoration and reporting support.

Sorting costs O(N log N); the matching pass costs O(N). The algorithm does not allocate the original quadratic target-by-candidate matrix. Working arrays are bounded by the raster window and sort chunk. The default sort payload is about 4 MiB before NumPy sorting overhead. Merge fan-in has bounded small read buffers. A full-grid byte array is memory-mapped on ordinary disk; its virtual size is one byte per cell, not a full in-memory raster stack. The operating system can cache mapped pages; use ordinary disk and the existing host's real memory/capacity admission.

Working disk contains the original raster copies, records, sorted streams, complete pair CSV, byte mask and completed output. Pair CSV is deliberately complete and can be substantial. Interrupted stages reuse completed receipts and do not duplicate the native solver. The owned `work/` intermediates are retained for continuation; they are excluded from the imported source manifest. Never use shared-memory storage for this regional working directory.

This is deterministic local nearest-available matching. It does not claim the completed small-square algorithm's global minimum-L1 optimum. Equal lower/upper distances choose the lower side; equal-valued lower-stack candidates use the last original index, while upper candidates retain ascending original index. Every choice remains inspectable in the complete pair CSV.

Rainfall proximity does not match slope, flow path, erodibility, erosivity, shape or contributing area. Differences in native delivery therefore remain a comparison of the explicitly declared scenarios. Source-input load changes are distinct from modelled annual delivery to streams. Native N/P exports use kg/year; native sediment export uses metric tonnes/year.

The report retains per-class precipitation target/control sums, signed sum residual, absolute residual sum, mean absolute residual and maximum residual. It also retains the mean precipitation over the declared computational mask. Native NDR's normalization must be interpreted on its actual prepared input support; a reporting-area mean is not silently substituted.

### Existing original-case numerical comparison

The maintained original 120×120 input generator and all 635 original pair records were independently read. The new ordering was exercised on those actual original simulated fields, preserving all original class/rainfall values:

| Original class | Targets | Eligible candidates | New local sum absolute rainfall residual | Original global minimum-L1 residual |
| --- | ---: | ---: | ---: | ---: |
| 81 | 236 | 2,359 | 9.833285 mm/year | 9.624952 mm/year |
| 82 | 399 | 3,474 | 22.333247 mm/year | 21.249913 mm/year |

Class counts, changed area and corridor exclusion matched exactly. This comparison concerns source matching, not a new NDR/SDR model result. The original completed square, its exact optimal pair records and its receiver are unchanged. The regional helper is a separate, explicitly identified method.

## Retention and recovery

The output directory is derived from the actual source/configuration/implementation binding. A held preparation lock serializes the same operation. A completed preparation is reverified and reused. A completed scan, external sort or class match is reverified and reused; interrupted owned stages are rebuilt from their retained inputs. No incomplete preparation enters the source manifest.

`control-prepared.json` names every delivered file with bytes and SHA-256. `sources.json` uses the maintained `upstate.sources/v1` schema with three ordinary source entries:

- `SIM_REGIONAL_MATCHED_CONTROL_MASK`
- `SIM_REGIONAL_MATCHED_CONTROL_SUMMARY`
- `SIM_REGIONAL_MATCHED_CONTROL_PAIRS`

Each source carries the other delivered originals, configuration, source binding, method source and guide as companions. The complete ordinary collection therefore retains the source interpretation through export and restore.

## Existing-Workspace adoption

If the geographic producer has already created its original baseline, use:

```python
from source_tools.regional_matched_control import adopt
adoption = adopt(existing_workspace, control["preparation"], actual_baseline_run_id)
```

This imports the ordinary source collection, saves a land-cover scenario, prepares the third run against the same native grid/profile/models, and calculates its actual scenario footprint. It does not launch a second operator or submit a solver.

Before import, the adopter verifies:

- Original width, height, affine grid and CRS match the baseline.
- NLCD and precipitation each match the actual baseline's original source hash or its retained prepared-raster hash.
- Configured raster values and valid support equal the prepared baseline, allowing only the prepared raster's declared dtype conversion. Resampling or unit conversion that changes those values is rejected.
- The computational mask is exactly the original native `model_domain.gpkg` polygon selected by pixel centre, with `all_touched=False`, including the baseline's actual domain buffer.
- Where a reporting mask is supplied, its selected cells equal the baseline's original reporting mask.
- The resulting native footprint has the retained exact changed cells and hectares.

The adoption receipt includes verified source/grid/domain bindings, collection ID, scenario ID, prepared run ID and actual footprint ID. Continue that same prepared run through the existing native queue. The producer may instead retain and register the returned control mask in its own complete geographic input family; both paths preserve the original source course.
