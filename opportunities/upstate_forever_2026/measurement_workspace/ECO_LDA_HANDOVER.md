# Scientific project handover from Measurements to LDA

This handover carries the complete current Measurements project into LDA as a distinct scientific source family. It retains the original native project ZIP, complete edition populations, selected collection and collection-edition identities, and unchanged saved result contents. LDA keeps its review and portable history alongside those originals. Neither the handover nor LDA recalculates a saved result or turns measurements into modeled annual loads.

Operation: ECO-MEASUREMENTS-LDA-HANDOVER-9F05-20261013. Apply the full owner instructions in CURRENT_OWNER_DIRECTION.md, version 2026-10-13.4, and AGENTS.md. Preserve the current scientific operators and their original receiving jobs.

## In the installed application

Open **Measured observations → Scientific project handover**. Refresh the available sources. The list is bound to the actual Measurements revision; incomplete collections are visible but cannot be selected. Choose the original collections, any saved collection editions and saved scientific results to present in LDA, then name and save the complete handover.

Selection controls the readable source inventory. The complete original Measurements project remains in the archive even when no additional collection or result is selected. Scientific results stay at their saved revision. Later record reviews and reach assignments are not substituted into earlier results.

The browser retains the exact request identifier, title, revision and selections before submitting. A delayed or lost response can be recovered with **Reopen retained request**. An interrupted request continues through **Continue the same request**. A changed selection uses a new identifier and leaves the previous request and archive intact. A recovered request never silently replaces a different pending request in the current view.

Download the complete ZIP. It is streamed through the existing 256 KiB chunk protocol, with exact per-chunk length and SHA checks; the assembled byte count must equal the original descriptor. The native reader independently checks the whole ZIP hash and every member on receiving. The original workspace/person scope guards navigation and late responses. Browser storage failure is stated explicitly; download the retained request to preserve its identifier.

The installed Python bridge captures the original native-domain sources before a new handover, just as the existing complete-edition route does. A historical completed request reopens its retained native edition instead of relabeling current science as that earlier result.

## Native CLI

Use the existing installed Node 22.16 or later runtime and Python standard library. Select an existing Measurements directory, not a new demonstration database.

    node measurement_workspace/engine/cli.mjs handover-choices --workspace ORIGINAL_MEASUREMENTS --output choices.json

Create an ordinary JSON request containing the exact displayed native revision and original IDs:

    {
      "id": "A_64_CHARACTER_LOWERCASE_HEX_REQUEST_ID",
      "title": "Selected scientific project",
      "expectedRevision": 12,
      "collections": [{"id": "ORIGINAL_COLLECTION_SHA", "editions": ["ORIGINAL_EDITION_SHA"]}],
      "results": ["ORIGINAL_SAVED_EXPORT_ID"]
    }

The displayed identifiers above are placeholders. Use the actual original selections and retain the same full request file for a retry; do not generate a replacement ID after an uncertain response.

    node measurement_workspace/engine/cli.mjs handover-export --workspace ORIGINAL_MEASUREMENTS --native-workspace ORIGINAL_ECO_WORKSPACE --file retained-request.json --output completion.json
    node measurement_workspace/engine/cli.mjs handover-status --workspace ORIGINAL_MEASUREMENTS --id ORIGINAL_HANDOVER_SHA
    node measurement_workspace/engine/cli.mjs handover-download --workspace ORIGINAL_MEASUREMENTS --id ORIGINAL_HANDOVER_SHA --output complete-handover.zip

The optional --native-workspace uses the original large_context.py capture mechanism. Omit it only when the selected Measurements workspace already carries the intended original native-domain context. Do not infer a domain assignment from a collection title.

The native producer uses the unchanged exportEdition snapshot and durable phase/replay mechanism. It checks the captured revision against the explicit request, retains the full project and all population members, and derives the selected source inventory only from that frozen project. A different captured revision is an explicit conflict; the original request is retained.

## Receiving and complete original documents

The installed reader is measurement_workspace/engine/eco_handover.mjs. Its exports are:

- inspectHandover(inputFile): full {projection, source_documents}.
- readHandoverDocument(inputFile, {id: documentId}, outputFile): exact complete selected bytes and a source/native/file identity receipt.

CLI access is available without opening or changing a local Measurements database:

    node measurement_workspace/engine/cli.mjs handover-inspect --file complete-handover.zip --output complete-source-inspection.json
    node measurement_workspace/engine/cli.mjs handover-read --file complete-handover.zip --selector exact-selector.json --output complete-original-file

The projection schema is eco-measurements-source-v1. It binds the whole source ZIP bytes/SHA, original native edition and workspace revision, explicit selections, complete source-document metadata and readable coverage. source_documents is keyed by the corresponding document ID. Each eligible entry includes its complete strict UTF-8 text. Binary, non-UTF-8 and over-limit documents have an explicit reason and retain a selector for their exact complete bytes.

The ZIP carries project.zip, edition.json, selection.json and every original edition population member, plus HANDOVER_MANIFEST.json. Its manifest lists every member's exact path, byte count and SHA. project.zip remains byte-for-byte the original complete Measurements archive, including SQLite, original files, preparation history, workbook lineage, companion files and saved populations.

Receiving validates the outer inventory, then invokes the original native archive unpacker and the maintained Measurements source validators. Selected collection descriptors, saved editions and saved result rows are reread from the frozen project; a changed ID, hash, revision or member fails before projection. The fixed reader contains no arbitrary archive-provided executable source.

Supported original resultSourceSelection kinds retain their exact historical/current-association distinction and any missing-source records. Other saved result kinds retain their complete original JSON and explicitly state that no source association adapter was used. They are not presented as having inferred historical lineage.

LDA invokes this reader once for its full readable batch, then preserves the projection/text batch under its original immutable local-source custody. Search and Brief use those retained exact bytes; they do not repeatedly validate or reconstruct scientific tables. The full native ZIP has a 384 MiB receiving limit. Each Brief text is at most 8 MiB; the complete eligible text batch is at most 64 MiB and its encoded inspection at most 96 MiB. An over-limit aggregate selection is rejected explicitly, with the original archive retained; text is never truncated or silently dropped by order.

To receive the complete scientific project independently, extract the unchanged project.zip and use the original large-receive command with an empty Measurements workspace. This retains original tables and sources, adds the existing receive event/revision, and preserves the sender's historical identities. Existing preparation or source-lineage work in a target prevents replacement.

### Current collection edition families

The picker includes ordinary collection editions and completed native large-collection saved populations. A large population retains its original collection binding, edition descriptor and all five complete output files. Those bytes already belong to the original project snapshot. Earlier project ZIPs are not recursively reconstructed; the handover's project.zip is the exact complete selected current project. Unfinished or conflicting bindings remain visible and cannot be selected. The original exporter now enforces expectedRevision during capture as well as on retained recovery.

## Original archive compatibility

Current MeasurementWorkspace always creates intake_meta, intake_sources, intake_editions, intake_receipts, intake_origins and intake_binary_sources. The original large archive allowlist now includes those exact schemas. Existing exportIntakes/validateIntakes and original lineage validators check their complete source and receipt meaning. Every retained text and binary source is hash-checked, including stored originals not referenced by the latest preparation.

The existing receiving transaction copies all original rows without rewriting their JSON or binary content. Existing target preparation/lineage work is protected by the same empty-target check. Legacy archives without intake retain the recipient's default intake identity. Benchmark, sediment and sediment-comparison saved exports use the same validators as the ordinary portable receiving path.

## Operate the exact delivery on the original equipped course

The existing equipped operator owns execution. Do not start a duplicate scientific run or browser case. On that course, select the real completed workspace and its saved collection/result IDs; export the handover, reopen the same request after navigation, and download the complete archive. Inspect the actual desktop and narrow view, the selected original/result files and the complete ZIP.

Use the fixed reader to inspect the full native archive, open selected original text/binary documents, and then use the original LDA consumer to receive the same complete source. Reopen its retained source, Search/Brief and independent portable review. Confirm that original result values and source identities remain unchanged. If an operation disconnects, reconcile its retained request/status and complete output before continuing that same operation.

Continue the retained equipped course with its original workspace, request identifier and output directory. Preserve the complete archive, reader projection, selected documents and actual desktop/narrow captures alongside that course's existing completion record.
