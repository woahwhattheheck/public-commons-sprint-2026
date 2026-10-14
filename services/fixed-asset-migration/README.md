# Fixed asset migration and exit workspace

This complete local tool retains original files, explicit column mappings, reviewed corrections and actual returned target exports. Its financial schedules keep every amount within its company, book, currency, measure and reporting date. The six exchange schemas are this tool's reconciliation contract. Obtain the supplier's current sanctioned import and exit specification before preparing a tenant load.

The reusable engine runs in a browser or Node. The CLI writes complete portable workspaces and a directory of original, corrected, canonical and supporting files. The standalone operator application uses the same engine. Production templates are header-only; public class-level accounting references and labelled receiving examples remain separate from private asset records.

## Source and amount contract

All imported UTF-8 CSV text is retained exactly, including a BOM, duplicate headings, quoted newlines, original decimal tokens and unmapped columns. A header's zero-based numeric index is the mapping identity, so identical heading text does not silently select a different column. Source and returned-target files remain separate editions. A selected domain uses one complete source edition per role; all preceding editions remain available.

| Domain | Exact composite key | Additional fields |
| --- | --- | --- |
| assets | company_id, asset_id | parent_asset_id, class_code, description |
| books | company_id, book_id | currency, accounting_basis |
| balances | company_id, book_id, asset_id, as_of, currency, measure | amount |
| events | company_id, book_id, event_id | asset_id, effective_date, currency, measure, signed_amount, event_type |
| journals | company_id, book_id, journal_id, line_id | posting_date, currency, account_code, debit, credit, optional asset_id |
| controls | company_id, book_id, as_of, currency, measure | amount, source_reference |

Identifiers and source-defined measures are exact strings. Company forms part of every asset/book reference. Parent asset cycles, missing/ambiguous references, duplicate composite keys, invalid dates, malformed monetary values and book/currency differences appear as findings.

Financial mappings explicitly select amount_multiplier 1 or 1000. Assets/books use 1. Amounts are signed decimal strings, with up to 80 whole digits and 18 fractional digits; no grouping, exponents, currency conversion, binary floating-point summation or guessed rounding. Debit/credit are nonnegative. The engine preserves raw tokens alongside normalized scaled values and compares both canonical and unmapped source/target cells. It never infers a movement sign from event_type or a cost category from measure.

Dates must be real calendar dates in YYYY-MM-DD form. Monetary sums and differences are exact strings, including 0.1 + 0.2 = 0.3. Totals never combine different companies, books, currencies or measures.

## Explicit financial basis

Save one current policy per exact company/book/currency. Each complete policy edition contains:

- id, company_id, book_id, currency;
- opening_date and closing_date, opening strictly before closing;
- explicit event_scope_complete and population_complete booleans;
- rollforward_measures containing only the original measures covered by the declared event population;
- carrying_equations, each with result_measure and components containing exact measure and coefficient 1 or -1;
- actor and note identifying the reviewer and the source/population basis.

Saving binds the complete policy to the exact selected source identities, mapping editions, their corrections and all supporting-file identities. A subsequent selected-source/mapping/cell/supporting-file change makes earlier policies stale. Reattest through a new saved policy edition after reviewing the changed selection; the earlier full declaration remains in history. Saving another policy does not alter the source basis.

Rollforwards compare actual opening + signed movements in (opening_date, closing_date] with actual closing. Missing balances remain missing. The selected event file and explicit complete-event attestation are required before a zero movement total is accepted. Only named movement measures are included; a derived carrying-value measure does not require invented movement records.

Controls compare the actual selected balance population with its independent control row at the same company/book/currency/as_of/measure. The independent population completeness declaration is required. Partial populations remain UNCONFIRMED. Missing controls and absent populations remain explicit.

Carrying equations apply only the selected source-defined components and signs. For example, cost may already include impairment; configure the actual book basis instead of automatically subtracting impairment twice. The engine imposes no default equation.

Journal debit and credit totals are grouped by exact company/book/journal/currency. Each result retains every original line ID and posting date. Every schedule preserves original row IDs, exact operands and difference. MATCH, DIFFERENCE, UNCONFIRMED, STALE_BASIS, MISSING, AMBIGUOUS and INVALID remain distinguishable. Overall ready requires no source/target differences, no errors and confirmed financial schedules.

## Complete supporting originals

Import original XLSX, audit logs, data dictionaries, policy documents, attachments and other exit material through importSupportingFile. It retains the complete binary bytes, original filename/media type, purpose, byte count and SHA-256. The raw spreadsheet stays alongside any explicitly converted CSV; no spreadsheet conversion is inferred.

These files participate in the declared financial basis. The full handover writes every binary member under supporting/ with its original complete bytes. Its manifest and workspace preserve original filenames even when a safe archive path uses a sanitized name. Original document and CSV histories remain portable together.

## Engine API

engine.mjs imports {sha256Utf8,sha256Bytes} from ./sha256.mjs. Both modules have complete local source and no network dependency.

createWorkspace({id,title,createdAt}) returns a new complete workspace.
Every mutation accepts operationId and expectedRevision, plus an optional actual at timestamp, and returns {workspace,receipt,replayed}. Save the full request before invoking it; the identical request/operation ID reopens the original receipt, while changed input under the same ID fails.

- importCsv(ws,{operationId,expectedRevision,at?,observedAt?,role,domain,filename,text})
- saveMapping(ws,{operationId,expectedRevision,at?,role,domain,sourceId,columns,amount_multiplier})
- saveCorrection(ws,{operationId,expectedRevision,at?,sourceId,rowId,column,value,reason,actor})
- saveFinancePolicy(ws,{operationId,expectedRevision,at?,policy})
- importSupportingFile(ws,{operationId,expectedRevision,at?,filename,mimeType,purpose,base64})
- validateWorkspace(ws), financeBasis(ws), reconcile(ws)
- exportWorkspace(ws), importWorkspace(completeJSON)
- buildHandover(ws), parseCsv(text), encodeCsv(rows), templateCsv(domain), decimal(token)

All source and operation histories are validated against their original complete effects. Recomputing an outer JSON hash does not allow deleting a mapping, correction, financial declaration or supporting original created by a retained operation.

reconcile returns {workspaceId,revision,ready,issues,domains,comparisons,financial,summary}. Selected rows retain rowId, record, composite key, values, rawValues, complete cells and valid. financial contains exact basis_sha256, current policies with basisCurrent, rollforwards, controls, equations, journals and confirmed. Summary sourceRows/targetRows count the complete selected domain rows.

buildHandover returns complete files plus a manifest. Text members have {path,type,text,bytes,sha256}; binary members have {path,type,base64,bytes,sha256}. The manifest lists member identities without duplicating their bodies. workspace.json retains the complete reopening state, review-history.json retains declarations and operations, and reconciliation.json retains every finding and financial result.

## Node CLI

Use an existing Node installation and absolute paths. No package installation or network service is required.

```sh
node cli.mjs templates --out /absolute/empty-templates
node cli.mjs init --workspace /absolute/migration/workspace.json --id migration-original-001 --title "Original financial migration" --at 2026-10-13T14:00:00.000Z
node cli.mjs import --workspace /absolute/migration/workspace.json --request /absolute/requests/import-assets.json --csv /absolute/originals/assets.csv
node cli.mjs map --workspace /absolute/migration/workspace.json --request /absolute/requests/map-assets.json
node cli.mjs correct --workspace /absolute/migration/workspace.json --request /absolute/requests/correct-cell.json
node cli.mjs policy --workspace /absolute/migration/workspace.json --request /absolute/requests/review-basis.json
node cli.mjs supporting --workspace /absolute/migration/workspace.json --request /absolute/requests/import-dictionary.json --file /absolute/originals/data-dictionary.xlsx
node cli.mjs inspect --workspace /absolute/migration/workspace.json
node cli.mjs reconcile --workspace /absolute/migration/workspace.json --out /absolute/results/revision-26.json
node cli.mjs handover --workspace /absolute/migration/workspace.json --out /absolute/results/handover-revision-26
node cli.mjs receive --workspace /absolute/independent/workspace.json --input /absolute/results/handover-revision-26/workspace.json
```

Import request JSON has the same mutation metadata as the engine, with text supplied by --csv. Supporting request JSON has filename, mimeType and purpose, with base64 supplied from the exact --file bytes. Map, correct and policy commands consume their complete saved engine request directly.

The CLI owns one workspace lock recording host, PID namespace, boot identity, PID and token. It writes candidates in the destination directory, flushes them, atomically replaces the original workspace only when its prior bytes still match, and cleans interrupted candidates on ordinary errors. recover-lock requires the exact saved token and original host/PID namespace; a still-present process cannot be displaced.

Complete handover members publish create-only and resume only when already-written bytes match. Receiving into an existing destination preserves a matching current descendant instead of replacing later work with an older package. A different branch requires an independent destination. Inspect the returned revision and original receipt after an interrupted parent process before repeating a request.

## Limits and actual receiving

Validation ceilings are 32 MiB per original CSV, 100,000 data records, 512 columns, 1,000,000 characters per cell, 128 retained CSV sources, 128 supporting originals of at most32 MiB each, 10,000 complete operations and 128 MiB for the entire portable JSON including original bytes and history. They are selection limits, not measured throughput guarantees. Large selections should be explicitly scoped before import; never truncate a source or strip its history to force a result.

The complete source was exercised through its real pure JavaScript engine with a labelled six-domain receiving example: source/target scale1000/1, exact signed movements, independently stated balances/controls, explicit carrying equation, decimal journal totals and original binary bytes. The maintained native browser course is the next actual operator exercise. Use an existing equipped receiver and the original programme, not a duplicate controller.

Before a client/prospect receives any outgoing application or attachment, the producing peer must open/run/render the exact version, LOOK at the result and use it as a recipient would. View the actual desktop/mobile screenshots, full report pages, binary attachments in their normal viewer, usable ZIP contents and reopened working exports. Operate the important controls and fix visible defects. Source review, schemas, HTTP200, DOM counts and tests cannot replace this. Use the original saved runtime and preserve prior work. Do not add broad test sweeps, a review bureaucracy or another permission gate.


## Complete issuer-reference consumer

The issuer companion receives a complete original source package or saved source Canvas, selects its edition and supporting originals, and records attributed decisions against exact source and returned-target mappings. Public aggregate accounting references stay separate from actual private financial rows. All original members, selected policy/evidence decisions, changed-mapping findings, complete readable report and a working standalone application travel through the same full Exit. Read [ISSUER_REFERENCE.md](ISSUER_REFERENCE.md) for the whole browser/CLI/replay/receiving contract. The six-domain engine remains unchanged.


## Work-order migration companion

The complete browser and CLI now include original order/cost intake, exact destination allocation, actual returned-export matching, rehearsals, acceptance and source-retaining handover. Start with [WORK_ORDER_OPERATING.md](WORK_ORDER_OPERATING.md). The original six-domain financial reconciliation and working-copy recovery remain the same product. An actual published Port of Bellingham capital-class reference is under examples/port-bellingham-2025/.


## Complete offline application source

The maintained standalone builder embeds the full declared application, including Business Central/Dynaway source preparation and the Microsoft accounting contract. The existing browser and CLI handover retain it under application/ beside the unchanged original workspace and issuer/financial/work-order outputs. Start with [APPLICATION_DELIVERY.md](APPLICATION_DELIVERY.md); that guide covers source preparation, independent reopening, rebuild commands and the offered50,000-line scope with10,000-row review batches. Missing customer data and actual visual receiving remain explicit.


## Reviewed source-to-target asset identities

Use the existing **Asset identity crosswalk** desk for explicit one-to-one original asset and book correspondences, hierarchy checks and exact mapped financial comparisons. Original identifiers, amounts, journals and work-order allocation remain unchanged. [ASSET_CROSSWALK.md](ASSET_CROSSWALK.md) gives full browser/CLI, supersession, handover and original receiving instructions. The complete application and CLI export this companion and every source member.


## Named rehearsal editions

[Rehearsal review](MIGRATION_REHEARSALS.md) captures the complete original financial, work-order and crosswalk observations at a named revision, compares actual returned editions with exact scoped decimal differences, and restores the original historical workspace independently. The browser, CLI, full handover and copied application retain all original edition records and reports.
