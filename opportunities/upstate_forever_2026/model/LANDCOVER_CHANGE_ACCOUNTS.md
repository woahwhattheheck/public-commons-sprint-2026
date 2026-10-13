# Observed land-cover interval accounts

## Purpose and original input

`model.landcover_change_accounts.derive_accounts(report)` consumes the complete original `upstate.landcover-ledger/1` object with its `upstate.landcover-timeline/v1` annual class stocks and adjacent transitions. The original report must be complete and use common support across every selected observation. The function uses Python's standard library only. It does not open rasters, resample land cover, interpolate missing years, alter masks, change the scientific case, or mutate the supplied report.

The canonical NLCD class names and eight existing group definitions are copied exactly from the original `model/landcover_ledger.py` at source `8e5cb23856eb6f141184c367954177e5722ec8ed`. The full original class dictionary must match before accounts are returned. The domain and all individual reporting polygons remain separate.

## Reading an interval

An interval connects two adjacent **selected observations**, not necessarily consecutive calendar years. Opening is the class/group area at the earlier observation. Closing is its area at the later observation. Retained is present in that same class/group at both endpoints. Gained enters from outside; lost leaves to outside. Net is closing minus opening and may be negative.

The original transition table supplies all flows. The function does not obtain gain/loss by subtracting nearly equal totals. It sums the actual entering, leaving and retained transition cells, then checks those values against the independently retained annual stocks.

- Opening = retained + lost.
- Closing = retained + gained.
- Net = closing - opening = gained - lost.
- Each transition row equals its earlier annual class stock.
- Each transition column equals its later annual class stock.
- Every annual and adjacent transition total equals the same all-observation supported area.

Within-group class changes count as group retention. A 41-to-42 transition loses deciduous forest and gains evergreen forest while retaining the forest group. Class90 woody wetlands is wetland, not forest. The eight groups are not an exhaustive partition; do not sum group rows as the total classified landscape. Developed open space is a mapped category, not a measurement of impervious cover.

The adjacent account differs from the original whole-history ever-entered/ever-exited measures. A cell can leave a group in one interval and return in another. These accounts do not infer the transition date inside the interval, annualize change, establish continuous persistence, or claim ground-truth ecological change. Classification disagreement and source revision remain possible explanations.

## Availability, geography and precision

All numeric account measures use **hectares** on the original fractional polygon/pixel common support. Intersecting-cell counts are not substituted for area. The `__domain__` row counts the unique original polygon union; overlapping zone rows must not be added to derive a study total.

When `analysis_ha == 0`, the source stocks/transitions must themselves be zero. The returned row has `available:false`, a readable `unavailable_reason`, and all six class/group account measures are `null`. A blank CSV quantity means unavailable, not zero. With positive support, a class absent at both endpoints has valid zero measures.

Nonfinite, negative, unknown, repeated or missing original areas/classes/years/zones are refused. Annual stocks include every original class, including zero stocks; transitions remain sparse but may not repeat a class pair. Both annual/transition inventories and the original ledger support rows must agree.

Conservation uses the original temporal reducer tolerance: relative3e-10 and absolute1e-8ha. The net-flow equality additionally scales its absolute tolerance by the largest compared stock/flow to accommodate cancellation of large nearly equal stocks; no values are rounded, clamped, renormalized or silently repaired. Display rounding belongs to the report and must not replace complete downloadable values.

## Return contract

Schema: `upstate.landcover-change-accounts/v1`.

Top level:
- `ledger_signature`: exact original signature.
- `years`: all selected observation years in original order.
- `definitions`: complete scientific labels/interpretations.
- `zones`: a deep copy of the complete original reporting-zone metadata.
- `validation`: numeric tolerances and the checked input basis.
- `rows`: all original zones in original order.

Each row:
`zone_id, zone_name, analysis_ha, covered_ha, coverage_pct, available, unavailable_reason, intervals`.

Each interval:
`from_year, to_year, gap_years, classes, groups`.

Each class:
`code, name, opening_ha, retained_ha, gained_ha, lost_ha, closing_ha, net_ha`.

Each group:
`name, codes, opening_ha, retained_ha, gained_ha, lost_ha, closing_ha, net_ha`.

Group names/codes are the unchanged original keys: developed21/22/23/24; forest41/42/43; wetland90/95; cultivated_crop82; pasture_hay81; water11; shrub51/52; herbaceous71/72/73/74.

An invalid source raises `AccountsError(ValueError)` before a result is returned. No partial scientific account is published.

## Integration and complete receiving

Keep the original immutable edition, original `ledger.json`, its manifest and the existing `#ledger-data` payload byte-identical. The maintained export integration may create a separate verified presentation copy containing the accounts, complete class/group CSVs and `timeline-report.json`:

```json
{"schema":"upstate.landcover-interval-report/v1","ledger":"the complete original ledger object","accounts":"the complete derive_accounts result","tables":[{"path":"timeline-interval-classes.csv","content":"complete exact class CSV text"},{"path":"timeline-interval-groups.csv","content":"complete exact group CSV text"}]}
```

The strings above describe the actual object positions; the delivered wrapper contains full objects. The frontend receives and validates the complete source/account binding and exact native CSV rows; it does not recalculate scientific accounts. An ordinary original-ledger import remains valid and shows the added accounts unavailable until complete report data is opened.

For a completed original timeline, derive accounts from its unchanged saved ledger and inspect the actual class/group stock and flow values, coverage, missing-year interval labels, unavailable zones, full CSVs and complete report-data reopening. Preserve that exact selected source/ledger/case and every previous artifact. Do not create another numerical run merely to regenerate presentation.

The producing peer must operate and personally inspect the actual desktop and narrow report, all outgoing maps/tables/downloads and each complete attachment. Pure source/accounting checks do not establish browser or customer-delivery acceptance. Current post-call work orders and original owner instructions remain part of this receiving scope.
