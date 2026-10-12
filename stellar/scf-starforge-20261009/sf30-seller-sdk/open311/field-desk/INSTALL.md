# Install municipal field work and crew returns

The **open311-field-desk** source selection delivers the complete municipal product: service collections, service reporting, GIS handoff, request/work-order Follow-through, and Field Desk. Each application opens its own saved private directory. Complete original exports connect the desks.

## Build the selected source

From the maintained repository checkout:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo . --ref EXACT_ACCEPTED_SOURCE_COMMIT \
  --selection open311-field-desk \
  --out /absolute/new/field-desk-package --offline
~~~

Choose the accepted source commit and a new output directory. The selection preserves the existing merchant, releases, runtime installer, Applications and file-reader components. Its additive contribution registers the Field Desk command, browser assets, typed exports and merchant provider.

Direct Field Desk modules need Node.js 22.13 or newer with built-in SQLite. The complete installed merchant runtime requires Node.js 22.16 or newer, Linux, Python 3.11 or newer and util-linux flock. The installed source remains under package/source.

| Installed export | Interface |
| --- | --- |
| @tokenjunkielabs/starforge-merchant/seller/open311-field-desk | Original dispatch, crew, visit, return, supervisor and destination APIs and types |
| @tokenjunkielabs/starforge-merchant/seller/open311-field-desk/workspace | Durable editable SQLite workspace |
| @tokenjunkielabs/starforge-merchant/merchant/open311-field-desk | Native merchant provider and initializer |
| @tokenjunkielabs/starforge-merchant/merchant/open311-field-desk/client | Typed adapter for an existing merchant callTool transport |

## Prepare the original private runtime

Run from the directory where the delivered merchant package is installed. Use its actual archive and complete SHA-256:

~~~sh
npx --no-install starforge runtime-install prepare \
  --dir /absolute/private/municipal-runtime \
  --archive /absolute/handover/ORIGINAL_MERCHANT_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

npx --no-install starforge runtime-install install \
  --dir /absolute/private/municipal-runtime

npx --no-install starforge runtime-install inspect \
  --dir /absolute/private/municipal-runtime --load --source
~~~

The prepared runtime uses its delivered package/source and selected node_modules. Continue an interrupted installation with runtime-install resume --dir and the original directory. A populated cache supports --offline --cache /absolute/private/npm-cache. Offline native preparation also needs the compiler and Node headers for the selected executable; --node-headers names the prefix containing include/node.

## Initialize or receive the desk

Initialize a new saved desk:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  open311-field-desk init --workspace /absolute/private/field-desk
~~~

A full delivered Field Desk workspace is received into an empty destination:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  open311-field-desk receive \
  --workspace /absolute/private/received-field-desk \
  --input /absolute/handover/editable-field-workspace.json \
  --request-id receive-field-desk-001 --expected-revision 0
~~~

Receiving preserves original dispatches, crews, visits, attachment bodies, issued packages, returned proposals, supervisor decisions, destination packages and original operation history. The saved database is open311-field-desk.sqlite. Select the received directory when opening its application.

## Open Applications

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  open311-field-desk serve \
  --workspace /absolute/private/field-desk --host 127.0.0.1 --port 0
~~~

The single LISTENING record identifies the loopback URL, workspace UUID, saved-directory binding and live server instance. Open the URL to establish the browser session.

In merchant Applications select **Open311 field work and crew returns**, then the same initialized or received directory. Its source-owned provider reads the original database identity, binds the launch arguments to that directory and verifies the actual live startup response. Receiving into an open empty desk follows the imported workspace identity while retaining directory-based browser recovery.

## Bring selected approved work into the field

Export either the complete reviewed dispatch JSON or full Follow-through workspace from the earlier application. Field Desk source inspection lists actual dispatches when a workspace has several. Select one original dispatch and give its retained source a useful name.

Use the browser to save the named crew, create visits from selected dispatch rows, and issue the chosen visits as crew JSON or complete self-contained HTML. The crew editor opens locally, preserves drafts and produces a partial return carrying its original package and visit versions. The supervisor imports that return, reviews conflicts and explicitly approves destination updates.

[MCP.md](MCP.md) supplies private host configuration, the full typed client and original-file receiving. [WORKSPACE.md](WORKSPACE.md) covers the complete supervisor and crew interfaces. [README.md](README.md) gives direct CLI and source usage.

## Deliver an editable customer workspace

Deliver the complete Field Desk workspace JSON with the chosen crew and destination files, the operating guide and accepted installed source identity. Original attachments travel inside the complete packages. The receiving operator can reopen the issued visits, inspect original returned files, continue partial decisions and create later destination packages.
