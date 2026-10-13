# Upper Savannah scientific workspace

This is the source-to-model-to-delivery extension of the existing Upstate Forever
GIS acceptance package. It retains original source editions and runs the actual
InVEST 3.20.0 Nutrient Delivery Ratio and Sediment Delivery Ratio engines. The
operator application uses this same workspace and its resumable native stages.

## Native environment

Use an equipped Python 3.10+ GIS environment with natcap.invest==3.20.0 and its
matching GDAL/pygeoprocessing dependencies, plus Rasterio, Fiona, Pyproj, Shapely,
NumPy, Matplotlib and ReportLab. Inspect the selected environment with:

    python -B -m model.cli runtime

The runtime record includes the exact installed model version and original
NDR/SDR module hashes. The complete parameter/input selection remains part of each
run. Hosted GitHub Actions are unnecessary for any operation in this application.

## Complete operating sequence

From the product root:

    python -B -m model.cli --workspace /owned/project init
    python -B -m model.cli --workspace /owned/project source-import /owned/edition/sources.json
    python -B -m model.cli --workspace /owned/project profile-save /owned/profile.json
    python -B -m model.cli --workspace /owned/project scenario-save /owned/baseline.json
    python -B -m model.cli --workspace /owned/project grid-prepare /owned/grid.json
    python -B -m model.cli --workspace /owned/project run-prepare /owned/run-selection.json
    python -B -m model.cli --workspace /owned/project run RUN_ID

Select an explicit land-cover scenario and prepare another run on the same grid
and parameter profile. Completed native stages and comparisons reopen directly:

    python -B -m model.cli --workspace /owned/project compare-runs BASELINE_ID ALTERNATIVE_ID
    python -B -m model.cli --workspace /owned/project observations-import loads.csv observations.json
    python -B -m model.cli --workspace /owned/project observations-compare RUN_ID OBSERVATION_ID catchments.json
    python -B -m model.cli --workspace /owned/project delivery-build delivery-selection.json
    python -B -m model.cli --workspace /owned/project backup /owned/scientific-workspace.zip

A native failure retains the selected run, original arguments, log, completed
engine outputs and TaskGraph working files. Correct the actual missing source or
runtime issue and invoke the same run ID. A changed scientific selection gets its
own immutable run ID.

## Original source editions

The intake manifest uses schema upstate.sources/v1 with title, captured_at, notes,
scope and entries. Each entry has a unique id, title, original uri, vintage, kind
(raster/vector/table/document), relative path and optional expected sha256.
Native sidecars are listed as companions with their own relative path and hash.
Optional role, units, layer, resampling and conversion metadata remain retained.

Original files are copied into a content-addressed object store. Source views
preserve each native filename and sidecar; they can be reconstructed after restore.
A shapefile must include its complete actual companion files. Source code and
archive members are data during intake and receiving.

The combined model selects five raster roles: DEM, NLCD, PRECIPITATION, R_FACTOR and
K_FACTOR. NDR-only selections require DEM, NLCD and PRECIPITATION; SDR-only
selections require DEM, NLCD, R_FACTOR and K_FACTOR. Their IDs are bound in the
grid's source edition. The projected metre 30 m NLCD grid supplies the default
alignment. An explicit grid resolution_m retains another original study's actual
native reference resolution. DEM must be metres; R must be
MJ*mm/(ha*h*year); K must be t*ha*h/(ha*MJ*mm). A physical conversion requires its
factor, target_units and original source reference. Categorical resampling is
nearest/mode; continuous inputs use an explicitly selected bilinear/average rule.

Reporting-area and model-domain choices each select an original polygon source,
native layer and optional exact attribute filter. The model domain must contain
the full reporting area. The separately declared positive upstream_buffer_m adds
model context; the SC reporting mask is applied only to delivered reporting rasters.
The original model-domain output remains available for upstream/cross-state
observation comparisons.

## Profiles and scenarios

Profiles require a title, references, original source_collection_id and
biophysical_source_id. The combined CSV contains lucode, load_n, load_p,
load_type_n, load_type_p, eff_n, eff_p, crit_len_n, crit_len_p,
proportion_subsurface_n, usle_c and usle_p. Preserve the original parameter
lineage and distinguish application-rate from measured-runoff in current NDR.

Both native models take threshold_flow_accumulation, k_param and
flow_dir_algorithm (mfd or d8). NDR also takes subsurface_critical_length_n and
subsurface_eff_n. SDR also takes sdr_max, ic_0_param and l_max. These are the
published native parameter names. A selected literature profile remains identified
by its publication/model edition; actual local calibration remains a separately
retained profile with its original observations.

A scenario requires title, reason, kind, source_collection_id and patches.
A baseline has no patches. Each land-cover patch binds an actual polygon source
and optional layer/filter, from_codes, to_code and reason. Patches apply in the
explicit saved order. Changed cells/area and the derived LULC raster are retained.

## Quantitative results and observations

InVEST 3.20.0 outputs N/P kg/ha/year and sediment metric tonnes/ha/year.
The delivered 30 m rasters multiply these actual native rates by 0.09 ha:
N/P kg/pixel/year and sediment metric tonnes/pixel/year. Original native values,
NoData and the reference alignment stay intact.

Run comparisons return alternative minus baseline. Future-service maps require
actual land-cover alternatives on the same parameter profile and grid. A parameter
sensitivity comparison is separately labeled. The combined priority index keeps
all three pollutant units separate and records nonnegative weights and the chosen
positive-cell percentile or explicit normalization caps.

Observation intake retains every original CSV row and its qualifiers. Annual-load
comparison requires original annual_mass_rate values, their annualization_method,
period, catchment identity and explicit mass/year units. Bacteria, cyanotoxins and
concentrations remain original contextual measurements. The model never turns
those measurements into annual N/P/sediment loads. Catchment comparisons use the
full native output, preserving upstream land outside the SC reporting mask, and
return coverage, residuals, bias, RMSE and NSE where defined.

## Seven-family GIS delivery

Delivery selection binds title, baseline_run_id, scenario_run_ids, source_roles,
overlays, contact, map_settings and optional observation_comparison_ids/notes.
Required source roles include PROTECTED_LANDS, PARCEL, NHD and NWI, alongside
actual grid inputs. LS_FACTOR comes from the original SDR terrain calculation;
the recorded DEM source and native LS artifact remain its provenance.

Select actual drinking_water and high_quality_waters vector overlays. Optional
protected_lands and parcels overlays enable source-bound parcel inventories.
Parcel selection may name an id_field; otherwise the native feature ID is used.
Repeated parcel labels never silently replace original features. Optional
high_quality_buffer_m defines the stated water-context radius.

Parcel outputs preserve original attributes and native identity, quantitative
N/P/sediment export totals, valid-cell coverage, protected-area fraction, source-
water/high-quality-water intersection, current relative priority and explicit
scenario changes. Native overlaps remain separate records; their sums are not
presented as a basin mass balance.

The delivery contains current N/P and sediment rasters, future scenario maps,
source-water/high-quality-water context maps, a combined priority map, FGDC
metadata, a plain-language report, original native working archive and optional
parcel GeoPackage/CSV. The original package_delivery.py engine captures the files,
runs its existing native audit and creates its receiving navigator.

## Reopen the complete project

    python -B -m model.cli archive-inspect scientific-workspace.zip
    python -B -m model.cli restore scientific-workspace.zip /owned/new-receiving-directory
    python /owned/new-receiving-directory/application/model/cli.py \
      --workspace /owned/new-receiving-directory/workspace overview

The archive includes the original project UUID, immutable scientific selections,
retained sources, native working files, quantitative outputs and application.
Every member is checked before receiving publication. Restore creates a new
directory and preserves the original project/result identities. Source views
rebuild from original objects. Completed result inspection requires no new model
execution.

### Complete delivery carrier

The successful delivery includes `delivery-package.zip`, which contains the original audited package directory at its root, its original navigator and inventory, all selected GIS maps and physical rasters, and the complete scientific working archive. `transfer.json` binds every original member to the original package fingerprint. The operator exposes this one-file carrier with the other retained delivery outputs. Unpack it into a new directory, then run `python tools/package_delivery.py verify .` from its root to use the included unchanged original verification engine. The model's `delivery_archive.inspect_archive` can also verify every archived byte before extraction.

Native vector reads retain original gzip-encoded Esri JSON bodies through GDAL's documented `/vsigzip/` interface. The scoped Fiona environment follows the accepted Tucannon receiving correction, selecting that installed vector runtime's own GDAL/PROJ resources when present. Native source files and process environment are unchanged. References: https://gdal.org/en/stable/user/virtual_file_systems.html#vsigzip-gzipped-file ; https://fiona.readthedocs.io/en/stable/fiona.html#fiona.env.Env .

### Parcel inventory extent

The optional parcel inventory retains every native parcel identity and evaluates overlapping records independently. Its `parcel_coverage` metadata reports the geometric union of actual parcel polygons inside the full reporting mask, the covered fraction and the remaining area. County or utility-area parcel coverage can therefore accompany a whole-basin model without implying that all basin parcels were supplied. Scenario difference totals are summed from the actual delivered raster values.
