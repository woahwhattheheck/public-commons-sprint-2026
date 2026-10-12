# Finage market workspace — complete application contract

The existing Python workspace remains the only operator store, revision history, preview queue and portable format. The application consumes Scout's `commons.finage.native-input-contract.v1` and `tj.finage-market-workspace.v1` unchanged.

## Public functions

`inspect_market(input={})`, `build_market(input={})`, `customer_market(input={})` accept optional exact `editionId`. Inspection also accepts `view` (records/findings/symbols/changes/sources/events), nonnegative `offset` and `limit` 1–1000. Every invocation validates and processes the complete selected sources; presentation pages state actual totals and byte limits. The complete CLI export streams every selected customer record.

## Source and exact value interpretation

Source files and all declared metadata files are bound by exact bytes/SHA256 and safe relative path. The native importer accepts the acquisition client's content-addressed `.json`, `.ndjson`, `.jsonl`, `.events.jsonl`, `.capture.json`, `.stream.capture.json` and `.recovery.capture.json` files; original filename hashes and manifest hashes/byte lengths remain mandatory. Snapshot quote/trade collections remain separate; totalResults is compared with unique exact symbol spelling. Aggregates retain provider window/count/limit evidence. WebSocket capture events retain local event ordinals, session boundaries and original application payloads; these ordinals never become provider sequence numbers. Published models are expanded for inspection and remain reference observations.

Every JSON number is parsed as its original token with its original JSON kind. The normalized record has `id, editionId, sourceId, sourceSha256, sourceKind, role, kind, sourcePointer, symbol, customerSymbol, capturedAt, localOrdinal, raw, fields, values, time, transport, excluded`. `raw` is the exact parsed source object; `fields` contains `{kind,text}` cells. Public inspection renders raw numeric nodes as typed cells so JavaScript never coerces original prices/timestamps through binary64. Customer JSON-pointer mapping reads the original normalized record, and complete NDJSON emits source number lexemes as numbers. CSV carries the same exact token text. A selected `/fields/p/text` mapping deliberately emits a string; `/raw/p` preserves the original number/string kind.

`timeInterpretations[]` entries are append-only `{id,editionId,sourceId,sourceSha256,unit,reviewer,note,at}`, with unit one of seconds/milliseconds/microseconds/nanoseconds/uninterpreted. The latest matching entry is active; declared provider units remain separate. Zero and missing timestamps stay zero/missing. The normalized `time.value` retains the original `t` or `timestamp` scalar and JSON kind; `time.raw` is its typed inspection cell. The default customer `event_time` and `event_time_kind` columns read `/time/value` and `/time/raw/kind`, so either supported source spelling is preserved without converting an original number to a string. `symbolMappings[]` entries use the same source binding plus `symbol,customerSymbol`; no automatic spelling changes or cross-source joins.

`reviews[]` entries are append-only `{id,editionId,sourceId,sourceSha256,targetType,targetId,decision,reviewer,note,at}`. Types are source/finding/symbol/record; decisions accept/exclude/revisit. Exclusion targets an exact source, symbol or record. A finding records accept or revisit; it does not silently remove affected data. Exclusion is an explicit original-source-bound customer selection. Findings are stable per source and code; named review never changes the source coverage facts.

`analysis.priceBasis` is native or midpoint; midpoint is an explicit quote-derived Decimal basis, not a trade or exchange execution price. `analysis.staleAfterSeconds` is null or an exact nonnegative decimal threshold against source capture UTC. Comparison requires explicit `compareToEdition`, exact matching scope, matching time interpretation and price basis. Snapshot symbol/kind keys and aggregate symbol/time keys must be unambiguous. Raw token changes and exact Decimal deltas remain visible; type changes are not hidden.

## Reports and delivery

Inspection: `tj.finage-market-inspection.v1`; build: `tj.finage-market-build.v1`; customer report: `tj.finage-customer-market.v1`. Each has `report`; inspection adds `page`; builds add hashed `files[{name,body,bytes,sha256,contentType}]`.

Compact customer files: market-summary.json, market-summary.html, source-index.json, output-columns.json, DELIVERY.md. Operator also receives market-report.json and review-decisions.json. `report.ready` describes resolved source review and configured customer mapping, separately from source coverage; it does not prohibit an explicit export. Reports never equate public/reference observations with an account-entitled feed or an executed trade.

`python3 processor.py export --workspace workspace.json --out NEW_DIRECTORY [--edition-id ID] [--audience customer|operator]` emits:
- customer/mapped-records.csv and customer/mapped-records.ndjson, every selected primary record in source order;
- the five compact customer files above;
- operator report/reviews and complete findings/symbols/changes/events NDJSON for operator audience;
- manifest.json, schema `tj.finage-market-delivery.v1`, exact `editionId,workspaceSha256,processedRecords,primaryRecords,customerRecords,excludedRecords,allSelectedRecordsProcessed:true,assessmentReady,sourceCoverage,sources,files[{path,bytes,sha256}]`.

Source index schema `tj.finage-source-index.v1`; columns schema `tj.finage-output-columns.v1`, `columns[{name,path}]` from `customer.columns`, and explicit null/kind conventions. Customer files exclude private reviewer identities and notes. Destination creation is immutable and atomic. Interrupted staging is recoverable from the same source without another provider request.

## Native adapter

`workbench.mjs` exposes create/import/reopen/status/inspect/serve/workspace/export/handoff using the maintained native model/server/CLI. Operator route /finage-market/. Handoff consumes a completed original build_market preview and reconstructs its immutable revision for the full processor export, preserving portable history and original preview bytes. No alternate API authentication or application database is introduced.

A complementary receiver should retain exact original CSV/NDJSON, manifest, source index, customer column dictionary and coverage; resume exact committed prefixes; stage before named customer activation; preserve head conflicts, rollback, query/export and backup/reopen. Receiving may share the maintained Databento receiving engine through an explicit Finage delivery profile rather than fork storage machinery.
