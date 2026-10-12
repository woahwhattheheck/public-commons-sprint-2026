# CoCart customer integration and receiving workspace

This application connects a named CoCart guest cart to the existing WooCommerce
checkout and Stellar Forge buyer/merchant operation. It supplies a local
developer workspace, a browser interface, a complete CLI, native response
retention and a receiving export that reopens the same customer work.

The current source profile selects CoCart Community 4.9.7 and the official
TypeScript/JavaScript SDK 1.2.1. The actual package declares Node 22 or later.
The integration uses that SDK's normal v2 request path with retries disabled
and conditional response caching disabled. Each saved customer cart receives
its own SDK instance and isolated memory storage.

## Start from the merchant's saved product

The existing [gateway guide](../GATEWAY.md) explains the selected simple,
virtual Woo product and its original Stellar mapping. Complete those saved
merchant fields first: exact final store total/currency, seller resource and
route, method, network, asset, receiving account, atomic amount and timeout.

Install **profile-export.php** as a separate WordPress plugin file, for example
**wp-content/plugins/starforge-cocart-profile.php**, and activate it alongside
the original Stellar Forge, WooCommerce and CoCart plugins. On the mapped
product's General settings, **Download saved headless profile** downloads the
current profile. This uses the original SF104 product mapping and route
declaration. The download requires the current WordPress nonce,
'manage_woocommerce' and permission to edit the selected product.

The saved route declaration contains native terms and the product ID. It
does not include the Woo storefront total or mapping approval fields.
The profile exporter joins the actual stored mapping, avoiding a manual price
conversion or reconstruction of those fields. It records the actual PHP,
WordPress, WooCommerce and CoCart versions with its export time.

Use the installed original SDK distribution, or the selected package already
available in the application's runtime:

~~~sh
node server.mjs create \
  --root /private/cocart-customer \
  --profile /private/stellar-cocart-product-profile.json \
  --sdk /installed/cocart-sdk/dist/index.js

node server.mjs serve \
  --root /private/cocart-customer \
  --sdk /installed/cocart-sdk/dist/index.js
~~~

The server prints its actual loopback URL. Open that URL to use the retained
workspace. **Refresh workspace** rereads its current local revision;
**Refresh native cart** calls the actual selected store.

The production profile uses the same HTTPS API and checkout origin. Keep the
native profile file unchanged when operating a separately received local site.
For this explicit local setup, save a separate receiving-transport JSON file
with only 'store_url', 'checkout_url' and a short 'reason'. Both URLs name the
actual loopback Woo server and its real checkout path. Then create with:

~~~sh
node server.mjs create \
  --root /private/cocart-receiver \
  --profile /private/stellar-cocart-product-profile.json \
  --receiving-transport /private/actual-local-transport.json \
  --sdk /installed/cocart-sdk/dist/index.js
~~~

The application retains the exact original profile bytes before applying the
selected transport. It records the source URLs, actual receiving URLs and
operator reason in 'transport.receiving_selected'; the original merchant
origin, product mapping and payment terms retain their source values. Only a
loopback receiving host is accepted. The browser opens the configured native
checkout for that receiver. The same local workspace can later use its
'transport.rebind' action to record a changed receiving port or checkout URL.

The application constructor accepts the same selection as
'receivingTransport: {store_url, checkout_url, reason}' alongside the original
'profile' object and exact 'profileBytes' Buffer. The original profile and
bytes must agree. Receiving exports include that original profile object as
well as the separate selected transport history.

## Ordinary customer workflow

1. Create a named customer cart, or attach its existing opaque guest cart key.
   The original body and cart-key header must agree. Each customer retains its
   own session and native snapshots.
2. Load the selected store's catalog, using native search and page controls.
   Add an actual Woo product. Set its quantity, remove it, restore a removed
   line, or recalculate the native totals.
3. Inspect the current currency and total. All stored cart totals are the
   original minor-unit integer strings. The interface formats them using the
   currency precision returned by the same native response.
4. Select **Replace** or **Merge** for the existing web cart and prepare
   checkout. The application rereads the cart, records the selected mode and
   compares it with the merchant's saved Stellar mapping.
5. Open the actual Woo checkout. Woo collects or confirms customer details,
   applies its payment methods and performs the original live order admission.
   The completed order supplies its actual handoff JSON.
6. Receive that original handoff under the corresponding cart preview.
   The maintained '../buyer.mjs' validator checks its schema and native
   order/attempt/operation contract. This application compares the actual
   store, product, route, total and native terms with the selected preview.
7. Continue through the existing [buyer](../GATEWAY.md#customer-checkout-and-native-buyer)
   and [merchant operator](../OPERATIONS.md). The downloaded original handoff
   keeps its original order ID, attempt generation and buyer intent.
8. Download a complete receiving workspace. A second operator can reopen
   its original cart snapshots, native exchanges, checkout preview and
   received Woo handoff.

The released SF104 admission selects one mapped simple virtual product at
quantity one. Its original Woo logic checks shipping, fees, discounts, the
current total and the saved product mapping again on the actual order.
The headless comparison explains discrepancies before the buyer enters checkout.
Independent frozen-basket and browser-wallet work joins through its existing
maintained source when released.

## Exact source contracts

### Guest cart identity

The Community session handler reads 'cart_key' and 'CoCart-API-Cart-Key'.
The selected SDK's 'mainPlugin: "legacy"' setting uses that original header
and v2 namespace. The adapter keeps the original returned guest key and refuses
to silently substitute a different cart.

CoCart's current source makes cart keys the API session identity. Woo browser
cookies become relevant when the native storefront loads the cart; they are
not the headless API cart identity.

### Native plugin version

The saved WordPress product profile records the selected installed CoCart version.
In the pinned Community 4.9.7 source, 'set_global_headers()' emits
'CoCart-Version' only while 'WP_DEBUG' is true. Ordinary production responses
can therefore omit that header. The application checks a returned header
against the native profile and records an explicit profile-based observation
when the header is absent. Each cart snapshot preserves the profile version,
actual header value and the source of that observation.

### Prices and totals

The selected PHP 'cocart_prepare_money_response()' returns integer strings
in the smallest currency unit. The cart controller uses that function for
its top-level totals. For example, original value "250" with precision 2
displays as 2.50; it remains "250" in the native object.

The current documentation's illustrative full-cart response includes decimal
major values such as "119.40". That illustration does not replace the
selected source contract. The adapter explicitly requires minor-unit integer
strings and reports a source mismatch if a server filter or another version
changes the representation.

All comparison arithmetic uses BigInt. The saved Woo decimal total is
converted using string digits and the returned precision; a nonzero digit
beyond that precision is rejected. Stellar atomic amounts remain a separate
merchant-approved mapping. The application performs no currency conversion.

### Web cart transfer

The selected 4.9.7 'CoCart_Load_Cart::load_cart_action()' sets:

- 'keep-cart=true': merge the guest cart with the current web cart. Existing
  web-cart entries overwrite matching item keys during that native merge.
- 'keep-cart=false': replace the current web cart with the selected guest cart.

The current documentation table describes this flag differently from the
source. The application sends an explicit value from the inspected source.
The actual native checkout remains the receiving authority, including any
store-installed filters. CoCart transfers cart data; the store checkout
handles customer details.

### Actual Woo order receiving

The application receives 'stellar-forge.sf104.checkout-handoff.v1' directly
through the original maintained validator. It retains the exact downloaded
bytes as an object and the original buyer intent
'woo:<origin-digest>:<order>:g<attempt>'. It preserves the selected native
asset, recipient, atomic amount, timeout, HTTP method and resource path.

A checkout preview is a separate
'stellar-forge.cocart.checkout-preview.v1' object. It exists before an order,
carries the actual cart snapshot and links to the later native handoff.
The actual Woo order and payment operation retain their original identities.

## Operations and interrupted requests

Ordinary Add/Update/Remove actions prepare and apply in one UI operation.
Preparation captures the current native cart and saves the exact intended
action. Immediately before dispatch the application rereads the cart.
A changed cart makes that prepared operation STALE; the operator can review
the current state and issue the intended new action.

The durable DISPATCHING state is written before the SDK request. The SDK
performs one request with 'maxRetries: 0'. Each original SDK request event,
native status, headers and raw body is retained under its content hash.
The exchange reference is saved into the workspace before its body is decoded.
This also retains a refused or invalid first-cart response, when no cart has yet
been admitted. The receiving export carries that original exchange and response
body through the 'native.exchange_retained' history event; its error identifies
the same exchange for inspection and recovery.

| State | Meaning and receiving action |
| --- | --- |
| PREPARED | The source action and baseline are saved. Continue this original operation. |
| DISPATCHING | The original request may have left the process. Read the actual cart and reconcile this operation. |
| APPLIED | A successful native response and subsequent full cart readback are retained. |
| APPLIED_REFRESH_REQUIRED | The mutation succeeded; its following cart read needs continuation. |
| NATIVE_REJECTED | The original HTTP response records a native rejection. Inspect that response. |
| UNCERTAIN | The request has no retained native response. Read the same cart before deciding its disposition. |
| STALE | The cart changed after preparation. The original mutation was not dispatched. |
| RESOLVED_CURRENT | The operator recorded an observation and accepted the current native cart. |
| RESOLVED_NOT_APPLIED | The operator recorded the original non-application observation. A deliberate new action has its own identity. |

A repeated Apply returns the same original operation. A stable client
'request_id' identifies one mutation even when its HTTP response was lost.
Changing the instructions under that identity is rejected. The browser keeps
an interrupted request in session storage and offers **Reconcile the same
request**. This retrieves the original operation or continues its original
prepared state.

A current quantity alone cannot identify who changed a shared cart. Recovery
retains the fresh native readback and the operator's specific reason.
A resolution preserves the original exchange and does not replay an uncertain
request.

The workspace has one current writer. An orderly stop releases its lock.
After a process termination, inspect the exact 'writer.lock' PID and its
original operating process before removing that stale lock. Preserve the
DISPATCHING operation and reopen the original workspace for reconciliation.

## CLI and application API

Every state-changing call takes the current workspace 'version' returned by
'view()'. The server checks that exact revision while acquiring the original
writer. Shared peer or browser changes return REVISION_CHANGED.

~~~js
import {CartWorkspace} from './workspace.mjs';
import {loadSDK, action, serve} from './server.mjs';

const sdk = await loadSDK('/installed/cocart-sdk/dist/index.js');
const workspace = new CartWorkspace({
  root: '/private/cocart-customer',
  ...sdk
});

const result = await action(workspace, 'cart.mutate', {
  cart_id: selectedCartId,
  action: 'add',
  product_id: selectedWooProductId,
  quantity: 1,
  request_id: retainedClientRequestId
}, workspace.view().version);
~~~

| Action | Payload |
| --- | --- |
| cart.create | label, optional existing cart_key |
| cart.refresh | cart_id |
| catalog.load | search, page, per_page |
| cart.mutate / cart.prepare | cart_id, action, stable request_id; product/item ID and quantity for the selected action |
| cart.apply | cart_id, operation_id |
| cart.reconcile | cart_id, operation_id, decision, reason |
| checkout.prepare | cart_id, explicit mode: replace or merge |
| woo.attach | cart_id, preview_id, exact original JSON as content_base64 |
| transport.rebind | Local receiving store_url, checkout_url, reason |

The cart mutation action supports add, quantity, remove, restore, calculate
and clear. The SDK's multi-add endpoint is a grouped-product operation;
this adapter uses the actual single-item endpoints and preserves each
request's identity.

For an operator JSON file containing action, payload and version:

~~~sh
node server.mjs act --root /private/cocart-customer \
  --input /private/original-action.json \
  --sdk /installed/cocart-sdk/dist/index.js

node server.mjs show --root /private/cocart-customer
~~~

The local server exposes GET /api/workspace, exact object downloads,
GET /api/receiving, and POST /api/action. It binds only to loopback,
checks the actual host and same-origin action token, and keeps native
responses out of external browser resources.

## Receive and reopen the complete workspace

~~~sh
node server.mjs export \
  --root /private/cocart-customer \
  --out /private/CoCart_Receiving_Workspace.json

node server.mjs receive \
  --root /private/cocart-received \
  --input /private/CoCart_Receiving_Workspace.json

node server.mjs show --root /private/cocart-received
~~~

The export contains the original workspace and complete reachable object
closure: original store-profile bytes when supplied, native cart/catalog
responses, exchange envelopes and exact Woo handoff bytes. It preserves the
saved workspace revision and every selected SHA-256 and byte count.

Receiving validates the complete input before publishing its manifest.
If interrupted while writing an object, continue with the same input and
destination. The receiving marker identifies that exact original export;
previously completed matching objects are reused. A completed receive reopens
the existing workspace and preserves subsequent edits.

The receiving workspace includes guest cart keys and any native customer
fields returned by the selected store. Keep its complete export in the
customer's private receiving channel, alongside the existing merchant
delivery. Distribute the source application and public version references
separately.

## Source references and native operation

- [CoCart Community 4.9.7 source](https://github.com/cocart-headless/cocart-community/tree/6a3a613936c1abc1d5d8b78cc920d862b1ae542d)
- [Original session and load-cart implementation](https://github.com/cocart-headless/cocart-community/blob/6a3a613936c1abc1d5d8b78cc920d862b1ae542d/includes/classes/class-cocart-session.php)
- [Original money conversion](https://github.com/cocart-headless/cocart-community/blob/6a3a613936c1abc1d5d8b78cc920d862b1ae542d/includes/cocart-rest-functions.php)
- [Original version-header condition](https://github.com/cocart-headless/cocart-community/blob/6a3a613936c1abc1d5d8b78cc920d862b1ae542d/includes/classes/rest-api/class-cocart-rest-api.php)
- [Original v2 cart controller](https://github.com/cocart-headless/cocart-community/blob/6a3a613936c1abc1d5d8b78cc920d862b1ae542d/includes/classes/rest-api/controllers/v2/cart/class-cocart-cart-controller.php)
- [Official SDK 1.2.1 source](https://github.com/cocart-headless/cocart-js/tree/936a77b52f355654b4bdd165317caec00146924e)
- [SDK package and runtime contract](https://github.com/cocart-headless/cocart-js/blob/936a77b52f355654b4bdd165317caec00146924e/package.json)
- [Load Cart documentation](https://docs.cocartapi.com/documentation/load-cart)
- [Core v4 session changes](https://docs.cocartapi.com/breaking-changes/core-v4)
- [Existing native Woo buyer and gateway](../GATEWAY.md)
- [Existing payment, refund and customer receiving](../OPERATIONS.md)

The joined native operation uses a separate cold WordPress/Woo database,
the selected original CoCart plugin, the original SDK and this application.
Retain its actual site versions, cart/order IDs, request outcomes, browser actions,
checkout handoff and final receiving archive in the original CoCart commercial case. Use those operating results to select the customer
deployment and its final receiving scope.
