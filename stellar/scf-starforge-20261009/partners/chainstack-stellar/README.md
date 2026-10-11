# Chainstack Stellar installation and operator handoff

This package connects the Chainstack workshare's three Stellar read products to
the original merchant, release, buyer and Linux deployment runtimes. An operator
can prepare an installation, retain actual provider inputs and responses, stage
and select versions, export portable buyer operations, and recover the original
merchant and buyer state.

The implementation composes [SF30 JSON-RPC](../../sf30-seller-sdk/jsonrpc/README.md),
[SF82 releases](../../sf82-seller-pilot/JSONRPC_RELEASES.md),
[SF88 Node](../../sf88-operator-buyer-cli/node/README.md),
[SF88 Python](../../sf88-operator-buyer-cli/python/README.md), and
[SF99 host deployment](../../sf99-merchant-deploy/README.md). Those components own
request admission, upstream transport, native payment, fulfillment, process
locking and recovery.

## Configure the installation

Use a complete matching checkout and its original runtime dependencies. Copy
`example-installation.json` into a private operator directory. Replace the
merchant HTTPS origin, actual payment asset, recipient, atomic prices and
facilitator with the approved installation inputs.

`dataNetwork` is selected independently of `payment.network`.
`endpointEnv` names the existing private provider variable, normally
`STELLAR_RPC_URL`. Set that variable in the operator environment or secret
source to the complete existing Chainstack HTTPS endpoint, including its path
credential. The plan and clients retain the variable name. The original
application resolves its value at launch and verifies `getNetwork` before
opening the seller.

An operator using an existing authorized local provider gateway can explicitly
select `runtime.allowLoopbackUpstream: true`. This delegates the original SF30
loopback option and uses the private endpoint variable for that gateway. Direct
public HTTPS is the default. A local forwarding gateway must preserve the actual
provider request and response bytes and use the configured outbound transport.

| Product | Merchant body | Original result |
| --- | --- | --- |
| `POST /stellar/getTransaction` | `hash`: actual lowercase 64-character hexadecimal hash | Original envelope; `SUCCESS`, `FAILED` and `NOT_FOUND` preserve their chain-data meaning |
| `POST /stellar/getEvents` | Actual ledger bounds or returned cursor, filters, explicit pagination limit | Events, topics, values, transaction hashes and cursor |
| `POST /stellar/getLedgerEntries` | `keys`: 1–200 distinct canonical base64 LedgerKeys | Ledger entries and XDR bytes |

The merchant body contains the RPC **params object**. A captured provider wire
request also contains `jsonrpc`, `id` and `method`; retain that capture and put
its `params` into a separate caller file. The original application supplies the
wire envelope and fixed product method.

The example selects original limits: 10-second upstream timeout, 1 MiB response,
eight concurrent requests per binding, 500 events per page, and 200 ledger keys.
The original validator owns the accepted limits and request contracts. Primary
provider references:
[Chainstack Stellar](https://chainstack.com/build-better-with-stellar/),
[getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction),
[getEvents](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents),
[getLedgerEntries](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries).

## Prepare and select the merchant

Run from this source directory. State belongs outside the source checkout; its
parent must be an existing private real directory.

```sh
install -d -m 0700 /srv/private/chainstack
node cli.mjs create --file /srv/private/chainstack-installation.json \
  --root /srv/private/chainstack/merchant --release v1
node cli.mjs status --root /srv/private/chainstack/merchant
node cli.mjs activate --root /srv/private/chainstack/merchant --release v1 --generation 0
```

Creation calls the original package compiler, stages its validated files through
SF82, and exports the original JavaScript/TypeScript seller client. The release
retains its public contracts, prices, runtime mode and execution source.
Preparation is create-only. Reopen the existing directory for later work; use a
new version for changed inputs. A partial directory remains available for
inspection after an interrupted preparation.

`runtime.mode` is explicit. `native` requires the selected HTTPS facilitator;
`challenge` selects the original challenge-only merchant. Client metadata
carries the selected release's actual mode.

## Observe the provider

Prepare caller files containing the actual transaction hash, retained ledger
interval and LedgerKeys. Select them in a private request-set file:

```json
{
  "provider": "Chainstack Stellar testnet",
  "requests": [
    {"id":"transaction","method":"getTransaction","bodyFile":"/srv/private/tx-params.json"},
    {"id":"events-page-1","method":"getEvents","bodyFile":"/srv/private/events-params.json"},
    {"id":"account","method":"getLedgerEntries","bodyFile":"/srv/private/keys-params.json"}
  ]
}
```

```sh
node cli.mjs observe --root /srv/private/chainstack/merchant \
  --id provider-acceptance-001 --file /srv/private/request-set.json
node cli.mjs reopen --root /srv/private/chainstack/merchant --id provider-acceptance-001
```

Observe performs original `getNetwork` and `getHealth` reads, then the selected
products through their original SF30 handlers. It retains the effective network
and history window, caller bytes, raw provider responses, HTTP status and file
identities. Label the provider actually selected by the operator.

Use the current available interval from `getHealth`. Stellar defines
`startLedger` as inclusive and `endLedger` as exclusive. A cursor request omits
both ledger bounds and takes the previous response's cursor. Every additional
paid page gets its own prepared intent.

Reopen reads retained files and checks their identities. An interrupted
observation keeps its start record and completed files. A newly requested read
uses a new observation ID; the previous result remains available.

## Prepare and transfer buyer operations

Prepare the original SF88 selected offer and exact body from an observed entry:

```sh
node cli.mjs request --root /srv/private/chainstack/merchant \
  --observation provider-acceptance-001 --entry transaction --intent tx-purchase-001
node cli.mjs request --root /srv/private/chainstack/merchant \
  --observation provider-acceptance-001 --entry events-page-1 --intent events-purchase-001
node cli.mjs request --root /srv/private/chainstack/merchant \
  --observation provider-acceptance-001 --entry account --intent account-purchase-001
```

For new caller input, use `request --method METHOD --body FILE --intent ID`,
optionally selecting `--release VERSION`. The original method validator checks
the body before SF88 prepares the selected offer.

```sh
node cli.mjs handoff --root /srv/private/chainstack/merchant \
  --requests tx-purchase-001,events-purchase-001,account-purchase-001 \
  --out /srv/private/chainstack/buyer-handoff-001
```

The handoff contains selected requests, release clients and runnable Node/Python
entry points. Follow its [BUYER.md](BUYER.md). Both callers verify the retained
request and pass its exact body to the original SF88 buyer. The selected offer,
body and intent survive transfer to another host. Each language supports review,
execute, inspect, recovery and exclusive response export. The supplied original
operator profile owns signing and payment policy. Choose one language and stable
state directory for each purchase intent.

## Operate and recover

Inspect the current generation and run the original active release:

```sh
node cli.mjs run --root /srv/private/chainstack/merchant --generation 1
node cli.mjs console --root /srv/private/chainstack/merchant --port 8425
```

Choose the run command for a foreground service or the console for interactive
maintenance. The console prints its private operator URL and supplies original
start, stop, availability and release controls. The original process owns its
runtime lock, drains native work on shutdown, and retains availability, history
and fulfillment state. Restart the same store to recover that state.

Stage changed terms as a new version and inspect the original diff:

```sh
node cli.mjs stage --file /srv/private/chainstack-v2.json \
  --root /srv/private/chainstack/merchant --release v2
node cli.mjs diff --root /srv/private/chainstack/merchant --before v1 --after v2
node cli.mjs activate --root /srv/private/chainstack/merchant \
  --release v2 --generation CURRENT_GENERATION
node cli.mjs rollback --root /srv/private/chainstack/merchant --generation CURRENT_GENERATION
```

SF82 owns the generation comparison and previous-release selection. Selection
affects the next original process start; use the original console to stop and
start the selected release. Existing buyer requests keep their prepared release.

## Export the Linux host

Select a release at its fixed port and an existing unprivileged service account,
then generate the original SF99 deployment:

```sh
node cli.mjs host --root /srv/private/chainstack/merchant \
  --user starforge --environment /etc/starforge/chainstack.env \
  --out /srv/chainstack-host-v1 --source-root /srv/forge
```

Keep the environment file and generated host bundle outside source and merchant
state. The output contains the original systemd, Caddy, operator and recovery
files. Its retained-release selection pins the source, digest and generation.
Follow the generated host runbook on the selected existing host and regenerate
after changing the release. Original SF99 recovery handles retained state and
restored host paths.

