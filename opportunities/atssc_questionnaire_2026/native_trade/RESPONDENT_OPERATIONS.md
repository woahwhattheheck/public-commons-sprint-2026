# ATSSC companies, coverage and respondent communications

This operating desk extends the original Native-Trade questionnaire application. Company coverage, source files, contact editions, assignments, messages and provider returns live in its existing questionnaires.sqlite3. Published questionnaires, private respondent access, answers, revisions, reviews and disclosure reports retain the original native writers and identifiers.

Open the application:

~~~sh
python3 server.py --workspace /absolute/path/to/workspace --port 0
~~~

The process prints its loopback URL and operator-key file. Sign in with that project's operator code, and choose **Companies and communications**. The same desk is at /respondent-operations/. Respondents open **Your contact information** from their own questionnaire.

## Complete operating sequence

| Stage | Operator action | Saved result |
|---|---|---|
| Case | Record the original reference, notice, deadline with timezone, organization, support contact and application origin. | A versioned case profile with its exact follow-up policy. |
| Original sources | Upload the complete trade or contact CSV/XLSX, select its worksheet/header and map its original columns. | Unchanged bytes, complete parsed cells/rows, explicit interpretation, all errors and source references. |
| Coverage | Choose this case's percentage, trade grouping, negative-value basis and documented company additions/exclusions. | Selected-company plan with original values, coverage by group and selection reasons. |
| Companies and contacts | Review every row: create, explicitly update, keep its previously retained contact or skip with a reason. | Original company IDs, versioned contacts, custom fields and row-to-contact links. |
| Assignments | Select companies, contacts and an existing questionnaire publication. | One original respondent per company/publication, using the native invitation writer in the same transaction. |
| Communications | Review the full recipient/body, queue it, then submit through the configured relay. | Frozen context, exact MIME, native SMTP replies and delivery history. |
| Follow-ups | Use the current due queue, record assistance and receive response or delivery changes. | Response-aware reminders, phone/postal outcomes and documented contact corrections. |
| Export and history | Download the operating workbook/ZIP and complete original project. | All sources, records, editions and the original authenticated application for cold receiving. |

The operator name and reason above the desk apply to the next mutation. Every mutation has a retained request ID. If its response is interrupted, **Recover original operation** reads that ID before a retry. A retry uses the same body. A communication that reached its durable dispatch claim is never submitted again by request replay.

## Source interpretation

Choose CSV or XLSX explicitly. For XLSX, enter the exact worksheet name; an initial read lists every worksheet. Set the actual header row. For CSV, select encoding and delimiter. The reader preserves every original row, including preamble, header, blanks and multiline records. Locations identify the actual file, sheet/cell or physical CSV lines.

Trade mappings require original company ID, HS code, country and value for duty. Company name is recommended. Select the original three-letter currency. Text amounts use the selected decimal/group marks; native Excel numeric tokens use their original decimal representation. Values remain decimal strings.

Contact mappings require company ID and company name. Add contact name, email, phone, postal address, country, role and language as available. Select an explicit default English or French language when absent from the source. Additional named custom fields can map any original column.

A numeric Excel company/HS identifier requires a reviewed interpretation. The numeric-identifier field accepts, for example:

~~~json
{
  "company_id": {"accept_numeric": true, "pad_digits": 9},
  "hs_code": {"accept_numeric": true, "pad_digits": 10}
}
~~~

Padding is an explicit case decision and cannot shorten the source value. The original numeric token and style remain in the report. For a source formula, list its mapped field only after reviewing the cached result. Each accepted formula cache is marked. Actual workbook calculation belongs to the original formula/answer/report compiler.

Exact duplicates remain. Duplicate contact candidates are marked for review and never silently merged. A corrected source or changed interpretation may explicitly supersede an earlier edition; its original file, mapping, contacts and history remain available.

The reader accepts complete files up to 64 MiB and bounded 256 MiB expanded XLSX. An oversized source is rejected as a whole instead of silently truncating rows. The browser pages all previews and saved records.

## Coverage calculations

The RFI describes reaching, for example, 80% of value for duty. This is a configurable case input; the application does not turn the example into a fixed rule.

Choose HS code, country or both, with optional explicit HS digit grouping. Resolve original punctuation/padding before using a numeric prefix. Filters use exact original values.

- **NET_COMPANY** sums positive and negative original values per company/group and uses its nonnegative net amount as the coverage basis.
- **POSITIVE_ROWS** uses positive source rows as the basis, retaining full negative and net amounts separately.
- Negative values require an explicit reviewed basis.
- Recommendations sort by value, then original company ID. The union of selected companies is applied to every group and coverage is recomputed.
- **MANUAL** uses only explicitly selected companies and documented additions.
- An invalid original row can leave coverage only through an EXCLUDE disposition with a reason.
- An interested party, complainant, referral or other addition needs company ID, name, source and reason. Its inclusion remains separate from value-based selection.
- A company cannot be both selected and excluded. A saved plan must resolve source problems and meet its selected target.

The complete report contains original net/positive/negative amounts, chosen denominator, selected value, achieved percentage, each company contribution and original row IDs. A saved selection creates missing company records and preserves existing identities.

## Contacts and assignment routes

Every contact-source row requires a disposition. CREATE makes a contact only when its original row has no retained link. UPDATE requires an existing contact belonging to the same company and its current version. KEEP_EXISTING requires that row's prior retained contact. SKIP retains a reason. Different company names require explicit KEEP_CURRENT or REPLACE, preserving original names as aliases.

A company can have several named/general-inbox contacts. An assignment selects one current contact. Changing its contact or deadline increments the assignment edition and makes prepared communication contexts stale, so the next message is reviewed with the new recipient/deadline.

Personal and generic-inbox invitations use the same private native respondent code. Templates explain forwarding to an authorized colleague. The code is kept in the body, never a query parameter.

Public entry registers its own company/contact and marks the assignment NEW_COMPANY_CONTACT_REVIEW. Anonymous entry never attaches itself to an existing company's private response. Staff review its source/name and operate its original assignment. The link has an explicit expiry and active state.

Authenticated respondents can update only their own contact name, email, phone, postal address, country and language. Their original scoped session enforces the respondent ID. They cannot browse the company register, read another respondent's contact or invoke operator operations.

## English and French messages

Ten editable initial templates cover invitation, reminder, submission confirmation, staff notice and revision request in English and French. Reinstalling them preserves existing edits.

Supported original context fields:

~~~text
case_reference, case_title, organization_name, support_contact,
company_name, contact_name, questionnaire_title, questionnaire_url,
access_code, due_date, revision_reason, submission_reference,
respondent_id, sent_date
~~~

Use placeholders such as {{company_name}}. Unknown/malformed placeholders or missing original values are rejected before queuing. Exact subject/plain body and escaped HTML are retained. The contact language controls template selection.

A submission confirmation references a real native received revision. A revision-request message references the original changes_requested review and note. Staff notices use the configured staff address. **Prepare missing original response notices** queues each original trigger once.

With automatic preparation enabled, a committed native submit/review queues its configured notices. An unavailable contact/template returns a visible continuation without changing the successful original response result.

## Native relay and dispatch

The adapter uses Python's standard SMTP client with an independently configured relay; it does not require the issuer's Microsoft Exchange mailbox integration.

Configure the operating host:

~~~sh
export ATSSC_SMTP_HOST=your-relay.example
export ATSSC_SMTP_PORT=587
export ATSSC_SMTP_MODE=STARTTLS
export ATSSC_SMTP_USERNAME=your-relay-user
export ATSSC_SMTP_PASSWORD=your-secret-from-the-host-secret-store
export ATSSC_SMTP_PROVIDER=your-relay-name
~~~

Modes are STARTTLS, implicit TLS (SSL, commonly port 465), or PLAIN_LOCAL for a loopback-only commissioning receiver. Optional variables are ATSSC_SMTP_TIMEOUT and ATSSC_SMTP_CA_FILE. Production credentials and authentication exchanges are absent from the source and ordinary provider transcript. Exact MIME and command responses remain retained.

A database claim precedes SMTP. The adapter rechecks current assignment, contact, deadline and response immediately before DATA. Repeated/concurrent request replay returns the original claim/outcome and cannot submit another MIME. A connection loss after DATA is UNKNOWN; recover the original provider outcome using its Message-ID/envelope identity. A queued message may be cancelled. An in-flight/uncertain message needs its original outcome.

| State | Meaning |
|---|---|
| QUEUED | Complete reviewed message retained locally. |
| SENDING | Original dispatch claim exists; native result pending. |
| ACCEPTED | Relay accepted that original message. |
| DELIVERED | Original provider report records final delivery. |
| DEFERRED | Provider reports a delay and may continue its original attempt. |
| BOUNCED / REJECTED | Original provider records failure; review contact/outcome. |
| UNKNOWN | Transport ended without a definitive original outcome. |
| CANCELLED | Queued or stale communication was explicitly stopped. |

Relay acceptance is separate from final delivery. A delivered notification does not establish that the recipient read the message.

Submit one already-reviewed message from the operating host:

~~~sh
python3 respondent_mail.py --workspace /absolute/workspace \
  --actor "Operating staff" --reason "Dispatch the reviewed original invitation" \
  dispatch --message-id ORIGINAL_MESSAGE_ID
~~~

## Native provider return

Upload the original RFC 3464 EML delivery-status notification. Its complete bytes and per-recipient blocks are retained. The reader matches original envelope and/or Message-ID with recipient; ambiguous/conflicting identity requires review. Native delivered, delayed, failed, relayed and expanded actions retain exact original status and location.

For an actual provider JSON export, choose JSON and map its original fields with JSON pointers. Example shape:

~~~json
{
  "records": "/events",
  "fields": {
    "provider": "/provider",
    "event_id": "/id",
    "recipient": "/recipient",
    "status": "/status",
    "at": "/occurred_at",
    "message_id": "/message_id"
  },
  "statuses": {
    "provider-accepted-value": "ACCEPTED",
    "provider-delivered-value": "DELIVERED",
    "provider-failure-value": "BOUNCED"
  }
}
~~~

Use the provider's own strings. Staff do not need to author a replacement result file. Every raw return and pointer is retained. A provider event ID cannot silently change its original recipient, message, status or data.

## Follow-up operation

Initial, midpoint and pre-deadline phases derive from current native respondent/case records. Received or accepted responses suppress ordinary reminders immediately. A changes_requested review enables only its correction follow-up. A later contact/deadline edition invalidates a reviewed message. Queued, submitted, delivered, deferred and uncertain follow-ups keep their original identities.

Enable the worker explicitly in Case, then run it:

~~~sh
python3 respondent_mail.py --workspace /absolute/workspace \
  --actor "Configured questionnaire worker" \
  --reason "Process this case's due follow-ups" due --send
~~~

Without --send it prepares due messages. With --send it submits eligible messages and continues original queued messages after a host interruption. It never replaces a claimed/submitted message. Scheduler deployment/cadence belongs to the operating host.

Record actual phone, postal, email, in-person and referral outcomes, original time, reference, assistance and expected response date. These records do not create a questionnaire submission or provider delivery event.

## Complete export and cold receiving

The editable operating XLSX includes Companies, Contacts, Assignments, Delivery, Sources, Coverage and Follow-up history. Monetary and identifier cells preserve exact text. Contacts CSV includes custom fields and formula-safe display; full JSON retains unescaped values, source locations, private assignment information, every provider event and complete before/after history.

The operating ZIP adds each table CSV and original source with a per-file manifest. The complete original project ZIP adds original application, coherent SQLite backup, workbook BLOBs, definitions, publications, answers, revisions, reviews, reports and private access material.

Receive it with the maintained original CLI:

~~~sh
python3 cli.py receive /absolute/ATSSC_Complete_Project.zip \
  --destination /absolute/new-project --expected-sha256 ORIGINAL_ARCHIVE_SHA256
~~~
 The original routine verifies every member plus database/workbook integrity. This extension also verifies each retained trade/contact file and interpretation seal. Open the received application's server against its received workspace to continue the same case.

The full project contains private access material and company/contact records. Keep it in authorized case access. Production hosting, Canadian residency, identity-provider operation, backup and the issuer's security conditions remain in the current platform partner's commissioned implementation.

## Composition and original requirements

This arm owns respondent_source.py, respondent_domain.py, respondent_operations.py, respondent_mail.py, respondent-operations.mjs/css/html, this guide and its whole native receiving programme. Narrow parent joins register outreach methods, serve through existing sessions and reuse the original invitation insert inside the same transaction.

Native-Trade retains definition/answer/revision/review/disclosure persistence and operator reports. Existing workbook/interop owners retain original LibreOffice calculations, formula/cache/hidden-report mappings and XLSX round-trip. The 9FCD company case retains commercial proposal, pricing and sole sender.

Primary sources:

- [Original ATSSC English RFI](https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/108603/request-for-information-%28rfi---citt-online-questionnaire-management-platform.pdf): coverage, company selection, invitations and response follow-up.
- [Original Annex A](https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/108603/annex-a---questions-to-industry---citt-online-questionnaire-management-platform.pdf): section 6 contact/communications, bilingual and respondent requirements.
- [Complete issuer archive and catalogue](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/988f2172887d2eb60665e43a64cc52532779eb5f/atssc-questionnaire-source-2026): original RFI/Annexes and all five workbooks.
- [Python SMTP client](https://docs.python.org/3/library/smtplib.html): native relay operations and responses.
- [RFC 3464](https://www.rfc-editor.org/rfc/rfc3464): original per-message/per-recipient delivery-status identities and outcomes.

## Continue the saved case through its browser

RESPONDENT_EXERCISE.py opens the original five Annex workbooks and carries the company, contact, assignment, native SMTP and cold-receiving operation through the existing questionnaire application. RESPONDENT_BROWSER.py continues that same saved workspace through the visible operator and respondent forms. It uses the existing Chrome and Playwright runtime supplied by the receiving host.

Run:

    python3 RESPONDENT_BROWSER.py --workspace /absolute/path/to/final-cold-received/workspace --output /absolute/path/to/new-browser-operation --chrome /absolute/path/to/chrome-headless-shell --playwright /absolute/path/to/playwright

The browser continuation imports and reviews a complete contact file, saves the original coverage selection, creates company assignments, previews and submits a message to its local commissioning relay, saves and reopens respondent progress, submits the original questionnaire, changes contact language, operates public French registration, and uses the actual download controls. It retains the complete original Download URL and resulting bytes. The wrapper receives the downloaded project, continues the same original contact history, exports the edited full project, and reopens that final edition. Its operating workbook and operating ZIP come from that same final case.

The programme writes BROWSER_RESULT.json after each completed operating phase. If the browser returns an error, BROWSER_RECEIVING_RESULT.json identifies the exact phase and preserves the current complete project before runtime cleanup. Continue that retained case after correcting the source; the original questionnaire and respondent identities remain with it.
