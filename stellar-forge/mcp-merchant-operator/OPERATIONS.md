# Operate merchant discovery and caching through MCP

The existing merchant MCP service can run a release, publish its signed offers
into the live catalog, update those listings, withdraw a retired route, and
operate the running seller's shared cache. The same tools are available through
its authenticated HTTP endpoint and existing subprocess MCP entrypoint.

## Connect the merchant's catalog

For a first catalog, use the existing release CLI's `catalog-init` and
`catalog-run` workflow in [Merchant discovery setup](../../stellar/scf-starforge-20261009/sf82-seller-pilot/DISCOVERY_SETUP.md).
It derives the original policy from the retained merchant, creates the private
signing identity and produces the `connection.json` consumed here. The same
catalog and MCP operating tools below handle publication and later restarts.

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

Installed distributions expose the same arguments through `starforge merchant-mcp init`.

The same `--catalog` option works with original OpenAPI files or a retained
Python merchant declaration and source root. An
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


## Review and change live retention policy

The same MCP host now carries a complete cache operating sequence: inspect the
original running manager, review its exact policy, apply a retained operation,
recover that result after a lost response, and inspect the resulting revision.
The original API merchant workspace provides the browser view and durable
operating history around the same manager.

| Tool | Required selection | Result |
| --- | --- | --- |
| merchant_cache_inspect | Current seller instanceId | Original manager inspection, canonical binding IDs, route aliases, retention policies, immutable limits and current revision |
| merchant_cache_configure | Seller instanceId, cacheInstanceId, expectedRevision, operationId, binding and complete policy | Original policy change and its resulting inspection |
| merchant_cache_purge | Same reviewed selection, without policy | Original generation invalidation and resulting inspection |
| merchant_cache_operation | Same seller instanceId and original operationId | Original change result, or found:false for that running manager |

First read merchant_status and call merchant_cache_inspect with the
MCP-owned seller instance ID:

~~~json
{ "instanceId": "CURRENT_SELLER_INSTANCE_UUID" }
~~~

The response has two distinct identities. Its outer instanceId identifies the
original SF82 seller. Its inspection.instanceId identifies that seller's current
cache manager; use it as cacheInstanceId for a change. The inspection.revision
is the expectedRevision. Changes to policy, generation, cache generation or
closed state advance the manager's revision, including changes made through the
existing legacy invalidation controls. Ordinary occupancy and request counters
can advance while the same policy review remains current.

Select an exact key from inspection.routes as binding. These are canonical
upstream binding names, which can differ from the public route IDs used by
merchant_cache_invalidate. The descriptor's routeIds identifies every public
route using that original binding. One change applies to that shared binding,
so its aliases stay together in the same source and cache generation.

Review the four current policy values and the original immutable source limits.
Submit all four retained values, including those you intend to keep:

~~~json
{
  "instanceId": "CURRENT_SELLER_INSTANCE_UUID",
  "cacheInstanceId": "INSPECTED_CACHE_MANAGER_UUID",
  "expectedRevision": 4,
  "operationId": "inventory-retention-20261012-001",
  "binding": "inventory",
  "policy": {
    "ttlMs": 5000,
    "maxEntries": 256,
    "maxBytes": 16777216,
    "maxEntryBytes": 1048576
  }
}
~~~

Send that object to merchant_cache_configure. Retain the exact object and
operationId before the call. The original manager validates the entry budget
against both maxBytes and the source's immutable maxResponseBytes.
ttlMs ranges from 1 to 3,600,000 milliseconds; maxEntries from 1 to 100,000;
maxBytes from 1 to 268,435,456 bytes; maxEntryBytes from 1 to 16,777,216 bytes
within those original source and memory bounds.

A configuration creates a fresh retained epoch even when all four values match
the previous policy. Existing source reads finish through their original
generation; subsequent reuse follows the new policy. The existing source
concurrency, waiter and timeout limits, header projection, credentials,
availability state, original admission and native payment lifecycle remain the
same runtime controls.

To clear an inspected binding without changing its retention values, pass the
same reviewed selection and a new operationId to merchant_cache_purge, omitting
policy. To restore a previously retained policy, inspect the current revision
and submit those four earlier values through merchant_cache_configure as a new
reviewed operation. This preserves both the previous operation and the new
restoration in the operating history.

## Recover the same cache operation

If a configure or purge response is interrupted, query its original ID:

~~~json
{
  "instanceId": "CURRENT_SELLER_INSTANCE_UUID",
  "operationId": "inventory-retention-20261012-001"
}
~~~

merchant_cache_operation reads the same manager's original result and performs
no mutation. A found result includes the original operation inspection; inspect
again to see the latest runtime state if later changes have occurred. Repeating
an unchanged change request with its same operationId returns that same original
result. Reusing the ID with a changed binding, action, review or policy raises
CACHE_CONTROL_OPERATION_CONFLICT. A stale cache instance or revision raises
CACHE_CONTROL_REVIEW_STALE before a new change is applied.

A result belongs to its original running manager. The original workspace's
durable journal retains saved reviews and returned operation results across
browser sessions. If the seller is replaced, select the new owned instance and
inspect its current manager before preparing a new operation. Restarting a
merchant uses its selected immutable release's saved configuration. To change
those restart defaults, save the intended source policy through the original API
merchant authoring workflow and stage that source as a new release.

Every new mutation goes through the existing merchant operator serialization
and SF82 private control descriptor. Inspection and operation readback are
read-only. HTTP and stdio expose the same tool definitions and results, and
typed original control failures are retained in the response without private
descriptor paths or tokens.
