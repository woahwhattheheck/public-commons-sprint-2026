# WooCommerce merchant operations through MCP

The existing merchant MCP now operates the same SF104 Woo store used by the
merchant CLI and WordPress console. It reviews the original checkout receipt,
completes a selected order, imports verified accounting returns, records native
Woo partial or full order credits, recovers interrupted outcomes and delivers the
complete saved operation files.

The connection uses the existing merchant Application Password client. Native
payment review remains in SF86; accounting creates and verifies the canonical
adjustment; the Woo controller records the corresponding order credit. The MCP
keeps the original review IDs, adjustment UUIDs, export UUIDs, source hashes and
prepared review hashes across all of these steps.

## Connect an existing store

Install the complete 14-file SF104 plugin from the maintained setup packet,
including the refund controller and canonical network profiles. Keep the current
operator JSON used by `woo-operator` and `woo-refund`. Its schema is
`stellar-forge.sf104.merchant-operator.v1`; its outbox and private workspace
refer to the merchant's original state. See the
[native review guide](../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/NATIVE_REVIEW.md)
and [refund guide](../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/REFUNDS.md)
for that configuration.

Create a private mode-0600 connection JSON. Paths can be absolute or relative to
this connection file. Use the original actual payer in each receipt declaration;
the abbreviated address below is a placeholder to replace.

```json
{
  "schema": "stellar-forge.woocommerce-connection.v1",
  "stores": {
    "shop": {
      "label": "Existing merchant store",
      "operator": "/private/woo/operator.json",
      "records": {
        "original-order": {
          "label": "Original retained checkout",
          "file": "/private/checkout/native-record.json",
          "payer": "G...ORIGINAL_STELLAR_PAYER",
          "maxEventPages": 24
        }
      },
      "adjustments": {
        "sales": {
          "label": "Original merchant accounting exports",
          "directory": "/private/accounting/workspace/exports"
        }
      }
    }
  }
}
```

The host can declare 1–32 stores, at most 128 receipt aliases per store and at most
32 accounting export roots. Each store uses its own original operator workspace.
A receipt can declare the original verifier's optional `rpcEndpoint`; the
native verifier still validates its network profile. Callers select these aliases.
An accounting export is selected by its original UUID and resolves to
`<declared root>/<export UUID>/adjustments.json`.

Both the connection and operator configuration are private regular files.
Username and Application Password values stay in the existing environment
variables named by the operator configuration. Offline status, history and
export/file retrieval do not resolve those values. A selected live order or
refund operation creates the original authenticated client for that call.

Initialize the same merchant provider:

```sh
starforge merchant-mcp init-woocommerce \
  --dir /private/woo-mcp \
  --connection /private/woo-connection.json
starforge merchant-mcp serve \
  --config /private/woo-mcp/merchant-mcp.json
```

The first command creates a private merchant host and customer-export directory;
the existing Woo store, outbox, receipts and accounting workspaces remain their
original inputs. The second uses the existing loopback authenticated HTTP MCP
transport and host `MCP_ACCESS_TOKEN`. The existing
[stdio host configuration](STDIO.md) starts the same provider and exposes the same
tools. Supply the Woo credential environment variables through that existing
host's secure environment.

For a merchant that already has an MCP configuration, add
`"woocommerceConnection": "/private/woo-connection.json"` alongside its
current connections. Ordinary `merchant-mcp init` also accepts
`--woocommerce WOO_CONNECTION_JSON`. Current pricing, accounting,
publisher, fleet and customer-file tools remain available in that same provider.

## Review and complete an order

1. Call `merchant_woo_stores` and select the original store and receipt alias.
   `merchant_woo_store_status` returns its actual manager identity, native journal
   counts, currency, storage mode and setup readiness. `merchant_woo_queue` opens
   the original checkout, bound, notices or attempts queue with native state
   filters and page counts. Select an actual order ID from those rows, then call
   `merchant_woo_order` with its decimal string order ID. Inspect the
   current order identity, native event, binding and revision.
2. Call `merchant_woo_review_source` with the store and receipt alias. It
   returns the exact original file's `recordSha256`, trusted payer and native
   receipt/requirement summary.
3. Call `merchant_woo_review` with a stable `reviewId`, the selected order
   and `expectedRecordSha256`. The original operator binds the receipt to the
   original SF98 outbox event and authenticated Woo order, then invokes its native
   verifier. It checks the expected record hash inside that original read and also
   when reopening the first retained source.
4. Read the returned complete review identity, exact native terms, chain verdict,
   `releasable` and `sha256`. If interrupted, call
   `merchant_woo_review_resume` with the same ID. A completed retained review
   reopens directly.
5. Explicitly call `merchant_woo_release` with that review ID, its
   `expectedReviewSha256` and the exact selected order ID in
   `confirmOrder`. The original operator checks that hash against the review it
   loads for the action. Its original dispatch journal and independent readback
   establish the result.

For example, after inspecting the real original IDs and replacing the placeholder
hash with the returned 64-character digest:

```json
{
  "store": "shop",
  "reviewId": "order-18-native",
  "expectedReviewSha256": "RETURNED_REVIEW_SHA256",
  "confirmOrder": "18"
}
```

After a lost release response, use `merchant_woo_review_status` with
`live:true`. It reads the actual current Woo order alongside the same saved
review and release attempts. Reopen that observation before any further explicit
release call. Status reads preserve the native result and its original identity;
they do not replay the release.

## Import and record verified refunds

Use the existing merchant accounting adjustment tools to prepare and reconcile
the reverse transfer, then export that original accounting run. The accounting
connection's source, request/job and verification lifecycle is described in
[ACCOUNTING.md](ACCOUNTING.md). This Woo connection reads the returned export UUID
from the configured export root.

1. Call `merchant_woo_refund_source` with store, source and export UUID.
   Inspect its paged adjustment rows. Select a refund UUID and call the same tool
   with `adjustmentId` to validate and inspect that canonical verified record
   and its complete original reverse-transfer proof. Retain `sourceSha256`.
2. Call `merchant_woo_refunds` for the original order. Inspect the released
   payment identity, Woo currency, price precision, total, refunded total and
   remaining total. Existing native refund children and saved mappings have
   separate selectable views.
3. Call `merchant_woo_refund_prepare` with that source/export UUID, adjustment
   UUID, order, `expectedSourceSha256`, explicit `wooAmount` string and
   `currency`. The original operator checks the hash of the exact export
   bytes it reads and the actual currency of the order before preparing.
4. Inspect the returned `adjustment`, including native amount, Woo amount,
   currency and `reviewSha256`. `PREPARED` represents the retained
   server-side review; a native Woo refund child has not yet been created.
5. Explicitly call `merchant_woo_refund_apply` with the original adjustment
   UUID, the prepared `expectedReviewSha256` and original order ID in
   `confirmOrder`. The original operator compares that selected hash with
   the current saved mapping inside its apply operation. A changed review requires
   a new inspection and explicit decision.

The native atomic amount and Woo currency amount are separate reviewed values.
No foreign-exchange rate is inferred from them. The operator and controller bind
the original event, order reference digest, original transaction fingerprint,
route, method, network, asset, recipient and verified reverse transfer.

Different partial refunds have different original adjustment UUIDs. The original
controller checks the cumulative native and Woo allocations. The same adjustment
UUID recovers the same order credit. A completed native child and its stable
metadata are reused by the original controller.

The native Woo operation is an **order credit**. It records the refund with
`refund_payment:false`, `restock_items:false` and no line-item
allocation. The reverse transfer has already been supplied and verified through
the accounting workflow. Merchants use Woo's existing item workflow for returns
or stock changes. A full refunded order status can block download access even
though the download permission records remain; the snapshot includes
`downloadsPermitted`.

### Recover the same operation

`merchant_woo_refund_recover` performs an independent GET of the original
order and saves that observed outcome in the same refund directory. It sends no
POST. Use it after an interrupted prepare or apply, then inspect the exact
returned mapping and native child.

| Native outcome | Existing operation |
|---|---|
| `PREPARED` | Review the saved amount and hash, then explicitly apply. |
| `APPLYING` | Reopen current order/refund state before explicitly reconciling the same ID. |
| `REFUND_SAVED_JOURNAL_PENDING` | The native child is present; explicit same-ID apply repairs its original mapping. |
| `APPLIED` | The actual refund child and saved mapping agree. Retrieve its original export. |
| `REFUND_RECONCILIATION_REQUIRED` | Inspect the mismatched/missing native child and original mapping; the operator does not create a replacement. |
| `PREPARE_OUTCOME_UNKNOWN` or `APPLY_OUTCOME_UNKNOWN` | Recover the original saved operation by independent read before another explicit action. |

`merchant_woo_refund_status` is the offline saved-input/review/outcome read.
`merchant_woo_history` lists original review or refund IDs. These interfaces
return compact status pages; the export preserves the complete original source,
native proof, saved review and every outcome record.

## Retrieve a complete original handoff

Call `merchant_woo_export` with store, kind (`review` or
`refund`), original operation `id` and a stable new `exportId`.
That last ID names this particular saved-state export, for example
`refund-18-first-credit`; it is distinct from the accounting export UUID.

The original exporter writes under the host's customer-export root and returns
the complete original manifest plus `manifestSha256`. Reusing that ID is
valid for the same exact saved file set. If subsequent recovery adds outcomes,
select another export ID for the later state.

After an interrupted response, call `merchant_woo_export_status` with the
same selectors. It checks the original manifest and each saved file's size and
SHA256. An incomplete export can be completed by the same explicit export call
while its original source remains in that saved state.

For each manifest file, call `merchant_woo_file` with the same selectors,
its name and `expectedManifestSha256`. It returns a read ID, exact file
SHA256, byte offset, base64 data and next offset. Continue with the same
`readId`, `expectedSha256` and returned `nextOffset`. A final null
offset completes that file. The manifest itself is available as
`file:"manifest.json"`. Use its returned digest to verify those exact bytes.

The shared reader verifies original bytes and retains at most four temporary file
snapshots within its 256 MB budget, with at most 196,608 raw bytes per chunk.
Completed or idle reads release automatically. After restart or expiry, reopen
the same manifest/file digest at the desired offset; this retrieves the original
export again. `merchant_woo_file_release` explicitly releases a selected
temporary read. Provider shutdown drains active Woo operations and closes these
temporary readers.

## Reopen the handoff on the receiving operator

Place the original manifest and every listed payload directly in one private
directory after verifying their returned hashes. The receiving command imports
that exact operation into the receiving operator's configured workspace:

```sh
starforge woo-refund receive \
  --config /private/receiving-operator.json \
  --from /private/downloaded-refund \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --check

starforge woo-refund receive \
  --config /private/receiving-operator.json \
  --from /private/downloaded-refund \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256
```

The receiving configuration uses the same store URL and existing credential
environment references, with its own private workspace. The command validates
the original accounting source, sealed input, reviews and history through the
same refund operator before installing its input. A repeated receive after an
interrupted copy or lost response reopens the same saved receiving receipt.
Existing later recovery records remain available.

Use `starforge woo-refund read` and `history` to reopen the received
operation offline. The receiving operator's next live step is the original
`recover` command against the same adjustment UUID and Woo store. Its
observation joins that operation's history. A subsequent export to a new
directory carries the additional outcome.

The SDK entry
`@tokenjunkielabs/starforge-merchant/merchant/woocommerce/refund-handoff`
exports `receiveRefund(config, directory, {expectedManifestSha256})`.
See [the complete receiving guide](../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/REFUNDS.md#receive-a-support-handoff-on-another-operator-machine)
for the private configuration, original file limits and recovery details.

## Tool reference

| Tool | Inputs beyond the store alias |
|---|---|
| `merchant_woo_stores` | Optional store. |
| `merchant_woo_store_status` | Store alias. |
| `merchant_woo_queue` | Optional native scope, page, limit, state, sort and exact order ID. |
| `merchant_woo_order` | Decimal string order. |
| `merchant_woo_review_source` | Declared receipt source. |
| `merchant_woo_review` | Source, review ID, order, expected record SHA256. |
| `merchant_woo_review_resume` | Original review ID. |
| `merchant_woo_review_status` | Review ID, optional live read and page selectors. |
| `merchant_woo_release` | Review ID, expected review SHA256, confirmOrder. |
| `merchant_woo_refunds` | Order, optional refunds/adjustments view and page selectors. |
| `merchant_woo_refund_source` | Source, original accounting export UUID, optional adjustment UUID and page selectors. |
| `merchant_woo_refund_prepare` | Source, accounting export UUID, adjustment UUID, order, expected source SHA256, Woo amount, currency. |
| `merchant_woo_refund_apply` | Adjustment UUID, expected prepared review SHA256, confirmOrder. |
| `merchant_woo_refund_recover` | Original adjustment UUID. |
| `merchant_woo_refund_status` | Original adjustment UUID and optional page selectors. |
| `merchant_woo_history` | Review/refund kind and optional page selectors. |
| `merchant_woo_export` | Kind, operation ID, stable new export ID. |
| `merchant_woo_export_status` | Same saved export selectors. |
| `merchant_woo_file` | Export selectors, file, manifest SHA256; optional read ID, file SHA256, byte offset and chunk limit. |
| `merchant_woo_file_release` | Original file read ID. |

The live native queue returns its actual `total`, `pages`, `page` and `nextPage`.
Pages start at 1; repeat scope/state/sort/limit when continuing. An exact order-ID
lookup uses page 1. Each page retains its native observation time; a changing
store can change its queue between requests.

Retained row lists return `total`, `nextOffset` and `snapshotSha256`.
The default page has 25 rows and the maximum is 100. Repeat
`expectedSnapshotSha256` with later offsets; if original rows changed, the
tool returns `WOO_MCP_PAGE_CHANGED` so the caller can reopen the first page.
This keeps one multi-page read tied to the same selected original rows.

Configuration and input errors occur before the corresponding original
operation. Live authentication refusals, source/review conflicts, canonical
verification errors, unknown writes and native recovery states retain their
original codes. Every explicit release, prepare and apply uses the original
single-dispatch/readback behavior. An MCP client should recover an interrupted
original operation instead of automatically replaying a mutation.
