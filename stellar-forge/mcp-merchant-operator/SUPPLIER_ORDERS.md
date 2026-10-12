# Supplier-order operator, client and customer receiving

This desk receives complete openTRANS 1.0 orders and carries their original lines through confirmations, cancellations, dispatch documents, invoices and a portable customer workspace. The browser, installed commands and MCP tools use the same supplier-order store, immutable source files, draft history and durable request journal.

A saved draft is an editable working document. **Prepare** validates and retains the complete XML for one saved revision. **Select for this order** makes that immutable document contribute to current quantities. Each step remains independently inspectable and recoverable by its original request ID.

## Installed entry points

The selected distribution includes both contributions, `supplier-orders` and `merchant-provider-supplier-orders`, together with the original merchant MCP host.

| Surface | Entry |
|---|---|
| Private operator browser | `starforge supplier-orders serve --workspace PRIVATE_DIRECTORY --port 0` |
| Original local batch commands | `starforge supplier-orders help` |
| Configured merchant provider | `starforge merchant-mcp providers inspect supplier-orders` |
| Provider setup | `starforge merchant-mcp init-provider supplier-orders --options HOST_SETUP.json` |
| Original authenticated MCP host | `starforge merchant-mcp serve --config MERCHANT_JSON --port 3211 --token-env MCP_ACCESS_TOKEN` |
| Typed client command | `starforge supplier-order-client --help` |
| Programmatic client | Package export `./clients/supplier-orders` |
| Programmatic host setup | Package export `./merchant/supplier-orders/connection` |
| Complete native operator receiving | Package export `./clients/supplier-orders/receiving` |

Node 24 or newer and Python 3 are required by the original SQLite and XML/archive implementations. The package carries the selected original openTRANS DTDs and source examples. XML validation resolves those local selected declarations; a document cannot choose a network DTD or another host file.

The private browser prints its actual loopback URL, including the access token in the fragment. Open that exact URL. The page retains the token in the browser session and sends authenticated requests to the same origin. MCP uses the original merchant host's configured bearer or OAuth transport.

## Start an operator workspace

Use an owned private directory. The original local command creates and opens its native store:

~~~sh
umask 077
mkdir -p /srv/supplier-orders/customer-a
starforge supplier-orders serve --workspace /srv/supplier-orders/customer-a --port 0
~~~

The startup JSON gives the actual workspace ID, URL, origin and process ID. The process owns its workspace until it closes. To move from a browser-host process to a separate MCP-host process over the same directory, close the first process and then open the second host. The two surfaces share native state; each host retains its original workspace lifetime.

### Receive the original order

In **Original XML**, select the entire received file. The browser hashes it in bounded chunks, preserves the complete filename and chosen provenance, and sends its exact byte length and SHA-256 with one request ID. It streams the original file to the authenticated source endpoint.

The first original ORDER establishes its order. Further documents default to retained history unless the operator explicitly chooses current selection with the reviewed order revision pins. Inspect the actual original business ID in the source; IDs can contain punctuation and have up to 21 characters.

Every retained source remains downloadable as its complete original XML. Parsed values are additional working structure. Empty optional original fields remain present when the selected DTD permits them.

### Review current quantities and document history

The order view shows each original line's ordered, confirmed, cancelled, dispatched and invoiced quantity, together with what remains to confirm, dispatch and invoice. It also exposes the complete source article, original prices, delivery periods, packages, typed serial remarks and selected document references.

A confirmation reports the current line state:

- A nonnegative confirmed quantity replaces the previous confirmation for that line.
- A negative quantity states the current absolute cancelled quantity.
- A repeated confirmation does not add its cancellation again.
- Lines omitted from a later confirmation keep their earlier explicit line selection.

Distinct dispatch or invoice business documents contribute independently. Selecting a newer revision of the same business document replaces its earlier contribution. A revised document that removes an order reference clears the old contribution for that order while retaining the complete earlier history.

**Current** labels come from the core's effective selected document contributions. The history keeps older selections even when they no longer contribute.

### Edit complete confirmation, dispatch and invoice documents

Choose the original order, then create a confirmation, dispatch notification or invoice. A new draft carries:

- The complete current source orders and their original document hashes.
- Both each order revision and the SHA-256 of its selected state.
- The original supplier/customer party trees and exact source identifiers.
- Every applicable line, original order and delivery references, and numeric strings.

The header and line editor covers the original document fields. The complete JSON editor exposes retained source structure and extension fields. Keep monetary and quantity values as strings; converting them to JavaScript numbers would change decimal precision or lexical representation.

A dispatch or invoice may combine compatible original orders. Their required parties and currencies must agree. A confirmation belongs to one order. Original typed remarks are authoritative for serial values, so the serial preview is read-only; edit the complete remarks to change them.

For invoices, choose an explicit rounding policy when the recipient requires one:

~~~json
{"scale":2,"mode":"half-up","taxBasis":"line"}
~~~

The supported modes are `half-up`, `half-even` and `toward-zero`. `taxBasis` chooses line or document tax rounding. Without an explicit policy, the core keeps exact arithmetic and asks for a decision when a finite output decimal cannot represent the result.

Every saved change includes an operator reason. Saving checks the draft revision, all selected source order revisions and all corresponding state hashes. An imported history with an equal revision number cannot silently make an older selection current.

### Preserve edits through an interrupted request

The browser retains the complete request ID and request body before sending. An unresolved draft request prevents replacing its editor with another draft. While the request is active, the selected fields are frozen. After a recoverable failure, further edits belong to the same editor identity and generation.

Use **Reopen request** to obtain the original saved operation. If the response arrives after newer edits, the browser preserves those edits. If the page was reloaded and has no working editor, the accepted saved draft is reopened. A different editor never receives another draft's returned metadata.

After an actual selected-state conflict, inspect the current order and deliberately restore or revise the earlier document. The original request and draft history remain available. A new intended change receives a new request ID; resending an uncertain original write keeps its original ID and body.

### Prepare, inspect and select

Prepare one saved draft revision. The original renderer projects the complete document using the selected local DTD, validates it, retains its exact bytes and returns an immutable document and file receipt. Inspect all findings, original XML and source references.

Select that document for the intended order with the current expected order revision and a reason. Selection affects current quantity reconciliation; preparation alone retains an output for review.

The file download checks the declared byte length and SHA-256 before closing the chosen browser output. Browsers with the file-system save API stream into the chosen file. The in-memory fallback is capped at 128 MiB; use the installed client for larger files.

## Complete customer packages

**Export workspace** creates a complete native ZIP with original source files, documents, selected order histories, saved working drafts, operation records and package metadata. Keep its returned file ID and exact receipt.

**Inspect package** reads and verifies a complete selected ZIP before changing current state. **Merge package** retains incoming branch history and preserves the customer's current order and draft selections. A received older package does not replace newer customer work.

The browser retains the exact selected package identity for replay. An interrupted export is reopened by its original request ID. A repeated import uses its original input bytes, SHA-256, mode and request ID.

The package API accepts up to 8 GiB. XML and host-declared complete draft JSON accept up to 64 MiB. These are separate original file limits; MCP pages and ordinary tool requests have their own smaller transport bounds.

## Configure the merchant provider

The host declares private existing workspace directories and explicit original input aliases. Tool callers select these aliases; a tool request cannot provide an arbitrary host path.

Create a private connection file, for example `/srv/supplier-orders/connection.json`:

~~~json
{
  "schema": "stellar-forge.supplier-order-workspace-connection.v1",
  "workspaces": {
    "customer_a": {
      "label": "Customer A supplier-order desk",
      "directory": "/srv/supplier-orders/customer-a",
      "inputs": {
        "original_order": {
          "path": "/srv/supplier-orders/inbox/order.xml",
          "name": "order.xml",
          "bytes": 18432,
          "sha256": "REPLACE_WITH_THE_ACTUAL_FILE_SHA256",
          "kind": "xml",
          "provenance": {
            "kind": "customer-delivered",
            "note": "Original customer order selected by the host"
          }
        },
        "customer_package": {
          "path": "/srv/supplier-orders/inbox/customer.zip",
          "name": "customer.zip",
          "bytes": 1048576,
          "sha256": "REPLACE_WITH_THE_ACTUAL_FILE_SHA256",
          "kind": "workspace"
        }
      }
    }
  }
}
~~~

The lengths in this example illustrate the fields; replace both lengths and hashes with the actual selected files. `sha256sum` and `wc -c` can read those original files. The connection file must be an owned regular file with private permissions, normally `0600`. Each selected native directory has one alias. Inputs are read lazily only when the selected native operation consumes them.

Input kinds are:

| Kind | Original operation | Complete content |
|---|---|---|
| `xml` | `receive` | One original openTRANS XML file |
| `workspace` | `receiveWorkspace` | One complete native customer ZIP |
| `draft` | `saveDraftInput` | The entire original save-draft request JSON |

A draft input carries the native `saveDraft` fields. Its `requestId`, if present, must match the explicit tool request. The client alias owns the workspace selection, so the JSON does not contain a `workspace` field.

Create a separate setup JSON:

~~~json
{
  "directory": "/srv/supplier-orders/merchant-host",
  "connection": "/srv/supplier-orders/connection.json",
  "name": "Supplier-order desk"
}
~~~

Then run the original initializer and host:

~~~sh
starforge merchant-mcp init-provider supplier-orders --options /srv/supplier-orders/host-setup.json
starforge merchant-mcp serve --config /srv/supplier-orders/merchant-host/merchant-mcp.json --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

Set `MCP_ACCESS_TOKEN` through the host's existing secret environment. The initializer creates the original release store and private export directory, writes the merchant configuration and reads it back through the original configuration loader. An existing release store can be selected through `releaseStore` in the setup JSON.

Configuration and construction do not open the supplier-order database. `open` and `close` are explicit operations. A close drains this host's accepted work and retained read descriptors before closing the native workspace.

## Typed integration

Use the installed package's `./clients/supplier-orders` export. The runtime's adjacent `.d.mts` declares complete original documents, XML party trees, exact decimal strings, state hashes, native operations, pages and download results.

The following example uses the source entry directly; substitute the selected package export in an installed application:

~~~js
import { createSupplierOrderClient } from './source/stellar-forge/mcp-merchant-operator/supplier-order-client.mjs';

const client = await createSupplierOrderClient({
  url: 'http://127.0.0.1:3211/mcp',
  workspace: 'customer_a',
  tokenEnv: 'MCP_ACCESS_TOKEN',
  callOptions: { timeoutMs: 120000 }
});

await client.open();
try {
  for await (const page of client.pages('orders', { limit: 50 })) {
    for (const order of page.items) {
      console.log(order.orderId, order.revision, order.status);
    }
  }

  const order = await client.order({ orderId: originalOrderId });
  const draft = await client.newDraft({
    kind: 'ORDERRESPONSE',
    orderIds: [order.orderId]
  });

  // Edit the actual returned complete document, retaining original IDs and strings.
  const document = structuredClone(draft.document);
  const saved = await client.saveDraft({
    requestId: persistedSaveRequestId,
    kind: draft.kind,
    orderIds: draft.orderIds,
    expectedOrderRevisions: draft.orderRevisions,
    expectedOrderStateSha256: draft.orderStateSha256,
    sourceOrderDocuments: draft.sourceOrderDocuments,
    document,
    roundingPolicy: draft.roundingPolicy,
    reason: 'Confirm the reviewed original order quantities'
  });

  if (saved.state !== 'COMPLETE') {
    throw new Error(JSON.stringify({ id: saved.id, state: saved.state, error: saved.error }));
  }

  const prepared = await client.prepare({
    requestId: persistedPrepareRequestId,
    draftId: saved.result.draftId,
    expectedRevision: saved.result.revision
  });
  if (prepared.state !== 'COMPLETE') throw new Error(JSON.stringify(prepared));

  const fileId = prepared.result.file.id;
  const selected = await client.inspectExport(fileId);
  const received = await client.downloadExport({
    exportId: fileId,
    directory: '/srv/supplier-orders/downloads/selected-confirmation',
    expectedManifestSha256: selected.manifestSha256
  });
  console.log(received);
} finally {
  await client.close();
}
~~~

`originalOrderId` and persisted request IDs come from the application's selected original records and durable operation state. Save those request bodies before sending them. The example does not generate new IDs during recovery.

A direct native operator client can be passed as `{client:{endpoint,call},workspace}` instead of `url`. Its endpoint must be the exact stable identity for that original host. The shared download checkpoint additionally binds the workspace alias, file ID and manifest SHA.

### Operation results

Mutations return the original operation object, including a native `FAILED` or `INTERRUPTED` result. The typed client preserves these details. Check `state` before using its result.

For a large committed result, the response keeps the original operation ID, state, request hash and selected result IDs, with `resultSummary:true` and `fullResultRetained:true`. The complete document and original operation remain in the native store and full customer ZIP. Read a selected document/draft through its complete record or paged lines. The same request can reopen its original saved outcome.

### Complete pagination

`pages` yields each complete page, including `items`, `total`, `offset`, `limit` and `nextOffset`. It continues until `nextOffset` is `null`.

For selected order lines/history and selected document/draft lines, the client compares the original revision and state/hash identity between pages. It stops if the selected original record changes during that walk. Each page ends after a complete record and remains within 1 MiB. A single larger record returns its complete-export route.

The current list of orders, documents or drafts is an operational view. A complete customer ZIP provides the retained native workspace when a stable whole-workspace receiving artifact is required.

### Retained downloads

`inspectExport` reads the actual retained manifest bytes through the original file reader, verifies their hash and parses the complete file selection.

`downloadExport` saves:

- `supplier-order-manifest.json`, the exact original manifest.
- The complete original XML or customer ZIP named by that manifest.
- `download-state/`, the original endpoint/alias/file checkpoint and owned partial file.

Use the same directory for the same original download. Every resumed prefix is rehashed against its checkpoint. The complete file is published only after its original length and SHA-256 match. A changed manifest, endpoint, alias, source file or unrelated output file is rejected while the retained original files remain available.

Closing the host can interrupt a retained read. On reopen, the downloader reacquires a read descriptor for the same original file and resumes the verified byte offset. Keep the actual host URL stable across that continuation.

## Installed client commands

List all original method schemas:

~~~sh
starforge supplier-order-client tools
~~~

Open the configured alias and inspect current state:

~~~sh
starforge supplier-order-client call open --url http://127.0.0.1:3211/mcp --workspace customer_a
starforge supplier-order-client call state --url http://127.0.0.1:3211/mcp --workspace customer_a
~~~

Use a complete request JSON file for a mutation:

~~~sh
starforge supplier-order-client call saveDraft --url http://127.0.0.1:3211/mcp --workspace customer_a --args saved-draft-request.json
starforge supplier-order-client call operation --url http://127.0.0.1:3211/mcp --workspace customer_a --args original-operation.json
~~~

`original-operation.json` contains `{"requestId":"THE_ORIGINAL_REQUEST_ID","includeRequest":true}`.

Write every full page as JSONL:

~~~sh
starforge supplier-order-client pages drafts --url http://127.0.0.1:3211/mcp --workspace customer_a --args page-selection.json
~~~

Inspect and receive a complete selected file:

~~~sh
starforge supplier-order-client inspect --url http://127.0.0.1:3211/mcp --workspace customer_a --export-id ORIGINAL_FILE_ID
starforge supplier-order-client download --url http://127.0.0.1:3211/mcp --workspace customer_a --export-id ORIGINAL_FILE_ID --out /srv/supplier-orders/downloads/customer --manifest-sha256 ORIGINAL_MANIFEST_SHA256
~~~

The CLI prints an unsuccessful native operation before exiting unsuccessfully, so its original request identity remains available. `--timeout-ms` applies to calls and file chunks. `--chunk-bytes` selects 1–196608 bytes. Ctrl-C preserves an interrupted original download for the same command and directory.

Close the alias when its accepted work and receiving are complete:

~~~sh
starforge supplier-order-client call close --url http://127.0.0.1:3211/mcp --workspace customer_a
~~~

These commands do not implicitly close an alias after every page. The host owns its original workspace lifetime until the explicit close or host shutdown.

## Complete method map

All native names below begin `merchant_supplier_order_`.

| Client method | Native suffix | Original result or effect |
|---|---|---|
| `status` | `status` | Configured aliases and opened handles |
| `open` | `open` | Open selected existing native workspace |
| `close` | `close` | Drain work/reads and close that handle |
| `inputs` | `inputs` | Host-declared original file identities |
| `state` | `state` | Current native state and selected hashes |
| `orders` | `orders` | Paged current orders |
| `order` | `order` | Complete selected order |
| `orderItems` | `order_items` | Complete reconciled original lines |
| `orderHistory` | `order_history` | Original revision/selection history |
| `documents` | `documents` | Paged immutable document summaries |
| `document` | `document` | Complete normalized source/raw document |
| `documentLines` | `document_lines` | Full normalized lines |
| `drafts` | `drafts` | All saved drafts through SQL paging |
| `draft` | `draft` | Complete saved draft |
| `draftLines` | `draft_lines` | Full saved working lines |
| `newDraft` | `new_draft` | Complete unsaved original working draft |
| `saveDraft` | `save_draft` | Reasoned saved revision with exact source pins |
| `saveDraftInput` | `save_draft_input` | Same write from a pinned complete host JSON |
| `prepare` | `prepare` | Immutable XML for one saved draft revision |
| `select` | `select` | Explicit current document contribution |
| `receive` | `receive` | Exact original XML intake |
| `receiveWorkspace` | `receive_workspace` | Inspect/merge a complete native customer ZIP |
| `exportWorkspace` | `export_workspace` | Retain a full native customer ZIP |
| `operation` | `operation` | Reopen the original saved operation |
| `exportManifest` | `export_manifest` | Exact original file manifest |
| `exportFile` | `export_file` | Original byte chunk with read identity/hash |
| `exportFileRelease` | `export_file_release` | Release the selected original read handle |

The ordinary HTTP operator exposes the corresponding `/api/supplier-orders` routes. Raw XML and ZIP intake send URI-encoded metadata in `x-supplier-order-metadata`; encoding preserves original Unicode filenames and provenance. `/files/:id` returns original bytes with Range/If-Range and native hash headers. The typed client uses the existing MCP transport over the same model. Raw transfer sockets have a 30-second inactivity bound; complete document preparation and package operations keep their own original lifetimes.

## Native receiving and source lineage

The full operator receiving program in `receiving/supplier-orders-operator-native.mjs` consumes the actual `PASS`/`CLOSED` report from `supplier-orders/receiving/supplier-orders-native.mjs`. It reuses the original source identities and complete producer/customer packages, then carries the configured provider, full client, retained downloads, browser HTTP routes and customer continuation through their original APIs.

Run this program after the original document/quantity/portable receiving has completed:

~~~sh
node source/stellar-forge/mcp-merchant-operator/receiving/supplier-orders-operator-native.mjs --directory /srv/supplier-orders/operator-receiving --baseline-report /srv/supplier-orders/native-receiving/report.json --operation supplier-orders-operator-2769-20261012
~~~

The exported `runSupplierOrderOperatorReceiving({directory, baselineReportPath, operationId, signal})` accepts the same retained inputs. The baseline's original producer/customer directories and artifact paths must remain available. Its report names the complete input generation; the continuation creates its own four receiving workspaces and retains the original workspaces unchanged. An interrupted merchant setup keeps its partial directory and resumes through a recorded setup attempt using the same business stores. Its operation directory retains the exact preceding report, request bodies, readback identities, full files and native report. A resumed operation reopens the same saved requests and verifies all original artifact bytes before returning its completion.

The original parser and source declarations are at:

- `supplier-orders/opentrans.mjs` and `opentrans-tree.mjs`: complete normalization and emission.
- `supplier-orders/xml-native.py`: selected local DTD content validation.
- `supplier-orders/source/opentrans-source.json`: exact publisher source identities.
- `supplier-orders/source/openTRANS_1_0_eng/DTDs/`: original author declarations.
- `supplier-orders/source/openTRANS_1_0_eng/Examples/DTD/`: complete original author XML examples.
- `supplier-orders/source/UNITE_PROFILE_RULES.json`: captured recipient rule selections.
- `supplier-orders/core.mjs`, `workspace.mjs` and `portable.mjs`: exact current business state, request journal and complete customer receiving.
