# Safe buyer operator workspace

The operator workspace carries the full original Safe simulation workflow in a private browser application: capture the caller's selected transaction, receive an existing selection, prepare and review its native purchase, recover that same intent, compare completed results, and deliver or reopen a complete handover.

It composes [the original Safe adapter](../README.md), the maintained SF88 buyer, Tenderly customer and analysis workspace. The existing Applications host manages this listener through its usual saved application and run history.

## Open the installed application

Use the complete installed Starforge release containing the source-owned `palmera-safe-review` contribution:

```sh
starforge registrations --source palmera-safe-review
starforge registrations --command safe-review-workspace
starforge safe-review-workspace --help
```

Select **Safe simulation buyer** in the existing Applications catalog. These fields select the same directories used by the original CLI:

| Field | Original selection |
| --- | --- |
| Private Safe review workspace | New or received private operator directory containing the workspace identity, selections, captures, saved reviews and handovers. |
| Original SF88 buyer runtime | Complete original `sf88-operator-buyer-cli` directory from the selected installed source. Its `cli.mjs` is the native executable entry. |
| Original buyer state | The existing private Buyer state directory. Reuse it to reopen original intent, attempt and payment records. |
| Original analysis workspace | The existing private Tenderly analysis directory for completed responses, comparisons and reviews. |
| Original buyer operator profile | Optional private original SF88 profile containing the configured signer and policy. The original buyer requires this configuration for execution. |
| Original caller module | Optional caller-owned ESM module that returns the actual selected Safe or Palmera transaction. |
| Local port | Use 0 for an available loopback port. |
| Private environment JSON | Optional original Applications environment file for this host's configured SDK/provider environment. |

For new directories, first create their shared private parent. Applications reviews each original path, the current workspace bytes, the native runtime entry and the optional profile/module bytes. Save and Connect the application, then use **Review Start** and **Start**. **Open** follows the original listener's authenticated startup URL.

Start opens the operator workspace. A simulation purchase begins when the operator selects a saved review and explicitly executes it in the native workflow.

The same entrypoint is available directly:

```sh
install -d -m 700 /srv/starforge/safe-review

starforge safe-review-workspace \
  --directory /srv/starforge/safe-review/operator \
  --runtime /srv/starforge/runtime/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /srv/starforge/safe-review/buyer \
  --analysis /srv/starforge/safe-review/analysis \
  --operator-profile /srv/starforge/private/operator-profile.json \
  --capture-module /srv/starforge/private/current-safe-transaction.mjs \
  --port 0
```

Replace the runtime and optional configuration paths with the actual installed directories on this host. Omit the optional operator profile or caller module when opening received selections and completed handovers.

The command prints one `stellar-forge.safe-buyer-workspace-startup.v1` record. Open its `safeBuyerWorkspace` URL on the host or through the operator's existing loopback forwarding. The browser takes its token from the URL fragment and removes it from the address bar. Ctrl-C closes the listener, signals its original active operations and drains their cleanup.

## 1. Capture or receive the selected transaction

The capture view uses the configured caller module. Its exported function receives the exact reviewed context and current abort signal:

```js
export async function loadTransaction({context, signal}) {
  // Supply this lookup from the application's original SDK/session.
  const selected = await originalApplication.currentSafeTransaction({signal});
  return {
    safe: selected.safe,
    transaction: selected.transaction,
    label: selected.label,
    origin: selected.origin,
    close: selected.close
  };
}
```

This example names the application-owned lookup seam; it must return that application's actual initialized SDK object and original transaction. A Palmera application returns `{palmera, transaction}` instead. Its close function releases resources owned by that lookup.

Keep the six original simulation fields together:

| Context | Value |
| --- | --- |
| `networkId` | Decimal EVM network ID matching the SDK's current chain. |
| `blockNumber` | Exact selected block number. |
| `transactionIndex` | Original position within that block. |
| `from` | Outer execution caller address. |
| `gas` | Outer execution gas limit. |
| `value` | Exact decimal-string outer value in wei. |

The native capture snapshots transaction data, signatures, context and origin, then checks the SDK identity and selected transaction after its asynchronous reads. It saves the Safe hash, encoded `execTransaction` call and exact public simulation body in the original selection format.

The UI retains the capture UUID and submitted input. Reconnect and continue that UUID after a lost reply. A completed capture reopens its saved original selection. A changed transaction or context receives a new capture UUID.

For an already saved selection, use **Receive selection** with its absolute original directory. This validates and copies the original three-file selection into the workspace catalog.

The [public Safe receiving guide](../receiving/PUBLIC_SAFE_RECEIVING.md) contains a recorded real Gnosis owner-replacement transaction and its original source. Its helper obtains the outer transaction and receipt through the caller's actual Protocol Kit, checks the complete encoded input and Safe hash, and returns the observed block position, caller, gas limit and value. Use that exact helper and caller-owned runtime when preparing the public receiving case.

## 2. Prepare one original purchase

Select a saved transaction, retain the merchant's actual plan and ticket for its exact `simulation.json` bytes, then choose a stable original intent ID. The workspace invokes the existing `prepareSafePurchase` and original buyer import.

The plan supplies the original compiled merchant terms. The operation ticket and selected body stay byte-bound in the prepared purchase. Its EVM network must match the selected Safe network.

If a prepared purchase already exists, **Import prepared purchase** receives that original directory. A repeated import attaches the same original intent only after its logical native request, ticket bytes, selection and merchant binding match. The native buyer remains the intent and payment authority.

Preparation can be reopened after ticket expiry for inspection. A fresh preparation and eventual native execution apply their original current-ticket rules.

## 3. Review, execute and recover the same intent

Open the original operation from the intent list. The workspace displays its native state, attempt details, delivery and result availability alongside the Safe selection and merchant.

**Review** calls the original buyer review and saves the entire returned review as exact bytes. The selected review SHA identifies that file. If the review response is lost, reopen the intent and choose the retained review from its review list; the browser downloads and verifies those original bytes.

Inspect the original request, merchant payment terms, selected ticket and operator/signing decision. **Execute** purchases the reviewed simulation through the original SF88 operation. The Safe application continues to own execution of the underlying Safe transaction.

The server immediately returns the current operation identity while the original process runs. The UI polls that selected operation and exposes its actual native attempt/error. Its abort control signals the same active buyer operation and remains associated with it through cleanup.

After a timeout, host restart or lost response, use **Recover** on the same intent. The original buyer reads its retained native result and execution history. A completed result is reused. The original native attempt marker prevents accidental repeat execution.

The original profile, request, selection and complete review remain bound. Changes to a profile or caller module require reopening the workspace with its current configuration. The UI preserves drafts and selections through a same-scope reconnect; it clears the old private scope when the workspace or selected configuration actually changes.

## 4. Analyze and compare complete responses

**Analyze** receives the completed original result into the existing Tenderly analysis workspace and opens its authenticated browser. The original analysis library owns traces, calls, state changes, assets, logs, notes and CSV exports.

A reverted EVM simulation is a completed provider response when the provider completed the request; its original simulation status and error remain visible.

Choose two completed intents to compare revisions of the same Safe on the same network. Each keeps its own exact transaction, caller, block position and response. The original comparison engine saves the comparison and review; the operator workspace returns its existing analysis URL.

## 5. Export and reopen the whole handover

Create a handover from a completed original intent. The same native result supplies both the original Tenderly customer export and analysis export. The final handover contains:

- The exact Safe transaction, signatures, selected context and public body.
- The original buyer record, complete provider response and customer manifest.
- The original analysis report, table exports, notes and comparison inputs.
- The industrial offline review index and joined file manifest.

Open a retained handover to validate every original member. The UI lists the manifest's actual file sizes and SHA-256 values. Downloads use the authenticated original endpoint and are saved after the browser checks the returned bytes against that descriptor.

Use **Receive handover** with an absolute delivered directory to receive its original files into this workspace and its analysis store. Repeat the same source/destination after interruption. The original file publisher recognizes its exact matched publication remnants and preserves changed or unknown files for inspection.

For a directory transfer outside this browser, use the original CLI from the same installed release:

```sh
starforge safe-review open --directory /absolute/delivered/handover

starforge safe-review receive \
  --from /absolute/delivered/handover \
  --out /absolute/recipient/handover \
  --analysis /absolute/recipient/analysis
```

The complete original handover supports provider response members up to the original customer's 64 MiB limit. Metadata retains its smaller native limits.

## Continue a managed listener

Applications retains the same application and run IDs. Its provider checks the reviewed workspace SHA and configuration SHA before the original server creates state or constructs its buyer. For a reviewed new workspace, the existing managed request ID is passed once as `--workspace-creation-id` and retained with the workspace identity. Continue reuses that exact ID and reopens the workspace created by that run.

The startup reader verifies the actual saved workspace, selected configuration, source arguments, loopback address, port and token shape before the existing Applications engine publishes Open. Existing workspace starts bind their exact original bytes.

Applications **Stop** closes the operator listener and drains the original active buyer/capture work. A later start or direct CLI invocation reuses the same operator, buyer and analysis directories. Their original histories remain available.

| Interrupted action | Original continuation |
| --- | --- |
| Capture reply | Reopen or repeat the same capture UUID and exact input. |
| Preparation/import reply | Repeat the same selection, plan, ticket, destination and intent. |
| Review reply | Choose its saved review SHA from the original intent. |
| Purchase reply | Inspect and recover the same native intent. |
| Handover publication | Repeat export for the same complete intent and binding. |
| Recipient copy | Repeat receive from the same original handover. |
| Managed Start reply | Inspect or Continue the original Applications run; it retains its creation ID and native arguments. |

## Programmatic entrypoints

```js
import {inspectSafeBuyerConfiguration, openSafeBuyerWorkspace} from
  '@tokenjunkielabs/starforge-merchant/buyer/safe-review/operator';
import {startSafeBuyerWorkspace} from
  '@tokenjunkielabs/starforge-merchant/buyer/safe-review/operator/server';

const options = {
  directory: originalOperatorDirectory,
  runtimeDirectory: originalBuyerRuntime,
  stateDirectory: originalBuyerState,
  analysisWorkspace: originalAnalysisWorkspace
};
const selected = await inspectSafeBuyerConfiguration(options); // read-only
const active = await startSafeBuyerWorkspace({...options, port: 0});
// Keep active.url on the private operator surface.
await active.close();
```

The exported model implements the same capture, selection receive, prepare/import, review, execute, recover, abort, analyze, compare, handover and receive methods used by the browser. Each returned HTTP value includes the original workspace/configuration scope. The private listener accepts exact loopback Host/Origin values and the current bearer token.

## Source map

| Source | Operating responsibility |
| --- | --- |
| `model.mjs` | Thin operator controller over the existing Safe, Buyer, Tenderly and analysis engines. |
| `server.mjs` | Private authenticated listener, installed command and original lifecycle drain. |
| `application-provider.mjs` | Source-owned Applications catalog, original argument preparation and startup receiving. |
| `public/` | Six-view industrial interface and exact saved-file receiving. |
| `../transaction.mjs` | Original SDK capture and selection identity. |
| `../preparation.mjs` | Original merchant/body/ticket preparation. |
| `../workspace.mjs` | Original buyer, request, payment and result authority. |
| `../handover.mjs` | Original full customer/analysis export and receiving. |
