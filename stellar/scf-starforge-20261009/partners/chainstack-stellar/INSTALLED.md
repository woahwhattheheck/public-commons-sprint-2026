# Install and operate the Chainstack workshare

This guide uses the maintained `@tokenjunkielabs/starforge-merchant` distribution. The installed command operates the original Chainstack installation, Stellar RPC merchant, retained releases and buyer clients from the same source package. The original [operator guide](README.md) contains the complete provider, method and release contracts; [BUYER.md](BUYER.md) describes the portable handoff and original buyer lifecycle.

## Select the installation

Use the archive and its SHA-256 supplied by the maintained distribution producer. The original runtime installer can attach the selected native dependencies and operator runtime to that exact archive; its [runtime installation guide](../../distribution/RUNTIME_INSTALL.md) describes preparation, installation and recovery. For a source installation, the original package command is:

```sh
npm install --ignore-scripts --offline --omit=optional /absolute/path/to/the-package.tgz
```

Run these commands from the installed project where `starforge` is available:

```sh
npx --no-install starforge source
npx --no-install starforge doctor
npx --no-install starforge chainstack-buyer paths
```

`source` returns the original package and source selection. `chainstack-buyer paths` resolves the Node runtime, Python checkout, frozen buyer adapters, configuration example and guides from this same installed package. Keep the returned `sourceRoot` with the host deployment configuration. The Python runtime requires `python3` on the operator's configured PATH. For native payment operation, use the selected native runtime dependencies and existing facilitator described by the original installer and operator guides.

The installed entry points are:

| Entry point | Operation |
| --- | --- |
| `starforge chainstack-stellar` | Original installation create/stage/activate, provider observation, request and client handoff, release controls and native host export |
| `starforge chainstack-buyer node` | Exact-request review, execution, inspection and recovery through the original Node buyer |
| `starforge chainstack-buyer python` | The same original operation through the Python buyer |
| `@tokenjunkielabs/starforge-merchant/partners/chainstack-stellar` | The original installation module and its retained source/operation API |
| `@tokenjunkielabs/starforge-merchant/partners/chainstack-stellar/installed` | `installedBuyerRuntime()` and `runInstalledBuyer()` using this package's original runtimes |

## Prepare the merchant

Copy the configuration example returned by `paths` into the operator's private configuration directory and edit it for the selected installation. Fill in the merchant identity, canonical merchant HTTPS origin, data network, payment network/asset/recipient/amounts, and the original runtime mode and port. Native mode uses the existing facilitator. The endpoint field names the environment variable holding the complete selected Chainstack URL. The original operator may instead use its documented header credential reference when that is the provider's existing access contract.

The provider endpoint is read from the selected environment at runtime. Keep that value and the facilitator/operator configuration in the host's existing environment custody. The installation specification contains the reference names. The original operator guide documents the explicit loopback option for an operator-selected local upstream transport.

Choose an existing private parent directory for the new merchant root. The installation creates its own private state and retained release directories:

```sh
npx --no-install starforge chainstack-stellar create \
  --file /private/chainstack/installation.json \
  --root /private/chainstack/merchant --release v1

npx --no-install starforge chainstack-stellar activate \
  --root /private/chainstack/merchant --release v1 --generation 0

npx --no-install starforge chainstack-stellar status \
  --root /private/chainstack/merchant
```

The returned generation belongs to that retained store. Use it for the next original release operation. `run --root ... --generation 1` starts the selected merchant through the original process manager. `console --root ...` opens the existing private release and operations controls. The original availability controls retain product pause/resume state across process restart.

## Retain actual provider results and exact buyer requests

An observation request file names the provider and three or more selected admitted calls. Each `bodyFile` is an absolute filename containing the method's **params object**. Preserve any original full JSON-RPC envelope as a separate source capture. A representative request set is:

```json
{
  "provider": "Chainstack Stellar testnet",
  "requests": [
    {"id": "transaction", "method": "getTransaction", "bodyFile": "/private/chainstack/params/transaction.json"},
    {"id": "events-page-1", "method": "getEvents", "bodyFile": "/private/chainstack/params/events-page-1.json"},
    {"id": "ledger-entries", "method": "getLedgerEntries", "bodyFile": "/private/chainstack/params/ledger-entries.json"}
  ]
}
```

Use actual provider inputs. The transaction hash is lowercase 64-character hexadecimal. The events interval lies within the selected provider's current retained history, with an exclusive `endLedger`. A later page uses the returned cursor and omits both ledger bounds; it becomes a separate buyer request. Ledger keys are distinct canonical base64 Stellar LedgerKey XDR values. The source-native limits and their exact admission behavior are in the operator guide.

```sh
npx --no-install starforge chainstack-stellar observe \
  --root /private/chainstack/merchant --id provider-001 \
  --file /private/chainstack/provider-requests.json

npx --no-install starforge chainstack-stellar reopen \
  --root /private/chainstack/merchant --id provider-001

npx --no-install starforge chainstack-stellar request \
  --root /private/chainstack/merchant --intent customer-transaction-001 \
  --observation provider-001 --entry transaction
```

`observe` uses the original RPC application's network and health preflight and original method handlers. Its completed operation retains request and response bytes, status, source release and digests. `reopen` reads those retained files. `request` binds the exact admitted body and original buyer configuration to one intent and release. To prepare directly from an existing caller body, use the original `request --method METHOD --body ABS_FILE` form.

Prepare the remaining chosen intents in the same way, then export them together:

```sh
npx --no-install starforge chainstack-stellar handoff \
  --root /private/chainstack/merchant \
  --requests customer-transaction-001,customer-events-001,customer-ledger-entries-001 \
  --out /private/chainstack/customer-handoff
```

The new handoff directory contains the selected request files, one complete original client per release, runnable Node/Python buyer adapters, the buyer guide and a manifest written after the full file set. Give the customer this complete directory together with the matching installed distribution. The original handoff verifies the exact request/config digests and original SDK manifest before export.

## Use the installed Node or Python buyer

The installed dispatcher supplies the original runtime paths automatically. Keep the private buyer state and the selected request directory explicit. For Node:

```sh
npx --no-install starforge chainstack-buyer node review \
  --state /private/customer/node-state \
  --request /private/chainstack/customer-handoff/requests/customer-transaction-001 \
  --review-file /private/customer/transaction-review.json \
  --profile /private/customer/original-buyer-profile.json

npx --no-install starforge chainstack-buyer node execute \
  --state /private/customer/node-state --intent customer-transaction-001 \
  --review-file /private/customer/transaction-review.json \
  --output /private/customer/transaction-response.json
```

Use `python` in place of `node` for the equivalent Python commands. The optional profile in `review` supplies the existing original operator, signer and transport configuration. The frozen wrapper validates the selected body's exact bytes and imports them into the original buyer. The original reviewed terms and approved operation control execution.

After an interruption, inspect the same intent and continue its original recovery:

```sh
npx --no-install starforge chainstack-buyer node inspect \
  --state /private/customer/node-state --intent customer-transaction-001

npx --no-install starforge chainstack-buyer node recover \
  --state /private/customer/node-state --intent customer-transaction-001 \
  --output /private/customer/recovered-transaction-response.json
```

Output destinations are new files. Keep the original private state and intent identity through recovery. The portable handoff's own `buyer.mjs` and `buyer.py` also support the explicit runtime/checkout forms documented in BUYER.md; the installed dispatcher resolves those same inputs from its package location.

Applications can use the installed API directly:

```js
import { prepareRequest, exportHandoff } from
  '@tokenjunkielabs/starforge-merchant/partners/chainstack-stellar';
import { installedBuyerRuntime, runInstalledBuyer } from
  '@tokenjunkielabs/starforge-merchant/partners/chainstack-stellar/installed';

const runtime = await installedBuyerRuntime();
const outcome = await runInstalledBuyer({
  language: 'node',
  action: 'inspect',
  args: ['--state', '/private/customer/node-state',
         '--intent', 'customer-transaction-001']
});
```

The launcher forwards one operation and returns its original exit code and signal. It inherits the configured operator environment and preserves normal interrupt/terminate propagation.

## Upgrade, roll back and export the native host

Stage a reviewed installation configuration with a new release ID. Use `diff` to review the original route/payment/source change, then activate with the store's current generation. `rollback` restores the original prior release using the next generation:

```sh
npx --no-install starforge chainstack-stellar stage \
  --file /private/chainstack/installation-v2.json \
  --root /private/chainstack/merchant --release v2
npx --no-install starforge chainstack-stellar diff \
  --root /private/chainstack/merchant --before v1 --after v2
npx --no-install starforge chainstack-stellar activate \
  --root /private/chainstack/merchant --release v2 --generation 1
npx --no-install starforge chainstack-stellar rollback \
  --root /private/chainstack/merchant --generation 2
```

These generation numbers illustrate a store whose only earlier selection was v1; use the returned state for an existing installation. Original retained requests and observations retain their selected release identity.

Export the selected original release through SF99, using `sourceRoot` from the same installed `paths` output:

```sh
npx --no-install starforge chainstack-stellar host \
  --root /private/chainstack/merchant --user starforge \
  --environment /etc/starforge/chainstack.env \
  --source-root /absolute/installed/package/source \
  --out /private/chainstack-host
```

The environment file and new host bundle live outside the merchant's private state and installed source tree. The original generated host guide covers installation of its systemd/Caddy files, operator access and recovery. Reopen the original installation with `status` and the same merchant root after host or process maintenance.
