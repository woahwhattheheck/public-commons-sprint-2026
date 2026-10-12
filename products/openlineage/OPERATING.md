# OpenLineage operations — installed product

The `openlineage-operations` selection delivers the complete lineage workspace through the existing Starforge builder, installer, Applications lifecycle and merchant host. Operators can receive original producer events, inspect jobs, runs and datasets, review a saved edition, attach its complete result files, and hand an editable workspace to another operator.

## Product entry points

| Surface | Entry |
| --- | --- |
| Browser | **OpenLineage operations** in the existing Applications view |
| Operator CLI | `starforge openlineage` |
| Native API and typed client | The original HTTP server and `./seller/openlineage` package export |
| Direct MCP | `starforge openlineage mcp --workspace DIR` |
| Managed merchant agent | The source-owned OpenLineage workspace provider |
| Source-selected installation | `--selection openlineage-operations` |
| Complete customer handover | Original events, results, editions, reviews, operation history and portable application |

The [complete source/API guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/README.md) explains producer intake, entity and facet semantics, the API catalog, typed client, and direct receiving. The [source contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/SOURCE_CONTRACT.md) identifies the original upstream contracts and untouched examples.

## Build the selected source

Choose `openlineage-operations` in the existing Runtime workspace's **Build a product** view. Select the full source commit, review the product, and build into a new owned output directory. The resulting archive opens in the existing **Source & profile** view.

The same operation is available from the source checkout:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace-checkout \
  --ref ORIGINAL_FULL_COMMIT \
  --selection openlineage-operations \
  --out /absolute/openlineage-release
```

The returned archive, SHA-256 and source manifest identify this exact product edition. The manifest retains the original selection, contributions, source paths, original Git objects and complete byte identities. Use that returned archive when installing or transferring the product.

Continue an interrupted build through its original output:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace-checkout \
  --out /absolute/openlineage-release --resume
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/openlineage-release --status
```

The saved output retains its original commit and selection. A different product or source edition uses a different output. The [maintained source-build guide](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/SOURCE_BUILDS.md) covers browser operation, offline Git acquisition, original locks and continuation.

## Install the maintained merchant profile

The portable OpenLineage application itself uses Node builtins and runs on Node 22 or later. The maintained merchant installation uses the existing Node 22.16+ runtime and its selected native, schema, OpenAPI, MCP and operator dependencies. Their exact versions come from the selected source and retained dependency lock.

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/openlineage-runtime \
  --archive /absolute/openlineage-release/ORIGINAL_PACKAGE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/openlineage-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/openlineage-runtime --load --source

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/openlineage-runtime -- openlineage --help
```

Use the original installer's dependency adoption and offline transfer flows when an existing complete dependency tree is available. Its retained lock, source inspection and READY state stay with the same runtime. The [runtime installation guide](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) provides these operations.

The commands below use the installed `starforge` executable. If it is not on PATH, use the same `runtime-install-cli.mjs run --dir /absolute/openlineage-runtime --` prefix and pass the command shown after `starforge`.

```sh
starforge source
starforge registrations --source openlineage-workspace
starforge merchant-providers list
```

## Open the customer's workspace

Initialize a new private project once:

```sh
starforge openlineage init \
  --workspace /absolute/private/lineage \
  --title "Pipeline operations"

starforge openlineage serve \
  --workspace /absolute/private/lineage --port 0
```

Open the printed URL. For managed operation, register the READY runtime in the existing Runtime workspace, open **Applications**, and select **OpenLineage operations**. Choose this initialized workspace and an optional private token file. Review and save the launch, then use the existing Start, Open and Stop controls. Reopen a received project through the same application entry.

The application verifies its workspace identity and server instance when connecting. The browser retains an exact pending mutation before sending it. If a response is interrupted, reopen the same workspace and recover that original action. A revision conflict presents the current state for review before a new intended change.

## Receive producer originals and save a review

Import the complete producer JSON, event array or NDJSON file:

```sh
starforge openlineage import \
  --workspace /absolute/private/lineage \
  --input /absolute/producer/events.ndjson \
  --name events.ndjson \
  --source https://YOUR_PRODUCER/retained-run-log \
  --operation-id original-producer-capture

starforge openlineage edition \
  --workspace /absolute/private/lineage \
  --title "Reviewed production run" \
  --operation-id original-reviewed-edition
```

The source reference is retained metadata. Imports preserve every original byte, the producer's namespaced identities, original event content and its source positions. Later observations retain their original content while the operational view applies the relevant facet replacement and deletion rules.

Use the browser's entity inspector to follow the original event and active lineage. Save a reasoned review against the chosen edition and entities. Attach an existing result file with its source reference and original query where applicable. The result's complete bytes remain attached to that edition even after later imports.

Compare saved editions before adopting an upstream change. The full report and source downloads preserve the inspection context. The [source contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/SOURCE_CONTRACT.md) describes how explicit lineage, input/output boundaries, supported schema versions and historical observations are represented.

## Native agents share the same owner

The direct CLI, browser, typed client and MCP interfaces call the same revisioned workspace. Managed merchant access connects to the running application's original connection file and binds the selected workspace and instance. File-input aliases can name complete original event or result files with their SHA-256, so the operator can transfer actual retained files through the existing private configuration.

Use the [merchant operating guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/MERCHANT.md) for provider setup, tools, exact request recovery and complete downloads. `workspace.metadata` returns the current revision and retained counts. `records.read` pages through complete collections at that same revision; continue `nextOffset` until it is null. The `operations` collection is the complete workspace journal and is read without an edition restriction. It retains original saved outcomes for recovery.

Preserve the same operation ID and original mutation arguments after an uncertain response. Reconnecting to a restarted application is explicit. A new intended action receives a new ID after its current state has been reviewed.

## Complete delivery and receiving

Create the full editable workspace package:

```sh
starforge openlineage export \
  --workspace /absolute/private/lineage \
  --out /absolute/delivery/openlineage-workspace.json

starforge openlineage report \
  --workspace /absolute/private/lineage \
  --format html --out /absolute/delivery/openlineage-report.html
```

The workspace package includes all retained source and result objects, saved state, editions, review history, original operation outcomes, and every portable application file. Each original object and application file has a byte length and SHA-256. Receiving derives event attribution and edition membership from the original source bytes.

Receive into a new directory and reopen the original workspace identity:

```sh
starforge openlineage verify \
  --input /absolute/delivery/openlineage-workspace.json

starforge openlineage receive \
  --input /absolute/delivery/openlineage-workspace.json \
  --out /absolute/received-lineage

node /absolute/received-lineage/application/cli.mjs serve \
  --workspace /absolute/received-lineage --port 0
```

The receiving directory contains the original state and objects plus its own editable `application/` source. The receiver can inspect, import, review, attach results, export and reopen this same project. The maintained installed application can also select that received workspace.

For large exported packages, the typed client and merchant adapter support complete range downloads with original byte identities. Keep the same original export ID, destination and partial download record when continuing. A completed identical destination is reused.

Deliver the selected source archive and its installer receipt alongside the customer's workspace package when the recipient needs the entire managed merchant installation. Follow the original Runtime transfer workflow to carry its selected dependency profile and complete installation. Keep project data in its private project directory across runtime upgrades.

## Run the complete native operating journey

The source includes `RECEIVING.mjs`, a complete original operation using the retained upstream OpenLineage examples and actual native HTTP, client and MCP. It imports complete sources, saves and compares editions, inspects lineage, reviews an entity, attaches an original reference file, recovers an original mutation, writes complete reports, downloads the full export, receives into an independent directory and starts that received application.

From the OpenLineage source directory:

```sh
node RECEIVING.mjs /absolute/new-openlineage-receiving
```

Use a new owned receiving directory for a new run. The programme records its actual progress and final result in that directory, preserves its complete generated outputs, and closes its two native servers. Browser operation can be reviewed by opening the received workspace through the normal serve command.
