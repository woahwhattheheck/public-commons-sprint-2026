# Gravitee commissioning workspace

A complete operator application for migrating a cohort of REST proxy APIs into Gravitee APIM and handing the running work to another delivery team.

The application connects to the real Management API v2. It retains the original source contracts and supporting Mule files, editable native v4 definitions, every saved mapping revision, complete provider responses, current deployment observations and the operating handover. The same workspace is available through a local browser, a typed JavaScript client, a command line and the maintained Merchant MCP host.

## Start the application

Use Node 22.16 or later and Linux with the ordinary `flock` command. Install the single source-parser dependency in this product directory:

```sh
npm install --prefix products/gravitee-merchant --ignore-scripts --omit=dev
node products/gravitee-merchant/cli.mjs init --directory /absolute/cohort-workspace
node products/gravitee-merchant/cli.mjs serve --directory /absolute/cohort-workspace
```

The final command returns the private local browser URL and the original workspace identity. Open that URL, choose **Connections**, and enter the Management API v2 base URL, organisation, environment and credential variable name. Credential values are read from the running process. A connection record can also be provided to `init --connection connection.json`.

```json
{
  "label": "Staging APIM",
  "managementUrl": "https://apim.example.net/management/v2",
  "organizationId": "DEFAULT",
  "environmentId": "DEFAULT",
  "auth": {
    "type": "bearer",
    "tokenEnv": "GRAVITEE_MANAGEMENT_TOKEN"
  },
  "gatewayUrls": ["https://gateway.example.net"]
}
```

Set the named token variable using your host's existing credential configuration before opening the server. Basic authentication is also supported with separate username and password variable names. HTTP is accepted for loopback; a different intended private HTTP deployment uses the explicit connection setting `allowHttp: true`.

## Complete operator flow

1. **Capture the target.** The application follows every inventory page and captures the selected v4 HTTP proxy APIs. Each API capture includes its native definition export, all plan statuses, documentation, members, metadata, events and current deployment.
2. **Import the source.** Select an OpenAPI 3.x, Swagger 2.0, RAML 1.0 or native Gravitee v4 entry document. Include the other original Mule application, policy, DataWeave, schema and documentation files in the same bundle. Their original bytes remain available.
3. **Map the API.** Set the intended proxy path, upstream, version and access plan. Edit the complete native JSON when the service needs explicit gateway flows or policy configuration. Record the disposition of source authentication, traits, resource types, transforms and other behaviors called out by the source importer.
4. **Prepare a native change.** The request screen shows the exact Management API method, URL, JSON payload and original target snapshot. Full-definition imports also show current plans omitted from the payload. Existing API changes compare the current definition and use the original ETag on the release routes that support conditional updates.
5. **Commission the service.** Select the native steps required for this API: create its plans, publish, request or accept a platform review, start, and request deployment. Each step retains its original request and complete response. A gateway observation uses an explicitly configured gateway and optional consumer credential variable names.
6. **Receive the complete work.** Export and download the editable workspace. The receiving command verifies its package and file hashes and creates a new operating directory containing the original source and history.

The native request console also exposes capture and inspection, API update/import, plan update/publication/closure/deprecation, platform reviews, start/stop, deployment verification/current deployment, API events and rollback, and documentation creation/update/publication. These use the selected provider contract. Provider permissions and installed plugins are enforced by the actual APIM server.

## Source and migration semantics

The generated HTTP proxy definition contains the exact v4 HTTP listener and `http-proxy` endpoint-group structure. The native plan is a separate resource. KEY_LESS, API_KEY, OAuth2, JWT and mTLS selections remain explicit plan configurations.

RAML ingestion traverses nested resources and methods, path/query/header parameters, response bodies and common schema types. Packaged `!include` files are resolved within the supplied original bundle. Original source bytes, descriptions, security declarations and advanced behavior declarations remain in the source record. Traits, resource types, library bindings, custom type facets, source authentication and Mule application transformations receive specific mapping entries. Their implementation belongs in the native draft or the retained transformation component before that draft is commissioned.

OpenAPI external references are identified by their original path. Package the referenced files and resolve them into the intended native definition or source transformation. The upstream native Swagger import remains available in the request console for the installed APIM importer.

A v4 definition export contains API configuration and additional resources. Gravitee uses **group names** in definition import/export and **group IDs** in ordinary API reads and updates. A full-definition import can remove an omitted plan. The request's saved comparison includes those plan identities, and its original full capture remains available through the operation journal.

## Original requests and recovery

Source imports, draft saves, captures and commissioning sequences use stable request UUIDs. The workspace records their input identity and saves the original result. The browser retains an unfinished request's UUID through reconnects, and the SDK returns `error.originalRequest` when a reply is interrupted.

A native mutation is recorded before dispatch. The complete result and response bytes are retained before the operation is reported. Reopening a dispatched request reads its existing state. Reconciliation reads the actual API and compares observable native changes; it keeps provider acceptance separate from the later observation. A received 429 retains its original response and valid Retry-After time. When the header is missing or invalid, a separately labeled local delay starts at 60 seconds and doubles for consecutive such responses up to one hour. After the saved time, the operator can continue that original request or commissioning sequence. Transport uncertainty keeps the original request available for native reconciliation.

The workspace uses immutable source objects, record revisions and chained event records, with the maintained kernel-backed writer lease. On opening, complete immutable record revisions repair a lagging head index after interruption. A complete record history remains available in the handover.

## Deployment meaning

A deployment request returns HTTP **202** when APIM accepts the request. The application separately retains:

- that original accepted response;
- the current deployment definition returned by Management API;
- API state and deployment state;
- actual GET, HEAD or OPTIONS observations against the configured gateways.

An observation from one gateway describes that gateway. Configure each gateway needed for the cohort's receiving checks. Backend-changing workloads belong in the service's actual client or commissioning workload.

## JavaScript and command line

```js
import { createGraviteeWorkspaceClient } from './products/gravitee-merchant/client.mjs';

const client = createGraviteeWorkspaceClient({
  url: process.env.GRAVITEE_WORKSPACE_URL,
  workspaceId: process.env.GRAVITEE_WORKSPACE_ID
});

const capture = await client.action('capture', {
  requestId: crypto.randomUUID(),
  connectionId: 'the saved 24-character connection id',
  label: 'Receiving inventory'
});
```

The typed client includes every workspace action. The native client in `native.mjs` can also be used directly with an explicit connection and original response sink.

```sh
node products/gravitee-merchant/cli.mjs action \
  --directory /absolute/cohort-workspace \
  --method capture \
  --input capture-request.json

node products/gravitee-merchant/cli.mjs export \
  --directory /absolute/cohort-workspace \
  --output /absolute/gravitee-handover.json
```

See [OPERATING.md](OPERATING.md) for native request examples, source mappings, role-sensitive operations and the complete commissioning sequence. See [RECEIVING.md](RECEIVING.md) for a second-machine handover and the source-native execution command.

## Merchant integration

The additive `gravitee-commissioning` distribution contribution registers the command, source-selected application provider, typed exports, YAML runtime dependency and Merchant MCP provider. The `gravitee-merchant` source selection produces the product through the maintained distribution flow.

Applications opens an already initialized private workspace through the original managed-command lifecycle. Startup receiving checks the announced workspace identity, selected port, actual local workspace response and complete application HTML.

For MCP, declare a private `graviteeWorkspaceConnection` source in the existing Merchant host configuration. Its contents use:

```json
{
  "schema": "stellar-forge.gravitee-workspace-connection.v1",
  "workspaces": {
    "staging": {
      "label": "API commissioning",
      "workspaceId": "original workspace UUID",
      "consoleUrlEnv": "GRAVITEE_WORKSPACE_URL"
    }
  }
}
```

A private `consoleUrlFile` can be used instead of the environment name. The provider checks the original live workspace identity before each interaction. Tool results larger than 64 KiB are retained as complete exports. The manifest and ranged file tools return the original file through EOF, using the maintained retained-file reader.

## Native contract sources

The bundled operation contract is pinned to Gravitee APIM **4.12.21**, commit `d30e08232f6d7ac19165bf19224c45fefd286930`.

- [Release Management API specification](https://github.com/gravitee-io/gravitee-api-management/blob/4.12.21/gravitee-apim-rest-api/gravitee-apim-rest-api-management-v2/gravitee-apim-rest-api-management-v2-rest/src/main/resources/openapi/openapi-apis.yaml), Git blob `524e5424f3c07412b2dd4cbe65aef34de01012af`.
- [Implemented API resource](https://github.com/gravitee-io/gravitee-api-management/blob/4.12.21/gravitee-apim-rest-api/gravitee-apim-rest-api-management-v2/gravitee-apim-rest-api-management-v2-rest/src/main/java/io/gravitee/rest/api/management/v2/rest/resource/api/ApiResource.java), Git blob `62012eab07baf3dad23053a8ebe809514dae0a16`.
- [Implemented plan resource](https://github.com/gravitee-io/gravitee-api-management/blob/4.12.21/gravitee-apim-rest-api/gravitee-apim-rest-api-management-v2/gravitee-apim-rest-api-management-v2-rest/src/main/java/io/gravitee/rest/api/management/v2/rest/resource/api/ApiPlansResource.java), Git blob `96f1f505affc1f7fa10fdaa7115c17b4bbb9a930`.
- [Official Management API guide](https://documentation.gravitee.io/apim/4.10/how-to-guides/use-case-tutorials/create-and-publish-an-api-using-the-management-api).
- [Official API import guide](https://documentation.gravitee.io/apim/create-and-configure-apis/create-apis/import-apis).

The 4.12.21 schema describes deployment verification as POST, while that release's resource implements **GET**. The bundled contract records the implementation override and its exact source. Full export omits `excludeAdditionalData`, matching the implementation's empty exclusion set. Collection-valued queries use repeated parameters accepted by the release's native `Set` bindings.

An operator-supplied Management API OpenAPI JSON selects the declared operation paths and methods for another installed contract. Keep that source alongside the actual target version during receiving.

### Transfer and response sizes

A source bundle can contain up to 128 MiB of complete originals; each parsed JSON, YAML or RAML document is limited to 4 MiB. Large media and supporting assets remain attached as original bytes. The native response limit is configurable from 1 KiB to 128 MiB per response. An incomplete or oversized provider response retains its received bytes and status, cancels the reader, and leaves the original operation available for reconciliation.
