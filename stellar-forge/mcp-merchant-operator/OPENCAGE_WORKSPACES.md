# Operate and receive OpenCage work through merchant MCP

The OpenCage connection gives an agent the same saved geocoding workspace and browser that a human operator uses. Queries, HTTP observations, ordered candidates, decisions, customer files, merchant packages, release generations and Buyer results stay in their existing product records.

Use this interface to complete a location workshare from a reviewed query or retained provider response through candidate selection, customer delivery and a managed merchant release. It has fifteen tools. Provider capture and merchant startup are explicit operations; ordinary inspection, downloads and Buyer recovery use their existing saved data.

The implementation is [opencage-workspace.mjs](opencage-workspace.mjs). The full source, installation, host transport, merchant release and Buyer contracts are in the [OpenCage deployment guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/DEPLOYMENT.md). Use the installed source version that contains both files and the merchant MCP registration below.

## Connect an existing workspace

Keep the original OpenCage workspace on the machine that owns its provider credentials, seller process and Buyer state. Close its separately launched operator before asking MCP to open that same directory. The MCP instance then owns the original workspace lease and its browser; human and agent actions use one model.

A minimal private connection file is:

~~~json
{
  "schema": "stellar-forge.opencage-workspace-connection.v1",
  "workspaces": {
    "locations": {
      "label": "Location workshare",
      "directory": "./geocoding"
    }
  }
}
~~~

Paths are resolved relative to this connection file. The directory must already exist, be private and have a canonical path. An existing workspace contains its original configuration.json. To initialize an empty directory when it is first opened, also select the existing plan and terms files:

~~~json
{
  "label": "Location workshare",
  "directory": "./geocoding",
  "plan": "./plan.json",
  "terms": "./terms.json"
}
~~~

The original compiler validates the selected plan and payment terms. A saved workspace must agree with those supplied values. For an established workspace, omit plan and terms to reopen its own retained configuration. To change the source plan, initialize a separately selected workspace; the original capture and release history remains addressable.

Initialize the maintained merchant operator:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-opencage-workspaces \
  --dir /private/location-mcp \
  --connection /private/location-workshare/opencage-connection.json
~~~

That writes the normal merchant-mcp.json with an opencageWorkspaceConnection reference. It uses the same merchant operator as the other provider workspaces.

For an existing merchant-mcp.json, add only the host-selected connection reference:

~~~json
"opencageWorkspaceConnection": "/private/location-workshare/opencage-connection.json"
~~~

Read and restart that existing operator using its normal lifecycle. All other merchant source and provider settings remain in that configuration.

### Agent host and HTTP clients

Generate a local subprocess MCP registration with the existing registration tool:

~~~sh
node stellar-forge/mcp-merchant-operator/client-config.mjs \
  --config /private/location-mcp/merchant-mcp.json \
  --name locations \
  --output /private/location-mcp/client-registration.json
~~~

The generated entry selects the current Node executable, installed stdio entry and merchant configuration. Supply provider and proxy credentials through the machine's existing private environment. The source plan contains their environment-variable names.

For an HTTP MCP client, launch the original server with the existing token environment:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/location-mcp/merchant-mcp.json \
  --port 3211 \
  --token-env MCP_ACCESS_TOKEN
~~~

Use its returned MCP endpoint and the existing host token. The same original protocol handler validates tools and returns structured results. The [retained file client](retained-download.mjs) exposes openMerchantFileClient for programmatic calls through that endpoint.

## Select source inputs on the host

A workspace may declare three kinds of saved input:

| Field | Value under each named alias | Use |
| --- | --- | --- |
| imports | An observation path and response path | Import or reconcile an exact native HTTP observation |
| packages | A directory containing an existing original merchant package | Import the complete reviewed source/offer/SDK package |
| buyers | A path to the original Buyer client configuration | Recover and adopt an existing Buyer operation |
| facilitator | One selected HTTPS facilitator URL | Stage releases using that host configuration |

Example optional fields inside the locations definition:

~~~json
{
  "imports": {
    "station-response": {
      "observation": "./received/http-observation.json",
      "response": "./received/response.json"
    }
  },
  "packages": {
    "approved-merchant": "./received/merchant-package"
  },
  "buyers": {
    "customer": "./buyer-client.json"
  },
  "facilitator": "https://facilitator.example"
}
~~~

Use the actual chosen facilitator and existing files. Each input file must be a private regular file; each source directory must be canonical. The connection reader pins the input bytes, byte counts and SHA256 values when it loads. A later source-file change requires reloading that reviewed connection. Tools select aliases and never accept a caller-chosen filesystem path.

A Buyer client file has the original Node client options:

~~~json
{
  "runtimeDirectory": "/installed/starforge/sf88-operator-buyer-cli",
  "stateDirectory": "/private/original-buyer-state"
}
~~~

This selects the original Buyer runtime and state. The operation's purchase operator.json is a separate retained file managed by Buyer.fromConfig. The MCP adoption tool selects an existing intentId from that state and calls its original recovery path.

## Open and inspect the work

Call merchant_opencage_workspaces, then merchant_opencage_open:

~~~json
{"workspace":"locations"}
~~~

The result includes instanceId, browserUrl, the original workspace identity, current configuration and merchant state. Opening a second time returns that same owned instance. The browser URL has the private session token in its fragment.

Use merchant_opencage_inspect for the whole saved workflow:

| view | Selection | Returned information |
| --- | --- | --- |
| status | workspace | Configuration, source state, original merchant generations and owned customer browsers |
| requests | workspace | Saved request IDs, normalized queries, outcomes, response hashes and current choices |
| request | workspace, id | Exact request, capture state, response identity, current decision and file inventory |
| candidates | workspace, id | Candidates in original provider order, with their original index and current selection |
| decisions | workspace, id | The original response-bound decision history |
| packages | workspace | Saved merchant package identities, source/terms hashes and file counts |
| package | workspace, id | Complete original manifest, source plan and payment terms |
| deliveries | workspace | Customer export IDs, identities, chosen index and complete file inventories |
| delivery | workspace, id | Reopened customer source, response, selection and licensing semantics |
| release-diff | workspace, after; optional before | The original SF82 difference between the selected saved releases |

Collection views return indexSha256, total, rows and nextOffset. For subsequent pages, repeat the returned indexSha256 as expectedIndexSha256 and use nextOffset as offset. If a concurrent browser edit changes the collection, begin again at the first current page. Candidate indexes still refer to the source response; a selection always names its exact response SHA256.

Request inspection returns a compact decision with historyLength. Use the decisions view to page the full history and file_read for complete saved data.

## Review and capture an exact query

Select the plan's actual product ID. This example uses the existing reverse product:

~~~json
{
  "workspace": "locations",
  "productId": "reverse",
  "input": {"q": "51.952659,7.632473"}
}
~~~

Send it to merchant_opencage_query_review. The original compiler returns the normalized query, including product defaults, source and terms hashes, product mode, provider endpoint, merchant preview URL and reviewSha256. It also returns the original parameter descriptions and example.

To dispatch, call merchant_opencage_capture with the same input and product, a stable request id, and the returned reviewSha256:

~~~json
{
  "workspace": "locations",
  "id": "station-location",
  "productId": "reverse",
  "input": {"q": "51.952659,7.632473"},
  "reviewSha256": "THE_RETURNED_64_CHARACTER_SHA256"
}
~~~

The source uses the plan's private key reference, selected direct or environment-proxy connection, deadline, response size and minimum query interval. It retains the attempted dispatch before making the request. After a lost reply, inspect station-location. Repeating an already completed identical request returns its original response. An incomplete recorded attempt uses the original observation import to reconcile its outcome.

For the public provider test key, the returned location is the provider's documented fixed example and NOWHERE-INTERESTING is its empty-result case. Real production geocoding uses the host's chosen account and the exact submitted query.

A provider HTTP200 can have no candidates. Provider quota, disabled-account and rate-limit results remain distinct from the merchant's payment challenge. The source's current result contains the retained application and provider statuses needed to continue.

## Import an observation or recover a Buyer result

To import the host-declared response:

~~~json
{
  "workspace": "locations",
  "id": "station-location",
  "productId": "reverse",
  "input": {"q": "51.952659,7.632473"},
  "source": "station-response"
}
~~~

merchant_opencage_import_response passes the complete original byte buffer and HTTP observation to GeocodeWorkspace.importResponse. It validates the fixed endpoint, normalized query, original status, response SHA256 and byte count. When reconciling an already recorded attempt, the observation must name that original request hash. Its source attribution and native byte sequence remain in the capture.

To adopt an existing purchase:

~~~json
{
  "workspace": "locations",
  "id": "customer-station",
  "productId": "reverse",
  "buyer": "customer",
  "intentId": "original-buyer-intent",
  "packageId": "merchant-original-package"
}
~~~

merchant_opencage_adopt_buyer recovers that existing SF88 operation. It rechecks the saved purchase configuration, intent, successful result and exact response. packageId selects the saved merchant terms and origin that produced the result; omit it when the original workspace terms are the intended source. The adoption retains the chosen package identity, terms hash, public origin and original Buyer request alongside the capture.

This source distinction matters after repricing or changing the merchant origin. The existing purchase and its delivered response continue to belong to their selected merchant package.

## Make and receive a customer decision

Read the original request and candidates, then call merchant_opencage_select:

~~~json
{
  "workspace": "locations",
  "id": "station-location",
  "responseSha256": "THE_INSPECTED_RESPONSE_SHA256",
  "expectedRevision": 0,
  "index": 0,
  "note": "Selected after checking the coordinate and formatted address."
}
~~~

Use index:null to clear the choice. The workspace compares the exact response and current decision revision before writing. A successful change advances the original revision. If the reply is lost, inspect the current decision and its history before changing it again.

Provider relevance order remains intact. Confidence is a measure of spatial precision. The operator chooses the candidate explicitly.

Call merchant_opencage_export with that response hash and the new current revision:

~~~json
{
  "workspace": "locations",
  "id": "station-location",
  "responseSha256": "THE_INSPECTED_RESPONSE_SHA256",
  "expectedRevision": 1
}
~~~

The result identifies the original export and complete manifest. It includes native response and provenance, candidate and selected CSV/GeoJSON, JSONL, licenses and the complete decision. Repeating the same reviewed export reopens the same saved bundle.

To display its original read-only customer browser:

~~~json
{
  "workspace": "locations",
  "action": "open",
  "exportId": "THE_RETURNED_EXPORT_ID"
}
~~~

Send this to merchant_opencage_customer. Its instanceId and browserUrl select that exact exported delivery. The viewer reads the saved bytes and decision independently of current provider credentials. Close it through the same tool with action:close and its returned instanceId.

### Receive complete files

merchant_opencage_file_read selects a file from the actual inspected capture, package or delivery manifest:

~~~json
{
  "workspace": "locations",
  "kind": "delivery",
  "id": "THE_RETURNED_EXPORT_ID",
  "file": "candidates.csv"
}
~~~

Read manifest.json as well as every manifest.files entry to receive the full bundle. Nested names such as source/buyer-result.json are original manifest selections.

The reply includes the complete file name, byte count and SHA256, a readId, the requested offset, bytesRead, base64 data and nextOffset. Retain expectedSha256 for every continuation. Continue using the exact same workspace, kind, id, file and readId. Decode each chunk as bytes and place it at its returned offset; verify the complete byte count and SHA256 against the manifest before opening the file.

The maintained RetainedFileReads owns temporary verified snapshots. Large files use an unlinked private descriptor. Expired or released reads can resume by omitting readId while retaining the original selection, expectedSha256 and byte offset. The same selection is verified again against the original source reader. merchant_opencage_file_release releases a read early.

After all files and manifest.json are received, the normal GeocodeDelivery.open reader revalidates the complete native source, decision, projections and provenance. Use the existing OpenCage CLI read --delivery RECEIVED_DIRECTORY or serve --delivery RECEIVED_DIRECTORY to inspect and display that complete customer delivery.

## Prepare and operate the merchant

merchant_opencage_package prepares the native merchant package from the saved source plan and current payment terms. Supply a complete terms object to prepare a proposed price/origin change. Alternatively, source selects a host-declared original package alias; omit terms for this import.

Inspect the returned package ID and manifest. The generated seller-client.mjs, seller-client.d.mts and package.json retain the original SDK entry contract. Package identity includes the selected source and complete generated files.

The release tool uses these action-specific fields:

| action | Required fields after workspace/action | Optional fields | Result |
| --- | --- | --- | --- |
| stage | packageId, id | label | Original immutable SF82 release and private installed handler entry |
| activate | id, expectedGeneration | reason | Current original release generation |
| rollback | expectedGeneration | reason | Original previous-release selection |
| start | expectedGeneration | | This process-owned original merchant runtime |
| stop | | | Completed drain of this process-owned merchant |

stage uses the host-selected facilitator and an ephemeral local merchant port. The prepared package must match the installed provider source. A source upgrade calls for a package prepared by that installation.

Inspect status and release-diff before selecting a generation. Keep the chosen release ID and expectedGeneration through the original response. Following an interrupted stage, inspect the saved release and diff. Following an interrupted activation or start, read status and its owned runtime before deciding the next action.

A stop or workspace close drains accepted work before releasing the provider and its configured connection. Closing the MCP-owned workspace also closes its customer viewers and retained file snapshots, then releases the original workspace lease.

## Operating continuation

| Observed state | Continue through the same workflow |
| --- | --- |
| Completed request after a lost reply | Inspect the same id; use its retained response and decision |
| Incomplete recorded provider attempt | Import its exact host-declared HTTP observation |
| Changed candidate decision | Reopen the current revision, review it and submit the intended choice |
| Changed source-alias file | Reload the reviewed host connection; preserve prior captures |
| Changed collection while paging | Read the first current page and continue using its index SHA256 |
| Expired file read | Keep original file hash/offset and obtain a new readId |
| Repriced or moved merchant | Select the actual saved package when adopting the original Buyer operation |
| Another process owns the workspace | Close that original operator or select its existing connection, then open the same directory |
| Owned merchant still running | Use the original stop action or close its owning workspace |
| Completed received delivery | Reopen its original manifest through GeocodeDelivery or the customer CLI |

The MCP connection changes how the operator reaches the product. The original provider source, paid merchant, Buyer, customer delivery and installed release remain the implementations that produce and verify its work.
