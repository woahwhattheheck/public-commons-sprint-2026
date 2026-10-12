# Survey Release Workbench

A complete local workspace for turning published survey observations into a reviewed, portable release. The bundled collection uses all 36 Community Health Survey indicators selected from the NYC Department of Health and Mental Hygiene's pinned public EH Data Portal repository: **36,836 observations and 85 distinct measures**.

Open the source collection, filter by measure/geography/period, inspect original definitions and notes, annotate or exclude observations, compare source editions, and deliver an edition that the recipient can reopen. Every saved case includes its original source texts. The application keeps raw source fields separate from the publisher's displayed estimates and preserves suppressed values.

## Start

Requires Node.js 18 or later. There are no package installs, external services, account requirements or paid API calls.

```sh
cd business-tools/survey-release-workbench
node cli.cjs serve
```

Open the local URL printed by the command and choose **Open NYC source**. The server listens on 127.0.0.1 and serves only the application and the listed public input files. Use `--port 0` to choose an available local port. Stop with Ctrl+C.

The browser remembers the active case in IndexedDB. **Save case** downloads a portable JSON file containing the original files and the full review history. Open that file on another machine to continue. If browser storage is unavailable, use Save case; the application retains its unsaved-change warning until browser storage succeeds. Download preparation alone does not claim that the file has been saved.

## Produce a full delivery

```sh
node cli.cjs prepare --out /absolute/path/to/deliveries
```

This command processes the complete bundled collection and writes one compressed ZIP. It contains:

- `workbench.html`: the complete application with the case embedded; open it directly in a browser.
- `source-case.json`: original source files, source manifest and all review events.
- `release.csv`: published estimates with their measurement, geography, period, notes and review fields.
- `codebook.csv`: all 85 measure definitions, calculations, source descriptions and trend-break metadata.
- `release.json`: the same publication as a columns-and-rows table, exclusions, complete source dictionaries and methodology references.
- `edition.json`: content-derived edition identifier and export checksums.
- `review-history.json`: the ordered review decisions.
- `application/`: all runnable source files and pinned data needed to regenerate the result.

The exporter uses the same engine as the operator UI. It deflates ZIP entries in memory and writes the final archive atomically. It does not stage uncompressed publication files. Repeating the same export reuses an identical completed archive; different content receives a different edition identifier. A concurrent output cannot silently replace an existing result.

To deliver a reviewed case:

```sh
node cli.cjs export --case /path/to/reviewed-case.json --out /path/to/deliveries
```

To create only the standalone interface:

```sh
node cli.cjs standalone --case /path/to/reviewed-case.json --out /path/to/workbench.html
```

The standalone file opens its embedded source edition and restores a valid saved continuation of that edition's review history. A different source edition or divergent review history does not replace the embedded case. It also accepts other saved cases. The bundled-source button requires the local server; a standalone case already contains its full original source.

## Review and comparison

Select **Review** on a row to see the exact published estimate, confidence interval, source note and calculation. Review actions add a note, include an observation, or exclude it with a reason. Adding a note preserves the last explicit include/exclude decision; only Include reverses an exclusion. Exports retain both the latest action and the effective publication disposition, with the decision's original note. Reviews never alter an original estimate or interval. Each decision retains its predecessor and a content-derived event identifier. Repeating the same last action is a no-op.

**Compare periods** stays inside the same indicator, measure and geography. It checks overlapping periods, the source's 2021 trend break and explicitly stated imputation changes. When a descriptive difference is appropriate, it is reported in the source measure's units. It does not calculate statistical significance.

**Compare another case** reports added, removed and changed observation identifiers, source fields, metadata and review decisions. It leaves the active case open.

```sh
node cli.cjs compare --left previous-case.json --right current-case.json
node cli.cjs inspect --case reviewed-case.json
```

## Filtered releases

In the UI, choose **Export delivery → Current filters**. The complete case remains in the delivery, while the published rows follow the chosen scope. Excluded observations are retained in the structured release and review history.

The CLI accepts a JSON filter file:

```json
{
  "indicator_ids": [18],
  "measure_ids": [31],
  "geo_types": ["Citywide"],
  "period_ids": [289, 296]
}
```

```sh
node cli.cjs export --case reviewed-case.json --filters filters.json --out deliveries
```

Other supported filters are `geo_ids`, `eras`, `search`, `flag`, and `review`. An empty filter object exports the complete case.

## Original-source handling

The data adapter reads the city's parallel-array format without recalculating its statistics. The observation key is the full tuple:

`[IndicatorID, MeasureID, GeoType, GeoID, TimePeriodID]`.

Input array lengths, original UTF-8 byte sizes, SHA-256 values, available Git object hashes, dimension references and observation-key uniqueness are checked during import. Case reopening checks the same source files and the review sequence.

The published value always comes from `DisplayValue`; raw `Value` remains in the original source case. Source suppression and caution markers survive export. Suppressed observations have no published confidence interval. A spreadsheet formula-leading text cell receives a protective apostrophe in CSV; exact text remains in the structured release and source case.

Measurement types are distinct: a count, crude percentage, age-adjusted percentage and rate are separate series. Geographic types are also distinct. The historical UHF33 source supplement supplies original 2002 group names and components; it does not substitute modern boundaries.

See [SOURCE_NOTES.md](SOURCE_NOTES.md) for the pinned original collection, source vintages, the 2021 break and historical geography.

## Extend to another source edition

Create a source manifest using `data/source-manifest.json` as the schema example. Retain the original metadata, time periods, geography lookup and indicator files. Set their byte lengths and SHA-256 values, and original Git blob hashes when applicable. Change the manifest's source commit and snapshot to the actual acquired edition. Point `--data` to the resulting directory.

The current adapter expects NYC EHDP parallel arrays. Another survey export format needs its own adapter; changing field names in the input manifest does not establish equivalent sampling or weighting semantics. Survey design, data collection, weighting, variance estimation and scientific conclusions remain with the responsible survey team.

## Implementation

`core.cjs` is shared by the browser and Node CLI. `app.js`, `style.css` and `index.html` provide the offline operator interface. `cli.cjs` serves the local app and creates compressed complete deliveries. All source paths are relative to this project. No CI workflow, telemetry, network acquisition task or background service is added.

The bundled NYC source is reproduced under its upstream Apache 2.0 license at `data/source/LICENSE`. The application code follows the repository's license.
