# Merchant host deployment

Generate a complete Linux deployment from the merchant's **existing original
configuration**. SF99 connects the original seller and operations interface,
continuous SF98 delivery, and optional original SF101 paid-file checkout/receiver.
It also deploys the original retained SF82 merchant with its existing signed
discovery identity and writer, through the same installation and recovery flow.
It writes Caddy configuration, systemd services and a target, a drift-checking
manifest, an original encrypted-recovery plan and exact operating instructions.

The generator runs on the selected host/source release and writes a new private
directory. It does not install services, reload an existing proxy, read private
environment values, enroll orders or execute a payment. The generated runbook
carries the remaining deployment steps through startup, observation, shutdown,
upgrade and recovery.

## API or data merchant

Use the existing SF30 seller configuration, trusted application module or upstream
bindings. Keep merchant configuration and state outside the source release.
Create a private host plan, replacing the paths and facilitator with the actual
deployment values:

```json
{
  "schema": "stellar-forge.merchant-host.v1",
  "merchant": "data-merchant",
  "serviceUser": "stellar-merchant",
  "kind": "api",
  "mode": "native",
  "config": "/private/merchant/config/seller.json",
  "privateRoot": "/private/merchant/state",
  "environmentFile": "/private/merchant/config/service.env",
  "facilitator": "https://facilitator.merchant.example",
  "upstreams": "/private/merchant/config/upstreams.json",
  "ports": { "seller": 8423, "operations": 8424 },
  "maxInFlight": 64,
  "drainGraceMs": 60000,
  "historyDays": 90
}
```

Use `handlers` for a trusted local module instead of `upstreams`. Optional
`allowLoopbackUpstream: true` applies to the original native upstream binding
contract. The original native merchant launcher owns seller operation, durable
usage history and original outbox recording. The generator reads the original
seller validator/compiler, so the exposed route/method pairs and public origin
come from that exact configuration, including imported path-parameter routes.

An API merchant can add an existing approved receiver, including the original
WooCommerce bridge, through the optional `delivery` object:

```json
{
  "url": "https://orders.merchant.example/wp-json/stellar-forge/v1/settlement",
  "allowHost": "orders.merchant.example",
  "concurrency": 1,
  "limit": 20,
  "pollMs": 5000,
  "timeoutMs": 7000
}
```

Place this object under the host plan's `delivery` key. The generated worker
reads the same original outbox. Its host pinning, HMAC, attempt budget and
receiver acceptance remain those of [SF98](../sf98-merchant-delivery/SERVICE.md).
The private environment file supplies `SF98_WEBHOOK_SECRET` and any existing
upstream environment bindings. Its values are never copied into the bundle.

For the original static/handler challenge-only preview, select `mode: "challenge"`
and omit `facilitator` and `upstreams`. It uses the original seller/operations
launcher. Native mode requires a facilitator and refuses known demonstration
payment markers. The original SDK still establishes runtime payment compatibility;
successful generation is a configuration result, not a settlement result.

## Retained release and signed discovery

Continue the merchant already prepared through the original
[release console or CLI](../sf82-seller-pilot/RELEASES.md) and
[discovery setup](../sf82-seller-pilot/DISCOVERY_SETUP.md). Stage the actual fixed
seller port and intended facilitator in the original release, inspect its terms,
and activate it. Put the returned current generation in this host plan:

```json
{
  "schema": "stellar-forge.merchant-host.v1",
  "merchant": "retained-merchant",
  "serviceUser": "stellar-merchant",
  "kind": "release",
  "mode": "native",
  "privateRoot": "/private/merchant/state",
  "release": {
    "store": "/private/merchant/state/releases",
    "expectedGeneration": 1
  },
  "discovery": { "setup": "/private/merchant/state/discovery" },
  "environmentFile": "/private/merchant/config/service.env",
  "ports": { "discovery": 8473 }
}
```

The release store and discovery setup are separate private descendants of
`privateRoot`, owned by the declared service account. Use the actual generation;
the generator reads its active release ID/digest and original immutable files.
It refuses changed selections. `mode` must match the staged runtime; use
`challenge` for an original challenge-only release. The seller port comes from
that release. An optional `ports.seller` must match it exactly. Discovery is
optional; omit both `discovery` and `ports.discovery` for a retained seller alone.

This kind runs the original `release-cli.mjs run --expect` and
`catalog-run --no-workspace` services. It retains the same source verifier,
process ownership, runtime, native payment path, drain, cache controls and
catalog writer. It does not create an operations listener or SF98 outbox;
`ports.operations`, delivery settings and application/payment overrides therefore
belong to the existing API or paid-file profiles. Original prepared Python and
DuckDB releases retain their native application/query launchers. Trusted ESM
handler entries must live in the selected immutable source release. Absolute
upstream idempotency directories use the existing `kind: "api"` profile, whose
original recovery already rebases those writable paths; this profile preserves
immutable retained binding bytes during a move.

The discovery service starts before the seller and closes after its drain. It
never creates an identity or publishes automatically. The generated Caddy fragment
exposes only original `GET /discovery/resources` and `GET /discovery/search` on
the merchant's existing HTTPS origin. It translates browser headers to the
selected loopback reader while the original private capability listener remains
unexposed. The setup's exact offer-export path serves the original seller offers;
custom paths receive an explicit GET alias. Paths colliding with paid routes or
existing private interfaces are rejected. Public discovery retains the original
filters, pagination, search and response bytes.

Generate and install through the commands below. Its generated `RUNBOOK.md`
contains the exact release, generation, seller identity/key pin, private paths,
service group and original review/apply/withdraw commands. The smoke command
also verifies the original retained process and offered terms, so an unrelated
listener cannot satisfy it. Publication stays the existing explicit source- and
catalog-head-bound operation. An unchanged restart creates no signatures or
catalog writes. Use original cache status/invalidation with the current seller
instance; no new cache or operator dashboard is introduced.

For release upgrades, stop the group, use original diff/activate/rollback,
update the host plan's generation, generate and install the next bundle, then
review the existing listing against that running version. The original
maintenance migration stops both components and backs up their complete private
stores. Restore moves only the host plan's store/setup selections: retained
release digests, signing key, public enrollment and catalog journal keep their
original bytes. Use the returned next maintenance plan for subsequent backups.
Native application environment paths and external database writers remain part
of the original explicit host/environment recovery procedure.

## Approved-file merchant

First prepare the original [SF101 checkout configuration](../sf101-merchant-receiver/CHECKOUT.md).
The checkout's `state` and `outbox` must be separate descendants of the host plan's
`privateRoot`. Then use:

```json
{
  "schema": "stellar-forge.merchant-host.v1",
  "merchant": "report-merchant",
  "serviceUser": "stellar-merchant",
  "kind": "paid-file",
  "mode": "native",
  "config": "/private/merchant/config/checkout.json",
  "privateRoot": "/private/merchant/state",
  "environmentFile": "/private/merchant/config/service.env",
  "facilitator": "https://facilitator.merchant.example",
  "ports": { "seller": 8423, "operations": 8424, "receiver": 8472 },
  "runtime": { "node": "/usr/bin/node", "python": "/usr/bin/python3" }
}
```

This profile launches the **original `checkout.mjs`**, its original Python
`receiver.py` and the original continuous worker. Checkout preserves the
enrolled order/file, approved `sf98_order` query, matching `X-SF98-Order-ID` header,
native payment terms and original outbox. It is not a generic seller attached to
an unrelated receiver. The receiver initializes its existing schema idempotently
before serving; enrollment remains the original explicit checkout operation.
Use Python 3.11+ for the original checkout and receiver. Keep approved file bytes
under `privateRoot`, or include their storage root in a separate private recovery plan: the original
order database retains their path and digest rather than the file contents.

All buyer URLs use the checkout's original public origin. Caddy admits:

| Public request | Original destination |
| --- | --- |
| Declared checkout route and method | Original checkout seller; query and headers unchanged |
| `POST /internal/x402-events` | Original receiver `POST /sf98/events` |
| `GET /deliver/ORDER` | Original receiver with its original bearer/entitlement/access checks |
| Seller documentation and generated client files | Original seller developer portal |

Receiver health, seller health/readiness, the operations API and private exports
remain on their loopback listeners. The worker uses the public HTTPS event route
with its original DNS/TLS validation. Both receiver and worker obtain the same
`SF98_WEBHOOK_SECRET` from the selected private environment file. The generator
does not publish claim tokens or issue a new order system. Existing recipient
binding and merchant suspension/expiry continue through the original receiver.
The proxy disables backend keepalive so Go's transport cannot automatically
retry a paid GET on a stale reused connection. It configures no retry or cache.

Paid-file plans use checkout's existing limits and Python configuration; API-only
`handlers`, `upstreams`, history and drain overrides are not accepted silently.
Use the original checkout inspection before deployment to review its Python pool.
Optional delivery tuning retains the same worker options; its URL and host are
derived from the checkout origin rather than separately configurable.

## Generate, inspect and operate

Run Node 22+ from the complete selected original checkout or portable release:

```sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs inspect \
  --plan /private/merchant/config/host.json
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs generate \
  --plan /private/merchant/config/host.json \
  --out /private/deployments/merchant-release-001
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs check \
  --bundle /private/deployments/merchant-release-001
```

The generated directory must be new and separate from source, inputs and state.
Keep it at its generated path; units refer to its preflight. `RUNBOOK.md` contains
the actual names, configuration paths, systemd/Caddy installation commands,
local/public smoke, maintenance order and original backup/restore commands. Each
generated file begins private at 0700/0600. Before installation, the runbook makes
the bundle root-owned and readable by the service group at 0750/0640, then runs
the preflight as that actual unprivileged account. The service cannot rewrite
its preflight files. Keep the selected source release immutable: digests cover
the configuration and service entrypoints rather than every transitive import.
Changing those tracked bytes requires a new bundle and review. These digests
detect changed bytes, not publication authority.

The source release is inferred from this module's actual location, so running
the original optional `forge.mjs run deploy -- ...` command selects that installed
release. Runtime defaults are the generating Node executable and `/usr/bin/python3`;
override them with real absolute host paths. Use an existing unprivileged service
account and keep its state at 0700. The environment file must be a regular file outside the source release, state
root and selected configuration files, with no group/world access. The generated units use a read-only system and permit
writes only under the selected merchant state root.

The target groups the seller, sender and receiver. Start ordering brings up the
receiver before the sender and the seller; stop ordering drains the seller first,
then stops sender and receiver. Individual services restart after a process
failure. A target's active status alone does not establish that every service is
healthy; inspect the actual services and the original HTTP readiness endpoints.
Never stop a shared Caddy service to maintain one merchant: update that merchant's
ingress through the existing proxy workflow.

`smoke --bundle PATH` reads original loopback readiness/offers/operations and
receiver health. Add `--public` after the actual public proxy is configured to
check documentation and private-path confinement. It never supplies a payment
signature, submits an enrolled purchase, or drains a queue. For an actual paid
purchase, retain the existing approved buyer workflow and original receiver proof.

## Recovery and upgrades

Use the integrated [merchant maintenance and restored-host cutover](MAINTENANCE.md)
for an existing systemd/Caddy installation. `cli.mjs maintenance` pauses the
selected merchant, stops its owned writers, takes and verifies the original
encrypted snapshot, prepares original state and file paths at a new destination,
and activates the restored services. Its private operation journal supports
interruption recovery, automatic precommit rollback and subsequent maintenance
of the promoted generation. The direct engine commands below remain available.

The generated recovery plan names the selected state root and configuration
files. Stop public ingress and all listed services, plus separately operated
database/catalog writers, before the original encrypted snapshot command's
`--quiesced` assertion. The original
[encrypted recovery tool](../sf101-merchant-recovery/README.md) restores into a new
directory; original outbox continuity/parity handles state comparison. Credentials
stay under their existing separate recovery procedure. To include other owned
roots, copy `recovery-plan.json` to a separate private path, edit that copy and
pass its path to the original snapshot command. Keep the generated bundle intact
so its installation preflight continues to match.

Stage/select the next source through the existing
[portable distribution](../sf46-release/DISTRIBUTION.md), generate against its
current configuration, install its units and check local readiness before
restoring ingress. Code rollback selects the earlier retained release and
compatible host bundle. It never rewinds a payment ledger or overwrites a live
merchant database. The generated runbook includes the concrete operation order.

The proxy configuration follows Caddy's original
[request matchers](https://caddyserver.com/docs/caddyfile/matchers),
[exclusive handle routing](https://caddyserver.com/docs/caddyfile/directives/handle)
and [reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
Service behavior uses the original
[systemd unit](https://www.freedesktop.org/software/systemd/man/systemd.unit.html)
and [service](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
contracts. No workflow or hosted Actions execution is part of this module.
