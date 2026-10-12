# Install the Open311 GIS operating product

The open311-gis selection includes three applications: **Open311 municipal service operations**, **Open311 service performance**, and **Open311 GIS handoff**. Each operates its own saved directory. Complete collection/report files carry the original source selection into GIS; the GIS receiving package carries the whole editable analyst/review/dispatch workflow to another installation.

## Build one exact source edition

From the selected repository checkout:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo . --ref EXACT_GIS_SOURCE_COMMIT \
  --selection open311-gis \
  --out /absolute/new/open311-gis-package --offline
~~~

Choose the exact source revision and a new output directory. The selection includes the maintained release/installation tools, the three Open311 components, the merchant provider contributions and browser assets. The product uses the existing starforge executable. Source modules remain available under package/source.

Direct GIS modules require Node.js 22.13 or newer with built-in SQLite. The complete installed merchant runtime requires Node.js 22.16 or newer, Linux, Python 3.11 or newer and util-linux flock. GeoPackage support uses the built-in SQLite implementation.

The installed exports are:

| Export | API |
| --- | --- |
| @tokenjunkielabs/starforge-merchant/seller/open311-gis | Typed source, format, handoff, review, dispatch, workspace and server functions |
| @tokenjunkielabs/starforge-merchant/seller/open311-gis/workspace | Durable GIS workspace |
| @tokenjunkielabs/starforge-merchant/merchant/open311-gis | Original merchant provider |
| @tokenjunkielabs/starforge-merchant/merchant/open311-gis/client | Typed adapter for the existing merchant callTool transport |

## Prepare the original private runtime

Run these commands from the private directory where the delivered source-only merchant package is installed. Use the original delivered archive and its exact SHA-256:

~~~sh
npx --no-install starforge runtime-install prepare \
  --dir /absolute/private/municipal-runtime \
  --archive /absolute/handover/ORIGINAL_GIS_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

npx --no-install starforge runtime-install install \
  --dir /absolute/private/municipal-runtime

npx --no-install starforge runtime-install inspect \
  --dir /absolute/private/municipal-runtime --load --source
~~~

Wait for READY. The original runtime profile selects the archive's declared dependencies, keeping its source under municipal-runtime/package/source and dependencies under municipal-runtime/node_modules.

Resume an interrupted installation with runtime-install resume --dir /absolute/private/municipal-runtime. With an existing populated cache, add --offline --cache /absolute/private/npm-cache to install or resume. Offline native-module preparation needs a compiler and Node headers matching the actual selected executable; --node-headers /absolute/private/node-prefix selects a prefix containing include/node.

Run installed commands through this prepared runtime so their source and dependencies remain aligned:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  open311-gis init --workspace /absolute/private/municipal-gis
~~~

## Acquire or choose complete source files

The existing municipal operations desk exports a complete collection as kind json:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  open311 export --workspace /absolute/private/municipal-operations \
  --collection COLLECTION_ID --kind json \
  --out /absolute/handover/municipal-collection.json
~~~

A selected service-report JSON export contains its original collection sources and report interpretation:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  open311-reporting export --workspace /absolute/private/municipal-reporting \
  --report REPORT_ID --kind json \
  --out /absolute/handover/municipal-report.json
~~~

Keep the complete source file unchanged. Open the GIS desk's source inspector to select its saved report when a package contains several reports. Imported source windows, unresolved caps, original status notes and attribution remain visible in GIS coverage and exports.

## Open the saved GIS application

After initializing or receiving the GIS directory, start its browser directly:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  open311-gis serve --workspace /absolute/private/municipal-gis \
  --host 127.0.0.1 --port 0
~~~

The compact LISTENING line contains the private URL, original workspace ID, directory binding and server instance. Open that URL to establish its browser session.

For merchant Applications, open the existing runtime workspace with this prepared runtime and choose **Open311 GIS handoff**. Select the same initialized GIS directory. The application provider reads open311-gis.sqlite, binds the selected original workspace ID and verifies the live startup record before opening the browser. The GIS source command and browser assets are declared by the additive open311-gis contribution.

When receiving a complete customer workspace, receive into a new empty GIS directory first, then select that received directory in Applications. The receiver keeps the original workspace identity and adds the receiving action to its history. An already open receiving browser follows the new identity and retains its recovery information by the selected directory.

## Complete the operating workflow

The [browser guide](WORKSPACE.md) covers source inspection, map/table handoff selection, analyst files, returned proposals and conflicts, supervisor decisions, mapped dispatch outputs, exact command recovery and complete workspace receiving.

The [source/API guide](README.md) provides equivalent CLI definitions and examples. The [format guide](FORMATS.md) describes the GeoPackage layers, GeoJSON geometry, immutable source columns and reversible CSV encoding. The [merchant guide](MCP.md) configures original input aliases, initializes the maintained merchant host and operates complete files through the existing retained reader.

A complete GIS handover should include the workspace JSON and the selected human/GIS outputs. The receiving operator can reopen all source editions, original returned files, review decisions and dispatch mappings, then continue the same workflow in the new private directory.
