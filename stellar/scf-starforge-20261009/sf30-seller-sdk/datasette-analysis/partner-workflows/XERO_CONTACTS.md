# Xero Contacts acquisition, mapping and complete receiving

This adapter carries the selected organisation's complete observed Xero Contacts response into the maintained Odoo contact preparation and Datasette / Analysis workflow. It supplies original-page acquisition, interruption continuation, a full contact/person/group review, explicit mapping decisions and independently receivable source. Run it alongside the five original partner-workflow files in this installed product.

## Selected source contract

The source is Accounting API GET /Contacts with page, pageSize, includeArchived=true, summaryOnly=false and ContactID ASC ordering. One selected tenant UUID and the complete returned pagination metadata define the capture. Every page retains its actual URL, response status, receive time, correlation/rate headers, complete original JSON body and SHA-256. Names and email addresses never replace the native ContactID.

The current contract was reviewed against Xero's official OpenAPI 19.1.0 at commit fd9d44b04bf4934a7509b8e7ece51a9e0e462e4f and the current Contacts, pagination and rate-limit documentation. The original full response is retained even for fields outside the selected target mapping.

| Source element | Treatment |
| --- | --- |
| ContactID | Stable source identity within the selected tenant; both tenant and ID enter the mapped source identity. |
| ContactStatus | ACTIVE enters explicit review. ARCHIVED and GDPRREQUEST remain retained source records without target imports. |
| MergedToContactID | Retain the original relationship and exclude the merged record from automatic import. The partner resolves any target merge separately. |
| IsCustomer / IsSupplier | Preserve the source flags; they describe transaction relationships and do not determine company/person classification. |
| Primary FirstName / LastName | Review as a separate person candidate when present; the operator chooses whether it belongs under a selected company. |
| ContactPersons | Review each returned person and include/exclude it explicitly. Xero supplies no durable ContactPerson ID. Assign and retain a local person key; names, array positions and email are never implicit durable keys. |
| ContactGroups | Preserve returned group IDs, names, status and memberships as source context. A group is neither a company parent nor an automatically selected Odoo tag. The capture does not claim to be a complete group catalogue. |
| Phones | The operator selects one exact returned PhoneType or chooses none. Duplicate selected types require correction. |
| HasAttachments | Retain this flag and returned metadata. This contact-master profile does not download binary attachments. |

The source is a complete observed sequence of pages, not an atomic Xero database snapshot. Counts, page shape and duplicate IDs are checked. Reacquire the full source and compare it before the selected cutover. A missing record in the later result becomes NOT_RETURNED_REVIEW; it never causes an automatic target deletion.

## Capture the original pages

Use Node 20 or later and the customer's existing authorised Xero connection. Its token must permit the selected contact read operation. Supply the access token through the installed environment reference; the adapter neither requests a new OAuth grant nor stores the token. Keep the tenant UUID from that existing connection and keep all source files in the private customer workspace.

    node xero_contacts_cli.mjs capture --state /private/customer/xero-contacts-01.json --tenant SELECTED_TENANT_UUID --token-env XERO_ACCESS_TOKEN --page-size 1000 --max-records 100000

Replace SELECTED_TENANT_UUID with the actual UUID. Default page size is 1,000, within the documented 1–1,000 range. The selected record limit is an explicit acquisition ceiling, at most 100,000; the actual full-source volume, response sizes and transformation effort are commissioning inputs. A source over that selected ceiling remains an explicit operation outcome rather than a silently truncated edition.

Requests run serially with a 1.1-second interval. The customer's other workers can consume the same native limits. A 429 saves the original response and its Retry-After deadline in the capture, then exits. Run the same command after that actual deadline; it refuses an early retry. If the response omitted Retry-After, the state explicitly records the 60-second fallback. The current Xero page distinguishes Starter daily limits from higher tiers; use the selected connection's actual headers and account allocation.

HTTP errors and invalid successful-response contracts retain the full returned response in attempts. Network errors retain the page and phase. A refreshed token for the same authorised tenant can continue the same original capture. The state path is protected by a process lock; after an interrupted process, inspect the saved lock owner PID and confirm it has exited before removing that lock directory.

On continuation, every retained successful page is re-read before acquiring more pages. If its contacts or pagination changed, the command preserves the attempt and returns SOURCE_CHANGED_RESTART_CAPTURE. Capture a successor to a new state path, retain the predecessor and compare them once both are complete. A completed capture replay returns that original edition without fetching new pages. A fresh observation always uses a new state path.

The adapter makes only GET requests to the fixed Xero Contacts endpoint. It has no Xero write or Odoo write operation.

## Review and make explicit mapping decisions

    node xero_contacts_cli.mjs review --capture /private/customer/xero-contacts-01.json --out /private/customer/xero-review-01.json

The complete review contains contact rows, primary/additional person candidates, returned group memberships and a decisionsTemplate. Save that whole template as a separate decisions JSON and complete its actual selections:

- namespace: the retained migration namespace used for every later import, matching ^[a-z][a-z0-9_]{0,39}$ (lowercase initial letter, then lowercase letters, digits or underscores).
- targetScope: the selected Odoo database/export scope.
- targetBaselineComplete: true only after retaining the complete selected target baseline.
- targetExisting: actual selected Odoo export records in the original preparation schema.
- fields: the owned target fields; name is required, email and phone are optional.
- contacts: one explicit company, person or exclude decision and reason for every active, unmerged ContactID.

Each included contact selects phoneType. none means that no source phone was selected; the original target baseline preservation rules apply. Returned blank email or phone values that would clear an existing nonempty target require the corresponding field in clearFields. Preserve the original blank/omitted distinction.

Every returned primary/additional person candidate has a fingerprint and an occurrence solely for operator review of that captured edition. Select include or exclude and a reason for each. An included person requires a selected company parent and a retained local sourceId such as accounts-contact-01. Assign that key from the agreed migration register. Reuse it after reviewing a changed source candidate in a successor edition. A contact classified as a standalone person already supplies that person record; exclude its separate primary candidate with that explicit reason.

Optional targetExternalId binds a source contact/person to a specific existing target External ID in the retained baseline. Names and shared email addresses do not trigger automatic matches. The original engine checks target kind, complete baseline, duplicate IDs, preserved parent uniqueness and explicit field clearing. Review exceptions remain in the complete reports and are excluded from target import files.

Archived, GDPR-request and merged records are retained-only and do not accept active-import decisions. Removing a decision for them does not delete their source history.

## Prepare the complete working bundle

    node xero_contacts_cli.mjs prepare --capture /private/customer/xero-contacts-01.json --decisions /private/customer/xero-decisions-01.json --out /private/customer/prepared-xero-01

For an installed Analysis operation, use the same installation JSON described in README.md:

    node xero_contacts_cli.mjs prepare --capture /private/customer/xero-contacts-01.json --decisions /private/customer/xero-decisions-01.json --installation /private/customer/installation.json --out /private/customer/prepared-xero-01

The command invokes the original prepare_cli.mjs. It publishes the original normalized input, company/person imports, mapping, exceptions, reconciliation table, review HTML, original metadata, all five maintained preparation files and optional native profile. It then binds the three complete Xero source files, exact original capture and decisions bytes, full Xero review and xero-manifest.json in that same original manifest.

An identical completed preparation replays the same full delivery through the original receiver. Different source bytes, decisions, source code or installation selection require a successor output directory. If the process stops while adding the Xero extension, rerun the same preparation with those same original inputs to finish its unchanged members.

    node xero_contacts_cli.mjs receive --input /private/customer/prepared-xero-01 --out /private/customer/received-xero-01

Receiving requires every Xero member and the full original partner bundle. It verifies all bytes and hashes, revalidates the complete page sequence, regenerates the review and normalized original input, and uses the original complete receiver to preserve all table and source members. Received installation paths stay original until the operator binds the new installation through the existing configure process.

## Native source, report and Odoo staging acceptance

Use profile-template.json with the existing workflow_cli.py configure, accept and run commands in README.md. The native profile is odoo-contact-import-preparation. Retain the original business request and actual execution ID; changed source or decisions become a successor request with the original parentRequestId. The full normalized input embeds the complete Xero capture, decisions and selection history, so they enter the native source metadata and subsequent archive.

Select the complete maintained product archive that includes these three adapter files and the existing preparation/Analysis modules. The original source worker retains that archive, native source editions, saved queries and report output. Schema-bearing zero-row exceptions or pre-import reconciliation remain native tables with their original columns.

Import the reviewed companies.csv before people.csv using the selected Odoo database's original Contacts importer. The prepared headers are External ID, Name, Is a Company and Related Company/External ID, plus the declared owned contact fields. Confirm actual installed version, translated field labels, custom modules and the target importable template during commissioning. The retained namespace and external IDs address the same records on a corrected import.

Retain the actual Odoo Test/import result, complete selected target export and discrepancy decisions. Add targetAfter to the decisions using that export, prepare a successor and inspect the original reconciliation table. Correct one agreed discrepancy and repeat the selected staging import with the same IDs. The partner and client retain their original cutover, tax and accounting decisions. This source adapter prepares the contact master; invoices, opening balances, tax settings, historical journals and attachment binaries are separate source contracts.

Use the original workflow export and receive commands to deliver the whole editable native project, open it in the independent installation, inspect its original Xero pages and resulting source/report, and continue one agreed correction. Retain actual IDs, table counts, query versions, import results and source comparison in that same customer operation.

## Compare source editions

    node xero_contacts_cli.mjs compare --before /private/customer/xero-contacts-01.json --after /private/customer/xero-contacts-02.json --out /private/customer/xero-change-review.json

Comparison requires the same actual tenant, validates both full page sequences and reports new, changed and no-longer-returned ContactIDs with complete before/after records. Reconcile these with the selected cutover window and target results. Record mappings for changed person candidates against their retained local keys.

## Original references

- Xero Contacts: https://developer.xero.com/documentation/api/accounting/contacts
- Xero current pagination: https://developer.xero.com/documentation/api/accounting/requests-and-responses/
- Xero current rate limits: https://developer.xero.com/documentation/best-practices/api-call-efficiencies/rate-limits/
- Reviewed complete official schema: https://github.com/XeroAPI/Xero-OpenAPI/blob/fd9d44b04bf4934a7509b8e7ece51a9e0e462e4f/xero_accounting.yaml
- Odoo 19 original import guide: https://github.com/odoo/documentation/blob/19.0/content/applications/essentials/export_import_data.rst
- Maintained preparation contract: SOURCE_CONTRACTS.md
- Complete native workflow and receiving: README.md and ../WORKFLOW.md
