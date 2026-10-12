# WQX water-quality workspace

Prepare a complete water-monitoring review from the Water Quality Portal's current WQX 3.0 service. The operator keeps the original station, sampling-activity and result graph, records an analyst decision, compares compatible measurements, and hands over the same source and review to another operator or the original paid-data customer.

The application is available through the maintained `starforge water-quality` command. From a source checkout, run `node stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/cli.mjs` with the same arguments. The browser uses a private local project and the original merchant and buyer implementations.

## Complete operator workflow

1. **Select the cohort.** Choose station IDs, source organizations, characteristics, sample media and date bounds. The saved selection keeps every native filter, repeated value and profile choice. Monthly or yearly request partitions support larger periods.
2. **Acquire or import.** Capture the original WQX3 Station, Activity and full physical/chemical Result responses, or import an existing complete capture. Each original CSV, request, response and native completion receipt stays with the project. Resume the same operation ID to finish an interrupted acquisition.
3. **Review the measurements.** Inspect inventory, comparable scientific groups, original result values, all returned detection limits, qualifiers and estimates. Open a result to inspect its exact source result, station and sampling-activity records. Review selections retain local sample dates and the source time zones.
4. **Save the decision.** Record the chosen date windows, fields, permitted qualifiers and treatment of source-labelled estimates with a note. A second source capture can be compared for added, changed, removed and conflicting result versions.
5. **Deliver the review.** Export HTML, JSON, CSV or GeoJSON. A complete review bundle carries its original source members, saved project revisions and analyst decision into an empty receiving workspace.
6. **Operate a data edition.** Prepare an immutable edition from the reviewed capture, stage the original payment terms and start the maintained SF30 merchant. The edition contains the complete captured result cohort; the saved analysis selection is a separate review. The original SF88 customer prepares a request, receives all selected pages or original source bytes, exports the delivered file and reopens the same purchase.

## Start a project

Use absolute private project directories. The two supplied selection files are directly usable from this directory:

```sh
starforge water-quality init --project /private/water/potomac --title "Potomac water quality" --selection examples/potomac-2025-q1.selection.json
starforge water-quality capture --project /private/water/potomac --id potomac-2025-q1 --expected-revision 1
starforge water-quality review --project /private/water/potomac --capture potomac-2025-q1 --id march-review --options examples/march-versus-january.analysis.json
starforge water-quality serve --project /private/water/potomac --port 0
```

The server prints its actual local workspace URL. The neutral operator interface covers selection, acquisition, result inspection, saved reviews, receiving, merchant terms and the original customer plan. With an existing SF88 buyer configuration, pass `--buyer-config /private/buyer/config.json` to enable the customer controls.

A project configuration is revisioned. Explicit expected revisions protect another operator's intervening changes; capture IDs continue to use the selection revision with which they were created. Open a new capture ID for a fresh source acquisition.

## Reuse the retained real source

`examples/potomac-2025-q1.source.json` carries the original complete public cohort in a compressed source bundle. The receiving entrypoint in [JOURNEY.md](JOURNEY.md) restores its original members before opening the application. The decoded capture is also accepted by the ordinary CLI:

```sh
starforge water-quality import-capture --project /private/water/potomac --source /private/received/potomac-2025-q1 --title "Potomac water quality" --expected-revision 0
starforge water-quality captures --project /private/water/potomac
```

The native source completed on October 11, 2026. Its original capture identity is `cbb29504ab01598cddb21bde33c918ca92075aad7f53fdac4fb07581371d29d7`. It contains one monitoring station, 13 activities and 1,035 results for USGS-01646580, January through March 2025. All native source status responses completed successfully.

The original scientific run joined every result and retained 1,112 reported A/B limits across 685 results. The cohort has 452 non-detects, ten source-labelled estimates and 146 qualified results. Its default review has 279 compatible groups and 413 arithmetic observations. These counts describe this saved acquisition; a later provider acquisition can differ.

## Scientific interpretation

Groups retain the source organization and site, routine or quality-control activity type, medium, characteristic, fraction, speciation, original unit, statistical and measurement basis, analytical and preparation methods, and sample-depth context. Nitrate reported as nitrogen remains distinct from nitrate reported as nitrate; field pH remains distinct from laboratory pH.

The application computes descriptive minimum, maximum, arithmetic mean and median with exact decimal fractions, displaying up to 12 decimal places. It preserves the original value strings and exact numerator/denominator. It does not convert one source unit into another. See [ANALYSIS.md](ANALYSIS.md) for the complete analysis contract and source interpretation.

Non-detects remain censored measurements with their returned limits. Estimates enter the selected arithmetic summary when the operator selects `includeEstimated`. Other source qualifiers require an explicit `allowedQualifiers` selection. The original value, condition and decision remain inspectable in every case.

Period comparisons use the exact same scientific grouping and display both sample counts. Absolute differences remain in the source measurement scale. Relative percent change is supplied for recognized ratio units and a positive baseline; pH and Celsius/Fahrenheit temperature use their absolute scale differences. The Potomac example compares January's retained samples with March's retained samples.

GeoJSON geometry uses a provided unambiguous WGS84 station coordinate. Other native datums remain available in the original properties. The retained Potomac coordinates are NAD83 and therefore carry their original datum and values with null geometry.

## Export and receive the original review

```sh
starforge water-quality export --project /private/water/potomac --review march-review --format html --out /private/delivery/march-review.html
starforge water-quality pack-review --project /private/water/potomac --review march-review --out /private/delivery/march-review.json
starforge water-quality receive --project /private/receiving/potomac --bundle /private/delivery/march-review.json
starforge water-quality reviews --project /private/receiving/potomac --id march-review
```

Create the chosen output directory first. Outputs use exclusive creation so a previous delivery stays intact. Receiving copies and verifies the retained member bytes and opens the same review; repeated receiving of the same completed bundle returns its original receiving record.

## Merchant and customer operation

`edition` prepares the immutable capture, native dataset projection, original source files, saved analysis and analyst decision. `stage` uses the existing merchant payment-terms JSON and a canonical public HTTPS origin. `merchant` runs that exact staged edition through the original seller lifecycle:

```sh
starforge water-quality edition --project /private/water/potomac --review march-review --id potomac-2025-q1
starforge water-quality stage --project /private/water/potomac --edition potomac-2025-q1 --origin https://water.example.org --payment /private/merchant/payment.json
starforge water-quality merchant --project /private/water/potomac --edition potomac-2025-q1 --port 0 --facilitator https://facilitator.example.org
```

Use the actual merchant origin and configured facilitator for deployment. Customer commands are `buy-prepare`, `buy`, `buy-reopen` and `buy-export`. A page request uses `--kind observations --query query.json`. A source request uses `--kind source --file` with an exact retained download member; `--kind edition` selects the edition manifest. The native offer declares the actual MIME type, so original CSV is delivered and exported as CSV.

The original dataset query controls page limits, supported fields and snapshot-bound continuation. Pass the returned page metadata with `--previous`, preserve the selected query and supply its returned cursor. Each new page uses a new intent; reopening uses the original intent and saved buyer configuration. The complete original operation and its receiving commands are in [JOURNEY.md](JOURNEY.md).

## Source and interfaces

- [Provider acquisition and sample graph](PROVIDER.md)
- [Scientific analysis and exports](ANALYSIS.md)
- [Complete native operation and receiving](JOURNEY.md)
- `provider.mjs` and `samples.mjs`: original WQX source capture and organization-aware joins
- `analysis.mjs`: source-preserving scientific review and period/capture comparisons
- `project.mjs`: revisioned private projects, analyst decisions and portable receiving
- `merchant.mjs`: original SF30 dataset/assets and original SF88 customer lifecycle
- `workspace.mjs`, `ui/` and `cli.mjs`: the same operator and customer workflow

The scientific source intake has no added npm dependency. The original native merchant and buyer require their existing x402 and Stellar dependencies. The complete journey uses the maintained local protocol fixture, with its returned payment and delivery outcomes recorded by the original buyer.

## Open Waters receiving

The **Open Waters** tab turns any saved review into a retained receiving plan for Open Environment’s published importer. It provides native identity mapping, location/activity/result fields, bulk translations, detection-limit choices, reference catalogs, six exact downloads, and complete-bundle receiving into an empty project. See [Open Waters receiving](OPEN_WATERS.md) for the full operator flow, CLI commands, pinned import contract and complete original-source journey.
