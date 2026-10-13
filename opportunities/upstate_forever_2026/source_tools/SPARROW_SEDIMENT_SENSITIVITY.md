# Published Southeast sediment-method sensitivity

## Original target and separate regional reference

This source tool reads a complete, retained P9A682GW preparation created by
`source_tools.sparrow_reference`. It adds a scientific report source showing
the effect of the analytical-method scaling described by Hoos and Roland
(2019). The original observations, source collection, native comparisons and
calibration rankings keep their saved values and identities.

The primary method is equation 3 on page 10 of
[USGS Scientific Investigations Report 2019-5135](https://pubs.usgs.gov/sir/2019/5135/sir20195135.pdf);
the fitted coefficient is discussed on page 60:

\[
L_{\mathrm{SS}} = L_{\mathrm{TSS}}\exp(-b_{\mathrm{CONVERT}}).
\]

The tool reads `ACTUAL_MT`, `CONSTITUEN` and `TSS_CONV` from the exact
original regional sediment calibration table. It applies the natural exponential
once to TSS records. Original SSC records (`SUSPSED`, parameter code 80154)
remain unchanged. Code 00530 identifies TSS.

This is an annual-load method sensitivity derived from a fitted regional model.
Its unit is metric tonnes/year. It is not a new station-specific SSC measurement.
The original source supplies a global target horizon of water years 2000–2014
and reference conditions for 2012; individual station sampling windows are
not supplied by this mapper. The rates are not multiplied by fifteen.

## Actual retained Chattooga record

The original 395-row sediment table contains 383 TSS rows, each with coefficient
−1.1735, and 12 SSC rows. Its 107,033 bytes have SHA-256
`81b0ee67b2898e4b3c9c95a04253eb98a9f3dabc29bb5a41f463ee609041b91e`.

For Chattooga River near Clayton, Georgia:

| Quantity | Source-bound value |
| --- | ---: |
| Station | 02177000 |
| Original COMID | 6269342 |
| Original OBJECTID | 63 |
| Analytical constituent | TSS / 00530 |
| Original ACTUAL_MT | 7,201.8484 t/year |
| Original TSS_CONV | −1.1735 |
| exp(−TSS_CONV) | 3.233289370512243 |
| Regional-method sensitivity reference | 23,285.659879760606 t/year |
| Reference change | 16,083.811479760607 t/year |
| Original PLOAD_MT model prediction | 33,071.8723 t/year |

The complete CSV and JSON retain the publisher prediction separately. They do
not use it as an observation or derive a validation score from it. The source
table and the transformation above were independently evaluated from the
retained original JSON. This arithmetic does not imply that a native watershed
comparison has been completed.

The mapper row supplies no station-specific conversion uncertainty or original
target standard error. The source context retains that uncertainty as
unquantified. It does not construct a confidence interval. The primary report
also distinguishes annual-load scaling from concentration scaling, so this
factor is not applied to WQP samples or continuous concentrations.

## Prepare and receive the actual report source

From the current complete application:

```bash
python -B -m source_tools.sparrow_sediment_sensitivity \
  --prepared /path/to/chattooga/reference/prepared \
  --output /path/to/chattooga/sediment-method-context \
  --workspace /path/to/original/workspace
```

The prepared directory must contain the original `result.json`,
`annual-records.json`, `annual-loads.csv`, metadata and all original
companions. The output must be a separate sibling directory. Existing output
is reopened only when its exact preparation, method and producer identities
match; every retained output descriptor is verified.

Omit `--workspace` to prepare the portable source directory first. With a
Workspace, the command imports the ordinary source manifest and returns
`source_collection_id`, `source_id` and `observed_context_sources`.
Choose that source in the existing ordered **Observed scientific studies**
picker. The maintained scientific HTML/PDF includes its sections and links,
while complete receiving preserves the original source files.

The original Chattooga preparation used during this sprint is
`/workspace/scratch/178ddc647ae4/chattooga-retrospective-20261013/reference/prepared`.
On another host, use the corresponding retained preparation after receiving;
source identity is defined by the original records and descriptors, not this
machine path.

## Complete output

- `sediment-method-sensitivity.html`: clean grayscale source report.
- `sediment-method-sensitivity.csv`: every selected sediment record, raw target,
  original coefficient, factor, derived reference and separate publisher prediction.
- `sediment-method-sensitivity.json`: the same numeric result with complete
  original rows, source support and uncertainty.
- `method.json`: exact equation convention, original coefficient field,
  physical units, primary source locations and interpretation.
- `reference/`: every original prepared source member, plus its result record.
- `producer.py` and `selection.json`: the exact converter and selected source identity.
- `observed-report.json` and `source-manifest.json`: the existing
  `upstate.observed-report/v1` / `OBSERVED_CONTEXT` source route.
- `result.json`: immutable completed source inventory.

The input CSV and source records remain untouched. New preparation does not
dispatch InVEST, replace the admitted raw target, or rewrite a saved score.

## Sources

Hoos, A.B., and Roland, V.L., II, 2019, *Spatially referenced models of streamflow
and nitrogen, phosphorus, and suspended-sediment loads in streams in the
Southeastern United States*: U.S. Geological Survey Scientific Investigations
Report 2019-5135, [doi:10.3133/sir20195135](https://doi.org/10.3133/sir20195135).

Original regional data release:
[doi:10.5066/P9A682GW](https://doi.org/10.5066/P9A682GW).
The exact complete original sediment table and release metadata travel inside
each prepared source. Annual-load estimation details from the separate national
F7DN436B release retain their own original estimator and sampling support.

## Complete application component

The maintained `sparrow-sediment-method-context` fragment registers the CLI,
this guide, and its original annual-source and verified-copy dependencies.
It requires the existing core, observed-context consumer and saved scientific
report editions. Ordinary application assembly picks up
`integration/component_fragments/sparrow-sediment-method-context.json`;
receive the complete current component before running the command above.
