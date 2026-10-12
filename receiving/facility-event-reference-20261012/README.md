# Facility event reference workbook

Open the complete historical workbook to review a retained USGS event against an explicit site roster, change distance and magnitude selections, and export the resulting customer report.

## Open the workbook

1. Open [REFERENCE_REVIEW.html](./REFERENCE_REVIEW.html), select **Download raw file** on GitHub, and save the file with its original `.html` extension.
2. Open that saved file in a browser. The workbook includes its original event response, reporting engine and three sample sites.
3. Select **Baseline**, **Napa 5 km**, or **Napa 50 km**; inspect the matched sites and compare the results.
4. Edit the radius and magnitude selections or import a facility roster. Recompute the report and download JSON, CSV, printable HTML, the selected roster and the original event response.

All workbook calculation and export runs in the browser. The file has no external script, stylesheet, network fetch or account requirement. A link in the source section opens the official USGS event page when selected.

## What the reference contains

The retained response contains the [24 August 2014 South Napa earthquake](https://earthquake.usgs.gov/earthquakes/eventpage/nc72282711), event ID `nc72282711`, and the provider's recorded magnitude value `6.02`. The three sample locations are explicitly illustrative city-centre points for Napa, Sacramento and San Francisco.

| Selection | Napa radius | Sacramento radius | San Francisco radius | Matched sites |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 100 km | 100 km | 100 km | 3 |
| Napa 5 km | 5 km | 100 km | 100 km | 2 |
| Napa 50 km | 50 km | 100 km | 100 km | 3 |

The original reporter computes distances of 9.421 km, 82.102 km and 49.846 km from the event epicentre to the respective Napa, Sacramento and San Francisco sample points. Each site's magnitude threshold in these saved scenarios is 4.

The retained provider query covers 24–25 August 2014, latitude 37–39, longitude −123 to −121, and magnitude 4 or greater. Report completeness is assessed against that explicit selection: a site radius extending beyond the selected rectangle can include locations outside the retained query. The workbook retains the original source and selections alongside each export so the operator can assess coverage.

The distance calculation uses a 6,371 km spherical Earth radius and the reported epicentre. Site thresholds and subsequent inspection, engineering or continuity decisions are selected by the responsible operator.

## Files

| Path | Purpose |
| --- | --- |
| `REFERENCE_REVIEW.html` | Complete browser workbook with embedded source, reporter and sample roster |
| `reference/historical-response.json` | Original retained USGS response |
| `reference/report-core.mjs` | Original pure reporting and HTML/CSV rendering functions |
| `reference/*-facilities.json` | Three explicit input rosters |
| `reference/baseline.*` | Complete baseline JSON, CSV and HTML reports |
| `reference/napa-radius-5km.*` | Complete narrower Napa selection |
| `reference/napa-radius-50km.*` | Complete restored Napa selection |
| `reference/PROVENANCE.json` | Original source identities, execution details and report digests |
| `tools/reproduce-reference.mjs` | Original Node.js command for reproducing all three saved reports |
| `reference/workspace/model.mjs` | Retained application model used by the full operations workspace |
| `reference/LICENSE.txt` | Original MIT license |

The reusable workbook and every file under `reference/` are preserved unchanged from the original commissioning package. The reporting functions were run again during this publication: all three complete JSON, CSV and HTML outputs matched their retained originals exactly.

## Reproduce the reference

With this directory available locally and Node.js installed, run:

```sh
node tools/reproduce-reference.mjs --out /absolute/path/to/new-reference-output
```

Choose a new output directory. The command checks the original response and reporter identities, computes the original three selections, compares the complete JSON report digests, and writes all three reports in JSON, CSV and HTML together with the selected rosters, original source, reporter, license and execution record.

The browser workbook is self-contained; the reproduction command uses the adjacent files in this directory.

## Commission the complete operations workspace

For named portfolios, retained project editions, assigned review work, attributed actions and complete portable project transfer, use the [complete Facility operations workspace and installation guide](../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/postman/examples/usgs-facility-events/workspace/README.md).

A retained application edition is also available at [source commit 5b1940a](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/5b1940a38dbb8acdf1bf94689b9861cb8df942e7/stellar/scf-starforge-20261009/sf61-openapi-seller-import/postman/examples/usgs-facility-events/workspace/README.md).

Retain the complete site roster, original event source and agreed field mapping when commissioning a customer installation. Each project can then retain its own decisions and deliver its full history to a separately named receiving operator.
