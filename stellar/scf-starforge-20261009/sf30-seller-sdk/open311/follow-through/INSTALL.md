# Install municipal request and work-order follow-through

The **open311-follow-through** source selection delivers four merchant Applications: municipal service operations, service performance, GIS handoff and request/work-order follow-through. Each uses its own private saved directory. Full source and receiving files connect the workflows.

## Build the selected repository edition

From the complete maintained checkout:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo . --ref EXACT_SOURCE_COMMIT \
  --selection open311-follow-through \
  --out /absolute/new/follow-through-package --offline
~~~

Use the exact accepted source commit and a new output directory. The selection retains the existing merchant, release, runtime installation, Applications, provider registration and retained-file components. It adds the follow-through command, typed exports, provider and browser asset manifest through distribution/contributions/open311-follow-through.json.

Source modules are available under package/source. Direct follow-through modules require Node.js 22.13 or newer with built-in SQLite. The complete installed merchant runtime requires Node.js 22.16 or newer, Linux, Python 3.11 or newer and util-linux flock.

| Installed export | Interface |
| --- | --- |
| @tokenjunkielabs/starforge-merchant/seller/open311-follow-through | Typed source, profile, edition, review, dispatch, workspace and server APIs |
| @tokenjunkielabs/starforge-merchant/seller/open311-follow-through/workspace | Durable follow-through SQLite workspace |
| @tokenjunkielabs/starforge-merchant/merchant/open311-follow-through | Merchant provider implementation |
| @tokenjunkielabs/starforge-merchant/merchant/open311-follow-through/client | Typed adapter for an existing merchant callTool transport |

## Prepare the original private runtime

Run these commands from the private directory where the delivered source-only merchant package is installed. Select its original archive and exact complete archive hash:

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

The ready runtime keeps the delivered source under municipal-runtime/package/source and its selected dependencies under municipal-runtime/node_modules. Run commands through this prepared runtime to use that same source and dependency edition.

For an interrupted installation, run runtime-install resume --dir with the original private runtime directory. A populated cache supports --offline --cache /absolute/private/npm-cache. Offline native-module preparation also requires a compiler and Node headers matching the selected Node executable; --node-headers selects a prefix containing include/node.

## Initialize or receive the saved desk

Initialize a new operating directory:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  open311-follow-through init \
  --workspace /absolute/private/follow-through
~~~

For a delivered workspace, receive it into an empty directory first:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  open311-follow-through receive \
  --workspace /absolute/private/received-follow-through \
  --file /absolute/handover/complete-follow-through.json \
  --request-id receive-original-follow-through-001 --expected-revision 0
~~~

The received desk retains the original workspace ID, source and decision history, and adds the receiving action. Its database is open311-follow-through.sqlite. Select that received directory when opening Applications.

## Open the browser

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  open311-follow-through serve \
  --workspace /absolute/private/follow-through \
  --host 127.0.0.1 --port 0
~~~

The compact LISTENING record contains the loopback URL, workspace ID, saved-directory binding and live server instance. Open that URL to initialize the browser session.

In the merchant runtime workspace, choose **Open311 request/work-order follow-through** and select the same initialized or received directory. Its source-owned application provider reads the database identity, binds the startup command to the original directory and verifies the live launch response. The complete browser source and asset routes are declared by the additive contribution.

A receive action from an already open empty browser follows the imported workspace identity. Pending input and operator drafts remain keyed to the original saved directory, so recovery survives reload after receiving.

## Select original sources and mappings

Keep the complete request and order files, layer metadata and capture receipts together. Use the Sources inspector to select exact original datasets or pages. Request and order sources have separate source-series identities. A named operating edition selects those saved sources and one immutable profile revision.

The included examples/manatee-request-profile.json is a starting profile for the named original QAlert fields. A different municipality requires its actual business identities and field mappings. Order identity mappings can remain empty for a request-only edition; choose actual work-order fields before building an edition with an order source.

The source inspector supports complete Open311 collection exports and service-report JSON, alongside the provider-native source formats. A GIS export can be supplied as GeoJSON or CSV, with an explicit profile for its actual property names and an original source-series identity.

## Configure merchant tools

Follow [MCP.md](MCP.md) to declare the original workspace directories and exact source/reviewer/receiving file aliases in a private connection file. The provider is open311-follow-through-workspaces and its initializer is initializeFollowThroughMerchantWorkspace.

The initializer reuses the original SF82 release store or prepares its own through the maintained initializer. It persists setup intent and attempts so the original arguments resume an interrupted setup. Generate the client configuration on the actual host that will run the installed merchant; its absolute Node and stdio paths belong to that host.

## Customer delivery

A complete delivery includes the full follow-through workspace JSON, selected reviewed dispatch outputs, the human operating report and the exact installed source/archive identity. The receiving operator can inspect original source files, profile revisions, relationship decisions, assignments, reviewer files and all saved dispatches, then continue work in the independently received desk.

[WORKSPACE.md](WORKSPACE.md) provides the complete browser workflow. [README.md](README.md) supplies equivalent CLI and source APIs. [SOURCE_FORMATS.md](SOURCE_FORMATS.md) describes source semantics, reviewer interchange, CSV and GeoJSON. [MCP.md](MCP.md) covers complete files and typed automation.
