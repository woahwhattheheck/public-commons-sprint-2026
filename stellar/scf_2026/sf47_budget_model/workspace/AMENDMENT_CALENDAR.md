# Amendment delivery-calendar review

The existing **Delivery & cash → Plan amendments** page now shows the native delivery calendars on both sides of the selected planning amendment. The before calendar comes from the amendment's frozen operating case. The selected calendar uses that same case and the exact selected native planning revision.

## Operate the complete comparison

1. Open the existing case and choose its exact saved native planning revision in **Plan amendments**.
2. Enter the comparison date, reason and original decision basis. Choose **Preview complete amendment**.
3. Review **Delivery calendar impact** alongside the original financial exposure and record-compatibility results. It shows all dated and undated events, changed dates, original versus selected award-plan dates, and the contributors retained by saved assignments.
4. Filter the visible agenda by changed entries, date changes, work packages or undated entries. **Download both calendars and complete case** always exports the whole comparison.
5. Use **Current Completion** or **Current cash** to open the original case records. Completion receives the comparison date, original receipt, selected package and saved form context. The existing Completion drafts and pending native request remain retained.
6. Save, review and apply through the original amendment workflow. Every saved edition reopens its frozen calendar comparison. Later case activity remains available through the accompanying current operating-case export.

A saved assignment keeps its recorded dates and contributors when its award-plan dates change. The table displays those two sources separately. Original grant payments, issuer-confirmed extensions and submitted completion forms must compare exactly on both sides. The existing native payment clock remains the calculation source.

## Complete export

The download contains:

| File | Contents |
|---|---|
| index.html | Readable offline comparison and links to both native calendars |
| before/calendar.ics, .csv, .json | Complete original calendar |
| selected/calendar.ics, .csv, .json | Complete selected-plan calendar |
| calendar-impact.json | Complete paired agendas, all entry differences, original clocks and source selection |
| entry-comparison.csv | All original and selected entries, dates, owners and changed fields |
| assignment-comparison.csv | All work-package comparisons, including retained assignments |
| frozen-amendment-preview.json | Original immutable preview, native planning revisions, case snapshot and reports |
| saved-amendment.json | Exact selected saved edition when exporting historical work |
| original-case.zip | Complete current operating case, original planner history and retained source attachments |
| MANIFEST.json | Every delivered file, byte length, SHA-256 and selected comparison identity |

Undated entries appear in JSON and CSV. The ICS files contain dated events and retain the same original event identities on both sides; open the alternatives in separate calendars.

## Native API and exact export selections

The existing POST **/api/operations/{case}/amendment-preview** returns its original fields plus a derived **calendarImpact**. The existing GET **/api/operations/{case}/amendments/{amendment}?revision={edition}** returns the same companion beside **amendment**, **current** and **history**.

The original saved edition and its preview keep their existing format. The companion is computed at the application read boundary and carries its own **impactSha256**. Generation timestamps are excluded from that comparison identity.

POST **/api/operations/{case}/amendment-calendar-export** returns the complete ZIP. Select a current draft using the actual preview response:

```js
const selection = {
  expectedVersion: preview.observedVersion,
  inputs: preview.inputs,
  expectedPreviewSha256: preview.previewSha256,
  expectedImpactSha256: preview.calendarImpact.impactSha256
};
```

Or select a complete saved edition using the actual edition response:

```js
const selection = {
  amendmentId: detail.amendment.id,
  revision: detail.amendment.revision,
  expectedAmendmentSha256: detail.amendment.sha256,
  expectedImpactSha256: detail.calendarImpact.impactSha256
};
```

The export checks the original draft case version and preview, or the selected immutable saved edition, together with its native calendar comparison. It then includes the complete current case from the same database snapshot.

The original CLI adds **operations amendment-calendar-export --case CASE_ID --selection selection.json --output calendars.zip**. The existing amendment-preview and amendment-show commands return the companion. The typed client exposes **amendmentCalendarExport(caseId, selection)** alongside the original **amendmentPreview** and saved-edition read. Its response retains the complete binary bytes, native filename, media type and digest.

The Merchant operator exposes **merchant_grant_amendment_calendar_export**. Supply the exact export selection through **inputs**, or the existing verified input reference and optional JSON pointer. The complete output remains available through the original snapshot and byte-download mechanism.

## Source and native continuation

The maintained implementation is in **operations_amendment_calendar.py** and **operations_amendment_calendar.mjs**, with additive joins in the original amendment page, Operations, HTTP, CLI, typed client, Merchant tools and both managed source selectors.

The original complete **amendment_receiving.py** remains the operating journey for this amendment operation. Its retained preview files continue to hold the immutable native preview; derived calendar timestamps are excluded from those original checkpoint artifacts. Reuse the original operated root when continuing that journey. Keep the original case, complete calendar exports and desktop/phone receiving outputs together in the same source-owner Slack thread.

## Full original-case and browser receiving command

Run the complete operator from this source checkout, reusing the original amendment operating root:

    python3 stellar/scf_2026/sf47_budget_model/workspace/amendment_calendar_receiving.py --root /absolute/path/to/amendment-operating-work --source-commit PINNED_SOURCE_SHA --chromium /absolute/path/to/chromium

The operator first resumes the original ten-phase amendment journey, then exports the selected original saved edition, receives the complete case into another native workspace, and opens the same edition through the real browser. It reviews every row, downloads the whole paired calendar while the changed-entry filter is selected, follows the original package into current Completion, captures desktop and phone views, and reopens the saved case in a fresh browser context. Both native and browser downloads are received with their complete native manifests and all dated/undated rows.

To continue a recovered original amended case on an independent host, add **--archive /absolute/path/to/complete-case.zip --archive-sha256 ORIGINAL_SHA256**. That route imports the complete case through its original native API and retains the source archive selection. **--amendment** can select an exact saved amendment; otherwise the newest native amendment head is used.

Results remain under **output/calendar-impact/** in the same original root. The complete returned package is **amendment-calendar-receiving.zip**. It includes the native and browser paired exports, original operated case, cold received amendment, full source selection, native receiving result, and desktop/phone/reopen images. Use **--node** and **--playwright** only when the receiving host’s existing installation is outside the runtime environment defaults.
