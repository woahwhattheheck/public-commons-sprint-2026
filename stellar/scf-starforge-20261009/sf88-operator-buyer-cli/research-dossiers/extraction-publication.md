# Research extraction tables and publication editions

This module turns the original Research dossier’s extraction records into authored evidence tables and complete publication editions. A publication contains every selected original result record, its source bindings, the exact authored column definitions, and the operator’s review context. Later results, corrections, impact reviews and withdrawals preserve that original edition.

Use the existing Research workspace, dossier transaction and portable receiving paths. The publication layer adds five source files under the same research-dossiers directory and one append-only state field, `extractionPublicationEvents`.

## Complete operator workflow

1. Open the current dossier and its extraction results. Select the logical results and the exact retained editions needed for the table.
2. Author the table’s name, purpose, question scope and columns. Each column reads a JSON pointer against the original result’s `record`.
3. Read the current source, form and result changes and the unresolved extraction statuses. Save a publication with the selected result IDs, edition IDs and fingerprints, plus the current review fingerprint and an operator note.
4. Export the complete publication as JSON, CSV, Markdown or HTML. The authored table is accompanied by its complete engine records, sources and review history.
5. When work changes, inspect the publication’s current impacts. Record an impact review, revise the table definition when needed, and publish a following edition with an explicit correction reason.
6. Compare the two publication editions. Keep both editions and every original value. Withdraw an edition by recording a reason when that is the intended action.
7. Continue in another operator workspace using the original complete dossier export and receiving path. Its publication state is validated and its original mutations are replayed against the preceding extraction context.

A selected row can be NOT_EXTRACTED, NEEDS_REVIEW, DISAGREEMENT, READY_FOR_RESOLUTION, STALE_RESOLUTION or RESOLVED. Publication preserves that status and the complete underlying submissions. There is no required RESOLVED status. The review fingerprint detects a changed context between reading and saving.

## Authored definitions and exact values

A table definition has this shape:

```json
{
  "name": "Study evidence",
  "description": "The selected retained study results and their original sources.",
  "questionIds": [],
  "columns": [
    {"id": "study", "label": "Study", "pointer": "/row/label", "format": "text"},
    {"id": "status", "label": "Result status", "pointer": "/status", "format": "text"},
    {"id": "sample", "label": "Sample size", "pointer": "/values/sample-size/value", "format": "typed"},
    {"id": "sample-status", "label": "Sample status", "pointer": "/values/sample-size/status", "format": "text"},
    {"id": "sample-basis", "label": "Sample source", "pointer": "/values/sample-size/bases", "format": "json"}
  ],
  "notes": "Field IDs in these column pointers must match this dossier’s authored extraction form."
}
```

The example defines columns; it does not supply study results. Select real field IDs from the existing form and real result editions from the original API.

An empty `questionIds` list accepts selected results across the dossier’s questions. A nonempty list restricts this table to those existing question IDs. A table contains 1–100 columns with distinct IDs. The optional description, notes and column descriptions normalize to empty strings, the question list normalizes to an empty list, and an omitted column format normalizes to `text`.

Pointers follow RFC 6901: `/` separates object members, `~1` represents a slash in a member name and `~0` represents a tilde. The empty pointer selects the complete record. Array positions use zero-based integer tokens. A missing pointer is recorded as `{present:false,value:null}` and displayed as “(missing pointer)”; a present JSON null remains a present null. Neither becomes a reported study value.

The column formats are:

| Format | Display |
| --- | --- |
| `text` | Original strings as text; other JSON values in their exact JSON representation |
| `typed` | Original two-part tagged values as `[tag] JSON-payload`; other values retain their JSON representation |
| `json` | Complete JSON for the selected value |

Numeric answer tokens remain strings under the original extraction engine’s tags. This layer never converts them to a JavaScript number. The registry value `["str","NA"]` remains that exact string-tagged value. Reported, derived and not-estimable answer statuses, source bases, contexts, notes and derivations remain in the frozen engine record.

## Original core context and result selection

The extraction engine supplies:

```js
{
  dossierId,
  revision,
  results: [{
    resultId, editionId, questionId, studyId, label, status, current,
    sourceBindings, record
  }],
  impacts: [{id, resultSetId, resultIds, kind, previous, current, fingerprint}],
  unresolved: [{resultId, editionId, resultSetId, status}]
}
```

Every immutable historical result edition is present. Only the `current` selection flag changes when a later edition is created. A result fingerprint is the canonical SHA-256 of every property of that original descriptor except `current`. The complete `record` is included in that hash. The publication model adds a `fingerprint` property for clients to copy directly into a selection; that API metadata is not part of the original descriptor.

The complete record retains the original result set and row, authored form edition, study, all submissions and submitted answers, comparison, resolution, resolution history, resolved values or null, original status and original event metadata.

A publication request supplies only:

```js
{resultId: selected.resultId, editionId: selected.editionId, fingerprint: selected.fingerprint}
```

The mutation looks up that exact edition in the current original engine context and freezes its complete body. Client-supplied result bodies are not accepted. Each logical result appears once per publication. Select a different historical edition deliberately, or compare editions through two publications.

## Mutation API

All five actions use the same original authenticated request envelope:

```js
{
  requestId: "stable_request_20261012",
  expectedRevision: currentDossierRevision,
  actor: {id: "local-operator", name: "Named workspace operator"},
  action,
  data
}
```

`actor` records the named operator within the existing authenticated local workspace. It does not create a separate user account or permission system. `requestId` contains 8–100 ASCII letters, digits, underscores or hyphens. Unknown request or action-data fields are rejected.

| Action | Required data |
| --- | --- |
| `create-table` | `{definition}` |
| `revise-table` | `{tableId,expectedTableEditionId,definition,reason}` |
| `publish-table` | `{tableId,tableEditionId,previousPublicationId,rows,title,reason,review}`; optional `summary` and `limitations` |
| `review-impact` | `{publicationId,impactId,fingerprint,disposition,reason}` |
| `withdraw-publication` | `{publicationId,expectedPublicationSha256,reason}` |

`previousPublicationId` is explicitly null for the first publication. Following editions name the latest publication for that same table, including a latest edition that has been withdrawn. `tableEditionId` can select a retained earlier definition deliberately; its exact definition is copied into the new publication.

For example, inside the original dossier transaction:

```js
const model = extractionPublicationModel(state, coreContext);
const table = model.tables.find(value => value.id === chosenTableId);
const selected = model.results.filter(value => chosenEditionIds.has(value.editionId));
const operation = recordExtractionPublication(state, coreContext, {
  requestId: originalRequestId,
  expectedRevision: state.revision,
  actor,
  action: "publish-table",
  data: {
    tableId: table.id,
    tableEditionId: table.editionId,
    previousPublicationId: model.publications.filter(value => value.tableId === table.id).at(-1)?.id ?? null,
    rows: selected.map(({resultId, editionId, fingerprint}) => ({resultId, editionId, fingerprint})),
    title: authoredTitle,
    summary: authoredSummary,
    limitations: authoredLimitations,
    reason: publicationReason,
    review: {contextFingerprint: model.reviewContext.fingerprint, note: operatorReviewNote}
  }
}, originalCreatedAt);
```

The caller owns the existing transaction, source projection, lease, revision update and state-size limit. `recordExtractionPublication` changes only the publication event array. It returns the complete recorded operation.

A repeated request with the same normalized canonical hash returns its original operation without another mutation. A reused request ID with changed content fails with `PUBLICATION_REQUEST_CONFLICT`. A new request whose expected revision differs fails with `REVISION_CONFLICT`. Keep the original request across an uncertain response and reconcile its existing operation before creating another request.

## Review and impact continuity

The model’s `reviewContext` contains current result identities, exact fingerprints and statuses, plus the original engine’s complete impacts and unresolved records. Its fingerprint excludes the dossier revision, so a publication-only operation does not itself invalidate an otherwise unchanged extraction review context.

Publishing compares the supplied fingerprint with the current context. `PUBLICATION_REVIEW_CONTEXT_CHANGED` means the selected context changed after the operator read it. Reopen the current original view and preserve the operator’s intended selection. The publication records the complete reviewed context and note.

Existing publications expose these current changes:

- A following authored table definition.
- A newer result edition or a result no longer available as a current result.
- A current unresolved result status.
- Original extraction impacts, including form editions, question wording, study/report links, later source editions and revised result sets.

Each impact is scoped to a publication and has a stable identity plus a fingerprint of its actual current content. `review-impact` freezes that complete impact with `reviewed`, `needs_review` or `not_applicable` and the operator’s reason. An earlier review remains in history when a later impact changes its fingerprint. Review dispositions do not rewrite the frozen publication or the extraction result.

Withdrawal stores the exact publication SHA-256, actor, time and reason. It preserves the publication, exports, source bindings, preceding editions and following correction links. Repeating the same original withdrawal request reopens its existing result.

## Reads and complete exports

All public functions live at `./extraction-publication.mjs`:

```js
extractionPublicationModel(state, coreContext)
extractionPublicationPage(state, model, options)
extractionPublicationReport(state, model, options)
extractionPublicationCompare(state, model, {fromPublicationId, toPublicationId})
extractionPublicationExport(state, model, options)
```

Pages accept `tableId`, `publicationId`, `currentOnly`, `section`, `offset` and `limit`. A publication selection infers its table. A result page defaults to all retained editions; use `currentOnly:true` when selecting current results. The section names are:

```text
overview
tables
table-editions
results
publications
rows
impact
reviews
withdrawals
operations
comparison
```

The page limit is the original `RESEARCH_PAGE_LIMIT` of 100; the default is 30. Follow `nextOffset` until it is null. `rows` returns complete frozen publication rows, with publication ID and original row index. `results` returns original extraction editions with their current flags and selectable fingerprints.

Reports and exports contain complete selected collections. They do not inherit a page’s offset or limit. A table report preserves all of that table’s definition and publication editions, reviews, withdrawals and operations. A publication report focuses its frozen edition and retains the relevant table-definition and operation history. Result editions and current review context remain available beside the frozen source.

```js
const exported = extractionPublicationExport(state, model, {
  tableId,
  format: "json" // "csv", "markdown" or "html"
});
// {filename, revision, contentType, body: Buffer}
```

JSON contains the complete records and histories. CSV uses RFC 4180 quoting and includes authored columns together with complete `record_json`, `source_json` and `review_json` fields. Separate row types retain table definitions, original result editions, publications, publication rows, impacts, reviews, withdrawals, operations and comparisons. Numeric strings and formula-like authored text receive a leading apostrophe for spreadsheet text handling; the complete JSON fields retain the original values.

Markdown includes the authored evidence table and complete JSON appendices. HTML is self-contained, uses neutral industrial styling, escapes all dynamic text, and includes complete expandable original records. It makes no network requests.

The original whole-dossier report can use:

```js
extractionPublicationMarkdownLines(report) // string[]
extractionPublicationHtmlFragment(report) // escaped, complete HTML section
```

Both functions are re-exported from `extraction-publication.mjs`. The standalone renderer module also supplies the full HTML document, CSV renderer and exact cell text formatter.

## Edition comparison

Comparison uses logical `resultId` as the row key. It reports added, removed, changed and unchanged rows. A changed record fingerprint or changed authored cells marks a changed row. Original order changes are separately retained as `moved` with before/after row indices.

Every comparison row contains both complete frozen records when present, all changed record pointers and all changed cell pointers. `beforePresent` and `afterPresent` distinguish a removed value from a present JSON null. Changes to the table definition, title, summary, limitations, reason and review context appear in metadata changes. Numeric string tokens are compared exactly without arithmetic conversion.

For a paginated comparison:

```js
extractionPublicationPage(state, model, {
  section: "comparison",
  fromPublicationId,
  toPublicationId,
  changeType: "changed", // or all, added, removed, unchanged
  offset: 0,
  limit: 100
});
```

For a complete comparison export, provide both publication IDs to `extractionPublicationExport`. The report includes both complete publication editions and all comparison rows.

## Storage and portable receiving

The existing original dossier state bound remains 8 MiB. The module never evicts earlier rows or histories and never increases that bound. The complete native receiving programme should operate the real selected results through the original store so its authored record size is checked by the existing transaction.

`validateExtractionPublicationState(state)` checks event envelopes, canonical request hashes, immutable entity identities, table-definition continuity, complete frozen result fingerprints, recomputed authored cells, publication hashes, reviewed context and impact fingerprints, correction links and withdrawal history.

`validateExtractionPublicationTransition(previous, state, previousCoreContext)` preserves the complete existing event prefix, accepts at most one new publication operation in an original revision, and recomputes that operation against the preceding original extraction context. It compares every other original state field, apart from the existing revision envelope fields handled by the dossier. This prevents receiving a publication with a substituted engine record or an unrelated state mutation.

Structural validation alone does not fetch source authority. The existing complete portable receiving path supplies the retained source editions, preceding extraction context and original revision chain. Both original portable paths must call the state and transition validators.

## Source ownership

| File | Responsibility |
| --- | --- |
| `extraction-publication-contracts.mjs` | Strict inputs, authored definitions, canonical hashes and exact pointer resolution |
| `extraction-publication.mjs` | Lifecycle, current model, complete reports, comparisons and original transition validation |
| `extraction-publication-render.mjs` | CSV, Markdown and HTML rendering over complete original records |
| `extraction-publication.d.mts` | Complete typed API and record contracts |
| `extraction-publication.md` | Operator and integration workflow |

Extraction, source projection, authenticated transport, original transactions and portable storage continue through their maintained modules. This layer supplies the authored publication lifecycle consumed by those original paths.

## Shared Research client response and selection

Publication pages, full reports and comparisons return `dossierId` and `revision` directly, matching the original extraction and Python/Merchant identity checks. The complete `dossier: {id, title, revision}` metadata remains available to the renderers. Pages retain `items`, `offset`, `limit`, `total`, `nextOffset` and `complete`; continue a later page against the same dossier revision.

Compare two retained publications with `{fromPublicationId, toPublicationId}`. The existing selected-publication client form `{publicationId, againstPublicationId}` is equivalent: `againstPublicationId` is the earlier/from publication and `publicationId` is the selected/to publication. Supplying both forms requires their identities to agree. Selecting a `publicationId` by itself exports that complete publication without requesting a comparison.

Markdown export accepts both `markdown` and the original dossier shorthand `md`; both produce the same complete `.md` document and content type. JSON, CSV and HTML keep their existing formats and full result/source history.
