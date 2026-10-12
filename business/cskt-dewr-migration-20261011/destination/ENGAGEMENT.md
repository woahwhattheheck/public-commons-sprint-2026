# CSKT native public engagement

The engagement workspace adds the forms requested in §5.9 of the [original CSKT DEWR website RFP](https://csktwatercompact.com/wp-content/uploads/2026/10/DEWR_Website_RFP_Final.pdf): contact submissions, public comments, newsletter sign-up and optional event registration. It runs inside the maintained WordPress destination and binds each form to an existing project, notice, page or news item.

The existing content and GIS migration release remains the source of each native content identity. A form records that native post ID, permalink and original migration binding. Staff manage the four workflows from **WordPress → Engagement**. Public forms appear below their selected resources or through a WordPress Shortcode block.

This reusable product addition supports an engagement implementation scoped with the qualified prime. The original $8,400, ten-business-day content/GIS workshare, sender and acceptance terms remain described in the original commercial directory.

## Install and open

Install the entire maintained destination/wordpress-plugin directory as the **CSKT Reviewed Migration** plugin, including the engagement PHP, JavaScript and CSS files. Replace the complete existing plugin directory when upgrading. The maintained plugin requires WordPress 6.8 or later and PHP 8.1 or later. Its existing transaction layer supports the original InnoDB or SQLite destination.

The activation hook registers the existing public content types and the private engagement records. An already active installation registers them on its next normal WordPress request.

Open **Engagement** in WordPress administration. The workspace shows forms, submissions, correspondence and, for administrators, complete export and receiving.

| Native capability | Operations |
| --- | --- |
| edit_pages | Read submissions, assign staff, review records, prepare and send staff responses, manage registrations and download operating CSVs. |
| publish_pages | Create or edit forms, choose their existing native resource, open or close collection, and publish separately permitted reviewed comments. |
| manage_options | Export the complete private workspace, preview and apply receiving, and reconcile interrupted mail using its actual transport outcome. |

The form editor also checks editing access to the selected parent. Assignment uses existing WordPress staff accounts. Private records are excluded from public search and standard WordPress REST post collections.

The public and staff screens use local assets and the selected WordPress origin. Use HTTPS for the production destination. The original destination client also supports loopback HTTP for an owned native receiving runtime.

## Create a form on the original project or notice

1. Open **Forms → Create form**.
2. Search for the existing page, project, news item or notice and select it. The migration source remains available through that record's retained binding.
3. Choose the type and enter its title and instructions.
4. Enter the actual information-use statement and consent text approved for this collection. Every submission retains the exact displayed consent edition.
5. For public comments, review the separate publication permission. A participant may submit a private comment without granting permission to publish it.
6. Optionally set a staff notification address. Notifications link to the private staff record.
7. Select opening and closing times. The editor labels its date fields in UTC; the public page displays the site's configured time zone.
8. Save as **Draft** while preparing it. Set **Open** when the native resource is public and the collection is ready.

A password-protected or archived parent cannot collect new submissions. Enable **Show this form below its associated content** for automatic placement. For explicit placement, use a Shortcode block:

~~~text
[cskt_engagement id="THE-ORIGINAL-FORM-UUID"]
~~~

Replace the placeholder with the actual UUID shown in the editor. Automatic placement recognizes an already rendered form and avoids adding a second copy.

A form with submissions keeps its original type. Use a separate form for another workflow. Staff may revise its instructions, dates or consent text; later submissions retain the new edition and earlier submissions retain their original edition.

**Closed** stops new submissions and event confirmations. Existing private receipts, cancellation and unsubscribe remain usable. Reviewed public comments may continue to appear with the original resource. Returning the form to Draft also removes it from public form discovery.

## Contact submissions and staff responses

Contact forms retain the original name, email, subject, message and consent. The participant receives a private receipt with its own bearer key and can reopen it without a WordPress account.

**Submissions** filters by form, staff state and search text. The selected record shows the original content, submission time, original form revision, exact consent and information-use text, native project or notice, assigned WordPress staff, internal notes and record history.

Review states are **New**, **In review**, **Resolved**, **Archived** and **Spam**. Archiving or marking a record as spam withdraws its active public participation and cancels its newsletter or event participation. Its original submission and history remain retained.

**Prepare response** saves a draft addressed to the original participant and opens it in Correspondence. Review the saved recipient, subject and message, then choose **Send saved message**. The actual WordPress mail attempt and outcome remain with the original entry.

## Public comment review and release

Public comment forms collect a message and optional public display name. The email stays private.

Open the original submission, review its separate publication permission, enter the exact reviewed text and display name, and choose **Publish reviewed comment** with a publishing account. Public responses contain only that text, display name and publication time.

Staff can withdraw a comment. The original private receipt also lets the participant withdraw publication permission; the public comment is withdrawn in the same transaction. A later staff action cannot republish it without a new permitted submission.

Publication and public listing both verify the current native resource. An unpublished, password-protected or archived resource stops public comment display. Private source records remain available for staff review.

## Newsletter sign-up and unsubscribe

A sign-up starts as **Pending confirmation** and creates verification mail through the site's WordPress mail transport. The link opens an explicit confirmation screen. Opening the email link alone does not subscribe the participant.

The verification token expires after seven days. The private receipt can request another confirmation. A new token supersedes queued earlier verification mail. Participant/email and request rate windows limit repeated confirmation requests.

**Confirmed subscribers CSV** exports current confirmed addresses for the selected form, deduplicated by email. It includes the recorded name, confirmation time, consent text and original submission. Receive this CSV into the organization's existing newsletter operation.

**Unsubscribe** updates all currently retained sign-ups for the same form and email in one transaction. An earlier duplicate cannot leave that address active. A later independently consented sign-up is a new source submission.

## Event registration and capacity

An RSVP form has a maximum party size and event capacity. Capacity 0 means unlimited. Registrations start as **Pending confirmation** and use the same explicit verification flow.

On confirmation, the native transaction reserves the full party or puts it on the waiting list. Confirmed and attended parties count toward capacity. Pending confirmation does not hold places.

Waiting parties keep their original order. A later smaller party cannot overtake an earlier waiting party. Cancellation releases capacity and promotes the waiting list within the currently open event. Increasing capacity or reopening the event also runs promotion. Reducing capacity retains already confirmed registrations and displays the current total against the new limit.

Participants cancel using the original private receipt. Staff can also cancel, check in a confirmed registration, or record an actual confirmation using **Confirm registration** with a staff note. Automatic registration-update messages stay in native correspondence.

**Attendance CSV** includes original entry ID, name, address, party size, reservation state, confirmation time and check-in time.

## Native mail and interrupted responses

All messages use the site's existing wp_mail configuration. Automatic confirmation, staff notification and registration-update messages are scheduled as WordPress single-event cron jobs after the source transaction commits.

Inspection reports whether DISABLE_WP_CRON is set. Keep the existing external cron runner active where the site uses one. Pending correspondence can also be opened and dispatched manually through the staff workspace.

Before transport dispatch, the attempt is saved as **Sending**. The transport runs outside the database transaction and its returned result is saved afterward.

| State | Meaning and continuation |
| --- | --- |
| Draft | A saved staff response is ready for review or editing. |
| Pending | Automatic mail is ready for scheduled or manual dispatch. |
| Sending | An attempt started. Reopen its original record and obtain the actual transport result before recording its outcome. |
| Accepted | WordPress returned success for the mail request. |
| Failed | WordPress returned failure; staff can review and retry it as a new explicit operation. |
| Cancelled | Dispatch was cancelled or the confirmation token became obsolete. |

The [WordPress wp_mail contract](https://developer.wordpress.org/reference/functions/wp_mail/) defines its successful return as acceptance of the transport request. Recipient delivery is available from the installed provider's own result.

Every mutation retains an operation UUID and exact request digest. Replaying an interrupted request returns its original operation. A different UUID is a new action. The staff browser retains unfinished requests in its current session and exposes **Retained actions → Resume** after reopening.

An interrupted dispatch or transport exception leaves the attempt as **Sending**. An administrator can choose **Record transport outcome**, using the actual accepted/failed result and a note from that attempt. History preserves the original send and its reconciliation.

Portable receiving retains correspondence as history with dispatch disabled. Prepare a fresh staff reply from the original entry for a new message. Restoring the original complete native database instead preserves that installation's original pending dispatch state and scheduled events.

## Complete export and receiving

The complete private JSON includes selected form definitions, all original submissions, consent editions, receipt and verification keys, staff history and correspondence. Store these files with the project's protected administrative backups.

### Export selected forms

Select complete forms in **Export and receiving**, then choose **Download complete selected forms**. The transfer contains:

- cskt.engagement.transfer.v1: the wrapper, counts and source digest.
- cskt.engagement.workspace.v1: the original origin and complete record arrays.
- Forms, entries and mail with original UUIDs, revisions and full histories.
- SHA-256 over the canonical complete workspace.

All native collection pages are traversed. A selection is limited to 32 MiB. If it exceeds that size, select fewer complete forms. Source histories are never silently truncated.

Operational CSVs are separate staff views: submissions, confirmed subscribers, attendance and published comments. Formula prefixes are escaped in CSV cells; the stored source text remains unchanged in the complete JSON.

### Receive on the original or another destination

1. Install the complete current plugin.
2. Receive or identify the actual native project and notice records using the maintained migration workflow.
3. Choose the complete transfer JSON in **Engagement → Export and receiving**.
4. Map every source parent to an actual destination resource. A restore to the current origin preselects matching native IDs.
5. Choose **Preview receiving** and review create, unchanged, replace and conflict decisions.
6. If changed selected destination records should be replaced, select the replacement control and prepare the preview again.
7. Choose **Apply reviewed receiving**, reopen the original forms and entries, and save the receiving result.

The preview binds the full source digest, parent mappings, operator and current destination record digests. Apply checks them again and commits selected writes in the original native transaction. Intervening staff changes require a fresh preview. Other forms and WordPress content remain part of the same existing destination.

An exact retry returns the original receiving result. Existing UUIDs identify the original records, so replay does not create another form, submission or correspondence history.

Mapped forms retain original-parent and source-digest lineage. Submissions preserve their original source context and consent. Received correspondence remains available without automatic redispatch.

## Normal backup and restore

Forms, submissions and mail are private WordPress posts with native revisions and filter metadata. The site's complete native database backup retains them alongside original operation journals, receiving previews and results, WordPress cron and installation options.

Include the complete maintained plugin directory with the normal files backup. Restore the native database and site files using the existing destination procedure, then reopen Engagement and inspect its original records. Native IDs and operation UUIDs remain stable.

The portable selected-form JSON serves selective receiving into another or existing site. WordPress WXR can carry the private post records; the full native database is the ordinary backup for option journals, schedules and installation state.

## Command-line operator

The CLI shares destination/wordpress.mjs with migration delivery. It uses the original configured WordPress origin and the same private application-password reference.

~~~json
{
  "baseUrl": "https://dewr.example.org",
  "username": "native-operator",
  "credentialRef": "file:/private/dewr/wordpress-app-password",
  "timeoutMs": 30000
}
~~~

Use the actual authorized destination and account in the private configuration.

~~~bash
node destination/engagement.mjs inspect --config /private/dewr/wordpress.json
node destination/engagement.mjs parents --config /private/dewr/wordpress.json --search "Jocko"
node destination/engagement.mjs entries --config /private/dewr/wordpress.json --all --out /private/dewr/engagement-entries.json
node destination/engagement.mjs operation --out /private/dewr/engagement-operation.json
~~~

Keep the generated operation UUID in the exact request body. A new form also needs its own stable UUID and expectedRevision 0. Select the actual parentId from the native parents result and prepare the collection text from the original approved definition.

~~~json
{
  "id": "RETAINED-FORM-UUID",
  "operationId": "RETAINED-OPERATION-UUID",
  "expectedRevision": 0,
  "form": {
    "parentId": 123,
    "mode": "comment",
    "state": "draft",
    "title": "Reviewed project comment form",
    "instructions": "",
    "privacyText": "",
    "consentText": "",
    "opensAt": "",
    "closesAt": "",
    "capacity": 0,
    "maxParty": 1,
    "autoAttach": true
  }
}
~~~

This is a request shape. Replace its identifiers, parent ID and text with the selected originals before saving. Opening requires completed consent and information-use fields.

~~~bash
node destination/engagement.mjs save-form --config /private/dewr/wordpress.json --input /private/dewr/form-save.json --out /private/dewr/form-result.json
node destination/engagement.mjs decide --config /private/dewr/wordpress.json --id ENTRY_UUID --input /private/dewr/entry-decision.json --out /private/dewr/entry-result.json
node destination/engagement.mjs mail-decision --config /private/dewr/wordpress.json --id MAIL_UUID --input /private/dewr/mail-decision.json --out /private/dewr/mail-result.json
node destination/engagement.mjs send-mail --config /private/dewr/wordpress.json --id MAIL_UUID --input /private/dewr/mail-send.json --out /private/dewr/mail-send-result.json
~~~

Entry decisions are review, publish_comment, withdraw_comment, prepare_reply, confirm_registration, cancel_registration, check_in and resend_confirmation. Mail decisions are save_draft, cancel, new_copy and reconcile. Every action uses its original record ID, current expectedRevision, retained operationId and selected action fields. The staff UI creates the same native requests.

Complete export uses:

~~~json
{ "formIds": ["FORM_UUID"] }
~~~

CSV uses a formId and one of submissions, subscribers, attendance or public_comments:

~~~json
{ "formId": "FORM_UUID", "kind": "subscribers" }
~~~

~~~bash
node destination/engagement.mjs export --config /private/dewr/wordpress.json --input /private/dewr/export-selection.json --out /private/dewr/engagement-workspace.json
node destination/engagement.mjs export-csv --config /private/dewr/wordpress.json --input /private/dewr/csv-selection.json --out /private/dewr/subscribers.csv
node destination/engagement.mjs receive-preview --config /private/receiving/wordpress.json --input /private/receiving/preview-input.json --out /private/receiving/preview.json
node destination/engagement.mjs receive --config /private/receiving/wordpress.json --input /private/receiving/apply-input.json --out /private/receiving/receiving-result.json
~~~

Preview input contains transfer (the complete export), parentMappings (source post ID to actual destination ID) and replaceChanged (false initially). Apply input contains the exact previewId, sha256 and a retained operationId. Preserve the apply input for the same-operation retry.

Output files use private permissions and atomic replacement, with full bytes and SHA-256 reported. CSV output additionally verifies the native byte size and hash before writing. The output path must differ from the input and destination configuration.

## Maintained source

| Source | Responsibility |
| --- | --- |
| wordpress-plugin/engagement.php | Private native records, form definitions, source bindings, original submissions, receipt access and replay. |
| wordpress-plugin/engagement-actions.php | Review, publication permission, confirmation, subscription, RSVP allocation, waiting-list promotion and native mail attempts. |
| wordpress-plugin/engagement-transfer.php | Complete export, CSVs, parent mappings, receiving preview and revision-guarded apply. |
| wordpress-plugin/engagement-admin.php | Roles, REST routes, staff directory, administration, public rendering and non-JavaScript submission. |
| wordpress-plugin/engagement-admin.js | Staff form editor, submission review, correspondence, CSVs and complete receiving. |
| wordpress-plugin/engagement-public.js | Submissions, exact-request recovery, confirmation and private receipt actions. |
| wordpress-plugin/engagement.css | Responsive grayscale staff and public screens. |
| engagement.mjs | CLI using the original authenticated destination transport. |

The existing package-source.py includes all engagement source and this guide. DELIVERY.json identifies the selected complete source edition and every member's SHA-256.
