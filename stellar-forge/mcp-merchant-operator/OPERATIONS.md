# Operate merchant discovery and caching through MCP

The existing merchant MCP service can run a release, publish its signed offers
into the live catalog, update those listings, withdraw a retired route, and
operate the running seller's shared cache. The same tools are available through
its authenticated HTTP endpoint and existing subprocess MCP entrypoint.

## Connect the merchant's catalog

Prepare the original catalog connection described in the
[SF82 publication guide](../../stellar/scf-starforge-20261009/sf82-seller-pilot/CATALOG.md).
It points to the merchant's existing catalog directory, approved seller ID,
public export URL and private Ed25519 key file. The key remains on the merchant
host and must match the original catalog policy.

When initializing a merchant from a saved API package, add that connection:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init \
  --dir /private/my-merchant \
  --workspace /private/saved-api-package \
  --catalog /private/catalog-connection.json
~~~

The same `--catalog` option works with the original OpenAPI file inputs. An
existing `merchant-mcp.json` can include this optional field:

~~~json
"catalogConnection": "../catalog-connection.json"
~~~

Relative paths resolve beside the merchant host configuration; paths inside the
catalog connection resolve beside that connection file. Restart the MCP host
after changing its configuration. Initialization reads and validates references
without opening the signing key or contacting the live catalog. A host without
this optional connection retains its existing merchant workflow and reports
`operator.discovery.configured: false` in `merchant_status`.

MCP callers supply release and route IDs. The host selects the catalog directory,
seller, source URL and key file. Their private paths and key bytes never appear
in discovery tool results. The existing [stdio guide](./STDIO.md) and generated
client registration remain the entrypoints for agent hosts.

## Publish and maintain a release

Stage, inspect, compare, activate and start the release using the existing
[operator workflow](./README.md#complete-operator-workflow). Then use:

| Tool | Arguments | Result |
| --- | --- | --- |
| `merchant_discovery_status` | `id` | Exact retained/current offers, source URLs, sequences, seller pin, catalog head, and this host's pending review/last apply |
| `merchant_discovery_review` | `id`; optional `action: "publish"` | This host's latest exact publication review and its `id` |
| `merchant_discovery_apply` | `reviewId` from that review | Original signed batch receipt, signature count and current listing readback |

Read the returned `changes` before applying. Each row contains current and
proposed payment terms, including every asset alternative, the public source
reference and next sequence. The review binds the original release digest,
running instance, source bytes, URL, catalog head and configured seller policy.
Review issues no signature and does not open the private key. Apply signs every
alternative with the original SF50 implementation and submits the original
SF60 batch. An exact match returns `UNCHANGED` with zero signatures and writes.

After upgrading the original running release, review and apply its revised
offers in the same way. Changing the public export URL is also an explicit
revision, even when the offer bytes are unchanged. Publication remains a
separate operation from selecting or restarting a seller.

To retire a route, review the retained release containing it:

~~~json
{
  "id": "old-release",
  "action": "withdraw",
  "routeId": "retired-route",
  "reason": "This API operation has been retired"
}
~~~

Apply that returned review ID with `merchant_discovery_apply`. The original
SF95 withdrawal verifies the current listing, seller, signer, next sequence and
journal head. The selected listing leaves discovery while its original history
and other listings remain available. A newer merchant release can keep running
while the old route is withdrawn.

`merchant_catalog` continues to read the owned seller's current HTTP health,
offers and OpenAPI. `merchant_discovery_status` reads the signed registry and
its durable lifecycle history. Both preserve the original exact payment terms.

## Resume after a failed or interrupted response

An apply consumes the host's pending review before sending its original command.
Another apply requires a fresh review. If the MCP response is interrupted,
read `merchant_status` and `merchant_discovery_status` for the release. The
host's `lastApply` retains its returned phase and receipt, or the original
error code and transport facts. An error response and an observed listing are
reported separately.

After an MCP host restart, in-memory review/last-apply state is empty. The
original catalog journal still holds committed listings and history. Discovery
status reads that record; a fresh publication review skips matching offers.
Catalog restart is handled through the same existing connection directory and
its current private transport descriptor. There is no background publisher,
automatic command retry or second publication database.

## Operate the running shared cache

`merchant_cache_status` takes no arguments. It returns the original running
instance, configured route policies, occupancy and upstream counters. OAuth
bindings include the original credential-free lifecycle counters. Cache bodies,
private control tokens and credential values stay inside the existing runtime.

To invalidate one cached route, use the current MCP-owned instance ID:

~~~json
{ "instanceId": "RETURNED_INSTANCE_UUID", "routeId": "dataset" }
~~~

To invalidate every configured cache on that owned instance:

~~~json
{ "instanceId": "RETURNED_INSTANCE_UUID", "all": true }
~~~

Pass one of these objects to `merchant_cache_invalidate`. An omitted selection,
both selections, an old instance or another process's seller is rejected. A
release upgrade creates a new instance and uses its retained cache policy with
current credentials. Every buyer continues through the original native
verification and settlement lifecycle even when its backend result is shared.

The original operator serializes mutations and completes an accepted operation
before shutdown. Its existing seller drain and private cache cleanup remain in
use. The focused `operations-journey.mjs` runs this complete configured MCP
workflow against the original seller, cache, catalog and subprocess transport.
