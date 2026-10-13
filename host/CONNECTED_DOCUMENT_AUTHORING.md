# Complete source authoring in an existing native Doc

This helper writes a complete original source packet into the explicitly selected native Google Doc. It closes the document-editing boundary before the maintained `connected_document_delivery.cjs` receiver exports and receives that Doc. The original Doc, actor and source operation remain the same throughout.

## Scope and dependencies

Use `host/connected_document_authoring.cjs` with the normal discovered Google Drive tools and a maintained SHA-256 implementation returning `{bytes, sha256}`. It is a CommonJS module and also evaluates in a tools-backed JavaScript isolate; it needs no filesystem, shell, package installation or network client. The existing `host/connected_sha256.cjs` exports the required `sha256Utf8` function.

The caller supplies the already authorized Doc and a complete single-line ASCII JSON packet of at most 900,000 characters. Existing base64 or gzip source carriers can preserve original Unicode and binary members inside that packet. This helper does not introduce a source-carrier schema. A required source validator must decode the actual selected carrier, verify its complete member inventory, byte lengths and hashes, and reject incomplete or mismatched contents before any native document call.

Keep data and destination authorization with the original operation. A connected actor, an editable Doc or a public code module does not authorize copying a different organization's data. An actual approval rejection remains with that operation; do not use this helper, another seat or a different destination to repeat the rejected copy. The helper does not create Docs, share files, switch accounts, send mail or select a second provider.

## Input and durable state

```javascript
const {createDocumentAuthoring} = require('./connected_document_authoring.cjs');
const {sha256Utf8} = require('./connected_sha256.cjs');

const author = createDocumentAuthoring(nativeTools, {
  sha256Utf8,
  validateSource: validateCompleteOriginalSourcePacket,
  onState: persistOriginalOperationState,
  state: previouslyRetainedAuthoringState || undefined
});

const ready = await author.run({
  operation_id: originalOperationId,
  actor_email: originalConnectedDriveEmail,
  document_id: originalNativeDocumentId,
  document_preimage_sha256: sha256Utf8(originalPlainDocText).sha256,
  text: completeSingleLineSourcePacket
});
```

All identifiers and source variables above come from the existing authorized operation. `originalPlainDocText` is the entire current paragraph with only its returned final native paragraph newline excluded. For an empty original plain Doc, use the SHA-256 of the empty string. Do not use an abbreviated excerpt, an earlier version of the Doc or a generated substitute as the preimage.

`onState` is required and awaited. It must persist the small JSON-serializable state in the owning operation's existing durable journal. It is called before the write, immediately after an accepted write and after full readback. The source packet itself remains in the existing source bank. A snapshot includes original actor/Doc identities, source length/hash, the immutable plan hash, native call count, current Doc revision and sanitized failure information. It does not store signed connector URLs.

The complete request is copied synchronously before the first awaited validator or journal callback. Later caller mutations cannot change the source that the plan identifies or the text sent to the native Doc.

The optional `bindings` object maps logical actions `profile`, `metadata`, `document` and `writeDocument` to actual discovered normal tool names. Use it only to bind the same ordinary operations exposed by the runtime; it is not a route-selection or retry mechanism.

## Actual document behavior

The helper verifies the connected actor's email and stable account ID, the original Doc ID/MIME type, and current edit capability. It reads the complete native paragraph and its revision before deciding whether a write is needed.

The accepted layout is exactly one plain ASCII JSON paragraph. The original paragraph must start at index 1, and its returned end/start indices must match its full text length. A native final newline is preserved. A normal native tab such as `t.0` is retained and supplied explicitly in both the delete range and insertion location. Rich or ambiguous layouts produce `DOCUMENT_LAYOUT`; the helper never guesses an index or silently drops another paragraph.

If the entire Doc already equals the selected packet, `run` returns the same verified source without another write. Otherwise it checks the complete preimage hash and performs one native batch with:

1. Delete only the returned original paragraph text range, retaining its native terminator.
2. Insert the complete source packet at that same original tab/index.
3. Require the original `revisionId` through native `requiredRevisionId`.

It then reads the whole Doc again and requires exact packet text and the same tab. A native response saying that text was replaced is not used as source equality. This behavior addresses an observed large `replaceAllText` result that reported success but left part of the previous packet appended.

`inspect(input)` performs the same source, actor and full Doc verification without calling the write action. It is useful when the existing source is already authored. `run(input)` is also nonmutating when the original Doc already contains the complete selected packet.

The returned object contains `state.status === 'DOCUMENT_READY'` and:

```javascript
{
  document_id,
  document_revision_id,
  document_tab_id,
  payload_sha256,
  payload_bytes
}
```

This is the Doc-authoring result. The Library receiver separately owns raw export and Library receipt validation.

## Join the maintained Library receiver

Use the existing `createLibraryDocumentDelivery` and `prepareLibraryDelivery` API in `host/connected_document_delivery.cjs`. That implementation owns complete native Doc/body checks, raw export byte identity, the original opaque connector file object, accepted Library receipts and complete Library text/metadata receiving. Keep its current source and original operation journal; do not paste an older receiving implementation into this module.

The current receiver accepts the following concrete input shape:

```javascript
const libraryInput = {
  operation_id: originalOperationId,
  drive_actor_email: originalConnectedDriveEmail,
  source_url: originalSourceOrCaseUrl,
  library_directory_id: originalLibraryDirectoryId,
  destination_authorization: {
    basis: originalAuthorizationBasis,
    drive_actor_email: originalConnectedDriveEmail,
    destination: 'chatgpt_library',
    reference: originalAuthorizationReference
  },
  files: [{
    filename: originalExportFilename,
    document_id: ready.document.document_id,
    document_revision_id: ready.document.document_revision_id,
    document_text_sha256: sha256Utf8(originalFullDocumentText).sha256,
    document_text_bytes: sha256Utf8(originalFullDocumentText).bytes,
    content: completeSingleLineSourcePacket,
    export_utf8_bom: originalExportIncludesUtf8Bom
  }]
};

const receiver = createLibraryDocumentDelivery(nativeTools, {
  onState: persistOriginalLibraryOperationState,
  state: previouslyRetainedLibraryState || undefined
});
const received = await receiver.receive(libraryInput, {
  known: {files: [{
    document_id: originalNativeDocumentId,
    library_file_id: originalAcceptedLibraryId,
    file_id: originalAcceptedImmutableFileId,
    version_id: originalAcceptedVersionId
  }]}
});
```

Read `originalFullDocumentText` from the actual complete native Doc body at the returned revision, including its own final newline if the body returns one. This is distinct from the payload paragraph used for the authoring preimage. The maintained receiver independently checks the whole original body and revision. Preserve its exact accepted `public_source` or `explicit_user_authorization` basis and reference. Observe the actual raw export to select `export_utf8_bom`; do not infer it from rendered Library text.

Use the maintained receiver's `run(libraryInput)` only for an original creation that has no accepted receipt. When the original operation has an accepted file, `receive` reuses it. Preserve in-place Library replacement as its own existing version-guarded operation and pass the returned receipt to the receiver. Never create another file to get around an uncertain create or replacement.

For native materialization, retain the accepted immutable `file_id` together with its stable `library_file_id`, actual filename and version. An observed replacement temporarily returned older metadata when read through the stable ID; the returned immutable file ID selected the actual new version. Keep both identity checks. A Library text read may normalize a UTF-8 BOM or line endings and is not a raw-byte digest of the exported file. The maintained receiver distinguishes raw export identity from rendered Library text identity.

Pass the actual connector `file_uri` object between supported native actions. Serializing it to JSON or extracting its private URL changes the native file-reference contract. Do not journal or publish signed URLs. The receiving worker obtains its own ephemeral materialization from the retained ordinary file IDs.

## Failure and continuation

| Result | Required continuation |
| --- | --- |
| `DOCUMENT_READY` | Feed the exact Doc/revision and original payload into the maintained receiver. |
| `DOCUMENT_PREIMAGE` | Inspect the same original Doc; another edit changed the selected preimage. Preserve that edit. |
| `DOCUMENT_LAYOUT` | Use the actual native paragraph/tab layout; do not guess or broaden the edit range. |
| `WRITE_STARTED` retained after interruption | Read the same Doc first. If its full source equals the selected packet, normal continuation adopts it. Otherwise reconcile that original write before another mutation. |
| `WRITE_ACCEPTED` with incomplete readback | Continue the same Doc and source. A different full body is not accepted as the selected packet. |
| `SOURCE_CHANGED` | Resume the original immutable request; changing source or destination requires its own explicitly selected operation. |
| `PROVIDER_RETRY_AT` | Honor the retained actual provider interval, then resume the same operation at a useful work boundary. |
| Provider rejection or approval denial | Retain the original result and resolve that exact authorized operation; do not rotate actor, provider or destination. |

The helper never automatically retries a mutation. It refuses a second concurrent call on the same instance. Original native error responses remain on the thrown error where available; the portable journal retains only a sanitized message/code and actual retry interval. Keep complete failure state so another authorized worker can continue the same original operation.

## Actual product use

The final authoring module ran against the already-delivered complete source Doc through the real profile, metadata and full Doc actions. It matched a 189,132-character packet, validated all three outer and 27 nested source members, retained the original `t.0` tab and returned `DOCUMENT_READY` in three native calls without changing the delivered source. The original source had already passed complete Library readback and actual materialization. This validates the real already-authored continuation. The exact range/revision write follows the same native mutation contract used to repair the original Doc.

These source checks do not replace running, rendering and using the actual delivered product. Keep the accepting native worker and its original application/Workspace operation. Return its concrete source path, command result, first exception or produced artifact into that same course.

## Standing recipient-use instruction

Applies to every current and future peer, provider, local session and cloud worker. Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing peer must open, run or render the exact outgoing version, look at its actual rendered screen or real screenshots, and operate its important user controls. Capturing screenshots without viewing them is insufficient. Inspect the actual screenshare width and narrow/mobile width where relevant; inspect populated, empty, loading and error states, downloads, exports and reopening.

All attachments are part of this rule. Literally open, view, play and use the exact final HTML, PDF, report, slides, spreadsheet, map, image, video, audio, archive and project as the recipient would. Extract archives and open their actual contained deliverables and working project; inspect every applicable report/PDF page. Tests, checklists, source/schema inspection and screenshots merely captured are not substitutes. Fix observed defects within the authorized work and continue delivery.

Final media must be seen and heard. For videos, use available high-quality generative media and natural voice generation/TTS instead of robotic default voices. Watch and listen to the final export for pronunciation, pacing, timing and audio alignment. Preserve existing spending, voice and attribution controls. This instruction adds no review queue, restart, watcher or new release permission.

Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized product work before presenting it. Use plain industrial design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve the real workflows, data and computation.

This inspection is part of delivery and leads directly to concrete repairs. It must not replace implementation and integration, become endless rechecking, create a peer-approval gate, launch broad suites or become a separate verification product. Continue useful authorized source and product work while the exact native/rendered receiving operation proceeds; preserve actual execution state and the existing operation identity.

Persist this rule in every active owner-controlled instruction surface that providers and workers actually read, including project/global instructions, provider boot instructions, source mirrors, cloud instruction copies and current build/receiving guides. Include it in child assignments. Preserve other owner controls, historical evidence and third-party/vendor instructions. Do not force restarts, add watchers or restart owner-stopped work. Existing project-specific owner cutoffs remain in force.
