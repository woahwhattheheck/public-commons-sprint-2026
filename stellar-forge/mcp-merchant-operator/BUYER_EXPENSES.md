# Original buyer expense operation from MCP and customer code

The merchant MCP host can operate the original SF36 expense workspace through its existing Python HTTP application. This is an accounting continuation of an already retained buyer ledger. It does not create a buyer, make a payment, read a signer, change a reservation, or introduce another ledger.

The same source captures, exact atomic allocation lines, outstanding reservations, named period reviews, immutable closes and reopen history are available to the browser and customer tools. All financial rules remain in `sf36-spend-governor/expense-workspace/{store,domain,native}.py`; the source reader remains the original `statement.py`.

## Declare the original host inputs

Create an owned mode-0600 JSON file. Paths in this file are operator configuration, not MCP arguments. The workspace can be an existing original expense workspace or a new private workspace. Each original ledger needs its own explicit alias and truthful provenance.

```json
{
  "schema": "stellar-forge.buyer-expense-connection.v1",
  "workspaces": {
    "finance": {
      "directory": "/srv/starforge/buyer-expenses",
      "python": "python3",
      "ledgers": {
        "buyer": {
          "path": "/srv/starforge/original-buyer/reservations.sqlite",
          "name": "Original buyer ledger",
          "provenance": "Operator-owned original SF36 buyer; retain its actual source and purchase references here."
        }
      }
    }
  }
}
```

Use Python 3.11 or newer on POSIX. A declared absolute Python executable is also supported. Relative file paths resolve against the private connection file. Distinct workspace aliases must have distinct directories. The configuration reader opens no ledger and starts no application.

Initialize the existing MCP host without a seller:

```sh
umask 077
node stellar-forge/mcp-merchant-operator/serve.mjs init-buyer-expenses \
  --dir /srv/starforge/expense-mcp \
  --connection /srv/starforge/expense-connection.json
```

An ordinary merchant `init` can instead attach `--buyer-expenses /absolute/connection.json`. Its saved merchant configuration uses the optional `buyerExpenseConnection` field. Existing seller, support, accounting and provider settings are retained.

Start the original authenticated transport with a private bearer already supplied by the operator's environment:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /srv/starforge/expense-mcp/merchant-mcp.json --port 3211
```

The existing `stdio.mjs --config /absolute/merchant-mcp.json` transport exposes these same tools. Do not print or place the bearer in arguments, source configuration or reports.

## Complete native workflow

All tool names below begin `merchant_buyer_expense_`. `expenses tools` and `buyerExpenseActions` expose the exact argument schemas.

| Step | Tools | Original behavior |
| --- | --- | --- |
| Select and open | `workspaces`, `open`, `state` | Explicitly open one declared original workspace. Read its current revision, sources, centers, labels and periods. |
| Register or refresh | `ledger_register`, `capture`, `source_rebind` | Use only a declared original ledger. Registration captures once; later capture retains a pending edition. Rebind keeps the original request-continuity checks. |
| Review source changes | `captures`, `capture_status`, `capture_review` | Page actual native deltas and retain the named accept/reject decision. Complete original captures remain downloadable. |
| Allocate actual expense | `items`, `item`, `center_save`, `labels_save`, `coding_save` | Exact string amounts must sum to the original settled actual. Recognition date, project and account code are operator decisions. Network and asset remain separate. |
| Resolve the period | `period_save`, `period_report`, `disposition` | Preserve outstanding reservations and missing-source indications. Resolve only the actual displayed issue with its current basis and allowed disposition. |
| Review and issue | `period_review`, `period_close`, `issued`, `review`, `history` | Review binds the current source/coding/decision context. Close requires that exact ready review. Issued data is frozen. |
| Continue a closed period | `period_reopen` | Record the operator and reason. Earlier reviews and issued editions stay available. |
| Receive the whole project | `export`, `exports`, `export_status`, `manifest`, `file`, `file_release` | Retain native files under a stable export ID. Download their pinned bytes and receive the included original application. |
| Finish | `close` | Close the exact instance owned by this host, drain its accepted requests and release the original workspace lease. |

State/history/report tools accept `offset` and `limit` (1–200). Report views expose the original allocations, outstanding reservations, issues, totals, cost-center/project groups, outstanding totals and source-capture references. They never add unlike assets or label reservations as settled expense.

## Transactional request recovery

Every customer mutation requires a caller-retained `requestId` and the inspected `expectedRevision`. The original server accepts the equivalent optional envelope:

```json
{
  "request_id": "finance-close-2026-10-12-1",
  "expected_revision": 21,
  "payload": {"review_id": "the-retained-original-review-id"}
}
```

The Store fingerprints the exact HTTP method, fixed path, full payload and expected revision. It writes the successful response to `api_requests` in the **same SQLite transaction** as the original change. A repeat of the same request returns that response before invoking the operation, including for capture and close. A reused ID with changed arguments returns `REQUEST_CONFLICT`. Failed or rolled-back operations do not create successful-request entries.

After a timeout, lost response or restart:

1. Keep the original private argument JSON unchanged.
2. Call `request` with the same workspace and request ID.
3. If committed, consume that retained response. If `REQUEST_NOT_COMMITTED`, the same original request may be retried. A revision conflict requires a new inspection and deliberate new request.
4. Do not generate a fresh ID merely because the original reply was lost.

The SDK never automatically retries a mutation. Native browser calls without `request_id` retain their original behavior. Existing version-1 expense workspaces add the known `api_requests` table when opened; no buyer ledger migration occurs. Full-project backups preserve successful request history.

MCP summaries page large native arrays. For the unchanged complete source or issued JSON, retain the corresponding export rather than treating a paged summary as the complete document.

## Customer SDK

```js
import {
  openBuyerExpenseClient,
  downloadBuyerExpenseExport,
  receiveBuyerExpenseProject,
} from './stellar-forge/mcp-merchant-operator/buyer-expense-client.mjs';

const client = await openBuyerExpenseClient({
  url: 'http://127.0.0.1:3211/mcp',
  tokenEnv: 'MCP_ACCESS_TOKEN',
});
const opened = await client.open({ workspace: 'finance' });
const state = await client.state({ workspace: 'finance', view: 'periods' });

// Inspect actual source, allocation and period data before supplying a mutation.
// Persist its exact arguments privately before calling the corresponding method.
const recovered = await client.request({
  workspace: 'finance',
  requestId: 'finance-close-2026-10-12-1',
});

const current = await client.state({ workspace: 'finance' });
const retained = await client.export({
  workspace: 'finance',
  exportId: 'finance-project-2026-10-12',
  kind: 'project',
  expectedRevision: current.revision,
});
const downloaded = await downloadBuyerExpenseExport({
  url: client.endpoint,
  exportId: retained.exportId,
  directory: '/srv/customer/finance-download',
  expectedManifestSha256: retained.manifestSha256,
});
await client.close({ workspace: 'finance', instanceId: opened.instanceId });
```

Named methods use camelCase (`captureReview`, `codingSave`, `periodClose`, `exportStatus`); `client.call(action, args)` accepts the exact snake-case action. An optional third call argument uses the original transport's `requestSignal` and `timeoutMs`. Cancelling the wait does not undo an admitted native operation: recover its retained request.

## Customer command line

The installed `merchant-mcp` command reaches the same entrypoint; a repository checkout can invoke `node stellar-forge/mcp-merchant-operator/serve.mjs`.

```sh
merchant-mcp expenses tools
merchant-mcp expenses call --url http://127.0.0.1:3211/mcp \
  --action state --arguments /private/finance-state.json
merchant-mcp expenses call --url http://127.0.0.1:3211/mcp \
  --action period_close --arguments /private/exact-close-request.json \
  --output /private/close-response.json
merchant-mcp expenses inspect --url http://127.0.0.1:3211/mcp \
  --export finance-project-2026-10-12
merchant-mcp expenses download --url http://127.0.0.1:3211/mcp \
  --export finance-project-2026-10-12 --directory /private/download \
  --manifest-sha256 THE_RETAINED_MANIFEST_SHA256
merchant-mcp expenses receive \
  --archive /private/download/buyer-expense-project.zip \
  --directory /private/received-expenses --sha256 THE_PROJECT_FILE_SHA256
```

Argument files must be private regular JSON files. Output paths create new private files. Download uses the maintained MCP manifest, file-snapshot and prefix-verified checkpoint implementation. Repeating the same download resumes its exact retained bytes; it cannot issue another close, capture or payment.

## Export and receiving identities

Exports have distinct, immutable selections:

| Kind | Selection | File |
| --- | --- | --- |
| `project` | Exact current workspace revision | `buyer-expense-project.zip` |
| `accountant` | Original close ID | `accountant-edition.zip` |
| `capture` | Original capture ID | `original-capture.json` |
| `issued-json` | Original close ID | `issued-edition.json` |
| `issued-html` | Original close ID | `issued-edition.html` |

A stable export ID retains its original request before preparation. A completed payload is committed as one private directory before the completion manifest. Retrying an interrupted preparation reconciles that same payload; completed exports stay discoverable after the expense server or MCP host closes. A complete-project selection fails if its inspected native revision has changed.

The trusted `receive.py` checks the reviewed whole-archive SHA256, complete member set, every retained file hash/byte count, known native SQLite tables/columns, workspace identity, revision and successful-request count. It extracts only known original project members into a new private destination, with exact-archive continuation after an interrupted receive. It executes no archive code or SQL. Old version-1 projects without request history are identified as legacy and acquire the additive table on normal original opening.

The received package includes the original Python application, source statement reader, public UI, instructions and consistent workspace database. Opening it needs no repository checkout. It retains captured statement snapshots and accountant history; the original buyer ledger, wallet and signing material remain outside it. No source capture or payment is replayed during receiving. Existing local ledger locators can be rebound through the original source workflow if a later deliberate refresh is required.

The new machine surface should be exercised through the same retained original case before its operating completion is claimed. Its source implementation does not itself establish a new customer acceptance, purchase or accountant signoff.
