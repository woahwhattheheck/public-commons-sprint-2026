# USGS annual reference import

This source tool takes the published annual estimates in [USGS release 10.5066/F7DN436B](https://doi.org/10.5066/F7DN436B) through original archive receiving, station selection, upstream geometry, ordinary Workspace import and the installed calibration catalog.

## Original release and estimator

The publisher's original dictionary is retained in the source directory. It defines four original output members: total nitrogen 00600, total phosphorus 00665, suspended sediment 80154 and total suspended solids 00530. Each water-quality station has its own original final-method field.

| Original selector | Selected annual value | Selected published standard error |
| --- | --- | --- |
| beale | rload_a_XXXXX | serload_a_XXXXX |
| flux5pkd | LOAD_A_XXXXX | SLOAD_A_XXXXX |

The tool reads that field exactly. Values are already kilograms per year. Fluxmaster supplies a detrended long-term mean for the 2012 reference; Beale supplies its published long-term mean. The original water-quality and flow periods, station identifiers, paired flow station, COMID, sample/censor counts, merged-station text and both estimator columns remain in the retained source row.

The included flow-data start and end dates define the source comparison period. The original last included calendar day becomes an exclusive end by adding one day. The mean annual rate is preserved; it is not multiplied by the length of the source period. The imported metadata supplies the appropriate whole-year or elapsed-day weighting for the existing calibration selection.

Suspended sediment and total suspended solids keep separate original constituent identities. Select one original series for any one upstream catchment/native sediment comparison. Their scientific relationship to the native hillslope-export prediction remains visible with the source row and the selection's comparability note.

## Receive the original files

From the existing application root:

~~~bash
python -B -m source_tools.usgs_annual receive --output /mnt/data/usgs-annual2012-original
~~~

This receives the original load_est.zip (781,822 bytes), sitegage.zip (519,872 bytes), and the 40,293-byte publisher dictionary. The current shared HTTP receiver reuses an already completed original response. Previously downloaded original files at those exact names can also be adopted after their published lengths and dictionary identity are checked. Original archives and response receipts are retained.

The source does not need the much larger original daily-flow or water-quality input archives to use these already published final load estimates. Native reproduction of the national estimator is a separate task described by the original USGS report.

## Inventory the actual project watershed groups

The seven codes below come from the original Upper Savannah 217-HUC source inventory. They are an explicit candidate lookup in the publisher's paired station table; the original station coordinates and full upstream polygons remain the geometry used for preparation and native comparison.

~~~bash
python -B -m source_tools.usgs_annual inventory \
  --original-root /mnt/data/usgs-annual2012-original \
  --huc8 03060101 --huc8 03060102 --huc8 03060103 \
  --huc8 03060104 --huc8 03060105 --huc8 03060106 \
  --huc8 03060107 --output /mnt/data/usgs-annual2012-inventory.json
~~~

The inventory contains the original headers, delimiters, archive-member CRCs and hashes, national record counts, selected full source rows, exact paired station rows, published chosen method, numeric value, standard error and source dates. Blank or unusable original estimator records retain their reason. Water-quality station IDs and flow-station IDs are joined exactly and preserve their leading zeros.

Omit the HUC arguments to inspect all original published station rows. Neither a regional station prefix nor a guessed site name selects observations.

## Prepare actual selected records and upstream basins

Use the actual source ID and record IDs returned by the inventory in a JSON selection with schema upstate.usgs-annual2012-selection/v1, a descriptive title, and a records list.

Every record entry contains record_id and either catchment or retained_catchment. A live catchment selection contains the original NLDI source, identifier, station_role and split_catchment boolean. The accepted roles are water_quality_station, published_flow_station and published_reach. The shared NLDI receiver checks the selected role against the original annual source station or COMID and retains the current full-resolution feature and upstream basin responses.

A retained_catchment uses the same four identity fields plus feature and basin file descriptors. Each descriptor contains an actual relative path, bytes, sha256 and original uri. The files live beneath the original source root. This consumes the already recovered original NLDI cohort without requesting those responses again.

The retained geometry option also accepts component_indices and component_selection_reason. It preserves all original components, exact selected indices and any omitted coordinates and areas. This supports the inspected Calhoun Falls source, whose original basin response contains a remote triangular component alongside the station-containing Savannah basin. The native geometry uses the deliberately selected original component. The source response and complete geometry review remain retained.

The retained feature must identify the original station/reach, the original basin URL must use the selected full/split convention and simplified=false, and the selected polygon must meet the retained station or reach geometry. Native projected and ellipsoidal calculations use the original coordinates.

~~~bash
python -B -m source_tools.usgs_annual prepare \
  --original-root /mnt/data/usgs-annual2012-original \
  --selection /mnt/data/usgs-annual2012-selection.json \
  --output /mnt/data/usgs-annual2012-prepared
~~~

The result contains annual-loads.csv, observation-metadata.json, catchments.geojson, the exact original archives/dictionary, original NLDI responses, selected row and geometry lineage, and an ordinary upstate.sources/v1 manifest. The source dictionary, original table row, standard error and original flow/water-quality periods travel with every imported observation.

## Bind to the existing scientific workspace

~~~bash
python -B -m source_tools.usgs_annual bind \
  --workspace /path/to/the/existing/upper-savannah-workspace \
  --prepared /mnt/data/usgs-annual2012-prepared
~~~

The command returns the actual source_collection_id, observation_id and catchment source/id-field selection. Its saved binding includes recommended_temporal_weighting and the original preparation ID. The current calibration catalog reads that saved observation edition immediately.

Select completed native baseline candidates using the installed Calibration workspace. Use the returned observation and catchment identities, preserve the recommended temporal weighting, inspect the source periods and spatial groups, then prepare and run the evaluation. Existing calibration logic groups shared upstream polygons and repeated station identities together, resolves overlapping alternative observation series, and compares native annual export against the retained annual rate.

The native 3.20.0 NDR and SDR export rasters use mass per hectare per year. The original catchment comparison multiplies the selected native raster values by cell area once to obtain annual mass. The annual reference importer supplies kg/year; the existing observation adapter performs the documented sediment mass-unit conversion.

## Receiving and continuation

The source receiving and inventory commands use Python's standard library plus the application's existing file/HTTP helpers. Catchment preparation uses the installed GIS stack. Binding uses the maintained Workspace API, including its current source-object and native-view behavior.

Prepared operations preserve their original plan and complete file identities. Repeating preparation or binding resumes the same source edition. A new original source, station selection or geometry decision belongs in a new preparation directory.

Source implementation: source_tools/usgs_annual.py. Original source bank: source/usgs-nldi-upper-savannah-20261013. Scientific source: [Saad and others, 2019, USGS SIR 2019–5069](https://doi.org/10.3133/sir20195069); [USGS original data release](https://doi.org/10.5066/F7DN436B).
