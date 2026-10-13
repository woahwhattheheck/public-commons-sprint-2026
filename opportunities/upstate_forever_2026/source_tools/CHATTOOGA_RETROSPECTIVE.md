# Chattooga historical annual-reference workflow

This workflow connects three retained USGS annual load targets for the Chattooga River near Clayton, Georgia, to an executable InVEST retrospective. It extends the existing annual-reference, regional-core and calibration modules. The complete upstream basin is a contributing tributary of the Tugaloo/Hartwell system.

## Selected original reference

The original reference edition is [USGS release 10.5066/P9A682GW](https://doi.org/10.5066/P9A682GW), already retained under `source/usgs-southeast-sparrow-2012`. The existing receiver verifies that complete edition before preparing the three selected rows.

| Native objective | Original station identity | Original field | Annual target | Native comparison unit |
| --- | --- | --- | ---: | --- |
| Nitrogen | comb600_6269342 | ACTUAL |270438.4381|kg/year|
| Phosphorus | comb665_6269342 | ACTUAL |96111.0042|kg/year|
| Sediment, TSS 00530 |02177000|ACTUAL_MT|7201.8484|metric tonnes/year|

All three records use published COMID 6269342, HUC8 03060102. Their original station identifiers remain unchanged. The nearby `PLOAD_TOTA` and `PLOAD_MT` values are SPARROW predictions and are excluded from the target values. The sediment row is total suspended solids; its published `TSS_CONV` model term is retained without applying it to the empirical target or relabeling TSS as suspended-sediment concentration.

The source-global target horizon is 1999-10-01 through 2014-09-30, represented as an exclusive 2014-10-01 endpoint. Each target is one long-term annual rate referenced to 2012 conditions. This period supplies temporal context; it does not create fifteen independent annual observations. The regional mapper does not expose station-specific estimator windows, final estimator choice or target standard errors. Those fields remain unavailable. The separate F7DN436B annual-load receiver can retain final Beale/Fluxmaster details when that original release is available; it must not silently substitute another estimate into this edition.

The selected complete current NLDI basin has SHA256 `206b6a6654e538b188212914634a7fa1fcf11c3c55b13eca7ea124cad0b2bb62`. Its geometry is a separate source edition from the published SPARROW network. Reporting uses this full basin; native routing additionally retains the explicit hydrologic context buffer. Management polygons do not clip the reference catchment.

## Historical inputs and controlled comparisons

The [published Southeast SPARROW study](https://pubs.usgs.gov/sir/2019/5135/sir20195135.pdf) identifies NLCD2011. A 2012 reference year does not make an Annual NLCD2012 product the original land-cover baseline.

The executable baseline therefore uses [legacy NLCD2011,2011 edition amended2014](https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/metadata/landcover.html), from its [original USGS archive](https://edcftp.cr.usgs.gov/project/landcover/NLCD2011/). The amendment corrects representation of developed classes. The new `nlcd_legacy2011` helper retains the complete ZIP, original archive metadata and the exact 30 m categorical cells in a contributing-domain window. It checks the original source CRS, grid dimensions, source masks and class values. It opens the Imagine raster inside the ZIP and does not extract the national raster.

The accompanying `retrospective-source-selection.json` separates these controls:

| Selection | Comparison | Meaning |
| --- | --- | --- |
| Legacy NLCD2011, amended2014 | Historical baseline | Original published land-cover product choice |
| Annual NLCD2011 | Against legacy2011 | Mapping product, algorithm and edition sensitivity at the same nominal year |
| Annual NLCD2012, same collection as Annual2011 | Against Annual2011 | Mapped annual change within one product collection |

Keep each comparison on one retained 30 m reference lattice, with identical DEM, K, R, precipitation, domain and buffer, table coefficients, native parameters and actual engine version. Reproject categorical Annual NLCD controls with nearest-neighbour onto the original baseline lattice before making their source selections. Retain the exact Annual collection and DescribeCoverage time positions through `nlcd_wcs`. The source specification records these alternatives; the baseline plan generator deliberately selects the legacy product. A changed land-cover source creates a new grid/source identity. Evaluate each source grid against the same original observations, and compare only matching catchment and valid support. Profile candidates within one calibration plan share the same grid and baseline scenario.

This is an InVEST retrospective using documented historical inputs. It does not reproduce SPARROW's point sources, stream/reservoir attenuation or statistical transport model. Retained contemporary DEM and soil data, and R climatology, remain labeled by their actual vintages.

## Exact period precipitation

The [current PRISM web-service specification](https://prism.oregonstate.edu/documents/PRISM_downloads_web_service.pdf) provides original 800m or 4km cumulative monthly and annual precipitation grids. [PRISM formats](https://prism.nacse.org/formats/) define annual grids as cumulative annual values; [PRISM documentation](https://prism.oregonstate.edu/faq/) gives precipitation raster units as millimetres.

For water years 2000–2014, `prism_period` requests 26 disjoint source grids covering 180 months:

- October–December 1999: three monthly grids.
- Calendar years 2000–2013: fourteen cumulative annual grids.
- January–September 2014: nine monthly grids.

It sums each original cumulative value exactly once and divides by 15 complete years. It does not day-weight totals or average monthly totals directly. A cell survives only if every selected period is valid. Native band scale and offset are applied once, before aggregation. The output is mean annual precipitation in mm/year, preserving the original PRISM lattice before the ordinary core aligner resamples it bilinearly.

Original AN dataset type, source ZIP hashes, original metadata, period boundaries, native windows, grid coefficients, per-period clips and capture receipts remain companions of the resulting source entry. Preparation resumes verified periods in the same immutable selection. The service's two-second request pacing is retained. Reopening a completed source verifies its recorded files and makes no new original request.

The [PRISM dataset description](https://prism.oregonstate.edu/documents/PRISM_datasets.pdf) distinguishes best-estimate AN grids from the LT series and from1991–2020 normals. This workflow requests AN explicitly and retains the actual received editions. InVEST NDR's default runoff normalization divides the actual watershed-masked runoff proxy by its own mean. Uniform scaling cancels; this source comparison changes the selected historical period and spatial precipitation pattern.

## Run the retained source intake

Run these commands from the maintained application root. `RETRO_ROOT` is an existing operation-owned directory on the accepting worker. Keep all selected source files below the directory used for the composed manifest.

```sh
python -B -m source_tools.chattooga_retrospective reference \
  --output "$RETRO_ROOT/reference"

python -B -m source_tools.nlcd_legacy2011 \
  --domain source/usgs-southeast-sparrow-2012/nldi/basin-comid-6269342.json \
  --buffer-m 1000 \
  --output "$RETRO_ROOT/legacy2011"

python -B -m source_tools.prism_period \
  --domain source/usgs-southeast-sparrow-2012/nldi/basin-comid-6269342.json \
  --start 1999-10-01 --end 2014-10-01 \
  --resolution 800m --buffer-m 1000 \
  --output "$RETRO_ROOT/prism-wy2000-2014"
```

For an already retained original land-cover ZIP, supply `--archive /actual/path/nlcd_2011_landcover_2011_edition_2014_10_10.zip --originals-only`. The existing copy helper adopts a verified independent copy or reflink. For retained PRISM ZIPs, place the exact named originals in the same preparation's `original` directory and use `--originals-only`. It rejects a recorded incomplete capture.

The default native-window ceilings are 10 million cells for legacy NLCD and 4 million for PRISM. These are source-window memory/work limits and do not resample the product. Set an explicit larger ceiling only when the actual contributing window requires it. Raster processing uses 256×256 blocks and 64 MiB GDAL cache.

## Bind real existing terrain, soil, erosivity and profile choices

`EXISTING_CORE_PLAN` identifies the original current regional core plan whose actual DEM, K, R, table and native parameters are being retained. The generator verifies that plan and its source manifest, receives the historical source entries, and substitutes their IDs plus the complete original Chattooga basin. It preserves the selected model scope. A combined plan evaluates all three pollutants; an NDR-only plan remains an explicit nutrient-only reference evaluation.

`COMPOSITION_ROOT` must be a common parent of the original core source files and the retrospective inputs. This is the maintained source composer's path contract; original bytes stay in place.

```sh
python -B -m source_tools.chattooga_retrospective core-plan \
  --base-plan "$EXISTING_CORE_PLAN" \
  --landcover-entry "$RETRO_ROOT/legacy2011/source-entry.json" \
  --precipitation-entry "$RETRO_ROOT/prism-wy2000-2014/source-entry.json" \
  --manifest "$COMPOSITION_ROOT/chattooga-sources.json" \
  --output "$COMPOSITION_ROOT/chattooga-core-plan.json"

python -B -m model.regional_job run \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  --plan "$COMPOSITION_ROOT/chattooga-core-plan.json" \
  --source-reference "$UPSTATE_APPLICATION_COMMIT" \
  --output "$RETRO_ROOT/chattooga-core-result.json"
```

The result is an ordinary completed regional core with original source collection, grid, profile, scenario, run and stage identities. Its normal stage cache and native resume remain active. Actual missing source coverage or native failure is returned by the existing runner.

## Analyze actual completed native outputs

```sh
python -B -m source_tools.chattooga_retrospective calibration-plan \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  --prepared-reference "$RETRO_ROOT/reference/prepared" \
  --core-result "$RETRO_ROOT/chattooga-core-result.json" \
  --output "$RETRO_ROOT/chattooga-calibration-plan.json"
```

Additional `--core-result` arguments select actual completed profile baselines on the same original grid and scenario. The bridge verifies the Workspace, retained source collection, complete original basin, legacy2011 source, exact precipitation period and completed native selection before creating the ordinary calibration plan. It selects only pollutants actually completed in every chosen run.

The returned JSON `id` is the plan identity for the maintained analyzer:

```sh
python -B -m model.calibration \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  --output "$RETRO_ROOT/chattooga-calibration-result.json" \
  analyze "$CHATTOOGA_CALIBRATION_PLAN_ID"
```

The existing calibration desk supplies retained plan IDs, residual tables and maps, per-pollutant physical metrics, candidate source/profile membership and the original observation identities. Use its catalogue to select the actual run group. A complete Chattooga basin is one spatial group. The workflow retains an empty validation partition rather than inventing a held-out basin from another constituent or repeated period.

Native annual diffuse export is compared with the empirical annual target while point sources and unrepresented transport remain explicit. Add an external delivered load only through the existing source-backed `delivered_external_loads` selection. TSS/SSC distinctions, missing target uncertainty, source editions and valid catchment support accompany interpretation of every residual.

## Maintained interfaces

- `prism_period.periods(start,end)`, `plan(...)`, `prepare(...)`: original cumulative source partition, original request plan, retained annual-rate raster.
- `nlcd_legacy2011.package(path)`, `prepare(...)`: original archive metadata and categorical native-window source.
- `chattooga_retrospective.reference(directory)`: existing original reference receiver and preparer.
- `chattooga_retrospective.core_plan(...)`: verified real core-plan substitution and ordinary source composition.
- `chattooga_retrospective.calibration_plan(...)`: actual completed native runs to the existing annual-reference analysis.

All generated source entries use the existing `upstate.sources/v1` manifest. No parallel observation, model or calibration engine is introduced.
