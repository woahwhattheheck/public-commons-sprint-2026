# Direct single-merchant delivery receiving

This companion continues the existing `SCF-MANAGED-SF98-DELIVERY-E49D-20261012` operation on its completed, closed native merchant fixture. It uses the merged single-store product at `76ae7734c737b2eae5f909c3fef4312d28d3c455` (PR2003) and verifies all sixteen production files against their recorded byte counts and SHA-256 hashes before opening the product.

The original managed source remains `525455c816a49de52e729a15f52d4f9adf9deeb6`. Its driver and receipt remain unchanged. This companion reopens the original blue release store after the managed merchant, workspace, browser, receiver and MCP handles have closed. It performs no additional paid request; the two original local-fixture settlement events and three retained destinations are the receiving input.

## Run on the same equipped worker

Use the existing Node, Python, Playwright and Chromium installation. Supply the completed managed output directory and the new source checkout containing this file and the selected product.

```bash
export SF98_DELIVERY_OUTPUT=/absolute/original-managed-output
export SINGLE_DELIVERY_SOURCE=/absolute/single-release-receiving-source
export SINGLE_DELIVERY_OUTPUT=/absolute/original-managed-output/single-release-receiving
export SF98_DELIVERY_PYTHON=/absolute/python3
export SF98_DELIVERY_NODE_MODULES=/absolute/playwright/node_modules
export SF98_DELIVERY_CHROMIUM=/absolute/chromium
node "$SINGLE_DELIVERY_SOURCE/experiments/single-release-delivery-acceptance/journey.mjs" all
```

The three sequential phases also accept `browser`, `cli` and `mcp`. A later phase requires the earlier retained milestone. Repeating `all` resumes the same state and skips completed phases. Keep the original managed output and its private environment file on that worker.

The original managed receipt must report the same operation, `state: PASS`, all native/browser/MCP phases complete and actual owned-process closure. The companion binds its receipt to that exact original receipt hash, release-store path and product source. It checks the original receipt remains unchanged when it finishes.

## Native product flow

1. Open the original single-store release console and start/stop its owned original seller. Read the two retained settlement events and all three destinations. Open the mounted original SF98 controls, inspect the paused audit destination, and run/stop the original delivery worker.
2. Create a retained exchange through the browser. Lose an actual successful HTTP response, reload the original page, replay the saved request and verify the native retained result. A process-level continuation separately checks the exact saved request before it records replay success.
3. Download the original exchange archive through the browser and compare every extracted file with the original native manifest. Record desktop and 390-pixel layouts and browser errors.
4. Use the original release CLI to list and inspect the same transfer, complete the nested local download and reopen its verified exchange.
5. Open the original MCP host with the same release store and the source-owned delivery provider. Enumerate all ten delivery tools, read/release a native file handle, interrupt an actual retained download after its first 128-byte checkpoint, and continue that same download with the original CLI.
6. Receive the downloaded original exchange into one new customer directory. Verify both delivered destination histories, change the customer's audit pause setting, and replay receiving to confirm the same original receiving receipt preserves that current customer edit.
7. Close MCP and reopen the completed files independently. Reopen the retained original store manifest. Record actual handle closure and preserve the original managed receipt.

The MCP port is selected once and durably retained before startup. The native download engine binds its original endpoint; a resumed phase keeps that exact URL rather than changing the transfer's transport identity. If the retained port is occupied, the original startup error is actionable and the same download remains available for continuation.

The only locally served facilitator route is the original SDK `/supported` discovery response required to start the existing seller. The companion issues no verify/settle request. The retained exchange preserves the original signed-delivery records and receiver history.

## Retained output

`receipt.json` contains the exact product file hashes, original managed receipt hash, completed milestones, capture fingerprint, MCP port, interrupted-download checkpoint, resumed-byte count, customer workspace path, browser errors and actual cleanup result. Screenshots and the original downloaded archive are retained beside it.

The transport manifest lives at `delivery-files.json` beside `exchange/`. The latter contains only the original SF98 manifest/source/destinations layout. The customer receiving operation uses the original native fingerprint and `received.json` identity; it does not recreate an existing customer workspace on retry.

This repository source is a prepared receiving continuation. Native execution results are recorded by the actual same-worker run.
