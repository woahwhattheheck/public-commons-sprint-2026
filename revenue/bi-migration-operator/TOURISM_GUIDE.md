# Tourism funding and reporting

This is an operating section of the existing Commons BI Operator. It uses the
original workspace, revision history, operation journal, file store and
encrypted recovery. The Tourism reporting screen carries a source file through
mapping, review, fund setup, forecast preparation, report review and complete
export.

The principal deliverable is a finalized reporting package: an eleven-sheet
workbook, eleven CSV schedules, a printable HTML report, the annual plan, the
exact prepared report and all selected original source editions. Each file has
a byte count and SHA-256 entry in the package manifest.

## Start and open the working example

Install the application's original requirements and start its existing host:

```sh
python -m pip install -r requirements.txt
python BI_OPERATOR.py --workspace ./tourism-workspace serve
```

Open the complete private address printed by the application. Select **Tourism
reporting** and **Open Overland Park working example**. The same example can be
opened from the original command-line interface:

```sh
python BI_OPERATOR.py --workspace ./tourism-workspace tourism-example
```

The example uses the same source, fund, plan and period actions available to
staff. Each step has a stable original operation ID. Opening it again finds its
existing report, including any later review or finalized edition.

The example contains actual published source values: 26 monthly Kansas
Department of Revenue observations from July 2024 through August 2026, ten
separate distribution controls, and four original VisitOP budget columns.
Its reporting year begins January 2026, with collections known through August.
Its opening fund balance is an explicitly recorded proposed-budget planning
input. There are no operator cash, lodging or event-demand rows in the public
packet. Import the relevant original operating sources when using those parts
of the application.

The example opens a **PREPARED** report. Inspect the source differences, record
your review, and finalize that exact report edition to produce the package.

## 1. Retain and review original sources

In **Sources**, select a complete CSV file or a tourism source JSON packet.
Choose a label, currency and number of currency decimal places. A CSV also
needs its source-table type and column mapping. The screen shows the actual
CSV header and offers a column selector and shared value for each field.
A shared value can supply a jurisdiction, fund, provider or other constant
without editing the original CSV.

Use **Retain source for review**. The application keeps the complete original
bytes, its SHA-256, the field mapping and the normalized rows. Open the retained
table and page through its rows before accepting it. Amounts in normalized
tables are integer currency minor units; the original file retains the source's
decimal values and formatting. Accept the source with a note describing the
review or its original publication basis.

A correction is a new source record. Select its predecessor and explain the
change. Earlier source records remain available to existing plans and reports.
When replacing an overlapping monthly series, choose the intended edition
rather than selecting both the old and replacement series.

### Source tables

| Table | Operating meaning | Required source fields |
| --- | --- | --- |
| collections | Published monthly net or gross collection series | period, amount, jurisdiction, basis |
| distributions | Published payment or distribution controls over a stated window | start, end, amount, jurisdiction, basis |
| cash | Actual selected operator fund entries | entry_id, date, direction, amount, fund, category, program |
| budgets | Original published budget columns | budget_id, year, status, jurisdiction, all eleven money fields |
| lodging | Original provider or licensed lodging observations | period, provider, market, and at least one metric |
| demand | Original event or demand assumptions | event_id, period, label, room_nights, basis |

Every table supports an original source reference. The application supplies
a filename and row reference when the source does not contain one. CSV header
templates are available in the screen and under
**examples/overland-park/templates**.

Monthly periods use YYYY-MM. Source currency is a three-letter code; monetary
precision supports zero through four decimal places. Net collections and
distributions can be signed when the original publisher reports a correction.
Cash uses a positive absolute amount plus an explicit direction.

A JSON source packet has this structure:

```json
{
  "schema": "commons.tourism-source.v1",
  "currency": "USD",
  "minor_unit": 2,
  "source_documents": [
    {"title": "Original source title", "url": "https://publisher.example/report"}
  ],
  "tables": {
    "collections": [
      {
        "period": "2026-08",
        "amount": "1528423.31",
        "jurisdiction": "OVERLAND PARK",
        "basis": "KDOR net collection (98%; state retains 2% administration)",
        "source_ref": "https://www.ksrevenue.gov/pdf/tgfy27.pdf#page=2"
      }
    ]
  }
}
```

The supplied public-source.json is a complete example. Duplicate JSON keys,
nonfinite values, unsupported tables, overlapping series and excess currency
precision are rejected. One source can contain up to 100,000 rows and 64 MiB
of original bytes. Reported monetary aggregates stay within the supported
exact integer range, so the browser and workbook retain their currency values.

### Cash and returns

Cash direction is one of:

- receipt: increases fund receipts;
- expense: increases fund expenditures;
- receipt_return: reverses all or part of an original receipt;
- expense_return: reverses all or part of an original expenditure.

A return must identify its original entry with original_entry_id. That entry
must belong to the same fund, have the matching direction and a date no later
than the return. The sum of selected returns cannot exceed the original
amount. Include a prior-period original entry when it is needed to validate a
current-period return; only entries in the selected reporting window affect
that window's cash totals.

Collections and the planning allocation do not automatically become operator
receipts. Record a receipt from its original fund ledger. The fund report
groups entries by category and program while retaining entry-level references,
counterparties and return links.

### Budget columns and lodging data

Budget status is ACTUAL, BUDGET, ESTIMATE or PROPOSED. Retain the original
column's year and meaning. The public packet maps the publisher's ESTIMATED
label to ESTIMATE and preserves the original label in its source inventory.

Budget fields are opening_cash, operating_reserve, tgt_income, other_income,
personnel, sales_marketing, administration, reported_resources,
reported_available, reported_expenditures and reported_closing. All values are
source currency amounts. The application compares original reported totals
with arithmetic from the original components.

Lodging inputs accept occupancy_pct, adr and available_rooms with their
provider, market and month. Event demand accepts a source-based room-night
assumption for a stated month. These original inputs remain visible in the
package. A forecast change is made through an explicit reviewed future-month
adjustment, with its own amount and source basis.

## 2. Save the reporting fund

In **Funds**, enter the exact source jurisdiction and the fund code used by
cash entries. Specify the currency, reporting opening month and the original
opening-balance basis.

**Opening cash includes the reserve.** Enter total opening cash once and
record the reserve component separately. The cash calculation is opening
cash plus net receipts minus net expenditures. It does not add the reserve
again as income.

The planning allocation is a numerator and denominator, with a written source
basis. It produces a planning schedule from the collection projection.
The source of an actual distribution or receipt is retained independently.

Save the fund. Updating it creates another revision; a prepared report keeps
the exact fund revision it originally selected.

## 3. Save the forecast plan and prepare the report

In **Forecast plans**, select an exact fund edition and accepted source
editions. Set the reporting start and the last month with known collections.
The reporting schedule spans twelve months. Its opening month must match
the fund opening balance.

Select one of the two supported methods:

- **Prior-year seasonality × recent ratio**: each remaining prior-year
  calendar month is multiplied by the ratio of the latest N known months to
  their exact prior-year counterparts. N can be one through twelve. Every
  comparison pair must exist and the prior-year denominator must be positive.
- **Prior-year seasonality × explicit growth**: each remaining prior-year
  calendar month is multiplied by one plus the entered growth assumption.
  This still requires the original prior-year monthly baseline.

Enter downside and upside changes in basis points. One hundred basis points
equals one percentage point. Each scenario equals the signed original
prior-year collection multiplied by the selected growth factor, plus the
absolute prior-year collection multiplied by that scenario's basis-point
change divided by 10,000, followed by the same explicit future-month
adjustment. Round the projection to the selected currency precision before
applying the adjustment. Positive published baselines retain the original
percentage-point calculation; a negative net correction keeps its sign in
the base while the named downside remains lower and upside remains higher.

For example, a published net correction of −110.38, zero growth, an explicit
200.00 future adjustment and −500/+500 basis points produce 84.10 downside,
89.62 base and 95.14 upside. The 200.00 is an operator assumption in this
example. The report retains this calculation rule alongside the selected
source and plan; these sensitivity ranges are not confidence intervals.

A future adjustment identifies its forecast month, signed currency amount,
calculation basis and original source reference. It applies after the seasonal
projection. There can be one adjustment per future month. If a signed
historical baseline produces a negative projected collection, the application
asks for an explicit assumption or adjustment decision while retaining the
published negative observation.

Select the published budget ID where applicable, and write the forecast
assumptions and annual plan. Save the plan, or use **Save & prepare report**.
The prepared report freezes the selected plan, fund, source editions and
calculated schedules in one retained report object.

### Reading the forecast

Observed months retain their actual source values. Missing observed months
remain marked MISSING. Future months show the source baseline and the
calculated base, downside and upside. Annual totals are available subtotals
when any observed month is missing.

Quarterly schedules group three months from the reporting-year start. Each
quarter identifies its actual start and end months, with the count of observed,
forecast and missing months.

The historical check performs one-month-ahead forecasts using earlier
calendar-month rows in the selected retained source editions. It does not
use a trial month's later observations for calibration. It retains every
comparison pair, forecast, actual and error. This describes historical error
on those source editions; it does not reconstruct archived publication
vintages.

Weighted absolute percentage error is total absolute error divided by the
sum of absolute observed values. The report also retains mean signed error.
An explicit event adjustment is excluded from this historical check.

## 4. Review and finalize

Open **Reports** and inspect:

- monthly and quarterly coverage;
- calibration pairs, growth sensitivities and historical error;
- independently published distributions and collection subtotals;
- every original budget status and arithmetic difference;
- selected operator cash, opening basis, reserve and returns;
- the annual plan and exact selected sources.

The review lists actual source differences. Acknowledge each listed item and
write the interpretation in the review note. This records the differences
without replacing the original figures.

**Save report review** creates a reviewed revision. **Finalize reviewed report**
requires that exact prepared report digest. Another caller's changed revision
must be reopened before it can be used.

A finalized report can be reopened with a reason. The new review revision
retains its prior finalized edition. To use a changed source or a new as-of
month, save a new plan and prepare a new report.

## 5. Export and receive the complete package

Use **Build complete reporting ZIP**, then download it from the finalized
packages table. Its workbook has eleven sheets:

1. Monthly forecast
2. Quarterly forecast
3. Distribution controls
4. Operator cash
5. Fund accounting
6. Published budgets
7. Historical forecast
8. Lodging sources
9. Demand sources
10. Source inventory
11. Operating assumptions

Each sheet is also available as a CSV. The package includes the printable
Tourism_Report.html, the annual plan, the exact report and finalized period,
the quarterly schedule, original source records and normalized data.

Original source bytes use their own **original/** directory within each source
edition. Source filenames such as record.json therefore remain distinct from
the retained record metadata. The package manifest inventories all member
bytes and hashes. The manifest does not inventory itself.

The original workbook and CSV exporters preserve currency cells and apply
their existing formula-safe treatment to source strings. The original JSON
and original source bytes remain available for exact data inspection.

Open the HTML report or workbook for receiving review. For continued editing,
use the existing **Handoff & recovery** page to create an encrypted backup of
the entire workspace. Restore it to a fresh directory using the original
application:

```sh
python BI_OPERATOR.py restore workspace.bi-backup ./received-workspace
python BI_OPERATOR.py --workspace ./received-workspace serve
```

The receiver keeps original business IDs, source bytes, accepted revisions,
prepared reports, finalized exports and operation history. The receiving
browser uses the new local address printed by its host.

## Original source references for the Overland Park example

- [KDOR Transient Guest Reports](https://www.ksrevenue.gov/prtgreports.html)
- [Fiscal Year 2025, page 2, OVERLAND PARK](https://www.ksrevenue.gov/pdf/tgfy25.pdf)
- [Fiscal Year 2026, page 2, OVERLAND PARK](https://www.ksrevenue.gov/pdf/tgfy26.pdf)
- [Fiscal Year 2027, page 2, OVERLAND PARK](https://www.ksrevenue.gov/pdf/tgfy27.pdf)
- [VisitOP 2026 budget, page 1](https://opkansas.civicweb.net/document/394189/2026%20VisitOP%20Budget.pdf?handle=83BD8E5FF7CC41358417C2DC49267ABC)
- [City tourism-services RFP](https://www.opkansas.gov/asset/caaf3671-312f-4d9b-a4bd-34e6e6045640)

KDOR labels these monthly tables as 98% collections after the state retains
2% for administration. The example applies no second administration deduction.

The VisitOP table presents cash and reserve as separate components and reports
year-end cash plus reserve. The example's proposed 2026 planning opening
therefore combines USD 808,780 cash with USD 293,000 reserve, for a
reserve-inclusive USD 1,101,780. The source remains labelled PROPOSED.

The original 2025 BUDGET closing total is USD 1 below its component arithmetic.
The original 2026 PROPOSED expenditure total is USD 1 below its components,
and its closing total is USD 1 above the corresponding component calculation.
Those values are preserved in the public packet and report review.

The RFP's historical two-ninths share is an explicit planning parameter. The
City's actual collection, appropriation, reporting and approval process
determines funding and delivery responsibilities.

## Structured action and receiving interface

The original host accepts structured actions at
**POST /api/action/ACTION**, authenticated with the original workspace bearer
token. A request's operation_id is a stable caller-owned ID; replay the same
body and ID after an interrupted response. Original operation conflicts and
revision checks protect an already saved outcome.

Actions are tourism.source.prepare, tourism.source.accept,
tourism.fund.save, tourism.plan.save, tourism.period.prepare,
tourism.period.review, tourism.period.finalize, tourism.period.reopen and
tourism.period.export. Each successful action performs one final write through
the original Store and returns its original record. Source files and calculated
objects are original content-addressed blobs.

Read original records and versions through **/api/entity**, **/api/history**
and **/api/state**. Tourism source rows and prepared reports are available
through **GET /api/tourism/preview** with kind, id and revision. Source pages
also accept table, offset and limit, with up to 500 rows per page. Read-only
example configuration is **GET /api/tourism/example**.

The complete native receiving journey is in
**tools/tourism_operating_journey.py** and its browser companion. Run it from
the complete source release using the existing installed Node, Chromium and
Python requirements. It operates the normal staff screens with the original
published packet, downloads the actual finalized export, creates an original
encrypted backup, restores a fresh workspace, replays the saved operation,
and reopens the report through the receiving browser. Its result is saved
separately from the source guide.


A typical command is:

```sh
python tools/tourism_operating_journey.py --output ./tourism-receiving-operation --node /path/to/node --chromium /path/to/chrome-headless-shell
```

Point CODEX_PRIMARY_RUNTIME_NODE_MODULES or PLAYWRIGHT_NODE_MODULES to the
existing installed Node modules when Playwright is outside the source tree.
Use a fresh output directory. A later invocation on a completed directory
verifies and returns that original result. The operation's private action
transcript includes its recovery passphrase; share the reporting package,
screen and compact result, and keep the private operation directory with its
operator.
