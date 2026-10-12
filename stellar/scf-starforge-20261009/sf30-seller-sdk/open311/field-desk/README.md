# Municipal Field Desk

Field Desk takes a reviewed municipal Follow-through dispatch through named crew visits, complete files and resource entries, partial field returns, supervisor decisions and destination update packages. The browser, CLI and typed merchant provider share the same saved SQLite workspace.

Start with [INSTALL.md](INSTALL.md) for the complete installed merchant product or [WORKSPACE.md](WORKSPACE.md) for the operator interface. [MCP.md](MCP.md) describes the complete installed automation workflow.

## Original source and operating identity

Import either a complete commons.open311.follow-through-dispatch.v1 JSON file or a complete commons.open311.follow-through-workspace.v1 file. The latter retains all original request/order files and operating history. Select its actual dispatch ID when it contains more than one dispatch.

Each imported row keeps its original request, selected orders, reviewed relationship, approved work, destination columns and exact source hashes. Field Desk accepts unchanged approved work carried forward into a later Follow-through edition while preserving the work's original approval edition.

A visit has its own identity and immutable versions. Its source binding records the dispatch, request, order and approval editions. Several visits can belong to one original request. Subsequent source imports expose changed or missing source rows beside the original visit context.

Original request status and closure notes remain source data. Visit field status is planned, assigned, in_progress, completed, unable or cancelled. Supervisor approval is recorded separately against the selected visit version. A destination package names update or request_closure explicitly for each selected visit.

## Direct local commands

From this source directory with Node.js 22.13 or newer:

~~~sh
node cli.mjs init --workspace /absolute/private/field-desk
node cli.mjs inspect-source \
  --input /absolute/handover/follow-through-workspace.json

node cli.mjs import \
  --workspace /absolute/private/field-desk \
  --input /absolute/handover/follow-through-workspace.json \
  --dispatch ORIGINAL_DISPATCH_ID --name "Reviewed municipal work" \
  --request-id field-source-001 --expected-revision 0

node cli.mjs serve --workspace /absolute/private/field-desk --port 8770
~~~

Every mutation takes a stable --request-id and the observed --expected-revision. Read status before preparing a new command. A dropped response is recovered by operation --request-id and an exact repeat of the original command. A later revised selection receives a new request ID.

| Command | Input and result |
| --- | --- |
| crew-save | Named crew, members, contact details, notes and active state |
| visit-save | Source ID/key, crew, schedule, priority, instructions and field record |
| attach | Complete original --file and declared --content-type |
| package | Name, explicit visitIds and optional note |
| return-import | Complete original field-return JSON |
| decide | returnId, reviewer and selected proposal decisions |
| review | Reviewer and exact visit-version approve/return_to_crew selections |
| update | Named destination and selected current approved visit versions |
| receive | Complete editable Field Desk workspace into an empty destination |

crew-save and visit-save accept either the bare record or its named wrapper. Other command files use the corresponding fields documented in index.d.mts. Action files may include the request ID and revision; explicit CLI arguments choose those same control values.

## Crew work and resource records

A crew stores its name, named members, each member's optional role/contact, note and active state. A visit chooses that crew, source row, priority, planned start/end, due time, instructions and field record. Scheduling and actual timestamps retain explicit offsets; missing times remain null.

Field notes carry an ID, author, text and recordedAt. Resource entries carry ID, kind, name, exact decimal quantity, unit, optional unitCost/currency and note. Decimal values are strings with up to eighteen integer and nine fractional digits. For example, quantity "1.25" and unit "hours" preserve the entered precision. A missing rate stays null; an entered rate has its explicit three-letter currency.

Resource totals combine matching kinds, names and units, with monetary totals kept by currency. Original historical work-order costs remain available inside source context. Field Desk retains original attachment bytes and hashes, and reuses identical bytes while keeping declared aliases.

## Issue and receive crew work

Create a package from the explicit current visit IDs. Export kind crew-html for the complete offline editor or crew-json for its complete data. The HTML includes the issued visit baselines and selected attachment bodies. It saves local drafts, accepts original field files, and exports only selected changed visits as a field return.

A return identifies its original package and baseline visit versions. Import retains the complete original return before supervisor decisions. Review displays original, returned and current field values. Each proposal can be accepted or rejected; overlapping values offer returned/current choices. Assignment or source changes remain visible and require the applicable explicit acknowledgement. Omitted proposals remain pending.

A later edit produces a new visit version. Supervisor review applies to an exact version, so a destination update selects the version whose current approval matches. Exported update packages retain field observations, resources, source rows, original relationship decisions and selected attachments.

## Complete exports

~~~sh
node cli.mjs export --workspace /absolute/private/field-desk \
  --kind crew-html --package ISSUED_PACKAGE_ID \
  --out /absolute/handover/crew-work.html

node cli.mjs export --workspace /absolute/private/field-desk \
  --kind update-report --update SAVED_UPDATE_ID \
  --out /absolute/handover/reviewed-destination-report.html

node cli.mjs export --workspace /absolute/private/field-desk \
  --kind workspace --out /absolute/handover/editable-field-workspace.json
~~~

| Kind | Selection and complete file |
| --- | --- |
| workspace | Entire editable workspace and original files/history |
| source | sourceId; unchanged original approved dispatch or Follow-through workspace |
| crew-json / crew-html | packageId; full issued data or offline editor |
| returned | returnId; unchanged original field return |
| visits-csv | Optional source/crew/status/search filters; complete matching register |
| update-json | updateId; full source-linked destination package and files |
| update-csv | updateId; operational rows, exact resource totals and identities |
| update-geojson | updateId; source-bound locations and null geometry for unlocated rows |
| update-report | updateId; printable selected work, decisions, resources and source context |

The CLI creates private output files without replacing an existing file. Merchant exports use the maintained retained reader and can stream full bytes. The unchanged full-workspace export uses its saved timestamp, preserving its identity across reader release and process reopen.

## Source API

~~~js
import { openWorkspace } from './workspace.mjs';

const desk = openWorkspace('/absolute/private/field-desk', { create: false });
try {
  const state = desk.state();
  const first = desk.visits({ limit: 100 });
  const file = desk.exportFile({ kind: 'workspace', expectedRevision: state.revision });
  // Persist file.body as complete bytes; file.sha256 and file.bytes identify that export.
} finally {
  desk.close();
}
~~~

The public declarations in index.d.mts cover every source, crew, visit, return, decision, destination and receiving object. The HTTP server exposes the same operation model to the browser. The installed provider and client add host-selected original files, revision-aware paging and complete retained downloads.

[SOURCE_CONTRACT.md](SOURCE_CONTRACT.md) and [SOURCE_REGISTER.json](SOURCE_REGISTER.json) preserve the supplier source interpretation and original Follow-through format references.
