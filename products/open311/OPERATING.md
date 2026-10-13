# Operate the complete municipal service suite

The open311-service-configuration source selection installs six applications for municipal source collection, service reporting, GIS analysis, request/work-order follow-through, crew field work and service implementation. Each application opens its own saved private workspace. Complete original exports connect the operating stages and let another operator receive and continue the work.

Use this guide for installation, saved-directory launch, runtime preparation and merchant attachment. [WORKFLOWS.md](WORKFLOWS.md) describes the complete customer workflows and the exact files that connect them. [RECEIVING.md](RECEIVING.md) gives all six editable-workspace receiving commands and their identity behavior.

## Choose the operating desk

| Application in Applications | Command | Application ID | Saved SQLite file |
| --- | --- | --- | --- |
| Open311 service operations | open311 | open311-operations | open311.sqlite |
| Open311 service performance | open311-reporting | open311-reporting | open311-reporting.sqlite |
| Open311 GIS handoff | open311-gis | open311-gis | open311-gis.sqlite |
| Open311 request/work-order follow-through | open311-follow-through | open311-follow-through | open311-follow-through.sqlite |
| Open311 field work and crew returns | open311-field-desk | open311-field-desk | open311-field-desk.sqlite |
| Municipal service configuration | open311-service-configuration | open311-service-configuration | open311-service-configuration.sqlite |

The collection desk captures official catalogs and requests, keeps all original windows/pages and supports source-linked review. Reporting freezes periods, source cutoffs, mappings and target calendars. GIS exchanges complete analyst files and reviewed mapped dispatch. Follow-through relates original request and order editions, reviews discrepancies and prepares selected approved actions. Field Desk carries that approved work through crew visits, partial returns, supervisor decisions and destination updates. Service configuration applies explicit agency/routing/template choices to a complete original register and saves the reviewed implementation package.

The browser and command line for a desk operate the same SQLite file. Five desks also expose typed merchant providers; reporting is available through its browser, CLI and direct source SDK. The [source adoption record](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/products/open311/SOURCE_ADOPTION.json) identifies the original source editions.

Keep the source package, installed runtime and private working directories separate. Use one directory per desk and a new empty directory for an independent received workspace. The supported cross-application files are listed in [WORKFLOWS.md](WORKFLOWS.md#files-that-connect-applications).

## Install the selected merchant product

Use Linux, Node 22.16 or newer, Python 3.11 or newer, Git and npm for the maintained package builder and installer. The existing host setup uses util-linux flock. The direct Open311 modules use the Node built-in SQLite API and require Node 22.13 or newer; the packaged merchant uses the higher 22.16 baseline from the original distribution.

From a checkout of this repository at the intended immutable commit:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo . \
  --ref "$(git rev-parse HEAD)" \
  --selection open311-service-configuration \
  --out /absolute/private/open311-package \
  --offline
~~~

The new output directory receives one original archive and its package/manifest information. Keep the returned archive path and SHA-256 with the delivery. The selected recipe retains all six municipal commands and browser applications, their typed interfaces, the five merchant providers, and the original installation, Applications and receiving infrastructure. Its complete selection is [open311-service-configuration.json](../../stellar/scf-starforge-20261009/distribution/selections/open311-service-configuration.json).

Install that archive in a private working directory:

~~~sh
install -d -m 700 /absolute/private/open311-install
cd /absolute/private/open311-install
npm install --ignore-scripts --offline --omit=optional \
  /absolute/private/open311-package/*.tgz
npx --no-install starforge doctor
npx --no-install starforge registrations --source open311-service-configuration
npx --no-install starforge merchant-providers inspect open311-workspaces
~~~

The source-only install makes the selected municipal browsers, CLIs and direct SDKs available. For an external MCP client, complete the prepared runtime installation in [Attach the merchant tools](#attach-the-merchant-tools) below. Its source-selected dependencies install beside a separate retained copy of the same archive. The complete source build and runtime receiving procedures are documented in [BUILDING.md](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar/scf-starforge-20261009/distribution/BUILDING.md), [RUNTIME_INSTALL.md](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) and [SOURCE_SELECTIONS.md](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar/scf-starforge-20261009/distribution/SOURCE_SELECTIONS.md).

Run npx from /absolute/private/open311-install in the examples below. The MCP commands use runtime-install run to select the prepared runtime explicitly. Keep private workspaces, host configuration and exports outside both source and runtime directories.

## Initialize or receive the selected desks

Initialize only the applications needed for the operation. These commands run from the private installation directory and create a new saved desk at revision 0:

| Desk | Initialization command |
| --- | --- |
| Collection | npx --no-install starforge open311 state --workspace /absolute/private/municipal/collection |
| Reporting | npx --no-install starforge open311-reporting init --workspace /absolute/private/municipal/reporting |
| GIS | npx --no-install starforge open311-gis init --workspace /absolute/private/municipal/gis |
| Follow-through | npx --no-install starforge open311-follow-through init --workspace /absolute/private/municipal/follow-through |
| Field Desk | npx --no-install starforge open311-field-desk init --workspace /absolute/private/municipal/field |
| Service configuration | npx --no-install starforge open311-service-configuration init --workspace /absolute/private/municipal/service-configuration |

If continuing a delivered workspace, use its [receiving command](RECEIVING.md#receive-each-editable-workspace) in an empty destination before saving its Applications entry. A collection, report, dispatch or crew file uses the receiving application's source/return import workflow; the whole-workspace receive command accepts that application's complete editable package.

All six commands support serve with --workspace and --port. For example:

~~~sh
npx --no-install starforge open311-gis serve \
  --workspace /absolute/private/municipal/gis \
  --host 127.0.0.1 --port 0
~~~

The single startup JSON line gives the actual URL and saved workspace identity. Open that URL for the selected desk. Stop the process cleanly when finished; the same directory reopens its original state. Each command's help describes its exact writes and export flags. In particular, service configuration uses --revision, --input and --output; the other desks' receiving and export flags are enumerated in [RECEIVING.md](RECEIVING.md).

## Open the six applications through the managed runtime

First complete [Prepare the runtime for the selected source archive](#prepare-the-runtime-for-the-selected-source-archive) and confirm its retained installation is READY. Initialize a new runtime workspace, attach that prepared runtime, then open its existing operator:

~~~sh
npx --no-install starforge runtime-workspace init \
  --workspace /absolute/private/merchant-runtime-workspace \
  --runtime-home /absolute/private/runtimes

npx --no-install starforge runtime-workspace attach \
  --workspace /absolute/private/merchant-runtime-workspace \
  --runtime /absolute/private/open311-runtime \
  --label "Municipal service suite"

npx --no-install starforge runtime-workspace serve \
  --workspace /absolute/private/merchant-runtime-workspace \
  --port 8465
~~~

For an existing runtime workspace, retain its saved installation and application entries; attach the intended prepared runtime through that same setup workflow. In Applications, choose the title from the six-desk table, select the initialized or received private directory, then Review and Save. Start launches that saved application; Open connects to the actual live server. Stop and recovery act on the saved managed process.

Preparation reads the original SQLite workspace identity and binds it to the selected directory, source/runtime edition and port. Start checks the retained preparation and actual startup response; the live launch endpoint identifies the same workspace and server instance. This keeps several municipal desks distinguishable even when their pages are open together.

The existing Applications CLI can inspect the same saved entries and their history:

~~~sh
npx --no-install starforge runtime-workspace applications \
  --workspace /absolute/private/merchant-runtime-workspace --history-limit 1

npx --no-install starforge runtime-workspace application-start-review \
  --workspace /absolute/private/merchant-runtime-workspace \
  --application-id SAVED_APPLICATION_ID

npx --no-install starforge runtime-workspace application-connect \
  --workspace /absolute/private/merchant-runtime-workspace \
  --application-id SAVED_APPLICATION_ID
~~~

SAVED_APPLICATION_ID is the saved application instance returned by Review/Save, rather than the source provider ID in the first table. The complete [Applications guide](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/APPLICATIONS.md) defines its review/save/start request files, stop, recovery, output and history. [Application setup](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/APPLICATION_SETUP.md) covers initialized and received directory selection. The maintained [named-group workflow](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/APPLICATION_GROUPS.md) can review, start, continue and stop an explicit group of saved applications.

Receive a complete handover before the first Review/Save of its destination. For an application previously bound to an empty receiving directory, stop that managed process and Review/Save again after receiving, then Start/Open. This records the received workspace's actual identity. Reporting's recipient identity behavior is described separately in the receiving guide.

## Collector walkthrough: connect an official source

The following complete example operates the original collection desk. Use [WORKFLOWS.md](WORKFLOWS.md) for reporting, GIS, Follow-through, Field Desk and service configuration from their own original inputs.

Initialize the durable workspace:

~~~sh
npx --no-install starforge open311 state \
  --workspace /absolute/private/open311-desk
~~~

Save the included Helsinki profile, or prepare the complete equivalent connection in a private JSON file. The original example is at:

~~~text
node_modules/@tokenjunkielabs/starforge-merchant/source/stellar/scf-starforge-20261009/sf30-seller-sdk/open311/examples/helsinki.connection.json
~~~

For Helsinki, the example selects the public API at https://palautteet.hel.fi/public-api/open311-public-service/v1, a response limit of 200, native READY and PROCESSING status values, and the documented extended attributes. It carries the city's source attribution and CC BY 4.0 license. The city's [API description](https://www.hel.fi/static/avoindata/kanslia/Open311_API_description_011025.pdf) describes the returned set as the last 90 days or at most 200 first responses; its [HRI catalog](https://hri.fi/data/en_GB/dataset/helsingin-kaupungin-palauterajapinta) provides the source attribution.

Copy the profile to the private operation area, then apply it with a stable operation ID:

~~~sh
cp node_modules/@tokenjunkielabs/starforge-merchant/source/stellar/scf-starforge-20261009/sf30-seller-sdk/open311/examples/helsinki.connection.json \
  /absolute/private/helsinki.connection.json
chmod 600 /absolute/private/helsinki.connection.json

npx --no-install starforge open311 connection-put \
  --workspace /absolute/private/open311-desk \
  --file /absolute/private/helsinki.connection.json \
  --request-id helsinki-connect-01 \
  --expected-revision 0
~~~

A new desk begins at revision 0. For an existing desk, read state and use that current revision. A connection's endpoint and jurisdiction remain tied to its capture history; a different source uses a new connection ID. A private source can specify apiKeyEnv, naming an environment variable available to the launched host.

Start the desk:

~~~sh
npx --no-install starforge open311 serve \
  --workspace /absolute/private/open311-desk \
  --port 0
~~~

The command prints a single startup JSON line containing the actual loopback URL, workspace identity and binding. Open that URL. Save connections, capture source data, search requests, assign reviews, compare captures and download files through the same browser.

## Capture complete source observations

Capture the English catalog with a private query file containing:

~~~json
{ "locale": "en" }
~~~

Then run:

~~~sh
npx --no-install starforge open311 capture \
  --workspace /absolute/private/open311-desk \
  --connection helsinki-public \
  --kind services \
  --query /absolute/private/catalog-query.json \
  --request-id helsinki-catalog-01 \
  --expected-revision 1
~~~

For requests, choose the actual operating interval. This example names a fixed interval and requests the provider's extended attributes:

~~~sh
npx --no-install starforge open311 capture \
  --workspace /absolute/private/open311-desk \
  --connection helsinki-public \
  --kind requests \
  --start 2026-10-08T08:00:00Z \
  --end 2026-10-08T12:00:00Z \
  --extensions true \
  --request-id helsinki-window-20261008-01 \
  --expected-revision 2 \
  --out /absolute/private/helsinki-window-01.json
~~~

The mutation response carries result.capture.id. Keep that ID for case search, review context, comparison and selected exports. Operation results also retain the request ID and expected revision.

The original source client follows [Open311 GeoReport v2](https://wiki.open311.org/GeoReport_v2/), [declared extensions](https://wiki.open311.org/GeoReport_v2/Extensions/), and [service discovery](https://wiki.open311.org/Service_Discovery/). Fixed date intervals must be timezone-qualified and at most 90 days. Individual request IDs take the protocol's precedence over other filters. Pagination is available only when the source profile declares support.

Each capture stores the actual normalized request query as query and the operator's original selection as requestedQuery. Inspect its coverage to see the documented limit and possible saturation. If a provider returns the limit, choose smaller fixed windows appropriate to that provider's documented date semantics. The [FixMyStreet documentation](https://www.fixmystreet.com/open311) describes its own exclusive end date and response cap; those endpoint details belong in the selected source's operating procedure.

A Helsinki request may have a null service_code and an empty service_name. Those source values remain intact. The request desk can operate such records without assigning a catalog category.

## Search, assign and compare

Search one saved capture:

~~~sh
npx --no-install starforge open311 requests \
  --workspace /absolute/private/open311-desk \
  --capture CAPTURE_ID \
  --status READY \
  --q street \
  --offset 0 \
  --limit 100
~~~

The result contains items, total, offset and limit. Page the same capture through its entire saved population. Use request for the full original case and current review:

~~~sh
npx --no-install starforge open311 request \
  --workspace /absolute/private/open311-desk \
  --capture CAPTURE_ID \
  --id SERVICE_REQUEST_ID
~~~

Prepare a review file with the actual assignee and note:

~~~json
{
  "status": "assigned",
  "assignee": "Operations",
  "note": "Review the source response and route maintenance follow-up.",
  "dueDate": "2026-10-15"
}
~~~

Read the current desk revision, then save the review:

~~~sh
npx --no-install starforge open311 state \
  --workspace /absolute/private/open311-desk

npx --no-install starforge open311 review-put \
  --workspace /absolute/private/open311-desk \
  --connection helsinki-public \
  --id SERVICE_REQUEST_ID \
  --file /absolute/private/review.json \
  --request-id municipal-review-01 \
  --expected-revision CURRENT_REVISION
~~~

A review keeps its saved capture/source association and history. Parallel browser and merchant users retain each other's successful review changes through the transactional workspace.

Capture a second source observation with a new operation ID. Compare the selected editions:

~~~sh
npx --no-install starforge open311 diff \
  --workspace /absolute/private/open311-desk \
  --before FIRST_CAPTURE_ID \
  --after SECOND_CAPTURE_ID
~~~

Compare field changes from the source. Treat missingFromCapture as an observation about comparable scope. The comparison only reports it for equal fixed, unsaturated populations; source disappearance does not itself change an internal review or classify a request as complete.

## Attach the merchant tools

Each provider opens the selected saved desk and exposes its declared tools through the original merchant host. The complete package includes these providers:

| Desk | Merchant provider ID | Host setup and file contract |
| --- | --- | --- |
| Collection | open311-workspaces | [Open311 MCP.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/MCP.md) |
| GIS | open311-gis-workspaces | [GIS MCP.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/MCP.md) |
| Follow-through | open311-follow-through-workspaces | [Follow-through MCP.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/follow-through/MCP.md) |
| Field Desk | open311-field-desk-workspaces | [Field Desk MCP.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/field-desk/MCP.md) |
| Service configuration | open311-service-configuration-workspaces | [Service configuration MCP.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/MCP.md) |

Reporting's maintained contribution registers its browser, CLI and direct SDK. Continue reports through those interfaces. The other five providers use their own typed host schema and named file kinds; follow the selected provider's complete host example rather than reusing a different desk's connection file.

The runtime preparation below applies to the complete selected archive. The subsequent host and typed-client example attaches the collection provider; the linked guides give the corresponding complete setup for the other four providers.

### Prepare the runtime for the selected source archive

Use the same archive and SHA-256 retained from the selected package build. Replace ORIGINAL_OPEN311_ARCHIVE.tgz and ORIGINAL_ARCHIVE_SHA256 with those exact delivered values. The parent /absolute/private must exist; runtime-install prepare creates the new open311-runtime directory.

~~~sh
npx --no-install starforge runtime-install prepare \
  --dir /absolute/private/open311-runtime \
  --archive /absolute/private/open311-package/ORIGINAL_OPEN311_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

npx --no-install starforge runtime-install install \
  --dir /absolute/private/open311-runtime

npx --no-install starforge runtime-install inspect \
  --dir /absolute/private/open311-runtime --load --source
~~~

This selects the recipe's schema, openapi and mcp groups, plus the original native merchant peers. The archive's declarations determine their exact dependency versions. Preparation returns sourceRoot, dependencyRoot and entrypoint; installation must reach READY before launch. The source is retained in open311-runtime/package/source and dependencies in open311-runtime/node_modules. The desk and merchant configuration keep their own private paths.

Install uses the normal npm registry/cache. For a populated existing cache, add --offline --cache /absolute/private/npm-cache to install or resume. If a selected native module needs offline preparation, supply a compiler and local Node headers matching the selected executable; --node-headers /absolute/local/node-prefix selects a prefix containing include/node. Resume an interrupted installation in the same directory:

~~~sh
npx --no-install starforge runtime-install resume \
  --dir /absolute/private/open311-runtime
~~~

The existing installer retains its dependency lock and original attempt. Its [runtime guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) also covers receiving a complete retained dependency tree and recovering or upgrading into a new runtime directory.

### Connect the saved desks

The Open311 provider uses an existing merchant release store and the same desk directory. Prepare a private host file with mode 0600:

~~~json
{
  "schema": "stellar-forge.open311-workspace-host.v1",
  "workspaces": {
    "desk": {
      "label": "Municipal service operations",
      "directory": "/absolute/private/open311-desk",
      "connectionProfiles": {},
      "inputs": {}
    },
    "received": {
      "label": "Received municipal workspace",
      "directory": "/absolute/private/open311-received",
      "connectionProfiles": {},
      "inputs": {}
    }
  }
}
~~~

Initialize the receiving directory with the state command as above. Save the host file as /absolute/private/open311-host.json. The complete [merchant guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/open311/MCP.md) shows how to add source profiles and source-bundle input aliases.

Save /absolute/private/open311-setup.json with:

~~~json
{
  "directory": "/absolute/private/open311-merchant",
  "connection": "/absolute/private/open311-host.json",
  "name": "Municipal service operations"
}
~~~

Run the existing provider initializer:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/open311-runtime -- \
  merchant-providers init open311-workspaces \
  --options /absolute/private/open311-setup.json
~~~

Setup returns the original merchant configuration path and retains its initialization operation. The same arguments resume the same setup. An existing merchant can supply its original releaseStore path in the setup options.

### Register the installed merchant with the MCP client

Generate the client configuration through the prepared runtime on the machine that will launch it:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/open311-runtime -- \
  merchant-mcp-client-config \
  --config /absolute/private/open311-merchant/merchant-mcp.json \
  --name open311 \
  --output /absolute/private/open311-mcp-client.json
~~~

The original generator validates the merchant configuration and writes a private JSON file containing the actual absolute Node executable and MCP stdio entry from this installed runtime. Apply its open311 server entry through the existing MCP client's configuration workflow. To combine it with an existing mcpServers file, add --merge /absolute/private/existing-mcp-client.json, choose an unused --name and keep --output as a new file.

The equivalent terminal launch uses the same runtime and merchant configuration:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/open311-runtime -- \
  merchant-mcp-stdio \
  --config /absolute/private/open311-merchant/merchant-mcp.json
~~~

The MCP client's host environment supplies any apiKeyEnv values. If the runtime is upgraded or recovered into a new directory, generate a new client configuration from that runtime and update the client's selected server entry; the previous generated entry continues to name its original absolute source path. The provider's declared tools cover desk discovery, status, complete records, source configuration, captures and catalogs, collection planning/run/pause, source-version case review, comparison, operation recovery, selected input receiving and complete retained-file reading.

The typed SDK is exported as:

~~~js
import { Open311MerchantClient } from
  '@tokenjunkielabs/starforge-merchant/merchant/open311/client';

const desk = new Open311MerchantClient(
  (name, args) => transport.callTool({ name, arguments: args }),
  'desk',
);
const state = await desk.status();
const worklist = await desk.requests({
  capture: 'CAPTURE_ID',
  expectedRevision: state.revision,
  offset: 0,
  limit: 100,
});
~~~

Here transport is the already connected MCP client. Mutations carry their saved request ID and revision. Source response downloads use immutable capture IDs; workspace and reviewed exports use the selected business revision. The provider drains its own active work before closing its SQLite handles and retained readers, allowing the independent browser to continue.

## Deliver and reopen the collection desk

The [receiving guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/products/open311/RECEIVING.md) gives the complete transfer procedure and original-file checks. From the same desk, export the selected source bytes or the full workspace:

~~~sh
npx --no-install starforge open311 export \
  --workspace /absolute/private/open311-desk \
  --kind source \
  --capture CAPTURE_ID \
  --out /absolute/private/municipal-original.json

npx --no-install starforge open311 export \
  --workspace /absolute/private/open311-desk \
  --kind workspace \
  --out /absolute/private/municipal-workspace.json
~~~

Use kind json, csv or report with the capture ID for reviewed data or a printable HTML report. The HTML retains the source attribution from the connection. Output files are created with exclusive creation so each delivered edition keeps its own filename.

The complete workspace includes all connections, source captures, original response bytes, review histories, operation intents and saved results. Its receiving operation validates the original bundle and source digests, retains the workspace identity, and reopens the captured source and internal work together.

## Recover an interrupted operation

The CLI prints a mutation's request ID and original expected revision before submitting it. If the caller loses the response, read the retained operation:

~~~sh
npx --no-install starforge open311 operation \
  --workspace /absolute/private/open311-desk \
  --id ORIGINAL_REQUEST_ID
~~~

Repeat the same request ID, original expected revision and unchanged inputs for that same intended operation. Use a new ID and current revision for a new intended change. A failed source acquisition preserves its available original response and receipt in the operation; it can be exported through the merchant operation file.

## Run the original collector commissioning workflow

The included commission.mjs executes one operated journey: original catalog and request capture, review, repeat capture/diff, source/JSON/CSV/report/full exports, merchant attachment and multichunk original-file reading, independent browser continuity, complete receiving and reopen.

From the installation directory:

~~~sh
node node_modules/@tokenjunkielabs/starforge-merchant/source/stellar/scf-starforge-20261009/sf30-seller-sdk/open311/commission.mjs \
  --connection /absolute/private/open311-install/node_modules/@tokenjunkielabs/starforge-merchant/source/stellar/scf-starforge-20261009/sf30-seller-sdk/open311/examples/helsinki.commission.json \
  --start 2026-10-08T08:00:00Z \
  --end 2026-10-08T12:00:00Z \
  --output /absolute/private/open311-commission
~~~

Use a new private output directory. For retained original source responses, add --retained with the complete original-source manifest described in the browser guide. The journey records the actual retained bytes, source observation metadata, operating results and receiving outcome in its output directory.

## Source guide index

| Desk | Source and command guide | Browser guide |
| --- | --- | --- |
| Collection | [README.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/README.md), [COLLECTIONS.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/COLLECTIONS.md) | [WORKSPACE.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/workspace/WORKSPACE.md) |
| Reporting | [README.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/README.md), [INSTALL.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/INSTALL.md) | The reporting desk's named profile, build, request detail, review and receiving controls |
| GIS | [README.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/README.md), [FORMATS.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/FORMATS.md) | [WORKSPACE.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/WORKSPACE.md) |
| Follow-through | [README.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/follow-through/README.md) | [WORKSPACE.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/follow-through/WORKSPACE.md) |
| Field Desk | [README.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/field-desk/README.md) | [WORKSPACE.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/field-desk/WORKSPACE.md) |
| Service configuration | [README.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/README.md), [SOURCE_CONTRACT.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/SOURCE_CONTRACT.md) | [WORKSPACE.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/WORKSPACE.md) |

Each desk's complete editable package is described in [RECEIVING.md](RECEIVING.md). Keep the original source files and selected ordinary outputs with that package so the next operator can continue the work and inspect its source context.
