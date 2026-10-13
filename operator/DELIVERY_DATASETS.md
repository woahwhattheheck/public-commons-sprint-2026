# Editable datasets for the original map atlas

The ordinary scientific delivery includes the exact GIS datasets behind its selected map panels. Open a delivery in the existing operator, choose **Browse map datasets and metadata**, then use the GeoTIFF and FGDC XML links beside each panel. **Download map-to-dataset CSV** provides one row per panel; **Download dataset and lineage JSON** opens the existing atlas index, including complete dataset records. The **Show GIS files and metadata** control filters the existing declared-file inventory.

Use **Download complete delivery ZIP** to keep every relative path together. Extract the ZIP and open the retained map browser in the maps directory. Its links work locally. Downloading one GeoTIFF separately requires keeping its listed companions beside it under their original corresponding filenames.

## The selected maps and quantities

| Map family | Delivered dataset |
| --- | --- |
| Current nutrient export | Original nitrogen and phosphorus annual mass per pixel |
| Current sediment export | Original sediment annual mass per pixel |
| Combined pollutant export | Original dimensionless weighted relative priority |
| Critical drinking water | The actual selected generic, receptor or receiving-water priority shown on that map |
| High-quality waters | The actual selected generic, receptor or receiving-water priority shown on that map |
| Future sediment loss | Every selected alternative's original signed sediment difference |
| Future nutrient runoff | Every selected alternative's original signed nitrogen and phosphorus differences |

Native-study deliveries retain their existing family selection. Receiving-water and receptor replacements are resolved before dataset retention, so the links follow the actual map panels. A shared priority raster has one dataset record with multiple map relationships. Every selected future alternative keeps its original run identity and separate map rows.

A scenario difference means **alternative minus baseline** on the original common finite valid support. Positive values indicate greater modeled export. Its physical units already include the original pixel area; packaging copies the TIFF without multiplying it again. The original difference descriptor may contain valid_cells and sum_change; the catalogue retains these original fields without substituting full-run totals.

A relative priority is dimensionless. The catalogue retains the actual normalization, caps, weights and zero-cap policy, together with any receptor footprint or receiving-water quantity scope. Zero-weight pollutant masks do not constrain the existing combined-priority support. A receptor subset keeps its original whole-basin normalization. A receiving-water dataset keeps that analysis's own recorded normalization and selected support.

Map display percentiles and legend limits are presentation metadata. They do not define the numeric range of a GIS dataset or change its values.

## One existing map index

The original maps/atlas-index.json remains the catalogue. Its existing family, map_key, scenario_run_id, panel units, signed flag, display_scale and source_raster fields are preserved. Each captured panel additionally has dataset.id, dataset.file, dataset.metadata and dataset.companions. File descriptors contain actual relative paths, byte counts and SHA-256 values.

The atlas datasets section retains one record per selected original raster path. It includes the exact header, original source descriptor, original comparison identity, selected runs and scenario definitions, producing-model version provenance, profile and grid IDs, source editions, support method and derivation. The model-domain and reporting-area records remain distinct. Actual CRS, affine transform, dimensions, pixel size, NoData and mask flags come from the selected original grid and raster header. Native resolution remains unchanged.

The original maps/atlas-index.csv has additional dataset_id, delivered_raster, fgdc_xml, raster_sha256 and companion_paths columns. Existing columns and spreadsheet-value escaping remain intact.

FGDC XML for original physical baseline exports keeps the existing producing-model and rate-to-mass lineage. Derived datasets receive quantity-specific metadata: signed common-support subtraction or the recorded priority normalization and geographic scope. The packaging process records its actual date and verified source/destination hashes. Original producing-stage completion dates remain in the retained run metadata; an unknown separate derivation date remains unknown.

## Capturing and reopening

New source is received through the ordinary cumulative application component catalogue. The required delivery-datasets family includes the complete dataset module, atlas index/browser and inspection changes. Restart the maintained operator after receiving the current application.

Build a delivery using its existing baseline, alternative runs, source selections and contact. The current dataset and atlas editions participate in delivery identity. Existing complete deliveries retain their immutable original IDs and files; selecting the same scientific inputs in the current application produces the new delivery edition. The model results and comparisons remain the existing retained calculations.

The dataset module verifies each panel against the registered original delivery or comparison artifact. It reuses an already delivered TIFF or copies an external comparison TIFF byte-for-byte into the delivery. Present GDAL companions are retained under matching filenames. The metadata reader inspects headers and dependency names without scanning all pixel values.

All additional TIFFs, XML and companions are registered in ordinary state.files before final project_assets, the offline atlas and portable snapshot are captured. The original manifest.rasters contract remains the three physical baseline exports. Signed deltas and priorities enter the existing explicit project assets, so the baseline nonnegative physical-raster audit retains its original meaning.

The existing working archive retains both the original Workspace calculations and the complete delivery snapshot. Reopen it through the maintained portable restore flow, then open the same delivery and its map/dataset links. The complete delivery ZIP independently retains the atlas and all declared GIS members.

Interrupted delivery builds reuse registered files after descriptor verification. A compatible retained atlas can refresh its dataset/index metadata without rendering its verified map PDFs again. The refresh compares original page order, panel semantics, units and display scales before changing index links.

## Source and operation

Operation: ES-20261013-DELIVERY-DATASETS.

Implementation: model/delivery_datasets.py, the narrow model/delivery.py integration, model/map_atlas.py, model/atlas_browser.py, operator/web/delivery_inspection.mjs and the required integration/application_components.json family. Existing scientific raster producers, run identities, operator endpoints, file authorization, portable restore and baseline physical-raster audit remain the maintained source contracts.
