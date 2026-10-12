# Databento migration workspace — core contract

The same standard-library Python processor reads every selected source record for assessment, native inspection, and complete file delivery. It does not acquire data, run a second merchant, or replace the original DBN decoder. Original source bytes stay in the immutable Python workspace.

## Workspace and source input

File: `workspace.json`. Schema: `tj.databento-migration-workspace.v1`.

```json
{
  "schema": "tj.databento-migration-workspace.v1",
  "title": "Historical migration review",
  "selectedEdition": "nvda-premarket-20250916",
  "editions": [{
    "id": "nvda-premarket-20250916",
    "label": "NVDA complete premarket partition",
    "capturedAt": "2026-10-12T00:13:34.769910Z",
    "role": "reference",
    "scope": {
      "dataset": "XNAS.ITCH",
      "schema": "mbp-1",
      "symbols": ["NVDA"],
      "stypeIn": "raw_symbol",
      "start": "2025-09-16T08:00:00.000000000Z",
      "end": "2025-09-16T13:30:00.000000000Z",
      "timeField": "ts_recv",
      "gateway": "public-sample"
    },
    "sources": [{
      "id": "nvda-premarket-records",
      "path": "captures/04b8954e21391967c864b00cb1e5fad0b47f1cf74736dd84cc233163de914b15.csv",
      "sha256": "04b8954e21391967c864b00cb1e5fad0b47f1cf74736dd84cc233163de914b15",
      "bytes": 7475939,
      "format": "csv",
      "kind": "records",
      "role": "primary",
      "dataset": "XNAS.ITCH",
      "schema": "mbp-1",
      "encoding": {"prices": "decimal-fixed9", "timestamps": "iso8601-nanoseconds"},
      "representation": {
        "sourceKind": "provider-published-public-sample-partition",
        "sourceUrl": "https://hist.databento.com/v0/dataset/sample/download/xnas.itch/mbp-1?sample_type=equities",
        "dbnVersion": null,
        "upgradePolicy": null,
        "mapSymbols": false
      },
      "completeness": {
        "status": "complete-partition",
        "records": 46898,
        "field": "ts_recv",
        "start": "2025-09-16T08:00:00.000000000Z",
        "end": "2025-09-16T13:30:00.000000000Z",
        "completeWithinCorpus": true,
        "firstSourceRecord": 1,
        "lastSourceRecord": 46898
      },
      "corpus": {
        "id": "xnas-nvda-mbp1-public-20250916",
        "sha256": "a876882b114a940e6d8570d1c4215dd8fd671c1e3f7b443e5e6c6a467599ab85",
        "bytes": 387340259,
        "records": 2400522
      }
    }]
  }],
  "reviews": [],
  "outputColumns": [
    {"name": "identity", "path": "/identity/key"},
    {"name": "symbol", "path": "/identity/rawSymbol"},
    {"name": "event_time", "path": "/time/event/raw"},
    {"name": "event_ns", "path": "/time/event/ns"},
    {"name": "price", "path": "/prices/price/raw"},
    {"name": "price_atomic", "path": "/prices/price/atomic"}
  ]
}
```

All referenced paths are relative to the directory containing workspace.json; absolute paths, traversal, and symlinks escaping that directory are rejected. Every source is checked against exact bytes and SHA256 before records are consumed. Optional `compression:"gzip"` means the descriptor hashes the compressed file; corpus binds original uncompressed identity separately. The standalone CLI can stream a complete large corpus. The original native workspace retains its existing 8 MiB/file and 32 MiB/revision limits; a complete explicit partition is appropriate for native operation, without rebranding a subset as the full market.

Each edition role is `reference`, `baseline`, or `preview`. Source role is `primary` or `reference`; same-date definition/status sources are reference records in a session edition and do not inherit its narrower primary interval. Source kind is `records`, `dbn-metadata`, `symbology`, `batch-list`, or `batch-details`. Record format is `csv` or `dbn-jsonl`; metadata format is `json`. JSONL retains original nested `hd` and `levels` objects, integer lexemes, and source ordering. JSON integer/decimal literals are parsed as strings for exactness. CSV cells remain strings, including empty cells and older version-specific definition fields. Unknown fields remain available under `record`.

Source encoding:
- `prices:"decimal-fixed9"` for original human-readable decimal CSV, or `"integer-nanos"` for original DBN integer projection.
- `timestamps:"iso8601-nanoseconds"` or `"integer-nanos"`.
- An absent/unsupported encoding is reported as unknown and is not guessed from the magnitude.
- `representation` retains original source kind, URL, DBN version, upgrade policy and projection settings. The acquisition owner uses original AS_IS DBN transcoding with complete-buffer verification.
- Completeness status is `complete-response`, `complete-partition`, `partial`, or `unknown`; declared record counts and partition half-open bounds are checked against the full selected file. `completeWithinCorpus:true` means only that declared retained corpus. Provider partial/not_found/limit metadata remain visible.

## Comparison and scope

A preview edition may specify `compareToEditionId`. An eligible migration comparison requires preview role, a baseline-role target, an explicit `gateway:"preview"` versus `gateway:"historical"`, and identical dataset/schema/sorted symbols/stypeIn/start/end/timeField. A reference edition never becomes a production baseline automatically. The actual 2025 premarket and after-hours sources are independent reference scopes.

Record alignment uses observed same-feed event identity and an actual symbol/venue mapping. Ambiguous duplicate keys are identified without a fabricated one-to-one match. Definition joins retain dataset + publisher + UTC date + instrument ID; `raw_instrument_id` is the original exchange-specific field and is never substituted for a Databento ID. Symbology intervals use inclusive d0 and exclusive d1.

The report distinguishes applicability from actual observed change:
- XNAS historical instrument-ID migration applies to data before 2023-11-28.
- The restored 00:00–01:00 UTC after-hours window applies during Eastern Standard Time, and refers to the previous New York date.
- Midnight UTC snapshot flags are inspected as actual bitmasks only on schemas that expose flags. Definition/status events at midnight are reported as boundary records; their missing flags are not fabricated.
- Native batch list state/id/ts_received are retained; full details are bound to the original job id. Compact list responses do not become complete job definitions.

## Original records and views

A normalized record has:
```json
{
  "id": "record:<sourceId>:<one-based-row>",
  "sourceId": "source-id",
  "row": 1,
  "schema": "mbp-1",
  "role": "primary",
  "identity": {
    "key": "XNAS.ITCH|2|2025-09-16|11667",
    "dataset": "XNAS.ITCH",
    "publisherId": "2",
    "utcDate": "2025-09-16",
    "instrumentId": "11667",
    "rawSymbol": "NVDA",
    "rawInstrumentId": "7500",
    "currency": null
  },
  "time": {
    "event": {"raw":"2025-09-16T08:00:00.015298471Z","ns":"1758009600015298471","iso":"2025-09-16T08:00:00.015298471Z","state":"known"},
    "receive": {"raw":"2025-09-16T08:00:00.015462508Z","ns":"1758009600015462508","iso":"2025-09-16T08:00:00.015462508Z","state":"known"},
    "session": "premarket",
    "newYorkDate": "2025-09-16",
    "newYorkTime": "04:00:00.015298471",
    "estAfterHours": false,
    "utcMidnight": false
  },
  "prices": {"price":{"raw":"186.000000000","atomic":"186000000000","decimal":"186.000000000","state":"known"}},
  "flags": {"raw":"128","mask":128,"snapshot":false,"last":true},
  "review": {"decision":"unreviewed"},
  "record": {}
}
```

All 64-bit values and exact monetary units are strings in responses and exports. Recognize original typed sentinels before conversion: price 9223372036854775807, timestamp 18446744073709551615, order-size4294967295 and field-specific signed/unsigned undefined values. Undefined, missing, invalid, and unknown-encoding remain distinct. Definition fields retain their original dtypes and nullability; no one sentinel is applied to every field. The independent status Y/N/~ values survive unchanged even where action labels seem counterintuitive. Original flags include F_SNAPSHOT32, F_BAD_TS_RECV8, F_LAST128, F_MAYBE_BAD_BOOK4.

## Private review and output mapping

Append reviews; do not overwrite previous events:
```json
{"id":"review-unique","editionId":"nvda-premarket-20250916","targetType":"source","targetId":"nvda-premarket-records","decision":"accept","reviewer":"Named operator","at":"2026-10-12T01:00:00Z","note":"Reviewed full session and source identity."}
```
Target type is `source`, `instrument`, `finding`, or `edition`. Target IDs come from the corresponding inspection item; edition targets use edition ID. Decisions: `accept`, `revisit`, `exclude`. The last event for the exact edition/type/target wins. Private names/notes stay in operator reports. Excluding a source or instrument removes only those primary records from customer data and reports the exact excluded count. An unreviewed or revisit decision does not secretly discard data.

Output columns are unique nonempty names and JSON-pointer paths into the normalized record. Supported public roots: `/id`, `/sourceId`, `/row`, `/schema`, `/identity/`, `/time/`, `/prices/`, `/flags/`, `/record/`, and exactly `/review/decision`. Nested original arrays such as `/record/levels/0/bid_px` are supported. Missing values become JSON null/empty CSV fields; no zero is invented. Objects/lists serialize as compact JSON within mapped cells. CSV leading formula characters are not executed by the exporter; source values remain exact text.

## Native function interface

`inspect_migration(input)` takes:
```json
{"editionId":"optional-current","view":"records","offset":0,"limit":100}
```
Views: `records`, `findings`, `instruments`, `sessions`, `changes`, `sources`. Limit1–250, default100. It scans all selected records and returns:
```json
{"schema":"tj.databento-migration-inspection.v1","report":{},"page":{"view":"records","offset":0,"requestedLimit":100,"limit":100,"total":46898,"items":[],"nextOffset":100,"hasMore":true,"byteLimited":false}}
```
The page is a presentation window, never the basis of the full-source summary. A large row may stop a page at the explicit serialized-byte budget; returned count/nextOffset/byteLimited describe the exact continuation. No hidden row truncation.

`build_migration(input)` and `customer_migration(input)` take `{editionId?}`. Build returns `tj.databento-migration-build.v1`, compact complete operator report and small retained report files. Customer returns `tj.databento-customer-migration.v1`, safe customer summary and only customer report files. File records use `{name,contentType,bytes,sha256,body}`, matching the original Python workbench handoff convention.

Report schema is `tj.databento-migration-report.v1` with:
- `edition`: actual id/label/capturedAt/role/scope.
- `summary`: totalRecords,primaryRecords,referenceRecords,sourceCount,sourceBytes,instrumentCount,definitionRecords,statusRecords,excludedPrimaryRecords,customerRecords,priceStates,timestampStates,snapshotFlaggedRecords,utcMidnightRecords,estAfterHoursRecords,unknownCurrencyRecords.
- `assessment`: `instrumentIdMigration`, `afterHours`, `midnightSnapshots`, `batch`, `comparison`; exact applicability/evidence/counts and source rules.
- `findings`: full count, code/severity counts, and a small representative sample. Complete finding events are accessible through findings view and standalone export.
- `sourceSummary`: complete counts/status totals, with exact source index in its file/view.
- `outputColumns`, `reviews` (operator only), `dataExport`.
- `dataExport` says `included:false` for native reports, exact candidate/customer/excluded counts and the standalone export command. Native responses do not pretend the full mapped dataset fits1MiB.

Customer small report files:
1. `migration-summary.json`
2. `migration-summary.html`
3. `source-index.json`
4. `output-columns.json`
5. `DELIVERY.md`

Operator additionally receives:
6. `migration-report.json`
7. `review-decisions.json`

Private review notes/names and operator raw record pages are absent from customer output. Metadata/source indexes keep only explicit acquisition/source identity fields, not credentials, local host absolute paths or private review notes.

## Complete streaming file export

```sh
python3 processor.py export --workspace /absolute/saved-source/workspace.json --out /new/output --edition-id nvda-premarket-20250916 --audience operator
```

Output directory must not exist. The command processes the same selected immutable edition and same core rules. It streams every primary record, applies exact selected columns/review exclusions, and writes:
- `customer/mapped-records.ndjson`, `customer/mapped-records.csv`;
- the five small customer report files in `customer/`;
- complete `operator/findings.ndjson`, `operator/instruments.ndjson`, `operator/sessions.ndjson`, `operator/changes.ndjson`, and the two operator report files when audience=operator;
- a top-level `manifest.json` with exact file bytes/SHA256, input edition/source identities, full processed/exported/excluded record counts and successful completion.

Audience=customer writes no operator directory. On error no completed manifest is declared; an owned temporary directory is removed. The destination is published only after completion. Wrapper handoff must call this command from the selected saved revision's original source closure and include the original full portable workspace under operator custody. It must not use an unsaved working draft or rerun a prior native preview merely to export its sources.

Useful standalone `inspect --workspace ... --edition-id ... --view ... --offset ... --limit ...` and `build --workspace ... --edition-id ...` dispatch the exact same functions. Standard-library only, no API keys or new dependency install.

## Current actual source operation

The prepared real NVDA premarket partition contains46898 records and after-hours6388, with their original387340259-byte/2400522-record corpus identity. Same-day XNAS definition has one record and status four. They are complete retained public sample scopes; they do not supply a pre2023 production-preview pair or a winter00–01UTC source. Report those specific applicability distinctions while fully processing and exporting every actual input record.

Original official contracts: https://databento.com/blog/nasdaq-historical-data-changes-2026-09 and https://databento.com/blog/batch-api-changes-2026-08. DBN fields/sentinels come from the retained original databento-dbn0.70 module contract, and acquisition retains original SDK0.87/AS_IS decode metadata.
