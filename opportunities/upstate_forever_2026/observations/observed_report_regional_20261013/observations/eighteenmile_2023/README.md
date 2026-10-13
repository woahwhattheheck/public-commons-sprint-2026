# Eighteenmile Creek 2023 published monitoring companion

Original source: https://www.des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf
Technical Report 010-2023; December 2023. PDF page numbers in these files are one-based.

The data files retain five monitoring sites, 26 seasonal concentration summaries, surface field ranges, continuous-monitoring monthly summaries and the report's four named upstream NPDES permits. Each row identifies its source table/page. The original report and separate current Water Quality Portal station pages remain the source records.

## Use in the existing workbench

Join by site_id or monitoring_location_id. Keep the seasonal-summary statistic type, sampling depth, parameter and units. Compare the 2023 lake gradient and response conditions alongside the completed watershed scenarios. The existing OBS12 importer owns individual sample activities and any flow-supported annual-load comparison.

Read each station's datum when using coordinates: SV-838, SV-839 and SV-840 use NAD83 (EPSG:4269); SV-268 and SV-374 use WGS84 (EPSG:4326). The separate report_latitude/report_longitude fields preserve the report's rounded coordinates. Project using the existing GIS reader before spatial joins.

source_notes.json retains published count, range, area and table-reference differences plus reported sample-quality events. Numeric values in the CSVs preserve the publication. Null values remain empty; qualifier and detection-limit columns retain censored minima. The report's below-detection substitutions are recorded with each affected summary.

## Files

- study.json: source edition, time support, sampling design, catchment context and counts.
- stations.csv and stations.json: site identifiers, source coordinates/datums and original URLs.
- seasonal_summaries.csv: phosphorus, nitrogen, chlorophyll-a and microcystins.
- surface_ranges.csv: pH, oxygen, temperature, conductivity and turbidity.
- continuous_monthly_do.csv and continuous_monthly_ph.csv: published monthly summaries.
- reported_npdes_permits.csv: dated permit/facility identifiers from the report.
- source_notes.json: source field differences and sampling-quality context.

The native receiver writes these complete files together, then uses the existing source registration and Measurements document/summary intake.
