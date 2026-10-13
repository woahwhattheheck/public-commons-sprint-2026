# Work-order allocation and returned-export handover

The Work orders and costs desk is part of the existing Fixed Asset Finance workspace. It retains the original asset/book/balance/event/journal/control engine, the same browser working-copy recovery, the same CLI locks, the same operation IDs and the complete editable handover. It adds the operational migration needed to reconcile work-order history, labor, material and expense costs to actual returned target records.

## Complete operating sequence

1. Open the complete standalone working HTML. In Work orders and costs, import the original work-order header CSV and cost CSV as **source**. Choose orders/costs and save the reviewed field mappings. Original UTF-8 bytes, a leading BOM, duplicate column headings and extra vendor fields remain retained.
2. Use the actual company and work-order IDs. A cost line has its own line ID and kind: labor, material or expense. Preserve a maintenance asset ID separately from its financial fixed-asset ID. Supply the source currency and an explicit cost basis such as actual, expected or budget. A missing amount is missing; quantity multiplied by an expected unit price is not an actual posted cost.
3. Correct source cells through the original-cell form with the reviewer and reason. Original bytes remain unchanged. Importing a later complete source creates a separate retained edition; select it and map its columns explicitly.
4. In Allocation, review every original cost. An unchanged cost begins as one complete destination. Split it into explicit destination order/asset/project/task/dimension rows when the migration requires it. The signed amounts must exactly sum to the original amount, including negative corrections. Quantities must independently sum in their original unit. The same company, currency, cost basis and kind remain fixed.
5. For a large schedule, download expected-allocations.csv, retain source_row_id and allocation_id, edit the complete allocation rows and import the reviewed CSV. One operation supports up to 10,000 allocation rows. Every batch remains one original journal operation with its original CSV and review context.
6. Import the actual returned target headers as target/orders and save their actual column mapping. In Header readback, match each original header to one actual returned header. Review any intended destination identifiers or fields explicitly; supplied source status, dates, location, assets and description are compared. Both unmatched source headers and extra returned headers remain differences. A reviewed CSV schedule can apply up to10,000 header matches with source_row_id, target_row_id and optional expected_ destination fields. Then receive the actual target cost export as **target**, map its actual columns, and select each returned row for its expected allocation. A supplied expected posting date is compared explicitly; any intended change is a reviewed destination correction. Several returned entries can make one allocation; a returned entry cannot fund two allocations. The comparison checks explicit company/order/asset/fixed-asset/project/task/dimensions/currency/basis/kind/unit and exact amounts. It never matches descriptions or treats a maintenance-plan number as a work-order ID.
7. For bulk reviewed matching, import a CSV with allocation_key and target_row_id. Repeat an allocation key for multiple actual returned entries. An empty returned ID clears that allocation's old match. Previously selected source editions, allocations and matches remain in the original event history.
8. Record each actual rehearsal reference and its current result. Source errors and open differences remain in that rehearsal. Accept only after the complete currently selected source and returned population reconcile. A subsequent selection, mapping, correction, allocation or match change makes the old acceptance historical automatically.
9. Complete the original Financial basis and Reconciliation workflow against actual FA/GL exports. Work-order cost acceptance and financial book closure are separate results. Confirm the final financial basis after all source and supporting changes, because the original finance engine binds the retained supporting population.
10. Save working HTML and download the complete handover ZIP. Reopen the received working HTML or workspace JSON as an independent working copy. The archive includes original/corrected vendor CSVs, canonical selected source/target rows, expected allocation CSV, complete comparisons, review history and every original operation.

## What a source must retain

Orders require company_id and work_order_id. Optional original fields include asset_id, fixed_asset_id, location_id, description, status, opening/closing dates, native record ID and source reference.

Costs require company_id, work_order_id, line_id, line_kind, currency, cost_amount and cost_basis. Keep quantity and unit_code together when present. Preserve asset_id, fixed_asset_id, project_id, project_task_id, dimension_set_id, dimension_1, dimension_2, posting_date, native_record_id, native_document_id and source_reference when the selected export supplies them. Additional columns survive in the original and corrected CSVs.

Destination amounts use exact decimal strings with no floating-point accumulation, grouping or automatic rounding. Every total stays inside company/currency/basis/kind. No exchange rate, unit conversion, capitalization or provider posting is inferred.

## Business Central and Dynaway

Use the accompanying integrations/business-central source contract with the actual tenant's API Overview and metadata. The standard Business Central fixed-assets resource is a master interface; financial books, balances, events and posted journals come from their actual exports. Dynaway distinguishes maintenance assets from financial fixed assets and supports a many-to-one relationship.

A native work-order line's id and documentId preserve line/header identities. The documented woLedgerEntries sample has a maintenance plan number but does not establish a complete order ID plus actual labor/material cost contract. Keep those fields missing until a selected native export or supported extension supplies them. The supplier executes actual service writes, posting and closing in the selected environment.

## Original operation and recovery contract

Each work-order mutation is an immutable supporting JSON file committed through engine.importSupportingFile in the original workspace. The chain binds workspace identity, prior event, sequence, action, original request hash and operation ID. All source bytes are stored once in their import event. Later mapping, correction, allocation and matching events preserve their own original inputs.

Repeating the same operation ID and complete request returns its original receipt. Reusing an operation ID for changed input is rejected. A stale workspace revision is rejected before a new event is saved. The original browser competing-tab recovery and CLI workspace locks remain authoritative.

The original limits still apply: 32 MiB per complete input/supporting file, 128 MiB complete workspace, 100,000 CSV data rows, and 128 retained supporting files. Batch complete reviewed allocation/match schedules to avoid one journal event per individual line. Export the full completed project before opening a separately named migration scope. No original source is silently truncated or dropped.

## CLI

All paths are absolute. Requests carry operationId, expectedRevision and a fixed at timestamp. Preserve the same saved request on retry.

    node cli.mjs wo-import --workspace /project/workspace.json --request /project/import-orders.json --csv /project/orders.csv
    node cli.mjs wo-map --workspace /project/workspace.json --request /project/map-orders.json
    node cli.mjs wo-correct --workspace /project/workspace.json --request /project/correction.json
    node cli.mjs wo-allocate --workspace /project/workspace.json --request /project/allocation.json
    node cli.mjs wo-allocate-batch --workspace /project/workspace.json --request /project/allocation-schedule.json --csv /project/allocations.csv
    node cli.mjs wo-order-match --workspace /project/workspace.json --request /project/header-match.json
    node cli.mjs wo-order-match-batch --workspace /project/workspace.json --request /project/header-schedule.json --csv /project/header-matches.csv
    node cli.mjs wo-match --workspace /project/workspace.json --request /project/match.json
    node cli.mjs wo-match-batch --workspace /project/workspace.json --request /project/readback-schedule.json --csv /project/matches.csv
    node cli.mjs wo-report --workspace /project/workspace.json --out /project/reconciliation-rev-14.json
    node cli.mjs wo-rehearsal --workspace /project/workspace.json --request /project/rehearsal.json
    node cli.mjs wo-accept --workspace /project/workspace.json --request /project/acceptance.json
    node cli.mjs handover --workspace /project/workspace.json --out /project/handover-rev-16

Use wo-select for a retained sourceId; wo-inspect returns all selected work-order state. wo-templates emits empty orders/costs templates. The ordinary receive command validates and reopens the complete original workspace, including every work-order supporting event.

## Receiving the actual product

Bryce's standing October13 instruction applies to this complete edition. Open and visually inspect the exact outgoing standalone HTML at screenshare and narrow widths, operate the populated and empty source/mapping/allocation/readback/review controls, save and reopen the working HTML, and open the actual downloaded archive and files. Inspect the original finance screens too because the same application carries both workflows. Fix actual presentation or operation failures before calling the edition customer ready.

The retained focused source exercise covers original journal replay, exact two-way cost/quantity splitting, actual selected returned-row matching, acceptance, full workspace export/reopen and a changed returned amount invalidating the prior basis. It is an internal developer fixture. The Port's published-capital reference uses actual issued financial values and remains a separately identified aggregate source population. Customer migration receiving uses actual authorized source/target exports.
