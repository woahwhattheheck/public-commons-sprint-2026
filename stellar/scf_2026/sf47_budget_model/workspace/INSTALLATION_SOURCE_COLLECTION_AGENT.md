# Complete Source Collections for installed operators and agents

The source collection agent receives a whole reviewed set of original files into an existing Installation Source Desk. It uses the current browser collection algorithm, the native Python file.add writer, and the original Source Desk request journal. The installed command, typed library and merchant tools all preserve the complete original browser working copy.

## What the operator receives

A collection retains every original file byte, receiving filename, media type, provenance URL and observed time. Its review distinguishes new files, identical current files, filename conflicts, recorded requests, removed sources, explicit links, excluded rows and unresolved outcomes. An identical source requires the operator to select its exact current identity. A changed native edition invalidates the old review.

Before each native POST, the complete working copy contains the original request ID, unchanged command bytes and collection row link. Before another file starts, it contains the complete original receipt. A lost reply resumes through that same journal. The prior copy and all original editor fields, request history, staff context and unrelated Source Desk work survive.

## Installed command

Use Node22 or later and the original selected Grant workspace. Install the original distribution with grant-workspace/grant-agent or the merchant grant-workspaces provider. The command is:

    starforge grant-source-collection help

Choose an existing owned private parent directory for the local collection store. The store and exports contain original source bytes and private case context.

    starforge grant-source-collection create \
      --workspace /private/customer/grant --store /private/operator/source-collection \
      --actor "Receiving operator" --case operation-ORIGINAL32HEX --draft source-desk-ORIGINAL32HEX

The current original case supplies planId and createdAt. The native draft supplies its complete current source edition. An existing staff-scoped copy retains its original staff identity; use --staff-context with the actual original staff-context JSON when creating one under that identity. Without that file, create uses the existing owner context. Original native service authentication still controls all requests.

To continue an exported browser working copy:

    starforge grant-source-collection import \
      --workspace /private/customer/grant --store /private/operator/source-collection \
      --actor "Receiving operator" --file /private/received/complete-working-copy.json

Both create and import retain the complete original input before any financial or source mutation. After an interrupted local creation, inspect the same store before issuing another create. Source receiving always uses that retained copy identity.

The CLI attaches to the configured original service. --allow-start explicitly permits its maintained launcher; --python and --scenario select the original installed runtime/selection. Closing the command drains its borrowed client and releases it. An already-running Application remains with its existing owner.

## Stage a complete file selection

The stage input is one JSON file:

~~~json
{
  "files": [
    {
      "path": "/private/received/source.pdf",
      "name": "Original_Source.pdf",
      "type": "application/pdf",
      "expectedSha256": "THE_COMPLETE_ORIGINAL_SHA256",
      "lastModified": 0
    }
  ]
}
~~~

Each source is1 byte through8 MiB. The complete staged collection remains at most64 MiB. The original Source Desk retains its native selected-file/draft capacities. The stage command reads and verifies the complete selected bytes once.

    starforge grant-source-collection stage \
      --workspace /private/customer/grant --store /private/operator/source-collection \
      --actor "Receiving operator" --expected-sequence 0 --input /private/file-selection.json

Every mutation prints the resulting complete-copy sequence. Use that exact new sequence for the next command. The sequence is the operator working-copy version, separate from the native Source Desk revision.

Use start with a JSON input containing title, sourceUrl and observedAt to begin another collection. It invokes the original browser action and parks the preceding full copy. Stage automatically creates the first collection when none exists.

Use edit with the original row or collection field:

~~~json
{"rowId":"ORIGINAL_ROW_ID","field":"sourceUrl","value":"https://original.example/document"}
~~~

Collection defaults and individual receiving metadata follow the original engine. The source URL/date must describe the actual original source. The selected receiving filename is part of the immutable native upload identity.

## Review, resolve duplicates and receive

Run review with the current --expected-sequence. It refreshes the original native head and saves the exact review signature. Resolve collision/invalid/recovery rows using their original source or request. To link an IDENTICAL row, retain the full identity returned by the current review:

~~~json
{
  "rowId":"ORIGINAL_ROW_ID",
  "selection":{
    "revision":7,
    "fileId":"input-ORIGINAL64HEX",
    "sha256":"ORIGINAL64HEX",
    "bytes":1024,
    "filename":"Original_Source.pdf"
  }
}
~~~

Pass this to use-existing. clear-existing removes an explicit link and requires another review. Included=false excludes a row without discarding its original bytes.

    starforge grant-source-collection receive \
      --workspace /private/customer/grant --store /private/operator/source-collection \
      --actor "Receiving operator" --expected-sequence CURRENT_SEQUENCE \
      --expected-signature ORIGINAL_REVIEW_SHA256

The original engine receives the entire reviewed collection serially. Ctrl-C during receive asks the original loop to pause after its current native request and retain the complete checkpoint. Each new row becomes the original file.add operation. A native draft change or unresolved original request is surfaced with the exact retained copy and journal state.

## Interrupted replies and concurrent operators

Reopen the same store. Inspect displays the retained pending request and current sequence. Reconcile first reads the original native journal:

    starforge grant-source-collection reconcile \
      --workspace /private/customer/grant --store /private/operator/source-collection \
      --actor "Receiving operator" --expected-sequence CURRENT_SEQUENCE

If it is NOT_RECORDED and the original unchanged command should continue, add --retry. The same request ID and exact original bytes are reused. retire-rejected first reads the journal and retires only a definite original rejection; unknown outcomes remain selected.

The checkpoint store publishes immutable consecutive versions with compare-and-swap semantics. A competing different version cannot replace a saved checkpoint. An exact retry can recover the same checkpoint; a stale caller must reopen the complete current copy. Content-base64 values are retained once by their exact UTF8 SHA while every checkpoint reconstructs and verifies the complete original browser JSON.

A local persistence failure stops native POST. Restore storage and reopen the durable copy; the request journal decides whether an earlier original command recorded. No new native request ID is generated for an unresolved retained command.

## Complete export and browser continuation

    starforge grant-source-collection export \
      --workspace /private/customer/grant --store /private/operator/source-collection \
      --actor "Receiving operator" --out /private/received/complete-working-copy.json

The output contains the complete original browser copy, original file bytes, earlier copies, native requests and receipts. Import it with the original Source Desk working-copy UI. history lists exact immutable sequences; --sequence on export selects a retained historical copy. The full copy bound is512 MiB. Export publication is create-only and exact existing output bytes may be reused.

## Typed library

Import the installed exports:

The selected package exports ./grant/source-collection/agent, ./grant/source-collection/store and ./grant/source-collection/session, each with its complete declaration file. The session borrows the existing GrantWorkspaceClient and never closes it. The caller owns admission and final client drain. persist(copy,{expectedSequence}) must durably return the complete unchanged copy at exactly sequence+1. The supplied store implements that contract.

The agent exposes snapshot, inspect, start, stage, edit, useExisting, clearExisting, review, receive, reconcile, retireRejected, pause and refresh. snapshot retains all original bytes; inspect returns an inventory with file content omitted and exact native request/receipt summaries.

## Merchant tools

The existing Grant owner exposes sixteen merchant_grant_source_collection_* operations. Use a declared workspace and stable collection-UUID. The host stores the complete private copy under its existing exports directory and reuses its existing client, service lifetime and retained file readers.

Create/import, stage/edit, explicit duplicate choice, review and receive follow the same original engine. expectedSequence binds each mutation. receive additionally requires expectedSignature. pause stops the active original loop after its current request. The host waits for pending operations on close.

A configured input above32 MiB must declare kind:"source-working-copy"; this explicit input type supports the complete512 MiB browser file. Smaller ordinary host inputs remain usable. Retained working-copy snapshots and export readers support512 MiB. Existing input transfers retain their original32 MiB bound, native HTTP request bodies32 MiB, and each source8 MiB. Large copies should use the declared host input or a retained snapshot. Every original input selection uses its whole-file SHA256.

Tool results retain complete original JSON in the existing immutable snapshot system. Use the returned file reader for complete bytes and snapshot pointers for inventory pages. source_collection_export produces the exact browser-importable JSON; no source data is truncated.

## Original ownership and receiving

Original collection/browser source: operations_installation_source_collection.mjs and operations_installation_sources.mjs (828A). Native requests: operations_installation_sources.py. SourceDesk canonical preparation/recovery and the original Grant owner remain shared product source.

The focused source-protocol exercise covers a complete collection, a lost native reply, exact journal recovery, an explicit identical-file link, lost durable-save acknowledgement, reopening the same copy and retaining prior history. That exercise runs over injected boundaries; product receiving continues through the existing original installed Grant lifecycle. Current native runtime results are recorded separately from source checks.
