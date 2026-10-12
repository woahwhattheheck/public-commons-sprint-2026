# Operate a Tyk API portfolio

The installed product retains one original Tyk workspace through source intake,
native review, dispatch, active-state observation and customer receiving. The
browser, installed CLI, typed client and configured merchant MCP provider all
operate that same saved state.

## Prepare the host and target

Use Node 24 with Linux flock, a private product directory and the existing
Gateway or Dashboard address. The Gateway administrator secret or Dashboard
authorization credential belongs in the original process environment. The
saved connection contains its environment-variable name.

A private initial connection file uses this shape. Replace the example address
and variable name with the selected native target:

~~~json
{
  "schema": "stellar-forge.tyk-product-connections.v1",
  "connections": [
    {
      "id": "gateway-development",
      "label": "Development Gateway",
      "kind": "gateway",
      "baseUrl": "http://127.0.0.1:8080",
      "authEnv": "TYK_GATEWAY_SECRET"
    }
  ]
}
~~~

~~~sh
starforge tyk-product init --dir /srv/private/tyk-product \
  --connections /srv/private/tyk-connections.json \
  --name "Development API operations"
starforge tyk-product open --dir /srv/private/tyk-product --port 0
~~~

Initial declarations seed aliases that are absent from the original workspace.
The workspace's saved target revisions take precedence on reopen. Edit an
existing target through its original saved connection record and revision.

There are two connection identifiers. The human alias, such as
`gateway-development`, appears inside the normalized connection. The saved
record has a **24-character hexadecimal ID**. Capture, prepare and adaptation
operations select that saved record ID. The status command returns both.

~~~sh
starforge tyk-product status --dir /srv/private/tyk-product
starforge tyk-product actions --name saveConnection
~~~

## Capture complete source and save a cohort

Capture requests retain complete native inventory pages, original HTTP
responses and each definition. A capture is immutable source for subsequent
cohorts. Open its saved record to page the whole portfolio; select a definition
to read its complete original content.

Save one request UUID and keep the same command arguments when reopening an
interrupted request. In the commands below, replace uppercase labels with
the actual returned record IDs, revisions, hashes and saved UUIDs.

~~~sh
starforge tyk-product capture --dir /srv/private/tyk-product \
  --request CAPTURE_REQUEST_UUID --connection CONNECTION_RECORD_ID \
  --label "Current API portfolio"

starforge tyk-product record --dir /srv/private/tyk-product \
  --kind capture --id CAPTURE_RECORD_ID --revision CAPTURE_REVISION \
  --offset 0 --limit 50

starforge tyk-product definition --dir /srv/private/tyk-product \
  --capture CAPTURE_RECORD_ID --revision CAPTURE_REVISION \
  --api ORIGINAL_API_ID
~~~

Continue a paged record with its returned next offset. Current-record lists
return a snapshot hash: retain that hash while walking later list pages.
If the current list changed, refresh its first page to select the current
snapshot.

Save selected original API IDs in a private JSON array and create a cohort:

~~~sh
starforge tyk-product cohort --dir /srv/private/tyk-product \
  --request COHORT_REQUEST_UUID --capture CAPTURE_RECORD_ID \
  --capture-revision CAPTURE_REVISION --apis /srv/private/selected-api-ids.json \
  --label "Migration cohort" --note "Selected customer APIs"
~~~

The cohort keeps the capture revision and original definition hashes. The
native preparation compares its selected preimages with the target before
executing a migration.

A complete original inventory capture can also be imported using
`importCapture`. The native importer validates definition bytes and retained
HTTP exchange hashes, then saves the same complete capture form. The
`actions --name importCapture` contract supplies its precise arguments.

## Select the native operation

| Target and operation | Original behavior |
| --- | --- |
| Gateway Classic create/update | Original unwrapped Classic API definition, sent as JSON |
| Dashboard Classic create/update | Original Dashboard `api_definition` wrapper |
| Gateway or Dashboard OAS create/import/update | Original Tyk OAS definition and supported native query fields |
| Dashboard OAS YAML | Original YAML body sent unchanged with `application/x-yaml` |
| Dashboard migration | Native API migration in dry-run, stage, promote or direct mode |
| Gateway reload | Explicit native node or group reload; node reload may select blocking behavior |

The SDK's selection types preserve the actual native field names. Version
creation uses `base_api_id`, `base_api_version_name`,
`new_version_name` and `set_default`. Native import controls include
`upstreamURL`, `listenPath`, `customDomain` and the original boolean
import flags. Dashboard OAS create/import uses the exact `templateID` field.
Update requests keep their original empty query. The native planner validates
the target-specific combination before a review is saved.

### Use an original captured definition on another target

Choose the destination connection before adapting a capture. The read-only
adapter returns the original capture and target pins, original source SHA,
adapted SHA, complete body and exact transformation. It can wrap or unwrap
the Dashboard Classic envelope. The native engine remains responsible for
format conversion and migration.

~~~sh
starforge tyk-product adapt-definition --dir /srv/private/tyk-product \
  --capture CAPTURE_RECORD_ID --revision CAPTURE_REVISION \
  --api ORIGINAL_API_ID --connection DESTINATION_CONNECTION_RECORD_ID
~~~

Use the returned complete definition in a create/import/update selection.
Retain its `sourceDefinition` object as a private JSON file and pass
`--source-definition` during preparation. The saved review then links the
original capture to the destination's exact request.

### Prepare a Dashboard migration

A native migration selection contains an explicit mode, full API-ID selection
and its native flags:

~~~json
{
  "operation": "migrate",
  "mode": "dryRun",
  "apiIds": ["original-api-id"],
  "abortOnFailure": true,
  "overrideStaged": false
}
~~~

The selected cohort must belong to the original Dashboard target and contain
the same Classic API IDs. A stage request may select `overrideStaged`;
other modes preserve it as false.

~~~sh
starforge tyk-product prepare --dir /srv/private/tyk-product \
  --request PREPARE_REQUEST_UUID --connection DASHBOARD_CONNECTION_RECORD_ID \
  --cohort COHORT_RECORD_ID --cohort-revision COHORT_REVISION \
  --selection /srv/private/migration-selection.json \
  --label "Review selected API migration"
~~~

Read the saved rollout record. It contains the exact native method/path,
request plan SHA, selected target configuration, source cohort and current
preimages. Retain that returned record ID, revision and plan SHA.

## Review complete field changes

Open the saved rollout's field review in the browser or page it through the
same original action:

~~~sh
starforge tyk-product review-fields --dir /srv/private/tyk-product \
  --id ROLLOUT_RECORD_ID --revision REVIEWED_REVISION --offset 0 --limit 50
~~~

The returned report keeps the exact rollout revision, original plan SHA and
complete report SHA. Its summary separates changed, unchanged and pending API
definitions. Each page includes the full field path, routing/authentication/
middleware/upstream category and added, removed or changed value. Values retain
their original byte hashes and lossless semantic hashes. Large previews are
explicitly marked; download their original source or the complete report
instead of treating a preview as the whole value.

The source pairs distinguish a missing native definition from a definition
awaiting the original conversion response. Native staged-copy relationships
remain linked to the original Classic API. The report labels whether it is
reviewing the prepared request, native conversion, or current readback.

Save the returned `report` reference as a private JSON file to receive the
entire report, including every changed field:

~~~sh
starforge tyk-product download-source --dir /srv/private/tyk-product \
  --reference /srv/private/review-report-reference.json \
  --out /srv/private/review-report.json
~~~

Use the same endpoint for the before/after source references. The receiver
checks the full byte count and SHA-256 and retains the complete original file.

## Execute and observe the original request

~~~sh
starforge tyk-product dispatch --dir /srv/private/tyk-product \
  --request DISPATCH_REQUEST_UUID --id ROLLOUT_RECORD_ID \
  --revision REVIEWED_REVISION --plan-sha256 REVIEWED_PLAN_SHA256
~~~

The original model rereads target preimages before dispatch. A changed
definition produces a stale review. Prepare a fresh review from the selected
current source to continue.

The native request is persisted as dispatched before it is sent. Its original
response and affected API readback remain attached to the rollout. A request
that has already advanced past preparation returns its retained state when
the same rollout is reopened.

| State | Operator meaning |
| --- | --- |
| PREPARED | The native request and target preimage are saved for review |
| ACCEPTED | A native save receipt exists; Gateway active state still requires reload |
| CONFIRMED | The corresponding active definition was observed |
| PARTIAL | Native results or affected definitions differ across the selection |
| UNCHANGED | The observed native state remains unchanged |
| DIVERGED / ABSENT | The affected original definition differs or is missing |
| UNKNOWN | Read the retained response and reconcile the same dispatched request |
| STALE | A target preimage changed before dispatch; prepare its current review |

For Gateway writes, readback observes active in-memory definitions. A saved
apps-file change can therefore be ACCEPTED until the explicit reload. To
activate selected Gateway configuration, prepare a separate native reload:

~~~json
{
  "operation": "hotReload",
  "scope": "node",
  "block": true
}
~~~

Review and dispatch that reload through the same prepare/dispatch procedure.
After a successful native reload, the workspace refreshes same-target pending
write reviews using their original receipts. Node and group scope are explicit
customer choices.

## Continue after interruption

The retained request UUID, rollout ID, original plan SHA and target selection
are the recovery identity. The SDK reports an uncertain outcome when response
I/O is interrupted after a write may have been sent.

For an initial saved-record operation, invoke the same method with its saved
request UUID and unchanged arguments to reopen its original result. For an
already-dispatched rollout, open the same record and refresh the original
readback:

~~~sh
starforge tyk-product record --dir /srv/private/tyk-product \
  --kind rollout --id ROLLOUT_RECORD_ID

starforge tyk-product reconcile --dir /srv/private/tyk-product \
  --request RECONCILE_REQUEST_UUID --id ROLLOUT_RECORD_ID
~~~

A changed target configuration requires a fresh native review for that current
target. Reconciliation reads the original response and selected definitions;
it preserves the original dispatch.

Stop the installed application through its existing owner or send SIGTERM to
its foreground command. The product drains the native workspace before
releasing its product lease. Reopen the same private directory to keep the
workspace UUID and all retained record revisions.

## Use the typed client

The package export `./products/tyk-merchant/client` supplies typed native
selection unions and all original workspace actions. This example runs from
the installed source root and reads an already-saved request file:

~~~js
import { readFile } from 'node:fs/promises';
import { TykProductClient } from './products/tyk-merchant/client.mjs';

const client = new TykProductClient({
  directory: '/srv/private/tyk-product',
  timeoutMs: 240000
});
const request = JSON.parse(await readFile('/srv/private/capture-request.json', 'utf8'));
const captured = await client.capture(request);
const firstPage = await client.getRecord({
  kind: 'capture',
  id: captured.id,
  revision: captured.revision,
  offset: 0,
  limit: 50
});
console.log(firstPage.portfolio);
await client.close();
~~~

The client exposes `view`, paged records, full definitions, target adaptation,
original source reads, complete field comparisons, saved connections, captures, cohorts, preparation,
dispatch, reconciliation and complete export/receiving. `call(method,args)`
uses the same pure action schemas as the browser and provider. Downloads
stream original bytes into complete private files; uploads stream those bytes
into the native receiving model. `callToFile(method,args,{path})` saves the
complete original JSON reply through that same receiver. `downloadSource`
streams the original source or review report by its immutable byte reference.
`close()` ends this client's HTTP work while the installed application remains
under its original foreground or Applications owner.

## Connect the merchant agent to the same workspace

Read the original workspace UUID from `status`, then save a private connection
document using the product's existing URL file:

~~~json
{
  "schema": "stellar-forge.tyk-workspace-connection.v1",
  "workspaces": {
    "api-operations": {
      "label": "Customer API operations",
      "workspaceId": "ACTUAL_WORKSPACE_UUID",
      "consoleUrlFile": "/srv/private/tyk-product/browser-url.txt"
    }
  }
}
~~~

Use the actual returned UUID in place of the label. Keep this file and its
parent private. `consoleUrlEnv` is the supported alternative when the original
host supplies the private URL through an environment variable. The saved
workspace UUID remains required in either form.

~~~sh
starforge tyk-agent-init --dir /srv/private/tyk-agent \
  --connection /srv/private/tyk-agent-connection.json \
  --name "Customer API operations"

starforge merchant-mcp serve --config /srv/private/tyk-agent/merchant-mcp.json \
  --port 0 --token-env MCP_ACCESS_TOKEN
~~~

Provide `MCP_ACCESS_TOKEN` through the original host environment. The
initializer creates or reopens the maintained merchant configuration and
release store. Its source-owned Tyk provider connects to the existing
workspace URL and verifies the declared UUID. Browser actions, typed calls and
MCP tools therefore share the same saved captures, reviews, request journal and
customer receiving. A product restart replaces the private URL file; the
provider's original connection reader selects that current owner.

The `files` section can explicitly expose a private handover by label, path and
full SHA-256 for streamed inspection. Follow the complete source-owned
[merchant configuration guide](../../stellar-forge/mcp-merchant-operator/TYK_WORKSPACES.md)
for the precise native tool and file-selection contracts.

Continue with the [complete receiving procedure](RECEIVING.md) to move this
workspace, source history and saved native operation records to a customer host.
