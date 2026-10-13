# Eighteenmile 2023 measured chlorophyll and observed flow

This is the scientific figure component of the existing dated study and report, using the exact 75 selected CHLA records and 16 original laboratory dates. Four standalone SVGs retain real axis scales, units, activity identities and source notes. The machine-readable figure-spec.json supplies the maintained scientific report exporter with the same numerical series; the report can render these with its existing vector drawing primitives.

## Figures

1. chlorophyll_time_series.svg: five vertically stacked station panels, common 0–40 ug/L scale, all fifteen reconciled samples per station.
2. chlorophyll_distributions.svg: all 75 values; R-7 quartiles, median, observed extrema and arithmetic mean. Point offsets separate observations and carry no scientific quantity.
3. sampling_flow_context.svg: same-date daily mean and maximum daily mean during the preceding seven calendar days at USGS 02186702. Includes fifteen CHLA dates and the additional 24 August microcystin date. Annual 95th-percentile reference is 134.8 ft3/s.
4. chlorophyll_antecedent_context.svg: all five stations against the same observed preceding-week peak, with common axes and the annual percentile reference. This describes shared upstream temporal context without fitting a causal model.

## Source and interpretation

Original 2023 measurements span 5 April–17 October for the selected CHLA cohort. Sample depth is 0.3 m. Original EST/EDT labels remain unchanged. The existing documented displayed-clock reconciliation excludes two overlapping routine visits; all 920 original result rows remain in the main study measurement table. The five means are 7.4066667, 24.0973333, 15.4153333, 10.6753333 and 6.0653333 ug/L in plotted station order SV-268, SV-838, SV-839, SV-374, SV-840. These reconstruct the published means, sample standard deviations and extrema. The report's printed n = 4 at SV-374 and SV-840 remains an explicit original-source field; each selected source cohort contains fifteen observations.

No CHLA sample date has a same-date flow at or above the annual 95th percentile. Four followed such a daily mean within the preceding week: 2 May (687 ft3/s on 28 April), 14 June (604 on 12 June), 27 June (142 on 21 June), and 8 August (155 on 3 August). Prior windows exclude the sample date. The gauge is upstream of the lake stations; its observed daily flow is contextual and is not assigned as the lake-station discharge. Original source indices are retained in plot-data.csv and the ordinary flow table.

## Offline rebuild

From this component, run:

```sh
node rebuild_figures.mjs /ABSOLUTE/APPLICATION/observations/eighteenmile_2023 /ABSOLUTE/NEW/FIGURE_OUTPUT
```

The command reads the existing original selected-CHLA and observed-flow tables, verifies all four input SHA256 identities, loads pinned local D3 modules through Node's standard VM, and writes the four SVGs, plot-data.csv, distribution-statistics.csv and figure-spec.json. Every regenerated body must match the supplied source identity. It needs Node with standard modules, no package installation or network. Pinned D3 modules and their original ISC licenses are included unchanged under vendor/. Their original URLs and hashes are in figure-sources.json.

The pure data-processing and D3 rendering functions were executed on all 75 observations and 16 flow dates in the source-producing runtime. The supplied Node command is the native replay entry point.

## Native integration

Import this component's model-sources.json through the existing Workspace import_sources operation. It registers the four SVG documents, two numerical tables and figure specification. Companion paths retain the original source tables and methods in the same study tree. The main study manifest remains the ordinary measurement/map intake. The current scientific_report and delivery owners can consume figure-spec.json and retain the SVG files as report assets; no separate report or observation application is introduced.

Each spec panel declares numeric axis domains/ticks/units, line/scatter/boxplot series, actual points, reference_lines and captions. Date coordinates are days since 1970-01-01 UTC solely to encode original calendar labels; this does not convert the original sampling times. Box points carry minimum/q1/median/q3/maximum/mean/n. Field-filled symbols on antecedent plots denote preceding daily flow at or above the annual percentile.
