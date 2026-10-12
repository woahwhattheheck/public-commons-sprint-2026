# SEC EDGAR merchant workspace

The operator workspace turns retained SEC company-facts and filings captures into source-bound data products for the original Stellar/x402 seller. It keeps original captures, saved merchant revisions, previews, source fingerprints and buyer exports together.

## Open the desk

Use the existing Node runtime and the exported server entry point:

```js
import { startEdgarWorkspace } from './server.mjs';

const operator = await startEdgarWorkspace({
  directory: '/absolute/private/sec-edgar-workspace',
  storeDirectory: '/absolute/private/sec-edgar-captures',
  port: 0,
});

// Open operator.url in the local browser. Retain it privately.
// Close the same instance when the operator work is complete.
await operator.close();
```

The listener binds to loopback. Its opening URL carries a session fragment, which the page exchanges for an HttpOnly, same-origin cookie and removes from the address bar. API callers may use the returned `workspaceKey` as a bearer token. The operator listener checks the actual host and browser origin. The public merchant remains on its original seller listener.

All browser assets are plain HTML, CSS and JavaScript. No dependency installation or build is required for the workspace.

## Complete the source-to-product workflow

1. **Import the original capture.** Choose a company-facts or filings JSON file, its issuer CIK, edition identifier and original SEC URL. Optionally retain its captured timestamp. The browser sends the file bytes directly to the same workspace; the source adapter validates and stores them.
2. **Create the data product.** Select the capture, request path, concept allowlist or filing forms, maximum page size and original seller payment options. The concept picker uses the fields actually present in the selected capture. An existing product's payment terms can seed a new product.
3. **Inspect the selected rows.** Apply taxonomy, concept, unit, form, accession and date filters. Query pages remain bound to their exact edition and selection. Downloaded selections retain the source metadata and original value strings.
4. **Save the draft.** Save writes a complete, numbered merchant revision. Each product is checked against the retained capture's kind, CIK and SHA-256, and its example query verifies that its offered concepts are present. A concurrent save returns HTTP 409 with the current revision and leaves the browser's local edits available.
5. **Export the buyer handoff.** Download the merchant configuration, OpenAPI document or complete handoff from the saved revision. The workspace and merchant CLI use the same handoff builder: each product includes its canonical `request.method`, `request.url`, `request.query` and original compiled payment options. The workspace adds selected edition metadata, revision, OpenAPI and merchant configuration. The merchant CLI composes the original seller and generated buyer client.

The capture library also downloads the original SEC JSON directly. A company-submissions response can name additional historical files; the library exposes that metadata without presenting those files as already imported.

## Retained revisions and recovery

Workspace metadata is stored in the private `versions/` directory using the existing SF88 atomic writer. Numbered versions are published with exclusive creation. The current draft is the highest valid revision, so two writers cannot overwrite the same revision.

`saveDraft` requires `expectedRevision`. Re-saving identical configuration returns the current revision. Restoring a previous nonempty configuration validates its source editions and writes a new revision, preserving its original history.

The browser distinguishes local edits from the saved draft. Previews can inspect an unsaved product; buyer exports always use a saved revision. Refreshing saved state or importing another capture retains the local draft's starting revision, so refreshing cannot silently overwrite a concurrent operator's save. To resolve a save conflict, open **Merchant JSON and draft recovery**, choose **Download local draft**, then **Load saved draft**, and apply the intended changes to that revision. Edits in the JSON pane remain available until applied or explicitly replaced.

## JavaScript interface

```js
import { openEdgarWorkspace } from './workspace.mjs';

const workspace = await openEdgarWorkspace(directory, { storeDirectory });
const state = await workspace.snapshot();
await workspace.saveDraft({ expectedRevision: state.revision, config: merchantInput });
const selection = await workspace.preview({ productId: 'issuer_assets', query: { limit: '25' } });
const handoff = await workspace.buyerHandoff();
await workspace.close();
```

The workspace additionally exposes `importCapture`, `getEdition`, `readRaw`, `exportConfig`, `exportOpenApi`, `listRevisions`, and `restoreRevision`. `preview` accepts an optional complete `config` for an operator's unsaved selection. Source and payment semantics remain in the original SEC compiler and capture adapter.

## Operator HTTP interface

| Method and path | Result |
| --- | --- |
| `POST /api/session` | Exchange `{key}` for the local session cookie. |
| `GET /api/state` | Current revision, merchant configuration, source editions and binding availability. |
| `PUT /api/draft` | Save `{expectedRevision, config}` with compare-and-swap semantics. |
| `POST /api/import?id=…&kind=…&cik=…&sourceUrl=…` | Import the unchanged request bytes as an original capture. |
| `GET /api/editions/:id` | Source record plus available concepts and forms. |
| `GET /api/editions/:id/raw` | Download the original capture bytes. |
| `POST /api/query` | Preview `{productId, query, config?}` through the original source adapter. |
| `GET /api/revisions` | Most recent saved revisions and total history count. |
| `POST /api/restore` | Restore `{revision, expectedRevision}` into a new current revision. |
| `GET /api/download/config` | Saved merchant configuration. |
| `GET /api/download/openapi` | Saved product OpenAPI contract. |
| `GET /api/download/handoff` | Complete saved buyer handoff. |
| `DELETE /api/session` | Clear this browser's workspace cookie. |

Import requests retain the original bytes and default to the source parser's 32 MiB maximum capture size; the server option permits a deliberate lower limit down to 1 KiB. JSON operator commands are limited to 2 MiB. Filesystem paths and access keys are excluded from buyer exports.
