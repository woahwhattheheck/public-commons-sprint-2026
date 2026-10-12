# Woo catalog versions in the original seller

The catalog commissioning workflow exports a merchant v3 configuration that keeps
current product mappings and the exact earlier versions needed by unpaid orders.
The seller reads the original order's frozen handoff and selects one of those
retained versions before entering the existing SF30 admission, verification,
reservation, settlement and SF98 delivery flow.

Deploy this seller with the original Woo catalog application, which adds the
signed, read-only WordPress catalog-order endpoint. The existing v1 fixed-product
and v2 basket configurations continue through their original service paths.

## Commission and run

Use the catalog application's complete merchant handoff when applying an edition.
It includes the original shop/admission URL and the current and retained mappings.
Keep the same outbox and private SF98 secret used by the existing managed seller.

For a manually prepared configuration, the original seller CLI also supports:

~~~sh
node seller.mjs prepare --versioned \
  --route /private/current-product.json \
  --route-version /private/earlier-product.json \
  --basket /private/earlier-basket-catalog.json \
  --basket /private/current-basket-catalog.json \
  --store-origin https://shop.example \
  --admission-url https://shop.example/store/wp-json/stellar-forge/v1/checkout-admission \
  --outbox /private/sf98-outbox \
  --out /private/woo-merchant.json

node seller.mjs inspect --config /private/woo-merchant.json

node managed.mjs inspect \
  --config /private/woo-merchant.json \
  --facilitator https://facilitator.example

node managed.mjs serve \
  --config /private/woo-merchant.json \
  --facilitator https://facilitator.example
~~~

Repeat route-version and basket options for retained versions. The manual prepare
command also selects v3 when at least one route-version is supplied. Current route
declarations are included in the compiled version set automatically. A configuration
may serve retained unpaid orders after the current route list becomes empty.

The managed launcher still owns one original seller and one original SF98 worker.
Its source identity includes the complete seller/version/basket import closure;
its configuration identity includes all retained terms. The WordPress subdirectory
is preserved when deriving both the new lookup URL and the existing settlement URL.

## Configuration

The schema is stellar-forge.sf104.merchant.v3. Original storeOrigin, admissionUrl,
secretEnv, outbox and timeoutMs fields retain their existing meaning.

| Field | Meaning |
| --- | --- |
| routes | Current original product route declarations, up to 64 |
| routeVersions | Retained original product route declarations; current routes are also included when compiling |
| baskets | Complete original basket catalogs for current and earlier editions |

There are at most 256 distinct fixed-product versions and 256 supplied basket
catalogs. The complete UTF-8 merchant configuration is limited to 16 MiB in the
compiler, seller CLI and managed launcher. Per-file source readers keep their
existing smaller bounds.

Product versions include product ID, route ID, canonical resource URL, method and
all exact payment terms. Description changes do not change the version. Identical
versions are deduplicated. Basket catalogs retain their original canonical digest
and full catalog validation.

Earlier and current baskets may use different route IDs, paths and methods.
All fixed and basket endpoints remain on one seller origin. Selection uses the
actual order handoff, so a fixed-product version and basket can share a path
without combining their offers or amounts.

## Original order lookup and selection

The seller sends one HMAC-authenticated POST to the original WordPress base path
plus /wp-json/stellar-forge/v1/catalog-order. Its exact JSON body contains only:

~~~json
{
  "schema": "stellar-forge.sf104.catalog-order-request.v1",
  "orderReference": "123",
  "attemptGeneration": 1
}
~~~

The existing timestamp and SF98 HMAC format authenticate the exact body. Incoming
customer payment headers are not forwarded to WordPress. The catalog application
checks the same original order lock, fresh unpaid status, snapshot, payment
gateway, attempt generation and reservation state before returning a READY result.

The response carries the original order/generation, snapshot SHA256, handoff and
either an original route declaration or complete original basket catalog. The
seller validates the existing handoff schema and exact incoming method, path,
query and order header. The returned route/catalog must match a configured
version; a store response cannot introduce an unconfigured price, recipient,
network or endpoint.

After selection, fixed-product versions use the original createWooApplication
handlers and compiled SF30 offer. Baskets use the original basket quote compiler.
The original signed checkout-admission endpoint still performs inspect/reserve,
the original native engine still verifies and settles, and the original outbox
still records delivery. This read-only lookup cannot release an order, reset an
attempt or perform a payment.

## Concurrent requests and recovery

Every incoming order request makes a fresh original order lookup. A cache shares
the initialized original handler only for the same order, attempt generation,
handoff type, configured version and snapshot hash. The cache retains at most
128 entries and retires only entries whose complete handler promises have
finished and have no users.

An HTTP response finishing or a client disconnecting does not retire a native
operation still performing verification or settlement. Closing the service uses
the original seller lifecycle and waits for its drain before clearing the cache.
Merchant reconciliation and original audited attempt resets keep their existing
semantics.

The existing readiness and operations interfaces remain available. Seller health
reports retained-version counts, endpoint counts, live cache use and order-lookup
counts. The public offers endpoint contains current fixed-product offers; an
exact basket offer is constructed only from its selected frozen order.

## Availability responses

| Condition | HTTP result |
| --- | --- |
| Unknown resource path | 404 |
| Method absent from the retained endpoint set | 405 |
| Unavailable order/generation or absent/mismatched configured version | 409 |
| Lookup authentication, service, malformed protocol or initialization failure | 503 |

A 401 from the private catalog lookup is a seller/store authentication problem
and becomes a service-unavailable result. It is not reported as an expired order.
A lookup response is limited to 2 MiB. Existing legacy admission and basket
callers retain their previous status handling and response limits.

The new source module is versioned-seller.mjs. Packages with explicit source lists
must include it alongside seller.mjs, buyer.mjs, basket.mjs, basket-seller.mjs and
managed.mjs. Whole-directory original SCF source packaging already retains these
files together.
