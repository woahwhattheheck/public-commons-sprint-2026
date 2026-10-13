# Catalogue correction through CLI and MCP

This guide covers the installed command and agent interfaces for the DCAT correction workbench. The [browser guide](CORRECTION_WORKBENCH.md) explains the same saved drafts, typed JSON navigation, exact edits and revision history. Both interfaces use the original project model and its single operation owner.

A correction draft begins with a retained catalogue or an actual migration candidate. Each edit appends an attributed revision. Materializing a revision retains its exact document as another catalogue in the original workspace; the operator then prepares a migration review with that candidate. Draft creation, editing and materialization do not select a release, approve identity mappings, run semantic validation or change an accepted edition.

The complete workspace archive carries correction sources, every revision document and record, pending request identities, materializations, catalogues, migration reviews, semantic work and release history. Use the original archive receiver and reopen the received project to continue editing under its new local owner.

## Select the existing owner

The command examples use `starforge dcat` from the installed catalogue product. A checkout can invoke its original `dcat-cli.mjs` directly with the installed Node runtime.

A standalone correction command opens the original workspace lease, waits for its operation, prints the completed result and closes the owner. Close a separately running browser or Applications owner before using that form. To edit while the managed merchant/browser owner is running, use its existing MCP connection or browser. The agent tools call that same model and lease; they do not start another project or listener.

In Applications, select **DCAT catalog workspace** for browser work, or the existing **CKAN data merchant** entry with its declared connection/workspace alias for combined browser and MCP work. The source selection now binds the correction domain, parser, browser, CLI and guides. A received project continues through the existing Applications preparation and saved setup flow. Original private environment and semantic runtime selection remain unchanged. Reading or editing correction documents does not require the migration Python interpreter; a subsequent migration or semantic run uses its separately configured runtime.

The examples use these placeholders:

| Placeholder | Obtain it from |
| --- | --- |
| `PROJECT` | The original private workspace directory |
| `CATALOG` / `SOURCE_HASH` | The retained catalogue and exact SHA-256 from `dcat status` |
| `REVIEW` / candidate hash | An existing complete migration review with actual candidate bytes |
| `DRAFT` | The correction ID returned by creation or correction list |
| `HEAD` / `DOCUMENT_HASH` | The current revision and document SHA-256 returned by correction get |
| `REQUEST` | A newly generated UUID saved with the complete intended mutation |
| `OPS` / `OPS_HASH` | The complete ordered operations file and its inspected SHA-256 |
| `REVISION` | One selected saved correction revision, which may be historical |

Do not invent a candidate for a review whose conversion failed without candidate bytes. Create a draft from its retained original catalogue if appropriate, or select another actual candidate.

## Read the source and create a draft

List the retained catalogues and reviews, then inspect the exact source chosen for correction:

```sh
starforge dcat status --workspace "$PROJECT"
starforge dcat export --workspace "$PROJECT" --kind original --catalog "$CATALOG" --out /absolute/review/original.json
```

Creation requires a stable request UUID, the source hash, an editor and a reason:

```sh
starforge dcat correction-create --workspace "$PROJECT" \
  --request "$REQUEST" --kind catalog --catalog "$CATALOG" \
  --source-sha256 "$SOURCE_HASH" --label "Reviewed catalogue corrections" \
  --author "Catalogue editor" --note "Correct the fields identified in the saved review."
```

To begin from a migration candidate, use `--kind candidate --review "$REVIEW"` and its exact candidate hash. Supply only the selector belonging to the chosen kind. A successful creation returns the draft and its initial revision; the initial document preserves the selected source bytes.

```sh
starforge dcat correction-list --workspace "$PROJECT" --offset 0 --limit 50
starforge dcat correction-get --workspace "$PROJECT" --correction "$DRAFT"
starforge dcat correction-inspect --workspace "$PROJECT" --correction "$DRAFT" \
  --revision "$HEAD" --pointer /dataset/0 --offset 0 --limit 50
```

Inspection reports the actual JSON type, exact literal when within the display limit, and children with their pointers. Follow `nextOffset` until it is null. A large literal remains available in the complete document; an unavailable inline value is not an empty value. Root selection uses the empty pointer. Escape `/` as `~1` and `~` as `~0` inside pointer segments.

List query matches the saved draft label, author and original source ID. Inspect query filters children of the selected node. Neither is a whole-document replacement for downloading the original file.

## Prepare exact ordered edits

An operations file is one UTF-8 JSON array. Each `valueText` is a string containing an entire JSON literal. This outer string prevents a JSON transport from rounding catalogue numbers or changing structured identifiers.

| Intended value | `valueText` in the operations JSON |
| --- | --- |
| JSON string `Updated title` | `"\"Updated title\""` |
| Integer beyond binary floating-point precision | `"9007199254740993"` |
| Decimal whose original digits matter | `"0.12345678901234567890123456789"` |
| Boolean | `"false"` |
| JSON null | `"null"` |
| Structured identifier | `"{\"notation\":\"retained-local-id\"}"` |
| Array | `"[\"en\",\"fr\"]"` |

The value must fit the actual selected catalogue field and profile. The correction parser checks JSON syntax and edit structure; schema validity and conservation are determined by the subsequent original migration review.

For a field confirmed by inspection, an operations file can contain:

```json
[
  {
    "op": "replace",
    "path": "/dataset/0/title",
    "valueText": "\"Updated title\""
  }
]
```

Supported operations are:

| Operation | Fields | Behaviour |
| --- | --- | --- |
| `add` | `op`, `path`, `valueText` | Add a member or array element using the exact supplied literal |
| `replace` | `op`, `path`, `valueText` | Replace the selected existing value |
| `remove` | `op`, `path` | Remove the selected existing member or element |
| `move` | `op`, `path`, `from` | Move the selected original value within the document |

Operations run in order. Earlier array insertions/removals can change later index meanings. Inspect and preview the complete ordered request before saving. Duplicate object keys, invalid pointers and invalid operation fields are rejected. The catalogue remains a JSON object. Unrelated document bytes and numeric tokens are preserved by textual edits.

The installed interface accepts 1–1,000 operations; an operations file is at most 32 MiB. A correction document is at most 128 MiB, and a retained revision record is at most 32 MiB. A request may be rejected when its complete attributed before/after record exceeds that limit even if its source document is smaller. Large replacements are still explicit complete literals, never an automatic approximate-number conversion.

Hash the complete operations file with the host's SHA-256 utility and retain that file unchanged with the request. Preview binds the inspected head and document:

```sh
starforge dcat correction-preview --workspace "$PROJECT" --correction "$DRAFT" \
  --expected-revision "$HEAD" --document-sha256 "$DOCUMENT_HASH" \
  --operations "$OPS" --operations-sha256 "$OPS_HASH"
```

The result includes every before/after change, the resulting document byte count and `documentSha256`. Read those complete values before saving. Save can bind that resulting hash as well:

```sh
starforge dcat correction-save --workspace "$PROJECT" --request "$REQUEST" \
  --correction "$DRAFT" --expected-revision "$HEAD" --document-sha256 "$DOCUMENT_HASH" \
  --operations "$OPS" --operations-sha256 "$OPS_HASH" --result-sha256 "$PREVIEW_HASH" \
  --author "Catalogue editor" --note "Apply the inspected correction."
```

A changed current head or source document fails its guard. Reinspect and deliberately prepare a new request when accepting another editor's changes; do not silently substitute today's head into an old request.

## History, restoration and materialization

`correction-get` returns the complete metadata, revisions and materializations. Download an exact document or its full attributed revision record:

```sh
starforge dcat correction-export --workspace "$PROJECT" --correction "$DRAFT" \
  --revision "$REVISION" --kind document --out /absolute/review/corrected.json
starforge dcat correction-export --workspace "$PROJECT" --correction "$DRAFT" \
  --revision "$REVISION" --kind revision --out /absolute/review/revision.json
```

Exports verify the complete retained bytes and publish the output as a new file. Choose a new output path if it already exists.

Restoration appends a new revision with the selected earlier document. It retains the intervening history:

```sh
starforge dcat correction-restore --workspace "$PROJECT" --request "$REQUEST" \
  --correction "$DRAFT" --expected-revision "$HEAD" --document-sha256 "$DOCUMENT_HASH" \
  --target-revision "$EARLIER_REVISION" --author "Catalogue editor" \
  --note "Restore the inspected earlier document."
```

Materialization can use any exact saved revision and its document hash. It does not require that revision to be the current head:

```sh
starforge dcat correction-materialize --workspace "$PROJECT" --request "$REQUEST" \
  --correction "$DRAFT" --revision "$REVISION" --document-sha256 "$REVISION_HASH" \
  --profile 3.0 --label "Corrected candidate for review" \
  --author "Catalogue editor" --note "Retain this exact revision for the migration review."
```

The completed materialization returns `catalogId`, exact hash/bytes and `migrationSourceId`. Prepare the original migration review using those actual IDs:

```sh
starforge dcat review --workspace "$PROJECT" --source "$MIGRATION_SOURCE" \
  --candidate "$MATERIALIZED_CATALOG" --label "Review the corrected edition"
```

Supply an original mappings file or comparison catalogue only when that review actually calls for it. Correction edits do not silently reuse or approve identity decisions. An identifier can be a structured JSON value; preserve its exact type in any explicit mapping.

Inspect the resulting full report, validation errors, record conservation and field changes. The existing cutover operation separately requires its reviewed candidate and active-release guard. Semantic validation/comparison remains a separate interpretation with explicit profile/context and operator decisions. See [migration operations](MIGRATION_OPERATING.md), [semantic validation](SEMANTIC_CATALOGS.md) and [saved comparison](SEMANTIC_COMPARISONS.md).

## Agent tool sequence

All tools begin with `merchant_ckan_dcat_correction_` and use the existing `workspace` alias. They are registered in the original merchant MCP provider; no new MCP service or project lease is introduced.

| Suffix | Complete purpose |
| --- | --- |
| `list` | Page draft summaries and pending request identities |
| `get` | Inspect draft identity and independently page revisions/materializations |
| `metadata_read` | Read the complete inspected metadata/history JSON |
| `inspect` | Read a typed node and page its children at an exact saved revision |
| `preview` | Preview exact ordered edits with before/after values and result hash |
| `preview_read` | Read the complete inspected preview JSON |
| `create` | Create a source-bound correction draft |
| `save` | Append an attributed edited revision |
| `restore` | Append a restoration of a selected earlier document |
| `materialize` | Retain an exact revision as an ordinary candidate catalogue |
| `files` | Select a complete document or revision record by retained identity |
| `file_read` | Read that exact file through the original pinned chunk reader |

Before a mutation, call `merchant_ckan_status`. Set `expectedOperationId` to its current `native.operation?.id ?? null`. The domain `requestId` is a different identity: it remains stable for this correction mutation and supports replay. The launch returns the original `operationId` plus allocated `correctionId`, `revisionId` and, for materialization, `catalogId`. Follow status to the terminal operation and inspect its state and result. A returned operation ID is admission, not completed work.

Keep a written request record before invoking a mutation. Preserve the complete domain fields, exact operations and hashes. When retrying through MCP, obtain the current operation baseline again; this updates only the outer `expectedOperationId`, not the saved correction request.

### Configure an operations input

For larger edits, add an original host-declared input to the existing workspace connection's `inputs` object:

```json
{
  "catalogue_edits": {
    "file": "/absolute/private/catalogue-edits.json",
    "label": "Inspected catalogue edits",
    "kind": "dcat-corrections"
  }
}
```

This is a fragment of the existing connection, not a second configuration service. The original private-file checks apply. Use `merchant_ckan_inputs` to inspect its exact bytes and SHA-256.

Preview and save accept exactly one of:

- `operations`: the complete inline array with literal `valueText` strings; or
- `operationsInput` plus `expectedOperationsSha256`: the declared alias and its inspected file hash.

Use the host alias when the complete edits exceed the transport's existing request limit. This capability does not increase the MCP server's request limits. The adapter reads and checks the original file, then passes the complete ordered array to the same correction model.

A preview call has this structure:

```json
{
  "workspace": "catalogue_project",
  "correctionId": "<actual-draft-UUID>",
  "expectedRevisionId": "<actual-current-revision-UUID>",
  "expectedDocumentSha256": "<actual-document-SHA256>",
  "operationsInput": "catalogue_edits",
  "expectedOperationsSha256": "<actual-operations-file-SHA256>",
  "offset": 0,
  "limit": 25
}
```

Save adds the current `expectedOperationId`, a stable `requestId`, `author`, `note` and optionally `expectedResultSha256` from preview. Large integers never belong in a parsed numeric `value` field; the supported edit field is the exact string `valueText`.

### Page and download complete results

Correction list, inspection and preview use `offset`/`limit`; tool limit is 1–100. CLI/domain list and inspection allow up to 200. `get` pages revisions and materializations independently with `revisionsOffset` and `materializationsOffset`. List `pendingOffset` pages all pending identities independently of the draft query.

Agent presentation bounds do not truncate the original files. An oversized row is marked explicitly and points to the complete download. A large inspected literal has `literalComplete:false` and its complete document selector. A preview returns `completeFile` with the full before/after JSON; use `preview_read` rather than treating the displayed subset as the complete edit.

`metadata_read` and `preview_read` use the same SHA256-pinned retained reader as other merchant files. On the first preview read, provide the same exact revision guard and operations selection. When the preview used inline operations, pass that array again; it is not echoed back inside the download selector. Retain `readId`, the same expected hash and `nextOffset` for every later chunk. A new first read of changed metadata or changed source fails its old hash rather than returning a different history under that identity.

For `files`, an omitted revision selects the head once. Its returned `file_read` selector includes the actual revision UUID; reuse it for the entire read. Retained document/revision files are streamed from an opened read-only descriptor and verified by the original file reader. The complete final chunk releases the read. Use `merchant_ckan_file_release` to close an abandoned read. Process-local read IDs do not survive a closed owner; reselect the same saved file/hash and restart from the recorded offset.

Complete metadata and preview reads use the original copied-snapshot reader and its existing capacity budget. Finish or release other reads if the owner reports capacity exhaustion. The original documents and individual revision records remain available through `files`/`file_read`, with no substitute or empty-success response.

## Recover an uncertain mutation

1. Keep the original request UUID and complete submitted domain body. Do not assign a new UUID merely because a connection ended.
2. Read the original operation status. If it is active, follow that operation rather than launching another.
3. Inspect the correction list/get and its retained pending request identity. Creation uses `correctionId=requestId`; save/restore use `revisionId=requestId`; materialization uses `catalogId=requestId`.
4. If completion exists, inspect its exact saved revision or materialization. The identical request can replay its complete result.
5. If the request is interrupted or only its pending prefix exists, resubmit the same body and UUID through the original owner after it is available. Keep the selected operations file byte-identical. The domain checks retained request identity and owned partial bytes.
6. A changed body under the same UUID is rejected. A stale current-revision guard is a request conflict, not permission to overwrite another editor's work. Reconcile the actual saved history before intentionally making a new request.

A replay still creates an ordinary short workspace operation to return the retained result. For MCP, its outer operation baseline is refreshed from current status; the correction request identity stays fixed. Keep author/note spelling, profile, label and optional result hash unchanged along with the edits.

## Complete portable handover and independent continuation

Export through the existing workspace owner:

```sh
starforge dcat archive --workspace "$PROJECT" --out /absolute/delivery/catalogue.ckanw
starforge dcat inspect-archive --file /absolute/delivery/catalogue.ckanw --sha256 "$ARCHIVE_HASH"
starforge dcat receive --file /absolute/delivery/catalogue.ckanw \
  --sha256 "$ARCHIVE_HASH" --workspace /absolute/private/received-catalogue
```

The agent route is the existing `merchant_ckan_workspace_archive`, then its inspect/read/receive tools and target alias. Read back the actual archive SHA-256; do not infer it from a prior export. Close the current owner before standalone receive/CLI reopening where its lease requires that.

On the recipient host, open the received project with its original CLI, browser or saved Applications setup. List the drafts, inspect historical and current revisions, download the complete original document and revision records, and confirm materialized catalogues and migration reviews remain available. New local edits use new request IDs and explicit current-head hashes. Restoration appends history; it does not erase sender or recipient revisions.

The catalogue archive transfers saved product state. It does not install a Python environment or move the sender's private environment file. Use the existing [portable semantic runtime transfer](SEMANTIC_RUNTIME_TRANSFER.md) if native semantic execution is needed on the receiving host, and the original [migration runtime setup](DCAT_ENGINE.md) for migration runs. The prepared runtime receiver installs into its selected stable private location using retained source/wheels and verifies its receipt. Historical report and correction inspection remain available independently of semantic interpreter setup.

## Actual customer use and delivery status

The published correction source and source-level interface checks are engineering delivery. They do not establish that this new correction course has run on the queued customer host. The original 344-record GSA migration observations retain their original scope; later correction-browser, semantic, runtime-transfer and independent receiving work needs its own actual completed result.

Before presenting this version as ready for a client or prospect, the producing seat must open the exact installed version and use it. Inspect the rendered desktop and narrow views; create a source-bound draft, navigate typed values, preview and save an actual correction, inspect history, materialize the exact revision and reopen its review. Download and open every supplied attachment as a recipient, receive the actual complete archive and reopen it independently. Look at the resulting screens and files and repair visible defects. Source reading, HTTP calls, DOM assertions and peer approval do not replace that use.

When the existing equipped worker is unavailable, preserve the complete source and the original queued operation without claiming a completed native or browser run. Do not launch a competing receiving operation solely to create a second receipt.
