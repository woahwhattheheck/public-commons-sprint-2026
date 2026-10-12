# Client runbooks and period handovers

Client runbooks capture the instructions, supporting material and review decisions needed to hand a recurring close from one operator to another. They use the existing merchant accounting workspace, its accountant handoffs and original writer lease.

Open **Client runbooks** from the accounting navigation, or open /runbooks.html on the printed workspace address. Runbooks are also available through the original `merchant-accounting-workspace runbooks` command.

## Complete operating workflow

1. **Publish procedures.** Create a client runbook with a name, client, description and ordered procedures. Each procedure has a stable identifier, title, complete instructions, required flag and selected supporting resources. Resources may be an HTTPS recording/document link, a written note, or an uploaded original file. Publishing a change creates another immutable edition.
2. **Open a period.** Choose the saved edition, period label, preparer, reviewer and due date. Select an existing accountant handoff and either its original edition or an explicit returned revision. If choosing a period close, use the close already frozen into that handoff. The period retains the chosen procedures and accountant source.
3. **Prepare the work.** Record each procedure as pending, complete, not applicable or an open item. Nonapplicable procedures and open items require an explanation. Upload working files and attach them to the relevant procedure. Work remains editable during preparation and returned corrections.
4. **Hand it to the reviewer.** Required procedures must be completed, explained as nonapplicable, or documented as open items. Submitting retains the full preparation round and its handover note. Review then operates on that unchanged submission.
5. **Return corrections or approve.** Returning requires a correction note. The preparer can amend the same period and submit a further round. Approval requires every required open item to be resolved or explicitly accepted with a review note and follow-up responsibility.
6. **Deliver the close.** Download the printable handover, the procedure/task CSV, and the complete portable JSON packet. The packet contains the frozen edition, current preparation, submission/review history, every selected supporting file and the original accountant files for that source revision.
7. **Receive and continue.** Receive the packet in another existing accounting workspace. Its imported period retains the original completed work and files. Start the next local period from the received procedure edition, select the receiving workspace's actual accountant handoff, and optionally select the prior period. The new period begins with fresh pending work.

An edition published after a period opens applies to later selected periods. Existing periods retain their chosen edition. When an imported edition joins a book that already exists locally, it is retained in that book's history without changing its current latest edition.

HTTPS resources retain their original links. Uploaded resources travel as their exact selected files. The printable handover and task CSV can accompany the firm's existing close-management system; the portable packet carries the complete retained working material.

## Local CLI

Use the live server URL while the browser workspace is open:

```bash
starforge merchant-accounting-workspace runbooks status --url http://127.0.0.1:8446
starforge merchant-accounting-workspace runbooks sources --url http://127.0.0.1:8446
```

For a stopped workspace, replace `--url URL` with `--workspace /private/accounting-workspace`. The command reopens the existing workspace through its original owner and releases it on completion. The direct source entry is `node workspace/server.mjs runbooks`.

### Publish the first edition

Create a private `procedures.json` with the procedure content and actual operator:

```json
{
  "actor": "Close operator",
  "name": "Monthly close preparation",
  "client": "Example client",
  "description": "Prepare the retained settlement source for reviewer handover.",
  "resources": [
    {
      "id": "source-notes",
      "title": "Source selection",
      "kind": "note",
      "text": "Use the handoff selected for this period and document unresolved source questions."
    }
  ],
  "steps": [
    {
      "id": "source-review",
      "title": "Review the source and open items",
      "instructions": "Open the period's accountant handoff, review its retained records and attach the working notes used for preparation.",
      "required": true,
      "resourceIds": ["source-notes"]
    }
  ]
}
```

```bash
starforge merchant-accounting-workspace runbooks prepare --url http://127.0.0.1:8446 \
  --action save --input /private/procedures.json --out /private/publish-procedures.json
starforge merchant-accounting-workspace runbooks execute --url http://127.0.0.1:8446 \
  --prepared /private/publish-procedures.json
```

The saved response returns `runbookId` and `editionId`. Fetch `book --id RUNBOOK` for the complete edition. To publish a later edition, include that `runbookId` and its current `expectedEditionId` with the full revised content.

### Prepare a request, execute it and recover it

`prepare` supplies a UUID, the original workspace identity and its current revision. It retains the complete POST body, route, target and digest in a private file before sending anything. Input fields `workspaceId`, `requestId` and `revision` belong to that prepared file; action input contains the other documented fields.

Use the same `--prepared` file for execution and reconciliation:

```bash
starforge merchant-accounting-workspace runbooks reconcile --url http://127.0.0.1:8446 \
  --prepared /private/publish-procedures.json
```

A committed request returns its original compact result and revision. After a transport interruption, retain the request and execute it again if reconciliation has no saved operation. Exact replay resolves before the original workspace revision check. A response with `applied:false` permits correcting the input and preparing a new request. Commit/storage ambiguity retains the exact request for reconciliation.

| Action | Input fields besides actor |
|---|---|
| `save` | `name, client, description, resources, steps`; later editions also `runbookId, expectedEditionId` |
| `attach` | Optional `name, type`; select actual bytes with `--file` |
| `create` | `runbookId, editionId, label, preparer, reviewer, dueDate, handoffId, accountantRevisionId`; optional `periodCloseId, previousCycleId` |
| `work --id PERIOD` | `stepId, status, note, fileIds` |
| `submit --id PERIOD` | `note` |
| `review --id PERIOD` | `decision, note, acceptedExceptions` |
| `receive` | Select the complete packet using `--file` |

Dates use `YYYY-MM-DD`. Accountant revision selection is `initial` or a UUID returned by `sources`. Work statuses are `PENDING`, `COMPLETE`, `NOT_APPLICABLE` and `BLOCKED`. Review decisions are `APPROVE` and `RETURN`; `acceptedExceptions` contains selected procedure IDs.

### Deliver files

```bash
starforge merchant-accounting-workspace runbooks download --url http://127.0.0.1:8446 \
  --id PERIOD --format packet --out /private/client-close.json
starforge merchant-accounting-workspace runbooks download --url http://127.0.0.1:8446 \
  --id PERIOD --format print --out /private/client-close.html
starforge merchant-accounting-workspace runbooks download --url http://127.0.0.1:8446 \
  --id PERIOD --format tasks --out /private/client-close-tasks.csv
starforge merchant-accounting-workspace runbooks file --url http://127.0.0.1:8446 \
  --id FILE --out /private/original-working-file.pdf
```

Output files use private modes and create-only publication. Repeating a download into an existing path succeeds when its bytes are identical. A changed result needs a new filename.

## HTTP interface

All JSON responses identify the original `workspaceId` and current `revision`. POST requests use JSON and the existing `X-Workspace-Request: 1` header.

| Method and path | Result |
|---|---|
| GET `/api/runbooks` | Books, compact period summaries and retained file metadata |
| GET `/api/runbooks/sources` | Original handoffs, explicit return revisions and frozen closes |
| GET `/api/runbooks/books/:id` | Full book and immutable editions |
| POST `/api/runbooks/books/save` | Publish a complete edition |
| POST `/api/runbooks/files` | Retain base64 `content`, `name` and optional media `type` |
| GET `/api/runbooks/files/:id` | Exact original file |
| POST `/api/runbooks/cycles` | Create period from an explicit edition and accountant source |
| GET `/api/runbooks/cycles/:id` | Complete period, work and preparation/review history |
| POST `/api/runbooks/cycles/:id/work` | Save one procedure's completed work and files |
| POST `/api/runbooks/cycles/:id/submit` | Retain a complete preparation round |
| POST `/api/runbooks/cycles/:id/review` | Return corrections or approve the selected round |
| GET `/api/runbooks/cycles/:id/packet` | Complete portable JSON handover |
| GET `/api/runbooks/cycles/:id/print` | Standalone printable HTML handover |
| GET `/api/runbooks/cycles/:id/tasks.csv` | Task and procedure CSV |
| POST `/api/runbooks/receive` | Receive base64 packet `content` |
| GET `/api/runbooks/operations/:requestId` | Original committed request kind, target, digest and compact result |

Every mutation includes `workspaceId, requestId, revision, actor`. The request digest is SHA-256 over UTF-8 canonical JSON of `{kind,target,input}`, with sorted object keys, preserved array order and no final newline. `input` is the entire unchanged POST body. The target is the period ID for work, submit and review; it is `null` for the other actions.

Kinds are `edition_saved, file_retained, cycle_created, procedure_saved, preparation_submitted, review_saved, packet_received`. Accepted results retain IDs and file/receiving metadata. Clients fetch the complete current book or period after a saved or reconciled mutation. This keeps the operation journal proportional to work performed.

## Storage and receiving

Runbooks live in the existing `workspace.json`. Supporting files are content-addressed beneath `runbooks/files`; received complete packets are retained beneath `runbooks/packets`. All state changes use the original serial writer and workspace commit. New bytes are fully written and synchronized before create-only publication.

A portable packet verifies its canonical content, every attachment, each preparation/review join, its original accountant handoff/return, and the report/manifest/input/close/adjustment bytes selected by those original records. Exact packet replay reuses the received period. The same period ID with different content requires resolving the existing selection.

Operational limits are 8 MiB per supporting upload, 64 MiB per complete portable packet, 100 procedures/resources per edition, 200 runbooks, 200 retained editions per book, 2,000 periods/files and 20,000 compact operation entries. The underlying workspace retains its existing 32 MB state limit. Keep long recordings at their source URL, retain the working instructions in the procedure, and include the original files needed by the next operator.

The browser keeps procedure, period, work, review and receiving drafts in its local IndexedDB, scoped to the original workspace and selected record. A retained pending request is reconciled against its original kind, target and digest before the browser accepts a committed result. The next operator receives the same complete period and opens the next close from its retained procedures.
