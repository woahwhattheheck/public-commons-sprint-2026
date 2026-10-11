# Merchant customer statements

This workspace prepares customer purchase and service usage statements from the original merchant accounting ledger and the original SF101 API-pass export. It keeps the original payment once per purchased order, retains actual call outcomes and unit balances, and produces a customer document, purchase CSV, service call CSV and a file manifest.

The desk is available at **Customer statements** in the merchant accounting operator interface, at `/customer-statements/`. It uses the accounting runtime’s existing state, revision control and lease. The standalone entry opens the same original workspace:

```sh
node customer-statements/cli.mjs serve --workspace /absolute/merchant-accounting-workspace --port 8447
```

## Operator workflow

1. **Create or select a customer.** Save the customer reference, name and optional email/address. These fields form the customer document header. The account note remains an internal workspace field.
2. **Assign original order references.** Paste one original SF101 checkout reference per line, optionally followed by a tab and a customer-facing description. Assignments are explicit; routes, recipients and wallet fingerprints do not identify customers. Bulk assignment supports up to 2,000 orders per operation.
3. **Import original service usage.** Download the complete original API-pass export from the merchant receiver and choose its JSON file. The importer retains the exact source bytes and their SHA-256. A purchase-only statement can use the accounting report without a usage capture.
4. **Choose a completed original accounting run.** Select the customer, run and optional service capture. An optional UTC period selects native purchase capture times, with an inclusive start and exclusive end. Service usage remains cumulative at the source capture time.
5. **Review the prepared statement.** Check original amounts, transfer classification, adjustments, customer orders, service units and any excluded assignments. Each asset/network/selected recipient has its own total. The original merchant USD valuation is shown separately.
6. **Retain the document.** The workspace freezes the reviewed customer profile, original ledger projection, adjustments and usage capture. It allocates a statement number and writes the retained files before committing their references to the existing accounting state.
7. **Deliver the prepared files.** Open the document register to download the print document or CSVs. The HTML is a standalone, script-free document suitable for printing. Delivery stays in the merchant’s existing customer communication workflow.

The original merchant accounting interface remains the entry for collecting native sources, importing official transfer results and running reconciliation. This module consumes those retained results.

### Corrections and withdrawals

Customer profiles and order assignments have explicit versions. A reassignment to a different customer requires the operator’s correction reason and is recorded in the original workspace history. Earlier retained documents keep their original customer snapshot.

Use **Prepare correction** on a current retained document to prepare a replacement for the same customer. Retaining the correction marks the earlier document as superseded and links both document IDs. **Withdraw document from current register** records the operator and reason while retaining the original files. Current filenames include the document’s register status, and `status.json` exports its current status and history.

A document correction changes the customer document register. Original payment, refund and service entitlement changes continue through their existing merchant controllers.

## Original source joins

The statement engine takes a hash-verified completed `stellar-forge.merchant-reconciliation.v1` report from the original accounting workspace. A purchase row joins to a customer only through an explicit order assignment whose SHA-256 equals the original report’s `orderReferenceDigest`.

A service capture joins only when all of these original values agree:

- Raw order reference and its ledger digest.
- Original SF98 event ID.
- Route ID, method and network.
- Exact atomic payment amount and asset digest.
- **Observed recipient digest**, including the original null value for a legacy order.

The comparison follows the original SF101 receiver’s order/event binding. A selected merchant term’s recipient is retained separately as `termsRecipientDigest`; it cannot replace a missing observed recipient in the entitlement join.

Assigned orders with no selected native purchase, more than one matching event, a recovered rather than native source, or a mismatched usage identity remain visible in the excluded-order section. A missing order in an otherwise valid usage capture preserves the original accounting purchase and identifies the missing usage capture for that row.

### Payments, adjustments and usage

The purchase amount is retained in its original atomic units. Totals stay separate by network, asset and selected recipient. Official transfer matches preserve their original testnet or public-network scope. The customer statement keeps the original delivery outcome and reconciliation exception.

Refund and cancellation values come from the existing accounting adjustment functions. Verified refunds, pending refund requests and recorded cancellations remain distinct. The complete validated original adjustment records are used for the calculation; the customer document projects their identifiers, kind, status, amount and times.

A prepaid service order records its original purchase once. Later calls describe how that purchased allowance was used. The usage CSV therefore contains service units and outcomes, while the purchase CSV contains one original payment row per order.

| Original durable call status | Consumed units | Reserved units |
| --- | ---: | ---: |
| `IN_FLIGHT` or stored `RECOVERY_REQUIRED` | 0 | Original route unit price |
| `COMPLETED` | Original route unit price | 0 |
| `CONSUMED` | Original route unit price | 0 |
| `RELEASED` | 0 | 0 |

The displayed status can show deadline-derived recovery while the stored call remains in flight. The importer uses the original **stored status** for unit arithmetic. A completed application response, including an HTTP error response, retains the unit treatment recorded by the original service core.

Customer records include the response status, content type, byte count and SHA-256 when the original response is retained. Call bodies, bearer tokens, customer account notes and merchant variable costs are outside the customer projection.

## Supported usage imports

### Original installed API-pass export

The primary importer reads `stellar-forge.sf101.api-pass-export.v1` directly from the original [API-pass implementation](../../sf101-merchant-receiver/api-access/). It uses the real native export fields:

| Export field | Statement use |
| --- | --- |
| `pass.native` | Original order, event, payment terms and entitlement time |
| `pass.plan.title` | Purchased service label |
| `pass.planSha256` | Actual canonical plan identity |
| `pass.manifestSha256` | Exact purchased file revision; must equal `pass.native.fileSha256` |
| `pass.usage.allowanceUnits` | Purchased units |
| `pass.usage.consumedUnits` | Used units |
| `pass.usage.reservedUnits` | Reserved units |
| `pass.usage.availableUnits` | Remaining units |
| `calls` | Complete original call history |
| `snapshot.capturedAt` | Actual source capture time |
| `snapshot.stateSha256` | Original durable snapshot revision |
| `snapshot.callCount` and `snapshot.actionCount` | Completeness checks against retained calls/actions |

The native export captures the pass, all calls and operator actions in one original database view. The importer checks the declared capture counts, unique requests, each call’s purchased route/method/path/unit price, durable outcome counts, consumed units, reserved units and the complete allowance balance. An export with remaining pages or a mismatched count is rejected.

The normalized statement keeps `planSha256` and `manifestSha256` separately. Its shared service projection uses the actual canonical plan digest as `planId` and the exact purchased file digest as `planRevision`.

Each native export describes one purchased API pass. To prepare a statement for that pass, select its customer and original purchase record/capture. Other assigned purchases in the selected report remain visible with their own original accounting outcomes.

### Shared service usage capture

The agreed aggregate adapter shape is also supported:

```json
{
  "schema": "stellar-forge.sf101.service-usage-export.v1",
  "createdAt": "2026-10-11T22:30:49.343Z",
  "revision": "actual-original-snapshot-revision",
  "orders": []
}
```

Each order supplies `orderRef`, original `eventId`, `routeId`, `method`, `network`, `amountAtomic`, `assetDigest`, `recipientDigest`, `entitledAt`, `planId`, `planLabel`, `planRevision`, and exact integer strings `unitsPurchased`, `unitsUsed`, `unitsReserved`, `unitsRemaining`. Used plus reserved plus remaining must equal purchased. An unentitled order carries null event and entitlement time together.

This aggregate shape carries original service totals. The installed native export additionally carries validated full call history.

## Files and state

The module adds `customerStatements` to the original `workspace.json`. It stores customers, explicit order bindings, usage input metadata, document register entries, numbering and operation history. All mutations use `workspace.serial()`, the existing lease, `workspace.expected(revision)` and the original durable commit.

Exact service inputs are stored under:

```text
inputs/customer-usage-<sha256>.json
```

Each retained document uses the existing accounting export directory:

```text
exports/<statement-uuid>/statement.json
exports/<statement-uuid>/statement.csv
exports/<statement-uuid>/usage.csv
exports/<statement-uuid>/statement.html
exports/<statement-uuid>/manifest.json
```

The manifest records exact file byte counts and SHA-256 values. Downloads recheck those hashes and use a fixed filename allowlist. The files and directories use the original workspace’s private storage and are part of its operating-state backup closure.

`status.json` is a current register export generated when requested. It is separate from the immutable document files. Existing document files retain the customer and accounting state at the moment they were retained.

### Retry behavior

A retention request includes a stable `requestId`, the original workspace revision and the reviewed `previewSha256`. A retry of the same request returns its existing retained document before applying a stale-revision check. Reusing that ID for different content produces a conflict. A new request validates the current revision and recomputes the exact preview from the retained report, usage bytes, customer assignments and current original adjustments.

The browser keeps a pending request in session storage when available. If a reply is lost, **Retry same retention** recovers the original document. A saved result remains saved even if a later register refresh fails.

Usage input imports are deduplicated by exact source bytes. CLI exports write new files exclusively and accept an existing output only when its bytes already match.

## CLI operation

The installed Node entry is `customer-statements/cli.mjs`, exporting `customerStatementsMain(argv)` for distribution integration. Run `help` for the full command list.

```sh
node customer-statements/cli.mjs state --workspace /absolute/merchant-accounting-workspace
node customer-statements/cli.mjs customer-save --workspace /absolute/merchant-accounting-workspace --input customer.json
node customer-statements/cli.mjs orders-assign --workspace /absolute/merchant-accounting-workspace --input assignments.json
node customer-statements/cli.mjs usage-import --workspace /absolute/merchant-accounting-workspace --file original-api-pass-export.json --revision 12 --actor merchant-operator --name "API pass capture"
node customer-statements/cli.mjs preview --workspace /absolute/merchant-accounting-workspace --input selection.json
node customer-statements/cli.mjs retain --workspace /absolute/merchant-accounting-workspace --input retention.json
```

Use the actual revision returned by the current workspace, and the actual IDs returned by the original operations. The example revision above is a command-shape example.

A customer request includes `revision`, `actor`, `reference`, `name` and optional `email`, `address`, `note`. Editing adds the existing `id` and `expectedVersion`.

An assignment request includes `revision`, `actor`, `customerId` and `orders: [{orderRef, label}]`. Explicit cross-customer corrections add `reassign: true` and `reason`.

A selection contains `customerId`, `runId` and optional `usageId`, exact UTC `from`/`until`, and `replacesId`. Retention adds `revision`, `actor`, `requestId` and the returned `previewSha256`.

`show`, `statements`, `bindings`, `export` and `withdraw` expose the same document register and correction workflow. `--input -` accepts one JSON object from standard input; `export --output -` streams the exact retained file.

## Embedded API and runtime integration

The module exports:

```js
import {CustomerStatementWorkspace, STATEMENT_REQUEST_BYTES} from '../customer-statements/store.mjs';
import {handleCustomerStatementRequest, customerStatementAsset} from '../customer-statements/server.mjs';

const statements = new CustomerStatementWorkspace(workspace);
await statements.init();
```

The controller takes the **original opened accounting workspace**. It creates no second state lease, background worker or service close hook. It is reconstructed with the original runtime after maintenance restore/resume.

Serve `customerStatementAsset(path)` through the existing server’s security headers before entering a maintenance-protected operation. It returns null or `{bytes, type}` for the fixed `/customer-statements` asset paths.

After entering the original operation, route `handleCustomerStatementRequest(statements, {method, path, query, value})`. It returns null, `{value}`, or `{file: {bytes, name, type}, type}`. Expected errors carry `code`, `message` and `status`.

| Method | Path | Operation |
| --- | --- | --- |
| GET | `/api/customer-statements` | Workspace revision, customer records, captures and register summary |
| GET / POST | `/api/customer-statements/bindings` | Page assignments / save assignments |
| POST | `/api/customer-statements/customers` | Save customer profile |
| POST | `/api/customer-statements/usage` | Retain exact original usage input |
| POST | `/api/customer-statements/preview` | Prepare original statement projection |
| POST | `/api/customer-statements/retain` | Retain the reviewed document |
| GET | `/api/customer-statements/statements` | Page/filter register |
| GET | `/api/customer-statements/statements/:id` | Retained document and current register metadata |
| GET | `/api/customer-statements/statements/:id/download/:name` | Exact retained file or current status |
| POST | `/api/customer-statements/statements/:id/withdraw` | Withdraw current register entry |

The embedded server retains the existing Host, Origin, JSON and `X-Workspace-Request: 1` checks. Set the POST body limit for this API prefix to `STATEMENT_REQUEST_BYTES` (32,100,000 bytes); an imported raw source is limited to 24,000,000 bytes. The client handles both the original accounting error envelope and the standalone statement error envelope.

Current workspace limits are 1,000 customer profiles, 20,000 order assignments, 1,000 retained usage captures and 5,000 statement documents. These limits share the original workspace’s durable state and history capacity.
