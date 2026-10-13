# Original source and engine contract

## Selected implementation

This application uses the original npm releases pinned in package.json and package-lock.json. The completed installation receipt records the actual Node executable/version, package/module paths and bytes, package metadata, shared schema and lock identity. A source manifest selects the full application/receiving source.

| Engine | Selected release | Application seam |
| --- | --- | --- |
| @hocuspocus/server and @hocuspocus/provider | 4.7.1 | Native message protocol, authentication hooks, document synchronization, provider reconnect and awareness |
| Tiptap core, StarterKit, Collaboration and CollaborationCaret | 3.31.4 | Original editor and shared document schema |
| Yjs | 13.6.33 | Native document update encoding, state vector, conflict resolution and binary persistence |
| y-prosemirror | 1.3.7 | Original ProseMirror/Yjs document conversion and editor binding |
| y-indexeddb | 9.0.12 | Original browser offline binary persistence |
| crossws | 0.4.15 | Original WebSocket transport adapter used by the native server |
| Node | 24 | Native SQLite store, HTTP server and application runtime |

The npm lock also retains all exact supporting dependency resolutions and integrity fields. Neither the application nor its receiver replaces the CRDT, native wire protocol, merge algorithm or source transformer with a simplified implementation.

## Primary source references

- Hocuspocus source: https://github.com/ueberdosis/hocuspocus
- Native binary persistence: https://tiptap.dev/docs/hocuspocus/guides/persistence
- Native server hooks: https://tiptap.dev/docs/hocuspocus/server/hooks
- Provider lifecycle and configuration: https://tiptap.dev/docs/hocuspocus/provider/configuration
- Collaboration and schema management: https://tiptap.dev/docs/collaboration/getting-started/overview
- Tiptap editor source: https://github.com/ueberdosis/tiptap
- Yjs source: https://github.com/yjs/yjs
- y-indexeddb source: https://github.com/yjs/y-indexeddb

The documentation identifies binary Yjs storage as the canonical persistence form and warns that recreating the state from JSON on reconnect can duplicate content. It also documents the risks of concurrently editing with incompatible schemas. This application retains the full original binary and selects the same schema factory for migration and browser use.

The current documentation is supporting context. The exact installed package source, package lock, module hashes and application manifest establish which implementation executed.

## Application additions

The application owns source intake, strict schema review, tenant/document grants, durable SQLite metadata and original binary objects, job/request replay, deployment operations, full checkpoints, explicit epoch restore and deterministic portable project packages.

The native Hocuspocus hooks use the original engine's sequential message handling and store/unload lifecycle. Candidate binary validation occurs under the original document save mutex, then the original native message receiver applies the accepted update. Authorization is checked against the current host identity and grants when native messages are handled. Tokens and host secrets are installation-private and are absent from source/history/handoffs.

A deployment's frozen selection binds the actual installed engine selection and executed application source. A changed implementation or schema requires its own reviewed source edition. Package export uses the source snapshot loaded by the serving process so that editable source does not silently change underneath a running version.

## Reference inputs

reference/documents.json contains three clearly authored demonstration documents, two in tenant-a and one in tenant-b. Its complete UTF-8 identity is 3,818 bytes / SHA256 752bb3a767e5b2f456308df021bff017059e0631fb4370f31509346ad3a45237.

reference/schema.mjs is the single original schema factory used by migration and rendering. It selects StarterKit with undoRedo disabled; the browser adds original collaboration extensions.

The complete receiving programme uses those same three documents and creates private reference actor credentials at execution. It does not import real customer material or claim a scale result from that reference.

## Reused workspace source

vendor/stellar-expert/ retains the unchanged original private-directory and process-lifetime lease implementation, its exact relative source closure and its original license. SOURCE.json contains the original file identities. The lease is the existing kernel flock helper; the application does not implement another scheduler or time-based stale-owner lock.

## Delivery evidence

The source manifest establishes the complete application edition. runtime-ready.json establishes installation and actual module selection. The original receiving journal and result.json establish the performed workflow and named artifact identities. These are distinct records: a source check or installation alone does not establish a completed native/browser operation.
