# Full-resolution map quantities

The existing delivery builder now adds quantitative companions to its selected
map atlas. Open **Map atlas**, choose a family or alternative, and read the
full-resolution values below the original map and GIS download links. Download
**Full-resolution map values CSV** for familiar tabular analysis. The ordinary
scientific PDF, HTML, ODT and workbook outputs receive the same typed tables.

The numerical source is the exact retained single-band GeoTIFF identified by
the atlas dataset registry. The summary reads the full native grid in bounded
windows, retaining its internal mask and verified external companions. It
does not run InVEST, change a raster, resample results, invent observations or
convert native rates a second time. Existing completed runs remain the source.

## Reading the values

- **Valid mapped support** counts finite, unmasked pixels and multiplies by the
  projected affine pixel area, including a recorded conversion of linear units
  to metres. This is projected grid area, not a geodesic ground-area estimate.
  Excluded cells retain NoData and nonfinite values; they are never counted as zero.
- **Annual export** sums only `kg/pixel/year` or
  `metric_tonnes/pixel/year`, producing `kg/year` or `metric_tonnes/year`.
  Pixel hectares are already part of these retained physical values and are
  not multiplied again. A completely empty support has an unavailable total.
- **Net annual change** retains the existing alternative-minus-baseline
  direction. Negative and positive cell contributions are shown separately;
  cancellation therefore stays visible. Their sum is the net change on that
  difference raster's original common support.
- **Minimum, median, percentiles, maximum and mean** describe the original
  values, including zeros and negatives. Percentiles reuse `raster_stats`' exact
  native order statistics and linear interpolation. They do not use the
  downsampled preview or the display-scale population.
- **Outside the displayed color range** counts values strictly below or above
  the selected cap. A pixel equal to a cap is inside the range. These counts
  explain color saturation without changing the delivered values.
- **Priority scores** retain their dimensionless scale. They have descriptive
  cell statistics and support areas, with no mass total or mass conversion.

Every raster retains its own actual valid footprint. The summary never
subtracts full totals from different masks or labels a range as an empirical
prediction interval. Teaching domains, regional modeled cases, original source
editions and observation context keep their existing meanings.

## Integration and reusable output

`delivery.build` calls `map_summary.write` after the existing atlas dataset and
map generation. The delivery identity includes `map_summary.VERSION` so this
new report edition does not replace a historical delivery. The files are:

- `maps/map-quantities.json`: complete numeric values, methods, original source
  editions, run/profile/grid IDs, raster hashes, masks and map relationships;
- `maps/map-quantities.csv`: one readable numeric row per map panel, with exact
  original identities. Repeated maps of the same raster deliberately repeat a
  row; these rows are not additive;
- the existing `maps/atlas-browser.html`: familiar atlas controls and the
  new human-readable quantities alongside each original scientific map.

`map_summary.report_sections` emits the existing typed scientific-report table
format. The ordinary complete delivery and editable Workspace archives include
the two registered files through the existing packager. Earlier atlas editions
without summaries remain readable.

The summary identity binds the current atlas dataset registry, source file
descriptors, scientific meanings and map scales. A resumed current delivery
reads its retained summary and CSV without another raster scan. A changed
dataset binding requires its own delivery edition. Full raster and companion
hashes are checked both before and after first calculation.

## Current owner direction and receiving

Carry `CURRENT_OWNER_DIRECTION.md` version `2026-10-14.1`, its complete Windows/Mac
release directions and the post-call work bank `F0C8R2SQ0NP`. Preserve all seven
original workspaces and all 82 completed runs in the current full release. No new native calculation is needed to summarize
completed results. Keep every original completed study and active worker.

The producing worker must open and use the exact outgoing atlas at desktop and
390px, operate family/scenario/search/reset, open the linked scientific maps,
download and reopen the CSV, inspect the actual scientific report pages and
GIS rasters, and cold-open the delivered archive. Personally view screenshots
and recipient-facing contents; source checks alone do not establish rendering.
Use focused checks for these changed behaviors. Keep existing lab attribution,
source and units, contact holds, no Tim send, no paid subscription, no private
repository/Actions and no llama.cpp rules.
