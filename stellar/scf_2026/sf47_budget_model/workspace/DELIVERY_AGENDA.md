# Delivery agenda across cases

Open **Delivery agenda** in the original Grant planning and delivery application to review deadlines and assigned work across selected existing cases. The agenda uses each case's existing delivery calendar, the same saved payment records and Completion assignments, and the case's own pinned plan.

## Use the complete operator flow

1. Select the cases in the left-hand list. Search narrows the list; **Select shown** adds those visible cases to the selection. Each case retains its name, original ID, operating mode and current version.
2. Choose the review date and select **Open selected agenda**. The service reads every selected case in one original workspace snapshot. The heading identifies the date and the complete case selection now displayed.
3. Use **Agenda** or **Month**. Search, case, event type, tranche, contributor and date controls narrow the screen. Undated work remains available below the dated agenda. Contributor choices retain the contributor's original case identity.
4. Open an entry to see its original dates, state and source. **Open original payment** opens the original Cash record; **Open original tranche** opens the original Completion context with the selected date and original receipt, assignment or review. **Open case calendar** opens that case's complete calendar and selects the same entry.
5. Download **iCalendar**, **CSV** or **JSON** to retain every row in the displayed case selection. Screen filters affect the view; downloads use the complete selection and its recorded case versions.
6. After changing a case in its original screen, return to Delivery agenda and use **Refresh shown agenda**. Selecting different cases or a different review date is applied by **Open selected agenda**.

Navigation preserves the existing case screens and their saved drafts, pending operations and recovery controls. If a case advanced after the agenda was opened, its original screen shows the current case and identifies the version change. Staff roles use the existing case access and original screen permissions; a source screen outside a role's available tabs opens the corresponding original case calendar.

Case search, explicit selection, view and filter preferences survive ordinary navigation in the same browser session. The agenda retains no independent business database or copied case journal.

## Read dates and totals

The [original calendar contract](CALENDAR.md) defines every event kind, saved date and deadline. The multi-case agenda preserves those rows without assigning new dates:

- Actual grant receipts, original payment-based completion clocks, issuer-confirmed extensions and recorded submissions retain their native identities and states.
- Original deliverables retain their saved start and finish bounds. A missing bound remains missing. Fully undated rows remain in JSON and CSV.
- Planned submissions remain planned dates from the original pinned case plan.
- A received copy remains a separate original case. Select the source case, its received copy, or both deliberately. If both are selected, both appear and both contribute to the displayed counts.
- Summary counts add the same per-case calendar categories. They describe the selected cases independently. Financial obligations and contributor capacity remain in their existing native views.

The review date evaluates current retained records. It does not reconstruct a historical case state or substitute a planned date for an actual payment. All-day iCalendar events preserve the original event UIDs, date bounds and statuses; case names are added to their titles. The original exporter handles inclusive native bounds, exclusive iCalendar end dates, partially dated work, canceled entries and UTF-8 line folding. Fully undated work has no invented iCalendar event date.

## Authenticated HTTP

The existing workspace session, staff authorization and case access checks apply to the complete selection. The selected case IDs are repeated query parameters:

~~~text
GET /api/operations/delivery-agenda?caseId=OPERATION_ID&caseId=SECOND_OPERATION_ID&asOfDate=2026-10-13
GET /api/operations/delivery-agenda/export.ics?caseId=OPERATION_ID&caseId=SECOND_OPERATION_ID&asOfDate=2026-10-13
GET /api/operations/delivery-agenda/export.csv?caseId=OPERATION_ID&caseId=SECOND_OPERATION_ID&asOfDate=2026-10-13
GET /api/operations/delivery-agenda/export.json?caseId=OPERATION_ID&caseId=SECOND_OPERATION_ID&asOfDate=2026-10-13
~~~

Use the complete IDs returned by the existing case directory, in the form `operation-` followed by 32 lowercase hexadecimal characters. Every selected case must be available to the current principal. The existing Contributor desk keeps its assigned-work scope.

The optional `expectedVersions` parameter is a URL-encoded JSON object with exactly one version for every selected case. Copy the returned `selection` into a subsequent export to keep the reviewed date and versions together. A changed selected case returns the original `OPERATIONS_CONFLICT` response with HTTP 409; the caller can refresh and review the complete selection.

Supplying no date selects the original calendar's current UTC date. Supplying an explicit date requires one valid civil date. Unknown query fields, repeated dates, duplicate case IDs and partial version maps are rejected.

## Original CLI and Python operation

From the installed workspace source, use the original CLI with the existing private workspace arguments:

~~~sh
python3 cli.py operations --workspace /absolute/original-workspace delivery-agenda \
  --case operation-FIRST_ORIGINAL_ID \
  --case operation-SECOND_ORIGINAL_ID \
  --as-of 2026-10-13 \
  --output /absolute/new-agenda.json

python3 cli.py operations --workspace /absolute/original-workspace delivery-agenda-export \
  --case operation-FIRST_ORIGINAL_ID \
  --case operation-SECOND_ORIGINAL_ID \
  --case-version operation-FIRST_ORIGINAL_ID=36 \
  --case-version operation-SECOND_ORIGINAL_ID=36 \
  --as-of 2026-10-13 --format ics \
  --output /absolute/new-agenda.ics
~~~

Replace the IDs and versions with the originals returned by the case directory. To check versions in either command, provide `--case-version ID=VERSION` once for every selected case. Output files use the original private publication helper and must be new destinations.

Existing Python callers use the same open `Operations` instance:

~~~python
report = operations.delivery_agenda(
    case_ids, as_of="2026-10-13", expected_versions=versions
)
calendar_bytes = operations.export_delivery_agenda(
    case_ids, as_of=report["asOfDate"], format="ics",
    expected_versions=report["selection"]["expectedVersions"]
)
~~~

Both operations retain the original workspace mutex and SQLite snapshot. The implementation calls `operations_calendar.calendar` for each selected original context; no case write is required.

## Typed client and Merchant MCP

The installed `./grant/agent` export exposes these operations:

~~~js
const opened = await client.read('delivery-agenda', {
  caseIds: selectedOriginalCaseIds,
  asOfDate: '2026-10-13',
});
const selected = opened.value.selection;
const fullCalendar = await client.download('delivery-agenda', {
  ...selected,
  format: 'ics',
});
const fullRows = await client.download('delivery-agenda', {
  ...selected,
  format: 'csv',
});
~~~

`GrantDeliveryAgenda` declares the full report. `GrantDeliveryAgendaSelection` declares explicit case IDs, optional date and an optional complete version map. The download selection adds the existing ICS, CSV or JSON format.

Use `merchant_grant_delivery_agenda` with the declared workspace alias, `caseIds`, and optional `asOfDate` and `expectedVersions`. Use `merchant_grant_export` with `kind: "delivery-agenda"`, the same workspace alias and returned complete selection, then select the format. The existing immutable snapshot, row paging and retained-file tools provide the whole result and complete export bytes. Array pointers `/cases`, `/entries` and `/undated` identify the original complete collections.

## Retained output

The JSON report has schema `stellar-forge.sf47-delivery-agenda.v1`:

| Field | Meaning |
| --- | --- |
| `selection` | Ordered explicit case IDs, review date and actual current version of every selected case. |
| `cases` | Each original ID, retained import origin and complete native calendar metadata, including the original case, pinned plan, date rules, summary and native report hash. |
| `entries` / `undated` | Complete original entry rows wrapped with their case ID and position in their original calendar collection. |
| `summary` | Selected case and row counts plus the same original deadline and deliverable totals. |
| `basis` | Native date explanations and selection semantics. |
| `sha256` | Digest of the complete report before its hash field is attached. |

Every wrapper ID combines the original case ID and original entry ID. The wrapped entry itself remains unchanged. The exporter reconstructs each complete original calendar in its original row order and verifies its hash before producing a combined export.

CSV adds case name, mode, state, version, pinned plan, review date and native calendar hash to the original entry columns. iCalendar retains original UIDs, sequences, timestamps and event properties and adds `X-SF47-CASE-ID` and `X-SF47-CASE-VERSION`.

A combined agenda is a delivery view. To transfer an editable case to another workspace, use the existing complete original case export/import workflow described in [Grant workspaces through Merchant MCP](../../../../stellar-forge/mcp-merchant-operator/GRANT_WORKSPACES.md). Reopen the selected received cases in the same agenda after import.
