# Redis merchant workspace

Create and operate named Redis or Valkey data products from one saved workspace. The editor supports native TCP and Upstash HTTPS source profiles. It uses the original Redis query compiler and live source, original merchant preparer and generated client, and the original retained seller release store.

## Open an existing source as a workspace

Use Node 22.16 or later. The host selects the source connection and its environment references. For native TCP, install the Redis feature through the merchant runtime; the Upstash transport uses Node's HTTPS implementation. Importing and editing a workspace is offline. Live previews require the configured database and credentials.

```sh
starforge-merchant redis workspace create \
  --directory /private/redis-workspace \
  --source /private/redis-source.json \
  --plan /private/merchant-plan.json \
  --label "Inventory data"

starforge-merchant redis workspace open \
  --directory /private/redis-workspace --port 8438
```

From a source checkout, replace `starforge-merchant redis workspace` with `node stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/cli.mjs`. Use the `operatorUrl` printed by the open command. The server listens on `127.0.0.1` and gives each process a new operator token. Stop that process before opening the workspace from another terminal command.

The source's connection, pool settings, credential reference names and selected database CA are retained at import. The UI edits named products and merchant terms. Change a host connection by creating a workspace from the corresponding host-selected source file. Passwords and Upstash tokens continue to come from the host environment when a preview or seller runs.

## Build the product catalog

The Products tab edits fixed-key values, projected hash fields, sorted sets and stream entries. A parameterized key consists of a fixed prefix and a declared string enum. The original scalar binder validates all inputs. Integer values and bounds may be exact decimal strings; output preserves large integers, binary values and Redis nulls through the original result format.

Set the query's maximum rows, response bytes and timeout. Sorted-set rank and stream-entry continuation use declared offset/after parameters. The preview's **Read next page** button sends the actual `nextInput` returned by the original read script.

The Merchant terms tab edits the public origin, default payment, routes, public input examples and parameter descriptions. Its full-plan editor supports the original per-route and multiple-option payment features. **Review draft** compiles the whole source and merchant plan without opening Redis. **Save revision** retains the complete configuration and note.

Drafts and exact pending requests use the existing merchant editor's IndexedDB store, keyed by this workspace's immutable ID. Download/import draft transfers named queries, plan and note as JSON. The saved database is authoritative for completed revisions. If another browser saves first, this draft retains its original base version and the server reports the revision conflict; load the current revision or a previous version explicitly before saving the desired combined configuration.

## Read, package and release

1. In Live preview, choose a saved version, product and input object. Run the preview against the configured database. The returned columns, rows, observed time, exact input and pagination stay with the operation. Download the complete result when needed.
2. In Customer packages, prepare the current saved revision. The original preparer produces source/service configuration, the original OpenAPI document and customer client. The public OpenAPI and client files are available for download in the browser; the full private package stays inside the workspace.
3. Choose a completed package, new release ID, label, seller port and optional facilitator URL. Stage it into the workspace's original retained release store.
4. Open Release controls. The original interface handles selection, run/stop, upgrade, rollback, developer/customer handoff and seller operations. Closing the authoring workspace also closes the release console and any seller owned by that console.

An empty facilitator uses the original challenge-only seller mode. Actual payment behavior comes from the selected native facilitator and the merchant's original payment configuration. Runtime selections carry the declared port and facilitator; Redis packages retain their own source bindings.

## Terminal operations

All mutating operation files contain a stable `requestId`. Use an ID consisting of 1–80 letters, numbers, underscores or hyphens. Repeating the same operation with that ID returns the retained outcome. A different body cannot reuse it.

`inspect` returns the current complete revision, connection references and the first pages of version and operation summaries. `revisions` and `operations` accept `--after` and `--limit` (1–100). `revision --id` and `operation --id` retrieve the full selected record.

Save input:

```json
{
  "requestId": "inventory-price-v2",
  "expectedHead": "<current full revision ID>",
  "queries": { "inventory": { "kind": "get", "key": "merchant:inventory", "parameters": {}, "columns": ["value"], "maxRows": 1, "maxBytes": 16384, "timeoutMs": 1500 } },
  "plan": { "schema": "stellar-forge.redis-merchant-plan.v1", "publicOrigin": "https://data.example.com", "payment": "<original payment object>", "routes": "<original route array>" },
  "note": "Updated inventory offer"
}
```

The plan field above is a structural illustration; supply the complete ordinary merchant plan object, including valid native payment and route definitions. Existing `example-merchant-plan.json` and source templates contain the exact complete format.

Preview input:

```json
{ "requestId": "inventory-preview-1", "revisionId": "<full saved revision ID>", "query": "inventory", "input": {} }
```

Prepare input:

```json
{ "requestId": "inventory-package-v2", "revisionId": "<full saved revision ID>" }
```

Stage input:

```json
{ "requestId": "inventory-stage-v2", "packageId": "inventory-package-v2", "releaseId": "inventory-v2", "label": "Inventory version 2", "runtime": { "port": 8423 } }
```

Run a selected operation with `starforge-merchant redis workspace <command> --directory WORKSPACE --input INPUT.json`. Restore accepts `requestId`, `expectedHead`, `revisionId` and an optional note; it saves the selected configuration as a new revision.

Download one original public customer file with:

```sh
starforge-merchant redis workspace export --directory /private/redis-workspace \
  --package inventory-package-v2 --name openapi.json --output /private/customer-openapi.json
```

## Continue after interruption

One original private-directory writer owns the workspace. SQLite commits save revisions, head changes and operation outcomes. The source and plan materializations are regenerated atomically from saved revisions; a partial write does not prevent the same operation from continuing.

After an interrupted process, reopen the same directory and inspect the saved operation. `resume --id REQUEST_ID` continues its exact input. A completed revision, prepared package or staged release is read and reconciled before the operation completes. Partial original packages are retained under the workspace's `interrupted` directory before a new original preparation attempt. Each resumed attempt remains on the same operation record.

The browser offers the same request retrieval and continuation. A lost response keeps the original pending request in browser storage. Refresh retrieves its original result; Continue sends that exact request or resumes its interrupted server record.

## Native operation

The existing `redis/native-journey.mjs` owns the real Redis/Valkey server, source fixtures, original merchant, generated client, buyer files and retained upgrade/rollback. Set `SF30_REDIS_JOURNEY_WORKSPACE=1` to include the authoring workspace's create/edit/save/preview/package/stage/reopen sequence on that same database.

Set `SF30_REDIS_WORKSPACE_BROWSER=1` for its actual Chromium editor flow using an already installed Playwright module. `SF30_PLAYWRIGHT_MODULE` can select the existing module path; `SF30_CHROMIUM_EXECUTABLE` can select an existing Chromium executable. `SF30_REDIS_WORKSPACE_SCREENSHOT` optionally retains the actual browser screen. The workspace continuation is additive to the original merchant and payment journey.
