# Weekly cash and monthly close procedure sets

Runbooks lets a team save one procedure catalog and select a named set when it starts a period. A weekly cash review can use six procedures while the monthly close uses eight from the same edition. The period retains its selected set, procedure instructions, original files, responsibilities, preparation rounds and review decisions.

The browser calls these **procedure sets**. The JSON and typed SDK use **profiles** and **profileId**. These are optional fields in the original Runbooks records; the existing accounting workspace remains the owner of the work.

## Start with the supplied runbook

[examples/weekly-monthly-runbook.json](examples/weekly-monthly-runbook.json) is a complete editable starting point. Replace its client name, operator and responsibility note with the actual people and the firm's existing accounting instructions. Its ten procedures are arranged as follows:

| Procedure | Weekly cash review | Monthly close |
| --- | --- | --- |
| Confirm period and source files | Included | Included |
| Review cash position | Included | Included |
| Review upcoming receipts and obligations | Included | |
| Update short-term cash outlook | Included | |
| Review period cutoff and completeness | | Included |
| Complete account reconciliations | | Included |
| Review changes from the prior period | | Included |
| Prepare monthly reporting handover | | Included |
| Resolve questions needing client context | Included | Included |
| Prepare reviewer handover | Included | Included |

The starter records work performed under the firm's existing methods. Edit the instructions and resources to match the actual engagement. Each selected procedure still has its ordinary required/optional setting; a named set does not mark unused catalog procedures as completed or not applicable.

## Author and save the complete edition

Open **Runbooks → New runbook**, or open an existing runbook and choose **Create next edition**. Enter its procedures and resources. Under **Named procedure sets**, add a set, give it a clear name and description, and select its procedures.

A saved edition supports up to 100 procedures, 100 resources and 32 named sets. Each set must select at least one distinct procedure that exists in that edition. A procedure may appear in more than one set. Its order in every set follows the procedure catalog, so moving the catalog's steps also gives the next saved edition a consistent order.

The browser saves profile names, descriptions and membership with the rest of the private author draft. Removing a draft step also removes that step from its draft sets. If that leaves a set empty, choose a replacement procedure or remove the set before saving. Changes become a new edition; existing worked periods keep their original edition and membership.

To load the supplied JSON through the existing CLI, use the current original accounting workspace:

~~~sh
merchant-accounting-workspace runbooks prepare --workspace /private/client-accounting \
  --action save --input /private/weekly-monthly-runbook.json \
  --out /private/save-weekly-monthly.json

merchant-accounting-workspace runbooks execute --workspace /private/client-accounting \
  --prepared /private/save-weekly-monthly.json
~~~

Use the returned runbook and edition IDs for period creation. When the browser owns the workspace, use its existing `--url http://127.0.0.1:8446` route instead of opening a second direct workspace writer. See [the full installed Runbooks guide](../../../../stellar-forge/mcp-merchant-operator/ACCOUNTING_RUNBOOKS.md) for host configuration, file inputs and transport.

## Start the selected period

Choose **New period**, the saved runbook and the edition. The **Procedure set** selector offers **All procedures** and every named set in that edition. The preview shows the exact selected instructions before creation.

Set the period label, due date, preparer and reviewer, then select its original accountant handoff or retained client close files. Creating the period freezes both the edition and the procedure-set choice. Later changes to an edition or staff assignment do not change the period's tasks.

**Start following period** carries the prior period's set into the new draft. The new period gets its own source files, dates and fresh preparation. If an operator changes the draft to an edition that does not contain the retained set, the original choice stays visible as unavailable until they select an existing set or **All procedures**.

A file-based weekly period has this input shape:

~~~json
{
  "actor": "Actual operator",
  "runbookId": "UUID returned by the saved runbook",
  "editionId": "UUID returned by the saved edition",
  "profileId": "weekly-cash",
  "label": "Week ending 2026-10-16",
  "preparer": "Actual preparer",
  "reviewer": "Actual reviewer",
  "dueDate": "2026-10-19",
  "sourceKind": "files",
  "sourceLabel": "Original weekly cash inputs",
  "sourceNote": "Describe the actual dates and file coverage.",
  "sourceFileIds": ["UUID of an uploaded original source file"]
}
~~~

Prepare and execute this input with the existing `create` action. Omit `profileId` to use every procedure in the edition. A missing, empty or unknown named identifier is not substituted with another set.

## Prepare, review and change responsibility

The period screen, progress counts, required-task checks and reviewer exception selection all use the frozen procedure set. A request to save work for a catalog procedure outside that set is rejected.

Complete the actual selected tasks and record their supporting files and work notes. A blocked or not-applicable task needs its reason. Submission preserves the selected work as one review round. The reviewer can return it with corrections, or approve it while explicitly accepting any required blocked items and recording their explanation.

A responsibility change uses the original assignment operation. Its assignment digest includes the selected profile when the period has one, as well as the current responsible people, date, phase, work digest and preceding handover. A backup takes over the same selected tasks and retained work. Staff changes preserve the period's original procedure selection.

Private browser drafts and prepared CLI/MCP requests keep the profile choice. Recovery reconciles the original request before a retry. After an explicit unapplied response, the existing correction flow returns the saved content to its draft for review against the current workspace.

## Download, receive and continue

A selected period produces:

- A task CSV containing the selected procedures and their work. Named-set periods append **Procedure set ID** and **Procedure set name** columns.
- A printable handover showing the set's name and description, selected instructions, work, review decisions and staff handovers.
- A complete JSON packet containing the original full edition, named set definitions, selected period work, review and assignment history, supporting attachments and original close source.

The receiver validates the selected profile against the original edition, the creation record and the exact keys in every preparation and handover. Missing selected work, additional work outside the set and review exceptions belonging to other procedures fail receiving. The full catalog stays available to start later weekly or monthly periods.

Receive the complete packet through **Receive handover** or the existing `receive` action. The received period opens with its original work and selection. Start a following local period using the received edition and fresh local source files. The ordinary 8 MiB retained-file limit and 64 MiB per-period packet limit still apply.

For firms operating several original client workspaces, use the [Portfolio guide](PORTFOLIO_GUIDE.md). The client Runbooks screen and native Runbooks operations use the same procedure-set implementation.

## Installed tools and typed SDK

`merchant_accounting_runbooks_book` accepts `view: "profiles"` to page complete named sets. Its summary reports `profileCount` for editions that declare profiles. Pin the selected edition and workspace revision when reading multiple pages.

`merchant_accounting_runbooks_cycle` reports the selected `profileId` and `profileName` when present. Its `steps`, `submission_work` and `handover_work` views page only that period's selected procedures. The edition's catalog remains available through the book view.

The existing prepare/execute/reconcile sequence accepts `profiles` for `save` and `profileId` for `create`. The typed SDK exposes `ProcedureProfile`, `ProcedureProfileInput` and these optional fields:

~~~js
export async function prepareWeeklyPeriod(client, selection) {
  const profiles = await client.allBook(selection.runbookId, 'profiles', {
    editionId: selection.editionId
  });
  const weekly = profiles.items.find(profile => profile.id === 'weekly-cash');
  if (!weekly) throw new Error('Choose the weekly set in the saved edition.');

  return client.prepare('create', {
    actor: selection.actor,
    runbookId: selection.runbookId,
    editionId: selection.editionId,
    profileId: weekly.id,
    label: selection.label,
    preparer: selection.preparer,
    reviewer: selection.reviewer,
    dueDate: selection.dueDate,
    sourceKind: 'files',
    sourceLabel: selection.sourceLabel,
    sourceFileIds: selection.sourceFileIds
  });
}
~~~

Retain the complete returned prepared request before executing it. After a lost reply, use the same request with `reconcile` or `execute`.

## Existing periods and deployment

Old editions and periods without profiles keep their existing all-procedure behavior. Their assignment digests and task CSV layout remain unchanged. The updated receiver accepts their original packet shape.

Deploy the profile-capable controller, browser assets, MCP contract/controller and SDK declaration together. The browser asset manifest includes `/runbook-profiles.mjs`, the shared selection module. Receivers need this version to open packets from named-set editions; transfer the complete packet and update the receiving application before opening it.

The feature uses the original workspace lease, retained request identities, file storage, edition history and packet validation. No additional scheduling service or accounting state store is required.
