# All-year seasonal concentration change

This component extends the maintained Upper Savannah E. coli temporal study. It compares all observed years within the same calendar month, station, method authority, method code and physical unit. It does not replace the original calendar, first/last-year comparison, laboratory definitions or saved native monitoring plans.

## Build and open

From the complete application, use the original retained interval source:

```sh
python source_tools/seasonal_change.py \
  --input source/ecoli_temporal_analysis/20261013/record-intervals.csv \
  --output /path/to/new-seasonal-study \
  --publisher-root source/ecoli_utility_context/20261013 \
  --project-id b9d5d257-c6bb-4f07-b975-8e8c63705db3 \
  --edition 2026-10-13 \
  --sha256 4ad3864e802385c038f4c9005ed72c79f93de6b930a5b66b061ac325143ddfa0
```

Keep `seasonal_change.py`, `seasonal_view.html` and this guide together. The compiler uses the Python standard library. Open `index.html` directly, or serve the complete directory from a local HTTP server. The explorer has no external library, network or server dependency.

Use a new output directory for a changed producer or selection. Repeating an identical operation verifies and reuses its complete saved output. Failed staging directories are retained for recovery. The original source is copied unchanged. With `--publisher-root`, the compiler retains all twelve original publisher/context files with their original registry, checks their declared hashes, and joins every original interval row to its exact publisher CSV activity and station. The explorer exposes all nonblank publisher fields and downloads each complete unchanged source CSV. The source hash, producer hash, template hash, calendar selection and project identity are all retained.

## Read the study

Search a station, filter the original utility or enclosure direction, and switch between all routine records and the original Information Only comment sensitivity. Select a series to compare its available same-month pairs with a balanced-calendar subset. Open monthly cells to see their exact original activity IDs, source row numbers, laboratory method, detection status, limits, comments and time zone. Export the selected or filtered tables, original records, complete analysis and native source manifest.

The chart displays monthly median intervals, not a fitted concentration line. Dots are exact medians. Bars are bounded medians. Arrows are open upper limits. Its log(1 + concentration) scale is labeled. Unobserved months stay empty.

## Calculation

Each interpretable routine activity contributes equally to the median inside its station/method/year/month cell. For intervals `[L_i,U_i]`, the monthly median enclosure is `[median(L_i),median(U_i)]`. Missing intervals remain in the source and exclusion register, but never receive invented concentrations. Field replicates stay separate from routine activities. The six above-limit observations retain infinite upper endpoints.

For two different observed years in the same month, separated by `d` calendar years, the slope interval is:

`[(L_later - U_earlier)/d, (U_later - L_earlier)/d]`.

The overall seasonal slope enclosure is the median of the pairwise lower endpoints through the median of the pairwise upper endpoints. Monotonicity of the median establishes the enclosure: each admissible pair slope is between its own endpoints, so their median is between the endpoint medians. Shared observations can make this conservative rather than sharp. This derivation is an interval extension of the seasonal median-pair slope, not a censored Kendall hypothesis test.

All available month-pairs receive equal weight. Months observed in more years contribute more pairs. The balanced-calendar sensitivity retains only months present in every usable year of the same station/method series, making pair counts equal across its retained months. Each year is also omitted once from the available-pair calculation. A stable direction requires at least three original usable years, a nonzero original enclosure direction, and that same direction after every individual omission.

The comment sensitivity excludes only the literal original `information_only` flag, consistent with the maintained temporal source. Other original flags remain visible and are not silently assigned different laboratory validity.

Slope units are the original concentration unit per calendar year. The range describes censoring, not a confidence interval. No significance probability, discharge adjustment, catchment-wide condition, regulatory classification, causal explanation or treatment effect is inferred. Five selected years and variable sample support should remain visible beside any reported slope.

Reference: Hirsch, R.M., Slack, J.R. and Smith, R.A. (1982), *Techniques of trend analysis for monthly water quality data*, Water Resources Research 18(1),107-121. https://pubs.usgs.gov/publication/70011649

## Join the existing native report workflow

The output is a normal `upstate.observed-report/v1` source. Its `seasonal-change.sources.json` retains the original report, complete data, source compiler, offline explorer and unchanged input as ordinary source companions. Use the current application and original Workspace:

```sh
python source/observed-report-20261013/render.py \
  --app-root /path/to/current-application \
  --workspace /path/to/original-workspace \
  --manifest /path/to/new-seasonal-study/seasonal-change.sources.json \
  --output /path/to/new-native-seasonal-report
```

The same source also opens through Sources / Review retained reports and the existing scientific report composer. Other selected observed reports can be added through the maintained ordered manifest interface. Keep newer shared application bodies and the original Workspace history; this component adds no shared provider or browser rewrites.

## Owner-directed product use

Before presenting an outgoing edition, open the actual explorer and native report, view their real screenshots at the intended presentation width and narrow width, and operate filtering, series selection, original-record drill-through and downloads. Open the exported files normally and inspect every generated report page. Fix affected visible defects directly. Use focused calculation and workflow checks, not broad repository suites or repeated review of unchanged accepted editions. Preserve existing owner contact, attribution, publication and sprint controls.
