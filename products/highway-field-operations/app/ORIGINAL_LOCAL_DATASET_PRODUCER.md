# Original local SF30 intake → SF100 finalized delivery

Source: woahwhattheheck/tjlabs-stellar-merchant-workspace at a441a936124f10bae1698a986e0c26b8a00b6400 (the selected original paired-reconciliation release). Both selected JavaScript modules import only Node built-ins. Node 22+ is the original SF100 requirement. No package installation, seller listener, signer or payment call is needed for this local operator path.

## Native APIs

Import loadCsvDataset or loadDatasetConfig from sf30-seller-sdk/dataset-handler.mjs. loadDatasetConfig takes the absolute JSON configuration path. Its exact schema is stellar-forge.csv-dataset.v1. Required fields: schema, file (CSV resolved beside config), name, columns. Each columns entry is a native type string or {type,nullable}; supported types are string, integer, number, boolean. Optional keys: filters, ranges, sorts, maxBytes, maxRows, maxCellChars, defaultLimit, maxLimit, maxPageBytes, semantics, nullEncoding. No unknown keys.

loadCsvDataset takes the same values except schema, with file already selected; it returns frozen {describe,admit,handle}. describe() returns actual schema/snapshot/count. handle({query:new URLSearchParams(queryText)}) returns {status,headers,body}; require status===200 and retain this exact original body. Do not construct dataset-page.v1 objects outside the original handler.

Use nullEncoding:'unquoted-empty' to distinguish null from empty text: unquoted empty CSV field is null; quoted "" is literal empty string. Every ordinary text field is CSV quoted with quotes doubled, including embedded line breaks. Integers must be JS-safe integers; exact large identifiers and original nested JSON should be explicit string fields. Retain the complete original ArcGIS feature/page bodies, projection definition, JSONL source and CSV bytes as separate source inputs. An explicit JSON-string column can preserve each complete attributes/geometry/feature object without flattening or inferring a schema. The original raw capture remains authoritative.

Load the input once per retained immutable projection. Start with a bounded query such as limit=100 with no filters, sort, field selection or cursor if complete row coverage is intended. The actual body.page.nextCursor is the only next cursor. Subsequent query preserves original parameters and sets cursor to that exact string. Never silently drop fields/rows or claim an arbitrary JSONL input is a finalized delivery.

Original limits: 1–64 columns; up to 1,000,000 rows and 256 MiB input when explicitly configured; maxCellChars<=1 MiB; page limit<=1,000; maxPageBytes<=900 KiB. Defaults are lower. Choose reviewed bounds before the first page, preserve the frozen config, and fail explicitly when full captured records exceed them.

## Original SF100 assembly

Import init, appendMany, scan, finalize from sf100-buyer-dataset-delivery/deliver.mjs.

The owned parent directory must already exist privately. await init(out) creates/reopens the private original delivery directory and pages. For each exact saved page, retain stable operator authorization/evidence with an ID matching the selected source/projection and page position. This is reviewed local operator delivery, not purchase/signature/settlement.

appendMany(out,[{page:absolutePagePath,intent:stableIntent,evidence:absoluteEvidencePath,...(pageIndex?{cursor:originalPriorCursor}:{})}]) appends one or more complete original responses. First cursor MUST be omitted, not null. Same-session page intents are unique, printable ASCII from [A-Za-z0-9_.:-], start alphanumeric, <=128 characters. Use exact retained originals on resume.

Before any resumed append, scan(out,{retainPayload:false}) returns actual accepted prefix. Verify each retained page identity, original cursor, intent, sourceSha256 and evidenceSha256 against the frozen local inputs. Continue only beyond that accepted prefix; append rejects already-finalized sessions. A failed later append may have accepted earlier pages.

When actual nextCursor===null and count===total with at least one original page (including the valid empty-dataset page), call finalize(out). It publishes original dataset.jsonl, dataset.csv, review.html and manifest.json; manifest commits last. Its create-only publish reconciles exact existing bytes. A resumed finalized session must still have every original file checked by the native receiver; finalized merely being true is not a substitute for validating those bytes.

Then obtain the complete unchanged scan(out,{retainPayload:false}) again and save exactly that returned object as the report. Pass that report or the room to the existing Python original finalized receiving path. Never use the CLI status summary, finalize summary, or a synthetic complete flag as the input report.

## Custody and scope

One retained operation lock must cover source materialization, exact page/evidence writes, SF100 append/finalization, report publication and original paired import. Keep original operation IDs, accepted prefixes and first completed results on reentry. The source model does not create a second publisher or SQL owner. Borrow the existing DuckDBWorkspace for the original review/import/pairing API and close it under its real owner.

The included local-dataset-receiving/README.md documents the same original candidate.dataset.handle → SF100 appendMany/finalize/scan contract. Its full publisher/customer service is not required by the selected direct APIs and is not represented as included executable code. The two selected code leaves have no repository imports; that is the complete dependency closure for this local intake/delivery entry.
