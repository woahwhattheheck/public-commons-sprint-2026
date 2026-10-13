# Tyk migration and rollout workspace

This workspace captures the actual Tyk API portfolio, retains complete original definitions, selects API cohorts and reviews native requests before execution. It keeps the source, preimages, native responses, current readback and every saved revision together. The browser, command line, installed product and MCP provider operate that same original directory.

## Open

Create a private parent directory and supply the Gateway or Dashboard credential through its named environment variable. An initial connections file is a private JSON array:

~~~json
[
  {
    "id": "gateway",
    "label": "Customer Gateway",
    "kind": "gateway",
    "baseUrl": "http://127.0.0.1:8080",
    "authEnv": "TYK_GATEWAY_SECRET"
  },
  {
    "id": "dashboard",
    "label": "Customer Dashboard",
    "kind": "dashboard",
    "baseUrl": "https://dashboard.example.com",
    "authEnv": "TYK_DASHBOARD_TOKEN"
  }
]
~~~

Replace the example endpoints with the customer's actual Tyk administration endpoints. The environment names identify the original credentials; their values stay in the host environment.

~~~sh
starforge tyk-workspace open --dir /srv/private/tyk-workspace \
  --connections /srv/private/tyk-connections.json \
  --url-output /srv/private/tyk-browser-url.txt --port 0
~~~

Startup returns the original private browser URL and workspace UUID. The source CLI is also available directly at workspace/cli.mjs. Ctrl-C drains the original server and releases its single workspace writer. Reopen the same directory to continue saved records. Initial connection declarations seed missing aliases; later saved target revisions remain authoritative.

For the complete installed Applications workflow, use products/tyk-merchant and its operating and receiving guides.

## Portfolio and cohorts

In **Targets**, save a named Gateway or Dashboard, its administration URL and credential environment name. The target list shows whether that credential is present without displaying it.

In **Portfolio**, select a target and capture. The native transport follows the complete Dashboard page count or original Gateway inventory, then reads every complete individual definition. Saved captures retain the original responses, API identities and page observations. A disappeared API remains an explicit absent entry. The portfolio page presents the captured inventory consistency information alongside the saved totals.

Select individual APIs, or **Select all present APIs** to walk every saved page. Saving a cohort binds its exact API IDs and original hashes to that capture revision. Dashboard migration requires a Classic cohort on that same target. If a selected API has changed since capture, prepare a new review from its current capture.

A selected definition exposes the complete original native source. Choose a destination and **Prepare definition for target** to load a reviewed create/update request. Classic definitions use the Dashboard api_definition wrapper or the Gateway's direct definition as appropriate. The adaptation preserves the original inner JSON bytes, including large numeric values. Tyk's native migration endpoint performs Classic-to-OAS conversion.

## Native request lifecycle

1. Select the intended operation and target. For a migration, choose the saved cohort and explicit dryRun, stage, promote or direct mode.
2. Supply the full native definition for create/update, or plain OpenAPI for native import. Optional native query fields remain explicit JSON.
3. Prepare the request. This saves the exact native method, path, query, body and request SHA, plus fresh target preimages.
4. Review the complete source and preimage. Execute the saved revision and its exact plan SHA.
5. Read the original response and current definitions. The saved native reconciliation explains the resulting configuration and the original acknowledgement.
6. For Gateway configuration writes, prepare and execute the separate native reload operation, then refresh the original rollout.

Gateway writes can be accepted before active in-memory definitions change. A node blocking reload and a group reload follow Tyk's distinct native endpoints. Dashboard migrations retain native staged identities, per-API success, skipped entries and failures. Dry run retains the full provider conversion report.

The request form detects changes made after a review. Prepare those changes to create another exact review. An explicit source capture pin remains part of the saved request even when the operator edits the resulting full definition before preparing it.

## Reopen and recover

Every intentional write has a stable UUID requestId. The record journal saves the original native request before dispatch and retains its response before readback. If an HTTP reply or process stops, use the saved original record and request input to recover. A dispatched request is reconciled through native reads. An explicit Gateway reload remains its own reviewed operation.

The browser retains a pending request's complete method, arguments and UUID for recovery after a lost reply. Its Stop action stops the current wait and preserves the saved native operation. Opening the same workspace recovers interrupted local receiving work and keeps partially captured original exchanges.

For an exact current configuration match after a lost native response, reconciliation identifies that observed configuration separately from native acknowledgement. Generated API identities and native-default differences retain the available original evidence until a later original read supplies the missing identity or representation.

## Complete delivery and receiving

**Handover → Export complete workspace** freezes every original record revision, selected head, source blob and native journal into a streamed NDJSON delivery. It includes exact native definitions and binary response bytes. The download contains the entire file and its original SHA-256.

The receiving workspace inspects the complete header, record history, source and journal closure, all content hashes and the final stream record before adoption. Review that receiving record, then adopt its exact manifest SHA and revision. A later reopen continues the same ADOPTING operation. Local histories that already extend a received history stay intact; conflicting original revisions require a separate receiving directory.

An older exported handover can be reconstructed byte for byte from its retained original snapshot if its archive file is absent after transfer. Exporting the receiving workspace carries the imported source and its subsequent saved history.

## Command line and SDK

Generate an intentional operation UUID once:

~~~sh
starforge tyk-workspace request-id
~~~

Place the complete action arguments, including that UUID for writes, in a private JSON file. The command supports every method in the shared actions contract:

~~~sh
starforge tyk-workspace call --url-file /srv/private/tyk-browser-url.txt \
  --method capture --input /srv/private/capture-request.json
starforge tyk-workspace call --url-file /srv/private/tyk-browser-url.txt \
  --method getRecord --input /srv/private/rollout-selection.json \
  --output /srv/private/complete-rollout-review.json
starforge tyk-workspace download --url-file /srv/private/tyk-browser-url.txt \
  --id SAVED_DELIVERY_ID --output /srv/private/tyk-handover.ndjson
~~~

Use --workspace-id with the observed original UUID to pin an HTTP connection. Use --dir for one local action while the browser is closed. The existing browser remains the workspace owner during HTTP actions.

The exported TykWorkspaceHttpClient provides ready, action, actionToFile, downloadDelivery, downloadSource, inspectFile and close. It pins the original workspace identity after connecting, streams complete files to private destinations and returns their hashes and byte counts. The installed product supplies the typed customer SDK.

## Native contract

The transport follows the original Gateway/Dashboard API and the pinned upstream contracts supplied with the product. Gateway authentication uses x-tyk-authorization; Dashboard uses Authorization. HTTP redirects and automatic mutation retries are disabled. Original non-success responses remain part of the saved native outcome.

Tyk's published migration and OAS lifecycle references:

- https://tyk.io/docs/api-management/migrate-from-tyk-classic/
- https://tyk.io/docs/api-management/gateway-config-managing-oas/
- https://github.com/TykTechnologies/tyk/releases/tag/v5.15.1

## Field review and source continuity

Read a saved definition review with `readReview({ id, revision, offset, limit })`. The browser shows routing, authentication, middleware, upstream and metadata changes in a paged before/after table. Every original document and the complete field report can be downloaded. Prepared requests retain their first review; later readback keeps both the current report and that original prepared report.

Native Dashboard dry runs supply the converted definitions. Stage-mode comparisons identify the Classic API and its actual staged copy. Complete current Gateway/Dashboard captures supply executed-request reviews. Missing preimages stay pending until a complete source is available; a recorded 404 identifies an absent API. JSON comparisons keep exact integer and decimal values and ignore equivalent notation or member ordering. YAML and ambiguous JSON remain complete text comparisons.

The common HTTP client carries the original `requestId` and `outcomeUnknown: true` when a write or upload may have reached its owner but its reply is interrupted. Replay that same original request and input to recover the saved record. Its request URL accepts a native loopback listener on port 80 as well as other valid ports.

## Complete two-Gateway course

The gatewayCommissioning kind and five Gateway course actions bind complete create/import/update source to distinct staging and production Gateway records. Existing prepareRollout/dispatchRollout/reconcileRollout remain the only native controller. Native imports use actual provider IDs and explicit full-source transformation acceptance. Complete operating-plan revisions, local editable drafts, supporting files and cold receiving are described in [the installed guide](../../../../../products/tyk-merchant/GATEWAY_COMMISSIONING.md).
