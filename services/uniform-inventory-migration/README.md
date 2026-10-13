# Uniform inventory migration workspace

This complete reusable engine retains original UTF-8 CSVs, explicit source and target mappings, reviewer corrections, exact quantities and a portable working handover. It covers locations, wearers, products, entitlements, stock, issues, returns and assets. The eight templates are header-only and contain no police, supplier or customer records.

## Source model

Identifiers remain exact strings, including leading zeros and significant whitespace. CSV parsing preserves the complete original text, byte-order mark, quoted newlines, ordered duplicate headings, empty cells and every original data record. A mapped column is a zero-based numeric index, so two headings with the same text remain independently selectable. No supplier tenant fields or API are assumed.

Each source is immutable and binds its role, domain, original filename, complete UTF-8 length and SHA-256. Its stable row ID is the source ID followed by :r and the CSV record number; the first data record is2. A CSV record may span several physical lines. Blank records and ragged rows are preserved and reported rather than dropped.

A mapping selects one complete saved source for a role/domain and records a new mapping edition. Earlier source selections remain available. A correction addresses an existing original row and numeric column, retaining the preceding value, replacement, reviewer, reason and time. Effective values are a projection over the unchanged original.

Exact decimal quantities accept nonnegative ordinary decimal strings with up to80 whole digits and18 fractional digits. Arithmetic uses integers and explicit scale. Canonical comparison treats 5.000 and5 as the same quantity while retaining both original raw strings. Units are exact source strings and must agree with the selected product and original issue. There is no guessed unit conversion.

## Complete comparison and integrity

Reconciliation reports required mappings/values, malformed quantities/dates, ragged records, duplicate exact IDs, missing or ambiguous references, location cycles, unit mismatches and reversed dates. Returns are grouped by their exact original issue. Totals are computed only when the original issue and all returned rows are valid and use the same unit. An incomplete or ambiguous group has an explicit incomplete state and no fabricated total. Compatible returns cannot exceed their original issued quantity.

Both roles use the same validation. Every canonical row and mapped field is compared, preserving source/target raw values and complete original cell arrays. Duplicate keys retain every conflicting row. Unmapped columns are compared by exact heading and occurrence and retain their original indexes. Missing source/target domains and missing keys stay visible.

The ready result means the selected source/target domains have no reported integrity errors and no row/cell differences. Unselected domains remain outside that explicit comparison; this result does not establish a supplier import or production acceptance. No closing-stock balance is inferred from an incomplete transaction period.

## JavaScript API

Import engine.mjs. Its only relative dependency is sha256.mjs, the complete maintained strict UTF-8 SHA implementation with its original MIT license.

- DOMAINS: eight definitions with label, id and fields; each field has name, label, type, required and optional reference.
- createWorkspace({id,title,createdAt}) creates the original workspace.
- importCsv(workspace,{operationId,expectedRevision,role,domain,filename,text,observedAt}) retains a full source.
- saveMapping(workspace,{operationId,expectedRevision,role,domain,sourceId,columns,at}) saves its numeric mapping.
- saveCorrection(workspace,{operationId,expectedRevision,sourceId,rowId,column,value,reason,actor,at}) appends a reviewed correction.
- Mutators return {workspace,receipt,replayed}. Replace current state only after success.
- reconcile(workspace) returns complete issues, domains, comparisons, returnTotals and summary.
- exportWorkspace(workspace) returns complete sealed portable JSON; importWorkspace(text) verifies/reopens it.
- buildHandover(workspace) returns {schema,workspaceId,revision,ready,files,manifest}. Files have path,type,text,bytes,sha256.
- parseCsv, encodeCsv, templateCsv, decimal and validateWorkspace support native callers.

The same complete original operation request returns its first receipt even after later revisions. A changed request under that ID is rejected. A new mutation requires current expectedRevision. Preserve a lost-reply request and reopen the same workspace before retrying.

Portable schema tjlabs.uniform-migration-portable.v1 contains the full tjlabs.uniform-migration-workspace.v1 plus canonical SHA-256. Hashes detect changed bytes and are not authentication signatures. Limits:32MiB per CSV,128MiB per complete portable workspace,100,000 data records/CSV,512columns,1million characters/cell,128retained sources and10,000operations. Mutations exceeding the complete portable limit are rejected while the caller's earlier workspace remains intact.

## Node CLI

Use existing Node22+; no package installation or service is needed. All paths are absolute.

~~~sh
node cli.mjs templates --out /absolute/migration/templates
node cli.mjs init --workspace /absolute/migration/workspace.json --id migration-original-001 --title "Uniform inventory migration"
node cli.mjs import --workspace /absolute/migration/workspace.json --request /absolute/migration/import-request.json --csv /absolute/original/locations.csv
node cli.mjs map --workspace /absolute/migration/workspace.json --request /absolute/migration/map-request.json
node cli.mjs inspect --workspace /absolute/migration/workspace.json
node cli.mjs correct --workspace /absolute/migration/workspace.json --request /absolute/migration/correction-request.json
node cli.mjs reconcile --workspace /absolute/migration/workspace.json --out /absolute/migration/reconciliation-r3.json
node cli.mjs handover --workspace /absolute/migration/workspace.json --out /absolute/migration/handover-r3
node cli.mjs receive --workspace /absolute/independent/workspace.json --input /absolute/migration/handover-r3/workspace.json
~~~

Save the import request before dispatch:

~~~json
{
 "operationId":"import-original-locations-001",
 "expectedRevision":0,
 "role":"source",
 "domain":"locations",
 "filename":"locations.csv",
 "observedAt":"2026-10-13T13:00:00.000Z"
}
~~~

Use its actual returned sourceId in a mapping request:

~~~json
{
 "operationId":"map-original-locations-001",
 "expectedRevision":1,
 "role":"source",
 "domain":"locations",
 "sourceId":"SOURCE_ID_FROM_ORIGINAL_IMPORT",
 "columns":{"location_id":0,"name":1,"parent_location_id":2,"active":3},
 "at":"2026-10-13T13:01:00.000Z"
}
~~~

A correction request requires operationId, expectedRevision, sourceId, rowId, numeric column, full string value, reason, actor and actual ISO at. It changes the effective projection only. Invalid quantities or unresolved references can remain as reviewed work; reconciliation continues to report them until resolved.

## Native publication and restart

Mutating commands hold the original workspace's create-only lock, write a complete private temporary file, fsync, recheck original bytes, atomically replace the workspace and fsync its directory. A lost stdout reply is recovered by replaying the exact original operation.

A terminated process may leave workspace.json.lock. Preserve an active owner. Explicit recover-lock --workspace ABS --token ORIGINAL_TOKEN checks the original host, PID namespace, boot and process before removing that exact lock. It does not guess cross-host ownership. Reopen the same workspace afterward.

Handover members are create-only and complete; exact earlier files are reused after interruption. A differing output edition is preserved and requires a new output directory. The final manifest is written last. The package includes full portable workspace, every original CSV, effective corrected CSVs, canonical source/target CSVs, full reconciliation and complete mapping/correction/operation history. CSVs preserve literal values; import them as text where a spreadsheet would otherwise execute a formula or coerce an identifier. Formula escaping would alter migration data and is not silently applied.

Receiving into a new workspace validates the complete portable input. An existing descendant with the same original identity and operation prefix is retained, including later edits. A diverged copy needs an explicit independent destination. No supplier endpoint, credential, tenant import or email send is invoked.

## Operate the actual delivered product

Before presenting a customer app or attachment, open/run/render the exact outgoing edition and personally LOOK at it. Operate populated/empty/error states, mappings, corrections, exports and independent reopening at desktop and relevant mobile widths. View captured images. Open all CSV/JSON/HTML, report pages and usable handover contents. Fix defects in this same source; source review, hashes, tests, DOM counts or a COMPLETE record do not replace using the delivered product. Retain the existing native receiving owner and source identities; no broad test sweep, new approval gate or repeat of unchanged accepted checks.

For audiovisual attachments use suitable natural generative voice/media under existing attribution/spending controls, and actually watch/listen to the final export. Preserve current owner policies, including public reusable source only and no private Git actions. A browser wrapper preserves this complete source model rather than substituting a summary or invented tenant API.
