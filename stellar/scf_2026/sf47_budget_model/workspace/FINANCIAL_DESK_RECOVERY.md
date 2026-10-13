# Financial desk recovery for named staff

Grant Operations keeps each open financial desk with its original installation and named operator. A session can expire while a person is mapping a statement, correcting an invoice, preparing a cash observation, or reviewing a customer billing action. The recovery dialog reopens that same sign-in while the entered fields, complete selected files, and original prepared request stay in the desk.

Open **Team workspace** to sign in and then **Planning & Operations → Delivery operations**. Select the assigned case and its financial section. The header identifies the current person. Current role and case assignments continue to determine the available operations.

## Resume the desk after sign-in expires

When an original request needs a renewed sign-in, the page opens **Resume this working desk**. It shows the operator and installation that opened the desk.

1. Enter that operator's access code. The installation owner uses the original private owner key.
2. Choose **Sign in and resume**. If that same sign-in has already been reopened in the separate Team tab, choose **Use my restored sign-in**.
3. Continue in the retained form. Where an action has already been prepared, use that desk's **Resume**, **Receive original save**, or **Resume original action** control.

The sign-in itself does not submit a business command. A desk's resume control uses its retained request identity and complete original body. An accepted native operation returns its original result through the existing receiving path.

**Keep this desk open** closes the dialog and returns focus to the original page. The password field is cleared. A link in the dialog opens Team workspace in a separate tab without replacing the current editor. Parallel failed reads leave an already-open sign-in form and its entered code intact.

A revoked profile or changed case assignment still uses the installation's current access rules. Reopening a session updates access; it does not alter those assignments.

## Work across tabs and operators

A mounted desk captures the installation and staff identity before dispatching a request. Another tab signing in or signing out invalidates the cached session, while the first desk keeps its original operator. Its next request either continues with that operator or opens recovery.

Signing in as another person does not relabel an existing prepared request. Download its complete recovery copy and reopen it with the original operator. The owner can retain a deliberately selected original recording actor through the existing owner interface.

Each of the following financial editors has its own stored working copy for the selected installation, named staff profile, and original case:

| Financial section | Retained working input |
| --- | --- |
| Account statements | Complete original statement, interpretation, mapping, row decisions, preview, and original import or accepted response. |
| Supplier accounts | Account and period selection, supplier/work/invoice/cash draft, original attachments, and pending command. |
| Work / invoice intake | Complete source file, source settings, every editable mapping and correction, and upload/save/apply request. |
| Cash / issuer | Account selection, original cash and correction drafts, local revision, and prepared command. |
| Account reconciliation | Original statement and cash selection, editable resolution, period and edition selection, and prepared operation. |
| Bulk ledger intake | Complete input document, source files, pending atomic intake, and saved draft revision. |
| Merchant settlements | Complete native period-close input, original source archive, selected attribution, corrections, and request history. |
| Cost funding | Every local allocation draft and its separate complete prepared, returned, and accepted request records. |
| Issuer terms | Original issuer message, selected parts, editable terms and native planning inputs, unfinished JSON fields, and pending receiving or commission action. |
| Customer billing | Saved customer and installation selections, entered milestone fields, schedule, previews, and original customer action. |

Native case IDs, source IDs, archive identities, request bodies, accounting rows, and portable case formats retain their original meanings. Existing draft revision checks and write queues continue to protect the desks that already use them.

## Open an earlier browser copy

Earlier versions kept some financial drafts under a shared browser key. Those original copies remain available.

Expand **Earlier local … copy** in the intended financial section, then choose **Inspect earlier copy**. The page describes the selected source or draft and whether an original action is pending. Inspection selects one complete copy; a later button continues to refer to that inspected copy.

Use **Download complete earlier copy** to retain the original input. **Open this copy** receives it into the currently selected operator's desk through the same complete editor-receiving path. The earlier copy remains available at its original location. The existing current-desk download or reconciliation behavior preserves the current working input before replacement.

A named operator cannot adopt an actionable pending body recorded for another actor. The complete earlier copy remains downloadable, and the original actor can reopen it. Already accepted historical source records retain their recorded actors.

The complete draft download/import controls also work between browser profiles. For a different operating case, receive its original complete case first, then open the corresponding editor copy. Cash, Reconciliation, Settlement, and Ledger provide their existing native source and complete-desk receiving controls.

## Issuer correspondence and planning

**Issuer terms → Open complete local draft** opens the same full JSON produced by **Download local draft**. It retains the original message bytes, selected original message parts, terms editions, parked drafts, native plan input, unfinished JSON text, and pending original operation.

The receiver checks the original case and plan before changing the current desk. Opening another draft first downloads the current visible fields. Its pending operation must still use the original issuer correspondence, terms-save, or plan-commission route. Original native previews and review confirmations remain part of the normal save workflow.

The earlier-copy picker uses this same receiver. No issuer stage, award amount, planning revision, or source observation is inferred from a staff sign-in.

## Customer billing and original actions

**Customer billing → Complete billing desk** offers a complete editor download and reopen. Its file carries the entered milestone fields, current schedule, customer and installation selection, saved previews, and retained original action.

Preparing an accounting connection, saving the reviewed billing schedule, and creating or issuing a milestone invoice now retain the exact original endpoint and body before dispatch. When the response is interrupted or access expires, **Resume original action** continues that original request and reopens its saved customer records. The existing native milestone draft/issue recovery still supplies the original invoice operation.

A definite input or version rejection keeps the original attempted body in **Download original action** and returns the entered fields for correction. Access changes and an uncertain response retain the pending action for original receiving. Saving a new schedule still uses the original reviewed installation and native schedule fingerprint.

## Restore an installation

A full installation restore preserves the original business database, requests, attachments, roster, and staff assignments. Its native receiving procedure creates a new installation identity and fresh access.

An open tab for the earlier installation keeps its original working copy. It cannot silently send that copy into the newly restored installation. Download the complete editor copy, open the restored installation with its fresh access, select the retained original case, and receive the editor copy there. Its original request body and business journal determine the result.

See [STAFF_INSTALLATION.md](STAFF_INSTALLATION.md) for the full installation receiver and [STAFF_ACCESS.md](STAFF_ACCESS.md) for named roles and assignments.

## Local client integration

The public session response includes `installationId`. The browser keeps it and the named staff ID in memory, separate from the opaque HttpOnly session cookie and the CSRF token.

A context-bound local client sends:

- `X-Grant-Staff`: the original mounted staff ID.
- `X-Grant-Installation`: the original installed workspace identity.
- `X-CSRF-Token`: the current native CSRF token for a cookie-authenticated write.

The server checks the original context before the existing role, case, and writer routes. These headers bind a request to its intended context; authentication and current permissions still come from the original staff session.

A context-bound named command must retain the enrolled actor. A differing pending actor produces `STAFF_REQUEST_ACTOR_CHANGED` before writing. `STAFF_IDENTITY_CHANGED` and `STAFF_INSTALLATION_CHANGED` preserve the old live desk for recovery. Existing trusted bearer clients and callers without the optional context headers keep their prior contract.

`staffRequest` captures a JSON body or replayable byte body before session renewal. It performs at most one same-body retry after the native pre-writer unauthorized or CSRF response. A network interruption remains with the original desk's receiving workflow. Public operator metadata can be used for draft selection; credentials are kept out of those stored copies.
