# Fleet discovery continuation

This native continuation runs immediately after the accepted public customer SDK journey and reopens its original fleet directory. Select it with the SDK driver's FLEET_CLIENT_DISCOVERY_PHASE option.

The source inputs are the original public JSONRPC getTransaction plan and Python summarize/amortize application retained by the customer SDK driver. The continuation keeps that driver's completed receipt and fixed-store plan byte for byte. It stages a new original Python release in the existing inactive green store, changes summarize from 20,000 to 25,000 atomic units, and removes amortize. The managed fleet's original review, prepare and activate operations select that release.

## Select the same receiving operation

Use the existing source/runtime placement and the original compute operation selected by the receiving owner. All paths below refer to that host's retained files.

~~~sh
FLEET_CLIENT_SOURCE=/absolute/composed-product \
FLEET_CLIENT_OUTPUT=/absolute/owned-fleet-acceptance \
FLEET_CLIENT_NODE_MODULES=/absolute/equipped-node-modules \
FLEET_CLIENT_CHROMIUM=/absolute/equipped-chromium \
FLEET_CLIENT_PYTHON=/absolute/equipped-python \
FLEET_CLIENT_DISCOVERY_PHASE=/absolute/phase.mjs \
node /absolute/customer-sdk-journey.mjs
~~~

The public SDK driver is experiments/fleet-customer-acceptance/journey.mjs at commit 210ebaf33fc1824eb3097c1a877633e5c1caa707 in woahwhattheheck/public-commons-sprint-2026. Its source SHA-256 is 900671ced59dda15d3f32bc5d55a54fc25cb7edc877794879b4f85b98924ed9a. The selected composed SDK/discovery product is commit 4f209f684ed81bb04d12d7103d689650dd42f698.

The exported function is:

~~~js
await runFleetDiscoveryPhase({
  source, base, directory, planFile, receiptFile, receipt
});
~~~

The driver invokes the function after its own receipt reaches PASS and its owned native, browser, CLI, MCP and provider handles have closed. A resumed invocation with the original SDK PASS receipt runs only the selected discovery continuation.

## Original native flow

1. Stage the original Python replacement through SF82 while the fleet manager is closed. Retain its native descriptor and digest before the managed review.
2. Create a real first-use interruption in the Python enrollment: an isolated child runs the original setup with its own 256-byte RLIMIT_FSIZE. Its key is committed before a later original file write returns EFBIG. The browser reviews the current incomplete-file inspection and the original recovery preserves every partial byte before enrollment.
3. Enroll the RPC and Python tenants through the managed browser, start their original signed catalog and buyer explorer, and publish the original payment choices.
4. Browse native pages with actual provider offsets and available opaque cursors. Download the original SF61 observed-page envelope and pass those exact bytes to original SF88 prepareReview, retaining the selected provider row, amount, recipient, source hash and submitted filters.
5. Change the Python serving slot through original fleet review, prepare and activate. Verify the old discovery review is invalidated by the new original serving identity and revision.
6. Review 20,000 → 25,000 atomic units, forward the real signed publication, and discard its browser response after the native commit is read. The original browser reconciles current state. Its completed review cannot be submitted again automatically.
7. Retire the former Python slot, read its retained original release, withdraw amortize under the current serving guard, and download its native signed history.
8. Stop and restart the owned discovery services, capture desktop and 390-pixel browser views, then reopen the same tenant enrollment and history through the original CLI and authenticated MCP.
9. Read the original SDK completion manifests from retired RPC/Python slots and compare them with the customer driver's retained receipt.

The local getNetwork provider is the same explicit testnet metadata fixture used by the public SDK journey. Requests and signed catalog result fields are retained in the continuation receipt.

## Retained output and recovery

The continuation stores its independent receipt, downloaded public enrollment, native source/history, observed buyer page, prepared buyer configuration and browser screenshots under OUTPUT/discovery/. Its original signing state belongs to OUTPUT/fleet/discovery/TENANT; interrupted setup bytes are preserved by the original fleet recovery beneath OUTPUT/fleet/discovery-recovery/.

A completed mutation is reconciled from the original source and journal on resume. The continuation retains its stage intention, exact original source descriptor, enrollment recovery inspection, publication request and returned native result before advancing its receipt. Original SDK receipt and plan hashes are checked again at completion. Each browser/CLI/MCP owner closes before the next opens; final output records released listeners and retained customer identities.
