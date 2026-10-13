# Customer operating plans

An operating plan gives a customer procedure a name, useful result, owner and ordered work. It carries the selected toolkit registrations with each step, keeps saved revisions, and records the operator's progress and results.

Open **Operating plans** from Command finder. Use it for grant reporting, recurring customer deliveries, source-table preparation and monthly operating work. Each step can select an existing command, provider, runtime group or package export, or contain a manual task. Product installation continues through the original Runtime product plans; operating plans describe the work performed with that installed toolkit.

## Prepare and run a customer procedure

Start Command finder with a consistent local port so the browser reopens its saved plans on subsequent visits:

~~~sh
starforge discover serve --host 127.0.0.1 --port 8846
~~~

Open the printed address and choose **Operating plans**.

1. Create a named plan. Enter its customer, useful result, operating owner and period or recurrence. Use **Receiving and continuation** for the destination, receiving person and instructions for the next operator.
2. Search the selected toolkit and choose **Add step**. A Command finder registration also has an **Add to operating plan** link, which opens the plan workspace with that registration selected for addition.
3. Write the work to perform, inputs and locations, expected result, step owner and due date. Move steps into their operating order. Add manual steps for work performed outside a registered command.
4. Set the exact argument array when the step uses a command. A selected command initially opens its maintained native help. After reviewing that command's usage, replace the array with the intended operation and actual input paths. The display quotes each argument for a POSIX terminal.
5. Choose **Save revision**. Perform each operation in the original toolkit, then enter its recorded status, result and continuation in the plan. Save another revision when those changes are ready to hand over.

The editor stores working drafts while typing, including an unfinished command argument array. **Save revision** validates the complete edited content. A saved revision changes only when its content changes. Earlier revisions stay in **Saved history**. Choose **Continue from this revision** to prepare a new revision from historical content while retaining the later history.

The registration snapshot includes the package identity, selected entry, owning source records and all runtime groups declared by those sources, with the package versions and read state supplied by Command finder. Entered command arguments remain separate from that snapshot.

## Reopen, recover and transfer

Saved plans and drafts use IndexedDB at the listener's browser origin. Use the same host spelling and port to reopen them. A different computer, browser, profile, host spelling or port has separate storage. Browser site-data removal also removes that origin's local plans. Keep the complete JSON with the customer's normal working files for transfer and backup.

| Control | What it retains |
| --- | --- |
| Complete editable JSON | Original identity and every saved revision, including full step selections |
| Import complete plan | A new plan or later revisions extending an identical saved history |
| Keep incoming as a copy | A divergent incoming history under its own new identity |
| Save as a copy | The complete original history plus selected edited content under a new identity |
| Markdown / HTML handover | The selected saved revision, with work, results, arguments and registration details |
| Working draft JSON | A valid editable draft for the CLI edit operation, retaining its original base revision |
| Current source comparison | Per-step comparison between the selected saved revision and loaded catalog |
| Retained working drafts | Earlier local work from another editor tab or a recovery checkpoint |

Imports compare every shared revision. Reimporting the same file reuses the current plan. Importing an older prefix keeps the newer saved history. Different shared revisions remain separate through **Keep incoming as a copy**. Copies retain their source plan identity as their origin.

Each editor session saves its own draft. When another tab advances the saved plan, saving an older draft reports the conflict and retains that work. **Save as a copy** keeps its edits. **Open current saved revision** prepares the latest saved content and retains the prior draft in the recovery selector. Removing a step or continuing historical content also retains the previous draft.

Readable handovers use saved revisions; save the current work first when it belongs in the handover. The HTML export is a standalone printable document with a monochrome layout and escaped customer text. Complete JSON is the editable transfer format.

## Review work returned by another operator

Choose **Returned procedures** when the receiving operator and your own team both continued the same saved procedure. Its complete comparison retains both histories and the shared saved revision, reviews overlapping instructions, whole steps, command selections, progress and operating order, then receives the reviewed result through this original plan model.

The review retains unfinished decision text, complete returned source, recorded choices and the exact completed result. It can save into the original browser plan or produce ordinary complete plan JSON for the current receiver. The [returned-procedure guide](OPERATING_PLAN_RETURNS.md) covers browser receiving, recovery, `starforge discover plan-return`, the typed API and full handover files.

## Compare the current toolkit

**Refresh source** reads the selected package again while preserving each step's original snapshot. Opening a step shows whether the registration is unchanged, changed or absent, and identifies changed fields, source records and runtime groups. A package identity change is shown separately.

Choose **Use current registration in this draft** when the current entry is the intended replacement. Entered work, arguments, owners, progress and results stay in place. Save a revision to retain that choice; earlier revisions continue carrying the previous selection.

The comparison export contains every step, with original and current selections where available. Manual steps remain explicit. Missing registrations stay visible so another operator can continue from their original source information.

## Use the same plan through the CLI

~~~sh
starforge discover plan --help

starforge discover plan create \
  --title "Customer grant reporting" \
  --customer "Customer name" \
  --purpose "Prepare the reporting period for the receiving team" \
  --period "Monthly" \
  --owner "Operating team" \
  --receiving "Customer's existing grant workspace and delivery location" \
  --step command:grant-workspace \
  --step command:grant-source-tables \
  --out /absolute/customer/grant-plan-r1.json

starforge discover plan draft \
  --file /absolute/customer/grant-plan-r1.json \
  --out /absolute/customer/grant-plan-working.json
~~~

Edit the draft's customer fields and ordered steps in the normal JSON editor. Each step has its own stable ID. Keep its complete selection when changing instructions, arguments or results. Append the edited revision to a new complete file:

~~~sh
starforge discover plan edit \
  --file /absolute/customer/grant-plan-r1.json \
  --draft /absolute/customer/grant-plan-working.json \
  --out /absolute/customer/grant-plan-r2.json

starforge discover plan compare \
  --file /absolute/customer/grant-plan-r2.json \
  --out /absolute/customer/grant-plan-current-source.json

starforge discover plan show \
  --file /absolute/customer/grant-plan-r2.json \
  --format html \
  --out /absolute/customer/grant-plan-handover.html
~~~

Create and add read the actual selected catalog. Repeated registration selections produce distinct task steps. Use its exact registration IDs. Add --source-root DIRECTORY and --selection PRODUCT to select a maintained source edition.

~~~sh
starforge discover plan add \
  --file /absolute/customer/grant-plan-r2.json \
  --step command:discover \
  --out /absolute/customer/grant-plan-r3.json

starforge discover plan receive \
  --file /absolute/incoming/complete-plan.json \
  --existing /absolute/customer/grant-plan-r3.json \
  --out /absolute/customer/received-plan.json

starforge discover plan copy \
  --file /absolute/customer/received-plan.json \
  --title "Next reporting period" \
  --out /absolute/customer/next-period-plan.json
~~~

Create, edit, add, receive and copy require a new output path. Exports use the existing create-only writer: a temporary file is synced and linked into its new destination. Existing files are preserved.

The show action emits the complete document by default. With --revision N it emits a summary and editable draft of that historical revision; draft --revision N prepares that content against the latest saved base. The markdown and html formats render the selected saved revision. Input files and browser transfers accept UTF-8 JSON documents up to 32 MiB.

## Receive work from the original SCF planning review

The installed grant reviewer can create this same plan from its selected
native SF47 work packages. Each step keeps the package's original scope,
completion result, price, hours and relative dates. Import the resulting
complete JSON here to continue the customer's detailed operating work.

Use **Toolkit catalog JSON** or `starforge discover plan catalog --out NEW.json`
to export the complete selected toolkit for the original planning review's
registration picker. The download retains all items, original source records
and declared runtime features.

The [native grant procedure guide](../../../../stellar-forge/developer-site/GRANT_OPERATING_PLANS.md)
covers the original saved draft, native JSON/ZIP and installed command.

## Application API

The pure model is exported with TypeScript declarations:

~~~js
import {
  createOperatingPlan, createOperatingStep, snapshotRegistration,
  operatingPlanDraft, saveOperatingPlanRevision,
  compareOperatingPlan, renderOperatingPlanHTML,
} from '@tokenjunkielabs/starforge-merchant/operator/operating-plans';
import { loadCommandCatalog } from
  '@tokenjunkielabs/starforge-merchant/operator/discovery/source';

const catalog = await loadCommandCatalog();
const plan = createOperatingPlan({
  id: crypto.randomUUID(),
  title: 'Customer reporting period',
  customer: 'Customer name',
  steps: [createOperatingStep({
    id: crypto.randomUUID(),
    selection: snapshotRegistration(catalog, 'command:grant-workspace'),
    instruction: 'Open the original customer grant workflow for this period.',
    expectedResult: 'Reporting work is prepared in its original workspace.',
  })],
});
const draft = operatingPlanDraft(plan);
draft.content.steps[0].owner = 'Operating team';
const revised = saveOperatingPlanRevision(plan, draft);
const currentSource = compareOperatingPlan(revised, catalog);
const handover = renderOperatingPlanHTML(revised);
~~~

The model returns independent values and validates the complete saved history. Persisting applications should read and save the original plan in one transaction. The browser uses an IndexedDB read/write transaction; the CLI writes a new complete file. The receiveOperatingPlan function supplies the same prefix-history import behavior for other receivers.

The maintained distribution/contributions/operator-discovery.json contribution registers the typed API, command, browser source and static assets with the original Command finder component. The original builder follows that component and its asset map into selected packages.

## Grant reporting

Select **Create Grant reporting plan** to prepare a complete procedure from the original Grant case, Source Tables project, reporting period and selected toolkit. The creation interface retains complete preparation inputs and opens its result in this same plan editor. Continue with [Grant reporting procedures](./GRANT_REPORTING.md) for preparation, native work and receiving.


## Carry complete customer result files

An operating step can retain the actual report, dataset, image or other output
that the customer receives. Open that step and choose **Add result files**.
Select the complete original files; their names, media types, original byte
counts and full binary contents stay with that step. Enter a receiving note
for each file and save the plan revision.

The file's identity belongs to that step. A corrected output is a new file
selection with its own identity. Remove an obsolete file from the working
draft and add the complete replacement, then save. Earlier saved revisions
retain the original file. Removing a file or replacing the current working
draft also preserves the previous complete working draft in the editor's
recovery list.

**Download original file** returns the complete selected file without
reformatting it. Selecting an earlier saved plan revision exposes that
revision's original files. Complete editable JSON retains every saved file
and revision. The standalone HTML handover contains the selected revision's
actual file bytes behind named download links; keep that HTML with its
intended customer handover. Markdown lists each file, byte count, media type,
identity and receiving note. Its companion editable JSON or HTML supplies
the complete file contents.

The existing full-plan receiving rule includes file contents. Receiving a
later matching history carries its complete outputs. Reopening an identical
or older matching history keeps the newer current record. A divergent saved
history keeps its original complete copy through the existing conflict and
copy flow. IATI procedure packages and grant reporting plans use this same
operating model and carry the saved result files with their original native
source.

### Attach and extract from the installed command

Use the actual step ID from the original plan and choose a new output file:

~~~sh
starforge discover plan attach \
  --file customer-plan.json --step-id original-step-id \
  --attachment ./period-report.pdf --attachment ./period-data.csv \
  --note "Complete reporting-period outputs for the receiving operator." \
  --out customer-plan-with-results.json

starforge discover plan files --file customer-plan-with-results.json

starforge discover plan extract \
  --file customer-plan-with-results.json --step-id original-step-id \
  --attachment-id actual-file-id --revision 2 \
  --out ./received-period-report.pdf

starforge discover plan remove-file \
  --file customer-plan-with-results.json --step-id original-step-id \
  --attachment-id actual-file-id --out customer-plan-corrected.json
~~~

The attach action reads each whole regular file and saves one complete later
revision. Optional --media-type applies an explicitly selected media type
to that attachment batch; the default is application/octet-stream. The files
command lists metadata from the selected saved revision without printing its
encoded bodies. The extract action writes original bytes to the explicit new
destination using exclusive creation. The supplied file name never chooses
a filesystem path. Existing input and output files remain preserved.

The original browser/CLI plan limit remains **32 MiB for the complete JSON,
including every saved revision and encoded file**. Each individual input
must fit within 24 MiB before encoding, and the completed plan must still fit
the whole-document limit. The grant submission has its separate existing
16 MiB whole-draft limit, including its previous versions and original
sources. Choose complete output files appropriate to the receiving record;
larger original native workspaces remain in their maintained file delivery.
The editor checks the complete next plan before accepting new files and
retains the current working plan when that check fails.

### File API

~~~js
import {
  createOperatingFile, addOperatingFile, operatingFileBytes,
  operatingPlanDraft, saveOperatingPlanRevision, compareOperatingFiles,
} from '@tokenjunkielabs/starforge-merchant/operator/operating-plans';

const output = createOperatingFile({
  id: crypto.randomUUID(),
  name: 'period-data.csv',
  mediaType: 'text/csv',
  bytes: originalOutputBytes,
  note: 'Complete selected period.',
});
const nextDraft = addOperatingFile(
  operatingPlanDraft(originalPlan), originalStepId, output,
);
const saved = saveOperatingPlanRevision(originalPlan, nextDraft);
const originalBytes = operatingFileBytes(output);
~~~

The inspectOperatingFile function validates the complete representation and
canonical base64 padding against its original byte count. The
operatingFileSummary function returns metadata for a receiving list.
compareOperatingFiles compares complete bodies and notes and reports added,
removed and changed files plus file order; comparison metadata avoids
duplicating encoded bodies. The full step and plan retain those bodies.
Older steps have no added field and keep their exact original history.


### Review divergent returned files

Applications using the original returned-plan review carry complete output files
through the same current, returned and shared-history comparison as the work.
New reviews group a step's recorded status, recorded result and complete file
list into one reviewed value. Adding or removing an output, changing its bytes
or note, and changing file order are visible changes.

When instructions changed on one branch while the other branch changed its
outputs, review the complete step before applying the return. This keeps the
reported result and original files with the work they describe. A chosen file
list retains the exact original binary contents; removing the list restores the
step's original representation without adding an empty field.

The standalone returned-review HTML includes named original-file downloads for
the shared, current, returned and selected values, plus the completed result.
Its embedded editable review keeps both complete source histories and all
decisions. The receiving application's existing complete-document limit still
includes these contents.

New return reviews retain reportingVersion: 2 and compare complete files together with recorded progress. Unversioned unfinished reviews reopen using the maintained separate-file comparisons wherever those comparisons preserve all original explicit decisions. Completed unversioned reviews must reproduce their exact saved complete result. If the maintained comparison cannot preserve an older decision or completed result, the receiver validates the complete review against the original historical interpretation instead; it retains the original body, sources and decisions without rewriting them. Both separate file choices and grouped progress choices expose downloads of their complete validated file bytes.
