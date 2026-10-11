# Mercury event operations → paid Starforge feed

Run the existing Mercury event service as the source of a durable paid event
feed. This integration keeps Mercury's original canonical rows, scoped event
identities, provider observations, catch-up jobs, signed HTTP delivery, worker
ownership, retry behavior and operator application. The destination is the
original Starforge webhook-feed store and SF30 merchant.

A merchant can select contract events, inspect arrivals, configure actual
payment terms, publish feed endpoints, and deliver them to the SF88 buyer's
durable subscription. Source and feed recovery travel together.

## Prepare the complete bundle

Use Linux, Python 3.11 or later and Node 24 or later. Work from a checkout
containing this directory and the adjacent SCF source. The paid merchant uses
the SCF package's existing pinned dependencies; use the repository's installed
merchant environment when selecting a native facilitator. Preparation,
ingestion and recovery use the Python standard library and Node's native
SQLite support.

Start with an existing reviewed Mercury configuration. It supplies the actual
network, provider scope, API base, contract addresses, topic filters, retry
parameters and credential variable names. All selected contracts must belong
to that configured scope.

From the repository root:

```sh
node stellar/mercury-event-operations/starforge-feed/cli.mjs prepare \
  --source-config /srv/mercury/current-config.json \
  --out /srv/mercury-paid-events \
  --payment /srv/merchant/stellar-payment.json \
  --public-origin https://events.example.com
```

The payment file is an original SF30 payment object, or an array of explicit
payment options. Use the selected real asset, recipient and positive atomic
amount with the original `scheme`, `network`, `amount`, `asset`, `payTo`
and `maxTimeoutSeconds` fields. Its public origin must be the actual HTTPS
origin serving the merchant. The existing seller compiler validates these
terms during preparation.

The new directory contains:

| Path | Purpose |
| --- | --- |
| `mercury-config.json` | Original Mercury configuration with a new private workspace and this signed HTTP destination. |
| `mercury/` | Original Mercury SQLite operation and delivery state, initialized by its own CLI. |
| `feed/events.sqlite` | Original Starforge event bodies, retained identities, definitions, merchant plan and cursor key. |
| `bridge.json` | Fixed source identity, selected scope, feed IDs, relative paths and listener ports. |
| `bridge-secrets.env` | Private generated credentials shared by the sender and destination. |
| `source.json`, `feeds.json` | Readable initial source and selected-field feed definitions. |
| `seller-release/` | Original SF30 deployable service, handlers and release manifest when payment terms are supplied. |
| `bundle.json` | Source configuration digest, source scope, native version, endpoints and credential variable names. |

Preparation creates a new original Mercury workspace because that engine binds
an existing workspace to its destination. Existing source workspaces continue
to retain their operation history. The copied scope produces the same
canonical event IDs; select original catch-up ranges or transactions in the
new bundle to bring that work into its paid feed.

An invocation without both `--payment` and `--public-origin` prepares
ingestion and the private feed desk. Save actual terms through the desk, then
restart the bundle to pin its merchant release. Passing only one of those
options is rejected.

Default feed ID is `mercury-events`; `--feed-id` and `--source-id` select
other stable names. Up to 64 selected contracts share a feed. Larger original
contract sets are split into explicitly selected groups named
`mercury-events-1`, `mercury-events-2`, and so on. Each feed has its own paid
endpoint and buyer subscription.

## Run the source, receiver and merchant

Keep the original Mercury provider JWT, source-webhook secret and operator
token in the existing private credential file. Supply that file explicitly:

```sh
node stellar/mercury-event-operations/starforge-feed/cli.mjs run \
  --bundle /srv/mercury-paid-events \
  --provider-env-file /srv/mercury/provider.env \
  --facilitator https://your-selected-facilitator.example
```

The environment file must be a regular private file with mode 600 or stricter.
Lines are literal `NAME=value`; shell expansion is never applied. Existing
process environment values take precedence. The generated bridge credential
file is loaded separately. Startup output displays local operator launch
addresses; keep the feed desk's launch token in the operator terminal.

| Default listener | Role |
| --- | --- |
| `127.0.0.1:8788` | Original Mercury operator application and `/webhooks/mercury` source notification endpoint. |
| `127.0.0.1:8494/events/mercury` | Signed canonical delivery destination used by the original worker. |
| `127.0.0.1:8493` | Original private Starforge feed desk. |
| `127.0.0.1:8492/feeds/mercury-events` | Original SF30 paid event endpoint. |

Select all four ports during preparation with `--mercury-port`,
`--bridge-port`, `--workspace-port`, and `--merchant-port`. They must be
distinct. Mercury's retained destination binding includes its URL; preserve
that destination and the configured bridge port across reopen and recovery.

The launcher starts the signed bridge first, then the feed desk and saved
merchant, then the original Mercury application. It waits for that exact child
process to announce its listener and pass its health request. On shutdown it
stops the original source worker before closing the downstream services. A
native worker process failure also closes the owned bundle listeners and
returns a failed process status.

With a selected facilitator, the launcher calls the original
`createNativeSellerServer(compiled, {facilitatorClient})`; this retains the
existing x402 verification and settlement engine. Without a facilitator, the
original merchant exposes its payment challenges for operator review. Its
returned `mode` records which lifecycle is active.

An existing process supervisor can run the bundle's exact Mercury
configuration separately. Start `run --external-mercury` in that arrangement.
The `bridge` command starts only the signed destination, for a deployment
that already manages the original source, seller and feed workspace.

Publish the paid merchant endpoint through the merchant's HTTPS proxy. Keep
the bridge and both operator desks on the private network. If the source
notification endpoint is published, apply the existing Mercury service's
documented proxy host configuration through its own supervisor. The managed
launcher uses its original loopback configuration.

## Use the original operations

Pass the original CLI command after `--`. The wrapper chooses the bundle's
exact source configuration and keeps all provider and worker behavior in
`mercury_ops`.

```sh
node stellar/mercury-event-operations/starforge-feed/cli.mjs mercury \
  --bundle /srv/mercury-paid-events \
  --provider-env-file /srv/mercury/provider.env \
  -- catchup reviewed-range-01 --ledger-from 56000000 --ledger-to 56000100 --page-size 100

node stellar/mercury-event-operations/starforge-feed/cli.mjs mercury \
  --bundle /srv/mercury-paid-events -- list deliveries --limit 50

node stellar/mercury-event-operations/starforge-feed/cli.mjs status \
  --bundle /srv/mercury-paid-events
```

Choose the actual reviewed ledger range and preserve its stable job ID when
continuing the same work. The original command also supports transaction
reconciliation, task and delivery inspection, retries, cancellation, recovery
and exports. Original per-operation topic selections and provider observations
remain attached to that engine's retained tasks.

The original Mercury workspace shows provider work and delivery outcomes.
The feed desk shows accepted canonical events, source definitions, selected
fields, merchant plans, paid route previews, retention and release preparation.
Feed changes use original expected revisions. A changed feed definition
requires a newly pinned merchant session and a deliberately selected buyer
subscription.

## Connect the original buyer

The feed endpoint for the default selection is
`https://events.example.com/feeds/mercury-events`. Supply the existing SF88
buyer configuration with that base endpoint, its actual payment asset,
recipient, page-price ceiling, operator policy and signer.

From `stellar/scf-starforge-20261009`:

```sh
node sf88-operator-buyer-cli/event-feed/cli.mjs init \
  --dir /srv/buyer/mercury-events \
  --config /srv/buyer/mercury-buyer.json \
  --feed mercury-events --id mercury-operations --page-size 50

node sf88-operator-buyer-cli/event-feed/cli.mjs sync \
  --dir /srv/buyer/mercury-events

node sf88-operator-buyer-cli/event-feed/cli.mjs export \
  --dir /srv/buyer/mercury-events \
  --out /srv/deliveries/mercury-events.ndjson
```

The existing subscription completes a fixed source sequence window, retains
each exact response and its original buyer operation, and advances its cursor
with the received events in one SQLite transaction. Arrivals after that
captured window are collected on the next invocation. Reopen and export use
the original subscriber journal. Its first unpinned collection adopts the
merchant's retained origin; existing subscriptions preserve exact cursor
boundaries.

Each projected payload includes network, provider scope, provider row ID,
contract ID, transaction, optional event index, event data XDR and up to ten
topic XDR fields. XDR-base64 strings are retained exactly. The source event
digest identifies the complete native envelope; `payloadSha256` identifies
the selected output under the existing feed contract.

See [the buyer operations guide](../../scf-starforge-20261009/sf88-operator-buyer-cli/event-feed/README.md)
for private browser collection, original payment recovery, page manifests
and immutable export destinations.

## Exact native signature and identity mapping

The bridge accepts the existing signed HTTP destination contract:

| Native input | Bridge verification |
| --- | --- |
| `Authorization: Bearer …` | Exact configured bearer token using constant-time comparison. |
| `Idempotency-Key` | Lowercase SHA-256 event ID matching the envelope and original scoped row identity. |
| `X-Mercury-Ops-Payload-SHA256` | SHA-256 of the exact received body bytes. |
| `X-Mercury-Ops-Signature` | Hex HMAC-SHA256 of those bytes with the original plain UTF-8 destination secret. |
| `schema`, `network`, `provider_scope`, `provider_base` | Exact native schema and configured source scope. |
| `canonical.contract_id` | Explicit membership in the reviewed contract selection. |
| `provider_row_id`, `canonical.id` | Matching native signed 32-bit row ID and original event-ID derivation. |

The original sender serializes the complete envelope as compact, sorted-key
JSON with UTF-8 encoding. Its event ID is SHA-256 over the original compact
sorted scope document containing network, provider base, provider row ID and
provider scope. The bridge authenticates the raw input before parsing it.

Native destination HMAC uses a plain UTF-8 secret. This differs from the
original source notification signature and from Standard Webhooks. After
native authentication, the bridge signs the *same raw bytes and event ID*
through the existing feed store's Standard Webhooks interface using its own
private key. That internal timestamp records arrival at the destination.

An acknowledgment is sent after the original feed transaction commits. An
identical retry returns the same sequence and a duplicate receipt. A changed
body with the same source event ID returns 409. Native Mercury's configured
`idempotency_supported: true` therefore uses the destination's retained
identity behavior for timeout recovery.

Ingress accepts up to 256 KiB per complete native envelope and at most 32
concurrent requests. Saturation returns 429 with `Retry-After`; transient
destination failures return a retriable service error. Original Mercury
retains failed and uncertain deliveries for its normal inspection and retry
workflow. The feed stores exact bodies privately while exposing only its
selected projection.

## Back up and restore both original stores

Use one joined recovery directory:

```sh
node stellar/mercury-event-operations/starforge-feed/cli.mjs snapshot \
  --bundle /srv/mercury-paid-events \
  --out /srv/recovery/mercury-events-20261011

node stellar/mercury-event-operations/starforge-feed/cli.mjs restore \
  --snapshot /srv/recovery/mercury-events-20261011 \
  --out /srv/mercury-paid-events-restored

node stellar/mercury-event-operations/starforge-feed/cli.mjs run \
  --bundle /srv/mercury-paid-events-restored \
  --provider-env-file /srv/mercury/provider.env \
  --facilitator https://your-selected-facilitator.example
```

The snapshot invokes original Mercury backup first. Its existing kernel
worker lock gives a consistent source operation and delivery snapshot. The
feed snapshot follows. Every delivery marked complete at the captured source
cut has therefore already committed to the later destination snapshot.
Deliveries received after that cut may be replayed with their original IDs
after restore.

If the original backup reports an active delivery, finish that operation or
stop the managed bundle gracefully, then retry the same snapshot command
with a new destination. The original worker owns its transaction. Backups
also work while the bundle is stopped.

The recovery inventory contains the original Mercury ZIP, original feed
SQLite snapshot, bridge descriptor and private generated bridge keys. Every
file has a length and SHA-256 identity. Recovery verifies the complete
inventory, calls each original restore implementation, checks source
destination binding and feed identity, regenerates any saved merchant
release, and publishes a runnable descriptor in a new directory. Restoring
never replaces an existing directory.

Retained source event IDs, cursor key, feed identities, retry outcomes and
merchant plan survive. Intentional feed retention remains part of the
snapshot: deleted raw bodies stay below the recorded retention floor.
A buyer cursor from a later source state receives an explicit unavailable
window or expired-cursor result until the corresponding history is supplied
or the operator selects the retained starting point.

Keep recovery directories private: they include bridge credentials and
retained raw events. The existing provider credentials stay in their separate
operator file and are supplied when reopening the original source service.

## Reusable module

`index.mjs` exports the bridge verifier/server, bundle preparation, managed
launcher, original native CLI invocation and joined snapshot/restore. Module
callers load the bundle's private environment explicitly before starting
services. If supplying a custom secret resolver to the bridge, pass that
same resolver to the existing `EventFeedStore`.

The source contracts are the original
[delivery module](../mercury_ops/delivery.py),
[engine](../mercury_ops/engine.py),
[configuration](../mercury_ops/config.py),
[durable store](../mercury_ops/store.py) and
[recovery implementation](../mercury_ops/maintenance.py).
Source administration remains in the original
[Mercury operations guide](../ENGINE-OPERATIONS.md) and
[deployment guide](../DEPLOYMENT.md). Paid pages and retention use the
[original webhook-feed merchant](../../scf-starforge-20261009/sf30-seller-sdk/webhook-feed/README.md).
