# Named staff in Grant Operations

The Team workspace gives each person a sign-in identity and a defined set of operating cases. Work, invoices, attachments, finance and delivery reviews stay in the existing Grant Operations database. The Planning & Operations application and the contributor desk read and update those same original records.

## Open the installation and enroll the team

Start the existing workspace with its normal launcher. The installation owner opens the private `open-workspace.html` link and chooses **Team workspace** in the header. The owner link opens an owner session; it does not enroll a staff profile.

Before creating a contributor sign-in, open **Delivery operations**, select the case, and add that person to its existing **Contributors** records. Their staff profile refers to that original person ID. Separate browser profiles keep private credentials and signed-in tabs with each person. Financial desks also retain their working copies by the original installation and staff identity; [Financial desk recovery](FINANCIAL_DESK_RECOVERY.md) explains same-operator sign-in renewal, earlier local copies and complete editor receiving. A person working on several cases can have a different original contributor ID in each case.

In **Team workspace → Add staff**:

1. Enter a stable staff sign-in ID and display name. IDs begin with a lowercase letter, contain 3–64 characters and accept lowercase letters, digits, periods, underscores and hyphens.
2. Select a role and either the exact operating cases or all cases.
3. For a contributor, select specific cases and their existing contributor identity in every selected case.
4. Enable **Installation administrator** only for a lead assigned to all cases.
5. Create the profile and save the one-time private access file. It contains the staff ID, code and Team address.

The person opens that address and signs in with their own staff ID and code. The original server binds to loopback. Staff on another machine use the existing host's SSH connection and forward the server's actual port to the same local port; the complete commands are in [Install, back up and recover](STAFF_INSTALLATION.md#operate-one-shared-installation).

The private owner access file remains with the installation owner. The Team access files are issued individually. A received installation starts with fresh access; its restored staff assignments remain available for code reissue.

## What each role can do

| Role | Case work | Planning and installation access |
| --- | --- | --- |
| Lead | Operate the assigned cases, including delivery, source receiving, work, invoices, cash, reviews, commercial work and customer handovers. | Review and revise plans used by assigned cases. An all-cases lead can create/import plans and cases. An explicitly designated all-cases administrator also manages staff and whole-installation backups. |
| Finance | Record contributors and work, submit work, receive/review/dispute/reopen/void invoices, record or correct cash, receive account statements, use ledger and work/invoice intake, contributor engagements, commercial billing, forecasts and portfolio allocations. | Read plans attached to assigned cases. Use the installation's shared commercial connection directory; an administrator configures those connections. |
| Reviewer | Read assigned cases, accept or reopen work, freeze case reviews and prepare original implementation, cohort and tranche-completion reviews. | Review saved plans attached to assigned cases. |
| Contributor | Use **My completed work** to save and submit their work, record their invoices, see original paid/open/credit balances, retain original work/invoice files and download their own records. | The profile's original person binding determines which records and attachments appear. |

Every HTTP request checks the current staff assignment. The case list, individual case access and plan list use that same assignment. A shared plan can be visible through more than one operating case; cases keep their original pinned revision until an explicit plan amendment is applied.

Lead, finance and reviewer profiles can read the full records and attachments of their assigned cases. The commercial connection directory belongs to the installation and is shared with lead and finance profiles. Use the contributor role for a person's restricted work and invoice desk.

The browser shows the working sections and actions for the selected role. The server applies the role and case check before calling the existing operation, including requests sent outside the browser.

## Complete work, review an invoice and record payment

**Contributor**

Open **My completed work**, choose the case and upload original work or invoice files as needed. Select **Record completed work**, choose the original package, enter the completed work, dates and hours, and attach the relevant files. Save the record, review it and select **Submit** with a note.

An original work record starts as `LOGGED`. The contributor can edit or void it while it is in that state. Submission moves it into the original review workflow. A reviewer or lead can accept or reopen it; reopening makes the same work record editable again.

For an invoice, enter the original invoice number, issue/due dates and each line's amount, work package and associated work records. Add the source invoice attachment. The contributor can edit or void a `RECEIVED` invoice. The finance operator uses the original invoice review and correction lifecycle once it advances.

The desk displays that contributor's own work and invoices. Available attachments are sources already attached to those records or uploaded by the same enrolled staff identity. The original uploaded bytes remain in the case; the source download uses the same access check.

**Reviewer**

Open **Planning & Operations → Delivery operations → Work**. Examine the submitted work and original attachments, then accept or reopen it with the original review note. The named staff actor is retained with the business event. The reviewer can also prepare the existing case, implementation, cohort and tranche-completion reviews.

**Finance**

Open the same case's **Invoices** section. Review the original invoice and its work joins, then follow the existing invoice review or dispute action. Record an observed payment through the original cash workflow and allocate it to that invoice. Use the original correction operation when a recorded cash movement needs correction.

The case remains the shared source of record. Contributors see their current invoice state when they refresh their desk. Each save retains the original request ID and checked case version.

## Coordinate simultaneous work

The contributor desk keeps an open work, invoice or source draft when **Refresh work** reads a newer case. Entered values, invoice lines, attachment selections and the selected original file remain in place. When another person changed something else in the case, the draft uses that current case version on its next save.

When the same work or invoice record changed, the desk shows its current saved values beside the retained draft. Review them and choose **Keep my draft on the current record** to apply your intended values, then save. **Cancel** leaves the current saved record in place and asks before discarding changed draft values. A submitted or otherwise advanced record must use its original review and correction lifecycle before the contributor can edit it again.

A save that reaches an older case version returns the original conflict and refreshes the same draft. Review its current status and save again when ready. A newer concurrent change still receives the server's original version check.

If a save response is lost, the submit control becomes **Receive original save**. It keeps the complete original request, version, request ID and selected upload on that page. Receiving submits that exact request to the existing transaction journal, which returns the original result if the save already completed. A work or invoice entry and an uploaded source therefore keep their original identities. The pending fields stay fixed until that response is received. If the session expired, sign in as the original contributor and receive the original save.

The page warns before closing a changed or unresolved draft. Keep it open until the original save has been received. Draft values and pending upload content are held in that page's memory; they are released after a completed save or an explicitly discarded draft.

The Team client retains compact SHA-256 fingerprints and request IDs for the same mutation body during the current page session. Completed upload bodies are released instead of being retained in the retry index. Exact replay also applies to profile changes.

A staff code is displayed once when a profile is created or a code is reissued. Replaying that request returns the saved profile and the fact that a code was issued. Use **Reissue code** if the first code was lost. The code does not appear in the retained request or event history.

## Change access or hand over duties

**Edit** changes the display name, role, case selection, contributor mapping or administrator selection. It requires the current profile revision and ends that person's existing sessions. The stable business actor created during enrollment retains the original staff ID even after a display-name change.

**Reissue code** replaces the code, enables the profile and ends its existing sessions. **Revoke** disables its access and clears the code. **Sign out sessions** closes current sessions while retaining the existing code. The owner can always reopen administration through the original private owner link.

A profile change and a business request share the workspace's original mutex. Each operation completes against one current assignment. The original business writer remains responsible for work, invoice, cash and review state transitions.

Sessions end after eight hours or 30 minutes of inactivity. The browser stores the public profile and CSRF value in memory; the opaque session is an HttpOnly, SameSite cookie with an installation-specific name. The original owner key is exchanged at sign-in and is removed from the legacy browser storage entry.

## Read history and recover the installation

**Team workspace → Access history** shows sign-ins, access changes and named operating requests. Continue with **Load next events** until the current page has no further cursor. Original case history retains the full business before/after records and named actor.

An installation administrator can choose **Download full installation**. The resulting archive includes the complete database, original attachments, roster, original scenario and required source. [STAFF_INSTALLATION.md](STAFF_INSTALLATION.md) covers backup, receiving, restoration and the original commercial-service connection.

After restoration, the new installation preserves staff assignments and business history and issues fresh sessions and access codes. The original owner key and process access link are generated by the normal launcher.

## HTTP integration

Existing trusted local agents can continue using the original owner bearer API. Browser staff use the same original operation endpoints after signing in.

| Request | Result |
| --- | --- |
| `GET /api/staff/session` | Current public principal, installation identity, CSRF token and expiry; otherwise `authenticated:false`. |
| `POST /api/staff/login` | Body `{staffId, accessCode}`; opens an individual cookie session. |
| `POST /api/staff/owner-session` | Original owner bearer header and JSON object; opens an owner cookie session. |
| `POST /api/staff/logout` | Ends the current cookie session. |
| `GET /api/staff/workboard` | Contributor's selected cases, original work, invoices, paid/open/credit balances and available sources. |
| `GET /api/staff/members`, `/catalog`, `/events` | Administrator roster, case/person choices and paged staff activity. |
| `POST /api/staff/members/create`, `/update`, `/rotate`, `/revoke`, `/sign-out` | Administrator profile changes with request identity and, after creation, expected profile revision. |
| `GET /api/staff/installation/export.zip` | Complete original installation backup for the owner or administrator. |

Cookie-authenticated writes require the server's exact Origin and the session's `X-CSRF-Token`. Context-bound named browser commands retain the enrolled actor and reject a prepared body belonging to a different actor. Existing callers without the optional context headers retain the original enrolled-actor binding. Raw case receiving likewise binds the new receiving event to the enrolled operator while preserving imported historical actors.

The original work, invoice, cash, plan and delivery request formats remain documented in [AGENT.md](AGENT.md). The browser transport is in `staff-session.mjs`; access and session state are in `staff_access.py`; HTTP authorization is in `staff_http.py`. All access tables live alongside the original business tables in `planning.sqlite3`.


## Operate the complete receiving case

The included `STAFF_WORKFLOW_RECEIVING.py` runs one complete operating walkthrough through the original local HTTP application: named enrollment, case assignments, simultaneous contributor edits, submitted work, review, multi-line invoicing, partial payments and a recorded correction. It then uses the real browser for another contribution, invoice, finance payment, final review and installation download. The same operated installation is independently restored and reopened with fresh staff access.

Run from the installed workspace source with the existing Python and Node runtimes:

```sh
python3 STAFF_WORKFLOW_RECEIVING.py --output /absolute/private/staff-receiving --node /absolute/path/to/node
```

Set `SF47_PLAYWRIGHT_MODULE` to the installed Playwright module and `SF47_CHROMIUM` to the existing Chromium executable when their paths differ from the supplied cloud runtime. The browser driver is `staff_workflow_browser.mjs`. No runtime is downloaded by this command.

A completed HTTP phase saves its private continuation context. If the browser is interrupted, continue that same case with `--resume-browser` and the same output directory; the browser reopens already-saved original work and payment references. `--skip-browser` operates the HTTP-only route when receiving that integration separately. The receiving directory contains its original operated installation, case and contributor records, browser views and the independently restored copy.

## Keep a financial desk through sign-in renewal

The in-page **Resume this working desk** dialog reopens the same installation and operator while the entered fields, original files and retained request stay in place. A different sign-in in another tab cannot rebind the open desk. Use each section's original resume control after signing in. The full workflow, ten financial editor formats, earlier-copy pickup, Customer Billing actions and Issuer Terms receiving are documented in [FINANCIAL_DESK_RECOVERY.md](FINANCIAL_DESK_RECOVERY.md).
