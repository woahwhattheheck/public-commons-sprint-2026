# Stellar merchant operations in WooCommerce

The native console joins the store's original Woo order, immutable checkout
terms, payment-attempt reservation and SF98 settlement notice. Open
**WooCommerce → Stellar merchant operations** with an existing account that can
manage WooCommerce. **Stellar checkout recovery** opens the same console on the
original attempts queue. Existing menu URLs and original form handlers remain
available.

The console does not call a wallet, fund an account, send a seller payment or
release an order when a page is opened. A merchant's explicit original review
action remains the path to Woo fulfillment.

## Install the complete plugin

Keep these seven files together in `wp-content/plugins/starforge-sf98-woo/`:

- `starforge-sf98-woo.php`
- `checkout-gateway.php`
- `checkout-admission.php`
- `merchant-console.php`
- `merchant-console.js`
- `merchant-console.css`
- `OPERATIONS.md`

The maintained developer Site's **Prepare WordPress plugin** and merchant setup
packet copy this complete folder from their selected checkout or installed
toolkit. Upgrade the selected toolkit first when its source predates this
console. Copy the folder through the store's ordinary deployment process, or
zip that single folder for WordPress Upload Plugin. Keep the store's current
database, product mappings, original order metadata and private configuration.

The original plugin requires active WooCommerce, PHP 8.0 or later, and a
MySQL/MariaDB connection implementing `GET_LOCK`. Use the PHP version supported
by the installed WooCommerce release. The console uses native Woo order and
product APIs for classic storage and HPOS, plus the original plugin's own
event and attempt tables. It creates no replacement order database.

The **Setup** view shows the actual WordPress, WooCommerce and PHP versions,
current order-storage mode, original table availability, gateway setting and
configured HTTPS endpoints. It reports whether the original signing constant
is configured without exposing its value. Define `SF98_WEBHOOK_SECRET` in
`wp-config.php` from the merchant's existing private value; supply that same
value in both the original Node seller and SF98 delivery-worker environments.
A PHP-FPM environment variable alone does not define the PHP constant.

Use the original [gateway guide](GATEWAY.md) for the saved digital product,
native seller, buyer workspace, ingress and sender commands. The **Products**
view reads each current saved product mapping, labels invalid mappings with
the original validator's reason, and links to the native product editor and
nonce-protected **Download saved merchant route** action. Its base product
price and declared final checkout total are shown separately.

## Find and open the original order

The console pages through actual records instead of limiting review to the
newest notices or reservations. The selected filters remain in the page URL;
opening a native Woo order in another tab does not lose the console selection.

| Queue | Included records | Useful review |
| --- | --- | --- |
| Native checkout | Woo orders whose payment method is the original `sf104_native` gateway | Newly prepared, awaiting, closed and fulfilled checkout orders |
| All bound orders | Orders with original SF98 binding or frozen SF104 metadata | Native checkout plus compatible legacy prebound orders |
| Settlement notices | Original SF98 event rows, paged by their retained order IDs | Received, reviewing or released notices, including a notice whose Woo order was later removed |
| Payment attempts | Original SF104 reservation rows, paged by their retained order IDs | Reserved attempts and merchant-approved reset generations |

These queues overlap; their counts are not independent sales totals. The
cards count actual original notice and attempt states. **Native order ID**
looks up that precise Woo ID across managed records. A customized displayed
order number is not necessarily the native numeric ID.

Open the order for four connected views:

1. **Overview** joins current Woo status, exact decimal storefront total,
   saved native price, original attempt and notice, and the availability of
   that order's current buyer instructions.
2. **Terms and source** compares the frozen order composition with the saved
   current Woo order. It also shows the current product mapping separately
   from the original order's mapping and retains the original snapshot JSON.
3. **History and notes** shows the timestamps actually retained by the native
   order, attempt and event records, then pages through native Woo order notes.
   The console does not invent intermediate events missing from those records.
4. **Review and recovery** exposes the existing release and attempt-reset
   actions when their original saved-state preconditions are satisfied.

Amounts remain strings throughout the console and handoff. The atomic Stellar
price is not divided, rounded or converted into the store currency. Product
mapping edits apply to future orders; they cannot silently change a previously
frozen recipient, asset, amount, method, resource or storefront total.

A missing or corrupt snapshot on an actual SF104 checkout order is a review
condition. It cannot silently become a legacy prebound order. True original
manual prebindings continue to use the original compatibility path.

## Work an awaiting checkout

An unchanged unpaid native order normally has an on-hold Woo status and no
accepted notice. Open **Overview → Download current buyer instructions** to
read the original order's available generation. This is the maintained private
buyer handoff, with the existing manager/customer/order-key access checks; the
download contains no Woo order key.

The customer uses the original SF88 buyer workspace and its existing payer,
signer, approval and ledger. The handoff's shop, order and generation determine
one stable original intent. Opening the console, downloading the same
generation again or renaming its file creates no new payment identity.

A reserved, changed, closed, paid or noticed order does not offer a new buyer
download. Read its original records in the relevant review view. Do not change
the original order metadata to force a new payment attempt.

## Review an accepted notice and release once

An authenticated SF98 notice records that the original sender delivered an
event. It does not itself verify the Stellar chain or fulfill the order.
Before using **Release Woo order**, independently review the actual original
transfer: network, successful transaction, asset, recipient, atomic amount and
the order/resource to which it belongs. Enter the exact 64-hex transaction
hash and make the original review attestation.

The original release handler now joins that review under the same per-order
MySQL/MariaDB lock used by checkout, manual binding, admission and attempt reset:

1. It reloads the current original event and Woo order inside the lock.
2. For an unpaid native checkout, it validates the original frozen snapshot
   again. Saved item, quantity, total, currency, tax, discount, shipping or
   payment-binding drift prevents the new release.
3. Its original event comparison-and-set changes `RECEIVED` to `REVIEWING`
   for the submitted transaction and manager, then calls the original
   WooCommerce `payment_complete`.
4. It reads the actual saved Woo paid transaction and finishes the same
   event as `RELEASED` only when those transaction identities match.

The operation uses Woo's existing configured fulfillment and downloadable-file
behavior. The console does not replace that behavior with a status-only
simulation. Native form submissions are sent once; the UI does not retry a
release automatically.

The advisory lock serializes these original bridge handlers. Arbitrary edits
through another plugin or the normal Woo editor do not acquire it. The
snapshot check is a current saved-order precondition, not a claim that an
unrelated administrator cannot edit an order during fulfillment.

### Continue or recover an interrupted release

Refresh and reopen the same order after an interrupted response. A retained
`REVIEWING` event preserves its original transaction hash.

- If Woo is already paid by that same transaction, **Reconcile original
  release** completes the original event journal. The persisted event hash,
  submitted hash and Woo paid hash must all match. It does not call
  `payment_complete` again.
- If the original unpaid review became stale after 120 seconds, the original
  handler can return it to the received state only while holding the same
  order lock and after revalidating its current saved order. Inspect that
  result, then explicitly continue the original review.
- A different paid transaction, changed order or uncertain fulfillment stays
  visible for merchant reconciliation. Submitting another transaction cannot
  finalize an earlier reviewing transaction.

A released journal whose current Woo paid status or transaction later differs
is labelled **Released order needs review**. Historical release state is not
silently overwritten to match a later order edit.

## Reopen an independently reconciled unpaid attempt

The attempts queue retains the original reservation. Reservations do not
expire or release themselves on a timer. Recover the original buyer, seller,
outbox and transfer observation first.

If the merchant independently confirms that the exact reserved payment did
not settle, **Review and recovery** offers **Reopen original order for next
attempt** while the native order remains unpaid, unchanged and without an SF98
notice. Enter the concrete reconciliation note and the original non-settlement
attestation. The form carries the observed digest and generation; the native
reset handler compares both again.

A successful reset increments that same order's generation, retains the prior
payment digest and records the merchant's reason in the original reservation
and Woo notes. It does not rewrite the frozen product/order snapshot or call a
wallet. Download the fresh instructions from the same order and import them
into the same SF88 workspace and inbox, following [same-ledger recovery](GATEWAY.md#import-a-recovered-attempt-or-another-order-into-the-existing-workspace).
An old generation is rejected before another native verification. The buyer's
own original reservation and result must also be reconciled; merchant reset
does not clear the buyer ledger.

## Add context and hand work to another merchant operator

Use **History and notes → Private operator note** to retain concrete context
in the native Woo order under the current WordPress manager account. This is a
private order note, not a customer message. The current selected order digest
is checked before saving. If the order changed, refresh and review that current
state before submitting the note again.

Select orders in the queue and choose **Download handoff JSON** or
**Printable handoff**, or export the current detail view. Selection carries
the exact observed digest. Before materializing each record, the server
acquires that order's original lock, reloads its current order/event/attempt,
and compares the submitted observation. A changed selection returns a
conflict instead of exporting stale records. Refresh and select the intended
current state explicitly.

The export uses `stellar-forge.sf104.merchant-handoff.v1` and contains:

- The actual store origin, generation time and current WordPress manager ID.
- Per-order observation time, current saved composition, frozen native terms,
  original event and attempt state, and the derived lifecycle explanation.
- The original source/plugin version and the limits of the observation.

The export does not query or include the general Woo order-note history. It
does retain the original reservation's reset reason and attribution as part of
that attempt record. It excludes billing/contact fields, Woo order keys,
signing secrets and action URLs/nonces. It may still identify
merchant products, recipients, transaction hashes and internal order IDs, so
deliver it through the merchant's existing intended work channel.

The selected orders are read one at a time, not as a claimed frozen
multi-order database snapshot. JSON is the complete structured handoff; the
standalone HTML is readable and printable without the console or network.
Neither is a database backup, customer payment instruction or independent
chain confirmation.

## Reopen after a restart or recover the store

The console retains no separate browser database. Reopen the existing menu
and original order after restarting the web process; Woo metadata and the
original SF98/SF104 tables remain the authority. The browser remembers an
in-progress native form's selected order during its original redirect. On an
expired WordPress session or REST nonce, sign in to the existing store again
and reload; no action is replayed.

Use the store's existing WordPress/database backup to recover an installation,
including the original event and attempt tables, product and order metadata,
download configuration and private merchant settings. Preserve the original
seller outbox, buyer workspace and payer/signer through their maintained
recovery procedures. Restoring a browser handoff cannot reconstruct them.

If **Setup** cannot read an original table or the database, it reports that
condition directly. An unavailable journal is not presented as an empty
queue. The existing activation/admin initialization creates original plugin
tables when needed; correct an actual connection or installation failure
before reopening that same console.

## Maintained native interfaces

The read and handoff API is under
`/wp-json/stellar-forge/v1/merchant-console`. It uses WordPress cookie
authentication, a current `X-WP-Nonce` and `manage_woocommerce`, with no new
account store. Responses are private and non-cacheable. The original signed
seller admission and settlement endpoints, and original nonce-protected
`admin-post.php` release/reset/bind actions, keep their existing contracts.

Implementation references:

- [WooCommerce order queries](https://developer.woocommerce.com/docs/features/orders/wc-get-orders/)
  covers native pagination and the distinct HPOS/legacy metadata query hooks.
- [WooCommerce product queries](https://developer.woocommerce.com/docs/features/products/wc-get-products/)
  covers the original product-store query API.
- [WordPress REST authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
  documents the existing cookie and REST nonce flow.
- [Original gateway and buyer path](GATEWAY.md) and [SF98 receiver](README.md)
  provide the maintained payment, settlement and fulfillment procedures.
