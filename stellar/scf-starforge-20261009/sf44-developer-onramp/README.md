# Local Bazaar catalog and MCP preview

This directory opens the original catalog and MCP discovery code with a local
example. Use it to inspect discovery, price preview and protocol behavior before
configuring a merchant.

For merchant setup, native Stellar signing, approved purchases, delivered files
and retained operations, start with the
[maintained merchant and buyer toolkit](../README.md). The local preview's
nonpayable fixture is independent of those configured product workflows.

## Open the catalog

From the repository root with Node 22 or newer:

```sh
node stellar/scf-starforge-20261009/sf44-developer-onramp/onboard.mjs
```

The command starts the original Bazaar HTTP catalog on an available loopback
port, inserts its development fixture, performs the original list and search
requests, prints their results and closes.

To keep the catalog open for a browser or HTTP client:

```sh
node stellar/scf-starforge-20261009/sf44-developer-onramp/onboard.mjs serve
```

Use the printed `baseUrl` for:

| Request | Purpose |
| --- | --- |
| `GET /discovery/resources?network=stellar%3Atestnet&type=http` | List the example's original offer |
| `GET /discovery/search?query=weather&network=stellar%3Atestnet` | Search that catalog |
| `GET /discovery/search` | Inspect the required-query error |
| `POST /discovery/resources` | Inspect the catalog's read-only HTTP interface |

Stop the foreground server with Ctrl-C. The original merchant publication
workflow belongs to the [catalog operator](../sf70-federated-bazaar-operator/README.md)
and its source admission paths.

## Exercise the MCP discovery interface

```sh
node stellar/scf-starforge-20261009/sf44-developer-onramp/mcp-onramp.mjs
```

This composes the original catalog and authenticated Streamable HTTP MCP
handler. It performs initialization, tool discovery, catalog search, price
preview, quote status and cancellation. It also reports the unconfigured signer
and agent-commerce hook and the anonymous-request response.

The fixture uses `NONPAYABLE_DEMO_ASSET` and
`INVALID_DEMO_RECIPIENT_NOT_A_WALLET`. Its outbound adapter permits only the
original loopback catalog and refuses redirects. The preview needs no wallet
or payment dependency. For an agent application with retained quotes and
configured operator hooks, use the
[durable MCP workspace](../../../stellar-forge/mcp-paid-agent/DURABILITY.md).

## Source and continuation

Both previews import the original
[Bazaar catalog](../../../scf46-stellar-bazaar/src/catalog.mjs).
The result records its current Git blob, the recorded baseline and
`sourcePinMatches`. Normal local preview continues when maintained catalog
source differs from the earlier baseline; `--strict-source-pin` on
`mcp-onramp.mjs` is the optional exact-baseline inspection.

Continue with [Atlas offer preparation](../sf61-bazaar-explorer/README.md),
the [original native buyer workspace](../sf88-operator-buyer-cli/README.md),
and the [merchant/buyer commerce session](../sf66-demo-launcher/COMMERCE.md).
Those guides carry current executable product setup. Current program details
come from the [official SCF awards page](https://communityfund.stellar.org/awards).

The existing focused checks and source history remain in this directory. The
preview uses the original MIT-licensed components.
