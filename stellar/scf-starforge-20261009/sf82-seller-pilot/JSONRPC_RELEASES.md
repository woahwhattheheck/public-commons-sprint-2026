# Operate a Stellar RPC merchant through retained releases

Use the package already prepared by the original
[RPC merchant](../sf30-seller-sdk/jsonrpc/README.md) or its
[saved browser workspace](../sf30-seller-sdk/jsonrpc/workspace/README.md).
The same SF82 release store retains that product, compares method and price
changes, selects versions, starts the original merchant, and restores a prior
version. The release console and merchant MCP client open the original private
operations and availability desks for their owned running instance.

Every RPC product remains one fixed paid `POST /stellar/METHOD`. The original
merchant checks its declared data network before opening the seller, admits
the original request schema before payment, and preserves successful provider
response bytes. The RPC plan's payment network and data network remain separate
explicit selections.

## Prepare and stage a product

Run from the complete source checkout using the existing Node/runtime setup:

```sh
RPC=stellar/scf-starforge-20261009/sf30-seller-sdk/jsonrpc/cli.mjs
RELEASES=stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs

node "$RPC" prepare --plan /private/rpc/plan-v1.json \
  --out /private/rpc/prepared-v1
node "$RELEASES" init --store /private/rpc/release-store
node "$RELEASES" stage --store /private/rpc/release-store --id rpc-v1 \
  --jsonrpc-package /private/rpc/prepared-v1 --port 8423 \
  --facilitator https://YOUR_ACTUAL_FACILITATOR
node "$RELEASES" inspect --store /private/rpc/release-store --id rpc-v1
node "$RELEASES" diff --store /private/rpc/release-store --to rpc-v1
```

Create `/private/rpc` as a private directory (0700) first. Supply the actual
reviewed merchant plan and facilitator. For an initial challenge-only merchant,
omit `--facilitator`. An already prepared workspace package can be used directly;
its preparation action displays the package directory.

The installed commands are `starforge jsonrpc` and `starforge releases` with
the same arguments. The maintained distribution's whole SF30/SF82 components
carry this source and the original shared dependencies. The package's existing
native seller setup remains necessary when a facilitator is selected.

`--jsonrpc-package` is one complete source selection. The package owns its
methods, provider declarations, request/result contracts and handlers. Stage
accepts the existing seller port and facilitator settings. A host using an
explicit local RPC development service can add `--allow-loopback-upstream`;
a local facilitator separately requires `--allow-local-facilitator`.

Source inspection validates the original ten-file package and recompiles its
public declarations in memory. It retains exact source bytes, checks the
original compiler manifest hashes, and compares the generated OpenAPI,
selection, binding, offer and service documents with the retained plan. The
generated `handlers.mjs` and `RUN.md` stay in the package as original source.
The runtime loads the maintained RPC merchant directly, so a generated absolute
handler import does not tie a release to its preparation directory.

The release's `jsonrpc` metadata records both networks, every selected method
and atomic price, the original limits, and source/manifest/execution hashes.
The execution hash binds the normalized plan and original compiled service,
including authentication environment references and upstream availability
policy. Public route comparisons also bind the complete original request and
response contract. Provider URL and credential values remain in the host's
private environment.

## Select, run and use the original operations desk

After reviewing a newly initialized store's first release:

```sh
node "$RELEASES" activate --store /private/rpc/release-store --id rpc-v1 \
  --expect 0 --reason "Reviewed RPC methods, data network and payment terms"
node "$RELEASES" run --store /private/rpc/release-store --expect 1
```

The generation numbers above apply to a new store with this one activation.
Read `status` before subsequent selection changes and use its current generation.
Keep the existing HTTPS ingress pointed at the chosen loopback seller port and
the declared `/stellar/*` paths.

Before starting, supply every environment reference returned by the original
RPC inspector. The child uses the original `startRpcCommand`, which resolves
the provider and performs one `getNetwork` read before opening its listeners.
Startup owns the original seller, operations, persistent availability, retained
history and, in native mode, delivery outbox. The operations listener uses an
OS-selected free loopback port.

The foreground `run` output includes the original `operations` links. The
`availabilityControl` link carries the original availability capability in its
fragment. Keep that link in the operator session. To use the browser release
manager instead, stop the foreground owner and open:

```sh
node "$RELEASES" console --store /private/rpc/release-store --port 8425
```

Open its printed private operator URL, select the release, and choose **Start
selected**. **Open merchant operations** shows the original status/history and
native fulfillment workflow. **Manage product availability** opens the same
original route controls, including revision-aware pause and resume. The links
belong to the console's current owned instance and disappear when it stops.

Each release retains its original availability/history/outbox under
`releases/RELEASE_ID/rpc-runtime/`. Restarting or rolling back to that release
reopens its existing controls and history. A new release starts a separate
version's availability state; review maintenance pauses when changing the
active version. Immutable source files remain in `jsonrpc/package/` beside
that runtime directory.

The existing manager's instance ownership, source readback, graceful drain and
startup/shutdown deadlines apply. Closing the owning console or foreground
command closes its original merchant. A second manager observes that owner
and cannot start a duplicate. The operations capability stays in the owning
manager's memory and authenticated session; durable release/status records
retain only the ordinary operations URL.

## Change prices, methods or provider declarations

Prepare a new original package from the revised plan, then stage a new ID:

```sh
node "$RPC" prepare --plan /private/rpc/plan-v2.json \
  --out /private/rpc/prepared-v2
node "$RELEASES" stage --store /private/rpc/release-store --id rpc-v2 \
  --jsonrpc-package /private/rpc/prepared-v2 --port 8423 \
  --facilitator https://YOUR_ACTUAL_FACILITATOR
node "$RELEASES" diff --store /private/rpc/release-store --to rpc-v2
node "$RELEASES" status --store /private/rpc/release-store
```

The original comparison shows added/removed routes, exact payment alternatives,
contract changes and the RPC execution selection. Activate using the current
generation, then explicitly restart through the same owner. The running seller
continues serving its previous version until that restart drains it.

Rollback uses the original retained release and current generation. The console
provides the same selection and restart flow. A restored release reopens its
original private state and verifies its retained package again. To rotate only
credential values, update the host's secret source, drain, and restart the
selected release with the new environment. Changing an environment reference,
data network, method, limit or price belongs in a newly reviewed plan.

## Operate through the existing merchant MCP provider

Initialize a private operator from the same prepared package:

```sh
starforge merchant-mcp init --dir /private/rpc/operator \
  --jsonrpc-package /private/rpc/prepared-v1 --name "RPC merchant" \
  --seller-port 8423 --facilitator https://YOUR_ACTUAL_FACILITATOR
```

This creates the existing `merchant-mcp.json`, release store and customer-export
directory. The source alias `initial` contains the host-selected `jsonrpcPackage`
path and runtime settings. Additional source aliases can select later prepared
packages in that same configuration. Connect the original authenticated HTTP
or stdio transport described in the
[merchant MCP guide](../../../stellar-forge/mcp-merchant-operator/README.md).

1. Inspect `merchant_sources` with `source:"initial"`. It returns original
   public routes, atomic prices, both networks, limits, source hashes and the
   required environment names.
2. Call `merchant_stage` with that alias and a new release ID, then inspect and
   compare that retained release.
3. Activate with its exact digest, current selection generation and reason.
   Start with the same selected digest and new generation.
4. Read `merchant_operations` with the returned current `instanceId` to open
   original operations and availability controls. The tool accepts the owned
   instance identity; the host-selected provider and file locations stay in the
   original configuration.
5. Use `merchant_catalog` and `merchant_client_export` for the original offer,
   OpenAPI, JavaScript and TypeScript customer handoff. Stop/restart/rollback
   use the original instance, digest and generation controls.

After reconnecting, read `merchant_status` before changing the runtime. An
operations link from a previous child cannot control the replacement child.
Source inspection and staging stay offline. Native selling begins through the
original host-selected facilitator when that prepared release starts.

## Prepare a buyer from the retained release

The complete original package remains usable by the original buyer preparer
after its input package moves. Select a retained method and actual request
parameters, then create the original SF88 review:

```sh
starforge jsonrpc buyer \
  --package /private/rpc/release-store/releases/rpc-v1/jsonrpc/package \
  --method getTransaction --body-file /private/rpc/transaction-request.json \
  --intent-id YOUR_STABLE_PURCHASE_ID --out /private/rpc/buyer-review.json
```

The request file must match that selected method and its retained limits; use
an actual transaction hash, ledger window or returned cursor as appropriate.
The original SF88 review and signer perform the purchase using those exact
terms. Every page is a separate explicit request. Preserve the original
JSON-RPC success bytes or use a lossless parser for large numeric literals.
