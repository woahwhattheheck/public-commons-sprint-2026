# Water-quality projects through merchant MCP

The WQX provider connects the merchant operator to the original managed water-quality projects. A remote agent can inspect a complete capture, review native receiving choices, exchange the full editable tables, save an immutable decision review, receive the resulting project elsewhere, and retrieve every native file through the same merchant MCP endpoint. The `merchant-wqx` command and typed JavaScript client use these same tools.

The product has three cooperating owners. The managed WQX host owns its project, source capture, scientific reviews, receiving plans and merchant lifecycle. The merchant MCP provider owns the connection to that host and its complete retained input/output files. The client owns its local transfer checkpoint and completed download. Each can restart and reopen its original work.

## Open the original managed project

Use the installed `@tokenjunkielabs/starforge-merchant` distribution, or run the corresponding source entrypoints from this repository. Create the project in a private directory owned by the account running the host.

```bash
water-quality-managed inspect \
  --project /srv/water/potomac \
  --bundle /srv/water/inputs/potomac-complete-open-waters.json

water-quality-managed serve \
  --project /srv/water/potomac \
  --bundle /srv/water/inputs/potomac-complete-open-waters.json
```

The original `WQX_MANAGED_READY` launch contains the project directory, stable `projectBindingId`, managed source SHA-256 and loopback URL. Copy the directory and binding identifier into the private connection file. Pin `expectedSourceSha256` when selecting an exact installed source release. The provider rereads the original binding and launch on every operation, so a fresh launch of the same project is followed automatically.

A connection may name up to 32 managed projects. It may also name up to 64 original input files and 32 retained capture directories. Named input files bind the exact complete SHA-256; retained captures bind the original capture SHA-256. The supplied [connection example](wqx-workspace-connection.example.json) shows each optional source.

```json
{
  "schema": "stellar-forge.wqx-workspace-connection.v1",
  "workspaces": {
    "potomac": {
      "label": "Potomac receiving",
      "directory": "/srv/water/potomac",
      "projectBindingId": "11111111-1111-4111-8111-111111111111"
    }
  }
}
```

Replace the illustrated UUID with the original managed launch's identifier. Save the connection file with mode 0600 and its private parent with mode 0700. The managed launch supplies its own local authorization token; callers select the configured workspace alias.

## Initialize and serve the merchant operator

Save the following setup selection as `/srv/water/operator-setup.json`:

```json
{
  "directory": "/srv/water/operator",
  "connection": "/srv/water/wqx-connection.json",
  "name": "Water-quality receiving"
}
```

Run the common provider initializer and start the existing merchant host:

```bash
merchant-providers init wqx-water-quality --options /srv/water/operator-setup.json
merchant-mcp serve --config /srv/water/operator/merchant-mcp.json --port 3211
```

The original merchant MCP server reads its bearer token from `MCP_ACCESS_TOKEN`, or from the selected token environment-variable name supported by its host. Existing host OAuth configuration is also supported by the merchant server. The local launch token stays within the private managed project. The WQX provider returns the source binding and launch identity needed to reopen the selected project.

The same setup is available through the common JavaScript API:

```js
import { initializeMerchantProvider } from './providers.mjs';

const setup = await initializeMerchantProvider('wqx-water-quality', {
  directory: '/srv/water/operator',
  connection: '/srv/water/wqx-connection.json',
  name: 'Water-quality receiving',
});
```

Repeating this exact setup reopens the existing release store, configuration and export directory. The setup intent binds the selected connection, name and release store. An existing merchant installation can add the `wqxWorkspaceConnection` field to its own configuration and retain its current release store and export directory.

## Complete workflow

Open the installed client with the original merchant endpoint and configured workspace alias:

```js
import {
  openWqxWorkspaceClient, uploadWqxInput, downloadWqxFile, reopenWqxDownload,
} from '@tokenjunkielabs/starforge-merchant/merchant/mcp/wqx-client';

const client = await openWqxWorkspaceClient({
  url: 'http://127.0.0.1:3211',
  workspace: 'potomac',
  tokenEnv: 'MCP_ACCESS_TOKEN',
});

const status = await client.status();
const plans = await client.inventory({ kind: 'plans', limit: 50 });
const original = await client.record({
  family: 'plan', id: 'potomac-quarter-open-waters-01',
});
```

The full original record is retained in `original.file`. Large children in the inline response include their JSON pointer and size. Read a selected original child with `record({ pointer: '/results', ... })`, or download the complete JSON file. Following pages bind `expectedDocumentSha256` to the original whole document.

For a receiving choice, enumerate the native targets from the saved plan:

```js
const page = await client.targets({
  planId: 'potomac-quarter-open-waters-01',
  kind: 'result',
  field: 'RESULT_STATUS',
  attentionOnly: false,
  offset: 0,
  limit: 1000,
});
```

The native target identity binds the source plan and the exact original field. Continue through `nextOffset` with `expectedPlanSha256: page.source.sourcePlanSha256`. Preserve the chosen action and reason for every target. `keep` retains the current choice, `set` chooses the supplied value, and `clear` removes that explicit choice. The existing decision model validates field types, original identities and choice semantics.

A complete decision document can be uploaded once and reused across table export, preview and save:

```js
const input = await uploadWqxInput(client, {
  path: '/srv/water/inputs/decisions.json',
  inputId: 'potomac-decisions-r1',
  contentType: 'application/json',
  expectedSha256: process.env.WQX_DECISIONS_SHA256,
});
const csv = await client.tableExport({ documentRef: input.inputRef, format: 'csv' });
const local = await downloadWqxFile(client, {
  file: csv, directory: '/srv/water/downloads/complete-editable-csv',
});
```

Both CSV and TSV contain the entire native target cohort, including rows outside the current attention filter. Their structured columns retain source identity, existing choices, field type and explanation. Upload the edited complete table, then call `tableImport({ inputRef, format })`. The resulting native response keeps the complete parsed decision document in its retained file.

Preview and save use the original native scientific workflow:

```js
const preview = await client.decisionsPreview({
  documentRef: input.inputRef,
  newPlanId: 'potomac-receiving-r1',
});
const saved = await client.decisionsSave({
  documentRef: input.inputRef,
  newPlanId: 'potomac-receiving-r1',
  reviewId: 'potomac-decisions-r1',
  expectedPreviewSha256: preview.result.previewSha256,
});
```

The preview includes the before/after native summaries, exact decision document hash, new plan hash, changes and issues. Its complete original JSON file also contains the native plan and receiving options. Saving binds that preview, the decision document and the selected immutable names. Repeating the same request resumes or reopens that original decision review.

Download any saved output through its original format:

```js
const bundle = await client.file({
  family: 'decision', id: 'potomac-decisions-r1', format: 'bundle',
});
await downloadWqxFile(client, {
  file: bundle, directory: '/srv/water/downloads/complete-receiving-project',
});

const receivingClient = await openWqxWorkspaceClient({
  url: 'http://127.0.0.1:3211',
  workspace: 'receiving',
  tokenEnv: 'MCP_ACCESS_TOKEN',
});
const received = await receivingClient.receive({
  kind: 'decision', inputRef: 'file:' + bundle.fileId,
});
```

When the receiving project uses a different merchant operator, upload the downloaded complete bundle to that operator and use the returned `inputRef`. A saved decision review exports eleven complete formats: decision JSON, editable CSV, editable TSV, receiving report, native locations, native results, native crosswalk, native report, native references, native bundle and the complete decision bundle.

## Tool families

All names below begin with `merchant_wqx_`. The [typed client and command guide](WQX_WORKSPACE_CLIENT.md) documents every corresponding method and CLI argument.

| Tools | Original operation |
| --- | --- |
| `status`, `inventory`, `record`, `result`, `targets` | Inspect configured managed projects, complete inventories, native records, individual original results and exact receiving targets. |
| `file`, `files`, `file_read`, `file_release` | Retain, list and transfer complete original native output files. |
| `input_begin`, `input_append`, `input_finish`, `input_status`, `input_files` | Upload exact original bytes with a persistent named input and authoritative retained offset. |
| `table_export`, `table_import`, `decisions_preview`, `decisions_save`, `receive` | Exchange full tables, review native changes, save an immutable receiving plan and receive the complete project. |
| `project_save`, `capture_start`, `capture_import`, `capture_cancel`, `analyze`, `review_save`, `plan_preview`, `plan_save` | Use the existing project revision, source capture, scientific analysis and native plan APIs. |
| `edition_prepare`, `merchant_stage`, `merchant_start`, `merchant_stop` | Prepare and operate the original water-quality data edition and merchant. |
| `customer_prepare`, `customer_execute`, `customer_reopen` | Use the existing customer purchase intent and complete received output. |

For the original project, analysis, plan, edition and customer operations, supply `request` or `inputRef`. The provider forwards the existing native request after validating its allowed fields. Each operation retains the complete original HTTP response as a file, including native errors and request identities. Project revisions, capture operation IDs, purchase intent IDs and preview hashes retain their existing meaning.

## Complete files and continuation

A retained file descriptor includes `fileId`, `name`, `contentType`, `bytes`, `sha256`, `workspace` and its source binding. The provider supports complete files up to 128 MiB. Input appends and output reads carry at most 65,536 original bytes. The merchant MCP request stays small while complete native bundles and tables pass through its existing file store.

An input has one original ID, filename, byte count and whole SHA-256. Repeating `input_begin` with that same selection reports the retained offset. An exact replay of an already retained prefix is accepted. `input_finish` verifies the whole file before publishing its stable `inputRef`. The client holds and rechecks the original source descriptor throughout upload.

A download directory holds its original endpoint/workspace identity, descriptor, prefix hash and offset. `downloadWqxFile` resumes that exact transfer after a client or merchant-host restart. Keep the same endpoint, workspace alias, directory and selected file. The complete downloaded file can be reopened offline:

```js
const original = await reopenWqxDownload({
  directory: '/srv/water/downloads/complete-receiving-project',
  expectedSha256: bundle.sha256,
});
```

The original native lease serializes a retained file operation. The CLI reserves its selected output before dispatch, so simultaneous callers targeting one output produce a single original dispatch and one complete private result. Different inputs and workspaces retain independent work.

Inventory pages have a whole-list snapshot; record pages have a whole-file hash; target pages have the source plan hash. A changed selection is surfaced with its existing identity so the caller can inspect the current source and continue the correct operation. Changing operations retain their original request IDs when the transport return is interrupted.

## Run the whole receiving operation

The [receiving driver](wqx-workspace-receiving.mjs) composes the original managed WQX API, common provider initializer, actual merchant HTTP server and typed client. Its [configuration example](wqx-workspace-receiving.example.json) selects the original complete Potomac source bundle and the merged scientific decision document.

```bash
node --expose-gc \
  stellar-forge/mcp-merchant-operator/wqx-workspace-receiving.mjs \
  /srv/water/receiving-inputs/mcp-receiving.json
```

Select canonical local paths and retain the original input hashes. The operation creates one private root and two original project directories beneath it. Its recorded intent, listener port, project bindings, named inputs and downloaded prefixes allow the same command to continue after interruption.

The operation reads all 1,035 native result targets across the 1,000-row page boundary, resumes the complete original source upload, exports and imports both full tables, previews and saves the exact scientific decision document, and reads all eleven outputs. It interrupts a complete bundle download after a retained prefix, restarts the original MCP host on its recorded port, then resumes the file. It restarts each managed project and receives the entire decision bundle into the independent project. Every independent export is compared with the original complete byte count and SHA-256.

Its scientific comparison retains all original result identities and source pointers, locations, activities and the 1,112 limit records. The selected Potomac choices represent the 452 censored observations using each row's original Censoring Level and unit while preserving blank measured values. The selected corrected plan contains 1,035 ready results. The complete operation writes `receiving-result.json` with the actual native file inventory, outcomes, host restarts, timing and request count.

## Distribution ownership

`distribution/contributions/wqx-water-quality.json` registers the `wqx-water-quality` merchant provider and its existing application provider. The declaration in `providers/wqx-water-quality.mjs` supplies the tools, configuration reader, lazy runtime, private export requirement and common setup hook. The shared provider registry composes it with the other merchant capabilities.

The same contribution installs `merchant-wqx`, the typed client, setup API, guides, receiving driver and examples alongside the scientific water-quality commands. Source imports continue to use the existing managed host, native scientific workflow, original file reader and shared lease implementation.

## Native transfer verification

The complete typed-client transfer check ran on Node 24.19.0 against the original WQX retained-file kernel, original file reader, HTTP transport and Linux lease. It transferred 196,745 exact bytes, resumed upload at 131,072 bytes after a committed append with an interrupted return, and resumed download at 65,536 bytes. Reopening the completed upload produced zero additional appends; reopening the completed download offline produced zero MCP requests. Two concurrent CLI calls to one selected output produced one original dispatch and one complete result. The whole scientific receiving driver records its own complete original dataset outcome in its operation directory.
