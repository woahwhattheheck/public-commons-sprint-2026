# Regional climate inputs

This stage prepares actual retained PRISM precipitation and NOAA rainfall erosivity on the same explicit 30 m grid as the selected Upper Savannah model. It plugs into the existing source composer and Workspace. It can prepare precipitation immediately, then add rainfall erosivity later without recomputing the completed precipitation raster.

## Run

Use the existing prepared original source-entry files. Keep the selected grid, originals and outputs below one project root. The stage references these retained inputs in place; it does not download another national archive.

    python -B -m source_tools.climate_region \
      --project-root /data/upstate \
      --grid /data/upstate/grid/regional-grid.json \
      --precipitation-entry /data/upstate/inputs/prism/source-entry.json \
      --erosivity-entry /data/upstate/inputs/noaa-r/source-entry.json

Either climate entry may be omitted. For the first NDR run, supply only precipitation. When rainfall erosivity arrives, run the same command with both inputs. The existing per-role result is reused after its source and output identities are checked. The returned JSON supplies the ordinary upstate.sources/v1 manifest and source IDs for the model plan.

If the full PRISM original has been received but its native entry is not prepared, use the maintained receiver first:

    python -B -m source_tools.raster_sources prism \
      --output /data/upstate/inputs/prism \
      --archive /data/upstate/originals/prism-ppt.zip \
      --transfer /data/upstate/originals/prism-transfer.json

For NOAA, use its maintained receive/prepare commands and original complete capture:

    python -B -m source_tools.erosivity_sources prepare \
      --output /data/upstate/inputs/noaa-r \
      --capture-directory /data/upstate/originals/noaa-r

These paths illustrate the receiving layout; select the actual retained paths on the accepting host.

## Join the model

Feed the returned climate manifest to source_tools.compose with the selected DEM, NLCD, soils and watershed source entries. Its path must be above the selected source manifests and their files. Use the resulting source collection and the returned climate source IDs in input_sources.PRECIPITATION and input_sources.R_FACTOR.

The model grid must use the same projection, affine transform, 30 m cell size and extent selected for the prepared climate stage. A grid JSON can be the existing grid record (with a grid object), a grid_definition result, or the explicit regional-grid contract. The input grid's coordinate system must be projected in metres and its dimensions and bounds must agree.

This stage does not redefine the upstream model domain or reporting area. Use the retained full contributing domain and the original reporting selection.

## Units and spatial interpretation

PRISM provides the 1991-2020 average annual precipitation normal. The native source is 30 arc seconds, nominally 800 m. It is used as the explicitly selected annual NDR runoff proxy and remains labelled mm/year. The original band scale, when present, is already declared by the maintained PRISM preparer.

NOAA's CONUS rainfall-runoff erosivity source is an 800 m raster derived from AH703 isoerodents, published in 2013. Its source values use hundreds*ft*tonf*in/(acre*h*year). The maintained NOAA source entry applies the documented 17.02 conversion (and any original band scale) to MJ*mm/(ha*h*year).

The stage delegates numerical alignment to model.rasters.align_source. That existing implementation reads native raster windows with a 64 MB GDAL cache and a 64 MB warp limit. Bilinear interpolation is the default for these continuous fields; an explicit average or nearest method can be selected. The original source resolution, CRS, transform, band metadata, vintage, source bytes and unit-conversion details remain attached to every derived entry.

The regional output pixels already contain the target physical units. Their top-level conversion field is absent so downstream Workspace preparation cannot multiply the PRISM scale or NOAA factor a second time. The original conversion remains in derived_from.applied_conversion and the retained derivation file.

## Recovery and delivery

The preparation ID binds the source-entry hash, original raster hash, grid geometry, grid-file hash, selected resampling and units. Each role has its own immutable output path and a preparation.json recording progress, failure or completion. An interrupted role resumes from its original selection and rewrites only that role's incomplete raster. Completed roles are read and reused.

The generated source manifest retains original numeric source bodies, complete original companions, the selected grid and the regional derivation. Original archives stay under the same project root without another source-stage copy. Existing Workspace import and portable receiving remain responsible for the final project's retained objects.

The result includes valid and missing cell counts, observed minimum and maximum, native source metadata and SHA256 identities. All-nodata or negative physical values fail the affected preparation. Missing cells stay nodata and remain visible in the actual coverage counts.

## Source references

- PRISM Group, Oregon State University, 30-year normals: https://prism.oregonstate.edu/normals/
- Selected original annual archive: https://data.prism.oregonstate.edu/normals/us/800m/ppt/monthly/prism_ppt_us_30s_2020_avg_30y.zip
- NOAA Office for Coastal Management, CONUS R-factor metadata (including native units and lineage): https://www.fisheries.noaa.gov/inport/item/48224/full-list
- Original NOAA archive: https://coast.noaa.gov/data/digitalcoast/zip/R-Factor-CONUS.zip
- InVEST SDR input units and US customary conversion: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html

Authored by TokenJunkieLabs. Preserve original source and third-party notices.
