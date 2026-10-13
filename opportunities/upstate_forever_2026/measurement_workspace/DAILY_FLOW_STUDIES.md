# Daily discharge and concentration studies

TJLabs · Upper Savannah · Existing Measurements workspace

The **Daily flow** tab receives complete original-source studies, selects original series, shows the daily hydrograph, calendar coverage and sampling-day context, saves immutable editions and compares two saved flow selections. Its **Concentration and discharge** section applies an explicit editable scientific contract to that same saved parent. All original source responses and source relationships remain within the saved study.

## Actual prepared source

The three retained original studies are:
- Historical 2020–2025: 2,192 daily observations from USGS-02186702, study `7213bc1b090ddb31bdb46cfeefbd3426b86eaa506328684b01b08e100b4ecd60`.
- 2026 January 1–October 12: 285 provisional observations, two marked ESTIMATED, study `503626e9b5c5ed9e3c9b7e98d149da7e660e2e32f10d3cea5013bedd4f7e2c60`.
- Complete 2020–October 12, 2026 selection: 2,477 observations, study `eb24fdf3a59f2c6d11714f06afa90d8067946e73eeaf61df9a0e85d8c88ca942`.

The selections retain the original 589 nutrient results, 153 station/date pairs and explicit upstream/downstream NLDI relationships. Those 19 constituent/fraction/method series are regional discharge context. The original station support remains visible in the calculation. New scientific support decisions require their own original-source relationship and method edition.

Original bodies, source manifests and independent source-native inputs are in `source/daily-flow-editions-20261013/`. Build each complete readable output with the existing qualified Node:

```sh
node source_tools/flow_editions.mjs build --input source/daily-flow-editions-20261013/historical-input.json --output YOUR_OUTPUT/historical
node source_tools/flow_editions.mjs build --input source/daily-flow-editions-20261013/2026-input.json --output YOUR_OUTPUT/2026
node source_tools/flow_editions.mjs build --input source/daily-flow-editions-20261013/extended-input.json --output YOUR_OUTPUT/extended
```

Each output includes report.html, the complete study, editable input, daily/period/sample CSVs, README and a full member manifest. Open report.html and keep its sibling files together.

The complete calculated three-study transport is also available through the two original Canvas parts F0C8GCDGFP1 and F0C8VQJ7SF8. Save each original frame or Canvas markdown and materialize them without a network connection:

```sh
python3 source_tools/receive_flow_delivery.py --parts part-1.json part-2.json --output YOUR_OUTPUT/prepared
```

The materializer checks both transport and original 23,987,772-byte content before writing. It preserves different existing output files.

## Open, calculate, save and reopen

Use the original application and existing Measurements directory. Receive a complete `flow-study.json` in Daily flow, or with:

```sh
node measurement_workspace/engine/cli.mjs flow-receive --workspace YOUR_MEASUREMENTS --file YOUR_OUTPUT/extended/flow-study.json
```

Inspect source reporting dates, series, provisional/estimated status, selected-window coverage, full-calendar coverage and sample relationships. Select the saved parent in Concentration and discharge. The retained scientific selection `source/observed-load-integration-20261013/flow-study-load-contract.json` is a real editable example for these originals. Review its period, source support, accepted conditions, interpolation gap, fraction/method separation and event policy before preview and save.

Saved results use the existing export table and portable workspace. Their identity includes the full calculation and method schema. The current kernel `upstate.observed-load-integration/v2` returns point/bounded mass in kg and flow-weighted concentration in mg/L over exactly the same quantified-day water volume. Missing support stays explicit; zero water volume has no concentration ratio. Reported censoring bounds remain bounds. Calendar-year exports require the whole matching calendar and physical support.

Choose **Complete ZIP** for an independently usable product: report, original parent, complete calculation, contract, daily/period/context/annual CSVs and reopen selection. The HTML attachment and individual downloads use the same sibling names as the ZIP. To reopen a downloaded calculation, receive its original parent and preview/save its unchanged contract. A newer scientific method gives a new saved identity while the earlier full output remains in its original files.

CLI equivalents:

```sh
node measurement_workspace/engine/cli.mjs flow-load-preview --workspace YOUR_MEASUREMENTS --file load-selection.json --output preview.json
node measurement_workspace/engine/cli.mjs flow-load-save --workspace YOUR_MEASUREMENTS --file load-selection.json --output saved.json
node measurement_workspace/engine/cli.mjs flow-bundle --workspace YOUR_MEASUREMENTS --id STUDY_ID --output daily-flow.zip
node measurement_workspace/engine/cli.mjs flow-load-bundle --workspace YOUR_MEASUREMENTS --id RESULT_ID --output concentration-discharge.zip
```

The standalone report command emits one HTML file; the bundle command emits its complete sibling set. ZIP commands atomically publish a complete file at a new destination and allow an exact-existing retry; they preserve a different existing file.

## Source and interface integration

The component uses existing authentication, Measurements API, export store and project portable transfer. Runtime Node is the application's existing Node ≥22.16. It adds no scheduler, external service or secondary database.

API beneath `/api/measurement-workspace`:
- `GET /flow/studies/:id/report.html` and `GET /flow/studies/:id/bundle`.
- `POST /flow/load-preview` and `POST /flow/load-save` with `{study_id,contract,expected_id?}`.
- `GET /flow/load-catalogue` and `GET /flow/load-results/:id`.
- `GET /flow/load-results/:id/report.html`, `daily.csv`, `periods.csv`, `context.csv`, `annual.csv`, `bundle`.

Bundle replies carry name, MIME type, exact byte count, SHA256 and base64. Original sources and load method remain first-class parts of the complete product.

The source execution used the full original 2,477 daily observations and 589 nutrient records; the selected source generated 19 context series with its original spatial relationships. The original receiving host continues the real desktop and 390 px open→inspect→preview/save→download→reopen course. Producers personally operate and look at the outgoing application and all its attachments under the current owner direction.


## Current original 2026 water-quality collections

The complete installation includes both original Hartwell and Eighteenmile SV-233 collections. Hartwell's characteristics-v1 selection retains 132 records from six activities and all four official Station/Activity/Result/Limit responses. SV-233's characteristics-v2 selection retains 58 records from four activities and their complete source bodies; its earlier v1 collection remains independently selectable. Suspended solids is represented as its original TSS quantity, separately from SSC, with original basis/fraction/method and explicit unit compatibility. No conversion between those quantities is implied.

Use the existing collection preview, receive and publish controls with:

- `observations/hartwell_2026/wqp_20261013/characteristics-v1/collection.json`
- `observations/eighteenmile_sv233_2026/wqp_20261013/characteristics-v2/collection.json`

Use each manifest's own directory as its source root. The full prior detection/v1 editions remain with the same source family. [WQP original-edition guide](../source_tools/WQP_OFFICIAL_EDITION.md) describes the explicit pinned mappings and complete command shapes.

The exact prepared Hartwell (132 measurements) / 2026 daily flow (285 observations) study and saved load result are in `source/canonical-wqp-loads-20261013/`. Read its README and run the included `materialize-output.mjs` against its own `output-bank.json` and ordered source parts into an owned output directory. It recovers all 13 original output files, including the full 28,396,936-byte source family, original study/input/contract, readable report and four CSV exports. The support remains regional context; the original source does not establish co-located or matched-catchment mass. Chemical basis, speciation and normalized units remain beside their quantities in the UI and report.

For the upstream connection into native Monitoring, use [Original observation handoff](NATIVE_OBSERVATION_HANDOFF.md). Select the actual saved SQLite import, preview its complete source/row/review context, explicitly prepare the native observation edition, and reopen that returned ID in the existing Monitoring desk. The full original capture accompanies native Workspace export. Existing native observation imports, monitoring results and operated scientific source remain intact.

Carry `AGENTS.md` and `CURRENT_OWNER_DIRECTION.md` version 2026-10-13.4 into the same receiving course. Operate and LOOK at the actual outgoing application at desktop and 390 px, inspect every selected original attachment/report/CSV/archive, and cold-reopen its saved project. Keep the existing source receiving, original workspace and current process owners.

The complete SV-233 (58 measurements) / same 2026 daily flow (285 observations) counterpart is under `observations/eighteenmile_sv233_2026/wqp_20261013/flow-context/`. Its README and materializer recover all 17 complete output files, including the three original NLDI relation bodies, the complete WQP collection, original 285 discharge observations, both readable reports and all study/load CSVs. Its thirteen quantity/method context series and explicit regional relationship remain available without annual mass admission. Keep the actual original support and source metadata when reopening through Flow receive and load-preview/save.
