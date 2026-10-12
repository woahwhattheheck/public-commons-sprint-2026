# Zotero library and Research workspace

Capture a selected Zotero Web API v3 library, retain every original JSON page, review collection projects and exact metadata changes, and deliver selected evidence to the existing Research dossier. A receiving operator gets the original source objects, native revision history and complete linked Research dossiers.

The source-bundle receiver, dossier revision chain, citations, findings and dossier portable format remain the original maintained implementations.

## Open the operator

Node 22.16 or later is required for the native SQLite store. No additional npm runtime dependency is introduced.

From the maintained installed distribution:

~~~sh
starforge zotero serve --state /absolute/private/zotero-workspace \
  --research-dir /absolute/private/original-research \
  --connection-file /absolute/private/zotero-connection.json
~~~

From a source checkout:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/zotero/cli.mjs serve \
  --state /absolute/private/zotero-workspace \
  --research-dir /absolute/private/original-research
~~~

The command prints a nonsecret origin and the private connection-file path. Open the URL in that private file. The fragment capability is removed from the address bar and remains only in the browser document's memory. Opening the same saved directory after closing creates a new current connection.

The original Research server also accepts --zotero-state /absolute/private/zotero-workspace. Its authenticated Zotero control opens one owned child using the already selected Dossier store. The child returns evidence to that same store.

## Select and capture a library

In **Libraries**, save the numeric user or group library ID, an operator title, source and reuse terms, and an optional collection view. Numeric IDs are distinct from display names. Leave the API-key environment reference empty for a public read, or enter the name of an environment variable already available to the host. The workspace stores the name, never the key value.

A profile explicitly selects descendant collections and trash metadata. Its complete capture reads the library's collection and item endpoints; project scope is applied to the retained edition afterwards.

**Capture and intake** starts the selected profile revision. The native capture:

1. Reads collection and item pages sequentially, retaining each full response before advancing the saved cursor.
2. Checks response API version, library version, original keys, offsets, native totals and bounded next-page links.
3. Honors native Backoff and Retry-After. A waiting job shows its next eligible time; use **Resume** when eligible.
4. Reads the final versions probe. An edition becomes complete only when all pages and the probe agree on library version and counts.

A changed library becomes SOURCE_CHANGED. **Restart source attempt** preserves the earlier attempt and its original pages before starting another attempt on the same capture record. A cancelled or interrupted read can resume with saved pages and cursor. An old cancel/start request UUID cannot affect a later attempt.

The selected profile revision, source URLs, response headers, full byte hashes, collection tree, item types, creators, tags, relations, parent/child relationships and unknown native fields remain available. A metadata attachment is not an acquired attachment file. The workspace does not follow linked URLs, download attachment contents, fetch full text, write to Zotero, or acquire a paid API product.

The protocol follows the published [Zotero v3 basics](https://www.zotero.org/support/dev/web_api/v3/basics), [syncing guidance](https://www.zotero.org/support/dev/web_api/v3/syncing), and [native types and fields](https://www.zotero.org/support/dev/web_api/v3/types_and_fields).

## Import original saved documents

Choose a native items or collections JSON array, or a complete document-set file, in **Capture and intake**. The original array is wrapped without changing its bytes. Imported source headers remain provenance rather than proof that a live capture completed.

The CLI wraps exact files:

~~~sh
starforge zotero documents --library-type groups --library-id 123456 \
  --items /absolute/original-items.json \
  --collections /absolute/original-collections.json \
  --source-reference "Original selected source and retrieval context" \
  --out /absolute/private/document-set.json

starforge zotero import --connection /absolute/private/zotero-connection.json \
  --profile profile:ORIGINAL_UUID --profile-revision 1 \
  --file /absolute/private/document-set.json --request-id ORIGINAL_REQUEST_UUID
~~~

Coverage is explicit:

| Coverage | What the record establishes |
| --- | --- |
| CAPTURED_LIBRARY | Complete metadata pages and final version probe from the selected live Zotero Web API v3 library. |
| RETAINED_DOCUMENT_SELECTION | Exact imported document bytes. Missing items do not establish remote deletion. |
| CAPTURED_PROTOCOL_EXERCISE | Complete pages from an explicitly identified local HTTP protocol exercise. This is not a live Zotero library. |

## Review projects and changes

In **Projects**, select an edition, save collection scope, choose exact item keys and evidence classifications, and retain notes and findings. The default scope comes from the selected edition's actual profile. Revising an identical source selection's title or scope produces a correctly identified edition rather than reusing another profile's definition.

Every save uses an expected revision. Prior item decisions remain in history when an item is absent from a later edition. Findings retain explicit original keys present in the selected view; required source review is not silently discarded.

**Changes** compares two exact editions. Its complete file contains added and removed original items/collections and before/after values at every changed JSON field path. Creator arrays, tags, parent fields, collection memberships and unknown original fields are included. Display previews are bounded; full edition, comparison and original-file downloads preserve complete content.

## Deliver into original Research

Create the dossier and its question in the maintained Research application. In Zotero **Research delivery**, select that dossier/question and the saved project revision, then prepare the source bundle.

Preparation pins project revision, target identity, full bundle bytes and digest. The original Research preview shows what will be received. Reception calls the original previewSourceBundle and receiveSourceBundle APIs with their original revision and body-digest contracts.

The bundle contains:

- An unselected custody source with every original Zotero page and the complete project/edition lineage.
- A full original JSON file for each item in the selected view, including native citation data and source-page position.
- Selected evidence, original classifications and notes, and findings linked to original item keys.

A lost response is recovered through the same handoff record and request UUID. Changed input under the same UUID is rejected. A completed handoff retains the original Dossier edition, revision and source-bundle digest. Original dossier normalization and portable validation own source and finding semantics.

## Receive, edit and forward the complete workspace

**Receiving** exports all native revisions, request receipts and full original source objects. Every linked completed Research dossier is included through its original complete JSON export. The packet contains environment reference names, with no API-key values, current browser tokens, SQLite writer locks or running process handles.

Use a new named receiver in the UI, or:

~~~sh
starforge zotero export --connection /absolute/private/zotero-connection.json \
  --request-id ORIGINAL_EXPORT_UUID --out /absolute/private/full-workspace.json

starforge zotero receive --state /absolute/private/second-operator \
  --file /absolute/private/full-workspace.json --request-id ORIGINAL_RECEIVE_UUID

starforge zotero serve --state /absolute/private/second-operator
~~~

The receiving directory must be empty or already owned by this exact packet/request. A durable marker establishes ownership before native files are written. Object hashes, contiguous native histories, exact heads, Research source-bundle links and original Dossier histories are validated. Interrupted receiving continues without replacing accepted originals.

A separate local receiving binding maps each immutable original Research workspace/dossier identity to its actual received store. Handoff receipts are not rewritten. A second operator can edit the original received Research dossier, re-export the Zotero workspace and pass those changes to a third operator. The inherited Research history prefix is checked before each export. The received original store is automatically available on a normal standalone reopen.

An accepted export is tied to its original request UUID and bytes. Replaying that UUID returns the accepted artifact even after later edits. Use a new UUID to publish a later export. If an original linked Research store is unavailable, export identifies the missing source instead of omitting its history.

## Native API and typed client

NATIVE_CONTRACT.json gives exact mutation shapes. client.d.mts declares file-client and selected profile/project types.

~~~js
import {createZoteroClient, loadZoteroConnection} from './client.mjs';

const client = createZoteroClient(await loadZoteroConnection('/absolute/private/connection.json'));
try {
  await client.verify();
  const project = await client.invoke('project.page', {
    id: 'project:ORIGINAL_UUID', revision: 3, offset: 0, limit: 50
  });
  const file = await client.exportWorkspace('ORIGINAL_EXPORT_UUID');
  // Complete bytes; SHA256 checked against the server's full-byte digest.
} finally {
  client.close();
}
~~~

Every public workspace operation is admitted into one drained lifecycle. Close rejects new work, cancels active HTTP captures, waits for admitted operations, closes owned receiving children and releases the native writer. Borrowed original Research stores stay with their owner.

## Complete receiving example

See [NATIVE_RECEIVING.md](NATIVE_RECEIVING.md). The single restartable example uses the unchanged upstream Zotero software fixture, an explicitly local HTTP protocol source, real SQLite, full original Research history, CLI receiving and the actual eight-view operator.

Original fixture bytes and their license are under reference/zotero/. Authored response envelopes and changes are identified separately. Keep the original notice with the fixture when distributing the example.
