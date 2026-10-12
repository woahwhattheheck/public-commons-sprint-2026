# Service configuration merchant tools and typed client

The **open311-service-configuration-workspaces** provider operates the same saved service workbench as the browser and CLI. Its normalized configuration family/key is **open311ServiceConfigurationWorkspaces**. The maintained merchant configuration field is **open311ServiceConfigurationWorkspaceConnection**.

Prepare the selected product using [INSTALL.md](INSTALL.md). Initialize each operating and receiving directory before selecting it in the private host file.

## Select original files

Save a private connection file with mode 0600. [examples/host-connection.json](examples/host-connection.json) contains both an operating desk and an independent receiving desk.

~~~json
{
  "schema": "stellar-forge.open311-service-configuration-host.v1",
  "workspaces": {
    "operations": {
      "label": "Agency service configuration",
      "directory": "/absolute/private/service-configuration",
      "inputs": {
        "requests": {
          "path": "/absolute/original/requests.json",
          "sha256": "REPLACE_WITH_COMPLETE_ORIGINAL_FILE_SHA256",
          "kind": "source",
          "format": "json"
        },
        "configuration": {
          "path": "/absolute/original/service-definition.json",
          "sha256": "REPLACE_WITH_COMPLETE_ORIGINAL_PROFILE_SHA256",
          "kind": "profile",
          "format": "json"
        }
      }
    }
  }
}
~~~

Replace hash placeholders with the complete actual file hashes. Relative paths resolve from the connection file. Workspace aliases identify distinct original private directories; input aliases identify the selected complete files.

| Input kind | Complete original file |
| --- | --- |
| source | JSON containing the selected original request array |
| profile | Complete profile definition, or original saved profile with its definition member |
| workspace | Complete editable service-configuration workspace |

All inputs use JSON and strict UTF-8 decoding. The original byte hash, input alias, kind and format enter the saved mutation identity. The receiving operation retains its original-file descriptor and incoming package hash. Source inspection and source import preserve the original file, while an explicit row-array pointer defines the operating register.

The configuration supports up to 128 workspaces with up to 128 named inputs per workspace. `readServiceConfigurationWorkspaceConfiguration(path)` validates the complete host selection. `SERVICE_CONFIGURATION_HOST_SCHEMA` exports the schema; `readServiceConfigurationHostInput` returns the complete original bytes and metadata.

## Initialize the installed merchant host

Prepare setup options:

~~~json
{
  "directory": "/absolute/private/service-configuration-merchant",
  "connection": "/absolute/private/service-configuration-host.json",
  "name": "Agency service operations"
}
~~~

Run the original initializer through the prepared runtime:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  merchant-providers init open311-service-configuration-workspaces \
  --options /absolute/private/service-configuration-setup.json
~~~

The source API is `initializeServiceConfigurationMerchantWorkspace`. An optional `releaseStore` selects an existing original SF82 store. Otherwise the maintained initializer prepares its normal release store. The original selected connection and setup attempts remain available for replay.

Generate the client entry on the host that will run it:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  merchant-mcp-client-config \
  --config /absolute/private/service-configuration-merchant/merchant-mcp.json \
  --name open311-service-configuration \
  --output /absolute/private/service-configuration-mcp-client.json
~~~

The entry uses the actual host Node and prepared stdio source. The maintained `--merge` option adds an unused server name to a new output while preserving existing client entries. The direct transport is `merchant-mcp-stdio --config` through the same runtime.

## Complete operating catalog

All 19 tool names begin with `merchant_open311_service_configuration_`.

| Suffix | Customer operation |
| --- | --- |
| workspaces / status | Original host aliases, current workspace identity/revision, counts and retained operation summaries |
| records | Search and page sources, current profiles, previews or implementation releases |
| input / inspect_source | Verify the complete named file and inspect its original row arrays |
| import_source / source / source_rows | Save original text and selection, inspect its metadata and page every original row |
| profile_save / profile_import / profile | Save complete definitions or host-selected original profiles and inspect full version history |
| preview_create / preview | Route the whole register with explicit versions, baseline and overrides; page exact outcomes/messages |
| release_create / release | Save reviewed implementation packages and inspect remaining requests, application stages or migration implications |
| operation | Recover the original action result and compact full-input identity |
| receive | Continue a complete editable handover in an empty selected desk |
| file_read / file_release | Receive or release original and generated complete files |

All saved-record views require `expectedRevision`. Pages return `workspaceId`, `revision`, `items`, `total`, `offset`, `limit`, `returned` and `nextOffset`. Merchant pages support 1–100 items; follow `nextOffset` until null.

`profile` returns the current complete definition and pages saved profile versions. `release` returns compact selected source/profile/preview identities and pages a selected section: `remaining`, `apply-order` or `implications`. Full release files retain all original definitions, source values and routing rows.

## Typed source operation

~~~js
import {
  MerchantOpen311ServiceConfigurationWorkspaces,
  readServiceConfigurationWorkspaceConfiguration
} from './mcp.mjs';
import { Open311ServiceConfigurationMerchantClient } from './mcp-client.mjs';

const selected = await readServiceConfigurationWorkspaceConfiguration(
  '/absolute/private/service-configuration-host.json'
);
const provider = new MerchantOpen311ServiceConfigurationWorkspaces({
  open311ServiceConfigurationWorkspaces: selected,
  exportsDirectory: '/absolute/private/service-configuration-merchant/customer-exports'
});
const client = new Open311ServiceConfigurationMerchantClient(
  (name, args) => provider.call(name, args),
  'operations'
);

try {
  const original = await client.input('requests');
  const inspection = await client.inspectSource({
    input: 'requests', expectedSha256: original.sha256
  });
  // Select a pointer shown by the original inspection.
  const rowsPointer = '';
  const before = await client.status();
  const sourceIntent = {
    requestId: 'agency-original-source-001',
    expectedRevision: before.revision,
    input: 'requests', expectedSha256: original.sha256,
    name: 'Original agency request register',
    selection: { rowsPointer }
  };
  const received = await client.importSource(sourceIntent);

  const originalProfile = await client.input('configuration');
  const saved = await client.importProfile({
    requestId: 'agency-configuration-001',
    expectedRevision: received.revision,
    input: 'configuration', expectedSha256: originalProfile.sha256,
    expectedProfileVersionId: null
  });
  const profile = await client.profile({
    id: saved.profile.id, expectedRevision: saved.revision, limit: 1
  });
  // Choose the saved source profile explicitly.
  const mappingId = 'SELECTED_SOURCE_PROFILE_ID';
  const preview = await client.createPreview({
    requestId: 'agency-routing-001',
    expectedRevision: saved.revision,
    name: 'Complete original request routing',
    profileId: saved.profile.id,
    expectedProfileVersionId: profile.profile.versionId,
    sourceId: received.source.id,
    mapping: { sourceProfileId: mappingId },
    overrides: []
  });

  let offset = 0;
  for (;;) {
    const page = await client.preview({
      id: preview.preview.id, expectedRevision: preview.revision,
      offset, limit: 100
    });
    for (const row of page.items) {
      // Inspect original values, route evaluations, messages and findings.
      console.log(row.serviceRequestId, row.state);
    }
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
} finally {
  await provider.close();
}
~~~

Save `requestId`, the observed revision and the complete action payload before sending a mutation. On an uncertain response, read `operation(requestId)` and recover its saved result; retry the same original intent when no completion exists. A known revision conflict requires inspecting the latest saved state before preparing a new action.

The profile save and import methods accept an optional `expectedProfileVersionId`, including null for a new original profile. A source-file import can select an existing profile ID to save its next version. The original selected definition must match the complete original file.

## Whole-file delivery

| File kind | Selection |
| --- | --- |
| workspace | Complete selected workspace revision |
| profile | Profile ID, saved profile version ID, or matching pair |
| source | Original source ID |
| preview-json / preview-csv | Original preview ID |
| release-json / release-report | Original release ID |
| operation | Original request ID under operationId |

Every selection requires the observed `expectedRevision`. The SDK can collect complete bytes:

~~~js
const state = await client.status();
const received = await client.downloadFile({
  kind: 'workspace', expectedRevision: state.revision
});
console.log(received.file.sha256, received.bytesRead);
~~~

For larger outputs, provide an asynchronous `onChunk` sink and save directly to a create-only file:

~~~js
import { open } from 'node:fs/promises';
const handle = await open('/absolute/handover/service-workspace.json', 'wx', 0o600);
try {
  const state = await client.status();
  const file = await client.downloadFile(
    { kind: 'workspace', expectedRevision: state.revision },
    { onChunk: bytes => handle.writeFile(bytes) }
  );
  await handle.sync();
  console.log(file.file.sha256, file.bytesRead);
} finally {
  await handle.close();
}
~~~

The retained reader binds workspace alias, exact selection, revision, full SHA-256 and byte offset. A retained `readId` continues its original byte snapshot while the operator makes later changes. After provider reopening, an unchanged selected revision and the original expected hash allow the file to resume. Each complete download verifies the whole SHA-256 before returning.

`operation` keeps large original text and profile definitions as compact file descriptors in its ordinary response. The operation file kind provides the complete retained input and result. Provider closure waits for admitted operations and releases its own SQLite/file handles; independent browser and CLI handles continue their original workspace.

## Editable receiving

Save the complete workspace JSON, add it as a `workspace` input on an initialized empty receiving alias, and submit its exact hash:

~~~js
const receiver = new Open311ServiceConfigurationMerchantClient(
  (name, args) => provider.call(name, args), 'received'
);
const file = await receiver.input('handover');
const empty = await receiver.status();
const received = await receiver.receive({
  requestId: 'agency-handover-receive-001',
  expectedRevision: empty.revision,
  input: 'handover', expectedSha256: file.sha256
});
~~~

The received directory preserves the original workspace UUID, source bytes, profile versions, preview/release contents and action history. Its receiving receipt adds the new directory's original identity, incoming file hash and package hash. New configuration work continues from that received revision.
