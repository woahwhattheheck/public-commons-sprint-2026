# Repository agents and complete receiving

This integration lets a local agent use the existing DSpace dataset operator through the maintained merchant MCP host. The browser, managed Applications and agent share the same retained projects, revisions, source captures, editions and reviews. The operator owns the SQLite writer; the client borrows its authenticated HTTP interface.

The source parser, projection, review and dataset rules remain in the original `workspace.mjs` and `source.mjs`. The agent interface consumes those rules through the running operator. Every mutation has the original operation ID, actor and expected revision. Complete source files and project exports remain available through the same operator.

## Start and attach the existing operator

Use the maintained installed command with a private operator directory and the intended existing workspace:

```sh
npx --no-install starforge dspace-workspace \
  --directory /private/repository-operator \
  --workspace /private/repository-workspace \
  --port 0
```

The original operator writes its private `operator-launch.json` and returns the local browser address. Managed Applications can start and recover this same operator through its existing launch lifecycle. An agent connection does not start another workspace process.

Create an owned 0600 connection file in a private directory. The operator directory must already exist. Input files are optional and selected by host-declared aliases:

```json
{
  "schema": "stellar-forge.dspace-operator-connection.v1",
  "downloadByteBudget": 1073741824,
  "operators": {
    "repository": {
      "label": "Repository data",
      "launchFile": "/private/repository-operator/operator-launch.json",
      "inputs": {
        "catalog": {
          "kind": "source",
          "label": "Saved original repository capture",
          "file": "/private/intake/repository-source.json"
        },
        "project": {
          "kind": "workspace",
          "label": "Complete saved project",
          "file": "/private/intake/Repository_Workspace.sqlite3"
        }
      }
    }
  }
}
```

An input can include `sha256` to pin the host-selected bytes. An operator can include `operatorId` after its original persistent identity has been observed. Paths belong to this host configuration. Tool arguments use aliases, source IDs and hashes.

Initialize the original merchant host using its maintained entrypoint. These commands work from a checkout; in an installed package, prefix the same source paths with `node_modules/@tokenjunkielabs/starforge-merchant/source/`.

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-dspace-operators \
  --dir /private/repository-merchant \
  --connection /private/connections/repository.json \
  --name "Repository data"

node stellar-forge/mcp-merchant-operator/stdio.mjs \
  --config /private/repository-merchant/merchant-mcp.json
```

The first command creates the existing release store, private export directory and merchant configuration. To attach this provider while initializing an ordinary merchant, use the existing `init` command with `--dspace-operators /private/connections/repository.json`. The stored configuration key is `dspaceOperatorConnection`.

The stdio command runs the original MCP JSON-RPC transport. Complete normal MCP initialization, then call the tools below. Its existing HTTP transport is also supported by the merchant host.

## Bind a specific project

Start with `merchant_dspace_status {}`, then `merchant_dspace_bind {"operator":"repository"}`. Binding reads the private launch file and verifies the original process, source selection, source digests, local authenticated launch response and current project.

The returned scope contains four identities:

| Field | Meaning |
| --- | --- |
| `operatorId` | The persistent original operator registry. |
| `instanceId` | This running process instance. It changes on an explicit host restart. |
| `projectKey` | The explicitly selected project in that operator. |
| `workspaceId` | The original retained workspace inside that project. |

Pass all four unchanged in each scoped call. For example:

```json
{
  "operator": "repository",
  "scope": {
    "operatorId": "dspace-operator-<observed UUID>",
    "instanceId": "dspace-instance-<observed UUID>",
    "projectKey": "original",
    "workspaceId": "dspace-<observed UUID>"
  },
  "sourceId": "<observed source ID>",
  "offset": 0,
  "limit": 20
}
```

Those angle-bracket values are placeholders; use the actual binding and source ID returned by your operator.

The HTTP client sends the scope in `X-DSpace-Operator`, `X-DSpace-Instance`, `X-DSpace-Project` and `X-DSpace-Workspace`. The server checks them inside its serialized read or mutation boundary. A browser project switch therefore produces a `409 DSCOPE_*` result on an older scoped agent request.

Project selection is explicit: call `merchant_dspace_select_project` with the current binding and the chosen existing project key. Keep the new returned scope. The typed client's initial `scope` stays unchanged; callers pass the newly returned scope to subsequent methods.

After an intentional host restart, use `merchant_dspace_bind` with `reconnect:true`. Verify the same persistent operator and intended project. This replaces the borrowed connection and returns the new instance. Closing the merchant host drains its own calls and leaves the original operator running.

## Read original records and metadata

Use `merchant_dspace_items` to page original item choices. Each choice contains the source ID, repository UUID and exact original object SHA. The `selection` field can be `all` or `collection`; the latter uses the captured collection scope.

Inspect a choice with `merchant_dspace_item`. Without `field`, the response lists every metadata field and its value count. With a field, `offset` and `limit`, it returns the unmodified native value objects. Follow the returned page until `nextOffset` is null. An author value can contain language, authority, confidence, place and further original properties.

The original demonstration cohort contains 44 publications and a separately captured linked Person. Its first publication has 85 author values. The operator can page all 85 and retain their complete value objects. Generated `virtual::` values and their relationship metadata remain exact in the saved source and dataset lineage. A dataset projection selects source fields; it does not alter repository relationships.

State arrays, source request/file metadata, edition selections and operation input selections include explicit pagination. Full record JSON, original capture bytes, dataset CSV, configuration and complete project SQLite remain available through `merchant_dspace_download`.

## Create, review and select an edition

1. Read the current scoped state and its revision.
2. Page the intended original source choices.
3. Save a complete edition with `merchant_dspace_save_edition`: an operation ID, that revision, a named actor, name, mode, exact `selection`, `metadataFields` and explicit distribution `rights`.
4. Inspect its immutable edition SHA and projected records.
5. Save `merchant_dspace_review_edition` with that exact SHA, a named actor, the current revision, decision and substantive review comment.
6. Select the edition using `merchant_dspace_select_edition` with the matching latest approved review ID.
7. Query the original dataset with `merchant_dspace_query`, preserving `dataset.snapshot` and `page.nextCursor` across pages.

The two modes are `items` and `metadata-values`. Source arrays and properties remain available in the original retained source and lineage regardless of the chosen projection.

Distribution rights are recorded explicitly as `attribution`, `basis` and an optional `reference`. A public test repository capture can be used for an internal demonstration with that basis stated. A customer edition uses the customer's actual rights and intended distribution.

To correct an edition, save a successor with `previousEditionId`, the desired exact source choices and fields. Review the new SHA. `merchant_dspace_compare` records the original substantive and source-provenance comparison. The predecessor remains intact.

A publication record is attached only from an actual existing merchant receipt with the matching snapshot. `merchant_dspace_record_publication` records that supplied receipt in the original model. [MERCHANT.md](MERCHANT.md) covers publishing the approved dataset and complete customer delivery.

## Recover an interrupted operation

Save the exact mutation input before dispatch, including operation ID, actor, expected revision, source SHA, selection, edition SHA and original scope. The typed client returns the original operation ID and `uncertain:true` if a dispatched mutation loses its response.

Read `merchant_dspace_operation` in the same original project. A committed result contains the original request fingerprint, input and result. An identical retry uses the original operation ID and all original input values, including the original expected revision. The workspace recognizes that committed request before checking its newer current revision.

If the project changed, bind the observed current project, explicitly select the original project, then inspect the saved operation there. After a host restart, reconnect explicitly to the same persistent operator and obtain the new instance before selecting the original project. Keep the saved mutation payload unchanged. The new transport binding identifies the newly running instance; it does not redefine the original workspace operation.

A different payload under the same operation ID returns `DSPACE_REQUEST_CHANGED`. A new operation based on a stale revision returns `DSPACE_REVISION_CHANGED`. Preserve the first request and read the current retained state before constructing a separate intended change.

Complete workspace receiving has its own original operation ID in the operator registry. Use the same SHA and receiving ID after an interrupted response. Receiving returns the selected project's new scope, which must be used for further calls.

## Receive a complete export

Call `merchant_dspace_download` with the current scope and an original export kind. The returned immutable manifest contains its download ID, original operator/project/workspace, filename, type, byte count and SHA256. The host streams and verifies the entire HTTP export into private retained storage before returning that manifest.

Kinds are `project`, `source`, `dataset`, `config`, `comparison`, or one of the original plural record kinds. A `project` is the complete SQLite workspace. A `source` is the exact original imported capture.

Use the existing host CLI to inspect and receive it:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs inspect-dspace \
  --config /private/repository-merchant/merchant-mcp.json \
  --operator repository --download-id <original-download-id>

node stellar-forge/mcp-merchant-operator/serve.mjs download-dspace \
  --config /private/repository-merchant/merchant-mcp.json \
  --operator repository --download-id <original-download-id> \
  --sha256 <original-file-sha256> \
  --out /private/customer/Repository_Workspace.sqlite3
```

The output parent directory must be owned and private. The receiver persists the original manifest identity and partial byte count. Repeating the same command continues that same retained file after an interrupted read or merchant process restart. Completion verifies the entire SHA and publishes the destination atomically. An existing exact destination is read back; a different file at that path is preserved and reported.

For a direct MCP consumer, use `merchant_dspace_file` with the manifest SHA, then follow its `readId` and `nextOffset`. The response retains the complete-file identity and exact chunk bytes. A chunk can be up to 196,608 bytes. Release an unfinished read with `merchant_dspace_file_release`; the original complete retained export remains.

To reopen a received project, use the maintained dataset receiver and then the operator:

```sh
npx --no-install starforge dspace receive \
  --file /private/customer/Repository_Workspace.sqlite3 \
  --workspace /private/customer/repository-workspace

npx --no-install starforge dspace-workspace \
  --directory /private/customer/repository-operator \
  --workspace /private/customer/repository-workspace --port 0
```

The receiver preserves original workspace IDs, source captures, complete metadata, editions, reviews, dataset snapshots and committed operations. It checks the original records, file hashes and projections during receiving.

## Typed host client

The implementation is `client.mjs`, with its NodeNext declaration sibling `client.d.mts`. The client uses the shared `launch.mjs` reader.

```js
import {connectDspaceOperator} from './client.mjs';

const client = await connectDspaceOperator({
  directory: '/private/repository-operator'
});
try {
  const scope = client.scope;
  const state = await client.state({scope});
  const source = state.sources[0];
  const page = await client.items({
    scope, sourceId: source.id, offset: 0, limit: 20
  });
  const choice = page.items[0];
  const item = await client.item({
    scope, sourceId: source.id,
    uuid: choice.uuid, objectSha256: choice.objectSha256
  });
  process.stdout.write(JSON.stringify({
    workspaceId: state.id,
    uuid: item.uuid,
    metadata: item.object.metadata
  }) + '\n');
} finally {
  await client.close();
}
```

The client also exposes `record`, `operation`, `dispatch`, `importSource`, `query`, `selectProject`, `receiveWorkspace` and streamed `download`. Host input inspection hashes a canonical regular file and verifies that it did not change during reading. A complete receiving upload is pinned to an immutable private temporary snapshot before dispatch.

The original receiver accepts complete source/project inputs up to 256 MiB. The default retained export budget is 1 GiB and can be set by the host connection. JSON response handling counts actual received bytes; complete file receiving uses streamed exports.

## Tool reference

| Tool | Purpose |
| --- | --- |
| `merchant_dspace_status` | List configured operators or page a scoped project state. |
| `merchant_dspace_bind` | Verify and borrow the original running operator. |
| `merchant_dspace_select_project` | Explicitly select an existing project and return its new scope. |
| `merchant_dspace_record` | Inspect a retained source, edition, review, comparison or publication. |
| `merchant_dspace_items` | Page exact original source choices. |
| `merchant_dspace_item` | Inspect full native item properties and page exact metadata arrays. |
| `merchant_dspace_operation` | Read the original committed request, fingerprint and result. |
| `merchant_dspace_inputs` | Inspect host-declared source/project aliases and exact hashes. |
| `merchant_dspace_import` | Import one complete SHA-pinned source through the original action. |
| `merchant_dspace_save_edition` | Save an immutable projection of exact original choices. |
| `merchant_dspace_review_edition` | Record a named review of the exact edition SHA. |
| `merchant_dspace_select_edition` | Select an edition with its latest approved review. |
| `merchant_dspace_compare` | Retain the native comparison of two immutable editions. |
| `merchant_dspace_query` | Run the original dataset query and cursor. |
| `merchant_dspace_record_publication` | Attach an actual matching merchant publication receipt. |
| `merchant_dspace_receive` | Receive a complete project under its original operation ID. |
| `merchant_dspace_download` | Retain a complete original export and immutable manifest. |
| `merchant_dspace_download_read` | Reopen the saved manifest without a live operator. |
| `merchant_dspace_file` | Stream SHA-pinned chunks of the complete retained file. |
| `merchant_dspace_file_release` | Release an unfinished read while retaining the file. |

## Native receiving operation

`native/agent-consumer.mjs` uses the real retained project, original HTTP operator, shared launch reader, typed client and original merchant stdio transport. It records its stable operation inputs before mutation and retains each phase result in the selected private directory.

Run it from this module:

```sh
node native/agent-consumer.mjs \
  --directory /private/receiving/dspace-agent \
  --project-file /absolute/path/to/Repository_Workspace.sqlite3
```

The receiving operation covers the original 45-record demonstration cohort, exact 85-author metadata, committed response loss and same-ID recovery, edition review and correction, native query pages, a retained file read interrupted across merchant restart, project-switch scope protection, original operator restart and a complete independent project receiving. The resulting `RESULT.json` records actual completed phases and source/file identities. An interrupted run continues the same directory and operation inputs.
