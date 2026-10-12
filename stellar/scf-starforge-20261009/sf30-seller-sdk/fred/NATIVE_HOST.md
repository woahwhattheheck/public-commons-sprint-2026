# Run FRED on the original native operator host

The native host command supplies the complete setup around the existing FRED receiver: original operator and signer environment, native facilitator, retained merchant port, original HTTPS certificate, explicit CONNECT transport, native customer delivery and SF36 accounting. The receiver continues its same source/project/intent journal. Native services drain before the browser phase.

## Select the existing host

Use the equipped host that owns the original operator workspace, private custody and testnet resources. Retain that host's existing directory and its original payment and accounting configuration.

The original host directory supplies `operator-workspace/workspace.json`, its original `operator.json`, journal keys and policy/ledger, `accounts.public.json`, `accounts.private.json`, `facilitator.json`, `signer-ownership/`, and the existing `tls/server.pem`, `tls/server-key.pem`, `tls/extra-ca.pem`. The original workspace selects the actual native facilitator source through its retained `sourceCli`. The configured public terms remain exact Stellar testnet, the original asset and merchant, 10,000 atomic units and a 600-second payment window.

Save a private JSON using [the host configuration example](examples/native-host-config.json). Set `directory` to the host operation's private output folder, `originalDirectory` to the actual original native host, and `receiver.id` to the original FRED receiving ID. Set `browser` to the actual Playwright module and Chrome executable available there. The host command creates a controlling util-linux `script` PTY and selects the original CA before starting Node. It also carries system CA support through `NODE_OPTIONS` so the maintained SF88 signer and RPC child processes use the same trust configuration.

```sh
starforge fred receiver-host --project /private/original-fred-project --config /private/fred-host.json
```

The source-checkout equivalent is:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/fred/native-host.mjs --project /private/original-fred-project --config /private/fred-host.json
```

Use the original terminal for each maintained SF81 approval. The operation has no whole-journey deadline; original native request and finality worker limits still govern their own requests.

## Continue an already prepared receiver

Set `receiverConfigFile` to its existing private receiver configuration. The host reopens that configuration, its buyer settings and state directory, original source/publication/intents and retained merchant/facilitator ports. Optional `buyerStateDirectory` and `buyerRuntimeDirectory` apply when creating new Node settings; an existing receiver keeps its own settings. The standard `receiver` options supply first-run title, source files, projection, note, query, path or explicitly selected original intents. Public transport/payment settings come from the configured host.

Without an existing receiver file, the host creates `buyer-settings.json` and `receiver-config.json` once in its private output directory. The original UNRATE public table is the default source. Use `receiver.sources` with the retained [macro starter](sources/MACRO_STARTER.md) for the combined three-series edition. Relative source paths resolve against the original host configuration file.

To continue only the actual browser review after native delivery:

```sh
starforge fred receiver-host --project /private/original-fred-project --config /private/fred-host.json --phase browser
```

This phase reads the original completed receiver and opens its original/received projects. The host's `browser` member can select the existing browser installation independently of the financial plan. To inspect the same original receiver state, use `--phase status`.

## Original payment and accounting

The host reads the existing operator profile through `openWorkspace(..., {accounting:true})`, loads its existing named signer environment locally, and starts that operator's native facilitator. Its certificate and CONNECT proxy route the configured merchant origin to the retained FRED merchant port and the original Stellar testnet RPC to the host's existing HTTPS proxy.

FRED prepares and executes the maintained SF88 operation for page one, its actual returned cursor page, the complete source capture and the complete CSV. Each completed role is finalized through the existing `finalizeOriginalAttempt` entry, using that operation's retained configuration bytes, original attempt start, original response evidence and the original operator ledger. The saved accounting view records the actual SF36 outcome. Continuations reuse those same intents and accounting records.

The native receiver exports its complete project and receives it into a second private project. After native accounting, the host drains its facilitator, signer lease and transport before running browser source review, original delivery downloads, export and reopen. A later browser continuation uses the same completed native operation.

## Retained outputs

| Location | Original output |
|---|---|
| Host `host-plan.json` | Original operator/project selection. |
| Host `receiver-config.json` and `buyer-settings.json` | First-run configuration, when the host created it. |
| Host `native-terminal.log` | Appended output from the actual controlling PTY. |
| Host `accounting.json` | Original per-intent SF36 finalization results. |
| Host `exchanges.json` and `running-services.json` | Actual local transport status and selected service locations. |
| Host `shutdown.json` | Native service drain and release result. |
| Host `host-result.json` | Native receiving, accounting and browser result from that invocation. |
| Project `receivers/ID/receiver.json` | The maintained original receiving checkpoint. |
| Project receiver `deliveries/`, `project-bundle.json`, `received-project/` and browser folders | Original native replies, complete source/CSV, portable project and actual browser output. |

The retained receiving, accounting and browser results identify the complete original operation. The same project then opens through [managed Applications](../../distribution/runtime-workspace/FRED_APPLICATIONS.md).
