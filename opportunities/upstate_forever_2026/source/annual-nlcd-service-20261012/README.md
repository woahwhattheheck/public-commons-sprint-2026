# Annual NLCD original service description

This source entry retains the exact 13,096-byte USGS WCS DescribeCoverage response acquired on October 12, 2026. The qualified coverage is `mrlc_Land-Cover-Native_conus_year_data__Land-Cover-Native_conus_year_data`.

## Native contract

The source advertises EPSG:5070 and the explicit annual time values 1985–2025, with 2025-01-01T00:00:00.000Z as its current default. The rectified grid has indices 0,0 through 159999,104999, origin -2415585,3314805, and the original two offset vectors recorded in contract.json. The source format is image/tiff. Range PALETTE_INDEX advertises nil value 250 and interval 0–255. Preserve these source declarations; read the delivered GeoTIFF's own dtype, transform, projection, NoData and categorical values before accepting the raster.

The published range-unit string is retained verbatim as service metadata. Land-cover class codes remain categorical, and their model meaning comes from the original Annual NLCD class definitions and the selected biophysical profile.

## Capture custody

- Original request: https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wcs?service=WCS&version=2.0.1&request=DescribeCoverage&coverageId=mrlc_Land-Cover-Native_conus_year_data__Land-Cover-Native_conus_year_data
- Exact UTF-8 body: coverage-description.xml
- SHA256: 1a3cba52dca82969d46c0f08aa02f5f2047b5c94edb87bc476c8d172bbad0ff9
- Git blob: 3b2a5c7af9af83f5ec4cc879f87c0c5bdcbc2a53
- Original uploaded file identity: 3f7dd772-3100-8142-b4e4-00b28efedcfa
- Durable metadata page: https://app.notion.com/p/3f7dd77231008147bfb0d97e296fda3b

The connected source-file loader retained the original XML; its small-text download returned all 13,096 bytes. The loader does not expose the origin server's HTTP status, headers or response timestamp, and those fields remain null in contract.json. The observed tool receipt time is recorded separately.

The separate original WMS capabilities body (225,983 bytes) is retained on the same metadata page at its stable file reference. The source page owns the complete original attachment independently of short-lived signed download URLs.

## Watershed acquisition

The complete 217-feature upstream domain is selected from the original WBD topology and geometry under source ID `upstate-wbd-upstream-domain-20261012`. Derive a request envelope from those actual selected polygons in EPSG:5070; request the explicitly selected 2025 time through WCS GetCoverage as native numeric GeoTIFF. Preserve the requested envelope, coverage/time/format parameters and response body. Align categorical data with nearest-neighbor only, retaining the original raster and the mask/derived-grid lineage separately.
