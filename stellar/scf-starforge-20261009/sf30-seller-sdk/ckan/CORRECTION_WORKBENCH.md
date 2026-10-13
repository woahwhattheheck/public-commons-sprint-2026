# Catalogue correction workbench

The correction workbench edits an exact retained DCAT catalogue or a candidate
from a saved migration review. It keeps every saved version, its editor and
reason, the ordered edits, and complete before/after JSON values. A selected
version becomes a separate retained catalogue for the existing migration,
semantic and release workflow.

Open **Catalogue migration → Catalogue corrections** in the existing saved
workspace. The command-line and agent course is in [CORRECTIONS_AGENT.md](CORRECTIONS_AGENT.md).
The original conversion, conservation, identity mapping and release course
remains in [MIGRATION_OPERATING.md](MIGRATION_OPERATING.md).

## 1. Select the exact document

Receive a complete original catalogue using the existing upload, recurring
source or command-line receiving operation. Alternatively, prepare its migration
review and select that review's converted or preserved candidate.

In **Start a saved correction draft**:

1. Choose an original catalogue or a review candidate.
2. Inspect its displayed SHA-256.
3. Enter a draft label, editor name and reason.
4. Create the draft and follow the original workspace operation.

The first draft revision contains the original bytes. Its source binding records
the original catalogue/review identity, hash, byte count, profile, source URL and
original migration source. A draft is separate from the original document and
from the selected catalogue release.

The editor accepts complete UTF-8 JSON, including an original UTF-8 BOM and
CRLF formatting. For an original source in another encoding, select the UTF-8
candidate produced by the existing migration engine. Documents with duplicate
object keys are rejected because a pointer would not identify one unambiguous
value. The original received file remains available.

## 2. Browse all catalogue and record values

Choose a saved draft and revision. The browser shows its complete document
hash and byte count. Enter a JSON pointer or open a child row.

- An empty pointer selects the whole catalogue.
- `/dataset` selects the dataset array.
- `/dataset/0/title` selects the first record's title.
- `/dataset/0/distribution/0` selects its first distribution.
- A literal slash in a field name is written `~1`; a literal tilde is `~0`.

Children are paged without discarding the underlying records. **Find children**
searches the complete original JSON of each immediate child, including values
beyond the displayed preview. Arrays retain their exact order and indexes.
The complete selected value is expandable when it fits the 4 MiB editor
display; larger values remain accessible through their children and the
complete document download.

Candidate drafts can read the original candidate's validation findings. Each
finding retains the original validator error. **Open original source position**
opens the first immutable draft revision at that path. This preserves the
finding's original record position after subsequent structural edits or array
reordering. The complete original review is downloadable beside the findings.

## 3. Compose a typed, ordered change set

Each edit has an operation and absolute destination pointer. Add/replace values
are complete JSON literals, entered as text.

| Intended value | JSON literal |
| --- | --- |
| Text | `"Updated catalogue title"` |
| Boolean | `false` |
| Empty value | `null` |
| Exact integer | `900719925474099312345` |
| Exact decimal spelling | `1.2300000000000000001` |
| String list | `["transport", "procurement"]` |
| Object | `{"@id":"https://example.org/catalogue"}` |

Numbers retain their original lexical spelling; they never pass through a
JavaScript floating-point conversion during an edit. Unchanged portions of the
document retain their original text, including whitespace and escapes. Each
edited value is parsed as one complete JSON value before it is used.

### Operations

**Replace** changes the selected value. An empty pointer replaces the complete
catalogue, which must remain a JSON object.

**Add** inserts a new object field or an array item. The parent must already
exist. An existing object field requires an explicit replace operation.
For arrays, use an index from zero through the current length, or `-` to append.

**Remove** removes the exact existing field or array item. Removing the entire
catalogue is rejected; replace it with a complete object instead.

**Move** removes the source value and inserts its unchanged text at the
destination. Array destination indexes refer to the array *after* removal.
For example, moving `/dataset/0` to `/dataset/3` places the original first item
fourth. An object destination must be a new field. A value cannot move into
itself or one of its descendants.

Edits run in the listed order. Later array pointers therefore refer to the
document produced by earlier edits. Use the change-set up/down controls to
choose that order, or remove an edit before saving.

**Preview all changes** uses the current saved revision to produce the complete
before/after values, resulting document bytes and SHA-256. The preview leaves
the saved draft unchanged. Changing the change set clears the previous preview.

## 4. Save an attributed revision

After inspecting the complete preview, enter the editor and reason and choose
**Save attributed revision**. The save is bound to:

- The original draft.
- The exact current revision UUID.
- The complete current document hash.
- The previewed result hash.
- One stable request UUID and its complete input.

If another saved revision has advanced the draft, the operation asks for the
current revision to be inspected. It does not silently apply the old edit
positions to a different document.

Each saved revision stores both complete files:

```text
dcat/corrections/<draft-id>/revisions/<revision-id>/document.json
dcat/corrections/<draft-id>/revisions/<revision-id>/revision.json
```

The revision record includes its preceding revision/hash, original source,
editor, reason, timestamp, ordered operations, complete before/after values,
and the resulting document hash and bytes. The workspace retains this full
history. Downloads return the exact document or full revision record.

To restore an earlier version, select that historical revision, enter the
restoring editor and reason, and choose **Restore this earlier version as a new
revision**. Restoration appends an attributed revision with the earlier exact
document bytes. Its change record binds the complete preceding and target document files by revision, hash and byte count, so large restorations retain the same complete-file limit. Later history remains available.

### Interrupted requests

The browser keeps the original UUID and payload until the saved result appears
in workspace state. The operation panel supports refresh, retry of that same
request and download of its complete input. The command-line and MCP interfaces
accept the same stable request UUID.

Pending metadata is retained before file writes. Retrying an interrupted write
uses the original timestamp and resumes only an identical file prefix. A
changed payload or a different retained prefix is rejected. Once a revision or
materialization is complete, repeating its UUID returns its retained result.

The workbench uses the original workspace lease and operation launcher. Follow
that operation before starting another mutation. Keep a downloaded change set
or request when carrying unfinished work across browser sessions.

## 5. Retain a candidate and continue the original review

Choose the exact saved revision, a new document label, its declared profile,
editor and preparation reason. **Retain selected revision for review** saves its
complete bytes in the original catalogue store:

```text
dcat/catalogs/<catalogue-id>/catalog.json
```

Its metadata retains the correction draft, revision/hash and preparation
attribution. The materialization record identifies the resulting catalogue
and the original migration source.

Choose its use explicitly:

- **Corrected candidate beside original source** selects the new catalogue as
  the candidate and the draft's original migration source as the source.
- **Source for a new conversion review** selects the new document as the source.

The browser resets previous draft identity mappings, preceding-edition choice
and normalization choice when selecting the new document. Review the selected
source/candidate and enter the mappings appropriate to this exact pair.

Then use **Prepare migration review** in the existing controls. The original
engine validates the document, conservation and identity mappings and retains
its complete findings. Optional semantic profiles, original RDF/SHACL execution
and saved-pair comparisons continue on the resulting original catalogue/review
identities. Select a release through the existing reviewed-candidate controls.

A saved edit, a materialized catalogue, a completed migration review and a
selected release are four separately retained product states.

## 6. Portable receiving

The existing complete workspace archive carries every original catalogue,
all correction revision documents and records, materializations, migration
reviews, optional semantic work and release history.

Before export and during independent receiving, the correction validator:

1. Verifies each source and revision binding.
2. Reads every complete document and revision file and checks bytes/hashes.
3. Applies each ordered edit change set to its predecessor and binds a restoration to an already verified earlier complete document.
4. Requires exact equality with the retained resulting document and complete
   change record.
5. Verifies materialized catalogues against their selected saved revisions.

Receiving preserves historical values and pending request metadata. The same
drafts, exact documents, history and candidate relationships reopen at the
new workspace location. Continue with the original workspace archive commands
and Applications receiver in [MIGRATION_OPERATING.md](MIGRATION_OPERATING.md).

## HTTP and embedded API

All HTTP routes use the existing authenticated loopback workspace listener.

| Operation | HTTP route | Workbench method |
| --- | --- | --- |
| List drafts | GET `dcat/corrections` | `listDcatCorrections` |
| Complete draft metadata/history | GET `dcat/corrections/:id` | `dcatCorrection` |
| Typed value and paged children | GET `dcat/corrections/:id/inspect` | `inspectDcatCorrection` |
| Complete document/revision download | GET `dcat/corrections/:id/download` | `dcatCorrectionDownload` |
| Preview complete changes | POST `dcat/corrections/preview` | `previewDcatCorrection` |
| Create draft | POST `dcat/corrections/create` | `createDcatCorrection` |
| Save revision | POST `dcat/corrections/save` | `saveDcatCorrection` |
| Restore an earlier version | POST `dcat/corrections/restore` | `restoreDcatCorrection` |
| Retain separate catalogue | POST `dcat/corrections/materialize` | `materializeDcatCorrection` |

Inspection accepts `revisionId`, `pointer`, `offset`, `limit` and `query`.
Downloads accept `revisionId` and `kind=document|revision`.
Mutation requests include a stable `requestId`; save/restore also include the
expected current revision and document hash. Read-only preview uses the same
current-revision guards. All source/value JSON in edit operations is carried
in exact `valueText` strings.

The editor supports the original 128 MiB complete catalogue limit, up to
256 nested JSON levels, two million JSON values, 1,000 ordered edits per
revision, a 16 MiB browser request and a 32 MiB complete revision record.
A limit rejection leaves the preceding saved revision available. Full
workspace archives retain the original archive's configured byte/file limits.

## Receiving course using the retained GSA case

Continue the original completed 344-record GSA workspace and its retained
source files. The existing migration result already establishes its original
record counts and eleven reviewed series-identity decisions; reuse those
inputs and artifacts.

For this new interface, the actual operator should create a separate draft
from the retained already-3.0 catalogue, inspect the complete dataset array,
search the first record's real identifier, and open its typed title,
boolean and distribution values. Exercise and inspect a saved revision,
an earlier-version restoration, full document/revision downloads, and a
separately materialized catalogue through the original migration review.
An operator-entered correction should reflect an actual intended catalogue
change; demonstration edits remain in a separate draft.

Export the complete workspace, receive it independently and reopen the same
draft/revisions/candidate relationships. Open the actual browser at desktop
and narrow widths, use every affected control and inspect all complete
downloaded files. Preserve the actual resulting source edition and findings
in the existing receiving operation.
