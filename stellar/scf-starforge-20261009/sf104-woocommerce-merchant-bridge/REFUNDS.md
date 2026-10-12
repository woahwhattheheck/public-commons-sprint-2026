# Verified refunds for WooCommerce

The merchant console and the installed `starforge woo-refund` command record a verified Stellar refund as an order credit in the original WooCommerce order. The accounting adjustment supplies the native reverse-transfer proof. The merchant supplies the credit amount in the order's own currency.

For a digital basket, the credit applies to the same original whole order. Item returns and per-line entitlement decisions use the merchant's ordinary Woo workflow; [BASKET.md](BASKET.md) carries its frozen line and delivery contract.

A refund can be partial or full. Each separate native refund uses its original adjustment UUID. The bridge retains the original gross payment, every verified return, the exact store currency allocation, and the corresponding native WooCommerce refund ID.

## Select the original verified adjustment

Use the `adjustments.json` export from the merchant settlement accounting workspace after its refund verifier has matched the reverse transfer. Preserve those exported bytes when copying the file. The operator accepts one selected `REFUND` with status `VERIFIED` and the canonical network verifier's complete proof.

The import binds the selected adjustment to the original accounting report and the Woo order's released payment:

- The original event ID, transaction fingerprint, network, asset digest, recipient digest, atomic amount, and order reference digest must agree.
- The original reviewed payment identifies the merchant receiver and original payer.
- The refund proof must reverse those identities, use the same network and asset, match the selected atomic amount, and identify a different native transaction.
- The verifier result must match the canonical network profile, including its official endpoint, network passphrase, source, and retained response hashes.

The bridge reads the existing merchant operator configuration described in [NATIVE_REVIEW.md](NATIVE_REVIEW.md). It uses the same WordPress manager credentials, application-password environment variables, authenticated transport, site URL, and private workspace.

## Review and prepare a credit

Read the original Woo order, its current remaining store amount, existing refund children, and saved refund mappings:

```sh
starforge woo-refund inspect \
  --config /private/woo-operator.json \
  --order 123
```

Choose the store credit explicitly. For an order priced in USD, `--woo-amount 4.25` means USD 4.25. The amount is parsed as an exact decimal with the store's configured price precision. The native amount remains the separate atomic-unit amount in the original verified adjustment. The operator performs no currency conversion.

Prepare the selected verified refund:

```sh
starforge woo-refund prepare \
  --config /private/woo-operator.json \
  --adjustments /private/adjustments.json \
  --adjustment 11111111-2222-4333-8444-555555555555 \
  --order 123 \
  --woo-amount 4.25
```

Replace the example UUID with the actual saved accounting adjustment UUID. Preparation validates the source and current order, reserves the reviewed credit in the bridge's order journal, and returns `PREPARED` with a review SHA. The server checks aggregate native refunds and store currency credits, including other prepared adjustments, against their respective remaining amounts.

The local operation is retained at `<workspace>/refunds/<adjustment-UUID>/`. Reopening that operation uses the same site, order, export bytes, adjustment request, native proof, and selected Woo amount. A different refund receives its own accounting adjustment UUID. If the merchant console deliberately revises an existing prepared allocation, reopen its current review there; a CLI operation with a different retained allocation reports the mismatch.

## Apply the order credit

Confirm the exact order reference:

```sh
starforge woo-refund apply \
  --config /private/woo-operator.json \
  --adjustment 11111111-2222-4333-8444-555555555555 \
  --confirm-order 123
```

Apply reads the current prepared review, then calls WooCommerce's native refund creation with `refund_payment: false` and `restock_items: false`. The native reverse transfer has already occurred and been verified. This operation records its order credit; it sends no second gateway payment.

The refund is amount-only. Native WooCommerce refund and order-status hooks run. The bridge leaves item return/restock decisions and download-permission records to the merchant's native Woo workflow. A full monetary refund can change the order status to `refunded`; WooCommerce can then deny download access even when the original permission records remain present. Review the resulting native order status when resolving a digital-product return.

After the write, the CLI reads the original order again. `APPLIED` requires the saved adjustment mapping and one matching WooCommerce refund child with the exact refund ID, amount, currency, native transaction, adjustment UUID, and review SHA.

For several partial refunds, prepare and apply each independently verified adjustment using its own UUID and explicit store amount. The server enforces the combined remaining amounts. A final partial credit can bring the order to its full refunded amount.

## Recover an interrupted operation

Read the original order and save the observation:

```sh
starforge woo-refund recover \
  --config /private/woo-operator.json \
  --adjustment 11111111-2222-4333-8444-555555555555
```

Recovery sends a GET only. Each explicit prepare or apply sends at most one POST and then a fresh GET. There is no automatic POST retry loop.

| Result | Meaning and operation |
| --- | --- |
| `NOT_PREPARED` | The current order has no mapping for this UUID. Re-run prepare explicitly with the same export and allocation when continuing this refund. |
| `PREPARED` | The reviewed allocation is saved. Apply with the same UUID and exact confirmed order. |
| `APPLYING` | The native apply journal is in progress. Re-read it, then explicitly apply the same saved review when recovery is needed. |
| `REFUND_SAVED_JOURNAL_PENDING` | The actual Woo refund child exists with matching stable metadata. Explicit apply recovers that child into the bridge journal. |
| `APPLIED` | The saved mapping and actual native Woo refund agree. Repeated apply reads and returns this existing refund. |
| `REFUND_RECONCILIATION_REQUIRED` | The saved mapping and native Woo refund no longer agree, or multiple matching children exist. Inspect the original order and retained history before changing that refund. |
| `PREPARE_OUTCOME_UNKNOWN`, `APPLY_OUTCOME_UNKNOWN`, or `REFUND_READBACK_UNAVAILABLE` | The operation lacks a conclusive fresh read. Restore access and run recover against the original order. |

The complete native credit and bridge journal commit together in one database transaction. WooCommerce saves the refund during tax and total calculation before its final creation hook; the transaction begins before those saves and includes the stable adjustment metadata, native order-status effects, and final refund ID. An interruption before commit rolls back that credit; an interruption after commit reopens the same completed refund. Recovery also refreshes the selected native order and child caches. Existing identifiable refund children with an unfinished journal can be recovered into that same adjustment.

The bridge supports WooCommerce's native posts and HPOS stores backed by InnoDB, including order/meta/item/permission and bridge journal tables. It checks the actual active data stores and participating tables before applying. A nontransactional table returns `REFUND_INNODB_TABLES_REQUIRED`; the store administrator should convert the participating native and bridge tables to InnoDB through the store's normal database migration process. An existing outer database transaction or a refund extension trying to control the transaction returns a specific transaction error before the credit can complete. Native refund notifications/hooks retain WooCommerce behavior. An applied mapping whose refund has subsequently disappeared or changed requires native order reconciliation.

## Read, list, and export retained work

```sh
starforge woo-refund read --config /private/woo-operator.json --adjustment UUID
starforge woo-refund read --config /private/woo-operator.json --adjustment UUID --live
starforge woo-refund history --config /private/woo-operator.json
starforge woo-refund export \
  --config /private/woo-operator.json \
  --adjustment UUID \
  --out /private/refund-handoff
```

Read, history, and export reopen the private workspace without resolving WordPress credentials. `read --live` also retains a new observation of the original order.

The operation retains the exact `adjustments.json` bytes, canonical `adjustment-request.json`, original `order-before.json`, sealed operation input, immutable server reviews, and prepare/apply/recovery outcomes. Dispatch intent is written before each POST. The export copies those files and records each file's byte count and SHA-256 in its manifest. Export to a new directory when the operation has gained further history.

Exit code 0 indicates a successful command. Apply succeeds with `APPLIED`; prepare succeeds with `PREPARED` or an already applied matching refund. Exit code 2 reports an incomplete live mutation/recovery for inspection. Exit code 1 reports an input, configuration, source-binding, or transport error.

## Receive a support handoff on another operator machine

A receiving operator can continue the same refund from the complete private export. The receiver retains the original adjustment UUID, Woo order, store URL, accounting export bytes, native return proof, reviewed currency allocation and outcome history. Its first live step is the existing recovery GET against that store.

### Send the complete original operation

Run the export command above against the selected original adjustment. Its result includes `manifestSha256`, the SHA-256 of the exact saved `manifest.json`. Keep that value with the private handover.

Transfer the entire export directory to the receiving machine, preserving each filename and byte. The manifest lists the original accounting export, canonical adjustment request, initial order snapshot, sealed input, server reviews and saved prepare/apply/recovery attempts. Use the complete export produced by the CLI or the MCP file reader. The WordPress order-view download provides a current order snapshot.

When receiving through MCP, use the original `merchant_woo_export`/`merchant_woo_export_status` result and retrieve each manifest member with `merchant_woo_file`. Keep the returned original manifest hash. Place `manifest.json` and every listed file directly in one private directory; the receiver checks its complete file set.

### Configure the receiving workspace

Use the existing operator configuration format from [NATIVE_REVIEW.md](NATIVE_REVIEW.md). Set `siteUrl` to the same store URL, including any WordPress installation prefix. Set `workspace` to the receiving operator's private state directory. Preserve the merchant's original outbox configuration for its existing payment-review workflow.

For example:

```json
{
  "schema": "stellar-forge.sf104.merchant-operator.v1",
  "siteUrl": "https://shop.example",
  "usernameEnv": "WOO_MANAGER_USER",
  "applicationPasswordEnv": "WOO_MANAGER_APPLICATION_PASSWORD",
  "outbox": "/private/original-merchant-outbox",
  "workspace": "/private/receiving-woo-operator",
  "timeoutMs": 15000
}
```

Replace the example store and paths with that merchant's actual configuration. Keep the transfer directory and operator workspace private to the current operating-system user. New receiving directories are mode 0700 and newly copied files are mode 0600. Credential values remain in the configured environment variables and are resolved when a live store operation is selected.

### Review, receive, and reopen

Replace `SHA256_FROM_EXPORT` below with the 64-character digest returned with the original export. First inspect the delivered operation:

```sh
starforge woo-refund receive \
  --config /private/receiving-woo-operator.json \
  --from /private/refund-handoff \
  --manifest-sha256 SHA256_FROM_EXPORT \
  --check
```

The `REVIEWED` result identifies the original store and order, adjustment UUID, original payment and return transactions, native atomic amount, Woo amount and currency, saved operation status, review/attempt counts, file count and byte total. The original refund engine validates the received source and history in a private staging directory.

Receive that same reviewed file set:

```sh
starforge woo-refund receive \
  --config /private/receiving-woo-operator.json \
  --from /private/refund-handoff \
  --manifest-sha256 SHA256_FROM_EXPORT

starforge woo-refund read \
  --config /private/receiving-woo-operator.json \
  --adjustment 11111111-2222-4333-8444-555555555555

starforge woo-refund history \
  --config /private/receiving-woo-operator.json
```

Use the original adjustment UUID returned by receive in the read command. `RECEIVED` names the installed original operation and the saved receipt directory. `operationStatus` is the status in the delivered history. The ordinary read command reopens its complete input, reviews and outcomes through the existing operator.

Receiving validates the exact manifest pin, schema, canonical member names, sizes and SHA-256 values. It requires regular single-link files and checks all existing target members before copying new records. The original `input.json` is installed last, after its complete source and history. The saved receipt and original manifest live under:

```text
<workspace>/refund-handoffs/<adjustment-UUID>/<manifest-SHA256>/
```

If a local copy or its response is interrupted, repeat the same receive command with the same manifest hash and directory. Matching copied records are reused. A completed receive reopens its original receipt. Receiving into a workspace with later local recovery records preserves those records; a conflicting version of a named original record requires reconciling that workspace's history. A separate private receiving workspace can open an earlier complete handoff for support review.

The receiver processes up to 2,048 files and 256 MiB in one complete handoff, with the original 32 MiB accounting-export and 4 MiB per-state-file limits. A file-set or size failure identifies the incomplete or oversized handoff before installing its original input. Keep the complete original export when resolving that result.

### Continue the same live order recovery

With the store's existing manager credentials available in the configured environment variables, read the actual order into the received operation:

```sh
starforge woo-refund recover \
  --config /private/receiving-woo-operator.json \
  --adjustment 11111111-2222-4333-8444-555555555555
```

This is the original independent GET recovery. Its new observation joins the retained history under the same adjustment UUID. Review the actual current mapping, native refund child, remaining amount and order status. The result table above explains the original PREPARED/APPLIED/reconciliation outcomes and the corresponding explicit next operation.

For a later support handover, export this received operation to a new private directory. The new manifest includes its additional recovery observations, while the original accounting source, payment and return identities remain the same. Each completed handover retains its own exact manifest hash.

SDK customers can use the same operation with their existing loaded operator configuration:

```js
import {receiveRefund} from
  '@tokenjunkielabs/starforge-merchant/merchant/woocommerce/refund-handoff';
import {inspectRefund, recoverRefund} from
  '@tokenjunkielabs/starforge-merchant/merchant/woocommerce/refunds';

const delivered = await receiveRefund(config, receivedDirectory, {
  expectedManifestSha256: originalManifestSha256,
});
const saved = await inspectRefund(config, delivered.adjustmentId);
const current = await recoverRefund(config, delivered.adjustmentId);
```

## Install the complete plugin

The portable Woo plugin contains these 16 files:

```text
starforge-sf98-woo.php
checkout-gateway.php
checkout-admission.php
checkout-basket.php
merchant-console.php
merchant-console.js
merchant-console.css
merchant-operator.php
merchant-refunds.php
merchant-refunds.js
merchant-refunds.css
refund-networks.json
OPERATIONS.md
NATIVE_REVIEW.md
REFUNDS.md
BASKET.md
```

Keep `refund-networks.json` byte-identical to the selected release's canonical `sf86-rpc-transfer-reconcile/networks.json`. The installed merchant package includes the refund CLI and its original accounting/verifier dependencies. Source consumers can import the operator through `@tokenjunkielabs/starforge-merchant/merchant/woocommerce/refunds`.
