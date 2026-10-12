# SEC EDGAR merchant MCP and complete receiving

Operate the original SEC EDGAR merchant from the merchant MCP: retain official source bytes, select reported concepts or filing forms, save source-bound products, preview actual records, start the original Stellar seller, export its generated buyer client and all selected sources, and reopen the same merchant after transfer.

The companion uses the original SEC compiler, immutable edition store, workspace revision writer, browser, seller and client generator. File receiving uses the existing authenticated merchant client, byte checkpoints and process lease.

## Installed entry points

Use the existing Node 24 Starforge installation with its native, schema, MCP and operator dependencies.

| Installed entry | Purpose |
| --- | --- |
| `starforge merchant-mcp init-edgar-workspaces` | Connect declared SEC workspaces to the original merchant MCP. |
| `starforge merchant-mcp serve` | Open the existing authenticated merchant MCP listener. |
| `starforge merchant-mcp-stdio` | Open the existing local subprocess MCP listener. |
| `starforge sec-edgar` | Original SEC import, acquisition, query, browser, export and seller CLI. |
| `starforge sec-edgar-download` | Inspect, resume complete receiving, or reopen the received native merchant. |
| `@tokenjunkielabs/starforge-merchant/merchant/mcp/sec-edgar` | Connection reader, tool definitions and `MerchantEdgarWorkspaces`. |
| `@tokenjunkielabs/starforge-merchant/merchant/mcp/sec-edgar-download` | `inspectEdgarExport`, `downloadEdgarExport` and `reopenEdgarExport`. |
| `@tokenjunkielabs/starforge-merchant/merchant/mcp/sec-edgar-transfer` | Strict native file selection and transfer-manifest parser. |
| `@tokenjunkielabs/starforge-merchant/seller/sec-edgar/{cli,config,source,merchant,workspace,server}` | Original merchant source and operating modules. |

The original command and six seller exports are maintained by the SEC source owner. See the [installed source guide](../../stellar/scf-starforge-20261009/distribution/SEC_EDGAR.md), [native merchant guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/README.md), and [native workspace guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/WORKSPACE.md).

From a source checkout, the MCP entry is `stellar-forge/mcp-merchant-operator/serve.mjs`; receiving uses `stellar-forge/mcp-merchant-operator/sec-edgar-download.mjs`. They use the same installed dependencies.

## Connect an existing complete merchant

Start with a complete original export containing `merchant.json`, `manifest.json`, `client/` and `source-store/`. The native `sec-edgar export` command produces this directory. The source owner's retained Apple/Genpact export follows the same format.

The host connection names permitted workspaces, source files, acquisition profiles, merchant configurations and receiving packages. Tool arguments select these aliases. Relative host paths resolve from the connection file.

The following host-side example reads actual original metadata to construct the connection. Set `EDGAR_HOME` to an existing private directory containing the complete export as `original/`. Preserve its original file bytes.

~~~js
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const home = resolve(process.env.EDGAR_HOME);
const original = join(home, 'original');
const manifestBytes = await readFile(join(original, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const merchant = JSON.parse(await readFile(join(original, 'merchant.json')));
const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');

const captures = {};
for (let index = 0; index < manifest.editions.length; index++) {
  const edition = manifest.editions[index];
  captures['capture-' + (index + 1)] = {
    label: edition.id,
    file: join(original, 'source-store', 'blobs', edition.sourceSha256 + '.json'),
    sha256: edition.sourceSha256,
    id: edition.id,
    kind: edition.kind,
    cik: edition.cik,
    sourceUrl: edition.sourceUrl,
    capturedAt: edition.capturedAt
  };
}
const connection = {
  schema: 'stellar-forge.sec-edgar-workspace-connection.v1',
  workspaces: {
    issuer: {
      label: merchant.title,
      directory: './issuer-workspace',
      storeDirectory: './issuer-captures',
      browserPort: 0,
      captures,
      merchantProfiles: { original: { label: merchant.title, config: merchant } },
      packages: {
        original: { directory: original, manifestSha256, label: 'Original merchant export' }
      },
      runtime: { port: 0, operationsPort: 0 }
    }
  }
};
await writeFile(join(home, 'edgar-connection.json'),
  JSON.stringify(connection, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
~~~

Original payment options travel in `merchant.json`. Review and save the intended network, asset, recipient, amount and timeout through the native product configuration before operating the deployed merchant. The original example package retains its labeled example payment terms.

Initialize a new MCP configuration, then open the original listener:

~~~sh
starforge merchant-mcp init-edgar-workspaces \
  --dir /private/edgar/mcp \
  --connection /private/edgar/edgar-connection.json \
  --name "SEC company data"

starforge merchant-mcp serve \
  --config /private/edgar/mcp/merchant-mcp.json \
  --port 3211
~~~

The HTTP listener uses the original `MCP_ACCESS_TOKEN` environment variable or existing OAuth resource configuration. The host connection remains private. [The original server guide](README.md) describes authentication; [client-config.mjs](client-config.mjs) generates the existing local subprocess registration.

An existing merchant MCP configuration can add `edgarWorkspaceConnection` pointing to that private connection. Restart the original MCP process after changing its host connection.

## Complete operator workflow

These examples use the existing authenticated merchant MCP client. An MCP host may call the same tool names directly.

~~~js
import { openMerchantFileClient } from './retained-download.mjs';
const client = await openMerchantFileClient({
  url: 'http://127.0.0.1:3211/mcp',
  tokenEnv: 'MCP_ACCESS_TOKEN',
  clientName: 'sec-company-data-operator',
  errorPrefix: 'EDGAR'
});
const call = (operation, input = {}) =>
  client.call('merchant_edgar_' + operation, { workspace: 'issuer', ...input });
~~~

### Open and receive the original source

`merchant_edgar_status` without a workspace lists aliases, captures, acquisition profiles, merchant profiles and complete packages. `open` creates or reopens the original workspace and its native loopback browser.

~~~js
const opened = await call('open');
const workspaceInstanceId = opened.instanceId;
const initialRevision = opened.state.revision;
~~~

Open `browserUrl` locally. Its existing session fragment becomes the native HttpOnly same-origin cookie. The browser and MCP share the original source store and saved revision history.

Inspect and receive the declared package using its native `manifest.json` SHA from the connection:

~~~js
const inspected = await call('receive', {
  package: 'original',
  expectedManifestSha256: originalManifestSha256,
  action: 'inspect'
});
const received = await call('receive', {
  package: 'original',
  expectedManifestSha256: originalManifestSha256,
  action: 'receive',
  expectedRevision: initialRevision
});
~~~

Inspection validates the original configuration, generated files and every selected edition through the source engine. Receiving imports the original bytes with their edition ID, URL and capture timestamp, then saves the complete native merchant.

Repeat that receiving call after a lost response. Compatible source imports recover their original records. If the final save already completed at the next revision with the same configuration, the companion returns that saved revision. A later different draft retains the native revision conflict.

Importing one declared capture uses its host alias and selected source SHA:

~~~js
await call('import', {
  capture: 'capture-1',
  expectedSha256: selectedCaptureSha256
});
~~~

The file bytes are checked before the native immutable import. Reusing an edition ID with changed source bytes returns the original source conflict.

### Select concepts and filing forms

The edition identifies the actual CIK, URL, source SHA, capture time and scope. Available concepts, units and forms come from those original source bytes.

~~~js
const concepts = await call('edition', {
  editionId: 'apple-facts-20261011',
  collection: 'concepts',
  search: 'Assets',
  offset: 0,
  limit: 50
});
const forms = await call('edition', {
  editionId: 'genpact-filings-20261011',
  collection: 'forms',
  offset: 0,
  limit: 50
});
~~~

Follow `page.nextOffset` to its null terminator. `collection: "history"` pages the original submissions history descriptors. A selected older file becomes its own imported edition. `status` pages saved editions with the same inventory offsets.

### Save products and revisions

`save` accepts full native merchant JSON or a declared merchant profile. `product` edits one product within the full saved merchant and gets its kind, CIK and source SHA from the selected edition.

~~~js
const state = await call('status');
const config = structuredClone(state.state.config);
config.products[0].maxPageSize = 50;
const saved = await call('save', {
  expectedRevision: state.state.revision,
  config
});
~~~

For a source-bound product edit:

~~~js
const selected = saved.config.products[0];
const { id, editionId, kind, cik, sourceSha256, ...editable } = selected;
const updated = await call('product', {
  action: 'upsert',
  expectedRevision: saved.revision,
  productId: id,
  editionId,
  product: {
    ...editable,
    description: 'Selected reported assets and income with original filing versions.'
  }
});
~~~

The first product additionally requires `title` and `publicOrigin`. The original compiler validates IDs, routes, concepts/forms, page size, payment options and example query. Product removal uses `action: "remove"` and `productId`; the original merchant requires at least one configured product.

Writes use the native expected revision. A concurrent save returns `EDGAR_REVISION_CHANGED` and its current revision. Reopen the saved draft, retain intended edits, and apply them to that revision. Re-saving an identical configuration returns the native unchanged result.

`revisions` reads the native recent history with a limit from 1 to 200, plus `total` and `hasMore`. An exact older nonempty revision can be restored directly:

~~~js
const history = await call('revisions', { limit: 50 });
const restored = await call('restore', {
  revision: selectedOldRevision,
  expectedRevision: currentRevision
});
~~~

Restoring appends a native revision, preserves prior history and revalidates source editions.

### Preview exact rows

~~~js
const first = await call('preview', {
  expectedRevision: currentRevision,
  productId: 'appleFacts',
  query: { taxonomy: 'us-gaap', concept: 'Assets', unit: 'USD', limit: 25 }
});
const next = first.body.nextCursor === null ? null : await call('preview', {
  expectedRevision: currentRevision,
  productId: 'appleFacts',
  query: {
    taxonomy: 'us-gaap', concept: 'Assets', unit: 'USD',
    limit: 50, cursor: first.body.nextCursor
  }
});
~~~

The cursor binds the edition, source SHA, product selection and query. Page size can change; changing a source, concept, form, date or accession starts a new query.

Facts preserve numeric spelling as strings with `valueType: "number"`. Original units, accessions, filing dates, period ends and nullable fiscal fields stay in their own rows. The companion performs the original query without aggregating or rewriting records.

Facts support taxonomy, concept, unit, form, accession, filing dates, period-end dates, page limit and cursor. Filings support form, accession, filing dates, limit and cursor. The original compiler enforces the product's allowed concepts/forms and page maximum.

`preview` also accepts a complete `config` for an unsaved original draft. Export and merchant start use saved revisions.

### Operate the original merchant

The host selects seller/operations ports, facilitator, optional availability/history directories and drain settings. Tools select the saved revision and process-owned instance.

~~~js
const running = await call('merchant', {
  action: 'start', expectedRevision: currentRevision
});
const runningState = await call('merchant', { action: 'status' });
await call('merchant', { action: 'stop', instanceId: running.instanceId });
~~~

Returned state includes the original merchant URL, mode, operations URL, lifecycle and source identities. A configured original facilitator enables the native Stellar flow. The original seller reports `CHALLENGE_ONLY` when the host has no facilitator selected.

A running instance remains bound to its starting revision while later drafts can be edited. Stop that instance before starting a different revision. Shutdown uses the native seller drain and source close.

The merchant instance UUID differs from the workspace/browser instance UUID. `merchant stop` uses the former; `merchant_edgar_close` uses the latter.

### Export the complete merchant and buyer

`merchant_edgar_handoff` returns the saved handoff, merchant configuration or OpenAPI using `kind: "handoff"`, `"config"` or `"openapi"`.

Complete export includes the generated JavaScript client and TypeScript declarations, every selected raw source, exact edition metadata and original export manifest:

~~~js
const exported = await call('export', {
  exportId: 'issuer-release-1',
  expectedRevision: currentRevision
});
~~~

Retain `exportId` and `manifestSha256`. Repeating the same call recovers its original output. Reusing that ID for a different saved revision returns an export conflict.

`merchant_edgar_exports` pages completed exports and native outputs awaiting transfer-manifest completion. `merchant_edgar_export_manifest` returns the complete manifest file identity and pages its inventory.

`edgar-transfer.json` binds the original workspace/revision and every native file. It maps native paths to flat names for the existing resumable downloader. Receiving restores the original structure. Native manifest, sources, client and edition files retain their original bytes.

## Complete download and offline reopen

Use the complete transfer manifest SHA returned by export:

~~~sh
starforge sec-edgar-download inspect \
  --url http://127.0.0.1:3211/mcp \
  --workspace issuer --export issuer-release-1

starforge sec-edgar-download download \
  --url http://127.0.0.1:3211/mcp \
  --workspace issuer --export issuer-release-1 \
  --manifest-sha256 REVIEWED_TRANSFER_MANIFEST_SHA256 \
  --out /private/received-edgar

starforge sec-edgar-download reopen --out /private/received-edgar
~~~

The existing retained-download engine saves private byte checkpoints, verifies each retained prefix, checks original file hashes and owns its original Linux lease. Repeat the same command to resume. An expired read session opens a fresh verified snapshot at the saved offset.

| Output | Contents |
| --- | --- |
| `transport/` | Exact transferred files and original byte-resume checkpoints. |
| `merchant/` | Original config, review, OpenAPI and buyer handoff. |
| `merchant/client/` | Generated JavaScript, TypeScript, package metadata, OpenAPI and guide. |
| `merchant/source-store/` | Original source blobs and edition records. |
| `merchant/manifest.json` | Unchanged native SEC export manifest. |
| `merchant/edgar-transfer.json` | Complete transfer and native path binding. |

The receiver compiles the received merchant and queries its sources through the original engine. `reopen` does this offline and reports the original product, edition/source SHA, native matched count and first-page count.

The original CLI can immediately query or serve the received merchant:

~~~sh
starforge sec-edgar query \
  --store /private/received-edgar/merchant/source-store \
  --config /private/received-edgar/merchant/merchant.json \
  --product appleFacts \
  --query '{"taxonomy":"us-gaap","concept":"Assets","unit":"USD","limit":25}'

starforge sec-edgar serve \
  --store /private/received-edgar/merchant/source-store \
  --config /private/received-edgar/merchant/merchant.json \
  --port 8787 --operations-port 8788 \
  --facilitator https://YOUR_CONFIGURED_FACILITATOR
~~~

For continued browser editing, declare the received `merchant/` as a package in another original workspace connection. Bind its unchanged native `manifest.json` SHA, then `open` and `receive` with that workspace's revision.

The JavaScript receiver exposes the same workflow:

~~~js
import {
  inspectEdgarExport, downloadEdgarExport, reopenEdgarExport
} from './sec-edgar-download.mjs';

const inspected = await inspectEdgarExport({
  url, workspace: 'issuer', exportId: 'issuer-release-1'
});
const downloaded = await downloadEdgarExport({
  url, workspace: 'issuer', exportId: 'issuer-release-1',
  expectedManifestSha256: inspected.manifestSha256,
  directory: '/private/received-edgar'
});
const reopened = await reopenEdgarExport({ directory: downloaded.directory });
~~~

Functions accept the original authenticated `client`, `tokenEnv`, `environment`, `signal`, `chunkSize` and `onProgress` as applicable.

## Source acquisition

Add an explicit acquisition profile when a fresh official edition is needed:

~~~json
{
  "acquisitions": {
    "apple-facts": {
      "kind": "facts",
      "cik": "320193",
      "quotaDirectory": "/private/supplier-quotas/sec-edgar",
      "userAgentEnv": "SEC_EDGAR_USER_AGENT",
      "requestsPerSecond": 2,
      "callsPerDay": 1000,
      "timeoutMs": 30000
    }
  }
}
~~~

The original identifiable User-Agent is read through its host environment reference. The native transport selects the official company endpoint and uses the shared supplier quota directory.

~~~js
await call('acquire', {
  profile: 'apple-facts',
  editionId: 'apple-facts-next-edition',
  operationId: crypto.randomUUID()
});
~~~

A compatible existing edition returns its original capture. A historical submissions profile can select the exact `historyFile` shown in the current original submissions record.

Native acquisition supports 1–10 configured requests per second, its host daily allowance and a 1–120 second source timeout. The original shared supplier engine coordinates processes through the selected quota directory. The native guide links the official SEC policy.

`status` exposes active acquisition UUIDs; `merchant_edgar_cancel` accepts that UUID. Cancellation and workspace close remain callable during acquisition. Each original workspace owns its own mutation serialization.

## Complete file reads and closing

| Tool | Selection |
| --- | --- |
| `merchant_edgar_export_manifest` | Workspace, export ID and optional inventory page. |
| `merchant_edgar_export_file` | Workspace, export ID, flat file name and exact manifest SHA. |
| `merchant_edgar_export_file_release` | Workspace, export ID and returned read ID. |
| `merchant_edgar_source_file` | Workspace and original edition ID. |
| `merchant_edgar_result_file` | Workspace and complete result ID/SHA. |
| `merchant_edgar_file_release` | Workspace and returned read ID. |

Reads accept `expectedSha256`, `readId`, byte `offset` and `limit`. The existing reader supports chunks up to 196,608 bytes, four active snapshots and a 256 MB snapshot budget. Original imports support captures up to 32 MiB. Completion or release closes the descriptor.

Large operator results return `completeResult` with an immutable result ID, byte count and SHA. `merchant_edgar_result_file` returns the complete original preview, handoff or state. Saved results and completed exports remain readable after workspace close and after a fresh MCP process loads the same configuration.

A query cursor advances source rows; a file offset advances bytes; an inventory offset advances entries. Retain the identity returned for that continuation.

~~~js
await call('close', { instanceId: workspaceInstanceId });
~~~

Close cancels acquisition, waits for owned operations, drains the seller, closes browser/source state and releases retained reads. Reopening the alias retains the original editions and saved revisions.

## Source and operation lineage

The SEC engine is F971's original product in [PR1448](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1448), with the browser import correction from [PR1476](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1476). The [native README](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/README.md) records its complete source/operator/seller/client/export operation.

The source owner's completed Apple/Genpact export contains 15 files and 4,069,588 uncompressed bytes. Apple has 25,135 original facts, source SHA `73a86c6aedc31f77cac2ea4df5f80f0b3bd7e6eb58bb4e01444fbedf3afb9c43`. Genpact has 1,003 original filings, source SHA `fca3d62aff9f2dac8c6c4c201970b8d128269387b71461c77ecae84d845eb1e7`. Their exact timestamps, URLs and source identities remain in the native edition metadata and original package manifest.

## Completed original receiving operation

Operation `SCF-SEC-EDGAR-MCP-20261012-7E4E` completed on 12 October 2026 at
02:33:27 UTC using the original retained F971 merchant export and the public MCP
companion. The selected existing dependency carrier was composed with the current
original SEC modules, current merchant transport dependencies and the reviewed
companion source published in PR1558.

The input archive contained 321,062 bytes, SHA256
`f6540a3cfcb0c7a1d53df5b792938b504caf7b305f2ae8033a3e6e3e05886b61`.
Its original native manifest SHA256 was
`27ef7f9f05a99530cf72f64ce722dba8e90561444f1581350df8cbdc84374eee`.
The receiving operation preserved these actual original sources:

| Source edition | Original rows | Original capture time | SHA256 |
| --- | ---: | --- | --- |
| `apple-facts-20261011` | 25,135 facts | 2026-10-11T22:24:01.883557+00:00 | `73a86c6aedc31f77cac2ea4df5f80f0b3bd7e6eb58bb4e01444fbedf3afb9c43` |
| `genpact-filings-20261011` | 1,003 filings | 2026-10-11T23:27:06.972653+00:00 | `fca3d62aff9f2dac8c6c4c201970b8d128269387b71461c77ecae84d845eb1e7` |

The real caller opened the native workspace, inspected and received the original
package at revision 1, recovered the same receive after a repeated expected
revision, and replayed the pinned Apple capture. It selected actual Assets
concepts and Genpact filing forms, then saved `appleAssets` alongside the two
original products at revision 2. An Assets page of seven rows continued with the
same original cursor and a page size of eleven. The original buyer handoff,
OpenAPI, raw source read and retained-read release completed from that revision.

The original merchant started in the selected `CHALLENGE_ONLY` mode, returned its
original HTTP 402 for the selected Assets query, and drained through its native
close. The complete export was produced and recovered under the same export ID.
The workspace then closed while its retained export stayed downloadable.

The receiver deliberately paused after saving 32,768 bytes of the original
3,789,099-byte Apple capture. After the MCP listener closed and restarted on the
same selected endpoint, the existing download checkpoint resumed and completed
every original file. The original compiler and source store reopened the result
offline; the generated buyer module imported and exposed `buildRequest`,
`createSellerClient`, `operations` and `source`.

The completed native receiving identity is:

- Workspace: `edgar-0780bac3-c13b-4b38-ac71-b4dc6fd0e5f9`, revision `2`.
- Export: `sec-original-apple-genpact-20261012`.
- Complete files: `15`, totaling `4,132,717` bytes.
- Transfer manifest: `76c8b47709a1d13c3bfb8ed6d48283d98593faf92eccfe982042157ece1992ac`.
- Original native export manifest: `92c37cfb5cc599ae667f9794aafee93924dcac3462cedf69e0de2944dda46310`.
- Reopened products: `appleFacts`, `genpactFilings` and `appleAssets`.
  Their original example queries returned the first 25 rows from 146 matching
  Assets records, 1,003 filings and 146 matching Assets records respectively.

The retained native case, original operation journal and compact result are
delivered through the existing SEC and cumulative installation coordination
threads. The original provider source is PR1448, its browser correction is
PR1476, and the native command plus six native SDK exports are PR1512. A5F3 and
D1CC continue the same cumulative package production and installed receiving.
