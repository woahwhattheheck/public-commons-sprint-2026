# Original seasonal hydrology figures

This source edition presents four scientific figures through one numeric specification, deterministic SVGs, an offline gallery, and the maintained native PDF formatter. All quantities come from the retained 29-gauge producer. Original station, date, quality, period and source-position records remain in the same scientific collection.

## Figures and their interpretation

1. **Eighteenmile monthly discharge and water volume.** Twelve complete months in 2023 appear beside the median of other complete same-month periods. The two panels distinguish mean daily discharge in ft³/s from actual water volume in million m³. A month’s duration belongs to that month; leap February is preserved.
2. **Eighteenmile seasonal contrasts.** Filled circles are the observed 2023 values. Boxes describe other complete same-season means or, separately, other complete annual-volume fractions. Winter is January, February and December of the same calendar year. The exact reference years are attached to each source point.
3. **Regional high-flow water-volume contribution.** Twenty-nine gauges retain their own complete years and annual daily-flow P95 thresholds. Each annual fraction is the water volume on days at or above that year's P95 divided by that year's observed total. Three panels retain a common 0–100% axis. Boxes describe the distribution across complete years; single-year support remains a single value.
4. **Observed flow-duration context.** Eighteenmile, Kettle Creek and Stevens Creek use 2023; Augusta Canal uses 2025 with its only other complete year, 2020. Solid markers show the selected year's Q5–Q95 curve, and open markers show the pointwise median of other complete annual curves at that gauge. Each panel retains its numeric discharge range. Full Q0–Q100 values remain in the original duration CSV.

The seasonal summer/autumn contrast at Eighteenmile belongs to the gauge's original observed context. It can inform selection of climate and observation periods while each concentration station, model basin, diversion and regulation record retains its own support.

## Exact plotted values

`figure-spec.json` uses `upstate.scientific-figure-spec/v1`, which the maintained `model/scientific_figures.py` renders as vector panels in the scientific PDF. The standalone SVG and native PDF therefore consume identical coordinates, axis domains, quantiles and reference cohorts.

`figure-points.csv` contains every plotted point, including box endpoints/quantiles, selected year, contributing original years and original source-row selectors. Row indices are zero-based within the named table of `../explorer-data.json`. The compact source retains the complete analysis outputs, and its source family retains the original agency responses and daily record positions.

Boxes use R7 interpolation; whiskers show observed minima and maxima, center lines show medians, and open diamonds show arithmetic means. They describe the retained small cohorts. The complete-numeric reference basis accepts original numeric values while retaining their independent approval, estimate and provisional flags.

The plotted annual high-flow quantity measures **water volume**. A gauge’s annual fraction uses that gauge’s own original flow record. It remains distinct from constituent concentration, nutrient mass, sediment mass and native model export.

## Rebuild

Run from the current complete application checkout:

```sh
node observations/flow_seasonality_20261013/figures/rebuild.mjs --app-root /absolute/application
```

The command verifies all 102 retained input members, loads the already-retained pinned D3 path, array and shape modules with their license sources, generates the four SVGs and numeric specifications, and writes the standalone report recipe and native manifest. It performs no agency requests.

The exact source input list lives in `inputs.json`; it includes the prior scientific figure specification. `combined-figure-spec.json` preserves those four original lake figures and appends the four seasonal figures for the canonical regional report. `figure-spec.json` contains the seasonal figures alone.

## Native report and source collection

`observed_seasonal_figures.sources.json` is an independently selectable original scientific document. Use it in the existing ordered study picker or with the maintained renderer:

```sh
python -B source/observed-report-20261013/render.py \
  --app-root /absolute/application \
  --workspace /absolute/original-workspace \
  --manifest /absolute/application/observed_seasonal_figures.sources.json \
  --output /absolute/new-seasonal-figure-edition
```

The canonical regional observed report uses the combined specification, retaining all eight original figure selections. Its ordinary source importer verifies and retains all exact source companions before report creation. The offline gallery is available as `seasonal-figures.html`; it and the individual SVGs travel with native report exports.
