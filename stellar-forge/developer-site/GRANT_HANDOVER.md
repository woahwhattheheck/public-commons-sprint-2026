# Complete submission handover in the existing SCF editor

This component extends the maintained **Prepare submission** workspace at
`/grant-submission.html`. It keeps the exact reviewer sources, selected original
evidence, prepared output, issuer observations and later edits inside the original
submission draft. The existing answers, native SF47 planning bridge, issuer-field
mapping, browser revision checks and complete draft envelope remain the operating
model.

Operation: **SCF-SUBMISSION-HANDOVER-1B40-20261012**.

The original Site, publisher and receiving owner remain the same. This component
does not send an application or contact an issuer. A frozen preparation is a record
of exact output. Actual submission or issuer responses are separately recorded
observations with their original files when available.

## Receive the complete reviewer source

The existing **Read current source** command reads these four files from the same
selected reader origin:

| Original file | Identity retained |
| --- | --- |
| `application.md` | Complete UTF-8 bytes, SHA-256 and Git blob, checked against the original source index. |
| `source-index.json` | Complete original JSON bytes and a receiving SHA-256. |
| `budget.csv` | Complete received bytes and a receiving SHA-256. The current source-index format supplies no independent budget-file digest. |
| `product-and-finance.md` | Complete UTF-8 bytes, SHA-256 and Git blob, checked against the original source index. |

The four responses are retained before they are attached to a working draft. The
reception time is recorded after the complete source read. No current source is
substituted into an older frozen edition.

When the source text has changed, **Source editions → Receive source and keep
edited answers** uses the original editor behavior: untouched answers receive the
new source, edited answers retain their original baseline, and the preceding
working version stays available. The matching four-file bundle is then retained.

When an older draft already contains the same application text but lacks the
companion files, **Retain these four original reviewer files** attaches the exact
matching bundle without replacing answer text. Reading the current reader alone
does not pretend that its companion was the companion of an unrelated historical
application.

The **Submission handover** view shows every retained bundle and allows every
original file to be downloaded independently. Select the current bundle for the
next preparation. Original answer baselines from older source editions remain
explicit; a preparation reports any baseline for which no full four-file bundle
was received.

The citation browser reads the original entries from the retained source indexes.
Opening a citation is a normal link. To retain a cited file as evidence, select its
complete original file and record its description. The source index is not treated
as a substitute for all the documents it cites.

## Retain exact evidence

In **Submission handover → Retain selected original evidence**:

1. Enter the operator and a useful title.
2. Select the evidence category: cited source, complete colleague review export,
   original operated result, issuer instructions or another original file.
3. Record the original URL and source observation time when known. An unknown
   source time stays empty; the actual recording time is retained separately.
4. Describe what the file supports and select any original answer, issuer field
   or required-content association.
5. Select the complete file, then press **Record this evidence file**.

The original filename, safe download name, complete byte count, file type and
SHA-256 stay with the record. Identical handover file bytes occupy one retained
object. The record preserves the draft identity, application edition and the
labels of the items selected at that time. Later field removal or renaming does
not rewrite those historical associations.

A selected but unrecorded file stays in the working selection. **Clear working
evidence file** or **Clear working returned file** removes that current selection;
the already retained bytes remain in the draft. Recording is the explicit action
that creates a durable described evidence item.

Select which recorded evidence belongs to the next preparation. Unselecting it
does not delete its original bytes or remove it from an older prepared edition.

A complete export from the original colleague review-round component can be
retained as `review-export`. This handover does not parse a second review model,
reinterpret colleague decisions or invent an approval. Reopen that original
review export through its owning review-round component when continuing the
review itself.

## Prepare the exact output

Choose the prepared-edition title, note, output and format:

- **All nine canonical answers** uses the original answer order and complete
  current answer text.
- **Current issuer form fields** uses the actual current field order, prompts,
  answer associations and text. At least one retained field must exist.
- **Plain text** and **Markdown** use the original editor's output formatter.

**Prepare this exact edition** retains the complete current authoring context and
the exact returned output. The prepared record includes:

- The nine answers and their original source baselines.
- The actual issuer form profile, ordered fields and required-content review.
- Native planning source metadata, selected revision, work packages, preview and
  application history.
- The selected current reviewer bundle and retained bundles for older answer
  baselines.
- The selected original evidence identities.
- The exact output items and complete output text, byte count and SHA-256.
- The field counts and issues calculated from the retained form conventions.
- Explicit context observations, including missing older companion evidence.

The original native planning ZIP or JSON stays once in the parent's
`planSources` collection. A prepared snapshot retains its complete native
document and file metadata, with the original file SHA as the byte binding.
Receiving reconstructs that snapshot from the exact retained file and checks the
metadata before using the original planning validator. Frozen snapshots do not
duplicate a large planning ZIP for each new preparation.

Preparation retains the preceding working version. If an unfinished observation
was being drafted for an older prepared edition, that working selection remains
in the preceding version; the new edition starts with a blank observation form
bound to the new edition. An earlier issuer file is never silently reassigned to
a later preparation.

Each prepared record has a SHA-256 over its canonical complete body. Editing the
working draft does not modify it. Preparing again adds another edition. Missing
context and actual field-limit observations remain visible; a local preparation
does not become an issuer acceptance decision.

Use **Copy frozen output** or **Download frozen output** for the exact prepared
text. The downloaded file is checked against the frozen output's original byte
identity in the receiving continuation.

## Record actual issuer returns and corrections

Select the exact prepared edition and choose the kind of observation:

| Observation kind | Meaning |
| --- | --- |
| Operator observation of submission | The operator's recorded observation of the actual submission step. |
| Original issuer acknowledgement | A described original acknowledgement and any attached returned file. |
| Original issuer message | An original issuer communication or returned material. |
| Operator note | A local note explicitly labeled as an operator entry. |

Retain the source observation time, original reference, URL, note and complete
returned file when available. The recording time is separate. An observation
without an original file says so explicitly. File hashes establish which bytes
were received; they do not independently authenticate an issuer.

**Record this observation** appends the record to its exact prepared edition.
It changes no prepared output and triggers no external action.

**Add a correction to this observation** opens a new working record referring to
the original observation. Recording it adds a correction with its own identity.
The earlier record, its file and its original meaning remain inspectable.
Corrections must refer to an observation of the same prepared edition. There is
no inferred final acceptance state that hides the original sequence.

Changing the observation's prepared-edition selection preserves meaningful
unfinished work in a saved version and opens a blank observation for the newly
selected edition. This prevents a pending issuer file from acquiring another
edition merely through navigation.

## Compare later work with a prepared edition

Expand **Compare the present draft with this exact prepared edition**.

The comparison retains original item IDs and distinguishes added, removed,
changed and unchanged output items. Both complete texts are available. It also
shows the full answer metadata, field mapping and other authoring-context
changes, including native planning selection and required-content review.

This comparison is editorial. It does not automatically carry a colleague
decision, mark an issuer response resolved, or rewrite the original submitted
or prepared text.

**Download prepared report and later comparison** creates a complete readable HTML
report containing the exact frozen output, original source/evidence identities
and descriptions, recorded field observations, issuer-return history, and a
clearly separate comparison to the current draft. The report escapes original
text and has no scripts or external asset dependency. The complete draft JSON is
the editable receiving artifact.

## Save, export, reopen and continue

Use the existing **Save version** and **Download full draft** controls, or the
same actions in the handover view. The original export schema remains:

`stellar-forge.grant-submission-export.v1`

The original draft schema remains:

`stellar-forge.grant-submission-draft.v1`

The complete JSON now includes all handover objects, bundles, evidence records,
prepared editions, observations and unfinished working selections. The original
source editions, plan files, field mapping and version history are retained too.
Every original file can therefore be reopened without another source fetch.

**Open draft file** uses the original receiving path and checks:

- The complete envelope's draft-body digest.
- Every original application SHA-256, Git blob and byte count.
- Every original native planning file through its owning verifier.
- Every complete handover object and canonical record identity.
- Original index bindings for the application and companion.
- The frozen authoring-state, planning-file and exact-output relationships.

The old current working draft is preserved through the existing version/CAS
behavior before another draft is opened. A reopened file retains its original
logical draft identity. Saving it in the receiving browser uses that browser's
normal record and revision. **Save as separate draft** remains the explicit
choice for a distinct working copy; its historical prepared records keep their
original identities.

Restoring an earlier working version restores its handover selection alongside
the original answers, form, review and planning selection. It retains all
immutable sources, evidence, prepared editions and observations acquired later.
A version created before the handover existed restores an empty working
selection; retained original material remains available.

The original 16 MiB logical draft budget remains. File selection and preparation
validate the complete candidate before replacing the working state. An oversized
addition does not discard the current editor. This is a complete bounded
submission draft, not a repository for arbitrarily large source datasets.

## Maintained source composition

The additive source files are:

- `dist/grant-handover-core.mjs`: structural model, immutable relationships,
  source-file references and version-selection integration.
- `dist/grant-handover-source.mjs`: original byte verification, source receiving,
  evidence/preparation/observation actions, comparison and the original envelope.
- `dist/grant-handover-workspace.mjs`: controls in the existing editor.
- `grant-handover.mjs`: original asset and source-index registration.
- `GRANT_HANDOVER_RECEIVING.mjs`: callback for the already-owned native Page.
- This guide.

The shared hooks extend the actual merged 7F5A planning edition, Merchant PR315
merge `a4cd621ac9dfd56e22f2900713ca16a2a8efcdd2`. They preserve the native
planning fields, original three plan-module routes and the browser-found
explicit select labels. The five complete postimages are the original
submission core, workspace, HTML, CSS and `grant-submission.mjs`.

018A remains the serial composer of the current renderer, browser asset manifest,
normal command/distribution and installed Merchant application. These hooks must
be composed with later review-round and other accepted hooks; an older full leaf
must not overwrite them. No `grant-compose.mjs`, manuscript, budget or customer
chapter replacement is part of this component.

The existing `registerGrantSubmissionAssets` includes the three new module
routes through `HANDOVER_ROUTES`. The existing `attachGrantSubmission` invokes
`attachGrantHandover` after preserving the current planning metadata. The source
index gains the handover schemas and same-editor route. The original static
server and application-opening command remain the way to run it.

### Complete API contract

| Module export | Behavior |
| --- | --- |
| `readReviewerSource({baseUrl,fetchImpl?,receivedAt?})` | Reads and verifies the four same-origin reader files; returns `{source,bundle,objects}`. |
| `createSourceBundle(source,{indexBytes,budgetBytes,companionBytes,urls?,receivedAt?})` | Verifies already received exact bytes without fetching another source. |
| `retainSourceBundle(draft,received,{select?,at?})` | Adds that bundle after its original application has been received through the original editor. |
| `stageOriginal(draft,bytes,{name,mediaType,forReturn?,sourceUrl?,at?})` | Retains complete file bytes and the corresponding working file selection. |
| `retainEvidence(draft,{at?})` | Adds the explicitly described evidence and selects it for the next preparation. |
| `prepareSubmission(draft,{at?})` | Returns `{draft,edition}`; retains the previous working version and freezes exact output. |
| `recordIssuerReturn(draft,{at?})` | Returns `{draft,observation}`; appends an actual described observation or correction. |
| `comparePrepared(draft,id)` | Returns all original-ID output/answer/field/context comparisons. |
| `createDraftEnvelope` / `openDraftEnvelope` | Use the existing whole draft export schema and verify all retained material. |
| `verifyHandover(draft,{planningOptions?})` | Full receiving verification; optional native ZIP/digest bindings use the original planning verifier. |
| `originalDownload(draft,descriptor)` | Exact bytes and safe filename/type for the selected retained file. |
| `preparedReport(draft,id)` | Complete readable HTML; immutable output and current comparison remain labeled separately. |

`renderHandover(root,context)` uses the original editor's `getDraft`,
`setDraft`, `touch`, `work`, `render`, `status`, `download`, `copy`,
`save`, `exportFull` and `openFull` callbacks. It creates no database or
alternate save path.

The pure core helpers `handoverSelectionOf` and
`restoreHandoverSelection` extend the original saved-version behavior.
`authorSnapshot` / `hydrateAuthorSnapshot` keep original planning bytes in
their owning collection while retaining the exact frozen metadata.

## Continue the original native receiving operation

`receiveGrantHandover(page, options)` takes the owner's existing Playwright
Page. The Page must already be on the original `/grant-submission.html`
workspace. It starts no browser, server, provider collector or issuer form
operation. The normal native operation remains
**SCF-GRANT-REVIEWER-PUBLICATION-8910-20261012**, with this handover as a component.

Pass the actual installed source directory containing `dist/` and the current
registration modules, and an ordinary output directory on the already selected
receiving work volume:

```js
import { receiveGrantHandover } from './GRANT_HANDOVER_RECEIVING.mjs';

const result = await receiveGrantHandover(page, {
  sourceDirectory: originalDeveloperSiteDirectory,
  outputDirectory: originalHandoverReceivingDirectory,
  expectedOrigin: new URL(page.url()).origin,
  operationId: 'SCF-GRANT-REVIEWER-PUBLICATION-8910-20261012',
  actor: actualReceivingOperator,
  expectedDraftId: originalDraftId, // optional when first binding the open draft
  outputKind: 'answers',           // 'fields' requires actual retained form fields
  format: 'plain',
  onProgress: event => console.log(JSON.stringify(event)),
});
```

This callback:

1. Binds the complete current source/module identities and verifies the actual
   served static bytes against them.
2. Downloads and preserves the original open draft before proceeding.
3. Receives the current source through the original source view, preserving
   edited answers and old versions, then retains the matching four-file bundle.
4. Records the exact existing budget file as explicitly described source
   evidence.
5. Prepares the exact selected output and adds an explicitly labeled **operator
   note** about the local receiving operation.
6. Saves and downloads the complete draft, exact frozen output and readable
   report.
7. Adds a clearly labeled local receiving annotation to a working answer or
   actual existing field and verifies the full later comparison.
8. Reopens the complete file through the original import control, saves through
   the same browser store, and verifies the original draft, edition, observation,
   source identities and continued edit.
9. Retains the resulting screenshot, complete files, source selection and result.

The local annotation remains a later working edit. It does not modify the frozen
output and is not part of an issuer submission. No invented issuer field or
acknowledgement is introduced by the callback.

Receiving writes complete files using create-only publication, exact readback
and directory synchronization. Failed temporary/download prefixes and completed
attempt files remain available. The original selection binds the source,
operator, output mode and native operation. On continuation, the callback
recognizes its retained evidence, preparation and operator observation by their
original input-bound descriptions instead of blindly creating another one.
A completed result is read back against its complete recorded file identities
before reuse.

If the browser is lost mid-operation, the owner reopens the same complete
retained draft through the existing editor and continues the same callback.
Independent edits or a different current draft/source are reported with the
original files preserved. No source mutation, issuer action or replacement
workspace is inferred from a missing callback.

### Actual source-function receiving result

The first source-function exercise used the already published current reviewer
edition `33c88ad83844195b2f68535d6747606ee6685475`:

| File | Exact bytes | SHA-256 |
| --- | ---: | --- |
| `application.md` | 31,719 | `012d431b360174f1323375bf358a2d7d4d95a628d0ab0529127664b5923d1763` |
| `source-index.json` | 41,961 | `adb11e2e3f40ade4315a8fedb84fb59fbbb6d2da2319e0c8ed3329e6624da629` |
| `budget.csv` | 597 | `4ce056f1c388f9910e088ad763a4cdf55ed8ebf06e32dee1734b3e2f355c6c00` |
| `product-and-finance.md` | 165,961 | `d3a1475aea9da3adc7c20c73c678acb9a2020929ca96b3e3067888ddb2ffafb9` |

The original modules parsed and evaluated in Functions V8 with UTF-8/WebCrypto
compatibility bindings. The actual source bundle verified, the budget reused
its existing object, the exact canonical output was prepared, and an explicitly
labeled local operator note was retained. Complete export/reopen preserved the
same draft. One subsequent project-answer edit appeared in the comparison while
the original prepared output stayed unchanged. Restoring a prior working version
preserved the immutable prepared edition and observation.

That exercise is **not** a native browser/IndexedDB run, issuer action, published
Site acceptance or grant submission. The actual combined native Page callback
and original publisher's saved/deployed version are separate owner-reported
results. The current source edition can advance through the existing composer;
the receiver always binds the actual four-file edition selected for that run.
