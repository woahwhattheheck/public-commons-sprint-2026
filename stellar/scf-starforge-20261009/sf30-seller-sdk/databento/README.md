# Databento retained migration workspace

A source-preserving operator workflow for historical market-data migrations. Import an actual captured session, inspect complete-source findings with paged record detail, retain named reviews and output mappings, and deliver every selected mapped record. The component runs on the existing Python merchant workspace and its source/revision/preview/release/customer lifecycle.

The processing core uses Python's standard library. Data acquisition and DBN transcoding stay in the original Databento SDK and its AS_IS decoder adapter. Native customer functions return compact migration reports; complete mapped data is produced by the same processor's streaming file export.

## What an operator can do

- Retain multiple explicit source editions without confusing a published reference sample with a production/preview pair.
- Read original CSV fields or nested DBN JSONL headers/book levels, including exact 64-bit timestamp/price lexemes.
- Inspect dataset/publisher/UTC-date instrument identities, effective source definitions and original date-bounded symbol mappings.
- Review full-source count/hash/partition findings, independent status Y/N/~ values, typed undefined values, actual reset/snapshot flags and New York session boundaries.
- Append edition, source, instrument or finding decisions, then map original or normalized fields into customer columns.
- Export every selected primary record as CSV and NDJSON, with explicit exclusions and separate customer/operator reports.
- Reopen an original portable workspace with all saved source, review, preview and release history.

The industrial browser interface and wrapper use the existing Python workspace server, authentication and immutable source store. See [WORKSPACE.md](WORKSPACE.md) for the original CLI and native operating workflow, and [CORE_CONTRACT.md](CORE_CONTRACT.md) for the complete input/API contract.

## Three native functions

| Function | Result |
|---|---|
| inspect_migration | Full-source assessment plus one paged view of records, findings, instruments, sessions, changes or sources. |
| build_migration | Complete compact operator report and seven small retained report files. |
| customer_migration | Five customer report files, without private review names/notes or raw operator record pages. |

Inspection defaults to100 items and allows up to250. Its summary always covers every selected source record. If unusually large records reach the response-byte budget, the returned count, byteLimited flag and nextOffset describe the exact continuation. Pagination does not determine the data-export scope.

The original native limits remain8MiB per source file,32MiB per saved revision and1MiB per serialized function result. A complete gzip-compressed partition is retained as original binary source and streamed directly by the processor; no uncompressed temporary corpus is needed. Corpus identity and partition identity are distinct, and both are recorded.

## Exact source semantics

Prices are strings with their declared encoding: original fixed-nine decimal text or native integer nanounits. Conversion uses integer/Decimal arithmetic. Timestamps retain their original text and exact nanosecond string. Missing, undefined, invalid and unknown encoding are separate states. Original raw fields remain accessible, including older version-specific definition fields and nested book levels.

Definition joins use dataset, publisher, UTC date and instrument ID. The original raw_instrument_id stays an exchange-specific identifier. Currency remains null where an effective original definition does not provide it. The original status action does not override independently observed is_trading, is_quoting or is_short_sell_restricted values. Snapshot detection uses the actual flags bitmask; definition/status records are not assigned invented flags.

Review exclusions affect only selected customer records; the full original sources and assessment remain available to the operator. A new edition has its own review targets and never receives another edition's decisions implicitly.

## Complete file delivery

The standalone exporter reads the same selected saved edition and the same rules used by native previews:

~~~sh
python3 processor.py export \
  --workspace /path/to/saved-source/workspace.json \
  --out /path/to/new-delivery \
  --edition-id nvda-premarket-20250916 \
  --audience operator
~~~

The destination must be new. A temporary owned directory is published after the complete stream, output counts and manifest have finished.

Customer output contains mapped-records.ndjson, mapped-records.csv, migration-summary.json, migration-summary.html, source-index.json, output-columns.json and DELIVERY.md. Operator output also includes the complete findings, instruments, sessions and changes as NDJSON, the full migration report and private review history. Every file is named in a manifest with exact bytes and SHA256. Original portable source/release custody is composed by the native wrapper.

For an independent source view:

~~~sh
python3 processor.py inspect \
  --workspace /path/to/source/workspace.json \
  --view instruments --offset 0 --limit 100
~~~

Use build or customer with the same workspace/edition selection to obtain the respective compact report envelope. No credentials are needed to operate a retained source.

## Migration rules and observed applicability

Databento's [Nasdaq historical changes](https://databento.com/blog/nasdaq-historical-data-changes-2026-09) apply new instrument-ID assignments to XNAS.ITCH data before28November2023, restore the final EST after-hours UTC hour, and introduce native midnight snapshots for specified schemas. The report separates these conditions from changes actually observed between explicit matching historical/preview sources.

The [batch API transition](https://databento.com/blog/batch-api-changes-2026-08) separates job id/state/receipt summaries from full per-job details. Original retained batch responses are joined by actual job id, without treating a compact summary as complete job metadata.

A production-preview comparison requires explicit roles, matching gateway/scope/representation and observed same-feed event identities. Duplicate ambiguous keys remain ambiguous. No missing record is invented from an exchange sequence gap in a symbol-specific sample. Reference sample sessions are assessed and exported completely without pretending to demonstrate a historical cutover.

The retained actual operating input includes four complete NVDA sessions: MBP-1 premarket46898 records, MBP-1 after-hours6388, MBO premarket111635 and MBO after-hours224514, alongside original same-day definition/status and initial-reset references. These are separate complete partitions of their original published corpora. Their source time is September2025, so they do not themselves constitute a pre2023 migration pair or an EST00–01UTC sample.

## Source custody

Public repository files are software and operating documentation. Actual market-data captures, native portable workspaces and customer artifacts stay in the original private case/source custody. The input manifest records the precise acquisition representation, original corpus, complete selected partition, decoder policy and source URL. Original user/account access and data-use terms remain with the selected customer's acquisition context.
