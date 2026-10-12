# FilmDrop processing operations in the STAC workspace

This extension attaches a configured FilmDrop deployment and its retained processing history to the original STAC analyst workspace. Staff can inspect the native workflow inventory, review a selection, capture each workflow's complete run-page chain, read its available events and payloads, review scene/asset associations, and receive the full operating history in another copy of the same product.

The original STAC provider, merchant, customer, dataset/object delivery, and offline GIS receiving engines remain the integration points. The processing controller opens no listener. Its view mounts inside the existing authenticated analyst server.

## Source and native behavior

The initial implementation follows [Element84/filmdrop-api at9dd3db2](https://github.com/Element84/filmdrop-api/tree/9dd3db2bb4f3151bcf85dda9b4b46e62e40001c5). The exact selected deployment's OpenAPI JSON is retained before a capture is prepared; every source edition has its own source hash, deployment fingerprint and request bindings.

The maintained source establishes several details that matter to a complete history:

- [The runs route](https://github.com/Element84/filmdrop-api/blob/9dd3db2bb4f3151bcf85dda9b4b46e62e40001c5/src/filmdrop/api/routers/workflows/runs.py) supports the plural `workflow_ids` filter. Its multiple-workflow branch truncates combined results at the requested limit without a continuation. This client creates one chain for each selected native workflow and follows that chain's actual `rel=next` links. It does not combine several workflows into that truncated branch.
- Native run identity retains `source_id`, `workflow_definition_id`, `run_id` and `payload_id`. The saved `workflow_id`, state, timestamps, executions and last error remain native fields.
- The [workflow models](https://github.com/Element84/filmdrop-api/blob/9dd3db2bb4f3151bcf85dda9b4b46e62e40001c5/src/filmdrop/api/models/workflows.py) expose conditional event and input/output-payload links. A missing link stays missing. The current event route reads the latest execution; each retained detail records that endpoint scope and the corresponding native execution identifiers.
- `since` is the native duration, evaluated by FilmDrop at request time. The saved selection and every page preserve the same duration; captured timestamps make the actual request times visible.
- Native list records keep their typed arrays, `record_count` and links. A provider-negative response, malformed response, changed page selection, repeated nonempty cursor or changed origin remains a visible task outcome.
- The [logs route](https://github.com/Element84/filmdrop-api/blob/9dd3db2bb4f3151bcf85dda9b4b46e62e40001c5/src/filmdrop/api/routers/workflows/logs.py) may return an unchanged continuation at an empty tail. That exact outcome is retained as `unchanged-empty-native-log-cursor`; it is distinct from an ordinary page without a next link.

The selected base URL supplies the actual deployment prefix. The client does not assume that a README prefix is installed on another deployment.

## Open the existing application

Use the original STAC CLI/server integration:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs serve \
  --workspace /private/stac-scenes \
  --processing-workspace /private/filmdrop-history \
  --processing-config /private/filmdrop-connection.json
```

The main server owns its existing session, Host, Origin and CSRF checks. It supplies the processing controller with the already opened STAC workspace. The component receives that original scene selection, and remains mounted while the host polls its jobs.

A configuration file selects an existing deployment and exact OpenAPI bytes:

```json
{
  "deployment": {
    "id": "customer-processing",
    "title": "Customer processing",
    "baseUrl": "https://your-existing-processing-deployment.example",
    "pageSize": 100,
    "credential": {
      "envRef": "EXISTING_FILMDROP_TOKEN",
      "header": "Authorization",
      "prefix": "Bearer "
    }
  },
  "source": {
    "path": "/private/source/deployed-openapi.json",
    "metadata": {
      "url": "https://your-existing-processing-deployment.example/openapi.json",
      "status": 200,
      "capturedAt": "2026-10-12T00:00:00Z"
    }
  }
}
```

The URLs and timestamp above are configuration placeholders. Use the existing operator's actual deployment and capture metadata. Omit `credential` for a public deployment. Set an unknown source status/time to `null`; do not assign an HTTP200 or a capture time to an undocumented file.

Only the environment-reference name, header name and prefix are stored. The provider resolves the credential value in the requesting process and applies it to that exact selected origin and prefix. It follows no credential-bearing redirect. API reads use the original SF31 transport, including an explicitly supplied original proxy-aware transport when the equipped environment needs one.

A controller may also be constructed directly:

```js
import { openStacWorkspace } from './stac/workspace.mjs';
import { createProcessingController } from './stac/processing/workspace.mjs';

const scenes = await openStacWorkspace({ directory: '/private/stac-scenes', create: false });
const processing = await createProcessingController({
  stacWorkspace: scenes,
  directory: '/private/filmdrop-history',
  config
});
// Pass processing to the original STAC server's supported processing seam.
// Close the server before awaiting processing.close() and scenes.close().
```

## Operator workflow

### Configure and inspect

Save the selected deployment with the original OpenAPI file. The browser reads the file as bytes, preserving its UTF-8 content and BOM. The server validates the documented GET routes and required workflow filter and retains the unchanged source under its SHA-256 name.

Choose that saved deployment and **Read workflow inventory**. Instances, sources and definitions use separate typed page chains where those routes are present. **Open saved workflow inventory** reads those retained pages locally. A review requires a completed instance chain and native workflow IDs from that chain.

For a source already captured by another equipped operator, choose **Prepare for an externally captured inventory**, then import its original response body and actual metadata into the displayed pending task. This advances the same chain without making another provider request.

### Review and capture

Select the actual workflows, native duration, available detail categories and whether to follow native log links. Enter the reviewer and bind the review to the currently selected completed scene edition where an association is wanted.

**Save reviewed workflow selection** creates an immutable review fingerprint. **Capture the reviewed run history** uses that saved review and records its own stable operation identity. Every configured workflow traverses its complete declared page chain. Definitions, events, input/output payloads and recognized native log links are added as explicit tasks; external console links remain data and are not followed.

The selected deployment/source fingerprint, request URLs, query values and response bytes remain available in each history edition. A new configuration creates another source edition rather than silently changing an earlier capture.

### Resume the original work

**Resume remaining pages** keeps every completed page and its original body hash. It first reconciles a retained complete response with pending metadata before sending another GET. A crash between response retention and state publication therefore does not require another provider read.

A transport attempt without a complete body remains in history; the next actual GET receives another attempt record for the same pending request. Provider status, parsed-body failures, retry timing and interruption are not converted into empty success.

HTTP401,429 and503 retain a paused outcome. The original `Retry-After` is honored on resume. An operator can restore the same configured environment reference and resume. Other failed tasks remain in the edition and can be explicitly included with **Also retry definitively failed tasks**.

Cancellation records the original intent, aborts this process's owned request and leaves retained pages readable. Closing the controller aborts and awaits its owned reads. A process lease prevents overlapping dispatch; original process identity, boot and procfs-view checks govern interruption recovery.

### Read details and review associations

The saved run view keeps every native observation and detail capture. Its table pages only the rendered rows; the retained capture and complete JSON download contain all records. The details display identifies native HTTP status, body hash and execution scope.

**Compare native payloads with the bound scene edition** uses:

1. Exact native collection and item ID from an actual input/output Feature.
2. Exact native asset href, with asset-key and href agreement retained where present.
3. An explicit operator-selected association, with a reason when no exact native payload match supports it.

Collection-scoped scene keys use the original STAC encoding. Unmatched entries and multiple native candidates remain visible. Accepted records retain the reviewer, explanation, original payload pointer/hash, item hash, asset identity and bound scene-edition fingerprint. Later decisions append history. They do not rewrite earlier association evidence.

A received workspace can verify the same immutable native scene edition even though its local receiving-workspace ID differs. The source workspace ID remains provenance; original edition bytes, endpoint and collection/item identities determine whether the binding is unchanged.

### Export and receive

**Export the selected processing edition** includes its inventory dependency, source configurations, reviews, raw request/response/negative-attempt files, complete run/detail history and association decisions. If a scene edition is bound, the original STAC engine exports that same edition into the handover. Already captured original asset bytes are an explicit option.

The complete directory is the primary portable form. Every member has its original length and SHA-256. The manifest is published last. An interrupted copy resumes only when the original selection and already written bytes still agree. A source advance produces a visible conflict instead of mixing editions.

**Download complete portable handover** offers a gzip package when the whole directory fits the configured browser transfer limit. A larger export remains complete in its directory; no file is dropped to fit a download.

**Receive this handover into the current workspaces** validates every member before applying the original STAC import and merging the processing records. Importing the same digest retrieves its original receipt. Source and capture identities are reopened after import. It does not fetch provider data or start a processing workflow.

## SDK and host adapter

`openProcessingWorkspace({directory,stacWorkspace,transport,create,environment})` returns the following methods:

| Method | Purpose |
|---|---|
| `getState()` | Read the current durable state |
| `configure({deployment,source:{body,metadata},expectedRevision})` | Retain a deployed source edition |
| `sourceFor(deploymentKey)` | Verify the retained source and original provider binding |
| `prepareInventory({deploymentKey,operationId,kinds})` / `discover(...)` | Prepare or execute complete inventory chains |
| `inventory(editionId)` | Read typed native inventory records with capture provenance |
| `reviewCapture({inventoryId,workflowIds,since,stacEditionId,details,logs,actor,note,operationId})` | Retain the exact selected run request |
| `prepareCapture({reviewId,operationId})` / `capture(...)` | Prepare or execute the reviewed per-workflow chains |
| `getEdition(id)`, `runs(id)`, `getRun({editionId,runKey})` | Read saved history and native details |
| `resume({editionId,retryFailed})`, `cancel({editionId})` | Continue or cancel that original capture |
| `importPage({editionId,taskId,body,metadata})` | Consume an actual externally captured response |
| `associations({editionId})` / `recordAssociation(...)` | Read proposals and retain the operator's decision |
| `exportHandover({editionIds,directory,operationId,includeStacAssets})` | Export complete original processing/STAC history |
| `importHandover({directory,operationId})` | Validate and receive that complete history |
| `readCapture(relativeDirectory)` | Read verified original request, metadata and body |
| `close()` | Abort and await this controller's owned work |

The host factory is `createProcessingController({stacWorkspace,directory,config})`. It exports:

- `getState()`: public saved source, capture, review, import, export and operation summaries.
- `reads`: explicit `inventory`, `edition`, `runs`, `run`, `associations` and `handover` handlers, each accepting `{query,stacWorkspace}`.
- `actions`: explicit `configure`, `discover`, `prepare-inventory`, `review`, `capture`, `prepare-capture`, `resume`, `cancel`, `import-page`, `associate`, `export-handover` and `import-handover` handlers, each accepting `{input,operationId,stacWorkspace}`.
- `close()`: the requesting controller's normal lifecycle closure.

The browser export is `mountProcessingView({root,context,api})`, returning `{update(context),dispose()}`. The host supplies `api.getState()`, `api.read(name,query)` and `api.run(name,input)`. It keeps the component mounted through job polling so staff inputs survive state refreshes.

Native SDK users can open the complete directory with `readProcessingHandover({directory})`. `packProcessingHandover` and `unpackProcessingHandover` preserve the same manifest and members for a compact transfer; both enforce declared expansion limits and verify original byte hashes.

## Retained records

The processing workspace has versioned state, SHA-named source descriptions and per-attempt capture directories. Each actual request is recorded before dispatch. Available response headers, native status and capture time are written before the complete body; the body's byte count and SHA bind its final receipt. Credential-bearing response headers are omitted with their names retained in `redactedHeaders`; original response bodies remain complete.

The companion handover/receiving directories are selected by the controller configuration and default to sibling paths. They contain source/history data and should be handled with the original operator's normal private workspace custody. Repository source contains no deployment credential, customer payload or acquired imagery.
