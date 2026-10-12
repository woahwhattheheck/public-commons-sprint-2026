# STAC applications

Open a saved satellite imagery workspace through the existing Applications manager. The original STAC, eoAPI or Prescient host continues to own its source requests, scene editions, selected files, processing work, customer operations and exports. Applications retains the selected runtime, private workspace, configuration, running operation and connection across browser restarts.

## Choose the original workspace

| Application | Kind in a saved request | Original command | Workspace and configuration |
| --- | --- | --- | --- |
| Satellite imagery and processing | `stac-imagery` | `stac serve` | An initialized imagery directory; optionally its existing processing workspace, processing configuration and source transport |
| Imagery customer operations | `stac-eoapi` | `stac eoapi-serve` | The original eoAPI imagery directory; optionally the original private source configuration, policy workspace, separate customer output directory and processing workspace |
| Prescient imagery operations | `stac-prescient` | `stac prescient-serve` | The original operator directory containing `operator/` and `stac/`, its private deployment JSON and selected profile |

Use a completed READY runtime containing the selected original host. The retained imagery and processing receiving workflow runs with the original Node command; select optional SDK dependency features when the chosen original customer workflow requires them. The manager checks the actual source files for that mode. It reads the initialized workspace and selected configuration during review. It opens the original host when the saved start is dispatched.

The imagery directory and optional processing directory must be private directories owned by the current host user. On Linux, use mode 0700; keep private configuration and connection files at mode 0600. Select their real absolute paths. Keep the original directory layout when receiving existing work.

For Prescient, leaving the profile field empty selects the current profile during review. Save retains that profile's exact SHA256 as an explicit setting. A later default or approved-profile change therefore leaves the saved application's selected profile intact. The original Prescient configuration, approval and credential binding continue to govern the work.

## Review, save and open

1. Open the runtime workspace and select the completed runtime.
2. Open **Applications**, choose the matching imagery application, enter a useful label and select the initialized private workspace.
3. Add the original source or processing configuration that belongs to that workspace. For Prescient, select the deployment JSON and review the selected profile.
4. Choose **Review**, inspect the selected workspace and files, then **Save**. The manager connects the saved application to the original managed release.
5. Review the start and choose **Start**. The original command starts under the existing managed worker.
6. Choose **Open** when the running host is ready.

For eoAPI, Review resolves the original policy directory and separate customer output directory. Save keeps those exact paths, including when the original defaults were selected. Existing directories retain their filesystem identity; a new output directory uses its existing private parent until the original export creates it.

Startup binds the selected workspace ID, endpoint and directory identity to the actual host. It uses the host's original session bootstrap and reads its state before publishing Open. The optional processing, eoAPI and Prescient capabilities are checked against the selected mode.

A local port of 0 lets the host choose a free port. The saved application retains the current private address. Closing the runtime browser or its browser server leaves the original managed command available to reopen.

## Work in the original operator

The opened imagery operator contains the existing source, edition, comparison, asset and decision workflows. Use its original controls to review a query, acquire or continue source pages, select a file and retain the complete response. The optional processing view uses the existing Cirrus or FilmDrop workspace and its saved deployments, native workflow records, run pages, statistics and associations.

The eoAPI entry opens its original source authorization, deployment policy, merchant commissioning and customer receiving controls. The Prescient entry opens its original selected profile and SDK-backed source and file workflows. Their host-specific configuration remains in the original operator.

Use the original **Export** and receiving controls for the complete selected work. An imagery handover preserves native editions, retained source material, decisions and selected asset bytes. A processing handover also carries its selected processing editions and source captures, with the imagery selected by the original export. The receiving operator opens those complete files through the original import or portable receiving command.

See the [imagery guide](../../sf30-seller-sdk/stac/README.md), [processing guide](../../sf30-seller-sdk/stac/processing/PROCESSING.md), [eoAPI guide](../../sf30-seller-sdk/stac/eoapi/ONBOARDING.md) and [Prescient guide](../../sf30-seller-sdk/stac/prescient/OPERATOR.md) for their native workflows.

## Keep the same agent connection

Each saved application maintains a private connection record at:

```text
<RUNTIME_WORKSPACE>/applications/<APPLICATION_ID>/stac-connection.json
```

The record contains the verified original URL and workspace ID. Its path stays the same when this saved application stops and starts. A successful new startup atomically updates the record with the new original session.

The current application output also returns this path as `current.url.connectionFile`. Use it with the original STAC client:

```sh
starforge stac-workspace connection-init \
  --out /private/stac-client.json \
  --console-url-file /private/runtime-operator/applications/APPLICATION_ID/stac-connection.json \
  --workspace imagery

starforge stac-workspace status --connection /private/stac-client.json
```

The client reads the saved record again before connecting. After a host restart it establishes the new original session and verifies the same workspace ID. It uses the same imagery and processing state as the browser. Configure native input aliases and processing profiles through the [existing client and MCP guide](../../../../stellar-forge/mcp-merchant-operator/STAC.md).

Keep the connection record on this host. The local session grants access to its running operator.

## Stop, continue and reopen

Choose **Stop** for the saved running operation. The original server stops accepting new mutations, closes its HTTP listener and drains its tracked jobs. The original CLI then closes its workspace and optional processing or customer runtime. Wait for the operation's final stopped state before starting the saved application again.

A later **Start** uses a new operation ID and session while reopening the same retained workspace. Scene editions, selected files, decisions and processing records remain in the original directories. The agent connection file updates only after the new original host is verified.

If an application worker is interrupted, use **Recover** on its retained operation. The manager reconciles that operation and its process before continuing it. The operator's own source, acquisition and export histories remain the place to inspect an interrupted domain operation.

When a selected configuration or source file changes between review and start, review the current inputs again. A changed workspace identity requires reviewing and saving the application's new selection. The same original imagery workspace is reserved across all three managed modes while it has a retained running or interrupted operation.

## CLI workflow

The existing runtime-workspace CLI exposes the same actions as the browser:

```sh
starforge runtime-workspace init --workspace /private/runtime-operator
starforge runtime-workspace attach --workspace /private/runtime-operator \
  --runtime /private/completed-runtime --label "Imagery runtime"
```

Use the returned runtime ID in a private review request:

```json
{
  "runtimeId": "RETURNED_RUNTIME_ID",
  "kind": "stac-imagery",
  "label": "Satellite imagery and processing",
  "settings": {
    "workspaceDirectory": "/private/imagery",
    "processingWorkspaceDirectory": "/private/processing",
    "port": 0
  }
}
```

Omit optional processing fields for imagery alone. The other supported settings are `processingConfigurationFile`, `transportFile`, `sourceConfigurationFile`, `policyWorkspaceDirectory` and `outputDirectory` for eoAPI, `deploymentFile` and `profileSha256` for Prescient, and `environmentFile` for the original managed worker's private environment JSON.

```sh
starforge runtime-workspace application-review --workspace /private/runtime-operator \
  --request /private/imagery-review.json
```

Save a request containing a fresh UUID as `requestId` and the returned review `id` as `reviewId`, then call `application-save`. The returned `applicationId` identifies the saved application. The same save request may be retried to recover its original result.

```sh
starforge runtime-workspace application-save --workspace /private/runtime-operator \
  --request /private/imagery-save.json
starforge runtime-workspace application-connect --workspace /private/runtime-operator \
  --application-id APPLICATION_ID
starforge runtime-workspace application-start-review --workspace /private/runtime-operator \
  --application-id APPLICATION_ID
```

Start with a private JSON request containing `applicationId`, the returned start-review `id` as `reviewId`, and a fresh UUID as `requestId`.

```sh
starforge runtime-workspace application-start --workspace /private/runtime-operator \
  --request /private/imagery-start.json
starforge runtime-workspace applications --workspace /private/runtime-operator \
  --history-limit 2
starforge runtime-workspace application-output --workspace /private/runtime-operator \
  --application-id APPLICATION_ID --operation-id ORIGINAL_OPERATION_UUID
starforge runtime-workspace application-stop --workspace /private/runtime-operator \
  --application-id APPLICATION_ID --operation-id ORIGINAL_OPERATION_UUID
```

Use `application-recover` with the original application and operation IDs for an interrupted operation. Use a new start request after a completed Stop.

The source CLI is also available at `<RUNTIME>/package/source/stellar/scf-starforge-20261009/distribution/runtime-workspace/cli.mjs` and can be invoked with Node when operating from the original installed source.

## Complete receiving

The managed receiving driver operates a private receiving copy of existing completed imagery and processing work. It uses the original manager to attach the READY runtime, review and save the application, connect its release, start and open the actual host, receive its full exports, Stop and reopen the same saved work, and open the exported work independently.

It retains the original application, review, operation and export identifiers in its private receiving journal. A repeated invocation reconciles that same journal. The completed result records the received original edition and asset identities and the actual lifecycle outcomes.

Run the maintained driver from the selected installed source:

```sh
node <RUNTIME>/package/source/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/examples/managed-applications-receiving.mjs \
  --input /private/stac-managed-receiving.json
```

The input is a private JSON file:

```json
{
  "schema": "stellar-forge.stac-managed-applications-input.v1",
  "runtimeDirectory": "/private/completed-runtime",
  "sourceWorkspace": "/private/completed-imagery",
  "sourceProcessingWorkspace": "/private/completed-processing",
  "directory": "/private/stac-managed-receiving",
  "label": "Received imagery and processing",
  "timeoutMs": 180000,
  "pollMs": 500
}
```

Omit `sourceProcessingWorkspace` for imagery alone. Use a separate receiving directory; the driver copies the original completed work and preserves those input directories. The optional timeout and polling interval control how long the caller waits for each original lifecycle transition. Rerun the same input to reconcile the saved receiving operation after interruption.

The module also exports `runManagedStacReceiving` with those input fields and an optional `onStage` callback. Its live journey reads the stable private connection file, opens the original host through that connection, and verifies that Stop followed by a new Start retains the connection path and workspace ID while creating a new original session. Complete imagery and processing exports are imported and reopened through the original receiving modules.
