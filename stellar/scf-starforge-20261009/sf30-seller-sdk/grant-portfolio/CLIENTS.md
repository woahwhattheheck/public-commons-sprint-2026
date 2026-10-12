# Grant portfolio clients, Applications and merchant receiving

This companion connects the original saved grant-portfolio workspace to the installed
Starforge command, Applications and merchant MCP server. The Python model remains the
owner of source acquisition, review decisions, portfolio revisions and retained actions.
All interfaces use the same source IDs, original entity/financial references, revision
numbers and complete native export.

Use [OPERATIONS.md](OPERATIONS.md) for the operator journey,
[DOMAIN.md](DOMAIN.md) for financial and relationship semantics, and
[RECEIVING.md](RECEIVING.md) for the complete native packet and workspace history.

## Installed commands and interfaces

The original source-owned contribution is
[distribution/contributions/grant-portfolio.json](../../distribution/contributions/grant-portfolio.json).
It provides these commands:

| Command | Original operation |
| --- | --- |
| `starforge grant-portfolio` | Forwards arguments and terminal signals to this product's original Python CLI. |
| `starforge grant-portfolio-receive` | Inspects, downloads or receives a retained complete merchant export. |

The optional leading `--python /absolute/path/to/python` selects the existing
Python executable. Otherwise the forwarding command uses
`SF30_GRANT_PORTFOLIO_PYTHON` or `python3`.
It supplies its actual Node executable to the original XML/NDJSON native bridge.
Use the original CLI's help and operations guide for initialization, actions and serving.

The selected Python must be 3.11 or later and have the original 360Giving publisher
dependencies from [requirements.txt](../ndjson/360giving/requirements.txt).
The contribution adds no second dependency lock or publisher implementation.

Package exports include:

| Export | Interface |
| --- | --- |
| `./seller/grant-portfolio/client` | `GrantPortfolioClient`, connection helpers, complete-file receiving and TypeScript declarations. |
| `./seller/grant-portfolio/merchant` | Original merchant provider implementation and initializer. |
| `./seller/grant-portfolio/receiving` | Inspect, resumable download and original target-workspace receiving. |
| `./seller/grant-portfolio/application` | Original Applications preparation and authenticated startup observer. |

Direct source users import these same local modules.

## Connect to a saved workspace

Run the original console with a private connection file:

```sh
starforge grant-portfolio --python /absolute/python \
  --workspace /absolute/private/portfolio \
  serve --port 0 --connection-file /absolute/private/portfolio-console.json
```

The original server owns that file and removes it when it closes. The connection is
the complete printed `http://127.0.0.1:PORT/#TOKEN` URL. Clients send the
token as a bearer credential and the exact local origin on each request. Select the
new connection file after reopening the same saved workspace.

```js
import {connectGrantPortfolio} from './client.mjs';

const client = await connectGrantPortfolio({
  consoleUrlFile: '/absolute/private/portfolio-console.json',
});
try {
  const schema = await client.schema();
  const state = await client.state();
  console.log(state.workspaceId, state.revision);
} finally {
  await client.dispose();
}
```

Disposing the client closes that caller's outstanding HTTP work. The Applications or
terminal owner keeps the console and original workspace lease.

## Retain an action before sending it

Each action has a caller-selected `operationId` and complete saved input.
Store them before the first request. Repeating that exact ID and input reopens the
original request. Reusing its ID for different input produces a conflict.

A request reports `RUNNING`, `COMPLETED` or `FAILED`.
`wait()` reads the same request until a terminal state. It does not create
another action. After a lost reply, read `request(operationId)` first.
Use `resume(operationId)` explicitly when continuing the original saved
operation. A transport failure includes the original ID in the client error.

The two revision checks serve different saved records:

| Field | Record selected |
| --- | --- |
| Top-level `expectedRevision` | The inspected workspace revision, including source and action publication. |
| Payload `expectedPortfolioRevision` | The portfolio revision being edited or reviewed. |

Keep the original expected values when retrying an admitted action. A new edit starts
with a new operation ID and the newly inspected revision.

### Receive a native source edition

Upload the unchanged source packet and use its returned object SHA in
`source.receive`. The source input retains its publisher coverage statement,
URL, observation time, license and original native selection.

```js
// savedInput was persisted by the caller before this operation.
// coverage and selection come from the actual received native edition.
const object = await client.uploadFile(savedInput.packetPath, {
  sha256: savedInput.packetSha256,
});
const request = await client.receiveSource(savedInput.operationId, {
  object: object.sha256,
  standard: savedInput.standard,
  label: savedInput.label,
  coverage: savedInput.coverage,
  ...(savedInput.selection ? {selection:savedInput.selection} : {}),
}, {expectedRevision:savedInput.expectedRevision});
const finished = request.state === 'RUNNING'
  ? await client.wait(savedInput.operationId)
  : request;
if (finished.state !== 'COMPLETED') throw new Error(JSON.stringify(finished.error));
const originalSource = finished.result;
```

The server receives the packet through the original IATI or 360Giving engine. The
source ID identifies that exact edition and its declared coverage.

### Save and review a portfolio

`savePortfolio()` takes the native payload unchanged:

```js
const request = await client.savePortfolio(savedEdit.operationId, {
  ...(savedEdit.id ? {
    id:savedEdit.id,
    expectedPortfolioRevision:savedEdit.expectedPortfolioRevision,
  } : {}),
  name:savedEdit.name,
  notes:savedEdit.notes,
  sources:savedEdit.sourceIds,
  sourceReplacements:savedEdit.sourceReplacements ?? [],
  review:savedEdit.review,
}, {expectedRevision:savedEdit.expectedRevision});
```

A review reference is the exact triple
`{sourceId, entityKey, sha256}`. Its semantic SHA binds the original entity
and financial records used for the decision. Read the current row/detail before
selecting that reference.

```js
await client.saveReview(savedReview.operationId, {
  portfolioId:savedReview.portfolioId,
  expectedPortfolioRevision:savedReview.revision,
  reviewer:savedReview.reviewer,
  decisions:savedReview.decisions,
}, {expectedRevision:savedReview.workspaceRevision});
```

The declared decision union has two forms:

| Type | Required decision fields |
| --- | --- |
| `link` | `left`, `right`, relation `same-organization` / `grant-activity` / `duplicate`, disposition `confirmed` / `rejected` / `ambiguous`, rationale. |
| `record` | `record`, disposition `unmatched` / `coverage-only` / `duplicate`, rationale, optional `related` reference. |

A following edition can make an earlier decision stale. Reuse that decision's ID
when explicitly reviewing it again; previous portfolio revisions keep the earlier
decision. The model supplies the saved reviewer, time and current/stale state.

Financial records retain the original amount, currency, financial type, date, source
and semantic identity. Client and merchant tools preserve those values. Relationship
decisions do not convert currencies or add linked amounts together.

## Read complete pinned tables

Choose both the portfolio ID and exact revision. The seven original tables are
`entities`, `financial`, `links`, `decisions`,
`candidates`, `changes` and `sources`.

```js
for await (const page of client.pages({
  portfolioId:selected.id,
  revision:selected.revision,
  table:'financial',
  limit:250,
})) {
  await consumeOriginalRows(page.rows);
}
```

The iterator checks the immutable revision, total, snapshot and contiguous offsets on
every page. Filters select the original `search`, `status`,
`standard` or `entityKey` values. Read full original entity and
financial detail with `detail({portfolioId,revision,sourceId,entityKey})`.

## Applications: review, save, start and reopen

Select **Grant portfolio reconciliation** in the existing Applications catalog.
Choose its saved workspace directory and installed Python executable. An optional
connection-file field selects a new private file for the client and MCP connection.

Application review binds the saved workspace UUID, original directory/marker/database/
lock identities, selected Python and all files in
[source-files.json](source-files.json). The original CLI checks that binding before
and after taking its existing workspace lease. Mutable database content continues
through the model's revision checks.

The startup observer reads the original announcement and authenticates
`GET /api/launch` on its exact local console. It compares the workspace,
source, Python, process and binding with the reviewed launch. Existing Applications
Review/Save, Start/Open/Stop, process observers and resource ownership remain in use.

For a following source release, select the new installed release and review/save its
Applications launch again. The complete source list includes the Python files and
publisher assets used through dynamic native imports and packet export.

## Merchant MCP setup

Host setup declares a saved workspace UUID and a private connection reference for each
workspace alias. File handles select complete native input packets on that host:

```json
{
  "schema": "stellar-forge.grant-portfolio-connection.v1",
  "workspaces": {
    "portfolio": {
      "label": "Grant portfolio",
      "workspaceId": "REPLACE_WITH_SAVED_WORKSPACE_UUID",
      "consoleUrlFile": "/absolute/private/portfolio-console.json",
      "files": {
        "iati-edition": {
          "path": "/absolute/private/iati-source-packet.zip",
          "sha256": "REPLACE_WITH_ORIGINAL_PACKET_SHA256",
          "label": "Original IATI edition"
        }
      }
    }
  }
}
```

Keep the configuration private. A `consoleUrlEnv` name can select the original
URL from the merchant's environment instead of a connection file. Agent arguments
select declared aliases and packet handles. Each operation verifies that the current
console still names the configured original workspace UUID.

For an existing merchant configuration, add
`"grantPortfolioConnection": "/absolute/private/portfolio-connection.json"`.
The source-owned merchant provider is discovered from the same distribution
contribution. For a new merchant, use its original initializer:

```json
{
  "directory": "/absolute/private/grant-portfolio-merchant",
  "connection": "/absolute/private/portfolio-connection.json",
  "name": "Grant portfolio",
  "releaseStore": "/absolute/private/original-seller-releases"
}
```

```sh
starforge merchant-providers init grant-portfolios \
  --options /absolute/private/merchant-setup.json
```

Omit `releaseStore` when the new merchant should initialize its normal
original release store. Run the resulting merchant configuration through the installed
merchant MCP command and its existing transport options.

### Complete agent workflow

| Tool suffix after `merchant_grant_portfolio_` | Operation |
| --- | --- |
| `workspaces`, `schema` | Select configured original workspace and inspect its native contract. |
| `state` | Page source, portfolio and retained-request summaries. Continue the returned snapshot. |
| `upload` | Upload one configured packet handle or a retained export. |
| `action` | Receive source, save portfolio, save review or receive portfolio with the complete original payload. |
| `request`, `resume` | Read or explicitly continue that same operation. |
| `source`, `open`, `rows`, `detail` | Read original editions and complete revision-bound records. |
| `export`, `exports` | Create the native complete ZIP and retain its immutable merchant manifest. |
| `manifest`, `file`, `file_release` | Inspect and receive the original whole file through the maintained retained-read transport. |

The export tool uses its saved `operationId`, portfolio ID and revision.
If it returns a running native request, read that same request and repeat the exact
export call when complete. The merchant then retains its original native descriptor,
manifest SHA and complete `portfolio.zip`. Those files remain available
after the borrowed console closes.

## Portable complete receiving

Inspect and download the selected immutable merchant export:

```sh
starforge grant-portfolio-receive inspect \
  --url http://127.0.0.1:8765/mcp --export ORIGINAL_EXPORT_ID \
  --token-env ORIGINAL_MCP_TOKEN --manifest-sha ORIGINAL_MANIFEST_SHA256

starforge grant-portfolio-receive download \
  --url http://127.0.0.1:8765/mcp --export ORIGINAL_EXPORT_ID \
  --token-env ORIGINAL_MCP_TOKEN --out /absolute/private/portfolio-delivery \
  --manifest-sha ORIGINAL_MANIFEST_SHA256
```

The receiving directory keeps the original manifest, native ZIP and maintained
download-state record. Repeat the same endpoint, export and directory to finish its
verified byte prefix. A different manifest or source closure conflicts with that
directory's saved receiving identity.

To receive the unchanged ZIP into a running original target workspace, first retain
the target operation ID and inspected workspace revision:

```sh
starforge grant-portfolio-receive receive \
  --url http://127.0.0.1:8765/mcp --export ORIGINAL_EXPORT_ID \
  --token-env ORIGINAL_MCP_TOKEN --out /absolute/private/portfolio-delivery \
  --manifest-sha ORIGINAL_MANIFEST_SHA256 \
  --console-url-file /absolute/private/target-console.json \
  --operation-id ORIGINAL_RECEIVING_OPERATION \
  --expected-revision ORIGINAL_TARGET_WORKSPACE_REVISION
```

This continues the same download, uploads the original ZIP by SHA and invokes
`portfolio.receive` through the target's retained action ledger.
Its output includes the receiving request and downloaded original descriptors.
Repeat the saved receiving ID and expected revision after a lost reply. Review
the original request's error before explicitly resuming a failed native operation.

Programmatic receiving uses
`receiveGrantPortfolioExport({target, operationId, expectedRevision, ...downloadOptions})`.
The caller keeps ownership of the target client. The complete native packet preserves
source editions, all included portfolio revisions, original review inputs, complete
financial rows and the source runtime needed for the original receiver.
