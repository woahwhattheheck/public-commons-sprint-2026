# Native receiving environment and original purchase accounting

This setup runs the paid-output phase of the existing PMTiles operation with
the original Stellar testnet facilitator, funded SF88 operator workspace and
approved HTTPS transport. The same receiving process owns these services,
uses them for the original map and complete operations-package purchases,
finalizes their original per-chunk accounting, then drains the services.

The normal product continues to use the seller and buyer profiles configured
by its operator. This optional setup is for an actual receiving host whose
funded operator, facilitator configuration, certificate and signing
credentials already exist. Select their original complete files and hashes
before freezing the native input.

## Complete installed source and host selection

Use the complete installed merchant selected by
[PMTILES_OPERATIONS.md](../../../distribution/selections/PMTILES_OPERATIONS.md).
It supplies repository-root MCP, SF30, SF82, SF88, the native facilitator and
the original operator/governor source. The map's portable ZIP supplies its
declared map source/runtime/customer closure; the complete merchant
installation supplies this paid receiving phase.

The selected installation retains its exact source commit and manifest
SHA256 in `merchantInstallation`. Its runtime selection includes native,
operator, schema, OpenAPI and MCP capabilities. The existing PMTiles native
profile retains the exact PMTiles/Martin executables, validator, browser
bundle and worker. Reuse those selections in the original receiving
operation.

The host runs Linux, Node 22.16 or newer and the original Python operator
runtime. Start the original Node process with `--use-system-ca`. The helper
also gives native child processes the selected additional CA, the original
system-CA option and `SF36_OBSERVER_USE_SYSTEM_CA=1`. Node reads
`NODE_EXTRA_CA_CERTS` at process startup, so launch-time CA selection remains
part of the receiving command.

Where the original SF81 operator requires a controlling terminal, launch the
original command through the host's existing util-linux `script` session.
Keep that command and terminal with the original native operation.

Primary runtime references:

- [Node 22.16 command-line and environment options](https://nodejs.org/download/release/v22.16.0/docs/api/cli.html)
- [Node 22.16 TLS API](https://nodejs.org/download/release/v22.16.0/docs/api/tls.html)

## Select existing private material

Create a private, owned `0600` JSON file with this schema. Replace each
example path and SHA with the selected original file and its complete
SHA256. The TLS certificate must cover the exact merchant hostname and
match the selected private key.

~~~json
{
  "schema": "starforge.pmtiles-native-environment.v1",
  "operatorWorkspace": "/private/original-funded-operator",
  "facilitatorConfiguration": "/private/original-facilitator.json",
  "facilitatorConfigurationSha256": "ACTUAL_COMPLETE_FILE_SHA256",
  "tls": {
    "certificate": "/private/original-tls/server.pem",
    "certificateSha256": "ACTUAL_COMPLETE_FILE_SHA256",
    "key": "/private/original-tls/server-key.pem",
    "keySha256": "ACTUAL_COMPLETE_FILE_SHA256",
    "ca": "/private/original-tls/extra-ca.pem",
    "caSha256": "ACTUAL_COMPLETE_FILE_SHA256"
  },
  "rpcTransport": {
    "mode": "environment-proxy",
    "proxyEnv": "HTTPS_PROXY"
  },
  "ports": {
    "tls": 4312,
    "proxy": 4313
  }
}
~~~

`operatorWorkspace` is the original SF88 workspace containing its
`workspace.json`, `operator.json`, policy, reservation ledger, signer and
private operator keys. The original `openWorkspace(..., {accounting:true})`
validates that workspace and returns its private operator environment.
The helper compares the selected buyer's operator, signer module, trusted
payer, explicit-connect transport and evidence directory to those original
fields. The original scheme, network, asset and recipient must match both
the selected buyer operation and the advertised map payment terms before
services start.

`facilitatorConfiguration` uses the maintained
`stellar-forge.native-facilitator.v1` schema. Its original signer environment
names must already resolve in the host's private credential custody. Its
network, RPC, permitted asset/recipient, payment flow and amount limits must
cover the selected actual output prices. Preserve its original signer
ownership directory.

`rpcTransport.proxyEnv` selects the existing host HTTPS proxy. The helper
keeps that captured upstream route for the original Stellar RPC authority.
Its own CONNECT endpoint accepts only the selected merchant authority and
that exact RPC authority. The merchant hostname is forwarded to the
selected local SF82 seller through the original TLS certificate.

All selected paths are canonical and absolute. Private JSON and the TLS key
must be owned private files. Complete file hashes, regular-file identity,
bounded reads and certificate/key correspondence are checked before
services become ready. The private JSON contains file references and
public configuration; signing secrets stay in their original environment
and operator custody.

The optional `ports.tls` and `ports.proxy` choose fixed loopback listeners.
If omitted, the first startup selects free ports and retains them in
`listeners.json`. Every continuation binds those original saved ports.
The merchant, facilitator, TLS and CONNECT listeners must have distinct
ports.

## Join the original receiving input

The original driver is:

~~~text
stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/native-receiving.mjs
~~~

Its existing input schema is
`starforge.pmtiles-native-receiving.v1`. Add the complete
`outputCommerce` selection before the original operation retains its
input. Keep its current directory, operation ID, source installation,
native map profile, browser and original producer.

This fragment illustrates the field names. Choose the actual payment
tuple, private files, complete file hashes and funded budgets for the
selected two downloads.

~~~json
{
  "outputCommerce": {
    "schema": "starforge.pmtiles-output-native-selection.v1",
    "origin": "https://merchant.example.test",
    "payment": {
      "network": "stellar:testnet",
      "asset": "ACTUAL_SELECTED_ASSET",
      "payTo": "ACTUAL_SELECTED_RECIPIENT"
    },
    "runtime": {
      "port": 4310,
      "facilitator": "http://127.0.0.1:4311",
      "allowLocalFacilitator": true
    },
    "buyer": {
      "runtimeDirectory": "/private/installed/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli",
      "stateDirectory": "/private/pmtiles-buyer-state",
      "configuration": "/private/pmtiles-buyer-configuration.json",
      "configurationSha256": "ACTUAL_COMPLETE_FILE_SHA256",
      "operatorProfile": "/private/original-operator-profile.json",
      "operatorProfileSha256": "ACTUAL_COMPLETE_FILE_SHA256",
      "operatorWorkspace": "/private/original-funded-operator"
    },
    "mapAtomic": "10000",
    "operationsAtomic": "10000",
    "mapBudgetAtomic": "1000000",
    "operationsBudgetAtomic": "10000000",
    "nativeEnvironment": {
      "configuration": "/private/pmtiles-native-environment.json",
      "configurationSha256": "ACTUAL_COMPLETE_FILE_SHA256"
    }
  }
}
~~~

The numeric strings above illustrate atomic units. The returned exact
catalog supplies the number of fixed requests and complete download cost
for the actual map and full operations ZIP. Both selected budgets must
cover their complete cost and remain within the original funded
operator's applicable policy. Preserve other operations' existing
reservations and allocated budgets.

`buyer.runtimeDirectory` is the actual SF88 component directory whose
`cli.mjs` and native Python bridge are installed. `stateDirectory` is the
original buyer's private object/command state. `operatorWorkspace` is the
original financial workspace. These are distinct selections.

The optional `operatorProfile` pair is used when the original operator
profile is separate from the buyer configuration. If omitted, the buyer
configuration supplies its complete original profile. The selected buyer
operation retains the exact HTTPS origin, network, asset, recipient,
timeout and per-request ceiling. Each purchase then retains the chosen
catalog URL, intent ID and exact lower price.

The native environment uses the accounting workspace from its descriptor.
If `buyer.operatorWorkspace` is also supplied, both selections must resolve
to the same path. An existing externally managed receiving environment can
omit `nativeEnvironment` and supply `buyer.operatorWorkspace` directly for
the same final accounting phase.

Run the original complete command after the input is frozen:

~~~sh
node --use-system-ca /ABS/COMPLETE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/native-receiving.mjs /PRIVATE/original-input.json
~~~

The existing PMTiles operation first completes its map authoring,
publication, customer receiving, MCP and managed Applications phases.
After their owners drain, it calls the paid-output phase against that
same saved producer and original published release.

## Service ownership and retained continuation

The helper exports:

~~~js
import {
  validatePMTilesNativeEnvironmentSelection,
  startPMTilesNativeEnvironment
} from '@tokenjunkielabs/starforge-merchant/pmtiles/output-native-environment';

const owned = await startPMTilesNativeEnvironment({
  selection: {
    configuration: '/private/pmtiles-native-environment.json',
    configurationSha256: selectedCompleteFileSha256
  },
  commerce: selectedCommerce,
  buyerConfiguration: originalBuyerConfiguration,
  operatorProfile: originalOperatorProfile,
  directory: '/private/original-receiving/native-environment',
  signal
});
~~~

Its return value is `{ready, environment, close}`.
`environment` is private and is passed only to the original native
operator. The public `ready` descriptor retains selected file hashes,
workspace manifest identity, authorities, listener ports and actual
facilitator readiness.

The helper captures the process environment at entry and owns its changed
values for this one receiving lifetime. This is necessary because the
existing merchant Buyer creates native children from the process's
original environment. A second environment owner in the same module
cannot start concurrently. Close restores each unchanged owned value; a
value changed by another owner is preserved and reported.

Startup obtains the original native facilitator, starts its maintained
HTTP server, observes native readiness and starts the two selected
transport listeners. The paid receiving phase then starts its existing
MCP operator and original SF82 seller.

The normal completion order is:

1. Complete both original SF88 purchases and retained assemblies.
2. Adopt the selected map and receive the complete operations package.
3. Finalize every original accounting range and retain its native output.
4. Close and reopen the same MCP workspace to recover original purchase,
   accounting and historical lifecycle records.
5. Stop and drain the original SF82 seller and MCP owner.
6. Stop transport admission, drain the original facilitator, finish the
   owned sockets/listeners and restore the process environment.

`close()` retains one shared promise. Startup failure invokes that same
close path. The receiving caller attempts all acquired owners during
cleanup and preserves both the original execution error and any close
error.

Retained environment files are:

| File | Meaning |
| --- | --- |
| `input.json` | Exact private selection, source/configuration hashes and original public runtime bindings |
| `listeners.json` | First selected facilitator, TLS and CONNECT listener ports |
| `status.json` | Actual READY or closed state, selected hashes, transport counts and original drain result |

Retain the original receiving directory and input across a disconnect.
The source verifies an existing listener selection before reopening it.
The completed paid result reopens its retained output/package/accounting
files and checks their complete hashes.

## Read and finalize original purchase accounting

A configured merchant buyer may include
`operatorWorkspace: "/private/original-funded-operator"`.
This path is selected by the host. Tool arguments select only the
existing buyer alias, purchase and native accounting range.

| MCP suffix | Additional fields after `workspace, buyer, purchaseRequestId` | Original result |
| --- | --- | --- |
| `purchase_accounting` | Optional `offset, limit` | Native accounting VIEW range and command ID |
| `purchase_finalize` | Optional `offset, limit` | Native SF36/SF86 finalization range and command ID |
| `purchase_accounting_recover` | Optional `commandId` | Saved original command and last complete output |

The default range is offset 0, limit 100; the original range limit is
1–250. The response's `accounting.native.range.nextOffset` selects the next
range. Continue until it is null. Preserve each complete returned native
response and inspect its process status, interruption flag and entry
outcomes.

The CLI uses the corresponding `purchase-accounting`,
`purchase-finalize` and `purchase-accounting-recover` commands. Put
`operatorWorkspace` inside the customer connection's `buyer` object.
For example:

~~~json
{
  "purchaseRequestId": "customer-regional-operations-20261012",
  "offset": 0,
  "limit": 100
}
~~~

~~~sh
starforge pmtiles-output purchase-finalize \
  --connection /private/customer-connection.json \
  --request /private/original-accounting-range.json
~~~

After an interrupted accounting reply, use
`purchase-accounting-recover` with the same purchase and, when available,
the returned native `commandId`. It reads the existing command context,
complete original output and first completion. A later incomplete command
keeps the earlier complete original response available as
`accounting.lastComplete`.

Native finalization continues the original reservation/finalization
engine. Repeating a range returns its original idempotent finalization
outcome. The map chunk requests, complete assemblies and payment receipts
remain attached to that same SF88 object.

The complete native phase reconciles the original accounting command before
continuing a range. It saves a completed page under its original `steps/`
directory only after the complete range, native process and final outcomes
have passed. Partial responses stay in their original SF88 command records,
so that same idempotent range can continue after interruption. It checks
every planned chunk reaches
`FINALIZED` or `IDEMPOTENT_FINALIZED`, then reopens the exact saved
accounting commands after MCP restart. Its result includes those file
hashes alongside the original map, complete ZIP, seller release and
customer receiving identities.
