# Service commitments and monthly operations

The Service operations desk is part of the original SF74 merchant Support case. It keeps the agreement history, service calendars, original incident snapshots, reviewed exclusions and complete monthly reports together. Use the existing **Save case** action to retain the changes. Opening a saved version or receiving its normal portable handoff restores the same service record.

## Open the working case

Open the merchant’s original Support case, then choose **Service operations**. Existing cases start with an empty service record. The desk retains unfinished form fields with the case, so a partially written agreement or report selection can be saved and reopened.

The desk shows how many service editions, source snapshots and reports the current case holds. Each model operation validates the original retained records before adding an edition, exclusion or report. A pending operation finishes before the original case can be saved or exported; the complete resulting record then travels with that saved case version.

## Retain the original incident source

Choose an incident source already configured for this workspace and a current merchant or a merchant present in its retained incident history. **Refresh sources** reads the current source list and merchant configuration. **Retain current incidents** takes one original-store snapshot of that merchant’s retained incident records, with its actual capture time, source revision, configuration revision/hash, current merchant binding and retention settings.

The snapshot retains each complete original incident. Expand a snapshot to inspect its binding, revision and SHA-256 identity, review its incidents for exclusions, or download its original JSON. Repeated captures remain separate when the source or capture time has changed. The report uses the selected source chronology and preserves earlier retained incidents that may later leave the source’s retention window.

A case received on another host can still show its saved snapshots and reports. Configuring the original SF93 source on that host makes current-source capture available there as well. Source IDs always refer to the host’s declarations. The merchant picker includes original retained incident merchant IDs and marks those whose current registration is absent.

## Retain a service agreement

Complete the **Service commitments** form:

| Field | Meaning |
| --- | --- |
| Service title and customer | The named operating service and customer covered by this agreement. |
| Service owner | The person or team responsible for follow-up. |
| Agreement state | Proposed, Active, or Ended. Proposed terms remain visibly proposed in reporting. |
| Original agreement / acceptance reference | The original accepted document or communication reference. Active and Ended editions require it. |
| Recorded incident-source binding | An exact retained source/merchant binding, or the original binding of an edition being revised. |
| Effective from / through | Exact UTC timestamps. Ended terms require an ending timestamp. |
| Reviewed by and revision note | The reviewer and reason for the retained edition. |

Choose each covered original condition and its agreed response and recovery targets. Supported conditions are endpoint unavailable, incomplete observations, server errors, interrupted connections, delivery unavailable, delivery backlog and exhausted delivery attempts. Targets are whole service-calendar minutes from 1 through 527,040.

**Retain first service edition** adds the complete reviewed terms to this case. To change them, select an existing edition and use **Open edition to revise**. The next save creates a new immutable edition of the same agreement. The desk retains the edition originally opened and the model checks it against the current terms history before saving.

Choose **New service agreement** when a separate agreement belongs in this same case. It prepares a fresh terms ID and form. Existing retained agreements and reports remain available in their selectors.

### Continuous and business calendars

The calendar controls define when target minutes accrue:

- **24 hours, every day** uses continuous local calendar days.
- **Local business calendar** uses the selected weekday windows.
- **Holidays and special dates** replace the normal windows for that exact local date in either calendar mode.

Enter local times as 09:00-12:00, 13:00-17:00. A blank weekday or special-date window is closed. An ending time of 24:00 is allowed. Split overnight coverage at midnight across the two relevant dates. Daily windows must be ordered without overlaps after normalization.

The time zone is an installed IANA name such as America/New_York. Reporting month dates use this time zone; the original incident and capture timestamps remain UTC. Daylight-saving transitions are resolved by the model’s retained clock policy: an ambiguous boundary uses the earliest start and latest end, and a skipped local boundary advances to its next actual minute. The resulting service time counts actual elapsed minutes inside those windows.

An agreement can retain up to 1,000 special-date rows. Empty unfinished rows remain in the case draft until completed or removed; retaining the actual terms edition validates every date and window.

### Agreement history in a report

Select the latest agreement edition that belongs in the report. Its earlier editions remain part of the original terms history. Each incident uses its governing edition at the original opening, then that edition’s effective end, source and merchant binding. Later changes preserve the target associated with an earlier opening. An ended or rebound edition continues to govern its period and prevents earlier open-ended coverage from reappearing.

## Review a clock exclusion

Choose a retained snapshot and an original incident. The desk shows:

- Original condition, current state and incident revision.
- Original opening timestamp.
- Recorded human acknowledgment and reviewer.
- Original recovery or registration-retirement time.
- The actual snapshot capture time.

Open **Complete original incident** for all retained details. Enter the exact excluded UTC interval, whether it applies to response, recovery or both clocks, the reviewed reason, its original reference and the reviewer. The interval must fall within the original opening through the actual selected capture.

**Retain exclusion** creates an immutable reviewed choice. A correction uses **Use as a new reviewed choice**, which keeps the original exclusion and gives the correction a fresh ID. Select the exact applicable choices in each report. Already retained reports preserve their original selections.

The calculation merges overlapping excluded intervals and subtracts their overlap with actual service windows. It reports calendar minutes before exclusion, excluded minutes and service minutes after exclusion separately.

## Review and retain the monthly report

Select the service edition and complete reporting month. The month is inclusive local calendar dates in the selected service time zone. Set an explicit UTC report cutoff. Retaining a new compatible incident snapshot defaults this cutoff to its actual capture time.

Select all source snapshots needed for the month’s original chronology. The desk identifies captures outside the selected agreement history. Relevant snapshots may carry historical incident bindings even when the merchant’s current registration has changed. Original incident identity and revision checks reconcile repeated incidents across the selected snapshots.

Select each reviewed exclusion that should apply, then choose **Review monthly report**. Changing the month, cutoff, service edition, capture list or exclusion list requires a new review.

The report contains the full selected terms history, source identities, exclusions and original incident details. Its summary shows covered incidents, open follow-up, recovered incidents, retired registrations, proposed terms applied and additional incidents outside the selected coverage. Search the incident table or select a state to inspect the result; pagination changes the on-screen view while the retained report keeps every row.

### Read the clocks

| Report field or state | Interpretation |
| --- | --- |
| Actual elapsed minutes | Wall-clock time from opening through the observed completion or cutoff. |
| Calendar minutes | Actual minutes inside the applicable service windows before exclusions. |
| Excluded minutes | Overlap removed by the explicitly selected reviewed exclusions. |
| Service minutes | Calendar minutes remaining after those exclusions. |
| MET | The original recorded acknowledgment or recovery completed within its target. |
| MISSED | The relevant service-clock target was exceeded. |
| OPEN | The target clock is still open and within its target at the evaluated cutoff. |
| RETIRED | The registration was retired while the remaining clock was within target. |
| UNACKNOWLEDGED | The incident recovered within the response target without a recorded human acknowledgment. |
| Evaluated cutoff | The earlier of the explicit report cutoff and that incident’s actual selected capture time. |

The response clock uses the original human acknowledgment. Recovery uses the original recovered transition. An over-target clock remains missed when the registration is later retired. The table keeps the original owner, capture, agreement edition and follow-up alongside each result.

Additional source incidents appear with their selection reason when the chosen terms do not cover their opening, binding or condition, or the retained capture predates the reporting period. The preview also identifies selected exclusions that did not apply to the report’s incidents.

After reviewing these details, enter the report reviewer and note and choose **Retain reviewed report in case**. The model binds the retained report to the exact reviewed preview SHA-256. The complete saved review appears in **Retained reports**. Finish with the original **Save case** action.

## Download and reopen a retained report

Open a retained report to receive:

| Download | Contents |
| --- | --- |
| Report JSON | The complete immutable report, original reviewed selection, calculation, incident rows and review identity. |
| Incident CSV | Every covered incident and its original timestamps, response/recovery targets and results, owner and follow-up. |
| Printable report | Standalone HTML with the operating summary, original incident timelines, agreement/calendar editions, reviewed exclusions and source identities. Open the file in a browser to print or save a PDF. |
| Complete service record | The full service record, including complete original snapshot objects, agreement history, exclusions, all retained reports and the current unfinished form. |

The complete original case handoff additionally carries the case’s existing workspace and Support content. Save and export through the original Case Desk to receive the full merchant case on another installation. Opening that received case validates and reopens the service record and its retained reports.

## Agent and command-line operations

The existing merchant Support provider exposes the service workflow over the same saved case and incident-source bindings:

| Tool | Original operation |
| --- | --- |
| merchant_support_service_snapshot | Inspect the current original source and merchant snapshot before retaining a guarded capture. |
| merchant_service_read | Read the current or selected saved case’s service summary, a complete retained record, or the next original section page. |
| merchant_service_change | Apply reviewed terms, a guarded original capture, an exclusion or a reviewed report through the existing case save and retained request journal. |
| merchant_service_preview | Review a complete report selection against the expected current case revision. |
| merchant_service_report | Receive an original retained report as JSON, CSV or HTML with its complete content and returned identities. |

The read operation accepts id, optional revision, section, recordId, offset and limit. Sections are summary, terms, captures, exclusions, reports and operations. Page sizes are 1 through 100; follow the returned nextOffset to finish a section. Selecting recordId returns the complete original matching record rather than the section’s compact page row.

A change carries the original saved case and a stable request identity:

~~~json
{
  "id": "ORIGINAL_CASE_UUID",
  "expectedRevision": "CURRENT_CASE_REVISION_SHA256",
  "requestId": "THIS_ORIGINAL_REQUEST_UUID",
  "action": "capture",
  "input": {
    "incidentSource": "DECLARED_SOURCE_ID",
    "merchantId": "ORIGINAL_MERCHANT_ID",
    "expectedSourceRevision": 1,
    "expectedConfigHash": "OBSERVED_CONFIGURATION_SHA256",
    "expectedMerchantBinding": "OBSERVED_MERCHANT_BINDING_SHA256"
  }
}
~~~

Replace the illustrated identifiers, revision and hashes with the actual values returned by the original case/source reads. The capture operation compares all three observed source bindings before retaining the current snapshot. A newer source or case revision returns the original conflict for a fresh review.

The other change actions are terms, exclusion and report. Their input is the corresponding complete pure-model input described above. A report change includes the exact expectedPreviewSha256 from the original preview alongside its selection, reviewer and note.

Keep the same requestId and complete request body when recovering an interrupted change. The saved operation journal resolves an already accepted request before reading a newer source or enforcing its earlier case revision, so the original result can be received after later case edits. Reusing that request ID with different changes returns an operation conflict. When deliberately revising the requested work, inspect the current case and prepare a new reviewed request.

For CLI operation, prepare a private JSON request containing method and args. Methods are read, change, preview and report; args are the corresponding original MCP arguments.

~~~json
{
  "method": "read",
  "args": {
    "id": "ORIGINAL_CASE_UUID",
    "section": "summary"
  }
}
~~~

Run the original service CLI from this component:

~~~sh
node service-cli.mjs \
  --cases-dir /absolute/private/cases \
  --request-file /absolute/private/service-request.json
~~~

A source capture additionally selects either the host’s original incident-source configuration or its original single incident store:

~~~sh
node service-cli.mjs \
  --cases-dir /absolute/private/cases \
  --request-file /absolute/private/service-capture-request.json \
  --incident-sources /absolute/private/incident-sources.json
~~~

Use --legacy-incidents /absolute/private/original-incident-store for the existing single-store selection instead of --incident-sources.

For a retained monthly report, use a report request with args containing id, optional revision, reportId and optional format (json, csv or html). The complete operating delivery is:

~~~sh
node service-cli.mjs \
  --cases-dir /absolute/private/cases \
  --request-file /absolute/private/service-report-request.json \
  --out /absolute/private/service-report-delivery
~~~

The report delivery directory contains the original JSON, CSV and printable HTML, the complete service record, the current case workspace and its manifest. Existing full case exports include the complete merchant workspace, Support attachment and merchant-service.json. When the case has retained reports, merchant_case_export additionally includes merchant-service-report.json, merchant-service-report.csv and merchant-service-report.html for the explicitly selected saved browser report, falling back to the latest retained report when no saved selection exists. Every earlier report, term edition, incident capture, exclusion and operator request remains in the complete service JSON.

The CLI records the original report request and its resolved case revision in service-delivery-request.json before publishing the customer files. This also freezes the complete file plan and final manifest creation time. When revision is omitted, the first selected case revision becomes the delivery's original selection. Rerun the same request file with the same --out directory after an interruption or a later case edit; the CLI reopens that archived revision, verifies already retained files and completes the same service-delivery.json. A completed retry returns reused: true and the original manifest. A changed request uses a new output directory. Existing complete deliveries from the earlier CLI remain readable using their original manifest selection.

The original MCP export retains its exact case/revision, workorder selection, generation time and complete file plan before creating customer files. An interrupted export returns its original request through merchant_support_export_status; repeat that request to finish the same export. A completed same-request retry verifies and returns the existing delivery, even after later case edits. Export publication and the service CLI use the original case writer's complete, create-or-verify artifact operation. No partially written file is published at its final customer filename.

## Source and integration

The browser is service-desk.mjs, with neutral, responsive styles in service-desk.css. It calls the pure service-commitments.mjs operations and writes their complete result back to the original workspace’s optional service field.

The browser reads the existing declared sources at GET /api/incidents/profiles and the selected source at GET /api/incidents/:source. The selected source’s additive serviceMerchants list joins current registrations and retained incident merchant IDs in that same original-store read. The service source snapshot is GET /api/services/incident-snapshot?source=ID&merchant=ID. This endpoint reads the original initialized SF93 store once and returns {snapshot}. Service edits are retained by the existing original case save and handoff path.

Mount the browser with:

~~~js
const serviceDesk = mountServiceDesk({
  root: serviceRoot,
  readRecord: () => currentServiceRecord,
  writeRecord(next) {
    currentServiceRecord = next;
    caseDesk.changed({ user: true, source: false });
  },
  onError(message) {
    showCaseError(message);
  },
});
~~~

The writeRecord callback synchronously updates the original case. Keep the caller’s current service value in this callback; the desk owns its current form and does not need an echoed load for its own writes.

The returned controller exposes:

| Method | Integration contract |
| --- | --- |
| load(record, {canReplace}) | Asynchronously validates the complete record, then checks the caller’s original case-replacement guard immediately before replacing the panel; invalidates older source/model responses and restores the unfinished form. |
| read() | Synchronously snapshots the current complete record and form. Call it before the original case-read function’s first await. It rejects an unfinished model operation so the saved case remains coherent. |
| setEnabled(value) | Applies the original case’s lock while its save/open/receive operation changes the selected workspace. |
| destroy() | Retires the panel and its pending read-only requests and download URLs. |

Keep the new service root out of the original console’s generic input/change dirty listener, because writeRecord already signals the original case change once. Validate the optional workspace service value before replacing the existing case inputs; preserve it in the original codec, saved versions, CLI and handoff. Older workspace files without the optional field open with createServiceRecord().

The original case and source identifiers guard the asynchronous joins. A source response or model result from an earlier selected case cannot replace the current case’s record. The panel exposes data-ready="true" only after complete record validation, and aria-busy covers original record loading, source inspection and model work.

The full service case is limited to 8,000,000 UTF-8 bytes inside the original workspace limit. The unfinished form has a 160,000-byte limit. Complete retained records remain available for the original case handoff when planning another service period or case.

### Original operating journey

The native service journey uses the existing Support case, declared incident source, case save and handoff receiving. Its browser controls are:

- Source selection: service-source, service-merchant, service-capture.
- Terms: service-terms-form, service-terms-save, service-terms-edition, service-terms-open.
- Exclusions: service-exclusion-form, service-exclusion-save.
- Monthly review: service-report-form, service-report-preview.
- Saved review: service-report-retain-form, service-report-retain, service-report-list.
- Downloads: service-report-json, service-report-csv, service-report-html, service-record-json.

Use the complete original operating flow to exercise the service record and browser together, including case save, reopen and received case comparison.


The service-browser-receiving.mjs module continues that same operation with the actual browser context and both original SF74 listeners:

~~~js
import {receiveServiceBrowser} from './service-browser-receiving.mjs';

const browserResult = await receiveServiceBrowser({
  context,       // Original persistent Playwright context; acceptDownloads: true.
  sourceUrl,     // Original source SF74 loopback listener.
  receivingUrl,  // Named receiving SF74 loopback listener.
  caseId,        // Same saved case UUID in both original private stores.
  reportId,      // Original native report already retained in that case.
  directory,     // Original absolute private receiving directory.
  transfer,      // Original complete-case store copy; returns {caseId, revision}.
});
~~~

The parent native journey owns the SF30 merchant service, its operation store, the original SF93 watcher and incident transitions, the MCP and CLI changes, both saved case stores, and the persistent browser. Its transfer callback reads the current source case and saves the exact full workspace, Support attachment and metadata into the named receiver with the receiver's actual current revision. The browser module uses one page in the supplied context and leaves its lifetime with that parent.

The browser continuation retains its planned next terms edition before changing the form. It uses the original agreement reference, binding, targets and calendar; the retained source capture determines the selected reporting month and actual report cutoff. It reviews and saves the monthly report, then saves an unfinished future-edition start and review note through the existing Save case button. It reloads the same case before receiving it, so both immutable report history and incomplete form values are exercised.

Original report JSON, the complete incident CSV, printable HTML and the full service record are downloaded through the actual browser controls. The source and receiving downloads are compared with the saved original records. Desktop and mobile captures, the complete original and receiving case records, source identities and phase outcomes remain under directory/service-browser.

After an interruption, rerun the same native journey with that same directory, caseId and reportId. The browser checkpoint retains the intended edition and report selection; it reads the current original case to resolve an already accepted result before making another change. An already received complete case is recognized by its actual workspace, Support bytes and metadata. Its saved case versions and operation journal remain the original recovery surface.
