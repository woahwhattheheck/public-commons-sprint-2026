# Set up a merchant's signed discovery

The existing release CLI can prepare and operate a merchant's first signed
catalog. It reads an already retained API or Python release, creates a private
Ed25519 signing identity, derives the original catalog policy from that release's
actual offers, and writes the connection used by the release console and merchant
MCP. The original SF60 writer and catalog browser provide the running catalog.

Use Node 22+ on the same POSIX host as the merchant release store. The maintained
package exposes these commands as `starforge releases`. From a source checkout,
replace that prefix with
`node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs`.

## Prepare from the retained merchant

Start with an existing release store and the release you intend to publish. API
packages and versioned Python projects use the same preparation. Staging need not
have started the seller yet.

```sh
starforge releases inspect --store /srv/merchant/releases --id first

starforge releases catalog-init \
  --store /srv/merchant/releases --id first \
  --setup /srv/merchant/discovery --seller merchant-1

starforge releases catalog-inspect \
  --store /srv/merchant/releases --setup /srv/merchant/discovery
```

The setup directory must be new and separate from the release store, with an
existing real parent directory. `catalog-init` never replaces an existing setup,
signing key or policy. The default public source URL is the retained merchant's
`https://YOUR-MERCHANT/_seller/offers` endpoint. Supply `--source-url` for an
explicit alternative on that same public origin.

The generated original policy includes exactly the origins, recipients, networks
and payment schemes present in the inspected offers. Full ordered payment
alternatives, exact atomic amounts, resource keys, offer source digests and the
retained release/service digests accompany the public enrollment record. Nothing
is inferred from the machine's environment or a live third-party API.

| Created path | Purpose |
| --- | --- |
| `setup.json` | Completed setup, original source identity and public-file fingerprints |
| `seller-key.pem` | Private Ed25519 seller signing key, mode 0600 |
| `seller-public.pem` | Matching public key |
| `policy.json` | Original SF60 startup policy for this merchant |
| `connection.json` | Original SF82 catalog connection with relative private paths |
| `seller-enrollment.json` | Public seller pin, exact permissions and original offer identities |
| `catalog/` | Original durable catalog journal and its own runtime controls |
| `workspace/` | Original catalog browser's retained operations |
| `launches/` | The current browser's private launch capability file |

All setup directories use mode 0700 and files use mode 0600. Setup writes and
syncs its completion record last. If initialization is interrupted before that
record exists, `catalog-inspect` reports `DISCOVERY_SETUP_INCOMPLETE`; preserve the
partial private directory and choose a new directory or restore a complete backup.
It will never generate a replacement key over partially retained identity files.

## Start the original catalog and browser

```sh
starforge releases catalog-run \
  --store /srv/merchant/releases --setup /srv/merchant/discovery
```

The command prints the actual discovery and workspace origins, public key
fingerprint and the path to a private browser launch file. Open the URL from that
file on the same machine. Its session capability is kept out of terminal output;
the existing browser consumes its URL fragment using its original authentication.

The default selects available loopback ports. `--port 8787` fixes the original
discovery port; `--workspace-port 8798` fixes the existing browser port.
`--no-workspace` runs the same writer for CLI or MCP operators without opening a
browser listener. The local discovery origin is an operating address; the setup
does not configure a public reverse proxy, DNS or merchant hosting.

`Ctrl-C` first drains and closes this process's catalog browser, then drains and
closes its original writer. It removes only its own generated browser launch file.
A separately running merchant stays with the console or MCP that owns it. An
existing live writer keeps its original exclusive lock; a second launch does not
take over or remove it.

## Publish through the merchant console or MCP

In another terminal, open the original release console with the generated
connection:

```sh
starforge releases console --store /srv/merchant/releases \
  --catalog /srv/merchant/discovery/connection.json
```

Select the retained release, activate it using the displayed generation, and start
the original seller. In the existing Catalog section, review the exact before
and after terms, then apply that review. Publication signs every payment
alternative and delegates its verified batch to the original catalog journal.
The catalog browser now shows those same live resources and their history.

For a merchant MCP host, use the same connection in its existing host
configuration as `catalogConnection`, or pass
`--catalog /srv/merchant/discovery/connection.json` when initializing the host.
The existing `merchant_discovery_status`, `merchant_discovery_review` and
`merchant_discovery_apply` tools then operate this catalog. Source aliases and
private filesystem paths remain chosen by the host. Complete tool inputs and
recovery behavior are in [Merchant MCP operations](../../../stellar-forge/mcp-merchant-operator/OPERATIONS.md).

The terminal publication path also uses the original commands:

```sh
starforge releases catalog-review --store /srv/merchant/releases \
  --catalog /srv/merchant/discovery/connection.json --id first \
  --out /srv/merchant/review-first.json

starforge releases catalog-apply --store /srv/merchant/releases \
  --catalog /srv/merchant/discovery/connection.json \
  --review /srv/merchant/review-first.json
```

Signing key bytes are read by the original publisher only when an actual change
is applied. Setup inspection and the catalog host read the public policy; they
do not sign or load the private key. A later changed key is checked against the
original public pin by the publisher before signing.

## Reopen and maintain the same merchant

Stop and restart `catalog-run` with the same store and setup directory. It reopens
the existing original journal and browser records, keeps the same seller key and
policy, and creates a fresh browser launch file. An unchanged running release
reports `MATCHES`; applying its current no-change review issues no new signatures
or journal writes.

New releases using the same declared origin, recipients, networks and schemes
can publish through this connection using their new release IDs. Changes to
prices, schemas, descriptions or resource sets remain ordinary reviewed catalog
operations. Routes withdrawn from the original catalog remain in its lifecycle
history. Use [Catalog operation](./CATALOG.md) for update, withdrawal and
interrupted-response reconciliation.

The setup policy intentionally retains the exact original permissions. A new
recipient, origin, network or scheme requires the catalog operator's deliberate
policy configuration; an ordinary merchant release does not broaden it. Keep
this managed setup intact. For an existing multi-merchant catalog, copy only
`seller-enrollment.json` or `seller-public.pem` to its operator, who can use the
public seller row in the original startup policy and confirm the fingerprint.
That public file grants no authority by itself. Connect to that existing catalog
with a separately configured original SF82 connection; private keys and the
complete private setup stay with their owner.

Back up the stopped private setup together with its original catalog and workspace
state and the referenced retained releases. Resume the existing original paths;
the browser's retained operation records keep their own directory binding. A
writer left after an unclean process exit uses the original SF60 recovery
procedure, including checking the old process before handling an orphan lock.

## Existing embedding APIs

`release-discovery-setup.mjs` exports:

```js
const setup = await createReleaseDiscoverySetup(releaseRoot, {
  directory: '/srv/merchant/discovery', releaseId: 'first', sellerId: 'merchant-1',
});
const inspected = await inspectReleaseDiscoverySetup(releaseRoot, {
  directory: setup.directory,
});
const running = await openReleaseDiscoverySetup(releaseRoot, {
  directory: setup.directory, port: 0, workspace: true, workspacePort: 0,
});
// Distribute running.launchFile privately to the local operator.
await running.close();
await running.closed;
```

The returned setup and session metadata contain no private key or browser token.
The `closed` promise completes after the original owned services have stopped;
`close()` is idempotent and retains a shutdown error for its caller.
