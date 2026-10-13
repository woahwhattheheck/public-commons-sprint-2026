# Energy operations

Receive utility sources, prepare reviewed Leap interval deliveries, and operate GridFabric Plaid from the same maintained merchant workspace. Each product keeps its original application, source files, native records and complete customer export.

## Choose the work

| Work | Source selection | Operator |
| --- | --- | --- |
| Review UtilityAPI and Green Button sources, compare intervals, reconcile bills and publish a dataset | `utility-energy` | **Applications → Utility data workspace**, or `starforge utility-energy` |
| Prepare DEVICE interval batches, retain upload results and reconcile missing intervals | `leap-intervals` | `starforge leap-intervals` and its browser console; this selection also includes the Utility application |
| Review Plaid sources and report mappings, receive callbacks, manage event/opt history and reconcile device work | `gridfabric-plaid` | **Applications → GridFabric Plaid**, or `starforge gridfabric-plaid`; this selection includes both Utility and Leap |

Choose the smallest selection that contains the work you intend to operate. The existing product catalog and Source Builds workspace discover these committed recipes. Utility exposes its original 22 merchant tools. GridFabric includes its complete typed SDK, 38 merchant tools and managed application. Leap uses its existing CLI and browser.

## Build and install

Use a complete checkout of [the public source distribution](https://github.com/woahwhattheheck/public-commons-sprint-2026) and select the full release commit. Run the following from that checkout's root, replacing the absolute paths, commit, returned archive name and returned hash. The example selects all three products.

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /source/merchant \
  --ref FULL_RELEASE_COMMIT \
  --selection gridfabric-plaid \
  --out /retained/energy-release

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /retained/energy-runtime \
  --archive /retained/energy-release/RETURNED_ARCHIVE.tgz \
  --sha256 RETURNED_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /retained/energy-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /retained/energy-runtime --load --source
```

Use `--selection utility-energy` or `--selection leap-intervals` for the other recipes. Retain the returned archive and build receipt. Continue an interrupted build with its same repository and output directory plus `--resume`; continue installation through the same runtime's existing journal.

The complete selected runtime uses Linux, Node 22.16 or later, Python 3.11 or later, Expat 2.6 or later in that Python, and `flock`. Full browser receiving takes an existing compatible Playwright module and Chromium executable. GridFabric's customer archive also uses GNU `tar`. The selected package and original installer supply the declared Node dependency graph.

A READY installation places the complete source at `/retained/energy-runtime/package/source` and its manifest at `/retained/energy-runtime/package/manifest.json`. Register that runtime in the existing Runtime workspace.

## Open and complete the customer work

**Utility.** Initialize a new private workspace with the installed command, or restore the customer's complete existing packet using its retained SHA-256:

```sh
node /retained/energy-runtime/package/source/stellar/scf-starforge-20261009/distribution/cli.mjs \
  utility-energy --python /host/python3 \
  --workspace /private/utility-workspace init
```

Choose **Utility data workspace** in Applications, select that workspace and the existing Python, then Review, Save and Start. Review the complete imported XML/JSON and source priorities, build the selected native edition, inspect intervals and comparisons, reconcile bills and export the customer workspace. The [Utility operator guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/utility-energy/README.md) describes the original source, units and publication workflow; the [managed guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/utility-energy/MANAGED_APPLICATION.md) covers connection and reopening.

**Leap.** Initialize a new workspace once, then open its original console:

```sh
node /retained/energy-runtime/package/source/stellar/scf-starforge-20261009/distribution/cli.mjs \
  leap-intervals --python /host/python3 \
  --workspace /private/leap-workspace init

node /retained/energy-runtime/package/source/stellar/scf-starforge-20261009/distribution/cli.mjs \
  leap-intervals --python /host/python3 \
  --workspace /private/leap-workspace serve \
  --port 0 --connection-file /private/leap-console.url
```

Open the private connection written by that owner. Review complete source files and DEVICE mappings, prepare the batch, inspect rows and issues, and submit the selected provider action. Reconcile the original upload and complete missing-window pages before exporting the workspace. The [Leap operator guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/leap-intervals/README.md) and [retained provider contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/leap-intervals/contracts/SOURCES.md) define account custody, permitted device creation and interval semantics.

**GridFabric.** Initialize or restore the original GridFabric workspace with `starforge gridfabric-plaid`, then choose **GridFabric Plaid** in Applications and save it against the READY runtime. Start opens the same native SQLite owner; Stop drains it and releases its lease. The browser supports source and correction intake, report mappings and full report files, callback history, event/opt decisions and reviewed management/device operations. Use the [operator guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/README.md), [domain guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/DOMAIN_OPERATIONS.md) and [SDK/MCP guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/SDK_MCP.md) for the complete workflow.

For an existing customer, reopen or restore that customer's records at the selected private path. Keep its original request IDs and complete source files when reconciling an interrupted action.

## Receive a complete customer installation

The product receivers exercise the original application, export the complete workspace, reopen the customer copy and retain its files. Select the receiving path that matches the work:

| Product | Complete receiving entry |
| --- | --- |
| Utility browser, client, MCP, CLI and managed start/stop/reopen | [Utility receiving](../../operations/scf-utility-energy-receiving-20261012/README.md) |
| Build one runtime and complete Utility followed by Leap | [Utility → Leap receiving](../../operations/scf-leap-interval-receiving-20261012/README.md) |
| GridFabric native SQLite/HTTP/CLI and portable customer copy | [GridFabric native receiving](../../operations/scf-gridfabric-plaid-receiving-20261012/README.md) |
| GridFabric SDK/MCP and managed restart with complete customer files | [GridFabric managed receiving](../../operations/scf-gridfabric-plaid-managed-receiving-20261012/README.md) |

For a new Utility or Leap receiver on a current installation, set these fields in its private configuration alongside the workflow's required original inputs:

```json
{
  "sourceRoot": "/retained/energy-runtime/package/source",
  "sourceManifest": "/retained/energy-runtime/package/manifest.json",
  "runtimeDirectory": "/retained/energy-runtime",
  "expectedSourceCommit": "FULL_RELEASE_COMMIT"
}
```

The installed mode checks the complete package member list and binds it to this runtime's actual manifest. A different selection built from the same commit has its own manifest. The original frozen declarations remain available for their existing source cuts and receiving journals.

A fresh Utility → Leap sequence defaults to `"sourceMode": "installed-package"`. It builds the selected source, inspects the installed runtime, and passes that runtime's complete manifest to both original receivers. Existing sequence journals without this field retain their original legacy mode; continue them with their same configuration and source.

GridFabric's native receiver uses the same complete manifest path and its existing `sourceCommit` field. The managed receiver uses the actual READY runtime and the existing populated native and Applications workspaces.

## Keep the completed delivery together

Retain the original build archive and receipt, the product's completed operation report, its complete portable workspace and customer delivery archive. Continue transfers from their recorded results. Reopening uses the original product's restore and receiving commands, preserving source editions, corrections, reviewed mappings, request history and received files.

The detailed package guides are [Utility](../../stellar/scf-starforge-20261009/distribution/selections/UTILITY_ENERGY.md), [Leap](../../stellar/scf-starforge-20261009/distribution/selections/LEAP_INTERVALS.md) and [GridFabric](../../stellar/scf-starforge-20261009/distribution/selections/GRIDFABRIC_PLAID.md).

## Customer Operating Plans

The GridFabric selection includes Command finder and the customer procedure workflow. Run `starforge gridfabric-procedure --help` to prepare a nine-step operating plan, capture complete selected records and files from the running authenticated GridFabric workspace, and reopen the complete customer history. The [procedure guide](../../stellar/scf-starforge-20261009/distribution/discovery/GRIDFABRIC_PROCEDURES.md) covers configuration, sources, mappings, callbacks, event decisions, dispatch outcomes, reports and delivery. Import the returned plan JSON into **Command finder → Operating Plans**, then continue and return revisions through that existing workspace.
