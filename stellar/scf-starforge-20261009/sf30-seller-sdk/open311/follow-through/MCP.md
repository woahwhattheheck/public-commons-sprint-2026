# Follow-through merchant tools and typed client

The **open311-follow-through-workspaces** provider opens the same saved SQLite desk used by the browser and CLI. Its family and normalized configuration key is **open311FollowThroughWorkspaces**. The maintained merchant connection field is **open311FollowThroughWorkspaceConnection**.

The provider operates original host-selected files, the existing release store and the maintained retained-file reader. Prepare the complete source selection and private runtime using [INSTALL.md](INSTALL.md).

## Bind private desks and complete original files

Initialize each operating or receiving directory with open311-follow-through init. Save a private connection JSON file with mode 0600:

~~~json
{
  "schema": "stellar-forge.open311-follow-through-host.v1",
  "workspaces": {
    "operations": {
      "label": "Municipal follow-through",
      "directory": "/absolute/private/follow-through",
      "inputs": {
        "requests": {
          "label": "Original request source",
          "path": "/absolute/handover/request-source.json",
          "sha256": "EXACT_COMPLETE_REQUEST_FILE_SHA256",
          "kind": "source",
          "format": "json"
        },
        "requestMetadata": {
          "label": "Original request layer metadata",
          "path": "/absolute/handover/request-layer.json",
          "sha256": "EXACT_COMPLETE_METADATA_FILE_SHA256",
          "kind": "metadata",
          "format": "json"
        },
        "review": {
          "label": "Returned supervisor review",
          "path": "/absolute/handover/reviewer-return.json",
          "sha256": "EXACT_COMPLETE_REVIEW_FILE_SHA256",
          "kind": "review",
          "format": "json"
        }
      }
    },
    "received": {
      "label": "Received follow-through",
      "directory": "/absolute/private/received-follow-through",
      "inputs": {
        "workspace": {
          "label": "Complete original follow-through workspace",
          "path": "/absolute/handover/complete-follow-through.json",
          "sha256": "EXACT_COMPLETE_WORKSPACE_FILE_SHA256",
          "kind": "workspace",
          "format": "json"
        }
      }
    }
  }
}
~~~

Replace each placeholder with its complete original-file SHA-256. Relative paths resolve against the connection file. Select distinct original private workspace directories. Each connection permits up to 128 workspace aliases and each workspace up to 128 input aliases.

| Input kind | Formats | Purpose |
| --- | --- | --- |
| source | arcgis, geojson, csv, json, auto | Original request or order dataset, retained source packet, collection or report |
| metadata | json | Original layer metadata for a selected source |
| review | json | Complete returned reviewer file |
| workspace | json | Full editable follow-through package |

readFollowThroughWorkspaceConfiguration(path) validates and resolves the declared host configuration. FOLLOW_THROUGH_HOST_SCHEMA exports its exact schema string. readFollowThroughHostInput(entry, alias, expectedSha256) reads the selected whole file and verifies its configured and requested identity before returning the original bytes.

Source import can pair an input alias with metadataInput and expectedMetadataSha256. The original metadata file and its host selection are part of the saved operation input. When a retained source packet contains several candidate captures, choose captureIds from inspectSource. Source and metadata selection never depend on an arbitrary filesystem path supplied in a merchant tool argument.

## Initialize the maintained merchant host

Save initializer options in a private file:

~~~json
{
  "directory": "/absolute/private/follow-through-merchant",
  "connection": "/absolute/private/follow-through-host.json",
  "name": "Municipal follow-through"
}
~~~

Initialize through the prepared runtime:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  merchant-providers init open311-follow-through-workspaces \
  --options /absolute/private/follow-through-setup.json
~~~

The equivalent source SDK is initializeFollowThroughMerchantWorkspace from follow-through/mcp-setup.mjs. Supply releaseStore when selecting an existing original SF82 release store. Repeating the same initializer arguments recovers the saved setup intent.

Generate a client entry on the host that will launch the installed merchant:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  merchant-mcp-client-config \
  --config /absolute/private/follow-through-merchant/merchant-mcp.json \
  --name open311-follow-through \
  --output /absolute/private/follow-through-mcp-client.json
~~~

The maintained generator records the actual absolute Node executable and prepared stdio source. Its --merge option can preserve an existing client configuration while adding an unused server name to a new output file. The direct terminal transport is merchant-mcp-stdio --config through the same prepared runtime. A receiving host generates its own host-local entry after preparing the delivered runtime.

## Complete operating tools

Tool names begin with merchant_open311_follow_through_.

| Suffix | Operating result |
| --- | --- |
| workspaces | Configured workspace and input aliases |
| status | Workspace identity, revision, record counts, recent operations and retained downloads |
| records | Paged source, profile, edition, work, return or dispatch summaries |
| input | Original configured file name, purpose, format, bytes and hash |
| inspect_source | Original fields, capture choices, coordinate declarations and coverage |
| import_source | Save the complete selected source and metadata |
| profile_save | Save an immutable explicit field/status/date/coordinate mapping revision |
| edition_build | Save a request-only or paired-source operating edition |
| record_info | One source, profile or edition description |
| source_rows | Page original source attributes, geometry and full records |
| requests / orders | Search and page normalized requests or work orders |
| request | One request, candidate orders, reviewed links, discrepancies and work history |
| changes | Page request or order changes between saved editions of the same series |
| link_review | Save a source-version-bound confirmed or rejected relationship |
| work_save | Save assignment, due time, notes, location interpretation and action approval |
| work_queue | Page the current work projected into a selected edition |
| work_info | Saved work and its complete paged history |
| review_import | Retain a complete returned reviewer file |
| return_info | Page proposals or decisions, with conflicts for an explicit target edition |
| review_apply | Accept or reject selected original proposals |
| dispatch_create | Save explicitly selected current approved actions and destination columns |
| dispatch_info | Page a saved dispatch with its original source coverage |
| operation | Recover an original action by stable request ID |
| receive | Import a complete editable workspace into an empty desk |
| file_read / file_release | Download or release a complete retained original/output file |

Paged reads require expectedRevision and return items, total, offset, limit, returned and nextOffset, plus workspaceId and revision. Follow nextOffset until null. Merchant row limits are 1–100; the browser/API support 1–1000. A complete output larger than the merchant view limit remains available through the file reader.

Each mutation requires requestId and expectedRevision. Read status before preparing a new intent. Recover a dropped response by looking up the original request ID and retrying the exact input if no success exists. A rejected validation or revision conflict rolls back and has no saved successful operation. The browser and SDK keep that distinction visible.

The operation view describes large source bodies with byte/hash manifests. To receive the complete original input and result, download kind operation with operationId equal to the original request ID. A workspace-receive operation stores a compact originalFile descriptor and incomingPackageSha256, so repeated handovers retain original history without recursively nesting each whole prior package inside another operation input.

## Typed operating example

The client adapts an existing merchant callTool transport:

~~~js
import { Open311FollowThroughMerchantClient } from
  '@tokenjunkielabs/starforge-merchant/merchant/open311-follow-through/client';
import { readFile, writeFile } from 'node:fs/promises';

const desk = new Open311FollowThroughMerchantClient(
  (name, args) => merchantTransport.callTool({ name, arguments: args }),
  'operations',
);

let state = await desk.status();
const source = await desk.importSource({
  input: 'requests',
  expectedSha256: originalRequestFileSha256,
  metadataInput: 'requestMetadata',
  expectedMetadataSha256: originalMetadataFileSha256,
  role: 'requests',
  seriesId: 'municipal-requests',
  name: 'Original request source',
  observedAt: originalSourceObservedAt,
  requestId: 'follow-through-source-001',
  expectedRevision: state.revision,
});

const profile = JSON.parse(await readFile('/absolute/config/profile.json', 'utf8'));
const saved = await desk.saveProfile({
  profile,
  requestId: 'follow-through-profile-001',
  expectedRevision: source.revision,
});

const built = await desk.build({
  requestId: 'follow-through-edition-001',
  expectedRevision: saved.revision,
  definition: {
    name: 'Municipal request follow-up',
    seriesId: 'municipal-follow-up',
    profileId: saved.profile.key,
    requestSourceId: source.source.id,
    orderSourceId: null,
    asOf: selectedOperatingAsOf,
  },
});

const page = await desk.requests({
  editionId: built.edition.id,
  expectedRevision: built.revision,
  offset: 0,
  limit: 100,
});

const delivered = await desk.downloadFile({
  kind: 'workspace',
  expectedRevision: built.revision,
});
await writeFile('/absolute/handover/complete-follow-through.json', delivered.bytes, {
  flag: 'wx',
  mode: 0o600,
});
~~~

Use actual source times, hashes and mapping definitions from the original files. requests returns compact source/work summaries. request accepts editionId, key and expectedRevision for the complete original detail; orders supplies manual relationship choices. saveWork, reviewLink, importReview, applyReview and createDispatch accept the same explicit inputs as the browser and CLI.

returned accepts id, targetEditionId, section proposals or decisions, the observed expectedRevision and paging. changes accepts before, after and optional entity requests or orders. workQueue with approval approved returns current approved actions still eligible for dispatch.

## Complete file receiving

downloadFile(selection, options) returns {file, bytesRead, bytes} where bytes is a Buffer. Options include limit, maximumBytes and an async onChunk sink. With onChunk, the result omits the accumulated Buffer and the caller receives each exact byte chunk.

Each read verifies its original offset, complete file manifest, byte count, terminal position and whole SHA-256. File selections require expectedRevision and select one source, edition, reviewer return, dispatch or operation, or the complete workspace. The retained-reader identity holds the already selected output across later browser changes.

Export kinds are workspace, source, edition, requests-csv, review, report, returned, dispatch-json, dispatch-csv, dispatch-geojson and operation. Source exports optionally select fileId for an original capture or layer metadata body. The complete workspace includes all source and reviewer files and the full saved history.

A receiving alias selects the original full workspace file and kind workspace. Call receive with that alias, expectedSha256, a new stable receiving request ID and expectedRevision 0 on an initialized empty desk. The receiver reconstructs original sources, mappings, editions, reviewed relationships, work, decisions and dispatches before committing.

## Provider ownership

The provider opens its own database handles lazily. Closing it drains admitted work, releases its retained readers and closes those handles. An independent browser process continues to operate the same original directory. The package uses the maintained release store, provider registry and original file-reader contracts throughout.
