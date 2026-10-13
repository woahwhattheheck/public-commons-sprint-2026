# Terrain editions and native response — 1.0.0

The existing scientific workbench now accepts a retained, projected, metre-valued DEM and optional original line hydrography. It saves explicit conditioning choices, prepares separate terrain editions, then uses the original Workspace and native run queue to calculate and compare their consequences. Prior sources, scenarios and model outputs stay available.

## Ordinary workbench course

Open **Terrain editions** in the original operator. Select the retained DEM and its context source collection. For a raw-versus-filled comparison, leave the hydrography and burn-depth fields empty. For channel-conditioning alternatives, select the original line source, enter explicitly chosen depths in metres, and enter a corridor half-width when appropriate. The optional layer and exact original-field filter are under Advanced selection; ordinary use requires no JSON editing.

Save the named case, then choose **Prepare / resume terrain editions**. Raw and spill-level-filled surfaces are always retained. Each selected burn depth produces its own burn-and-fill surface. The result gives changed hectares, elevation changes, geometric fill volume, NoData coverage and local-neighbour relief diagnostics. Downloads contain the full-resolution DEMs, change/fill rasters, depression-component table, source record and standalone report. Map previews are sampled only for display; scientific calculations retain every original cell.

Select a completed edition and the original native reference run. **Prepare new native comparison run** retains that reference's scientific profile, scenario, model versions and reporting geometry, replacing only the DEM source through the existing grid preparation. **Run native models** uses the original `run.start` task. After the changed cases finish, **Compare completed native terrain runs** creates a saved, readable nutrient/sediment comparison with maps and original output downloads. Raw/filled editions with exactly unchanged elevations reuse the original baseline.

The native response compares a fixed original lattice. It verifies source identity, exact non-DEM prepared raster values, geometry, reporting support, profile, scenario and native versions. The original general comparison's same-grid-ID rule is unchanged. Each quantity uses the common valid cells across the baseline and every changed alternative. Full-support native totals and cells gaining/losing valid output remain separately visible. The original normalized pixel-mass rasters are summed once; neither per-hectare conversion nor reporting weighting is applied a second time.

## Scientific interpretation

The filling implementation is an original eight-neighbour Priority-Flood with a heap plus FIFO depression queue, following Barnes, Lehman and Mulla, *Computers & Geosciences* 62 (2014), 117–127, DOI https://doi.org/10.1016/j.cageo.2013.04.024. A retained C++17 helper accelerates the same operation; a Python implementation remains available. Filling raises connected depressions to their spill level without inventing elevations in missing cells. No epsilon gradient, breaching, smoothing or replacement of the native model's routing is introduced. Flat areas still require the native model's own flat-resolution/routing.

Choose boundary treatment explicitly: raster edges plus valid cells adjacent to NoData, or outer edges only. A valid island with no selected boundary outlet raises a specific error rather than silently inventing drainage. All line/corridor-touched cells are eligible for the entered lowering, then filling follows. A burn depth is an analyst scenario, not an observed channel depth. Geometric fill/lowering volume is not reservoir storage or water volume. Drainage validity and empirical accuracy need the appropriate source hydrography and independent observations.

The source reader requires one north-up, unrotated numeric band, projected horizontal metres, elevation metres and normalized scale/offset. Geographic, foot-valued or scaled source rasters first use the existing terrain source preparation. The selected vertical datum is retained; this component does not perform a vertical-datum transformation.

## Native API and source composition

The extension is `operator/extensions/terrain-conditioning.json`, using the original extension registry, task identity, serial queue, file tickets and Workspace. Its source files are additive except the existing `source_tools/terrain_prepare.py` reference-grid normalization join. That join delegates to `model.rasters.grid_definition`, preserving the existing reference origin and dimensions while applying its already-established nominal-30-m convention. Both retained Annual NLCD 2023/2025 grids were accepted: 6,443 by 6,319 cells; maximum corner displacement from the publisher's floating coefficients was 0.0001677381 m. No new target-grid convention is introduced.

`source_tools/terrain_conditioning.py` owns saved cases, conditioning, source retention and original grid/run binding. `source_tools/terrain_conditioning_response.py` owns the specialized fixed-lattice native comparison. `terrain_conditioning_report.py` writes the complete offline terrain report. The original source collection keeps every context entry; each conditioned DEM has a new entry with the case selection and full original companions. The original portable application/Workspace exporter includes these records, sources and modules.

From the application root, ordinary automation can call:

```text
python -B -m source_tools.terrain_conditioning --workspace PATH catalog
python -B -m source_tools.terrain_conditioning --workspace PATH save SELECTION.json
python -B -m source_tools.terrain_conditioning --workspace PATH run CASE_ID --engine auto
python -B -m source_tools.terrain_conditioning --workspace PATH native CASE_ID VARIANT ORIGINAL_RUN_ID
```

The registered actions are `terrain.conditioning.save`, `terrain.conditioning.run`, `terrain.conditioning.grid`, `terrain.conditioning.native.prepare` and `terrain.conditioning.compare`. Native execution itself remains `run.start`. Python users can call `terrain_conditioning_response.compare(workspace, case_id, original_run_id)`. All complete results can be reopened without recalculating their native models. Preparation checkpoints retain completed variants after interruption; changing the scientific selection creates a separate immutable case.

## Worked original case

The delivered course uses the original **simulated headwaters**, not a production regional terrain capture. Project `1b6a344c-df5a-4986-a5e4-47a2d158324b`; original DEM 120 × 120 at 30 m; 14,400 valid cells / 1,296 ha. The original native stream raster has 236 stream cells. Its separately retained undirected cell-adjacency line conversion is explicitly model-derived from simulated inputs; it is not relabelled observed hydrography.

Case `658a363d919dcd72d7fd666b588a1862c472d10cbf37e86e62358d3804371a45` contains raw, filled and 0.5/1/2-m burn-and-fill editions. Raw filling changes no elevations. Each stream-conditioning choice changes 267 cells / 24.03 ha. Three new InVEST 3.20.0 NDR/SDR runs completed through the original queue; the prior 18 native runs remain unchanged. The common comparison support is 14,155 cells / 1,273.95 ha; each alternative loses nine valid-output cells relative to the original baseline.

| Entered burn depth | Nitrogen change, kg/year | Phosphorus change, kg/year | Sediment change, metric tonnes/year |
|---:|---:|---:|---:|
| 0.5 m | -32.5357347475 | -2.8138122860 | +10.0684029715 |
| 1 m | -42.1062544063 | -3.5597795339 | +25.5754076909 |
| 2 m | -66.7786293961 | -5.4895147820 | +52.2197045291 |

Signs are alternative minus baseline. The mixed response is useful: lowering the model-derived stream corridor reduces nutrient export but increases sediment export in this conditional teaching case. It is not an empirical accuracy improvement or a prediction for Tim's incoming dataset.

Native baseline: `4b5ea04c911dbbf16a8f214c884a9fbf69c96cc718b2063b1ade9e221aa8e4fc`.
New runs: `6a8067a5d03e24338204970b1291a18acf6ee94eab99a82e03686b8b417572a9`, `85ccbc533ed8d1b9896be4825e7e7870b3dee4111393fe416bddc84b61eb483e`, `b2366163904e5e2795a0fe12a3bbd7ee71e394a10f2315d5d9fa90e71b398f2e`.
Native response: `f9985d3897c6c806abd7de9279ce4e66ad4748db61d51123dde60ac9d7fc6445`.

## Receiving and observed operation

Extract the report/data package and open `OPEN_TERRAIN.html`. It links the complete terrain comparison and native-response reports. Their maps and scientific notes work offline; notes export/import binds to the exact case or response. Relative GIS/original-source links require the extracted accompanying files. This compact report is separate from the model-running workbench.

The complete native application/Workspace archive restores through the existing `model.portable.restore` into a new directory. Use its original operator entry and a compatible retained native runtime; the current native invocation helper is the same one used for these runs. The original runtime was recovered from its existing ten-part archive: 320,211,902 bytes, SHA256 `71954c67c99c047c862ff737f6127f641a034ce95c4b0108f57d382224db7e09`, Python 3.12.15, InVEST 3.20.0 and GDAL 3.12.4. Runtime bytes are a separate dependency, not a localhost service on the recipient's computer.

The exact native source save, native preparation and completed-run comparison were operated from the Chromium terrain component through the authenticated original operator API. All nine native-response maps and notes export/import/independent reopening were operated, and desktop/390-pixel screenshots were personally viewed. This cloud provider rejects direct Chromium file/loopback navigation; standalone reports were rendered from their exact HTML, and the native component used Python transport to the actual original operator. The ordinary local operator process, registry, original queue and native calculations ran directly. Preserve this distinction when assembling the receiving route.

Production USGS terrain acquisition retains its existing source operation and original nine-tile inventory; the conditioning course is ready to consume its completed projected source edition. The current worked scientific results retain their separate simulated identity.
