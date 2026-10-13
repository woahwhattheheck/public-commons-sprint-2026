# GridKind hourly tariff sources

Operation: `GRIDKIND-TARIFF-SOURCE-WEEK-BBBD-20261013`.

## The complete household workflow

Open **Hourly tariff sources** from the existing week planner. Receive an original UTF-8 CSV, choose its exact date/hour/price headers, identify USD/kWh or US cents/kWh, and confirm nominal local days with hours 0–23. Supply a title, source role, optional source URL and interpretation note. GridKind does not fetch the URL or verify a utility contract.

Preview shows original record and physical line references, original tokens, exact normalized decimal strings, invalid rows and daily missing/duplicate-hour coverage. Save creates an immutable household source edition containing the entire original CSV text, UTF-8 byte length and SHA-256, explicit mapping and interpretation, parsed rows and coverage. A corrected file is a new edition; original editions remain in history.

Choose that saved source and one **saved target week**. The application previews every selected hour against the target's original price, identifies the exact source row, and requires one valid price for every one of the seven days' 24 hours. This includes retained rest-day inputs. Duplicates are never averaged and missing hours are never filled. Other dates stay in the source and are disclosed as unselected rows.

Apply creates an application record and a resulting ordinary week in one SQLite transaction. The original week, name, dates, rest-day flags, circuit caps, load IDs, labels, powers, durations, windows and quiet-hour choices remain intact. The maintained optimizer calculates the new week's results from only the replaced prices. A plan may still be infeasible because of its retained load constraints; the ordinary weekly report states that outcome.

Open the resulting week through the existing week planner. Its daily-input handoff, exact human approval and simulated execution remain separate. Tariff import or application grants no device authority.

## Source contract and limits

- CSV: valid UTF-8, at most 1 MiB, 10,000 data records, 64 columns and 4,000 characters per cell. A UTF-8 BOM, quoted commas, quotes and line breaks are retained in the original text. Header names are exact, nonempty and unique.
- Date: `YYYY-MM-DD`, the maintained planner's calendar range 2000–9998.
- Hour: integer token 0–23, with an optional leading zero. No timestamp parsing, timezone inference or daylight-saving repair is performed. A 23-hour or repeated-hour local clock day needs an explicitly authored compatible input before it can be applied; the original remains retained.
- Price: unsigned decimal, at most 12 source decimal places, no currency symbols, exponent notation or thousands separator. USD/kWh and US cents/kWh are explicit choices. Cents conversion moves the decimal point exactly; source lexemes and normalized strings remain retained. The original scheduler uses JavaScript numbers and supports 0–10 USD/kWh.
- Unsupported rows can be saved for inspection. A selected week can be applied only when its 168 date/hour cells each have exactly one valid row. Unselected and invalid-unselected record counts are shown; no unknown date is inferred.
- Tariff operations use an 8 MiB JSON transport ceiling. The existing complete household recovery format retains its 8 MiB ceiling. A tariff mutation that would make its complete, pretty-printed household download exceed that ceiling rolls back entirely. The bound matches the original browser backup and file-receiving path.
- Prices describe supplied planning inputs. Fixed charges, taxes, entitlement, realized energy savings and live meter/device data are outside this model.

A previously exported **Source JSON** can be selected in the source file control. The server verifies its complete original text, normalized rows, summary and edition digest before loading its fields. The operator previews and deliberately saves a new household edition. Original source CSV downloads reproduce the retained UTF-8 bytes, including a BOM when present.

## Downloads and independent reopening

Each saved source has four downloads:

1. Original CSV — exact retained bytes.
2. Source JSON — complete source/interpretation/rows/coverage with edition SHA-256.
3. Normalized row CSV — all original row/line references and tokens plus exact USD/kWh and issues. Formula-leading spreadsheet text is escaped; original CSV and JSON stay exact.
4. Readable HTML — full source identity, all daily coverage and all original row references.

The existing complete household backup includes tariff editions, applications and resulting weekly records, along with the original daily/review/MCP historical records. Restore preserves original source and record hashes. It verifies each source edition, original target/source references, all selected rows, the expected price-only input transformation, and exactly one resulting week per application. Historical schedules are inspected without rerunning the optimizer. Restored assistant credentials and active daily approvals are not granted by tariff records; the original household receiving rules remain authoritative.

Download and open the actual files. Open the HTML at desktop and narrow width; inspect its complete table and source labels. Reopen Source JSON through the file control. Restore the complete household into the original independent receiving installation, reopen the source and resulting week, and use the ordinary daily controls. A source hash alone is not recipient-use acceptance.

## HTTP interface in the original server

The browser cookie, selected household, revision and process-generation checks remain the existing authority. Every POST uses `context: {householdId, revision, generation}`.

`POST /api/tariffs`:

- `{action:"headers",csv,context}` parses the complete CSV and returns exact headers and record count. Alternatively `{action:"headers",edition,context}` verifies and reopens a complete source JSON.
- `{action:"preview-source",source,context}` returns the whole deterministic source edition. `source` has `filename,title,sourceUrl,note,role,unit,clockBasis,mapping,csv`; role is `user_supplied` or `authored_example`, clock basis is `nominal-local-24h`, and mapping is `{date,hour,price}` using original column names.
- `{action:"save",source,previewSha256,requestId,context}` saves that exact preview. `requestId` is an original UUID.
- `{action:"preview-apply",tariffId,targetId,context}` returns all selected source rows, coverage errors, the complete price-only input transformation and a bound preview digest.
- `{action:"apply",tariffId,targetId,previewSha256,requestId,context}` saves both the application and new week atomically.

Saved requests bind their action and exact normalized source or selected source/target/preview. A committed same-ID/same-intent retry recovers its original record(s) before stale revision/generation checks. A different intent under that ID is rejected. A concurrent failed revision check performs another owned outcome lookup before returning a definite not-committed marker. The browser persists the exact request before every dispatch, including Retry. Lost/unknown outcomes retain the same request.

For a matching not-committed response, **Preserve rejected request and re-preview** archives the complete old request and server marker before clearing it. Refresh and explicitly preview current data before a new request. No timeout automatically abandons or replays an operation.

`GET /api/tariffs?kind=tariff|week&offset=0&householdId=...` returns an owned 50-record catalogue page. `GET /api/tariffs/export?recordId=...&format=source|json|csv|html&householdId=...` downloads a saved tariff. Original history/record/household export routes remain usable, including through the existing MCP history and export tools. This edition adds no new MCP mutation tools or credential system.

## Continue the existing 379A receiving operation

Keep the original GridKind owner, isolated Node 24 runtime, SQLite directory, cookies, browser profile and source-packet binding. Do not start a second optimizer panel, competition entry or browser controller. The complete source carrier includes all existing application/MCP/week-review modules plus this extension; `receive-week-review.mjs` remains unchanged. If the original frozen receiving course is already complete, retain its exact source/output identities and continue this additive source in the same owned installation under the original host's reconciliation procedure. Do not overwrite an immutable old course binding with a new source SHA.

The current original receiver request is coordination `C0BU51F1PL3 / 1791840512.360639`, request `1791895650.059919`. The operator supplies its existing Node and browser paths; install no runtime or paid service.

1. Open the exact new source in the original server and choose the existing operated household. Keep its completed review history and original daily records.
2. In the week planner, save a week beginning **2026-10-19** using the original GridKind example inputs. Record that actual saved ID. This is an authored product example, not a customer's tariff or measured energy use.
3. Open `/tariffs`. Select `examples/gridkind-authored-hourly-prices.csv`, a complete 168-row UTF-8/BOM file derived only from the maintained `DEMO.prices`. Set source role **Authored example**, unit **US cents per kWh**, source title **Original GridKind example prices**, exact headers date/hour/price, and confirm the nominal clock basis.
4. Preview. Use the row paging controls, inspect all seven complete dates, original 12/25/43-cent tokens and normalized 0.12/0.25/0.43 USD/kWh. Save through the actual control, retaining the exact outgoing request before dispatch as the existing receiver does for uncertain operations.
5. Reconcile response loss using that request ID. Retry must return the original source ID. Do not create an extra source just to demonstrate a retry.
6. Select the saved source and original saved week. Preview all 168 rows; inspect previous/new prices, preserved rest/load constraints and source identity. Apply once. Capture both application and new week IDs. Repeating the identical captured request, including after the original same-port server restart, must recover the same pair without changing record counts.
7. Open the actual new week in the week planner. Inspect its populated report and ordinary daily handoff, then use the existing exact approval/simulated-execution workflow. Preserve the earlier original work.
8. Download the four source files and complete household JSON. Open the CSV and JSON in their normal viewers, view the complete HTML at desktop and **390px**, and reopen the source JSON in the actual import control without saving another edition unless deliberately requested. Confirm that the original CSV file's bytes equal the supplied example, including its BOM.
9. Use the original independent installation and complete household restore. Inspect restored sources, source/application/target links and resulting week. Existing week-review and assistant history must remain present. Open a planned day and continue the original fresh-approval simulation after restore.
10. View real screenshots of the loaded page, source preview, full application preview, saved outcome, report and narrow controls. Exercise empty-source, incomplete coverage and returned-error states if actually encountered. If correcting an original source for demonstration, retain it under a distinct authored title and never present it as utility evidence.
11. Record the actual source/head, original host/runtime/profile, resulting IDs, exact downloaded bytes, files/screens actually opened and any concrete repairs in the same receiving handoff. Capturing screenshots without viewing them is insufficient. No native/rendered completion is claimed by source publication.

## Focused source-level operation already performed

The exact current parser, maintained original scheduler and weekly engine processed the authored 168-row cents source: seven complete days; original BOM retained; price-only apply reproduced the original complete inputs. Original weekly costs were baseline 31.178 USD and optimized 14.252 USD, with 85.4 kWh modeled flexible-load energy. Removing one known hour and duplicating another both blocked application with the exact affected cell/row identities. These are authored source-level calculations, not household consumption, utility pricing or browser/SQLite receiving.

Native admission during composition failed before process creation with `409 environment_offline`. The original equipped receiving owner retains all actual browser/SQLite/export/restart work.
