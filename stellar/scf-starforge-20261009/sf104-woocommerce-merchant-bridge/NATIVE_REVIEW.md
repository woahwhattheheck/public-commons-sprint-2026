# Complete a WooCommerce order from its original native settlement

The merchant operator connects the existing WooCommerce order queue to the
original SF86 Stellar transfer verifier. Select one received order, retain its
exact payment and product state with the matching SF98 outbox event, verify the
original transaction, then explicitly release that order. The existing Woo
completion controller owns stock handling, download permissions, order hooks
and recovery.

The same reviewed operation remains usable after restart. A lost release reply
is resolved from the original WordPress order and journal. Saved source and
result exports can be reopened while the authoring files or store are offline.

## Install the same plugin and operator

Install the complete 16-file plugin folder from the same release, including
`merchant-operator.php`, the merchant console, native refund assets,
`checkout-basket.php` and its original basket guide.
The [complete plugin inventory](REFUNDS.md#install-the-complete-plugin) lists
every file. Both maintained installers copy that same folder. The gateway,
checkout admission, original order review and refund controls share the store's
existing WordPress and WooCommerce implementations.

The maintained distribution exposes `starforge woo-operator` and the
`@tokenjunkielabs/starforge-merchant/merchant/woocommerce` application import.
From a source checkout, replace the installed command below with:

```sh
node stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/merchant-operator-cli.mjs
```

Use the same native Stellar SDK installation as the existing merchant and SF86
verifier. The [native signer guide](../sf88-operator-buyer-cli/NATIVE_SIGNER.md)
documents the retained runtime; reconciliation uses its original official XDR
event decoder. The [network guide](../sf86-rpc-transfer-reconcile/NETWORKS.md)
defines the original testnet and pubnet observation endpoints and passphrases.

### WordPress operator account

Use an existing WordPress account with `manage_woocommerce` and an Application
Password for this operator. WordPress authenticates the HTTPS REST request,
then its normal permission callback checks the current user's capability.
These are the native [WordPress authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
and [Application Password](https://developer.wordpress.org/advanced-administration/security/application-passwords/)
facilities. The site's manager can create and manage the application credential
through the existing WordPress profile or WP-CLI workflow.

Configure the username and application password in the operator host's existing
environment. The configuration below names those variables; their values are
kept out of configuration, saved reviews, handoffs and command arguments.

Save a private `woo-operator.json`:

```json
{
  "schema": "stellar-forge.sf104.merchant-operator.v1",
  "siteUrl": "https://shop.merchant.example",
  "usernameEnv": "WOO_OPERATOR_USERNAME",
  "applicationPasswordEnv": "WOO_OPERATOR_APPLICATION_PASSWORD",
  "outbox": "/private/merchant/sf98-outbox",
  "workspace": "/private/merchant/woo-native-review",
  "timeoutMs": 15000
}
```

`siteUrl` is the exact WordPress home URL, including an installation subdirectory
when present. The original pretty-permalink and `/wp-json/` ingress setup in
[GATEWAY.md](GATEWAY.md) applies. Public requests use the original public HTTPS
transport and retain the selected origin without redirects. An explicitly
configured `allowLocal: true` also supports a `http://127.0.0.1:PORT` WordPress
development host. The normal SF86 network selection still controls the native
verification result.

The outbox is the merchant's existing private SF98 directory. Keep the review
workspace private and separate from the installation. It is created with mode
0700 and its files with mode 0600.

## Review the actual received order

First inspect the exact order selected from the existing merchant console:

```sh
npx --no-install starforge woo-operator inspect \
  --config /private/woo-operator.json --order 123
```

The response contains the existing event, payment binding, current order totals
and items, checkout-snapshot validity, and two revision hashes. WordPress hashes
the full underlying order shape locally, including address changes, while the
operator response carries only the payment and product view.

Select the original native result file for this settlement. Accepted inputs
are the existing SF81 reconciliation record, the original SF82 checkout-evidence
envelope, or the original reported native record with `intentId`, `requirement`
and `receipt`. Provide the trusted payer from that original operation.

```sh
npx --no-install starforge woo-operator review \
  --config /private/woo-operator.json \
  --id order-123-native --order 123 \
  --record /private/original-native-record.json \
  --payer GYOUR_ORIGINAL_PUBLIC_PAYER
```

Use the actual complete public payer address. The original SF86 validator checks
its Stellar checksum and binds it to the native receipt and decoded transfer.
The command joins all of the following:

| Original source | Required agreement |
| --- | --- |
| WordPress accepted notice | Same event ID, Woo order and received native event |
| Merchant SF98 outbox | Same order reference, original transaction fingerprint, route and HTTP method |
| Frozen merchant binding | Same network, atomic amount, asset digest and selected recipient digest |
| Original native record | Same exact terms, successful transaction receipt and trusted payer |
| Original SF86 verifier | Matching network passphrase, successful transaction and one exact decoded token transfer |

The source record and input snapshot are saved before RPC reconciliation. The
complete review is immutable under `order-123-native`. Repeating that same review
ID reopens the retained source and result. It keeps the original observation
instead of silently replacing it with a changed order or another transaction.

An optional `--rpc-endpoint` selects an endpoint allowed by SF86 for the exact
network. `--max-event-pages` uses the original verifier's 1–100 page range. The
result includes the actual network observation, ledger, matched transfer event
and source hashes. Reconciliation may be resumed after an interrupted read:

```sh
npx --no-install starforge woo-operator resume \
  --config /private/woo-operator.json --id order-123-native
```

A completed review is reused. A prepared review resumes against its saved
original sources and configured observation endpoint. Native verification does
not need the buyer's wallet key.

## Release that reviewed order

Read the complete saved result alongside current WordPress state:

```sh
npx --no-install starforge woo-operator show \
  --config /private/woo-operator.json --id order-123-native --live
```

The release command explicitly names the order to complete:

```sh
npx --no-install starforge woo-operator release \
  --config /private/woo-operator.json --id order-123-native \
  --confirm-order 123
```

The command requires the original verifier's matching testnet or pubnet result.
It reads current WordPress state, compares the saved payment and order identity,
and records the intended release before sending. The authenticated WordPress
route repeats the comparison under the existing order lock and calls
`Starforge_SF98_Woo::release_order`, which is the same completion controller used
by the original administrator form.

Normal WooCommerce stock, payment-completed, download and notification hooks
apply. The controller retains the original `RECEIVED → REVIEWING → RELEASED`
journal and the exact transaction hash. WordPress then records the native review
reference on that order. The CLI independently reopens the order and reports
`RELEASE_CONFIRMED` when both the Woo completion and its original review are
present.

Changes to items, amount, payment binding, checkout source or underlying order
identity produce `WOO_REVIEW_SOURCE_CHANGED`. Open the current order in the
existing console, reconcile the changed source, and author a new explicit review
ID for that changed order. The retained earlier review stays available.

## Recover a release and hand off the complete record

After a connection interruption, use `show --live` on the same review. Its saved
release attempt and original Woo state remain together. `release` with the same
review and order reads the provider before any further write. A completed
matching order is returned directly. An interrupted `REVIEWING` state follows
the original Woo recovery path with the same transaction hash. If that path
resets an unfulfilled stale review, the returned `STALE_REVIEW_RESET_RETRY`
status records the reset; repeat the same explicit release command to continue.

`RELEASE_OUTCOME_UNKNOWN` means the response and follow-up store read were both
unavailable. Reopen the same review when the store is available. Retain its
existing ID, transaction and attempt history throughout recovery.

List the saved merchant work and export one complete reviewed order:

```sh
npx --no-install starforge woo-operator history --config /private/woo-operator.json
npx --no-install starforge woo-operator export \
  --config /private/woo-operator.json --id order-123-native \
  --out /private/order-123-handoff
```

The export contains the exact saved native record, order/outbox input, native
review and recorded release attempts. Its manifest records each filename, byte
count and SHA-256. Repeating the export accepts identical existing files and
preserves conflicting destination bytes. `show`, `history` and `export` reopen
the retained work without contacting WordPress or loading its authentication
environment values.

## Refund a reviewed order

After a native return is verified in the accounting workspace, use the order's
**Refunds** tab or `starforge woo-refund` with this same operator configuration.
The [refund guide](REFUNDS.md) covers the original adjustment import, explicit
Woo credit, partial and full refunds, retained history and recovery of an
already-saved native Woo refund. The original released payment remains the
binding for every subsequent credit.

## Application and REST integration

The public application module exports `compileOperator`, `loadOperator`,
`createMerchantClient`, `reviewOrder`, `resumeReview`, `releaseOrder`,
`inspectReview`, `listReviews` and `exportReview`. The CLI is a direct consumer
of these same functions. A trusted host application can supply its existing
transport; ordinary applications use the default original HTTPS transport.

The WordPress carrier registers:

| Method and route | Operation |
| --- | --- |
| `GET /wp-json/stellar-forge/v1/merchant/orders/{order}` | Read the selected original order and revision |
| `POST /wp-json/stellar-forge/v1/merchant/orders/{order}/release` | Explicitly release or recover the reviewed order through the original controller |

The release payload contains the exact expected identity/revision, original
event/transaction, retained review hash, native transfer summary and explicit
confirmation. WordPress authorizes the manager and compares the supplied summary
to the original order. SF86 performs the independent network read in the trusted
operator process. Existing manual review, browser console, admission recovery
and original seller/delivery commands remain available in their existing guides.
