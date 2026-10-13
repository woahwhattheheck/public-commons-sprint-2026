# Budget performance and period reporting

Open **Delivery operations → Budget performance** to review a reporting period against the case's pinned budget. The desk brings original work, issued invoices, payment allocations, supplier refunds and recorded asset quantities into one management report. It uses the same saved case as Invoices, Work, Cash, Forecast, Portfolio and Customer installations.

The report includes opening, period and closing positions; work-package and cost-category budgets; contributor and supplier activity; invoice aging; original cash and work rows; and the pinned planner's dated cash assumptions. **Export complete handover** delivers every report row, a readable offline report and the complete original operating case. Importing that handover opens the original case with the same reporting dates.

## Review a period

Choose a start and end date, or select **All dates through end** for a cumulative report. **Current month** restores the local calendar's first day through today. Both boundaries are inclusive.

The main figures show period invoices, net period invoice payments, closing open invoices, closing supplier credits, period accepted hours and closing net recorded cash. The opening/period/closing table explains the movement between those positions. A negative period invoice-payment amount represents net supplier refunds.

Use the breakdown selector for:

| View | Operator work |
| --- | --- |
| Work packages | Compare the complete pinned package budget with invoices issued through the closing date, remaining budget, period and cumulative payments, recorded hours and accepted hours. |
| Budget categories | Read the same package totals grouped by the original cost category. |
| Contributors and suppliers | See each retained contributor's work, invoice activity, cash allocations, open liability and credit position. |
| Invoice positions | Review original invoice number, supplier, state, issue/due dates, original line source, opening liability, period invoices, payments, open amount and credit. |
| Recorded work | Inspect original work dates, full recorded hours, package and contributor links, funding basis and current review state. |
| Cash observations | Inspect original currency, asset, network, quantity, valuation, direction, category, payment reference and source documents. |
| Period activity | Follow each date with recorded work, invoice issuance or cash activity, including the running net recorded cash position. |

Search matches the complete original row, including record identities and source references. Cash and work views can show either the selected period or every row through its closing date. Browser pages contain 50 rows; the report JSON and exported CSV files contain the full result. The management totals always describe the complete selected report.

The invoice-aging section groups closing unpaid liabilities by their original due dates: not due, due today, 1–30, 31–60, 61–90, over 90 days and undated. Disputed invoices retain their liability and remain identifiable. The same section links back to the original Invoices, Work and Cash editors for corrections or further recording.

## How the amounts are calculated

The case version identifies the record states used by the report. Dates select business activity from those records. A later correction, void, work acceptance or new source observation produces a new report when the case advances. Retain an exported report when the previously issued edition must stay available.

| Measure | Original basis |
| --- | --- |
| Opening | All included business dates before the selected start. With no start, opening is zero. |
| Period | Activity from start through end, inclusive; the movement in a balance is closing minus opening. |
| Closing | All included business dates through the selected end. |
| Recorded work | The complete original hours are recognized on the work's end date. Accepted hours use the current retained ACCEPTED state. |
| Work spanning the period start | Its complete recorded hours belong to its original end date; the source row is marked as spanning the start. |
| Invoice liability | The original invoice amount is recognized on its issue date. Current VOID invoices have zero liability. |
| Invoice payments | The original cash date and invoice allocation determine recognition. Outgoing allocations increase net paid; incoming supplier refunds reduce it. |
| Open liability | The positive part of issued liability minus net allocated payments. |
| Supplier credit / prepayment | The positive part of net payments minus issued liability. Earlier payments against a later-issued invoice remain visible as prepayments. |
| Work-package payment allocation | The original Operations exact-cent line allocator distributes each observed payment or refund by retained invoice-line amounts. Every original payment retains its own rounding. |
| Remaining budget | Complete pinned package budget minus invoices issued through closing. |
| Remaining planned hours | Pinned estimated hours minus recorded hours through closing. |
| Period planning comparison | Difference between the pinned planner's cumulative daily amounts at closing and immediately before opening, using the operating case's calendar anchor. |

Budgets are complete package amounts. Hours are operational quantities. The report keeps invoiced cost, recorded work and actual cash as separate measures, so a recorded hour does not become an invented cost and a work acceptance does not become a cash observation.

All financial calculation uses Python Decimal and the existing original line allocator. Decimal strings are preserved through JSON, CSV and the browser. Browser money formatting avoids conversion through binary floating-point numbers.

### Currencies and recorded cash

The USD report uses each original recorded USD valuation. Original asset quantities remain grouped by currency, network and asset, with opening, period and closing quantities. Rows without a USD valuation remain in the original asset tables and appear in the valuation work list. Original testnet rows remain visible with their source basis and follow the same exclusion from operating cash used by the existing Operations report.

The net recorded cash position is the sum of retained inflows and outflows. An actual opening account balance can be entered through the original Cash workflow when its source exists. Forecast capital inputs and conditional grant funding stay in the pinned planning comparison.

## Export and reopen the complete work

Select **Export complete handover** after reading the report. The export is tied to the report's exact case version and report identity. If the case changed during review, refresh the report and export the current selected edition.

The ZIP contains:

| File | Contents |
| --- | --- |
| report.html | Offline management report with cash positions, package and contributor performance, invoice aging and source invoice positions. |
| report.json | The entire selected report, source identities, attention items, native asset quantities and all original rows. |
| period.json | Reporting dates and business-recognition basis. |
| packages.csv | Complete package budgets, invoice/payment movement and work hours. |
| contributors.csv | Complete contributor/supplier activity and closing positions. |
| invoices.csv | Every relevant original invoice and closing balance. |
| work.csv | Every original work record through closing, with period and spanning-date flags. |
| cash.csv | Every original cash observation through closing, its period flag and USD inclusion basis. |
| daily-activity.csv | Every date with selected original business activity. |
| operations-case.zip | The complete original case: planning source/history, operating records/history, original attachments, installations, forecasts, portfolios and reviews. |
| MANIFEST.json | The original member list, exact file sizes and hashes. |
| README.txt | Receiving and continued-operation instructions. |

On a receiving installation, choose **Import complete case**, select the complete performance ZIP, enter the receiving operator and save with the original import request ID. The importer reads the full original case and selected report together, preserves all source history and opens **Budget performance** at the received dates. Repeating the same completed request returns its existing import receipt.

The receiving workspace assigns its own local case and plan identities. Its origin retains the original performance selection, source case/version and issued report identity. The supplied offline report remains the original issued edition. Further work proceeds in the receiving case through the usual Work, Invoices, Cash and Installation controls.

The inner operations-case.zip is also a standard complete case that an older Grant Operations release can receive. The report files remain readable independently.

## Command line

Use the existing grant-workspace launcher. The following commands operate a saved case:

~~~sh
starforge grant-workspace operations --workspace /absolute/private/grant \
  performance --case ORIGINAL_CASE_ID \
  --start-date 2026-10-01 --end-date 2026-10-31 \
  --output /absolute/private/october-performance.json
~~~

Read the returned case.version and reportSha256 before exporting the same selection:

~~~sh
starforge grant-workspace operations --workspace /absolute/private/grant \
  performance-export --case ORIGINAL_CASE_ID \
  --start-date 2026-10-01 --end-date 2026-10-31 \
  --expected-version ORIGINAL_CASE_VERSION \
  --expected-report-sha256 ORIGINAL_REPORT_SHA256 \
  --output /absolute/private/october-performance.zip
~~~

Omit --start-date to include all prior dates. The report command accepts --expected-version when a caller needs the result from a specific current version. The export requires the version and identity returned by the selected report.

Receive the complete ZIP through the existing import:

~~~sh
starforge grant-workspace operations --workspace /absolute/private/receiving \
  import --file /absolute/private/october-performance.zip \
  --name "Received grant operations" --actor "Receiving operator" \
  --request-id ORIGINAL_RECEIVING_REQUEST
~~~

A running managed Application retains the original workspace lock. Use its authenticated HTTP or Merchant client while it is running, or stop that Application through its existing lifecycle before opening the same workspace with the headless CLI.

## HTTP and typed client

The authenticated routes are:

| Method | Route | Selection |
| --- | --- | --- |
| GET | /api/operations/{caseId}/performance | Optional startDate, endDate and expectedVersion. |
| GET | /api/operations/{caseId}/performance/export.zip | startDate when selected; endDate, expectedVersion and expectedReportSha256 from the report. |
| POST | /api/operations/import | Existing complete-case import; accepts the full performance handover. |

The report response schema is stellar-forge.sf47-performance.v1. An omitted HTTP endDate uses the server's current calendar date. Automated callers should supply the intended endDate explicitly.

The existing GrantWorkspaceClient supports:

~~~js
const response = await client.read('performance', {
  caseId,
  startDate: '2026-10-01',
  endDate: '2026-10-31'
});
const report = response.value;
const handover = await client.download('performance', {
  caseId,
  startDate: report.selection.startDate,
  endDate: report.selection.endDate,
  expectedVersion: report.case.version,
  expectedReportSha256: report.reportSha256
});
~~~

Use the client's existing returned bytes and download fields to retain the complete handover. Its original importBundle('case', bytes, fields) accepts the same full ZIP.

Merchant MCP exposes merchant_grant_performance with workspace, caseId, startDate, endDate and optional expectedVersion. The existing merchant_grant_export accepts kind: performance and the same dates plus expectedVersion and expectedReportSha256. Original snapshots, byte paging and receiving remain with the existing Merchant transport.

## Installed source

The maintained grant-operations source selection already includes the full SF47 workspace component. The added engine, browser module, CSS and guide travel with that original component. Both managed source readers include the engine and mounted browser assets so launch, restart and receiving select one complete operating edition.
