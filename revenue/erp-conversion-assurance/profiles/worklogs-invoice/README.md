# Worklogs invoice implementation

This profile connects complete Worklogs time exports to a customer's actual invoice export. It uses the original retained reconciliation service and conversion workspace: exact amounts, full key-set comparisons, versioned reviews, linked corrections and complete replay handovers.

The preparation step keeps the original workbook or CSV, invoice file, approved billing contract and every worklog. It derives expected invoice lines under that contract, then receives the result in the existing application.

## Requirements and start

Use Linux, Python 3.11+, Node.js 22+, and the original repository checkout with `flock` and `tar` in PATH. There are no Python or npm dependencies for preparation, receiving, the service or the operator browser. Keep customer work in a private directory outside the source checkout.

Run this complete authored example from the repository root:

~~~sh
umask 077
python3 revenue/erp-conversion-assurance/profiles/worklogs-invoice/example.py \
  --output /absolute/private/worklogs-example
~~~

The destination must be new; its parent must exist. The example creates real XLSX source files, a first invoice, its linked correction and a second period. It runs all three through the actual original application/service/engine, records the reviewer decisions, exports complete replay packages and reproduces each original report. It writes `receiving.json` and prints the command to open the same customer directory in the original browser.

| Edition | Expected time and net | Original invoice | Comparison |
|---|---|---|---|
| September first | 27,900 seconds; USD 870.00 | 27,000 seconds; USD 840.00 | FAIL; missing 900 seconds and USD 30.00 on Engineering |
| September correction | 27,900 seconds; USD 870.00 | 27,900 seconds; USD 870.00 | PASS; linked to the first September job |
| October | 29,700 seconds; USD 930.00 | 29,700 seconds; USD 930.00 | PASS; a separate complete period |

These are authored operator examples. The original source export headers, billability values, rates and invoice grain for a customer are selected from its own files.

## 1. Inspect the original export

~~~sh
python3 revenue/erp-conversion-assurance/profiles/worklogs-invoice/prepare.py \
  inspect /absolute/private/detailed-worklogs.xlsx
~~~

For XLSX, inspect the actual worksheet names and choose the detailed row-level sheet and actual header row. The reader handles shared strings, inline strings, sparse cells and the workbook's 1900/1904 date system. CSV supports UTF-8, an optional BOM and quoted multiline fields. Use the file's complete customer-authorized period.

Copy `contract.example.json` to the private customer directory and replace its example entries:

| Contract field | Decision recorded |
|---|---|
| `owner`, `period` | Named billing-rule owner and one complete calendar month |
| `currency`, `currency_scale` | One currency and its agreed decimal scale |
| `worklogs.sheet`, `header_row`, `columns` | Actual worksheet and literal source headers |
| `worklogs.duration_unit` | seconds, minutes, hours, hh:mm, hh:mm:ss or Excel day fractions |
| `worklogs.date_encoding` | ISO date/timestamp or Excel serial; choose the time zone for timestamps |
| `billable_values`, `nonbillable_values` | Exact customer-approved exported values |
| `rates` | Explicit customer and service-line hourly rates |
| `rounding`, `round_at` | HALF_UP or HALF_EVEN; invoice-line or individual-worklog rounding |
| `invoices.columns`, `duration_unit` | Actual invoice headers, selected line identity, time units and net amount |

The included contract illustrates one format. Worklogs exports vary by selected report configuration; the implementation selects the observed headers instead of assuming a vendor-wide schema.

The logical invoice line key is customer, currency, period and service line. Choose the service line so each target row is unique at that grain. If an invoice system has multiple distinct billable lines per service, map an approved more specific line identifier and its rates. Taxes, credits and downstream posting follow their own agreed scope.

Stable original worklog IDs support comparisons between editions. If the selected export has no stable identifier, explicitly choose `identity: "source_row"`. The reader keeps every physical row and records that cross-edition identity is unavailable. It never removes repeated rows as an inferred duplicate. The named owner decides the selected invoice and identity grain.

## 2. Prepare complete time and invoice files

~~~sh
python3 revenue/erp-conversion-assurance/profiles/worklogs-invoice/prepare.py \
  prepare --worklogs /absolute/private/detailed-worklogs.xlsx \
  --invoices /absolute/private/invoices.csv \
  --contract /absolute/private/billing-contract.json \
  --output /absolute/private/september-first
~~~

The new private output directory contains:

- Original complete worklog and invoice files, billing contract, exact preparation code and selected profile.
- `expected-invoice-lines.csv` and `actual-invoice-lines.csv` for the original engine.
- `worklog-lineage.csv`, linking each retained time record to its physical source row and original billability value.
- `worklog-coverage.csv` for stable-ID comparisons between source editions.
- `nonbillable-time.csv`, preserving time excluded from charges.
- `preparation.json`, recording file identities, row counts, time, net charges, units, rounding and cross-edition identity support.

The reader rejects incomplete mapping, ambiguous values, unsupported formulas, unknown billability, missing rates, duplicate stable worklog IDs, out-of-period rows and unsupported time precision before emitting a complete preparation. A workbook formula is admitted only when its cached value is explicitly accepted in that file's contract settings. Files are limited to 32 MiB each, expanded XLSX content to 64 MiB, 200,000 rows and 1,024 columns. Configure the original retained service's limits for the agreed full export size.

## 3. Receive in the original application

~~~sh
node revenue/erp-conversion-assurance/profiles/worklogs-invoice/receive.mjs \
  --prepared /absolute/private/september-first \
  --directory /absolute/private/customer-invoice-review \
  --job-id september-first
~~~

Receiving verifies the entire preparation inventory before using its bytes. It retains the billing owner, month, currency, exact original source and contract identities, and time-lineage identity in the original workspace mapping. Repeating the same job with the same complete preparation reopens it. A different preparation requires a new job ID.

Completed PASS exits 0 and completed comparison FAIL exits 2. Both are delivered comparison results. An accepted active job remains available through the original operator after the command's 60-second observation window.

Open the original browser:

~~~sh
node revenue/erp-conversion-assurance/scap-workspace/cli.mjs \
  --directory /absolute/private/customer-invoice-review \
  --profile /absolute/private/september-first/workspace-profile.json \
  --port 0
~~~

Use the complete private localhost URL printed by the launcher. **Runs & review** opens the original jobs, exact totals, paginated line and group findings, previous corrections and retained decisions. Record the named invoice owner's decision against the exact report. Keep the full preparation directory alongside the service root so each invoice line can be traced back to the raw workbook rows and rate contract.

## 4. Receive a linked correction and the next period

Prepare the corrected complete source/invoice edition in a new directory. Then:

~~~sh
node revenue/erp-conversion-assurance/profiles/worklogs-invoice/receive.mjs \
  --prepared /absolute/private/september-correction \
  --directory /absolute/private/customer-invoice-review \
  --job-id september-correction --previous-job-id september-first \
  --correction-reason "Restore the missing approved Engineering time."
~~~

The original application stages an immutable revision, records its preceding job and preserves the first report and its review. A linked correction keeps the same period and currency. A new month uses a separate complete preparation and a new job ID without a preceding-job argument.

For changed time exports with stable IDs, select **Worklog coverage and correction** in the same browser. Choose the two complete `worklog-coverage.csv` files, map matching column names and compare the original seconds and attributes. Added, removed or changed time remains visible before invoice approval.

## 5. Review and transfer ownership

In **Runs & review**, the invoice owner records an accepted or changes-requested decision with the original report. Download its complete private replay bundle. Deliver that bundle together with the original preparation directory, the configured source and this guide.

The receiving operator:

1. Opens the original raw inputs and approved contract, and follows a selected invoice line to its time records.
2. Reopens the first discrepancy report, the linked correction and the next complete period.
3. Locates the named reviewer's retained decision.
4. Extracts the replay into a private directory and runs its original `replay.mjs`.
5. Reopens the customer service root using the original browser command.

Each replay contains the exact source, target, mapping, original comparison engine, report, reviews and customer HMAC key. Keep that complete package on the agreed private route. The standalone replay checks each file and compares all report content except its fresh generation timestamp. A matching PASS exits 0; a matching delivered FAIL exits 2. The receiving example demonstrates both.

The [original service guide](../../service/README.md) explains complete exports, cancellation, recovery and resource configuration. The [workspace guide](../../scap-workspace/README.md) covers mapping, record/group findings, review revisions and browser handover.

## Source fit

The official [Worklogs product](https://soldevelo.com/products/worklogs-time-tracking-time-reports-timesheets-soldevelo/) supplies time tracking, reporting, worklog attributes and exports. The [export guide](https://soldevelo.com/blog/how-to-export-jira-worklogs-to-a-spreadsheet/) describes detailed and grouped spreadsheet reporting. This profile implements the customer's billing-rule and invoice receiving workflow around its chosen exports. Original components retain their existing licenses; the new profile source uses MIT.
