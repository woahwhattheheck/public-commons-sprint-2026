# Native Library file transfer

Use the current Library skill and the actual prepared-upload and materialization schemas. Reuse an existing Library identity for an edit; create a new item only for a new deliverable or a requested copy. Keep repository source in its existing Git destination and Skills source in Skills Git.

## Save the actual local file

For an available native `prepare_uploads` action, include the exact absolute `workspace_path`, basename, byte count, and create or replace purpose. Keep a task's selected files in one ordered batch, within the current per-call limit. Retain the complete request and each returned upload object privately in the same operation record.

The returned transfer source determines the next action:

| Actual returned source | Meaning | Continue with |
| --- | --- | --- |
| `workspace_path` | The service has already copied those bytes into the prepared session. | Pass that complete returned upload object to `finalize_uploads` unchanged. No separate PUT is needed. |
| `upload_url` | The session is reserved, but its bytes still need transfer. | Use the maintained Library transfer implementation on that prepared session with the original file, method, and headers, then finalize that same completed session. |
| Both, neither, or an error | No valid single-source completion has been established. | Retain the original result and reconcile that session through the current provider contract before finalizing. |

Do not invoke a new one-shot upload that would prepare a duplicate session when resuming a pending PUT. Consult the current prepared-upload helper contract for its supported continuation.

A successful preparation is not a completed Library item. Finalize only sessions whose transfer is confirmed. Never synthesize `workspace_path`, replace a signed URL with a local path, remove returned fields, or reconstruct a smaller finalize object. Preserve opaque ownership and format markers. For a replacement, preserve the existing `library_file_id`, exact expected version, and other fields required by the current contract.

Inspect every result in request order. Retain the resulting Library ID, file ID, version, authoritative filename, original local path, size, and available digest together. Apply the returned identity/version attributes with the current helper when local execution is available. A failed local metadata update does not undo the remote save; finish that update against the same returned identity instead of creating another item.

## Continue when local execution is unavailable

A disconnected executor may prevent a helper from starting while the native prepared-upload service can still copy a workspace file. Include the real source path in the native preparation instead of assuming every save requires a shell or PUT.

Different agent contexts have returned different transfer modes for the same authorized source paths. This is an observed behavior, not a promise that a parent always receives a direct copy.

If a child receives only a pending PUT and cannot run it, the current parent may take the same save operation when all of the following facts are already known:

- The original file still exists at the exact path with the retained size and digest.
- No byte transfer or finalization was attempted for the idle session.
- Its original owner has stopped retrying that unused session and recorded it as superseded locally.
- The parent has the same authorized source and destination and can use the supported native path-copy route.

Hand over the complete original intent and the unused session IDs. Let that one receiving context prepare once with the exact paths. Branch on its actual returned sources again; do not assume success from its role. An unused reservation is not a saved file and must never be finalized. Do not invent a server cancellation operation when only the local retry has been retired.

If a PUT, copy, or finalize outcome is uncertain, reconcile the original session and resulting Library item first. Do not use this continuation to replace an accepted or possibly accepted mutation. A local transport failure and an authorization rejection are different results: changing context or carrier never overrides a real denial or an approval decision.

## Materialize an existing item

Choose the access route in the current Library skill. For a retained complete list/search result, use its maintained download helper. For a resolved reference that did not come from list/search, use the supported `prepare_materialize` flow. Pin the actual Library/file identity and version when the handoff requires that exact edition.

| Actual materialization result | Continue with |
| --- | --- |
| `workspace_path` | Use the already copied local file. Apply returned attributes; do not download it again. |
| Signed transfer URL | Use the returned method and headers to receive the original bytes, then apply returned identity attributes. |
| Failure or uncertain result | Reconcile the same requested file/version and destination before making another copy. |

### Receive a resolved connector file

A connector's file result can be a resolved reference even when the file has no Library item. If that result supplies a real OpenAI `file_id` and `file_name`, use those exact returned values with the current lower-level materialization contract. Include its `library_file_id` only when one was returned. A provider's own identifier, such as a Slack `F…` file ID, is not an OpenAI file ID; first obtain the connector's actual resolved file result.

For that resolved-reference route, the native request shape is:

```json
{
  "items": [
    {
      "file_id": "<OpenAI file_id returned by the connector>",
      "file_name": "<file_name from the same result>"
    }
  ],
  "destination": {
    "directory": "<existing absolute conversation-workspace subdirectory>"
  }
}
```

Use the actual destination and the filename that materialization returns. A result with `workspace_path` means those bytes have already been placed; do not start a second download. If `library_file_id` is null, this is a materialized connector file, not a newly created Library item. Do not invent Library identity or run an identity update requiring a nonexistent ID. When a Library identity is present, apply its returned metadata through the current helper. When the result supplies a transfer URL instead of a copied path, continue with the prescribed transfer helper and the same returned transfer object.

Retain the provider file identity, returned OpenAI identity, original byte count and digest, and actual materialization result in the same receiving record. Verify the received bytes when exact identity is required. This route can work while local process creation is unavailable, but the actual returned mode determines whether receiving has completed. It keeps the original file's authorization and destination; it does not change an earlier sharing or approval decision.

A native Library download link is an authenticated user-facing link. A tool-issued transfer URL is a separate temporary byte carrier. Use only the carrier actually returned for the requested file; never manufacture its host, signature, expiry, or provider wrapper.

For an authorized receiving handoff, preserve the original provider name and file IDs. A Library result is not a Slack file result. An unfinished Slack upload is still unfinished after the same bytes are saved elsewhere. Keep signed URLs and required headers in the established private receiving route, out of published source, manifests, and ordinary user-facing responses.

Read the actual expiry. A long-lived URL helps a receiver fetch in time, but does not establish delivery. Retain the receiver's saved-byte count and digest or its actual completed receipt under the original operation. Refresh a carrier when its actual expiry or receiving failure requires it, reusing that same item; do not create another file or work order merely to refresh a URL.

## Receive retained connector source through an existing native Doc

Use this route when the complete original source is present in the authorized connector session and ordinary native file receiving is available, but the original session cannot place those bytes on a local filesystem. The maintained implementation is `host/connected_document_delivery.cjs`, with its full contract in `host/CONNECTED_DOCUMENT_DELIVERY.md`. Reuse `prepareLibraryDelivery` and `createLibraryDocumentDelivery`; the existing `transfer_parts.py` and source-bank decoders continue to own multipart recovery and source verification.

This connector-specific integration is optional and is not bundled with this portable skill. Read its currently installed maintained implementation before use. The self-contained durable receiver is [scripts/transfer_parts.py](../scripts/transfer_parts.py), with its complete protocol described in [the native transfer guide](code-mode-native-transfer.md). Keep private operation records in their authorized destination.

### Bind the actual source and destination

Read the connected Drive profile and the selected Doc's owner, sharing state and parent before writing. Verify that the actual user instruction or public-source scope covers the content and this destination. A successful profile read is not permission to move unrelated private content. Record the original authorization reference and expected actor; preserve any previous approval decision. A transport change cannot override a denied destination.

For a new authorized carrier, use the connected Docs owner workflow to create its complete text, then pin the actual document ID, full body, revision and digest. The maintained Library helper starts from an existing frozen single-tab Doc; it does not create or edit that Doc. Keep Docs authoring in its maintained workflow. Do not treat a payload string or a provider attachment URL as a connector file reference.

### Preserve three distinct byte identities

The native Doc body, raw text export and source payload can differ. A text export may contain a three-byte UTF-8 BOM even when its readable view contains the original JSON. Multiline executable text may also acquire paragraph or line-ending changes. Preserve exact executable bytes in the original one-line Base64 envelope, retain the same Doc and Library identity, and verify its decoded bytes against the original size and digest before execution.

Use the source owner's existing complete envelope for binary, executable or whitespace-sensitive content. Retain its original byte count and SHA-256, encoding, compressed identity when present, and ordered parts. Do not regenerate an original JSON bank merely to match a convenient formatting style. An existing one-line JSON carrier can pass directly when its complete raw export comparison succeeds.

Keep these checks separate:

| Representation | Required identity |
| --- | --- |
| Frozen native Doc | Actual document and revision, complete body bytes and digest, including its actual terminal paragraph text |
| Raw text export | Exact exported bytes and digest, with the observed BOM choice declared explicitly |
| Original source | Bytes recovered by the existing envelope decoder, original whole-source digest and every member identity |
| Receiving file | Actual Library/file/version and the native materialized-byte result |

For a carrier exported with the declared UTF-8 BOM, decode its outer text using `utf-8-sig`, then verify the recovered original carrier text or embedded byte payload against its retained identity. Do not remove arbitrary whitespace, normalize newlines or hash a JSON reserialization. This handling applies to that observed text carrier, not to arbitrary binary files.

### Continue the maintained receiving operation

The current helper takes the complete payload plus pinned Doc body/revision, expected Drive actor, original operation ID, source reference, destination authorization and selected Library directory. Read its current guide for the exact `prepareLibraryDelivery(input)` contract. Its `receive(input, {known: {files: [...]}})` path adopts actual original Library receipts read-only. Use that path when the file already exists; `run(input)` retains the first create attempt and requires reconciliation after an uncertain result.

The native export supplies a structured `file_uri` object containing an opaque file identity and temporary carrier details. Pass that exact returned object to the supported Library action when the current runtime accepts it. Preserve the actual field schema; do not invent a sediment ID, pass only the signed URL, or JSON-stringify the object to satisfy a mismatched advertised type. A rejected reference has not transferred source bytes. Correct the maintained binding against the real provider schema or use an already supported route.

An immediate Library read can report that a newly created file is not yet visible. Reconcile the same returned identity with an exact list/search or provider status read, then continue its readback. Do not create another item to solve visibility. For an existing file revision, select the returned current `file_id` and expected version rather than assuming the stable Library ID selects that revision.

The maintained helper verifies every Library text window and metadata, and reports `full_library_text_and_metadata`; it does not label that result a raw-byte Library download. Keep original source custody until the native materialization and original source decoder establish the required byte match. Never retire the only original based on a filename, successful create or readable-text receipt.

### Carry the operation through native use

Keep the actual Library and file IDs, filename, version, source/export identities and ordered parts in one receiving manifest. Materialize those identities with the ordinary Library route above. Continue the existing source decoder and application command; no hosted connector authentication is required merely to read already materialized files.

A source bank and any separately fetched original bodies have distinct receiving states. Verify all declared source members through the original decoder, then continue any original network hydration under its existing operation. Source metadata availability does not establish that the referenced bodies have downloaded.

If the receiving host cannot fetch a retained original body, route that same body catalog to one actual network-capable worker and return the unchanged files through the existing binary/Library route. Preserve already received originals, their journal and the original downstream owner. Resolve temporary download URLs inside the receiving worker, keep them in a private short-lived map, and keep them out of published code, manifests and ordinary messages. A complete handoff includes the first actual native command and its output, then continues the original product work.

## Finish the existing delivery

Reuse the already accepted source manifest. Retain the source identity around preparation so a changed local file is not silently treated as the earlier edition. Before treating a saved copy as custody for retiring an original, compare its actual saved/materialized bytes with the retained size and SHA-256, or use a documented provider checksum with that exact meaning. Filename, size, and successful finalization alone do not prove that match. A changed or unknown digest remains an unresolved copy result for that same item; preserve the original and reconcile it rather than declaring exact-byte custody. Compare the actual receiving bytes with the retained manifest when exact-byte delivery is required. Preserve any provider rename separately from the original file identity. Report remote save, local materialization, downstream receipt, and application execution as their actual distinct outcomes.

Use multipart splitting only when the selected supported transport's real request or file-size limit requires it. A disconnected shell alone is not a reason to recode a binary into chat text or create a new transfer service.

## Retain large original outputs one part at a time

When the original application already uses the maintained `artifact_parts.py` interface and its `tjl.retained-artifact-parts.v1` manifest, continue that same helper after an observed large-file transfer failure or actual size limit. This application-specific helper is not bundled here; read its installed caller and current source before use. For a new standalone transfer, use this skill's bundled `transfer_parts.py` and its `commons.file-transfer.v1` contract instead. Do not treat these different manifests as interchangeable.

- `plan_artifact(source, operation, part_bytes)` streams the original and records the whole archive plus ordered part sizes and SHA-256 values without retaining a second full part set.
- `iter_artifact_parts(source, directory, manifest)` creates one verified part at a time. Save the prepared manifest first, save each yielded part through the unchanged workflow, and record its exact successful provider row before retiring only that redundant caller-owned part copy. Exhaust the iterator to perform its final complete-file verification. On a failed save, close that iterator, preserve all successful identities and the incomplete manifest, and stop producing more parts for that artifact.
- `join_artifact(manifest, directory, output, paths=None, *, receive_part=None, release_part=None)` preserves the original interface and adds optional receiving callbacks. `receive_part(index, item)` returns the next actual local file. The helper verifies its exact bytes and hash while appending it, then flushes before `release_part(index, item, verified_path, total_bytes)`. That callback may retire only the owned downloaded duplicate; preserve explicit shared or original paths. The full archive size/hash and non-overwriting atomic publication remain the final step.

Preserve the complete original archive while releasing temporary upload parts. A successful save row is a transfer receipt, not independent downloaded-byte verification. Retiring the only original still requires the exact custody check described above. Keep each successful part's provider identity and actual source wrapper, then save the final manifest after all part outcomes. Reuse those same part identities on receiving; match the real list/search result index rather than assuming the archive order equals provider result order.

Save useful completed customer files before constructing a large private backup, and save compact progressed state before large transfers. Keep inspection-only browser screenshots local unless they are requested deliverables; preserve original customer images and PDF-derived review files when they belong to the actual deliverable. This is the original application's capture ordering, not a new storage system.

Source and native receiving status remain separate: a complete manifest or published caller does not establish that its customer programme has run.


## Owner rule: inspect the actual outgoing product and every attachment

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing peer must actually open, run or render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated, empty, loading and error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP 200, unit checks or another peer's approval do not replace seeing the actual product.

ALL ATTACHMENTS count. Literally open, view, play and use the final delivered HTML, PDF, report, slides, spreadsheet, map, image, video, audio, archive and project as its recipient would. For archives, extract and open the actual contained deliverables and working project. Tests, checklists and screenshots merely captured are not substitutes. Use available high-quality generative media models and natural voice generation/TTS for videos; avoid robotic default voices. Watch and listen to the final export for pronunciation, pacing, timing and audio alignment. Keep building and fixing; inspection is not review/test performance theatre.

For the Ecosystem product use plain industrial design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. No decorative template slop. Keep the real workflows, data and computation. Reviews must lead directly to repairs and must not replace hard implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a separate verification product. Prior empty-Workspace screenshots are not acceptance of a completed scientific Workspace.

PERSISTENT PROPAGATION REQUIRED: copy this rule into every active owner-controlled policy/instruction surface the provider and workers actually read: global and project AGENTS, CLAUDE, GEMINI and rules files, provider-specific boot instructions, Commons source mirrors, cloud repository instruction copies, and current build and receiving guides. Every delegating peer includes this complete rule in child assignments, including its all-attachments and final-media clarification. Return exact changed paths, source/version and readback. A Slack ACK alone is not propagation. Preserve all existing owner controls and do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Continue the same Ecosystem Sprint Integration assembled product and its original scientific, run, browser and receiver owners. Continue native source, runtime and archive joins rather than diverting everyone to cosmetic review. Preserve October 13 cutoff 10am EDT/14UTC; this does not expire the standing inspection rule or change other owner-directed schedules.
