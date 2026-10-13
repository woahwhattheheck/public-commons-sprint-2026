# Operating the Gravitee commissioning workspace

## Establish the target and its native contract

Open the original local workspace URL and select a saved connection. Check its organisation and environment as well as the Management API v2 base URL. The configured gateway URLs are separate from Management API.

The connection's credential values are resolved on the host. A bearer token uses `auth.tokenEnv`; basic authentication uses `auth.usernameEnv` and `auth.passwordEnv`. These variables remain host configuration through receiving. Each native exchange records the credential-free request, provider status, relevant response headers, exact response bytes and timing.

The included contract uses APIM 4.12.21's actual API and plan resources. Its operation list is available through `node cli.mjs contract` and the request screen. Use the bundled contract for the documented 4.12.21 resource-method correction. When selecting another installed OpenAPI contract, inspect its actual returned methods and statuses in the original operation history.

## Capture before changing the cohort

The capture action takes a label, connection ID and optional explicit API IDs. An omitted API list selects the v4 HTTP proxy APIs visible to that connection. Inventory reads follow page/perPage and the returned terminal pagination. Each page remains linked to its original complete response.

Per API, capture records:

| Resource | Native receiving behavior |
|---|---|
| API | Full current v4 definition and identity |
| Definition export | Full native export with an empty exclusion set |
| Plans | Every page of STAGING, PUBLISHED, DEPRECATED and CLOSED plans |
| Documentation | Native documentation collection |
| Members | Every declared member page |
| Metadata | Every metadata page and source attribution |
| Events | Every event page, with native payloads and identities |
| Deployment | Current deployment definition and API deployment state |

A role-sensitive resource can return its own error while other resources remain captured. The resulting capture records that partial state and its exact native responses. Use the request console and the target's ordinary role configuration to complete the relevant resource, then invoke the same capture request UUID to receive its completed revision.

## Import source and build its real mapping

Use a source directory when the RAML contract includes relative files. Directory paths are kept so `!include` resolution uses the same original relationships. The entry document and each include must resolve inside that bundle.

For a REST proxy mapping, specify the actual upstream service and gateway context path. The generated native body uses:

```json
{
  "name": "Orders",
  "apiVersion": "1.0",
  "definitionVersion": "V4",
  "type": "PROXY",
  "visibility": "PRIVATE",
  "listeners": [{
    "type": "HTTP",
    "paths": [{"path": "/orders"}],
    "entrypoints": [{"type": "http-proxy"}]
  }],
  "endpointGroups": [{
    "name": "default-group",
    "type": "http-proxy",
    "endpoints": [{
      "name": "default",
      "type": "http-proxy",
      "weight": 1,
      "inheritConfiguration": false,
      "configuration": {"target": "https://orders.example.net/"}
    }]
  }]
}
```

The mapping editor keeps the complete native body and plans editable. Source behavior entries should describe the real implementation: the selected authentication plan, gateway policy and phase, retained transformation component, or the original source behavior that is outside this particular proxy contract.

A useful authentication disposition names both the native plan type and the relevant configuration: issuer/audience/key source for JWT, the actual OAuth2 introspection integration, or the certificate trust source for mTLS. The source's client identity, scopes and error behavior remain part of commissioning.

A DataWeave file is preserved as original application source. Its transformation needs an actual supported replacement, retained companion service or upstream implementation when it affects this route. Record the component and contract version in the corresponding mapping field. The source importer presents that work at the exact original file.

Create the initial draft, edit its body and mappings, and save a new complete revision. The commissioning review hash binds that exact native body, source identity and mapping edition.

## Prepare and execute an individual native change

The native request screen uses the selected operation's declared method and path. It collects API, plan, page or event IDs separately from the native JSON payload.

For example, a plan creation request uses `createApiPlan`:

```json
{
  "requestId": "a9c6f7e0-6c36-4b20-8d4c-b441959a2359",
  "connectionId": "saved-connection-id",
  "operationId": "createApiPlan",
  "parameters": {
    "apiId": "native-api-id",
    "body": {
      "definitionVersion": "V4",
      "name": "Orders access",
      "description": "Consumer access to the Orders service",
      "characteristics": [],
      "security": {"type": "API_KEY"},
      "mode": "STANDARD"
    }
  }
}
```

Read the returned operation record. Its preparation contains the complete request and current target. Execute that operation ID with the returned `planSha256`. The source workspace checks that the API and, where selected, the plan still match the prepared target.

On API update, start, stop and review routes, the included release supports the server's original ETag. That value is included in the prepared request's conditional header. A concurrent provider edit is then handled by the native server as well as the workspace's current-definition comparison.

For a full-definition import, inspect `definitionImport.plansAbsentFromPayload`. The original full capture gives the plan IDs, cross-environment identities, status and complete exported resources. Keep the intended plan set in the payload. The actual APIM import decides how subscribed and omitted plans are handled.

The operation's complete provider response appears in the request panel and remains available as its original object. A 201 or 200 records that native outcome. A 202 records acceptance. A provider rejection retains its own status and body. A network interruption keeps the original operation for reconciliation.

## Run a complete commissioning sequence

Commissioning creates one original parent sequence and stable child requests. Its exact draft and selected steps remain in that record. The sequence covers:

1. Native API creation or v4 definition import.
2. Each configured plan creation.
3. Each selected plan publication.
4. The selected platform review request and/or acceptance.
5. Optional API portal publication.
6. Optional API start.
7. Native deployment verification.
8. Optional deployment request.
9. Complete API receiving capture and configured gateway observations.

The actual server checks API and review permissions. Its review state remains visible as DRAFT, IN_REVIEW, REQUEST_FOR_CHANGES or REVIEW_OK. A deployment verification response carries its native `ok` and `reason`. Correct the named configuration or installed feature and continue the original sequence after resolving the relevant native request.

The parent sequence stores child IDs as it progresses. If a response is interrupted, reopen that child operation, reconcile its actual native result, and use **Continue original sequence**. Previously accepted requests retain their original result and identity.

A 429 response retains the provider's complete reply. A valid Retry-After value sets the original request's next retry time. If that header is absent or invalid, the application records a local delay of 60 seconds; consecutive replies without a valid header double that delay up to one hour. This local delay is identified separately from a provider instruction. After the saved time, use **Execute original request** or **Continue original sequence** to advance the same request and preserve its earlier responses. The application does not run a retry loop. A reply with an uncertain native outcome uses its existing reconciliation path.

## Read deployment and gateway results

The deployment label is limited to the native 32-character field. The current-deployment endpoint returns the definition known to Management API. Capture its full object and the API's deployment state.

Configure actual gateway URLs in the connection. A gateway probe combines that configured base with the chosen path and can use GET, HEAD or OPTIONS. Optional headers reference host environment variables:

```json
{
  "gatewayIndex": 0,
  "path": "/orders/health",
  "method": "GET",
  "expectedStatus": 200,
  "headerEnv": {
    "X-Gravitee-Api-Key": "ORDERS_CONSUMER_API_KEY"
  }
}
```

The result includes original response bytes, SHA256, status, timing and the expected-status comparison. Run the service's real transaction client for POST/PUT business workloads and retain its input edition and result with the cohort.

For multiple gateway instances, add the relevant explicit observations. A source-native receiving run waits for each configured gateway's actual response while preserving every observation.

## Events, rollback and documentation

Use the captured event inventory to select a real event ID. The rollback operation takes that event ID in its native request body and uses the current API context. Preparation reads the selected event through that API's scoped native event route and retains its payload before dispatch. Review that original payload and recapture the API after the native response.

Documentation creation, update and publication are available through their native request operations. Their JSON bodies follow the selected Management API schema. The source bundle can include original documentation and media so the receiving team can reproduce the same edition.

## Operating history and exports

Record revisions are immutable and chained to their prior SHA. Native exchanges and their full source objects have content-addressed identities. The journal records the order of dispatch, native responses and subsequent receiving. The ordinary kernel writer lease serializes changes from different local clients. Local request records are saved before work starts; deterministic source, note and handover identities and original draft-edit revisions let a reconnect finish the same request after its domain record was already written.

The head index is a small current-record map. Opening the workspace reconciles complete immutable record chains after an interrupted head update. Source objects and original provider responses remain unchanged through that repair.

Handover archives are stored separately from the operating object store. A later handover contains the complete operating history and original sources while earlier derived archive files retain their own producing-host artifact record. This keeps repeat exports proportional to the work instead of nesting every previous archive inside the next one.

Use the handover screen or CLI to create and download the complete editable workspace. A retained file reference identifies all bytes with its SHA256 and byte count. Merchant MCP provides full manifests and ranged file reads for larger results.
