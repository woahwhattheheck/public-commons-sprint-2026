# Installation delivery queue

Use the delivery queue to organize the work already saved in Customer installations: choose an assignee and target date, rank priorities, connect acceptance-step prerequisites, and carry the complete operating case to another workspace.

The queue reads the latest saved edition of each installation. Its date classifies due work against those current editions. Select an actual `YYYY-MM-DD` date; omission uses the current UTC date. Earlier dates recalculate due status for the saved heads currently present.

## Assign and continue the work

1. Open the operating case and its **Customer installations** desk.
2. Open the current installation edition. Review the existing task, source, commercial terms, receiving instructions, funded assignments, workflow periods, and acceptance steps.
3. Enter the installation's delivery assignee, target date, priority, and coordination note.
4. For an acceptance step, add an override when it needs a different assignee, date, priority, or note. Choose its prerequisites from the installation's existing acceptance steps.
5. Preview the complete edited installation and save it with the current case version, installation revision, and a reason.
6. Reopen the delivery queue with the chosen date. Follow an item back to its saved installation to perform or record the work.
7. Record actual acceptance in the original step: state, observing operator, observation time, result, and the associated source, work, purchase, or outcome records.

Delivery assignments appear in the same immutable installation edition as the rest of its document. Future edits and original commercial Workshare or recurring-workflow source refreshes continue through the existing installation preview and save operation. Retain the complete source-derived fields when editing coordination.

Each installation contributes one setup row and its saved acceptance steps. Completed rows, retired installations, and closed-case work remain available in the complete report. Summary counts for open, overdue, due today, unassigned, waiting, and ready include active unfinished work.

| Queue field | Meaning |
| --- | --- |
| Assignee | The step's selected delivery assignee, falling back to the installation assignee. |
| Target date | The step's selected date, falling back to the installation date. |
| Priority | URGENT, HIGH, NORMAL, or LOW; a step may inherit the installation setting. |
| Waiting | A declared prerequisite is still in an unfinished state. |
| Ready | Active unfinished work with no unfinished declared prerequisite. |
| Recorded observation | The step's original observing operator, time, state, and result. |
| Source changed | The selected operating records, source records, or plan content differ from the saved edition's source snapshot. Open the installation to review the current source. |

A prerequisite is satisfied when its original check is **ACCEPTED** or **NOT_APPLICABLE**. Cycles, self references, duplicate prerequisites, and references to missing steps are rejected. A step's blank assignee, date, or note inherits the corresponding installation setting.

Due states are **COMPLETE**, **INACTIVE**, **UNDATED**, **OVERDUE**, **TODAY**, and **UPCOMING**. The queue's source fields identify the selected case version, plan content, and each saved installation edition.

## Edit the complete installation document

The optional `document.coordination` object uses these fields:

```json
{
  "owner": "Implementation team",
  "dueDate": "2026-10-20",
  "priority": "HIGH",
  "note": "Complete receiving and operator handover.",
  "steps": [
    {
      "checkId": "original-check-id",
      "owner": "Receiving operator",
      "dueDate": "2026-10-19",
      "priority": "INHERIT",
      "dependsOn": ["original-prerequisite-id"],
      "note": "Continue from the prepared receiving workspace."
    }
  ]
}
```

This is a coordination-field example. Select actual IDs from the document's `checks` array and dates for the current assignment. Keep the rest of the seed or saved document, including its source bindings and workflow periods.

The installation priority defaults to NORMAL. A step's priority defaults to INHERIT. An omitted date stays undated unless it inherits one. The native service normalizes steps by check ID and prerequisites by ID; it retains the associated acceptance observations in the original checks.

## Command line

Use the installed command or the source CLI. A headless command takes the original workspace lock for its operation. Close that workspace's browser server before opening it through the CLI, or use the SDK/MCP connection to the running service.

The following examples use operator-selected paths and complete IDs from the existing workspace. Create the output directory first.

```sh
starforge grant-workspace operations --workspace /absolute/private/scf-planning \
  delivery-queue --case operation-EXACT_ID --as-of 2026-10-20

starforge grant-workspace operations --workspace /absolute/private/scf-planning \
  delivery-queue --case operation-EXACT_ID --as-of 2026-10-20 \
  --output /absolute/private/output/delivery-queue.json

starforge grant-workspace operations --workspace /absolute/private/scf-planning \
  delivery-queue-export --case operation-EXACT_ID --as-of 2026-10-20 \
  --output /absolute/private/output/delivery-handover.zip
```

For a source checkout, replace `starforge grant-workspace` with:

```sh
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py
```

The read command prints the complete JSON when `--output` is omitted. File output uses the existing private publication function and returns its path, byte count, and SHA-256. Choose a new filename for a later export; the original output is preserved.

To edit assignments from the CLI, use `installation-show` to obtain the current edition, edit its complete `preview.document`, then use the existing `installation-preview` and `installation-save` commands. Supply both the current case version and the selected installation revision. [Customer installation operations](INSTALLATIONS.md) contains those full commands.

## JavaScript and TypeScript

The maintained package exports the client and its declarations from:

```ts
import {
  GrantWorkspaceClient,
  inspectGrantAgentBinding,
  type GrantDeliveryQueue,
  type GrantInstallationSaveInput
} from '@tokenjunkielabs/starforge-merchant/grant/agent';
```

A source checkout imports the adjacent `agent-client.mjs`; TypeScript resolves `agent-client.d.mts`. The declaration covers the public client, the complete delivery queue, coordination input, installation preview/save, recurring workflow source selection, and byte-preserving downloads.

Borrow the original managed application, then read a dated queue:

```ts
const binding = await inspectGrantAgentBinding({
  directory: '/absolute/private/scf-planning',
  allowStart: false
});
const client = new GrantWorkspaceClient(binding);
try {
  await client.open({ expectedSelectionSha256: binding.selectionSha256 });
  const response = await client.read('delivery-queue', {
    caseId,
    asOfDate
  });
  const queue: GrantDeliveryQueue = response.value;
  for (const row of queue.rows) {
    console.log(row.installationName, row.title, row.owner, row.dueStatus);
  }
} finally {
  await client.close();
}
```

A borrowed connection leaves the application's lifetime with its existing operator. For client-owned startup, use the existing explicit `allowStart` and managed launch workflow described in [the client guide](AGENT.md).

For a saved installation, preserve its complete document and original request before saving a changed assignment:

```ts
import { writeFile } from 'node:fs/promises';

const current = await client.read('case', { caseId });
const edition = await client.read('installation', { caseId, installationId });
const document = structuredClone(edition.value.preview.document);
document.coordination = {
  ...document.coordination,
  owner: selectedOwner,
  dueDate: selectedDate,
  priority: selectedPriority
};
const selection = {
  expectedVersion: current.value.program.version,
  installationId,
  expectedRevision: edition.value.revision,
  document
};
const preview = await client.installationPreview(caseId, selection);
// Present the complete normalized preview and its findings to the operator.
const request: GrantInstallationSaveInput = {
  ...selection,
  actor,
  note: 'Update the receiving assignment and target date.',
  requestId,
  expectedPreviewSha256: preview.value.previewSha256
};
await writeFile(requestFile, JSON.stringify({ caseId, request }) + '\n', {
  flag: 'wx', mode: 0o600
});
const saved = await client.installationSave(caseId, request);
const reopened = await client.read('installation', {
  caseId, installationId: saved.value.recordId, revision: saved.value.revision
});
```

`caseId`, `installationId`, assignee, date, priority, actor, and request ID are the caller's actual selections. Use the existing request ID and identical retained payload after an interrupted save. A definite case-version or installation-revision conflict requires reopening and reviewing the current records before making a new save request.

Download the complete queue handover as the exact returned bytes:

```ts
const handover = await client.download('delivery-queue', { caseId, asOfDate });
await writeFile(outputFile, handover.bytes, { flag: 'wx', mode: 0o600 });
```

The JSON queue's `sha256` identifies the native queue object. The response's outer `sha256` identifies the downloaded HTTP bytes. Keep the appropriate identity with the object or file you transfer.

## Merchant MCP

| Operation | Selection |
| --- | --- |
| `merchant_grant_delivery_queue` | `workspace`, `caseId`, optional `asOfDate` |
| `merchant_grant_export` | `workspace`, `kind: "delivery-queue"`, `caseId`, optional `asOfDate` |
| `merchant_grant_installation_preview` | Existing case version and installation selection, plus the complete document through `inputs` or a retained input reference. |
| `merchant_grant_installation_save` | The reviewed document and preview SHA, original request ID, actor, and reason. |
| `merchant_grant_case_import` | The complete handover file through the existing verified input route, receiving name, actor, and request ID. |

A large queue retains its complete original JSON snapshot. Read `/rows`, `/installations`, and `/owners` through the existing snapshot/row tools, preserving the returned snapshot ID and SHA across every page. The complete export remains available through the original retained-file download path.

## Hand over and reopen

The handover ZIP contains exactly:

| Member | Contents |
| --- | --- |
| `operations.zip` | The complete native case, planner history, installation editions, operating events, reviews, and original source attachments. |
| `delivery-queue.json` | The complete queue and its source identity for the selected calendar date. |
| `work.csv` | All queue rows for spreadsheet use. |
| `report.html` | The complete readable dated report. |
| `README.txt` | Opening and receiving instructions. |
| `MANIFEST.json` | Each retained member's byte count and SHA-256. |

Install the current application release on the receiving host, then import the whole handover through **Delivery operations → Import complete case** or the original CLI:

```sh
starforge grant-workspace operations --workspace /absolute/private/receiving-workspace \
  import --file /absolute/private/output/delivery-handover.zip \
  --name "Received delivery work" --actor "Receiving operator" \
  --request-id receiving-delivery-01
```

The existing receiver recognizes this wrapper, checks its reports against the native case and saved installation heads, and restores the case through the normal import transaction. Use the returned receiving case ID to reopen it. The response's `deliveryQueue` records the original handover's `asOfDate` and queue `sha256`.

A fresh queue in the receiving case uses the receiving case's identity and therefore has its own source digest. Its retained installation editions, assignments, source attachments, and recorded observations continue from the imported history. Reopen it with the returned calendar date to continue the same dated work view.

Keep the full ZIP and import request ID after an interrupted response. Retry the exact original file and request to recover the committed import. The existing 32 MiB complete handover limit applies.

## Source release

The portable distribution includes this guide and the adjacent TypeScript declaration. Its `grant/agent` export declares the types entry and retains the same JavaScript runtime entry.

The managed Python and Node launch selections both include `operations_dispatch.py`, `operations_dispatch.mjs`, and `operations_dispatch.css`, alongside the existing installation and recurring-workflow modules. Adopt the complete release, reopen its managed application, and continue the existing private workspace and request history.
