# Operate client closes and the firm portfolio

The firm portfolio coordinates separately owned client workspaces. Procedures, close files, preparation, review and handovers stay in each client's original Runbooks. The coordinator keeps the firm's standards, staff calendars, commissions, close plans and prepared client commands.

[Install and select the original workspaces](INSTALLING.md) first. Open the running firm at `/portfolio.html`; use **Open client desk** to work in that exact client's mounted Runbooks. All selections begin from the actual saved source.

## Commission the firm

Save the firm's name, close standard, reporting standard and cadence, and the escalation instructions used by the practice. Add the real people with stable identifiers, names, available minutes per day, working weekdays, holidays and dated time off.

These values become an immutable firm edition. Capacity is whole minutes per civil date. Later revisions retain the original edition used by an already published plan.

Each configured client alias selects one different accounting workspace. Read its actual identity, revision, saved books, periods, files and handoffs in the source panel. A coordinator can select up to 15 clients, within the existing limit of 16 accounting workspace aliases.

## Publish the client procedure edition

Open the client's original desk and create a runbook using the client's own procedure content. An edition contains:

- The client and runbook name, description and ordered tasks.
- A stable ID, title, complete instructions, required flag and selected resources for each task.
- Complete notes, HTTPS reference links and original uploaded files.

Use the actual approved recording links, notes, transcripts, close instructions and workpapers. The product retains links as links; exact uploaded reference files travel with a portable period. A recording that must travel with the handover must be supplied as an original file within the native file limit or as an agreed retained transcript/reference.

Publishing a change creates a new immutable edition. An existing period keeps the edition selected when it opened. Stable task IDs permit an exact external checklist mapping even when task titles repeat.

The task handover CSV preserves its original 12 human-readable columns and appends **Runbook ID**, **Edition ID**, **Period ID** and **Task ID**. Named-set periods also append **Procedure set ID** and **Procedure set name**. Use that identity tuple when mapping tasks into the practice's existing Double or other close-management workspace. The product supplies the complete native handover and those stable identifiers; assisted task setup and the selected external system's own import workflow remain explicit operator steps.

## Use weekly and monthly procedure sets

Use the [complete editable starter](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/examples/weekly-monthly-runbook.json) as the client's initial procedure catalog, or add named sets to its existing author draft. Preserve the real stable task IDs and edit the procedure instructions, resources and responsible people to match the engagement.

| Saved set | Starter scope |
| --- | --- |
| `weekly-cash` | Source intake, cash position, upcoming obligations, short-term cash outlook, client questions and reviewer handover. |
| `monthly-close` | Source intake, cash position, period cutoff, reconciliations, variance review, reporting pack, client questions and reviewer handover. |

An edition can declare up to 32 named sets. Each selects one or more distinct IDs from that edition's procedure catalog; execution order follows the catalog. Publishing a changed membership creates another immutable edition. Existing periods retain their edition and selection.

Choose the set when starting each new period. **All procedures** uses the complete catalog. **Start following period** retains the prior choice in the draft while requiring the new period's dates and actual source. A choice absent from the newly selected edition remains visible for correction before creation.

For the installed native CLI, copy and edit the complete supplied JSON, then retain the original save request:

~~~sh
starforge client-close runbooks prepare \
  --url http://127.0.0.1:8446 --client client-a --action save \
  --input /private/client-a/weekly-monthly-runbook.json \
  --out /private/client-a/save-procedures.json

starforge client-close runbooks execute \
  --url http://127.0.0.1:8446 --client client-a \
  --prepared /private/client-a/save-procedures.json
~~~

Use the returned runbook and edition IDs in the native `create` input. Its optional `profileId` is the selected saved set, for example `weekly-cash`; omit it to retain the all-procedure behavior. The [full native guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/RUNBOOK_PROFILES.md) includes a complete creation input, source selection, SDK paging and receiving rules.

## Save the client commission

Return to the portfolio and select the actual runbook and edition. Record the client's scope, source gaps, reporting instructions, escalation instructions and readiness note. Assign a named preparer, a different backup and the reviewer from the saved firm.

The saved commission binds the original workspace, the observed client revision, the exact full procedure edition and the firm edition. Its status records the practice's current **Discovery**, **Ready** or **Active** decision. Recommissioning retains prior editions and compares the selected current commission.

A new live read reports the client's actual current state. Commissioning history continues to show the original source observation used for that saved decision.

## Select the period's source

A period can use either of the original native source modes.

| Source | What the operator selects | What is retained |
| --- | --- | --- |
| Client close files | Upload the actual originals; choose a label, working note and the relevant file IDs. | Complete original file metadata, bytes and a digest of the selected source. |
| Accountant handoff | Select an existing handoff and its initial or exact returned revision; select a period close only when it belongs to that handoff. | The selected original accountant source, return and frozen period identity. |

Use client files for ordinary bank, billing, payroll, crypto or other close material supplied by the client. A file-based period does not require an accountant handoff. The original accounting workspace's source configuration and lease continue to own the records.

An uploaded file is limited to 8 MiB. A period can select 1–100 distinct original source files, within the complete 64 MiB portable packet limit. Reference files, work files and historical assignment/submission evidence also consume packet space. The native export reports an oversized selection before producing an incomplete packet.

The new period also selects its immutable procedure edition, label, preparer, reviewer and due date. A prior period may supply the historical link; the new period still selects fresh actual source and starts with pending work.

## Publish a workable close calendar

Add one row per client period, selecting its commissioning edition and close/review dates. Enter the expected preparation, review and backup-reserve minutes. Use the commissioned people or explicitly select the planned assignment.

A row can bind an existing original period, which supplies its own immutable procedure edition and set. For a future period, select a named set from the commissioned edition or **All procedures**; the published row fixes that choice for its native create command. It can also select its actual new source, or leave source selection until the files arrive. Creating the native period requires the real source selection.

**Preview** calculates the complete schedule against the saved firm edition and current published bookings. It works backwards from deadlines across the actual available working dates. Review is constrained to its close-to-review interval, and preparation/review allocation takes priority over backup reserve.

Review the full allocation, unused capacity, overbooked days, work that could not fit and the affected client rows. Supply a handling note for every reported conflict before publishing. This records the practice's actual resourcing decision alongside the unchanged preview.

A revised calendar names its current predecessor. The new latest edition supplies the series' capacity booking; the older plan remains available with its original sources and decisions. The calendar supports up to 200 client-period rows.

## Work and review the original close

In the client desk, record each task's actual result and attach the supporting files:

| Status | Intended use |
| --- | --- |
| Pending | Work remains to be prepared. |
| Complete | The procedure has been performed; retain the result and supporting material. |
| Not applicable | Record why the procedure does not apply to this period. |
| Open item | Record the unresolved work, cause and follow-up note. |

Preparation and progress contain only the period's frozen selected procedures. Submitting retains that complete preparation round. Required selected tasks must be complete, explained as not applicable, or recorded as open items with a note.

The reviewer can return the preparation with corrections. The preparer then edits the same period and submits another retained round. Approval retains the selected submission and review decision. Required open items must be resolved or explicitly selected as accepted exceptions with a review note.

Preparation and review notes are limited to 16,000 characters; individual work notes and task instructions support 32,000. Each book edition can carry up to 100 tasks and 100 resources. These are native field limits; full text remains available through the browser, complete client pages and packet.

## Transfer responsibility to the backup

Read the period's current assignment before preparing a handover. A handover pins the actual assignment digest and changes the preparer, reviewer or due date. Record who is receiving responsibility and the full takeover/open-items note.

The original period keeps its first assignment, every later handover, before/after responsibility and date, and the full preparation snapshot at takeover. Files used in an earlier handover remain in the packet even if later work changes.

A handover can be made during preparation, returned corrections or review. If work changed after the assignment was read, review that current work and prepare against its new assignment digest. Continue the original period after transfer.

## Prepare and execute portfolio commands

The portfolio can save client commands for procedure publication, period creation, responsibility assignment, work, submission and review. Preparation retains the complete child request before dispatch: original client workspace ID, source revision, native request UUID, action, target and parameters.

A calendar-linked period creation uses the selected row's frozen client, procedure, label, people, deadline and prior period. It then validates the real source at the client.

Select a saved command to inspect it, then execute it through the same original client writer. **Read result** reads the child's native journal without sending a mutation. A child write changes that client's revision; the coordinator revision is a separate identity.

If an uncommitted request needs correction, create its successor from the current correction-chain end. Keep the same native child UUID, client, action and target, and use the actual current source revision and corrected parameters. Both requests remain readable. The historical uncommitted command cannot dispatch after its successor is saved.

A committed original UUID recovers its actual native result. A UUID found with different bytes is a conflict to resolve from the saved source, rather than a reason to issue the same work again.

## Native CLI and typed clients

The `client-close` alias forwards arguments to the original workspace entry point. Use the running URL while its browser owner is open:

~~~sh
starforge client-close portfolio status --url http://127.0.0.1:8446

starforge client-close runbooks cycle \
  --url http://127.0.0.1:8446 --client client-a --id PERIOD_UUID
~~~

For a stopped portfolio, use `--config /private/operator/merchant-mcp.json --coordinator firm`. For a stopped standalone client, use `--workspace /private/client-a/accounting`. Those commands release the native owners they acquire.

Retain an exact request before saving a coordinator change:

~~~sh
starforge client-close portfolio prepare \
  --url http://127.0.0.1:8446 --action schedule \
  --input /private/reviewed-calendar.json --out /private/calendar-request.json

starforge client-close portfolio execute \
  --url http://127.0.0.1:8446 --prepared /private/calendar-request.json

starforge client-close portfolio reconcile \
  --url http://127.0.0.1:8446 --prepared /private/calendar-request.json
~~~

The full input and command flags are in the [native portfolio guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/PORTFOLIO_GUIDE.md). The [Runbooks guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/RUNBOOKS.md) covers file attachment, edition publication, period source, assignment, work and review requests.

Typed clients provide those same operations:

~~~js
import {connectAccountingRunbooksClient}
  from '@tokenjunkielabs/starforge-merchant/merchant/accounting-runbooks';
import {connectAccountingPortfolioClient}
  from '@tokenjunkielabs/starforge-merchant/merchant/accounting-portfolio';
~~~

The native client guides document exact connection parameters and methods. Their complete-page methods retain the source/workspace revision across the page sequence. If the source changes, start a new observation using the actual current state.

## Continue after an uncertain response

The browser saves private drafts and exact pending requests scoped to the original workspace ID. A pending request retains its route, target, request UUID and full input digest before the POST. A different workspace on the same port cannot inherit that pending write.

After a timeout or lost reply, reconcile the original operation. If it has committed, use that compact native result and refresh the current view. If no committed operation is found, keep the same request available for exact replay: an absent result after transport loss does not by itself prove that an earlier POST cannot arrive.

A native response explicitly marked `applied:false` allows correction back into a draft and preparation of a new request. Storage or commit ambiguity preserves the original request and any original reopen requirement. The CLI and typed clients use the same operation journal.

## Deliver and reopen

Download the complete period or portfolio while the original owner is available, then follow [the receiving workflow](RECEIVING.md). Preserve the original runtime profile, host configuration, client workspace IDs and packet digests.

Use the existing accounting maintenance and encrypted backup workflow for full operational backup. Period and portfolio packets serve reviewed handover and receiving; they keep their exact selected scope. Stop the original Applications/browser/MCP owner normally before another process opens those private workspaces. On reopening, inspect the same saved IDs and recover the same prepared requests.
