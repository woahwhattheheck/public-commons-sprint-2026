# Eighteenmile nutrient composition, 2020–2025

This complete original-source study adds censor-aware nutrient balance and nitrogen composition to the existing Eighteenmile scientific workbench. It uses the two retained WQP source responses containing 589 original records at four stream stations, joins the exact 153 sampling activities, and computes eight complementary quantities for all 58 same-date station pairs.

## Use the study

Run from the maintained application root with Python 3.10 or newer. The analysis and offline explorer builder use only the standard library.

```sh
python -B observations/eighteenmile_stoichiometry_20261013/build.py \
  --application-root /path/to/current/application \
  --output /path/to/new-composition-package
```

The output directory must be new, and its parent must exist. Open `observations/eighteenmile_stoichiometry_20261013/index.html` within that package. This is a complete offline application with station/year/season summaries, exact matched-date comparisons, a signed interval plot, paginated activity filtering, all original source-row details and downloadable selected CSV/JSON. All scripts and analytical data are embedded; no network or browser fetch is required. The package preserves the original input bytes and all five authored source files, so the same builder can reproduce it from its own application root.

## Receive into the existing scientific application

```sh
python -B observations/eighteenmile_stoichiometry_20261013/receive.py \
  --application-root /path/to/current/application \
  --workspace /path/to/current/scientific-workspace \
  --package /path/to/new-composition-package \
  --report /path/to/new-native-composition-report
```

This invokes the original application’s observed-report renderer and existing Workspace source import. It adds one original document with all source companions, then generates the maintained native PDF, HTML, Markdown and JSON report. Existing workspace and source IDs remain intact. `--create-workspace` explicitly creates a chosen new Workspace when required. The formatter environment is the current application’s environment; the analysis itself requires no GIS execution.

For an already-built package, use the original renderer directly:

```sh
python -B /path/to/current/application/source/observed-report-20261013/render.py \
  --app-root /path/to/current/application \
  --workspace /path/to/current/scientific-workspace \
  --manifest /path/to/composition-package/eighteenmile_stoichiometry.sources.json \
  --output /path/to/new-native-report
```

The manifest uses `upstate.sources/v1`; its document uses `upstate.observed-report/v1` and its figure uses the original `upstate.scientific-figure-spec/v1` schema. The source collection/document choice returned by this renderer can join the application’s ordered `observed_context_sources` list. Preserve an existing selected study and append this complementary document. No new observation rows need to be imported to reproduce this derived study: its 589 source rows are the original existing cohort.

## Scientific quantities

The source activity must contain exactly one compatible unfiltered Kjeldahl nitrogen, nitrate + nitrite and phosphorus result. Original activity identity, station, date, clock/timezone, project, media and depth must agree. Every original agency field is retained. Unknown methods, qualifiers, units, duplicate component rows or changed original hashes stop the build with the exact source issue.

Reconstructed nitrogen is **TKN + nitrate/nitrite**. Ammonia is already included in TKN. The original six publisher-calculated `Nitrogen` entries are separate and never replace this calculation. Original WQP weight-basis fields are blank: elemental N/P interpretation follows the original analyte/method identities and the publisher’s “Total Phosphorus in Water” method name. Operational reconstructed total N does not eliminate analytical-method bias.

Numerical results retain their reported value. `Present Below Quantification Limit` carries **[0, original limit)** using the original mg/L limit unit. The implementation uses exact rational arithmetic constructed from decimal source strings, including for direction decisions. Floating-point convenience coordinates are exported beside exact rational endpoints, not used for those decisions.

**P:N mass ratio** remains defined throughout this cohort because reconstructed N is positive. **N:P mass ratio** has no finite upper bound when phosphorus is below quantitation. Its range is conditional on P > 0, and the P = 0 point remains explicitly undefined. This distinction is carried through the activity JSON and each affected N:P pair comparison. No censored value receives a substituted point estimate.

Molar N:P is mass N:P multiplied by **30974/14007**. The representative atomic weights are CIAAW’s N=14.007 and P=30.974. Conversion precision is not additional laboratory precision. No Redfield threshold or limiting-nutrient designation is applied.

Nitrate/nitrite fraction is **NOx/(NOx+TKN)**. Its interval keeps the common numerator dependency rather than dividing unrelated independent bounds. Where ammonia exists, **TKN minus ammonia** is retained as a raw arithmetic diagnostic. A negative portion in that interval reflects overlap of source supports, not an observed negative organic-N result; it is not silently clipped or used as a negative concentration.

## Comparison and sampling support

Same-date comparisons use station B minus A, with station identifiers in lexical order. The exact date, both source activities, original clocks and clock difference travel with each of the 464 component comparisons. A direction is definite only when the entire permitted interval lies strictly above or below zero. Original source time-zone strings are preserved verbatim.

Station, station-year and station-season summaries weight actual activities equally. Mean and linearly interpolated 25th, 50th and 75th order statistics are closed enclosing bounds over original censoring. These finite summary endpoints do not assert exact attainability when censored order ties occur. Sample means of ratios are not ratios of sample means. An unbounded ratio mean is retained even when its median has a finite bound. SV-245 has one activity; station calendars differ.

The selected 23 SV-375/SV-376 dates cover 2024–2025, with original clocks separated by 25–49 minutes. Year/season direction summaries preserve the exact source dates rather than treating these as simultaneous experiments. Interpret observed composition without turning it into annual load, in-stream removal, a hydrologic mass balance or a biological nutrient-limitation result.

## Output files

- `index.html`: complete single-file offline explorer with filtering, plotting, original-source inspection and downloads.
- `composition.json`, `activities.csv`, `station-calendar-summaries.csv`: all derived values, exact endpoints and selected activity membership.
- `paired-composition.csv`, `paired-direction-summary.csv`: every exact same-date contrast and annual/seasonal direction membership.
- `original-result-index.csv` and unchanged `original/*.csv`: all 589 original records with full 63-field bodies and byte/row provenance.
- `summary.json`, `figure-spec.json`, `paired-pn-balance.svg`: readable findings and the original numeric scientific figure.
- Application-root `eighteenmile_stoichiometry.report.json` and `eighteenmile_stoichiometry.sources.json`: complete native scientific-report source with all companion hashes.
- `source-inputs.json`: original paths, hashes, retained paths, methods, unit-conversion convention and primary references.

The original canonical CSVs are under `source/eighteenmile-stream-nutrients-20261013/original/`. Their exact immutable identities are encoded in `stoichiometry.INPUTS`. An already-built package uses its unchanged retained copies as input when those canonical paths are absent.

## Primary references

[USGS: Assessing total nitrogen in surface-water samples](https://www.usgs.gov/publications/assessing-total-nitrogen-surface-water-samples-precision-and-bias-analytical-and) discusses operational analytical/computational total-N methods and their precision and bias. [NEMI’s EPA 351.2 summary](https://www.nemi.gov/methods/method_summary/9626/) defines Kjeldahl N and organic-N subtraction. [EPA nutrient aggregation](https://echo.epa.gov/trends/loading-tool/resources/technical-background-methodology/nutrient-aggregation) documents component and reporting-basis distinctions. [CIAAW’s 2024 abridged table](https://www.ciaaw.org/abridged-atomic-weights.htm) supplies representative atomic weights. [EPA CADDIS Nutrients](https://www.epa.gov/caddis/nutrients) provides supporting causal/biological context. Original measurements are retained from the [Water Quality Portal](https://www.waterqualitydata.us/).

Authored software follows the repository MIT license. Original agency measurements retain their publisher attribution.
