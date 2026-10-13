# Chiques nutrient calibration sources

This desk receives the complete original Chiques Creek nutrient calibration tables into the existing Measurements application. It preserves original files, sample rows, source columns, missing cells, transformation columns, review decisions and independent project receiving. It does not fit a sediment or nutrient model, apply nitrate corrections, assign the Pennsylvania station to an Upper Savannah reach, or calculate loads.

## Original source and scientific interpretation

The source is USGS ScienceBase item `65b170a2d34e36a39044c04d`, DOI `10.5066/P1HSE8TQ`, Chiques Creek near Marietta, Pennsylvania (`USGS-01575900`). Use the full original-source transfer JSON, with the original ScienceBase item, README, GEOREF and XML, and the two calibration CSVs. The actual retained nine-text transfer also contains the SSC CSV, original catalogue page and catalogue XML; these remain complete companion originals.

| Original file / column | Native interpretation | Original clock | Original transformation |
| --- | --- | --- | --- |
| lnTN CSV: TN_mgL | Total nitrogen, mg/L as N, total | sample_datetime | lnTN_mgL |
| lnTN CSV: NOx_mgLN | Nitrate plus nitrite, mg/L as N, fraction unspecified | datetime | lnNOx_mgLN |
| lnTN CSV: Q_cfs | Discharge, ft³/s | datetime | lnQ_cfs |
| log10TP CSV: TP_mgL | Total phosphorus, mg/L as P, total | sample_datetime | log10TP_mgL |
| log10TP CSV: TURB_FNU | Turbidity, FNU | datetime | log10TURB_FNU |
| log10TP CSV: Q_cfs | Discharge, ft³/s | datetime | log10Q_cfs |

The original README declares UTC. Laboratory `sample_datetime` and the publisher's nearest 15-minute sensor `datetime` are both retained, including their difference. The adapter does not shift a measurement to the other clock. The original TN table has 37 rows; TP has 43. Their three selected source columns produce 240 attributed cells, including six empty measurements: three NOx, one TP and two turbidity. Every full original row also retains the other original fields.

A transformed value is compared to the corresponding original number only as a source diagnostic. Original ln and log10 strings are retained. A blank, a nonnumeric value or a discrepancy is not silently replaced. Rows that reuse sensor readings remain distinct source rows and are not asserted to be independent observations.

The projected native status is `Published calibration source`, requiring explicit original Measurements review. No row is automatically included. NOx remains nitrate plus nitrite; the current native eligibility rules do not silently convert it to nitrate. Exact laboratory method, sensor model, analytical fraction of NOx and hydrologic independence are not inferred.

The XML uses older logTN/CSV names in places. Actual ScienceBase file identities and the supplied complete files determine the selected edition. The correction workbook `NitrateCorrectionsRef_01575900.xlsx` is retained byte-for-byte when provided, including publisher byte count, MD5 and calculated SHA-256. This desk does not parse its worksheets or reapply corrections to the already published NOx values.

## Use the existing application

Open **Measured observations → Receive sources → Chiques nutrient calibration sources**.

1. Select the complete original-source transfer JSON. Select any available original correction workbook and complete model HTML summaries as companions. The original publisher manifest is checked against every selected publisher file.
2. Choose **Inspect complete sources**. Read source coverage, missing originals, original row/clock/value details, transformation diagnostics and the full provenance. Inspection does not import.
3. Choose **Receive reviewed source collection** for that exact inspection. “Reviewed” here means the selected source set was inspected; scientific row eligibility remains pending in the ordinary Measurements review.
4. Reopen the collection from **Retained original nutrient collection**. Every original member, report and native import binding is checked. Use the ordinary Measurements screen for row decisions and Station assignments for a justified native domain binding.
5. Download the complete source-review JSON, diagnostics CSV or readable HTML. **Publish and download full editable collection** produces the original collection ZIP with every selected original, source report, complete editable measurement project and normal receiving instructions.

Keep the whole ZIP together so readable report links can open originals. The standalone HTML is a readable source report, while the collection includes the original bytes and editable project. No partial table export substitutes for that complete handover.

### Unfinished work, interruptions and later originals

**Download complete working preparation** preserves uninspected source selection or the complete inspected preparation and its pending collection identity. Reopen it with **Reopen complete source preparation JSON**. The original parser and complete source identity are checked again; reopening does not import.

An interrupted or unconfirmed receive retains the exact collection ID and original selection. **Continue original collection receiving** calls the existing collection writer, which reuses the same native imports and completes missing original files. It does not create a replacement workspace or a new scientific import identity.

Adding an original workbook/model HTML later creates a new complete collection edition. Each table's import provenance depends on that table and its mandatory README/GEOREF/XML/ScienceBase context; optional companions do not rewrite an existing native import's origin. A real mandatory-context change becomes part of the projection's raw context identity and therefore creates a genuine new native source edition. Original imported sources and earlier collections remain intact. Complete model HTMLs are carried once in the collection, rather than repeated in each table's origin pages.

The host retains unfinished nutrient preparation under the original workspace and person selection while navigating. It does not send an old workspace request through a new selection. Closing the browser still requires downloading unfinished work; this is not an automatic server draft store.

## Original CLI

Use the installed Node22.16 or newer Measurements engine. Commands below use original paths chosen by the operator, not a network fetch.

```sh
node --experimental-sqlite measurement_workspace/engine/cli.mjs chiques-prepare \
  --source Chiques_Original_Source.json \
  --output nutrient-preparation.json
node --experimental-sqlite measurement_workspace/engine/cli.mjs chiques-preview \
  --workspace /absolute/current/measurement-observations \
  --file nutrient-preparation.json --output reviewed-preview.json
```

To add originals, supply `--companions original-files.json` to `chiques-prepare`. That file is an array of original file paths, resolved relative to the JSON file. Original filenames, bytes and publisher MD5 are checked. Do not relabel a file to match another inventory entry.

The preview returns the complete `preparation` and `preview.id`. Save the exact selected request as `{"preparation": <complete preparation>, "expectedId": "<preview.id>"}`, then:

```sh
node --experimental-sqlite measurement_workspace/engine/cli.mjs chiques-receive \
  --workspace /absolute/current/measurement-observations \
  --file reviewed-request.json --output received.json
node --experimental-sqlite measurement_workspace/engine/cli.mjs chiques-catalogue \
  --workspace /absolute/current/measurement-observations --output collections.json
node --experimental-sqlite measurement_workspace/engine/cli.mjs chiques-read \
  --workspace /absolute/current/measurement-observations --id COLLECTION_SHA --output complete-source.json
node --experimental-sqlite measurement_workspace/engine/cli.mjs chiques-report \
  --workspace /absolute/current/measurement-observations --id COLLECTION_SHA --output nutrient-source.html
node --experimental-sqlite measurement_workspace/engine/cli.mjs chiques-csv \
  --workspace /absolute/current/measurement-observations --id COLLECTION_SHA --output nutrient-source.csv
node --experimental-sqlite measurement_workspace/engine/cli.mjs chiques-bundle \
  --workspace /absolute/current/measurement-observations --id COLLECTION_SHA --output complete-study.zip
```

Output publication is complete and create-only: an identical existing output is reused; a different complete output is preserved and refused. Select a new output filename for a changed source edition. The destination parent must already exist.

## Independent receiving

Extract the original complete ZIP into a selected private directory using the existing safe artifact receiver. Verify its `edition.json` file inventory before use. The unchanged original collection format carries full source and report bodies; the unchanged original project carries canonical records, source-row links, reviews, selected versions, mappings, previous result snapshots and histories.

```sh
node --experimental-sqlite measurement_workspace/engine/cli.mjs receive \
  --workspace /absolute/independent/measurement-observations --file project.json
node --experimental-sqlite measurement_workspace/engine/cli.mjs collection-receive \
  --workspace /absolute/independent/measurement-observations \
  --manifest collection.json --source-root sources
node --experimental-sqlite measurement_workspace/engine/cli.mjs chiques-read \
  --workspace /absolute/independent/measurement-observations --id COLLECTION_SHA --output reopened-source.json
```

The first command requires an empty selected measurement workspace. The second restores original collection files while reusing exact native import IDs. Follow the receiving application's original native-domain review before assigning new native reaches or using data in models.

## Complete installation and manual receiving

The whole source group includes the nutrient engine, report generator, collection adapter, CLI helper, browser module and its operator mirror, original HTTP/CLI/host lifecycle joins, operator asset declaration, this guide and the manual receiving source. The maintained `integration/measurements/INSTALLATION.json` must contain each selected file with its exact bytes and SHA, preserving all current independently owned modules. The original installer performs fresh-preimage checks; resolve a concurrent source change rather than forcing an older shared file over it.

The manual course is `measurement_workspace/reference/run-chiques-nutrients.py`, invoking its sibling original Node driver under one retained operation lock. It borrows the existing selected Chiques measurement workspace, actual source transfer, optional companion manifest and an explicit independent recipient directory. It retains the complete original request/source/preparation, accepted output, whole ZIP/project, replay and cold receiving. Use the same operation directory after interruption; a changed request/source is refused under that identity.

Run the retained source selection from the application directory, with the original author workspace and an explicitly selected independent recipient:

```sh
python3 measurement_workspace/reference/run-chiques-nutrients.py \
  --workspace /absolute/current/measurement-observations \
  --recipient /absolute/independent/measurement-observations \
  --operation /absolute/original/chiques-nutrient-receiving \
  --source /absolute/retained/Chiques_Original_Source_Transfer.json \
  --companions /absolute/retained/original-companion-paths.json
```

Omit `--companions` when those originals have not been supplied. Its JSON value is an array of absolute original file paths, matching `chiques-prepare`. The launcher supplies the original Node SQLite flag and passes the held lease through the complete operation.

The original 6ACE Chiques operation and 9B23 sediment reference queue remain authoritative. Do not create another donor or rerun their accepted Kansas 120 course. A source review or module parse is not native completion. The producing worker must open, look at and use the actual installed UI at desktop and narrow widths, exercise important controls, download and reopen real files, and record any limitations before describing the result as customer-ready.

### Capacity and provenance

Original source files have a 32 MiB aggregate guard; companions must match the original publisher inventory. The full native HTTP route and host request are bounded at 128 MiB, including JSON representation. The final manual course records actual complete preview and receive request sizes. Configured lower host limits can refuse a request before import; retain the source preparation and use the same installed CLI. Published missing companion status means not selected, not that a file was fabricated, recalculated or fully inspected.

The saved manual source selection includes the Python lock launcher and every followed JavaScript module. Author and recipient must resolve to separate, non-nested physical directories. Both new and already existing output directories are checked and synced before continuing after interruption.
