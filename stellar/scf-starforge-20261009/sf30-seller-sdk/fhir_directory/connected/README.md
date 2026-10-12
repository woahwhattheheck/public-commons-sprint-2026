# Human Services Directory connected operator

Operate the selected native directory workspace through the maintained Merchant SDK, MCP host or command line. The directory provider includes original Gravity referral and eLTSS operations, then adds original directory acquisition, complete indexing, mapping review, service selection, explicit referral joins and editable handoffs.

The package export is `@tokenjunkielabs/starforge-merchant/merchant/human-services-directory`. Its TypeScript declarations and callable catalogue follow the installed `directory-schema.json` and `directory-source-schema.json`. The normal host discovers `human-services-directory-workspaces` from the distribution contribution.

## Select the original workspace and files

Create the directory with `human-services-directory init --workspace ABS`, receive an existing complete directory archive, or use the workspace already opened in Applications. Store the connection JSON in a private directory with owner-only file permissions. Paths may be absolute or relative to this connection file.

```json
{
  "schema": "stellar-forge.human-services-directory-merchant-connection.v1",
  "workspaces": {
    "provider": {
      "directory": "/absolute/private/directory-workspace",
      "label": "Provider service directory",
      "allowStart": false,
      "inputs": {
        "directory-snapshot": {
          "file": "/absolute/original/provider-directory.zip",
          "label": "Original directory archive"
        }
      },
      "credentialsFile": "/absolute/private/authentication-profiles.json"
    }
  }
}
```

`allowStart: false` selects an operator already running in Applications or through `serve`. A persistent SDK or MCP owner can set `allowStart: true` and call `operator_open`; the original connection lifecycle then owns that native process. Closing a borrowed connection leaves its application running. The optional `credentialsFile` references existing named authentication profiles. Omit it for an unauthenticated source.

Each declared input is a complete original host file. Add its `sha256` when a previously reviewed identity is available. Configuration loading records its exact byte identity and rejects a changed declared digest. The selected workspace UUID is read from its native private marker; it is never supplied as an arbitrary alias.

## Local SDK operation

```js
import {
  openHumanServicesDirectoryLocalClient,
  importHumanServicesDirectorySource,
  readHumanServicesDirectoryValue,
  downloadHumanServicesDirectoryExport
} from '@tokenjunkielabs/starforge-merchant/merchant/human-services-directory';

const client = await openHumanServicesDirectoryLocalClient({
  connection: '/absolute/private/directory-connection.json',
  exportsDirectory: '/absolute/private/retained-exports'
});
try {
  const imported = await importHumanServicesDirectorySource({
    client, workspace: 'provider', input: 'directory-snapshot',
    profile: {
      label: 'Original provider directory', format: 'hsds-csv-zip',
      origin: 'operator_source', scope: 'snapshot',
      filename: 'provider-directory.zip'
    }
  });
  const sourceId = imported.source.id;
  let offset = 0;
  do {
    const result = await client.call('directory_source_rows', {
      workspace: 'provider', sourceId, offset, limit: 250
    });
    const page = await readHumanServicesDirectoryValue({
      client, workspace: 'provider', result
    });
    // Process every row in page.rows, preserving sourceId and recordId.
    offset = page.nextOffset;
  } while (offset !== null);

  const packet = await client.call('directory_workspace_packet', {workspace: 'provider'});
  await downloadHumanServicesDirectoryExport({
    client, workspace: 'provider', exportId: packet.exportId,
    directory: '/absolute/private/received-directory'
  });
} finally {
  await client.close();
}
```

The import helper first saves the complete native import profile, then streams the original input to that profile's content endpoint. It returns `importProfileId`, the complete profile and source operation descriptors, and the original source record. If the upload reply is interrupted, retain the saved profile ID from the error and resume against that same profile. Source records keep the original filename separately from the content identity.

Every action also has its camel-case convenience method, such as `directorySourceRows(args)`. `client.call` accepts the catalogue action or its full `merchant_human_services_directory_` tool name.

## Merchant MCP and CLI

Initialize the maintained Merchant host configuration from the original connection:

```sh
starforge merchant-human-services-directory init \
  --directory /absolute/private/directory-merchant \
  --connection /absolute/private/directory-connection.json \
  --name 'Human Services Directory operator'

starforge merchant-human-services-directory tools

starforge merchant-human-services-directory call \
  --connection /absolute/private/directory-connection.json \
  --exports /absolute/private/retained-exports \
  --action directory_source_rows --args /absolute/private/source-page.json
```

The generated `merchant-mcp.json` selects `humanServicesDirectoryConnection`, the existing native release store, and the retained customer export directory. Start it using the repository's normal Merchant host. A remote SDK client uses `openHumanServicesDirectoryMerchantClient({url, tokenEnv, environment})`. The CLI accepts `--url MCP_URL --token-env ENV_NAME` in place of local connection and exports options. Keep the access token in the named environment variable.

`call` reads its complete argument object from the selected JSON file. For the example above:

```json
{
  "workspace": "provider",
  "sourceId": "REPLACE_WITH_ORIGINAL_SOURCE_SHA256",
  "offset": 0,
  "limit": 250
}
```

Use `value` for the retained original response, `inspect` for its complete manifest, `download` for every original file, and `reopen` for the already received directory:

```sh
starforge merchant-human-services-directory download \
  --connection /absolute/private/directory-connection.json \
  --exports /absolute/private/retained-exports \
  --workspace provider --export-id ORIGINAL_EXPORT_SHA256 \
  --directory /absolute/private/received-directory

starforge merchant-human-services-directory reopen \
  --workspace provider --export-id ORIGINAL_EXPORT_SHA256 \
  --directory /absolute/private/received-directory
```

The complete manifest is `human-services-directory-manifest.json`. Downloads retain the original file lengths and SHA-256 values, use resumable file reads, and verify existing bytes before continuing. Reopening a completed download is independent of the transient MCP port.

## Directory actions

| Work | Catalogue actions | Result |
| --- | --- | --- |
| Inspect the selected workspace | `directory_state`, `directory_catalogue`, `directory_guidance` | Original full-family state, native schemas and source guidance |
| Read complete saved records | `directory_records`, `directory_record` | Paginated collection and exact immutable record |
| Save and inspect a provider | `directory_connection_save`, `directory_discover`, `directory_request_save` | Selected connection, captured discovery and explicit request |
| Run the original acquisition | `directory_acquire`, `directory_operation`, `directory_advance`, `directory_pause`, `directory_resume`, `directory_capture_source` | Same retained operation ID, received pages and complete capture |
| Import original bytes | `directory_import_profile_save`, `directory_source_import` | Saved full profile and streamed original source |
| Browse original source records | `directory_source_rows`, `directory_source_row`, `directory_source_members`, `directory_source_file`, `directory_source_record_file` | Full rows, original member inventory and exact files |
| Review an edition | `directory_edition_save`, `directory_edition_rows`, `directory_edition_row`, `directory_edition_links`, `directory_link_targets` | All selected records and original relationship candidates |
| Compare editions | `directory_compare`, `directory_comparison_changes`, `directory_comparison_changes_file` | Complete original change decisions and JSONL |
| Receive the whole index | `directory_index_file` | Complete source, edition or comparison SQLite file |
| Review and apply mapping | `directory_mapping_save`, `directory_mapping_preview`, `directory_mapping_preview_details`, `directory_mapping_apply` | Explicit source rules, complete preview resources/fields/findings and saved conversion |
| Choose a service | `directory_selection_save`, `directory_selection_candidates` | Retained criteria, schedule decisions, candidates and operator dispositions |
| Bind a clinical referral | `directory_referral_join` | Explicit original Task/ServiceRequest bindings and a successor edition |
| Prepare and receive a handoff | `directory_handoff_prepare`, `directory_handoff_file`, `directory_handoff_import`, `directory_receiving_save` | Complete editable handoff and receiving review |
| Prepare other complete output | `directory_export_prepare`, `directory_export_file`, `directory_guidance_file`, `directory_capture_file` | Original complete files |
| Transfer the workspace | `directory_workspace_packet`, `directory_workspace_import` | Complete directory, Gravity and inherited source workspace |

Native body actions take the named object declared by the catalogue: for example `directory_mapping_save` takes `mapping`, `directory_mapping_preview` takes `mapping_preview`, and `directory_edition_save` takes `edition`. Use those installed schemas rather than rebuilding a shortened request. `input_apply` also accepts the declared directory native body actions and the existing original Gravity/eLTSS actions.

## Complete pages and large files

Native collection, source-row, edition-row, relationship-target, comparison, mapping-preview and selection-candidate pages carry `rows`, `total`, `offset`, `limit`, `nextOffset`, `bytes` and `byteBudget`. Continue with the returned `nextOffset` until it is null. Preserve all selected query parameters while following pages. The directory state also carries per-collection `total`, `returned` and `nextOffset`; it is a current view of those collections. Use the collection pages whenever a remaining prefix is declared.

An edition link may include its first relationship candidates and `candidatesTruncated`. Follow `directory_link_targets` for every original target when that flag is set. A record's source reference is the pair `{sourceId, recordId}`; the source ID is essential when two editions contain equal record bytes.

Native source/index limits are 256 MiB, interactive page responses are 4 MiB, and native complete workspace archives support 2 GiB. The inherited connected host file transport retains its 512 MiB maximum. Use the native complete-file CLI for a larger workspace archive. A native operation does not become complete merely because one page was returned.

## Interrupted acquisition and receiving

Acquisition IDs are supplied by the caller and support letters, digits, dots, underscores, colons and hyphens under the native schema. Reuse the same operation ID and inspect `directory_operation` after an interrupted response. The native acquisition retains the original request, raw response pages, continuation URLs, headers, provider timing, completion state and capture journal. `advance`, `pause`, `resume` and `capture-source` use the existing operation.

A retained connected result records the original action, full arguments, response and original export manifest. The full receiving programme checkpoints that descriptor before validation, so a provider or storage failure remains recoverable. Reuse the same operation output and selected original files when resuming.

## Operate the complete connected programme

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/connected/RECEIVING.mjs \
  --receiving /absolute/native/OPERATED_HUMAN_SERVICES_DIRECTORY.json \
  --workspace /absolute/private/original-or-received-workspace \
  --out /absolute/private/connected-receiving
```

The native receiving JSON supplies the actual workspace UUID, original input files and exact accepted replay inputs. If those original files moved, pass `--source-files ABS_JSON` with the existing source keys mapped to their new absolute paths; their retained lengths and SHA-256 values must still match. An existing authentication profile file may be selected with `--credentials-file`.

The programme uses the maintained Merchant host, imports all declared original directory inputs, exercises all accepted native replay inputs, follows complete pages, receives complete indices and original files, receives the handoff and latest complete workspace into separate destinations, reopens the Merchant connection while keeping the original native operator, and verifies all retained downloads. It writes `OPERATED_CONNECTED_HUMAN_SERVICES_DIRECTORY.json` and its restartable `CONNECTED_JOURNEY.json`. See [the complete product receiving guide](../../../../../products/human-services-directory/RECEIVING.md).
