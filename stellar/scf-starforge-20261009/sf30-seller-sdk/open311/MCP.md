# Open311 merchant tools and typed SDK

The merchant provider carries the municipal operating workflow through the same durable workspace used by the browser and command line: configure an official source, capture its service catalog and cases, search and assign cases, compare observations, deliver complete files, receive a whole workspace and reopen it.

Provider ID: **open311-workspaces**. Configuration family: **open311Workspaces**. Native host connection field: **open311WorkspaceConnection**. The product uses Node 22.13 or newer and the original merchant host, release store and retained-file reader.

## Prepare the operating desks

Open or create the private workspace directories with the original CLI:

~~~sh
node open311/cli.mjs state --workspace /private/municipal-desk
node open311/cli.mjs state --workspace /private/municipal-received
~~~

Keep the existing browser, CLI and merchant alias pointed at that same directory. SQLite transactions preserve operation replay and revision checks across processes.

Create a private host connection file, for example /private/open311-host.json, with mode 0600. Each workspace directory must be an existing private directory. Paths are selected in this host file. Relative paths resolve against the host file's directory.

~~~json
{
  "schema": "stellar-forge.open311-workspace-host.v1",
  "workspaces": {
    "helsinki": {
      "label": "Helsinki service operations",
      "directory": "/private/municipal-desk",
      "connectionProfiles": {
        "helsinki-public": {
          "id": "helsinki",
          "name": "Helsinki public service requests",
          "baseUrl": "https://palautteet.hel.fi/public-api/open311-public-service/v1",
          "responseLimit": 200,
          "pagination": false,
          "extendedAttributes": true,
          "statusValues": ["READY", "PROCESSING"],
          "queryExtensions": ["locale", "updated_after", "updated_before", "lat", "long", "radius"],
          "attribution": {
            "publisher": "Helsingin kaupunginkanslia",
            "title": "The Issue Reporting API of the City of Helsinki",
            "license": "CC BY 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "sourceUrl": "https://hri.fi/data/en_GB/dataset/helsingin-kaupungin-palauterajapinta"
          }
        }
      },
      "inputs": {}
    },
    "received": {
      "label": "Received customer workspace",
      "directory": "/private/municipal-received",
      "connectionProfiles": {},
      "inputs": {}
    }
  }
}
~~~

Source profiles contain the complete original connection. A profile can specify apiKeyEnv for a host environment variable. The profile's ID becomes the stable connection ID; profile alias is used when applying it through the merchant. Credential values remain on the selected host. Changing an endpoint or jurisdiction after captures exist requires a distinct connection ID so its original source history retains its identity.

The Helsinki profile follows the city's [October 2025 API description](https://www.hel.fi/static/avoindata/kanslia/Open311_API_description_011025.pdf), including native READY/PROCESSING status values and its 200-response cap. The city's text describes the returned set as the last 90 days or at most 200 first responses. Its [HRI catalog](https://hri.fi/data/en_GB/dataset/helsingin-kaupungin-palauterajapinta) provides attribution and CC BY 4.0 licensing. The [source-client guide](README.md) also covers GeoReport v2 and FixMyStreet differences.

## Initialize the original native merchant

The source-owned initializer registers this connection with the maintained merchant configuration and original SF82 release store:

~~~js
import { initializeOpen311MerchantWorkspace } from './open311/mcp-setup.mjs';

const setup = await initializeOpen311MerchantWorkspace({
  directory: '/private/municipal-merchant',
  connection: '/private/open311-host.json',
  name: 'Municipal service operations',
});
console.log(setup.configuration);
~~~

For an existing release store, pass its absolute path as releaseStore. Setup retains its intent and original initializer attempts. Repeating the same arguments reopens that setup. The resulting merchant-mcp.json selects the existing release store, customer-exports directory and open311WorkspaceConnection. The normal merchant configuration reader loads the registered provider through the distribution contribution.

The provider has host-owned concurrency and drains admitted actions before closing its own database handles and retained readers. The independent browser process continues to use the same workspace.

## Operate a complete customer desk

These tools return the original workspace results with explicit pagination where collections can grow.

| Tool | Operating result |
| --- | --- |
| merchant_open311_workspaces | All configured desk, source-profile and input aliases |
| merchant_open311_status | Workspace identity, current revision, counts, recent operations and active downloads |
| merchant_open311_records | Complete saved connection, capture or review records by revision and offset |
| merchant_open311_connection_put | Apply a complete selected source profile |
| merchant_open311_capture | Retain a catalog, definition, request query, individual request, token or discovery document |
| merchant_open311_capture_info | Source capture metadata, receipt and original byte manifest |
| merchant_open311_services | Complete saved service catalog pages |
| merchant_open311_requests | Search and page saved cases with their internal reviews |
| merchant_open311_request | Complete case, source observation history and current review |
| merchant_open311_diff | Counts and paged original changes between two captures |
| merchant_open311_review_put | Save assignment, due date, note and internal review history |
| merchant_open311_operation | Recover a saved result or source failure by original request ID |
| merchant_open311_input | Inspect a host-selected complete workspace bundle |
| merchant_open311_receive | Receive the selected complete bundle into its empty destination desk |
| merchant_open311_file_read | Complete source, JSON, CSV, print report, workspace, comparison or operation bytes |
| merchant_open311_file_release | Release an existing retained reader |

Each mutation requires requestId and expectedRevision. Read status before preparing a new action. Preserve the first request ID, revision and inputs when retrying that action; a successfully replayed action returns its original saved result. A new intended change uses a new request ID and the newly observed revision.

Capture kinds are services, service, requests, request, token and discovery. Service, request and token captures require resourceId. Discovery uses the selected connection's discoveryUrl. The query object carries the exact source parameters documented for that provider.

A request capture is a stored response with its original query, URL receipt, observation time and bytes. Use one capture ID when searching a case population. Follow nextOffset until null at the same expectedRevision for complete record, service and case views. Recent operations in status are the most recent 20; operation lookup and the complete workspace file preserve older saved actions.

Source status and internal status remain separate. A source can use READY or PROCESSING while an internal review is new, assigned, in_progress or done. Comparison sections are added, changed, unchanged and missingFromCapture. Missing rows require equal fixed, unsaturated source scopes. Exact provider field changes remain available even when capture windows differ.

## Use the typed merchant SDK

mcp-client.mjs adapts an existing merchant transport. It accepts a function with the signature callTool(name, arguments). A standard MCP client can be supplied through a short adapter:

~~~js
import { Open311MerchantClient } from './open311/mcp-client.mjs';

const desk = new Open311MerchantClient(
  (name, args) => merchantTransport.callTool({ name, arguments: args }),
  'helsinki',
);

const state = await desk.status();
const connected = await desk.configure({
  profile: 'helsinki-public',
  requestId: 'helsinki-connect-01',
  expectedRevision: state.revision,
});
const catalog = await desk.capture({
  connectionId: connected.connection.id,
  kind: 'services',
  query: { locale: 'en' },
  requestId: 'helsinki-catalog-01',
  expectedRevision: connected.revision,
});
const captured = await desk.capture({
  connectionId: connected.connection.id,
  kind: 'requests',
  query: {
    start_date: '2026-10-08T08:00:00Z',
    end_date: '2026-10-08T12:00:00Z',
    extensions: true,
  },
  requestId: 'helsinki-window-20261008-01',
  expectedRevision: catalog.revision,
});
const cases = await desk.requests({
  capture: captured.capture.id,
  expectedRevision: captured.revision,
  limit: 25,
});
~~~

The sample uses a fixed source window; choose the actual operating interval. Source limits and saturation metadata determine whether another narrower window is needed.

When an operator selects a returned case, save its review with the original serviceRequestId:

~~~js
if (cases.items.length) {
  const selected = cases.items[0];
  const current = await desk.status();
  await desk.review({
    connectionId: selected.connectionId,
    serviceRequestId: selected.serviceRequestId,
    requestId: 'municipal-assignment-01',
    expectedRevision: current.revision,
    review: {
      status: 'assigned',
      assignee: 'Operations',
      note: 'Review the current source response and maintenance routing.',
    },
  });
}
~~~

Arguments are copied before asynchronous dispatch so later caller edits do not change an admitted intent. Declarations beside the modules describe the source, workspace, server, merchant client and setup interfaces.

## Deliver the complete original files

File selections are exact:

| Kind | Required selection |
| --- | --- |
| workspace | expectedRevision |
| source | capture |
| json, csv, report | capture and expectedRevision |
| comparison | before and after |
| operation | operationId |

A retained read fixes its complete bytes on first open. Every continuation repeats the full selection, readId, expectedSha256 and offset. The returned file manifest supplies exact name, content type, byte length and SHA-256; nextOffset becomes null when complete. After reader expiry or process restart, omit readId and resume using the same selection, expectedSha256 and saved offset. A changed source selection returns a hash or revision conflict.

The SDK can assemble the complete file and verify its final SHA-256:

~~~js
import { writeFile } from 'node:fs/promises';

const current = await desk.status();
const delivered = await desk.downloadFile({
  kind: 'workspace',
  expectedRevision: current.revision,
});
await writeFile('/private/municipal-workspace.json', delivered.bytes, {
  flag: 'wx',
  mode: 0o600,
});
console.log(delivered.file);
~~~

For a source response, use kind: source and its capture ID. The SDK also accepts an asynchronous onChunk(bytes, { file, offset }) sink for a complete streaming download. readFile provides the original continuation controls for a caller that keeps its own resume state. Failed source reads and normalization errors retain their complete available response bytes inside the original operation file.

Workspace exports are deterministic for an unchanged retained workspace. They carry all original connections, captures, reviews, operation intents and results, plus the source manifest. Their source metadata and provider attribution remain attached.

## Receive and reopen the customer edition

Add the exact delivered workspace file to the destination's host-selected inputs:

~~~json
{
  "received-bundle": {
    "label": "Municipal workspace handoff",
    "path": "/private/municipal-workspace.json",
    "sha256": "REPLACE_WITH_THE_DELIVERED_FILE_SHA256"
  }
}
~~~

This object belongs under workspaces.received.inputs in the private host connection file. Reload the normal merchant host configuration after changing that file. The configured input SHA-256 pins the original file; receiving also verifies the complete workspace payload and every retained source response.

~~~js
const receiver = new Open311MerchantClient(
  (name, args) => merchantTransport.callTool({ name, arguments: args }),
  'received',
);
const original = await receiver.input('received-bundle');
const destination = await receiver.status();
const received = await receiver.receive({
  input: 'received-bundle',
  expectedSha256: original.sha256,
  requestId: 'municipal-receive-01',
  expectedRevision: destination.revision,
});
console.log(received);
~~~

Open the receiving workspace through the Applications launcher or:

~~~sh
node open311/cli.mjs serve --workspace /private/municipal-received --port 0
~~~

The browser startup reports the received workspace identity. Source queries, complete bytes, service cases, review history and saved operation results reopen together.
