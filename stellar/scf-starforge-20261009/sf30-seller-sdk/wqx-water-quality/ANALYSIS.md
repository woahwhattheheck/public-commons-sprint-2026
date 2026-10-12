# Water-quality analysis

`analysis.mjs` consumes the original `joinCapture()` model from `samples.mjs`. It is a pure JavaScript module and does not contact the source service. Every result remains tied to its original capture, profile, source body hash and CSV row.

## Public interfaces

| Export | Purpose |
| --- | --- |
| `normalizeAnalysisOptions(options)` | Validate inclusive local date windows, exact characteristic/site selections, estimate choice and qualifier selection |
| `classifyWaterQualityResult(row, options)` | Retain censoring, bounds, estimates, qualifiers, all source limits and the reason for arithmetic inclusion |
| `summarizeWaterQuality(model, options)` | Inventory, strict scientific groups, descriptive summaries, selected observation references and optional period comparison |
| `compareWaterQualityCaptures(current, previous, options)` | Compare original result identities and semantic versions across two actual acquisitions |
| `waterQualityObservationCsv(model, options)` | Export normalized fields plus original result, activity, station and detection-limit records |
| `waterQualityObservationGeoJson(model, options)` | Export selected observations and original station metadata |
| `renderWaterQualityReport(report, {title, note})` | Create a self-contained printable HTML review |
| `WATER_QUALITY_GROUP_FIELDS` | Read every exact dimension used to form a scientific group |

## Selection and interpretation

```json
{
  "window": {"start": "2025-03-01", "end": "2025-03-31"},
  "baselineWindow": {"start": "2025-01-01", "end": "2025-01-31"},
  "includeEstimated": false,
  "characteristics": [],
  "siteIds": [],
  "allowedQualifiers": []
}
```

Empty lists select all available characteristics/sites. Date windows compare the originally reported local sample dates, including both ends. Source times and time zones remain unchanged. Invalid date bounds are rejected. A result with an invalid sample date stays inspectable in the unbounded review and remains outside a dated window.

Groups preserve provider, organization, site, activity type, medium, fraction, speciation, unit, statistical and measurement basis, original analytical/collection/preparation methods and depth context. Source strings are compared exactly. Missing and present-empty values remain distinct where the original profile distinguishes them.

The returned summary is an arithmetic description of the selected original measurement scale. It contains count, minimum, maximum, mean and median. Decimal strings, including exponent notation, are converted to exact rational values for computation. Each displayed metric supplies `numerator`, `denominator`, `display`, `exact`, `displayPrecision` and `rounding`. Display rounds to 12 decimal places, half away from zero; exact fractions remain available. Minimum and maximum also retain the original reported lexeme.

## Censored results, limits and qualifiers

The implementation follows the [EPA Detection Limits Best Practices Guide, August 2025](https://www.epa.gov/system/files/documents/2025-09/wqxdetectionlimitsbestpracticesguide_final.pdf). A source non-detect, below-limit measurement, above-range result, interval or detected-but-unquantified result carries that condition into the review. A literal comparator such as `<0.01` is retained as a bound. The source result's A/B slots and any separately returned detection-limit profile rows remain individually available.

Recognized qualifier codes include J for estimates, U/DL for non-detects and LTGTE for interval censoring. Original provider-specific codes remain qualified until selected explicitly in `allowedQualifiers`; the actual Potomac source uses SSRV. Choosing a qualifier changes the analyst's selection and does not rewrite the returned code.

No zero, detection limit or fraction of a limit is inserted as an observed numeric value. A source-labelled numeric estimate enters the selected arithmetic summary only when `includeEstimated` is true. Its original estimate and censoring information remain visible. Conflicting censoring fields and conflicting original result versions stay outside arithmetic summaries.

A group supplies the chosen `summary`, a separate `detectedSummary`, and a `reportedEstimateSummary`. Counts expose source rows, unique results, estimated/qualified/censored records, duplicates and conflicts. Limit summaries keep their original type, unit and source origin; they describe returned limits rather than environmental concentration.

## Period and source comparisons

A period comparison joins the union of current and baseline scientific group keys. It retains groups present in only one period and displays an explicit reason when a comparison has no numeric values. Each comparable row carries original dimensions, both sample counts, both arithmetic means and the absolute difference.

Relative change requires a recognized ratio unit and a positive baseline. The explicit ratio-unit set covers common concentration/count/flow units, percent and kelvin. Unknown units keep the absolute difference and their original unit. A difference between percentages is labelled in percentage points.

pH uses a logarithmic measurement scale ([USGS, pH and Water](https://www.usgs.gov/water-science-school/science/ph-and-water)). Celsius temperature is offset from thermodynamic temperature ([NIST SI Guide, Chapter 8](https://www.nist.gov/pml/special-publication-811/nist-guide-si-chapter-8)). Accordingly, the application reports their mean differences on the original scale and leaves relative percent change empty. It does not infer hydrogen-ion concentration from a group mean pH or silently convert temperature units.

A capture comparison uses the native provider/organization/activity/result identity, then compares its original result, station, activity and limit versions. Source acquisition timestamps and transport row locations alone do not constitute a changed measurement. Added, removed, changed, unchanged and ambiguous identities are returned separately. Original differing versions remain retained.

## Source inspection and exported reports

Compact report observations carry normalized source fields, returned limits, classification and `originalReferences` for their exact result, activity and station envelopes. The workspace's Inspect action fetches the complete source graph by capture identity and original row identity. CSV exports include the original records directly.

GeoJSON uses the source's original or source-standardized WGS84 coordinates when exactly one unambiguous coordinate is supplied. NAD83, NAD27, missing or conflicting coordinates remain original properties with null geometry. There is no implied datum transformation.

The included Potomac acquisition has 1,035 unique results, 13 activities and one station, with all joins resolved. It contains 1,112 A/B limit entries, 452 non-detects, ten source-labelled estimates and 146 qualified results. The full default review returns 279 scientific groups and 413 arithmetic observations. January and March contain 140 and 418 source results respectively, with 64 groups supporting a numeric comparison. The current sample counts remain part of each comparison.
