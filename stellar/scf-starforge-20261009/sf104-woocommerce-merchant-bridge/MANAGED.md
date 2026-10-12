# Managed WooCommerce merchant

Run the original Woo seller and its original SF98 settlement-notice worker as one retained application. Applications supplies the existing process controller and history. The seller, buyer, outbox, WordPress order records, refund engine and release decisions remain the original implementations.

The managed application opens the original seller Operations dashboard and fulfillment journal. Its **WordPress order console** link opens the actual configured store, where an authorized Woo manager reviews frozen terms, reset attestations, settlement notices, independent transaction review, release and refunds.

## Required original inputs

Use a READY merchant runtime that contains the installed `woo-managed` command and its native x402 dependencies. The Applications review verifies that the selected installed source contains the command; an older installed package is not upgraded by opening the menu.

Prepare or reuse the original [Woo setup packet](GATEWAY.md). Its `merchant.json` retains the exact exported routes, optional retained basket catalogs, WordPress admission endpoint and absolute original outbox. Keep the older catalog versions for pending orders. Applications does not recalculate prices, edit WordPress product settings, or replace the buyer inbox.

The same private secret must be configured in three original places:

- WordPress reads the PHP constant `SF98_WEBHOOK_SECRET` from its existing `wp-config.php`. An environment variable alone is insufficient unless that file explicitly defines the constant from it.
- The merchant config names the Node environment variable in `secretEnv` (default `SF98_WEBHOOK_SECRET`).
- This managed process passes that same value to the original seller and original delivery worker.

Use the existing Applications **Private environment JSON** selector if the host environment does not already contain the secret. That file must be private and contain environment names with string values. The review and startup expose the name, never its value. WordPress application-password bindings used by the separate merchant operator or MCP stay in their original private configuration; this service does not need or copy them.

Select the merchant's existing native facilitator. Public deployment uses its credential-free HTTPS URL. The explicit local-development option permits only HTTP at `127.0.0.1`; it does not describe a public-chain transaction or a funded wallet.

## Start, operate and reopen

1. In the existing runtime workspace, select **Applications → New application → WooCommerce merchant**. Choose the original READY runtime, merchant configuration, facilitator and private environment file if needed.
2. Set **Seller ingress port** to the loopback port used by the merchant's existing HTTPS ingress. A value of zero asks the original server for an available port; the actual assignment appears only after startup. **Local port** is the private Operations dashboard port.
3. **Review application** shows the actual store, outbox, notice endpoint, named secret binding and retained route/catalog counts. Save that review and finish the original runtime connection if it has not yet been adopted.
4. **Review start → Start reviewed application** retains the current configuration and executable source identities, outbox resource identity, selected environment and the current Applications origin.
5. Open the original Operations dashboard after the actual startup announcement. **Original fulfillment** opens its native delivery journal and controls. **WordPress order console** opens the configured store's original order/terms/refund interface.
6. **Stop application** stops accepting new seller requests, waits for the original in-flight verification/settlement lifecycle, and only then aborts and awaits the same delivery worker. A last retained notice can remain pending; the original worker resumes its journal when you start the same application again.
7. Review a new start to reopen the same merchant configuration and outbox. Previous process IDs, startup URLs, source identities and terminal outcomes remain attached to their original Applications operations.

Opening or refreshing Applications does not start the service. Starting it can deliver already-pending notices through the original worker. A successful notice acknowledges the original event; it does not itself mark a Woo order paid. Independent merchant transaction review and release remain in WordPress.

The original Operations server allows only the explicitly recorded Applications origin to open its HTML through a user navigation. Woo links send that origin as their referrer; every other application keeps its existing policy. API calls keep the native same-origin restrictions. If the runtime workspace is reopened on a different port while a Woo service remains running, use its recorded local Operations address directly, or stop and review a new start from the current workspace before using the managed Open link.

## One outbox, one original delivery owner

The original SF98 Linux `flock` lease remains the exclusive delivery owner. Managed startup obtains that lease through `runWorker`; it does not pre-acquire a second lease or run a second delivery implementation. Its readiness callback occurs after lease acquisition and before the first drain.

Under that lease, the first managed start creates `woo-managed-binding.json` in the original private outbox. It binds the store, admission endpoint, notice destination and exact outbox path. Later route/catalog revisions and facilitator selections may change through reviewed configuration, while this store binding remains fixed. A different store or destination fails before delivery. Keep each merchant's correct original outbox with that merchant; changing a store identity is a separate deliberate migration of its original records.

The managed resource key also derives from the canonical outbox directory. Two Applications configurations pointing to the same outbox cannot start independent managed operations. A standalone original delivery worker is additionally excluded by the same kernel lease. The lock automatically releases when its original process closes or dies; its saved metadata is not a timer-based permission to unlink a live owner.

If the worker fails, the controller closes and drains the original seller, awaits delivery termination, records a failed outcome and exits. It does not leave the seller admitting orders with a dead delivery worker or silently relaunch a payment.

The private `woo-managed-launch.json` records the latest actual launch, source/configuration identity, original worker owner and assigned listeners. It contains no signing keys, order keys, payment headers, WordPress application passwords or webhook secret. Applications retains each launch in its existing operation history.

## Original CLI

The same maintained entrypoint is usable without the Applications browser:

```sh
starforge woo-managed inspect \
  --config /private/woo/merchant.json \
  --facilitator https://facilitator.example

starforge woo-managed serve \
  --config /private/woo/merchant.json \
  --facilitator https://facilitator.example \
  --seller-port 8423 --port 8424

starforge woo-managed status \
  --config /private/woo/merchant.json \
  --facilitator https://facilitator.example
```

The source checkout equivalent is `node sf104-woocommerce-merchant-bridge/managed.mjs` with the same arguments. `inspect` reads the original config/source and creates no payment or network request. `serve` uses the original native factory and SF98 worker. Its explicit delivery controls are `--poll-ms`, `--delivery-limit`, `--delivery-concurrency` and `--delivery-timeout-ms`, using the original worker defaults and bounds.

Applications supplies `--expected-config-sha256`, `--expected-source-sha256` and `--expected-selection-sha256` from its review. It also supplies the reviewed `--operations-navigation-origin` for the original Operations HTML navigation. These bind the saved start to the selected source and inputs.

## Operator recovery

| Observation | Original continuation |
| --- | --- |
| `SF98_DELIVERY_BUSY` | Reopen the recorded original Applications operation or standalone worker. Stop that owner through its existing controller before starting this one. |
| Configuration or source changed since review | Review the actual current configuration/runtime, then start that saved revision. No old native attempt is replayed. |
| Store/outbox binding changed | Select the correct original merchant/outbox pair. Preserve the existing journal and binding with its original store. |
| Seller startup fails after the worker obtained its lease | The controller stops and awaits that worker. Its actual delivery attempts remain in the original journal; inspect them before another start. |
| Seller is stopped with pending notices | Reopen the same outbox. The original worker continues its due notices with their original event IDs and attempt history. |
| Notice attempts are exhausted | Use the original SF98 review/requeue workflow. Stop the managed application first so the original requeue command can acquire its own exclusive delivery lease; then restart the same application. |
| An order remains reserved after non-settlement or an uncertain result | Use the original WordPress order review and explicit reset/release procedure. Managed restart does not erase or replace that reservation. |
| An interrupted Applications response leaves the start uncertain | Reopen or reconcile the original request through Applications. Its saved request ID, worker record and actual startup remain authoritative. |

For a receiving host, preserve the original merchant configuration, complete outbox (including its binding and worker journals), original WordPress database/plugin configuration, selected runtime source/manifest and private environment through their existing private recovery paths. Keep the original absolute paths when restoring this managed case. Do not copy only a dashboard URL or a plaintext secret into a public package.

A complete service-lifecycle receiving can reuse an already completed order and outbox without creating another payment. Record its actual source/runtime, reviewed selection, worker lease, startup, Operations navigation, Stop/drain and same-outbox reopen. Any controlled facilitator or local WordPress transport remains explicitly identified in that outcome.
