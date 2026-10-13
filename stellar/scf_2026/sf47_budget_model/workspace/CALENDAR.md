# Delivery calendar

The delivery calendar brings the original case's grant receipt clocks,
completion assignments and milestone dates into one agenda. Open **Delivery
operations → Delivery calendar** to review all three tranches together, choose
a calendar date, switch between agenda and month views, or download the complete
case calendar for another operator.

The calendar reads the existing case. Assignments continue to be edited in
**Tranche completion**, and receipts, outcomes and issuer confirmations continue
to be recorded through their existing operations commands. Changes there appear
in the next calendar read. Every response carries its case version and pinned
plan identity.

## What the dates mean

| Entry | Date source | Displayed meaning |
| --- | --- | --- |
| Grant receipt | Original grant inflow record | Recorded payment date and original receipt state |
| Completion form deadline | Original completion engine | Previous tranche payment date plus 90 calendar days; a retained applicable issuer confirmation supplies an extended deadline |
| Planned submission | Pinned award plan and its existing calendar anchor | The proposal's planned submission date |
| Deliverable | Saved completion assignment, or the original anchored work package when no assignment exists | Assigned or planned start/finish, original work package and contributor names |
| Deliverable completed | Saved completion item's actual completion date | The retained completion statement |
| Completion form submitted | Original completion-linked outcome | The recorded form submission and its current outcome state |
| Extension confirmation | Original retained issuer confirmation | Confirmation date, confirmed deadline, reference and whether it currently determines the clock |

A saved assignment with no dates remains undated even when its original award
plan has dates. This preserves an operator's explicit assignment. A start without
a finish and a finish without a start keep the known bound; the other bound
remains empty. Original planned bounds are available alongside the saved
assignment.

The selected calendar date classifies the **current retained case**. It does not
rewind a case to an earlier version. In particular, a current completed
assignment remains completed when reviewing an earlier date. Actual payment and
form dates determine their original clock classification through the existing
completion engine.

Voided, testnet and future payment clocks retain their original classifications
and remain inactive. A submitted form retains the native `FORM_SUBMITTED`
classification even if a later outcome is withdrawn or changes are requested;
the separate form entry retains that outcome state. A receipt for tranche 3 is
the final payment and does not create a fourth completion deadline.

The SCF [Budget & Deliverable Guidelines](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines)
were checked on October 12, 2026. They specify a completion submission within
90 calendar days after receiving the previous payment, with confirmation from
SCF for a delay. The calendar delegates that interpretation to the existing
`operations_completion.dashboard` and its retained rule metadata.

## Downloads

| Format | Contents |
| --- | --- |
| iCalendar (`.ics`) | Dated all-day events for calendar applications |
| CSV (`.csv`) | Every dated and undated entry, with owners, original source identifiers, date basis and status |
| JSON (`.json`) | Complete response with summary, source identities, rule, original planning bounds and retained references |

Screen filters affect the view. Downloads retain the complete case calendar.
All three formats carry the same original case selection and calendar date.
The export request can require the version the operator reviewed; a case change
then returns the existing operations conflict instead of silently exporting a
different version.

iCalendar dates have no timezone conversion. Native end dates are inclusive;
the file represents them using RFC 5545's exclusive `DTEND`. A partially assigned
range becomes a single all-day event on its known bound, labeled as its start or
finish, with the missing bound explained in the description. Completely undated
work remains available in CSV and JSON.

Each iCalendar event has a stable UID derived from its case ID and original
entry ID. An extension updates the same deadline event. A voided receipt leaves
that deadline event with `STATUS:CANCELLED`; inactive testnet and future clocks
also export as canceled. Planned milestones and assignments export as
`TENTATIVE`. Walkthrough case events carry a **Walkthrough** title prefix.
Descriptions retain the source state, date basis and original identifiers.

The file uses UTF-8 text, CRLF lines, escaped calendar text and lines folded at
75 octets without splitting a Unicode character. Events are transparent and
contain no reminder alarms. These are downloaded snapshots; updating an
imported file follows the receiving calendar application's import behavior.

CSV uses the original workspace's export routine, including its UTF-8 BOM and
spreadsheet formula protection. Empty date cells stay empty.

## Command line

Use the existing workspace launcher and operations command:

~~~text
operations delivery-calendar --case ID --as-of 2026-10-12 --expected-version N --output NEW.json
operations delivery-calendar-export --case ID --as-of 2026-10-12 --format ics --expected-version N --output NEW.ics
~~~

`--as-of` and `--expected-version` are optional. Exports support `ics`, `csv`
and `json`; choose a new output filename as with the workspace's other exports.

## Native interface

`operations_calendar.py` uses only the Python standard library and existing
workspace modules.

~~~python
import operations_calendar

report = operations_calendar.calendar(context, as_of="2026-10-12")
ics = operations_calendar.export_bytes(report, "ics")
csv = operations_calendar.export_bytes(report, "csv")
json_bytes = operations_calendar.export_bytes(report, "json")
mime_type = operations_calendar.content_type("ics")
download_name = operations_calendar.filename(report, "ics")
~~~

`context` is the original `Operations._context` result, including its pinned
plan, records, sources and completion plans. Callers use the existing workspace
mutex and case identity validation. The module does not need another database,
a background process, a hosted calendar service or an installed package.

The native response schema is `stellar-forge.sf47-delivery-calendar.v1`:

- `case`: original ID, name, mode, state and version.
- `source`: pinned plan ID/revision/content/source hashes, calendar anchor,
  case timestamps and retained completion-plan identities.
- `asOfDate`, `generatedAt`, `rule`, `basis`, `sha256`: current response metadata.
- `entries`: dated rows, sorted by the first known date, tranche, kind and stable ID.
- `undated`: rows whose start and finish are both empty.
- `summary`: open active deadlines, overdue/due-today clocks, submitted clocks,
  open/completed deliverables, next upcoming deadline, and counts by kind.

Each entry carries `id`, `kind`, `tranche`, `title`, `startDate`, `endDate`,
`sortDate`, `datePrecision`, `status`, `active`, `detail`, `sourceId`, `costId`,
`ownerIds`, `ownerNames`, `sourceIds`, `dateBasis` and `calendarStatus`.
`datePrecision` is `RANGE`, `DAY`, `START_ONLY`, `FINISH_ONLY` or `UNDATED`.

Deadline rows also retain the original deadline, payment date/tranche, effective
deadline source, extension ID and native days remaining. Deliverables retain
original planned bounds, saved completion date, hours/cost, planning assignments
and linked work/deployment IDs. Planning contributors remain in
`planningAssignments`; they are not silently promoted to operational owners.

`summary.activeDeadlines` counts active clocks still awaiting a form submission.
`nextDeadlineOn` is the earliest such deadline on or after `asOfDate`;
overdue clocks are counted separately. `summary.completedDeliverables` counts
the original deliverable rows, so their separate completion-date entries do not
double-count delivered work.

The existing case export remains the handover used to reopen and continue
operations. Calendar downloads are portable views of that case.
