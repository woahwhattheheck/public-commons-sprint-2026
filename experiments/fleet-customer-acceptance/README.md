# Original fleet customer SDK acceptance

This is the single receiving driver for the existing `SCF-FLEET-CUSTOMER-E49D-20261011` operation. It exercises the maintained fleet browser, terminal, MCP tools, original SF82 client exporter and retained downloader against real original RPC and Python seller processes.

The public inputs are the repository's original `sf30-seller-sdk/jsonrpc/example-plan.json`, `python/example-merchant.json` and `python/example-application.py`. The driver compiles the RPC packages through `preparePackage` and bootstraps both merchants through `bootstrapFleet`. RPC terms change from 19000 to 23000 atomic units; both original Python functions use 20000. The addresses are deterministic public fixture addresses. The local RPC provider serves the original getNetwork startup request, and the native sellers run in their original challenge mode.

## Receiving source and runtime

Select the complete maintained repository source containing the fleet customer desk. Commit `40b743a263596f8f6f9d39932e39f93bd2beb8c2` retains all 15 desk paths plus the current ClickHouse, managed-host and merchant-adapter joins. If selecting the discovery phase, use the supplied complete discovery composition as `FLEET_CLIENT_SOURCE`, preserving those customer changes.

Reuse the receiving worker's existing Node, Playwright, Chromium, Python and original merchant dependencies. The original merchant dependency tree must resolve from the selected repository; Playwright may resolve from a separate installed runtime. The Python example uses only the standard library.

```sh
FLEET_CLIENT_SOURCE=/absolute/retained/source \
FLEET_CLIENT_OUTPUT=/absolute/private/fleet-customer-output \
FLEET_CLIENT_NODE_MODULES=/absolute/installed/node_modules \
FLEET_CLIENT_CHROMIUM=/absolute/installed/chromium \
FLEET_CLIENT_PYTHON=/absolute/installed/python3 \
node --max-old-space-size=256 /absolute/retained/journey.mjs
```

The output directory is private. The original operation owns admission and the receiving process; keep its accepted placement and queue identity. The cloud-side command had not dispatched when the physical receiving handoff was selected.

## Complete native workflow

The driver creates two merchants with two original retained release stores each. It then:

1. Opens the maintained browser, generates the same customer export ID in two merchant scopes, checks the exact files and downloaded archive, and cancels a real throttled browser transfer before switching scopes.
2. Stages the new RPC price through the original fleet operator, activates it, retires the old child, and reads the original SDK from the retired slot. It adopts an inspected original legacy client directory and captures the desktop and 390-pixel layouts.
3. Closes the browser and managed workspace, reopens the original terminal operator, reads retained export pages and resumes an interrupted download to a path containing two consecutive spaces.
4. Closes that owner, reopens authenticated MCP, checks its seven customer tools, generates current terms, reads exact byte ranges, closes the original read handle and verifies retained export reopening.

The public declaration and application hashes are retained in the receipt. Each milestone records its actual native result, and the final receipt includes the selected maintained source hashes. All owned browser, workspace, terminal, MCP and local-provider handles close before completion.

## Continuation and discovery

`FLEET_CLIENT_OUTPUT/receipt.json` retains the actual fleet plan path, source identities, exports and completed stages. Reuse the same directory when continuing an interrupted operation. A completed SDK receipt is reused.

To execute the separate original discovery phase after SDK cleanup, also set:

```sh
FLEET_CLIENT_DISCOVERY_PHASE=/absolute/retained/discovery-phase.mjs
```

That module exports:

```js
export async function runFleetDiscoveryPhase({
  source, base, directory, planFile, receiptFile, receipt
}) { /* original discovery continuation */ }
```

The hook runs after the SDK receipt reaches `PASS` with `ownedProcessesClosed: true`. It receives the existing fleet directory and plan, and owns a separate discovery receipt. If the SDK already completed, a restart invokes only the selected discovery phase. The driver also exports the same `completion` descriptor for a receiving wrapper.

The completed SDK fleet has RPC green `rpc-v2` at 23000, retained retired RPC blue `rpc-v1` at 19000, Python blue `python-v1` at 20000, and native revision 2. The discovery continuation reopens those original stores and establishes its own short-lived getNetwork provider for the existing RPC environment reference.
