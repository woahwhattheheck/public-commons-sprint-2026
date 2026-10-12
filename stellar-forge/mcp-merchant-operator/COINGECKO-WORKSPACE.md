# CoinGecko market research through the merchant MCP

This connection exposes the existing CoinGecko research browser and native purchase model through the same merchant MCP used by the rest of Starforge. Agents and browser operators work on one original model, one retained project revision, and the same source files, records and purchase IDs.

The 32 tools cover request collections, original response intake, linked market rows, snapshots, exact comparisons, research notes, provider deployment plans, native checkout preparation and recovery, complete file delivery, and portable project restoration. The original CoinGecko CLI and browser remain available.

Opening the native SQLite workspace requires **Node.js 24 or later**. Host configuration, credentials and project state belong outside the installed toolkit so that an upgrade preserves them.

## Configure the existing host

Create private directories for the original workspaces. A second directory is useful when receiving a portable handover without replacing the working project. The configuration reader expects existing directories owned by the host user with mode 0700, and original regular configuration/input files with mode 0600. Each canonical workspace directory has exactly one alias in a connection.

Example private connection file:

~~~json
{
  "schema": "stellar-forge.coingecko-workspace-connection.v1",
  "workspaces": {
    "market": {
      "label": "CoinGecko market research",
      "directory": "./market",
      "actor": "Market research agent",
      "buyerProfiles": [
        {
          "id": "original-buyer",
          "name": "Original configured Stellar buyer",
          "network": "stellar:testnet",
          "configPath": "./buyer/configuration.json",
          "workspacePath": "./buyer/workspace"
        }
      ],
      "inputs": {
        "response": {
          "path": "./inputs/original-response.json",
          "label": "Original retained provider response",
          "contentType": "application/json",
          "kind": "source"
        },
        "response-headers": {
          "path": "./inputs/original-headers.json",
          "contentType": "application/json",
          "kind": "source"
        }
      }
    },
    "receiving": {
      "label": "Received market handovers",
      "directory": "./received"
    }
  }
}
~~~

Paths are resolved relative to this connection file. Omit buyerProfiles for research that does not use a native buyer. Each profile can select configPath, workspacePath, or both, following the original buyer configuration contract. Retain the actual network of that profile; the data network in an on-chain market request is a separate value.

A host that explicitly enabled local merchant origins in the original native workspace can retain that setting with allowLocal: true on its workspace definition. It defaults to false and is not a tool argument. This preserves the original normalizer behavior for that host; the native fetch, signing and payment rules remain unchanged.

The host can declare up to 32 workspace aliases, 32 buyer profiles per workspace, and 128 input aliases per workspace. An input has kind source or handover. Source files can contain up to 15,000,000 bytes; original handovers can contain up to 67,108,864 compressed bytes under the native restore contract. Labels and paths are host configuration. MCP callers select aliases and original record IDs.

Initialize the existing merchant host:

~~~sh
starforge merchant-mcp init-coingecko-workspaces \
  --dir /absolute/private/coingecko-mcp \
  --connection /absolute/private/coingecko-workspaces.json \
  --name "CoinGecko research operator"
~~~

This creates the ordinary merchant-mcp.json, release store and customer export directory. It validates the original declared workspaces and files. The caller opens a workspace explicitly through merchant_coingecko_open.

For an existing merchant-mcp.json, retain its other connections and add:

~~~json
{
  "coingeckoWorkspaceConnection": "/absolute/private/coingecko-workspaces.json"
}
~~~

Serve through the existing authenticated loopback MCP transport:

~~~sh
starforge merchant-mcp serve \
  --config /absolute/private/coingecko-mcp/merchant-mcp.json \
  --port 3211 \
  --token-env MCP_ACCESS_TOKEN
~~~

Use the existing merchant stdio/client configuration flow when that is the selected client transport. Both transports call the same MerchantReleaseOperator and expose the same catalog. The package export for application hosts is:

~~~js
import {
  MerchantCoinGeckoWorkspaces,
  readCoinGeckoWorkspaceConfiguration,
  coingeckoWorkspaceTools
} from '@tokenjunkielabs/starforge-merchant/merchant/mcp/coingecko';
~~~

Signer secrets stay in the existing buyer environment. The connection contains original configuration paths and labels. Tool schemas do not accept signer values, filesystem paths, arbitrary modules or replacement payment implementations.

## Open the shared browser and model

Call merchant_coingecko_workspaces, select an alias, and call merchant_coingecko_open. Keep its instanceId and current browserUrl. A repeated open through the same MCP process returns the same owned service. Open the returned URL to use the original industrial research interface alongside the agent.

merchant_coingecko_status returns the native endpoint contracts, saved projects, public buyer-profile metadata, native job statuses and file-read sessions. Its contracts are the original five separate endpoint families, including their path fields, query fields, defaults and documentation URLs.

Use merchant_coingecko_project to obtain the current project revision before a write. One original workspace lease prevents a separate mutating CLI or another server from taking the same directory. Multiple operators use the browser and MCP already attached to the owned service.

Close with the current instanceId. Closing drains pending tool calls and the original worker, releases file-read snapshots and then closes the native model and lease. Reopen the same alias to continue the saved projects. Original unfinished native purchases reopen as interrupted work for explicit inspection and recovery.

## Complete tool map

| Workflow | Tools |
| --- | --- |
| Host and browser ownership | merchant_coingecko_workspaces, merchant_coingecko_open, merchant_coingecko_close, merchant_coingecko_status |
| Projects and retained state | merchant_coingecko_project, merchant_coingecko_project_create, merchant_coingecko_configure, merchant_coingecko_records, merchant_coingecko_inspect, merchant_coingecko_operation |
| Requests and collections | merchant_coingecko_request_save, merchant_coingecko_collection_save, merchant_coingecko_collection_import |
| Original source intake | merchant_coingecko_sources, merchant_coingecko_source_inspect, merchant_coingecko_source_import, merchant_coingecko_response_import, merchant_coingecko_provider_example, merchant_coingecko_probe |
| Market research | merchant_coingecko_rows, merchant_coingecko_row, merchant_coingecko_snapshot_create, merchant_coingecko_comparison_create, merchant_coingecko_note_save |
| Provider deployment | merchant_coingecko_provider_plan_preview, merchant_coingecko_provider_plan_save |
| Original native buyer | merchant_coingecko_checkout_prepare, merchant_coingecko_job_control |
| Complete handover | merchant_coingecko_handover_create, merchant_coingecko_restore, merchant_coingecko_file_read, merchant_coingecko_file_release |

## Revisions, versions and lost replies

Every write takes an explicit stable opId. Writes to an existing project also take its current revision. Updates to a request, collection, note or provider plan take the original record ID and current version. Creating a record omits both record ID and version.

The native transaction retains the exact write request hash and response. Repeating an identical write with the same opId returns that original response before checking the newer project revision. Path-selected target IDs are included in the native write identity. Reusing that opId for different submitted values or a different target returns OPERATION_CONFLICT. Existing older receipts remain recoverable only when their saved response identifies the same target. A replay returns replayed: true and does not schedule native work again.

After a lost reply, call merchant_coingecko_operation with the original opId and projectId. For project creation and handover restoration, omit projectId because those operations belong to the native workspace scope. The response reports RETAINED or NOT_RETAINED. A retained operation includes its requestSha256 and saved response. Purchase/probe writes additionally include currentJob so current action availability is separate from the historical write response.

When a different operator has changed the project, STALE_REVISION requires reading the current project and combining the intended changes with it. STALE_VERSION requires inspecting the current record. Give a deliberately revised write its own opId. Preserve the original opId for recovering the unchanged request.

The configured actor is retained in native project events. If an alias has no actor, the merchant host name is used. Project archives retain original record histories and source evidence; restored projects have native ID mappings and a separate operation scope.

## Author requests and complete collections

Create a project with merchant_coingecko_project_create, then inspect its revision. Configure its merchantOrigin, merchantPrefix and selected buyerProfileId through merchant_coingecko_configure. Empty merchantOrigin and buyerProfileId are valid for source research.

Read the endpoint contract from status before saving a request. Example original request definition:

~~~json
{
  "name": "Selected coin prices",
  "endpoint": "simple-price",
  "path": {},
  "query": {
    "ids": "bitcoin,ethereum",
    "vs_currencies": "usd",
    "include_last_updated_at": true,
    "precision": "full"
  },
  "notes": "Retain the complete provider response with its original observation time.",
  "enabled": true
}
~~~

Pass that object as request in merchant_coingecko_request_save. The original normalizer validates the endpoint's own allowed fields and builds exact vendor/merchant URLs. For edits, inspect the retained request and versions before supplying requestId and version.

Save collections with an explicit ordered list of requestIds:

~~~json
{
  "name": "Market review",
  "description": "Complete selected endpoint requests",
  "requestIds": ["ORIGINAL_REQUEST_ID"]
}
~~~

A collection can retain up to 1,000 distinct original requests. Every selected request must belong to the project. Its full definitions can be downloaded through file_read with kind collection.

To import a complete existing collection, retain its original package as a source file and call merchant_coingecko_collection_import with that fileId. The native collection importer preserves original definitions, references and source linkage.

## Import original responses without losing bytes

List host inputs with merchant_coingecko_sources, then inspect the chosen input through merchant_coingecko_source_inspect. That read returns the exact SHA256, byte count and source metadata. Supply the same expectedSha256 and alias to merchant_coingecko_source_import.

For a small source already available to the client, provide filename and canonical contentBase64 instead of an input alias, with the same expectedSha256. Inline import supports up to 65,536 bytes so its base64 and metadata fit within the existing 128 KiB HTTP request limit. Larger original responses use the host-declared input path or the native browser source uploader. They retain their full native size limit.

The import returns an original fileId. Call merchant_coingecko_response_import with its requestId and fileId. Optional original headersFileId, responseBodyFileId, httpStatus, sourceUrl, observedAt and name are passed directly to the native response importer. All selected files must belong to that project.

For an original captured metadata envelope containing URL, status and headers, also select its original body file with responseBodyFileId when available. The native importer preserves the envelope, original body identity and observation timestamp. Raw response imports retain their exact file bytes and analysis.

merchant_coingecko_provider_example extracts only the example already inside the selected retained provider challenge. The original provider_bazaar_example basis remains attached to the resulting capture, snapshots and handover. An example is never relabeled as a later live response.

merchant_coingecko_probe starts the native unsigned GET observation job against saved request URLs. Choose vendor or merchant and the complete requestIds selection. The returned original job ID is the continuation identity. Inspect that same job and its captures; do not create another job to recover a lost write response.

## Inspect all rows and linked entities

merchant_coingecko_records supports requests, collections, files, captures, jobs, snapshots, comparisons, notes, providerPlans, exports and events. It returns the native items, total, offset and limit. Page until the returned items account for total.

merchant_coingecko_inspect reads one project-owned record. Request inspection includes its retained versions. Capture inspection returns the original request and complete source identities. Job inspection includes the original native review, retained attempt state and current action flags.

merchant_coingecko_rows pages capture, snapshot and comparison rows. kind selects the owner record type. Optional rowKind filters the native row category; it is independent from that owner type. Optional status applies the native comparison/status filter. Numeric strings remain exact native values.

merchant_coingecko_row reads one original capture row plus every linked provider entity retained with that capture. Use the returned relationships and source files for analysis. Complete source responses and reports remain downloadable even when their displayed rows require multiple pages.

## Build comparisons and retained research notes

Create a snapshot from selected response captureIds with merchant_coingecko_snapshot_create. Select at most one capture per request. Optional collectionId binds the snapshot to that original collection. Native summary counts include every selected capture, its original basis, missing fields and any unindexed source.

Create a comparison with two distinct saved snapshot IDs through merchant_coingecko_comparison_create. The original market comparison engine preserves exact decimal arithmetic and complete added, removed and changed rows. Download its full report with kind comparison; that document includes both snapshots and all retained source identities.

Save research notes with native fields:

~~~json
{
  "type": "research",
  "title": "Source review",
  "text": "The retained source and the selected comparison explain this finding.",
  "targetType": "snapshot",
  "targetId": "ORIGINAL_SNAPSHOT_ID",
  "sourceFileIds": ["ORIGINAL_FILE_ID"],
  "assignee": "Market operations",
  "status": "open"
}
~~~

The native model supports research, data_quality and follow_up types; open, reviewed and resolved statuses; and request, capture, row, snapshot and comparison targets. Notes retain original source files, reviewer, record versions and project events. Read the current note/version before updating it.

## Compile the provider's original deployment

merchant_coingecko_provider_plan_preview calls prepareCoinGeckoProduct from the original adapter. It returns the exact normalized plan and compiled endpoint routes, source configuration and payment alternatives. Save the plan through merchant_coingecko_provider_plan_save against the current project revision.

Use file_read with kind provider-plan for the complete native deployment document. The [original product guide](../../stellar/scf-starforge-20261009/partners/coingecko-stellar-market/README.md) describes the full plan and provider source contract.

Deploy with the existing provider command and the provider's own original callback or licensed upstream configuration:

~~~sh
starforge coingecko provider compile --plan PLAN.json --out NEW_DEPLOYMENT.json
starforge coingecko provider serve --plan PLAN.json --facilitator HTTPS_FACILITATOR_URL
~~~

The original seller and selected facilitator remain responsible for verification and settlement. A saved MCP provider plan is a deployment preparation, and its document retains the original instructions.

## Prepare, execute and recover original purchases

Inspect the current collection and exact retained merchant challenges first. merchant_coingecko_checkout_prepare takes the collection's version, current project revision, buyerProfileId when explicitly selected, and selections containing requestId, captureId and acceptIndex.

Each challenge must belong to that unchanged request version and exact merchant URL, including its query. The native SF31 exact-resource contract remains in force. Use the actual merchant's challenge for its selected request.

Preparation creates the original SF88 inbox review and returns its original job ID. Inspect the job until its native state is prepared and canExecute is true. Its items retain selected terms, expected resources, original review identities and configured budget/signing context.

Call merchant_coingecko_job_control with that same jobId, its current version, the current project revision, a stable opId, and the explicitly selected action:

| Action | Original native behavior |
| --- | --- |
| execute | Execute the saved prepared purchase review through the original native buyer. |
| cancel | Cancel the original queued/running work and retain completed results and attempts. |
| resume | Continue native remaining work when the original job reports canResume. |
| recover | Read the original attempt and retained response through the existing recovery path when canRecover is true. |

A lost execute reply is recovered by reading the same write operation and job. The original intent IDs, queue, SF31/SF36 budget and payment attempt are preserved. No MCP operation introduces a second signer, new payment engine or automatic replacement attempt.

The job remains inspectable after browser or MCP restart. A restored portable project's historical jobs remain archived under the native recovery contract. Reopening research does not execute those historical purchases.

## Deliver a whole project and reopen it

merchant_coingecko_handover_create retains the native compressed project archive. Supply the project revision, stable opId, name, and optional selected snapshotId/comparisonId. It includes the original project records, versions, complete source blobs, rows, event history, native operation evidence and runnable source closure. The returned export record contains its SHA256, byte count and file identity.

Read it with file_read, kind handover. The same reader supports:

| kind | Complete native payload |
| --- | --- |
| source | The exact immutable original source file bytes. |
| collection | Original collection package with all request definitions. |
| snapshot | Full snapshot document, retained sources and complete rows. |
| comparison | Full baseline/current comparison and all native rows. |
| provider-plan | Original compiled provider deployment document. |
| handover | Complete saved compressed project archive. |

A first read returns readId, file name/type/bytes/SHA256, offset, bytesRead, base64 data and nextOffset. The default chunk is 65,536 bytes; the maximum is 196,608. Concatenate decoded bytes in order until nextOffset is null and verify the complete returned SHA256 and byte length.

Subsequent chunks preserve workspace, projectId, kind, id, expectedSha256 and readId, using the previous nextOffset. Large payloads use the shared private descriptor-backed retained reader. The last chunk releases the read session. Release an abandoned partial read with merchant_coingecko_file_release.

After an expired read or process restart, reopen the same original workspace and repeat the same selection, expectedSha256 and byte offset while omitting readId. A changed original payload fails its hash check. Starting a file read never reruns a purchase or provider observation.

For in-host receiving, open the receiving workspace and call merchant_coingecko_restore with sourceWorkspace, the original exportId, exact expectedSha256, a stable opId and new project name. The original export bytes are read from the source model and restored through the native archive importer.

For a separately delivered archive, declare it as a host input of kind handover in the receiving alias. Inspect that original input, then restore using input and its exact expectedSha256. The full compressed archive stays outside the MCP request body.

The native restore returns the new project and original ID mappings. Inspect the received project, page its collections/rows, download selected original files and compare their hashes with the sending project. Retained purchase jobs are historical; the new research project can be edited using its own current revision.

## Runtime limits and troubleshooting

The existing authenticated HTTP transport accepts at most 128 KiB per request. Original source size limits are separate from that transport limit; full host input aliases and retained chunk downloads preserve large files. JSON tool definitions enforce original IDs, bounded pages, native version/revision fields and exact declared arguments before dispatch.

An original error code is returned without dumping private host configuration. Use the current project, original record or saved operation to resolve it:

| Code | Continue with |
| --- | --- |
| COINGECKO_WORKSPACE_NOT_OPEN | Open the configured original alias. |
| COINGECKO_INSTANCE_CONFLICT | Read the current instance before closing it. |
| COINGECKO_NODE_REQUIRED | Run the same installed command with Node.js 24 or later. |
| STALE_REVISION / STALE_VERSION | Read and combine the current original values before a new intended edit. |
| OPERATION_CONFLICT | Recover the original opId; use a different ID only for a deliberately different write. |
| COINGECKO_INPUT_HASH_CHANGED | Inspect the original input/export and its exact source selection. |
| CURRENT_MERCHANT_CHALLENGE_REQUIRED / NATIVE_EXACT_RESOURCE_REQUIRED | Inspect the saved request and its actual current merchant challenge. |
| JOB_ACTION_UNAVAILABLE | Inspect the original job's present native action flags. |
| ARCHIVE_PAYLOAD_UNAVAILABLE | Create a new complete handover from the retained project. |

Source documentation: [original CoinGecko product](../../stellar/scf-starforge-20261009/partners/coingecko-stellar-market/README.md), [merchant host](README.md), [shared retained file reader](retained-file-reads.mjs), and [native buyer queue](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue.mjs).
