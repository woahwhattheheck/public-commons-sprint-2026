# Install municipal service configuration

The **open311-service-configuration** source selection delivers the complete municipal suite: source collection, reporting, GIS, request/work-order Follow-through, Field Desk and service configuration. Each application opens its own saved private directory; full original exports connect them.

## Build the selected source

Use the accepted source commit from the maintained repository:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo . --ref EXACT_ACCEPTED_SOURCE_COMMIT \
  --selection open311-service-configuration \
  --out /absolute/new/service-configuration-package --offline
~~~

Choose a new output directory. The selection carries the original merchant, release store, native installer, Applications and retained-file components. The additive contribution registers the service command, browser assets, four typed exports and source-owned merchant provider.

Direct service modules require Node.js 22.13 or newer with SQLite. The maintained complete merchant runtime requires Node.js 22.16 or newer, Linux, Python 3.11 or newer and util-linux flock. Delivered original sources remain under `package/source`.

| Package export | Interface |
| --- | --- |
| @tokenjunkielabs/starforge-merchant/seller/open311-service-configuration | Configuration, source, routing, calendar, release and workspace types/API |
| @tokenjunkielabs/starforge-merchant/seller/open311-service-configuration/workspace | Durable editable SQLite workspace |
| @tokenjunkielabs/starforge-merchant/merchant/open311-service-configuration | Installed merchant provider and original initializer |
| @tokenjunkielabs/starforge-merchant/merchant/open311-service-configuration/client | Typed adapter for the existing merchant callTool transport |

## Prepare the original private runtime

Run from the delivered merchant package directory. Select its actual archive and complete SHA-256:

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

Continue an interrupted original installation with `runtime-install resume --dir` and its existing directory. A populated package cache supports `--offline --cache /absolute/private/npm-cache`. Offline native preparation also uses the compiler and Node headers for the selected executable; `--node-headers` identifies the prefix containing `include/node`.

## Initialize or receive the workbench

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  open311-service-configuration init \
  --workspace /absolute/private/service-configuration
~~~

A complete delivered service workspace is received into an empty directory:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  open311-service-configuration receive \
  --workspace /absolute/private/received-service-configuration \
  --input /absolute/handover/service-workspace.json \
  --request-id receive-service-001 --revision 0
~~~

Receiving preserves the original files, all saved profile versions, whole-register previews, declared baselines, implementation handovers and original action history. The database filename is `open311-service-configuration.sqlite`. Select the received directory when opening its application.

## Open Applications

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  open311-service-configuration serve \
  --workspace /absolute/private/service-configuration --host 127.0.0.1 --port 0
~~~

The compact LISTENING record identifies the actual loopback URL, workspace UUID, saved-directory binding and server instance. Open its URL.

In merchant Applications select **Municipal service configuration**, then the same initialized or received directory. The source-owned provider reads the original SQLite identity, binds launch arguments to that directory and verifies the live startup response. Browser draft and interrupted-operation recovery remain bound to the selected directory through receiving.

## Configure and review the whole service

The browser's complete editor covers agency settings, departments and staff, role/group declarations, categories and custom fields, source profiles, routing, templates and rollout. Retain a complete original request file and choose its row array. Save a configuration version, inspect the full resulting routing register, and prepare explicit overrides or resident wording as needed.

A named implementation release keeps the exact profile version, original source, preview, baseline declaration and review together. Its printable handover and JSON preserve remaining requests and the application order. The full editable workspace lets the receiving operator continue the same configuration history.

[MCP.md](MCP.md) supplies private host setup, named source/profile files, paged views and complete file delivery. [WORKSPACE.md](WORKSPACE.md) describes the operator controls. [README.md](README.md) gives source and CLI operations.

## Customer handover

Deliver the full editable workspace JSON, original source, selected configuration, complete routing CSV/JSON, implementation JSON/report and the ordinary operator guide. Keep the accepted installed source identity with that handover. The receiving operator can inspect original decisions, compare declared baseline implications, save the next profile version and build a new source-bound preview.
