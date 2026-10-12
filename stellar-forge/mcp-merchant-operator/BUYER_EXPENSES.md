# Original buyer expense operation from MCP and customer code

The merchant MCP host can operate the original SF36 expense workspace through its existing Python HTTP application. This is an accounting continuation of already retained SF36 ledgers or original MCP quote/payment observations. It does not create a buyer, make a payment, read a signer, change a reservation, or introduce another ledger.

The same source captures, exact atomic allocation lines, outstanding reservations, named period reviews, immutable closes and reopen history are available to the browser and customer tools. All financial rules remain in `sf36-spend-governor/expense-workspace/{store,domain,native}.py`; SF36 source reading remains in original `statement.py`, and MCP reading uses original `SqliteQuoteStore.readSnapshot` plus its saved SF86 observations.

## Declare the original host inputs

Create an owned mode-0600 JSON file. Paths in this file are operator configuration, not MCP arguments. The workspace can be an existing original expense workspace or a new private workspace. Each original ledger or MCP quote directory needs its own explicit alias and truthful provenance.

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
      },
      "quoteSources": {
        "remote_tools": {
          "path": "/srv/starforge/original-mcp-buyer",
          "name": "Original native MCP purchases",
          "provenance": "Operator-owned original quote store; retain the actual purchase and saved reconciliation references."
        }
      }
    }
  }
}
```

Use Python 3.11 or newer on POSIX. A declared absolute Python executable is also supported. Relative file paths resolve against the private connection file. Distinct workspace aliases must have distinct directories. The configuration reader opens no buyer source and starts no application. New MCP captures use the same Node executable that owns this MCP host; callers cannot select executables or arbitrary source paths.

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
| Register or refresh | `ledger_register`, `mcp_register`, `capture`, `source_rebind` | Use a declared original source of the matching type. Registration captures once; later captures are pending editions. Rebind keeps original native identity continuity. |
| Import original Node accounting | `node_preview`, `node_capture` | Select a host-declared original export, inspect its complete native outcome and retain a pending or reusable capture under the same request/revision contract. |
| Review source changes | `captures`, `capture_status`, `capture_review` | Page actual native deltas and retain the named accept/reject decision. Complete original captures remain downloadable. |
| Allocate actual expense | `items`, `item`, `center_save`, `labels_save`, `coding_save` | Exact string amounts must sum to the original settled actual. Recognition date, project and account code are operator decisions. Network and asset remain separate. |
| Resolve the period | `period_save`, `period_report`, `disposition` | Preserve outstanding reservations and missing-source indications. Resolve only the actual displayed issue with its current basis and allowed disposition. |
| Review and issue | `period_review`, `period_close`, `issued`, `review`, `history` | Review binds the current source/coding/decision context. Close requires that exact ready review. Issued data is frozen. |
| Continue a closed period | `period_reopen` | Record the operator and reason. Earlier reviews and issued editions stay available. |
| Receive the whole project | `export`, `exports`, `export_status`, `manifest`, `file`, `file_release` | Retain native files under a stable export ID. Download their pinned bytes and receive the included original application. |
| Finish | `close` | Close the exact instance owned by this host, drain its accepted requests and release the original workspace lease. |

State/history/report tools accept `offset` and `limit` (1–200). Report views expose the original allocations, outstanding reservations, issues, totals, cost-center/project groups, outstanding totals, source-capture references and `native_payment_outcomes`. They never add unlike assets, label reservations as settled expense, or turn MCP quote prices into reservations.

## Original MCP purchase to accountant

`mcp_register` selects a `quoteSource` alias and the same `requestId` / `expectedRevision` contract as ledger registration. Its SDK name is `mcpRegister`. A later `capture` uses the registered source kind and must still match a host-declared locator. `source_rebind` takes exactly one `ledger` or `quoteSource` alias, which must match the retained source type.

The native reader opens original `quotes.sqlite` read-only and preserves each quote's accepted terms, dispatch state, buyer result and saved original payment observation. Only an exact-bound saved native SF86 `TRANSFER_MATCHED` observation supplies settled actual for allocation. Seller-confirmed results and unresolved or failed payment observations remain visible in the same period workflow. The fixed reader performs no network request, reconciliation, signing or payment. Use the original buyer recovery operation first when its report is absent, then explicitly capture and review that source.

MCP quote creation day is a source date, not a settlement date. Recognition remains the operator's explicit decision. The same exact matched transfer cannot close as two included charges through duplicated source captures or another currently closed period. Raw original observation/result metadata is available in capture exports, and `native_payment_outcomes` is a paged report/review/issued view. Purchased result bodies remain with the original buyer.

## Original Node accounting export to period

Declare `nodeSources` on the existing connection workspace. Each alias has an original private `sourceFile`, exact `sourceSha256`, truthful `name` and `provenance`, and explicit `dataContext` (`operational` or `development`). The unchanged producer format is `stellar-forge.node-operation-accounting-export.v1`. The host checks the exact file bytes before native preview or capture.

Call `node_preview` with `workspace`, `nodeSource` and the actual `operator`. Its source/outcome preview includes `preview_sha256`, any previous exact-file capture, the current parent and whether this intake reopens a valid current capture or creates a new pending one. Persist `node_capture` arguments with that digest as `previewSha256`, the same fields, a stable `requestId` and inspected `expectedRevision`. The original Store commits bytes and response in one transaction. Recover a lost response through `request` before retrying.

Use `capture_review` for the same named accept/reject decision, then original item/allocation/period tools. The unpaid outcome creates no expense or fabricated reservation; unfinalized outcomes remain review items. Original finalized request/proof and matched-event identities prevent duplicate inclusion through other source representations. A Node/closed-source shared transaction without distinct event evidence requires source review in either arrival order.

The SDK exposes `nodePreview` / `nodeCapture` automatically from this same catalog. The CLI uses existing `expenses call --action node_preview` or `--action node_capture` and private argument JSON. The bearer remains in the operator's environment. All earlier source and credit actions remain in the same catalog.

`export` kind `node-operation` with the capture `recordId` retains `original-node-accounting-export.json`. The complete project carries original Node bytes, capture/review/request history and the original reader's ten-file closure. The trusted receiver validates the additive feature and its source counts without executing archive code or launching a new native capture. See [the original operator's complete Node guide](../../stellar/scf-starforge-20261009/sf36-spend-governor/expense-workspace/NODE_OPERATIONS.md).

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

The installed `starforge merchant-mcp` command reaches the same entrypoint; a repository checkout can invoke `node stellar-forge/mcp-merchant-operator/serve.mjs`.

```sh
starforge merchant-mcp expenses tools
starforge merchant-mcp expenses call --url http://127.0.0.1:3211/mcp \
  --action state --arguments /private/finance-state.json
starforge merchant-mcp expenses call --url http://127.0.0.1:3211/mcp \
  --action period_close --arguments /private/exact-close-request.json \
  --output /private/close-response.json
starforge merchant-mcp expenses inspect --url http://127.0.0.1:3211/mcp \
  --export finance-project-2026-10-12
starforge merchant-mcp expenses download --url http://127.0.0.1:3211/mcp \
  --export finance-project-2026-10-12 --directory /private/download \
  --manifest-sha256 THE_RETAINED_MANIFEST_SHA256
starforge merchant-mcp expenses receive \
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
| `node-operation` | Original Node capture ID | `original-node-accounting-export.json` |
| `issued-json` | Original close ID | `issued-edition.json` |
| `issued-html` | Original close ID | `issued-edition.html` |

A stable export ID retains its original request before preparation. A completed payload is committed as one private directory before the completion manifest. Retrying an interrupted preparation reconciles that same payload; completed exports stay discoverable after the expense server or MCP host closes. A complete-project selection fails if its inspected native revision has changed.

The trusted `receive.py` checks the reviewed whole-archive SHA256, complete member set, every retained file hash/byte count, known native SQLite tables/columns, workspace identity, revision and successful-request count. It extracts only known original project members into a new private destination, with exact-archive continuation after an interrupted receive. It executes no archive code or SQL. Old version-1 projects without request history are identified as legacy and acquire the additive table on normal original opening.

The received package includes the original Python application, source statement reader, complete native MCP quote-reader files, public UI, instructions and consistent workspace database. Opening it needs no repository checkout. It retains captured statement snapshots and accountant history; the original buyer ledgers, quote databases, purchased output bodies, wallet and signing material remain outside it. No source capture or payment is replayed during receiving. Existing local source locators can be rebound through the original source workflow if a later deliberate refresh is required. Saved state opens with Python alone; only a new MCP source capture needs the host's Node 22.13+ or Node 24 runtime. Receiving verifies the advertised native reader feature, required files and original source kinds.

## Completed original operating continuation

The 2026-10-12 internal operating journey continued the original D173 Stellar testnet case from revision 15 to 22 through this MCP host, customer SDK and command line. It retained the original statement projection (three journal events and two reservations), with 10,000 settled atomic units and the separate 10,000-unit unsent reservation. The reviewed allocation successor was 8,000 / 2,000; the earlier issued editions remain available.

The capture and period-close responses were deliberately discarded after successful native HTTP headers. Their exact committed results were recovered through the original request IDs, then recovered again after the host restarted. The consistent project export retained seven successful requests. A customer download interrupted after 4,096 bytes resumed those same pinned bytes.

The trusted receiver reopened all 14 native tables and 18 project members with the included Python application. It recovered the same capture and close without changing revision 22, adding a capture, or creating a payment. This was an internal continuation of the existing purchase and operator review.

The retained complete project is 87,394 bytes, SHA256 `9156505408514205f52caa6dcd2b5c57a1b20f79a321b3ff7bdd7a43cd3018bb`. The native workflow ran the reviewed expense source at `dccba68845a93420f409d76ce7f28cb40e02717a`; subsequent shared-host composition preserves the current Redis and source-workspace integrations. All owned services closed on completion.

### Original remote-MCP source joined to the same case

The subsequent original-purchase continuation reached revision 29 through `mcp_register`, source acceptance, allocation, period review/close and retained export. Four existing MySQL HPD quotes produced one exact-bound 50,000-atomic-unit expense, one separately carried unresolved signed quote and two unsigned rejections. The original D173 allocation and 10,000-unit unsent reservation remained intact; the new issued expense total was 60,000 atomic units in the same original testnet asset.

The complete receiving project retained both native source kinds, all 14 tables, 14 committed requests and 24 project members, including the read-only quote-reader closure. The same case and issued edition reopened with no new source capture or payment. The original buyer's native reconciliation reused its existing optional Stellar SDK runtime; the expense capture itself required only Node's standard library. Desktop and mobile inspection of the included source completed with no page errors, and all owned processes closed.

## Original buyer credits and refund receiving

The same customer host exposes `refund_capture`, `refund_packets`, `refund_packet`, `refund_review`, `credits`, `credit` and `credit_coding_save` under the original `merchant_buyer_expense_` prefix. The JavaScript client derives `refundCapture`, `refundReview`, `creditCodingSave` and the corresponding read methods from the same contract. Successful mutations use the original Store transaction/request recovery and the same per-workspace child lifetime.

Declare the original customer packets on the host, preserving exact source identities:

```json
{
  "schema": "stellar-forge.buyer-expense-connection.v1",
  "workspaces": {
    "buyer": {
      "directory": "/operator/buyer-expenses",
      "refundSources": {
        "original-return": {
          "directory": "/received/original-refund",
          "manifestSha256": "EXACT_ORIGINAL_MANIFEST_SHA256",
          "siteUrl": "https://original-store.example",
          "name": "Original customer refund",
          "provenance": "The original operator, operation and retained source references",
          "dataContext": "operational"
        }
      }
    }
  }
}
```

The strings above are configuration placeholders. Supply the actual original packet/hash/store and use `development` for a retained development operation. Operational and development records stay in separate native workspaces. Existing `ledgers` and `quoteSources` may also declare `dataContext`, defaulting to `operational`.

Capture the declared alias, inspect its source, then accept/reject the packet with a named reason and either the exact matching purchase item or explicit `register_original_purchase: true`. Read and code the original purchase before its returns. `credit_coding_save` uses the original exact native allocation shape and current return basis. It enforces original purchase dimensions, cumulative capacity and unique native return identity. Original store-currency credit and native returned units are never converted into one another.

The existing `period_report`, `review` and `issued` views now include `credit_allocations`, `credit_totals`, `net_totals`, `credit_by_cost_center`, `net_by_cost_center` and `merchant_credit_outcomes`. Their immutable reports retain the original packet and source context. Reopen before changing a closed period. Use `export` kind `refund-packet` with the original packet ID for the unchanged customer source, or the existing accountant/project forms for a complete handoff. The maintained resumable downloader and trusted included-source receiver handle those original exports.

No merchant mutation, new payment, signer or on-chain observation is initiated by the buyer-credit surface.

### Completed original refund operation

The original 7737/B41A order-18 redelivery completed through this customer interface in a separate development workspace at revision 19: two accepted original packets, one bound purchase, two exact return allocations and three issued editions. Native net progressed from 2500000 to 1500000 to 0 while the separate USD 2.50 purchase and USD 1.00 / USD 1.50 store credits stayed unchanged. Capture/final-close request recovery, host restart, original source/accountant exports and included-source receiving completed without a new payment or merchant call. The earlier operational 60000-unit buyer case was not changed. All 39 tools continue to use the same maintained contract; the added refund controls are part of the existing provider and SDK.

## Native accounting export and paid-job receipt intake

The same customer surface exposes `adjustment_capture` (SDK `adjustmentCapture`) alongside the existing `refund_capture`. Add an `adjustmentSources` object to the existing workspace declaration:

```json
{
  "adjustmentSources": {
    "job_resolution": {
      "sourceFile": "/srv/starforge/original-merchant/adjustments-export.json",
      "sourceSha256": "REPLACE_WITH_ORIGINAL_FILE_SHA256",
      "eventId": "REPLACE_WITH_ORIGINAL_ACCOUNTING_EVENT_ID",
      "name": "Original merchant adjustment decisions",
      "provenance": "Record the actual source owner, job and original operation here.",
      "dataContext": "operational"
    }
  }
}
```

Replace both placeholders with the exact 64-character lowercase hexadecimal source identities before reading this connection. The host fixes the source path; a customer selects only the `adjustmentSource` alias. For a paid job, optionally declare `expectedJob:{job_id,settlement}` using the original job ID and a selection of the original accounting row's ten fields: `id, receiptFingerprint, transactionFingerprint, network, assetDigest, recipientDigest, amountAtomic, routeId, method, orderReferenceDigest`. Here `id` is the selected row's `eventId`. This binding is separate from the complete native SF98 job record, whose original `orderReference` remains retained by its owner. The native reader checks every selected field and SHA-256 of the original job ID.

`adjustment_capture` retains the unchanged original `stellar-forge.merchant-adjustment-export.v1` JSON and all decisions for the selected event. Its reviewed SHA and selected job/event are retained separately in a buyer-selection manifest. The source remains the original accounting export; this is not a new merchant receipt format.

Use `refund_packet` to inspect nullable `purchase`, plural `credits`, original `adjustments`, `source_sha256`, `source_reference`, original payment status and matching existing payments. Then `refund_review` accepts or rejects the retained selection. A reference-only export needs only the named decision; do not set purchase registration when no independent original payment proof is carried. With a proved purchase, select its existing item or explicitly register it. Every eligible native return gets an individual `credit_id`; `credit_ids` retains the whole selected set. If the same native reverse event is already allocated through another retained source, inspect that original credit and preserve its coding. The additional representation can be retained with an explicit `exclude_from_period` decision; attempting to allocate the same transfer again returns `RETURN_ALREADY_ALLOCATED`. Reopen and issue the affected period to retain the new source decision without rewriting earlier editions.

The existing `credit`, `credit_coding_save`, period review/close/reopen and export operations complete the workflow. The report, review and issued tools add the paged `merchant_adjustment_outcomes` view. Pending returns, cancellations, withdrawn requests and unavailable original-payment proofs remain visible as source decisions without entering returned-unit totals. Optional Woo/store fields are null when not supplied; no exchange rate, currency amount or Woo order is manufactured.

Stable request IDs recover the exact completed intake or period mutation. Stable export IDs recover the same source receipt, accountant edition or complete included-source project. `refund-packet` export retains the original JSON and explicitly named `buyer-selection.json` for generic intake. All other financial, source-context, lifecycle and resumable transfer semantics are unchanged.

## Governed native MCP source continuation

A workspace may also declare `governedQuoteSources` aliases with the same `path`, `name`, `provenance` and `dataContext` fields as original quote aliases. Each path selects a private `stellar-forge.governed-mcp-expense-input.v1` descriptor joining the actual original quote directory and original native spending host configuration. `merchant_buyer_expense_governed_mcp_register` accepts `workspace`, `requestId`, `expectedRevision` and `governedSource`.

The original capture/review/allocation/period/export tools continue the workflow. `source_rebind` accepts exactly one `ledger`, `quoteSource` or `governedSource` alias. `SPENDING_SOURCE_REVIEW` exposes a retained native binding or finality disagreement while its original reserved capacity remains visible. Read the complete [governed source and receiving guide](../../stellar/scf-starforge-20261009/sf36-spend-governor/expense-workspace/GOVERNED_MCP.md).
