# Native Tyk capture, rollout and receiving contract

This component operates the existing Tyk Gateway and licensed Tyk Dashboard through their original APIs. It supplies exact source capture, explicit request plans, original-response retention and complete readback comparison to the maintained Tyk workspace. The workspace owns saved portfolios, cohorts, request journals, operator reviews and portable receiving.

The source contract was read on 12 October 2026. The Gateway implementation is pinned to [Tyk v5.15.1, commit 51a1e2e](https://github.com/TykTechnologies/tyk/tree/51a1e2e96b08eb0bd734b7d162333d4dc0555096). The Dashboard contract is pinned to the original [5.15 OpenAPI source](https://github.com/TykTechnologies/tyk-docs/blob/d2ab6762fa58560e313cdb407da6372a4f5aa942/swagger/5.15/dashboard-swagger.yml). The complete paths, Git blob identities and original documentation links are retained in [native-contract-sources.json](./native-contract-sources.json).

## Product and native authority

| Target | Original authority | Connection header | Selected lifecycle |
| --- | --- | --- | --- |
| Gateway | The deployed Gateway and its original Redis/configuration | x-tyk-authorization | Complete Classic/Tyk OAS create and update, plain OAS import, original reads, explicit node or group reload |
| Dashboard | The licensed Dashboard and its managed Gateway estate | Authorization | Complete Classic/Tyk OAS create and update, plain OAS import, original paged inventory, native Classic-to-OAS dryRun/stage/promote/direct |

Dashboard-managed deployments use their Dashboard as the configuration authority. The original [Gateway API](https://tyk.io/docs/tyk-gateway-api), [Dashboard API](https://tyk.io/docs/tyk-dashboard-api), and [OAS lifecycle](https://tyk.io/docs/api-management/gateway-config-managing-oas) explain those deployment differences.

Gateway POST/PUT writes update definition files; its GETs show the active in-memory definition. Reload is a separate reviewed native operation. A successful write is retained as ACCEPTED with RELOAD_REQUIRED until its full current configuration corresponds to the request. The workspace connects an explicitly requested reload to the earlier accepted writes and records their new readback.

The original Dashboard migration endpoint performs the conversion. The [migration contract](https://tyk.io/docs/api-management/migrate-from-tyk-classic) documents changes in path matching, mock middleware ordering, validation and listen-path variables. Operator review compares the original Classic source with the actual native conversion. Stage uses Tyk's staged identities; promotion and direct conversion preserve the original canonical API identity.

## Module surface

The module imports Node's crypto API only. It uses the existing fetch implementation and supports AbortSignal; the original installed product supplies the workspace, process lifetime and private configuration.

| Export | Input | Returned original value |
| --- | --- | --- |
| normalizeTykConnection | Named connection declaration | Frozen normalized connection |
| tykConnectionSha256 | Connection declaration | SHA-256 of its complete canonical configuration |
| planTykRequest | Connection and explicit selection | Frozen complete native request plan with SHA-256 |
| createTykTransport | Connection plus environment/fetch/signal/options | Original execute, captureApi and captureInventory methods |
| inspectTykDefinition | Complete original definitionText and optional kind/apiId | Native kind, public API ID, original byte hash/size and display summary |
| prepareTykDefinition | Hydrated captured definition and target connection | Exact original document or explicit Classic envelope adaptation |
| responseTykApiIds | Saved plan and hydrated original exchange | Exact public API IDs returned by that native request |
| readTykMigrationDefinitions | Hydrated original migration exchange | Map from public API ID to each original returned OAS definition text |
| compareTykDefinition | Saved native plan and hydrated API capture | Full native-definition correspondence and comparison reason |
| reconcileTykRequest | Plan, before captures, after captures, original exchange | Saved state plus original response and per-API readback evidence |

The original workspace model, HTTP SDK, CLI, Applications entry and merchant tools use these same exports. See [workspace/README.md](./workspace/README.md) for operator flows and installed commands.

## Named target declarations

A declaration contains the native target identity and an environment reference:

~~~json
{
  "schema": "stellar-forge.tyk-connection.v1",
  "id": "production-dashboard",
  "label": "Original production Dashboard",
  "kind": "dashboard",
  "baseUrl": "https://dashboard.example.com/",
  "authEnv": "TYK_DASHBOARD_AUTH"
}
~~~

The id is a 1–128 character named handle: an ASCII letter or digit followed by letters, digits, period, underscore or hyphen. authEnv names an existing environment variable. baseUrl is HTTP(S), permits an original reverse-proxy base path, and has no embedded user information, query or fragment. Normalization gives the base path a trailing slash. The transport resolves the selected credential from its environment when it is created; exported declarations retain the reference name.

The complete declaration participates in the native request hash. A plan prepared for another alias, base URL, kind or environment reference is rejected. Each execute revalidates the named operation and reconstructs its original endpoint rather than accepting an arbitrary caller-provided path.

Transport options are environment, fetch, signal, timeoutMs and maximumResponseBytes. The default request timeout is 120 seconds; the explicit upper bound is one hour. The default individual response bound is 64 MiB and can be set up to 1 GiB. Inventory traversal has no implicit API or page-count limit. These response byte limits report the affected response directly; the saved workspace retains original partial bytes.

## Exact captures and persistence sinks

captureInventory walks the original inventory and then reads every listed API definition. Gateway inventory includes include_types=mcp, preserving the complete advertised list. Dashboard pages use its original p and sort=name parameters and continue through all reported pages.

~~~js
const transport = createTykTransport(connection, {
  environment: process.env,
  fetch,
  signal
});

const capture = await transport.captureInventory({
  retainBodies: false,
  onExchange: fullExchange => store.putJSON(fullExchange),
  onDefinition: fullDefinition => store.putJSON(fullDefinition),
  onProgress: value => showProgress(value)
});
~~~

The callbacks are awaited before metadata is returned. Metadata mode requires both sinks. The workspace's original immutable store returns a JSON-safe reference containing sha256, bytes and mediaType. A full definition callback receives the original definitionText and exchanges; a full exchange callback receives its exact response bytes. Metadata entries replace large definition text with definitionRef and exchange bodies with bodyRef. Hydration restores those complete records before comparison or native response parsing.

The complete inventory shape is:

~~~text
{
  schema: "stellar-forge.tyk-inventory-capture.v1",
  connectionId, connectionSha256, startedAt, completedAt,
  items: [API capture],
  exchanges: [original inventory HTTP exchange],
  pages: [{page, reportedPages, apiIds, exchangeId, bodySha256}],
  consistency: {
    atomic: false,
    duplicateApiIds, disappearedApiIds,
    reportedPageCounts, completePageWalk
  }
}
~~~

The original API capture contains schema, connectionId, connectionSha256, apiId, found, kind, definitionText, sha256, bytes, summary and exchanges. Classic Dashboard source retains its complete ApiDefinitionWrapper; Gateway Classic source is the original APIDefinition. OAS source retains the complete original OpenAPI document including x-tyk-api-gateway and other extensions. OAS capture keeps both the original Classic-type discovery response and the exact OAS GET response.

captureApi(apiId, {allowMissing:true}) retains a real 404 as found:false with null kind, definitionText and sha256, zero definition bytes, and its full original exchange. Disappearing definitions remain visible in a complete inventory's consistency metadata.

A paged capture describes a traversal of changing native state. The workspace retains page responses, duplication/disappearance details and per-definition identities. Subsequent mutation preflight compares the exact selected current preimages with the saved review.

## Original HTTP exchange

Every response remains a JSON-serializable original exchange:

~~~text
{
  schema: "stellar-forge.tyk-http-exchange.v1",
  id, connectionId, connectionSha256,
  request: {method, path, query, bodySha256, planSha256?},
  startedAt, completedAt,
  status, statusText, ok,
  headers,
  bodyBytes, bodySha256, bodyBase64, bodyText, json,
  complete: false // present on an interrupted exchange
}
~~~

bodyBase64 is the exact received body. UTF-8 text is retained when valid; parsing a display JSON value never replaces the original bytes. The selected metadata headers include content information, request/correlation IDs, native base-API identity and retry metadata. Credential headers are used for the original request and are not copied into the exchange.

A transport failure exposes its original partial exchange, whether request dispatch began and whether the mutation outcome is unknown. The workspace stores that exchange in its original request journal. HTTP error responses also preserve their body and status. Execution neither follows redirects nor repeats native requests.

## Explicit native selections

### Complete create, import and update

~~~js
{
  operation: "create", // or "import" / "update"
  kind: "classic",     // or "oas"
  definitionText: completeOriginalText,
  contentType: "application/json",
  apiId: exactNativeId,
  query: {}
}
~~~

Classic operations use the native target envelope. Create/update for OAS requires the complete x-tyk-api-gateway definition when JSON is selected. Import takes a plain OpenAPI document without that extension and lets the original Tyk importer create it. Update requires a path API ID matching the ID embedded in the original JSON body. An optional apiId on import is a receiving expectation; it is not silently inserted into the submitted document.

Gateway and Classic endpoints accept JSON. Dashboard OAS additionally accepts application/x-yaml; those bytes pass to the original parser as the complete selected document.

| Kind and operation | Gateway | Dashboard |
| --- | --- | --- |
| Classic create | POST /tyk/apis | POST /api/apis |
| Classic update | PUT /tyk/apis/{apiId} | PUT /api/apis/{apiId} |
| Classic read | GET /tyk/apis/{apiId} | GET /api/apis/{apiId} |
| Tyk OAS create | POST /tyk/apis/oas | POST /api/apis/oas |
| Plain OAS import | POST /tyk/apis/oas/import | POST /api/apis/oas/import |
| OAS update | PUT /tyk/apis/oas/{apiId} | PUT /api/apis/oas/{apiId} |
| OAS read | GET /tyk/apis/oas/{apiId} | GET /api/apis/oas/{apiId} |

Create/import may use the original version keys base_api_id, base_api_version_name, new_version_name and set_default. Import also accepts upstreamURL, listenPath, customDomain, allowList, validateRequest, mockResponse and authentication. Dashboard OAS may select templateID, with that exact capitalization. Boolean fields remain booleans; unknown query keys are rejected. Update has no extra query fields in this contract.

A versioned request retains its base API as a related readback identity. Evidence of the submitted definition remains separate from completeness of the original version relationship update.

### Original native migration

~~~js
{
  operation: "migrate",
  mode: "stage",
  apiIds: ["selected-original-api-id"],
  abortOnFailure: true,
  overrideStaged: false
}
~~~

The request is POST /api/apis/migrate with the original body members mode, apiIDs, abortOnFailure and overrideStaged. The operator selects dryRun, stage, promote or direct explicitly. overrideStaged applies to stage only. The original workspace binds the explicit IDs to an immutable Classic cohort and compares those exact preimages again before dispatch.

The response preserves all original success, failure, skipped and abortedOnFailure fields, including per-API errors, staged identity mappings, original base OAS documents and native version documents. readTykMigrationDefinitions extracts each complete returned document directly from the retained response text, preserving numeric lexemes. The comparison workspace uses these documents for the native conversion review.

For stage, readback includes the original canonical IDs and staged counterparts. A full confirmation covers every selected staged mapping and every native returned definition, including returned versions. Promote/direct confirmation compares the complete returned canonical definitions with current native source. A successful native receipt with incomplete correspondence remains ACCEPTED with its exact evidence.

### Explicit Gateway reload

~~~js
{operation: "hotReload", scope: "node", block: true}
{operation: "hotReload", scope: "group"}
~~~

Node reload uses GET /tyk/reload and its optional block parameter. Group reload uses GET /tyk/reload/group. The original group endpoint has no block parameter. Reload is recorded as its own native request so an API file write, reload acknowledgement and active configuration can each be inspected.

## Correspondence and original-request recovery

The comparison uses the whole submitted definition and the whole native readback. JSON objects compare by decoded member names and values; arrays retain order; every integer and decimal is compared without JavaScript Number rounding. Equivalent numeric spellings such as 1, 1.0 and 1e0 share a value. Duplicate keys or documents that cannot be compared losslessly report the original complete-text condition. YAML remains native-parser input and its exact text is retained.

The Classic envelope can be adapted explicitly with prepareTykDefinition: wrapping a complete Gateway APIDefinition for Dashboard, or extracting the exact original api_definition member for Gateway. This preserves the complete original inner text, and returns source/output hashes plus the named transformation.

Gateway-generated configuration and imported defaults are retained as the actual returned source. When the native importer adds configuration, a complete source match can be established by a subsequent explicit update using that actual native document. The component never creates a replacement Classic-to-OAS conversion to approximate Tyk's result.

| State or evidence | Meaning |
| --- | --- |
| CONFIRMED + CURRENT_NATIVE_CONFIGURATION_MATCH | Every known selected native API has the complete corresponding current configuration |
| CONFIRMED + NATIVE_MIGRATION_DEFINITION_MATCH | The original migration returned the selected complete definitions and current native source corresponds |
| nativeAcknowledged:true | The actual original request returned a successful native acknowledgement |
| nativeAcknowledged:false with current configuration confirmation | The original receipt was lost/partial and current native source establishes the selected configuration |
| ACCEPTED | The actual native receipt is retained and the full corresponding current configuration is not yet established |
| PARTIAL | The original migration returned failures, skipped selections or incomplete selected coverage |
| UNCHANGED / ABSENT / DIVERGED | The current exact API observations are retained in relation to the saved preimages |
| UNKNOWN | Original dispatch exists and its current outcome remains unresolved |

The workspace persists DISPATCHED before the native call. It reopens that saved request and performs readback after a lost result. It never issues the same mutation again during recovery. If the current full configuration matches despite a lost receipt, the record may be CONFIRMED with nativeAcknowledged:false; the original partial response stays in the journal. A later unrelated edit to the same ID does not confirm an earlier submitted configuration. An unknown generated import ID is not guessed.

## Complete original native journey

native-journey.mjs is one coherent receiving operation over the original Gateway and Dashboard, the same saved workspace model, its actual HTTP server/client, and full NDJSON receiving. It uses the selected original Classic seeds, retains them as complete source, and creates separate deterministic API IDs and listen paths for this named operation. Native Classic-to-OAS conversion remains with the Dashboard.

The journey carries:

1. Complete paged original inventories and exact selected source definitions.
2. Gateway Classic creation, its separate reload and an actual request through the Gateway to the declared upstream.
3. Plain OpenAPI import with its actual generated API ID, reload, and a complete original OAS update.
4. Every saved native field review, all review pages and full before/after source downloads.
5. A real Gateway update whose response is interrupted after original bytes are consumed, followed by cold saved-request recovery, explicit reload and full current-source correspondence.
6. A later separately reviewed update that demonstrates the earlier request cannot borrow a different current configuration.
7. Dashboard dryRun, stage, explicit stage override, promote and direct native conversion, preserving canonical/staged/version IDs and full returned definitions.
8. Two complete workspace exports, original streamed download/upload, cold receiving over an earlier edition, exact receiving replay, and reconstruction of an earlier missing archive from its preserved original snapshot.
9. The actual customer browser screenshot when the equipped owner supplies its existing Chromium executable.

Prepare a private JSON configuration using the actual installed target information:

~~~json
{
  "schema": "stellar-forge.tyk-native-journey.v1",
  "operation": "TYK-API-MIGRATION-ROLLOUT-D76C-20261012",
  "gateway": {
    "connection": {
      "id": "receiving-gateway",
      "label": "Original receiving Gateway",
      "kind": "gateway",
      "baseUrl": "http://127.0.0.1:8080/",
      "authEnv": "TYK_GATEWAY_AUTH"
    },
    "installedVersion": "v5.15.1",
    "classicSeedApiId": "ORIGINAL_UNVERSIONED_CLASSIC_API_ID",
    "upstreamUrl": "https://httpbin.org",
    "publicBaseUrl": "http://127.0.0.1:8080/",
    "probePath": "get",
    "expectedUpstreamStatus": 200
  },
  "dashboard": {
    "connection": {
      "id": "receiving-dashboard",
      "label": "Original licensed receiving Dashboard",
      "kind": "dashboard",
      "baseUrl": "https://dashboard.example.com/",
      "authEnv": "TYK_DASHBOARD_AUTH"
    },
    "installedVersion": "5.15",
    "classicSeedApiId": "ORIGINAL_UNVERSIONED_CLASSIC_API_ID",
    "upstreamUrl": "https://httpbin.org"
  }
}
~~~

Use the equipped owner's actual installed version, management/public addresses, reachable upstream and existing unversioned HTTP Classic seed IDs. The supplied version fields are the original owner's runtime declaration. Credentials are resolved through the existing environment references. The complete original selected seed definition is retained; the journey changes only its explicit receiving identity, selected active/keyless behavior, native database create metadata and chosen proxy route/upstream. All numeric source lexemes survive through Node 24's JSON.rawJSON support.

Run the fully joined current source in the existing installed Node 24/Linux environment:

~~~sh
node --max-old-space-size=384 \
  stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/native-journey.mjs \
  /absolute/private/tyk-native-input.json \
  /absolute/private/tyk-native-receiving
~~~

The original workspace uses Linux flock and its existing private storage module. The server and native driver require the complete joined Tyk component and maintained distribution/runtime-workspace source. The optional browser step uses the original installed Playwright and declared chromiumExecutablePath; Node operation remains the same receiving lifetime.

The directory retains journey.json, result.json, full native source hashes, original request/record IDs, exact review/source downloads, both complete NDJSON deliveries and the saved sender/receiver workspaces. A partial run preserves its original request inputs and journals. Resume with the same configuration bytes and directory so the original workspace can recover its saved requests. The original operation-specific APIs remain available for operator inspection and subsequent product use.

## Full portability

The native capture and HTTP exchange types are JSON-safe and preserve complete bytes. The workspace export adds all saved revisions, original sources and journals through its maintained streamed NDJSON format. The receiving engine validates complete source identities and history before adoption. It keeps the original source workspace, delivery ID, request IDs, record revisions and manifest identity when opening a later edition.

The driver checks that an earlier original archive can be reconstructed byte-for-byte after its file disappears, both on its original sender and after cold receiving a later complete handover. This uses the preserved original snapshot; it does not create a new approximation of the earlier export.

## Source and implementation maintenance

NATIVE_CONTRACT.md and native-contract-sources.json are the source map for future endpoint changes. Native helper changes remain in native.mjs. Operator record/history changes belong to workspace/model.mjs, store.mjs, review.mjs and delivery.mjs. Runtime declarations and credentials use the existing installed product and Applications paths. Source publication preserves the current whole product and source-owned contributions.

If an installed vendor release differs from the pinned contract, retain its actual release/schema and original responses with that receiving operation before adopting changed endpoint behavior. The original response and saved request remain the authority for recovery.
