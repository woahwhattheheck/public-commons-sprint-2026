# Native merchant and buyer operator session

Keep an existing merchant, its native facilitator, live operations, and selected
buyer requests together in one foreground session. The session starts the
original services, checks each prepared purchase against the actual merchant
routes, and gives the operator commands to review, execute, cancel and recover
requests. Reopening retains the original buyer inbox and its resource files.

This launcher composes maintained source: the native facilitator's
`startSelfFacilitatedSeller`, SF30 operations, the SF88 durable inbox and CLI,
SF103 native signer, SF81 terminal approval, SF36 reservations, SF31 HTTP and
response saving, and SF82 outcome recording. The existing SF66 catalog/Atlas
launcher remains available separately through `launch.mjs`.

For the original SF101 paid-file merchant and customer handoffs, use
[Purchased files in the commerce workspace](./COMMERCE_PAID_FILES.md). That
plan adds `seller.checkoutConfig` and per-buyer `paidFile` inputs to this same
session and inbox.

## 1. Use the existing merchant and operator configurations

Use Node 22.16+ and Python 3.11+ on the operator's POSIX host. Install the same
native packages that the original seller and signer use:

```sh
npm install --ignore-scripts --no-audit --no-fund --no-save --package-lock=false \
  @x402/core@2.28.0 @x402/stellar@2.28.0 @x402/extensions@2.28.0 \
  @stellar/stellar-sdk@16.3.0
```

Keep operator files in an existing private directory with mode `0700`. Prepare:

- An original [SF30 merchant configuration](../sf30-seller-sdk/README.md), with
  the actual `publicOrigin`, routes, token contract, recipient, atomic prices
  and application handler or response source.
- An existing [native facilitator configuration](../native-facilitator/README.md)
  and its environment-held fee signer, or an existing facilitator URL.
- One or more complete [SF88 buyer configurations](../sf88-operator-buyer-cli/README.md).
  Each has a distinct stable intent ID, the actual merchant URL and request
  bytes, selected payment terms, operator policy/ledger and private evidence
  directory. Configure `responseFile` before preparing its native signer when
  the returned resource should be saved.
- The [SF103 generated buyer and signer configurations](../sf103-native-buyer-signer/README.md),
  or the original SF88 workspace and its generated `operator.json`. The session
  references these existing configurations; it does not create wallets or
  choose prices, accounts, spend policy or request content.

For SF103, each plan entry's `config` must be the exact generated `buyer.json`
referenced by its `signerConfig`. Keep those files and their original body files
at their prepared paths. The native adapter rechecks their digests when used.
Load existing SF36 keys and the named buyer/facilitator signing variables through
the operator's normal environment. An original SF88 `workspace` may supply its
SF36 environment through the existing inbox command instead.

The merchant listens on `127.0.0.1`. Its existing HTTPS ingress must route the
configured public origin to the selected seller port. A stable port such as
8423 lets the same ingress survive session restarts. Buyer execution uses the
original public HTTPS transport and obtains a fresh actual challenge; this
launcher does not map public payment URLs to loopback or change DNS/TLS rules.

## 2. Create one session plan

Save a private JSON file, replacing paths with the actual prepared inputs:

```json
{
  "schema": "stellar-forge.commerce-plan.v1",
  "seller": {
    "config": "/private/merchant/seller.json",
    "handlers": "/private/merchant/application.mjs",
    "port": 8423,
    "facilitatorConfig": "/private/merchant/facilitator.json"
  },
  "operationsPort": 0,
  "buyers": [
    {
      "config": "/private/buyer/native/buyer.json",
      "signerConfig": "/private/buyer/native/signer.json"
    }
  ]
}
```

Omit `handlers` for a seller using its original `response` or `responseFile`.
For an already running facilitator, replace `facilitatorConfig` with
`"facilitator":{"url":"https://your-existing-facilitator.example"}`.
An existing local backend can use an explicit
`{"url":"http://127.0.0.1:5101","allowLocal":true}`. Choose one facilitator
source. Without either, the original seller runs in `CHALLENGE_ONLY` mode and
the session still provides review, operations, cancellation and recovery.

For the original SF88 onramp, a buyer entry can instead be:

```json
{
  "config": "/private/operator/operator.json",
  "workspace": "/private/operator"
}
```

`workspace` is passed to the original `queue-cli.mjs execute --workspace`;
that implementation owns its operator/payer/signer/asset/payee/cap validation.
Multiple entries are allowed for explicitly prepared purchases from this same
merchant. Every entry keeps its own stable intent and optional signer config.

From the full repository checkout:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs init \
  --plan /private/commerce-plan.json --directory /private/merchant-session
```

The destination must be new. Initialization snapshots the original seller
configuration, resolves its response-file paths through the original reader,
and creates an **original SF88 inbox** containing immutable buyer/body
snapshots. `session.json` retains the runtime settings and input bindings.
Handler code is referenced at its trusted absolute path and checked for changes
on reopen. An embedded facilitator's normalized configuration is private and
contains environment names rather than key values. Initialization loads no
signer and opens no server or payment connection.

## 3. Start, review and use the original payment flow

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs start \
  --directory /private/merchant-session
```

The readiness output shows the actual seller URL, developer portal, original
facilitator status, operations dashboard and every selected buyer's state.
Each selection is bound to the running merchant's original compiled route and
one complete offered network/asset/recipient/amount/timeout tuple. Open the
printed operations URL to watch this same seller session. Original SF30 usage
history is stored in the session's private `usage` directory with its existing
90-day retention. The operations `/history.json` and `/history.csv` exports
retain original day/route HTTP outcomes and latency across merchant restarts.

The terminal accepts these commands; substitute an intent ID from readiness:

| Command | Behavior |
| --- | --- |
| `status` | Current original merchant counters, selected requests and retained outcomes |
| `review ID` | Original SF88 offline review of the inbox's exact request snapshot |
| `signer ID` | Original SF103 SDK/provider loading check, without signing or payment |
| `execute ID` | One original inbox attempt through SF88/SF81 approval, SF36, signer and HTTP |
| `cancel ID` | Original inbox cancellation before execution |
| `recover ID` | Original inbox recovery from that intent's existing SF82 evidence |
| `retrieve ID` | Original SF101 entitled-file retrieval or local receipt recovery for the selected handoff |
| `quit` | Cancel the foreground buyer if needed, drain the merchant and close services |

`execute` releases the command reader before the original approval helper opens
`/dev/tty`. Read and answer that original prompt. The launcher supplies no
approval answer. Its child receives the selected SF103 config in its own
environment, so concurrent operator processes do not change a global selector.

The returned original result includes HTTP/buyer status, seller-reported
settlement, original outcome report, evidence path and the separate
`responseFile` result. `SAVED` gives the resource path, byte count and SHA-256.
An original failure or partial response remains in the inbox alongside its
reported file location. These outputs preserve the distinction between actual
file delivery and the original independently checked transfer result.

For an explicitly selected foreground operation with automatic clean shutdown:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs start \
  --directory /private/merchant-session --execute YOUR_STABLE_INTENT --one-shot
```

The original terminal approval still applies. Without a TTY and without
`--one-shot`, the launcher prints readiness and stays running until SIGINT or
SIGTERM; it does not read commands from a pipe as payment instructions.

## Reopen and hand off

Run the same `start` command to reopen the session. The merchant gets a new
process-local traffic observer and reuses the same original usage history;
the original buyer inbox preserves requests,
attempt markers, outcomes and recovery. A previously attempted or cancelled
intent is shown from retained state rather than executed again. Use the
original inbox's recovery command and existing SF36/chain records for an
interrupted operation.

Offline inspection needs no signing keys or running service:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs inspect \
  --directory /private/merchant-session
```

Use the original `queue-cli.mjs report --root /private/merchant-session/inbox
--out /private/new-report.html` when an offline human handoff is useful. Saved
resource files and evidence stay at their original configured destinations.
Changed handler code or session snapshots are reported before startup; prepare
a new deliberate session when changing the merchant setup. Existing inbox
records remain available separately through the original commands.

Shutdown awaits all original buyer review, signer-check and execution children,
then the original merchant's
drain. The self-facilitated seller drains its own native facilitator after
accepted merchant work. The operations observer stays attached through that
process and saves the final original usage checkpoint. The original
`drained`/forced-close result is retained, and a forced
native drain exits with status 2 as the original facilitator CLI does.

## Installed package and embedding

The maintained merchant distribution includes this exact source. In an app
where its archive is installed, replace the long Node path with
`npx --no-install starforge commerce`. The package also exposes `inbox`,
`native-signer` and `facilitator`, forwarding arguments to their original CLIs.
See the [distribution guide](../distribution/README.md) for installation.

Trusted host code can import `initializeCommerce`, `inspectCommerce` and
`openCommerce` from `@tokenjunkielabs/starforge-merchant/commerce`.
`openCommerce(directory)` returns `status`, `review`, `checkSigner`, `execute`,
`cancel`, `recover` and `close`, together with the original seller/operations
objects. An existing host may supply its original `nativeFactory` and process
`environment`; the factory is an embedding argument, never a request or plan
field. Always await `close()` and keep its original shutdown result.
