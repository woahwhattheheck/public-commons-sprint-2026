# Connected Ruby customer operations

The installed connected client operates the same managed Ruby workspace as the customer desk. It provides local JavaScript and TypeScript, MCP over stdio, authenticated loopback MCP over HTTP, complete file receiving, and the installed command line. The original customer lifecycle, Ruby/Bundler environment, Rails application, data-edition review, operation IDs and database history stay in that workspace.

There are 37 named tools. Each tool has a complete JSON input schema and calls the maintained runtime, customer, edition or receiving implementation. Long native operations return their saved operation immediately. Large JSON results remain complete files and the JavaScript client receives every chunk before returning the reconstructed value.

## Install the existing MCP feature

Use the original distribution installer and the release's existing **mcp** feature. Its selected SDK is @modelcontextprotocol/sdk 1.32.1. Node must meet the distribution's Node 22.16+ requirement. The managed Rails environment selects its own original Ruby 3.1+ executable and exact Bundler version.

The following paths are operator selections: SF_BOOTSTRAP is the retained original distribution source root, SF_INSTALL is its private installation directory, and SF_ARCHIVE/SF_ARCHIVE_SHA256 identify the complete selected release archive.

~~~sh
node "$SF_BOOTSTRAP/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs" prepare \
  --dir "$SF_INSTALL" --archive "$SF_ARCHIVE" --sha256 "$SF_ARCHIVE_SHA256" --feature mcp

node "$SF_BOOTSTRAP/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs" install \
  --dir "$SF_INSTALL"

node "$SF_BOOTSTRAP/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs" run \
  --dir "$SF_INSTALL" -- ruby-runtime-agent tools
~~~

Preparation retains the selected archive and dependency profile. Install uses the existing registry/cache workflow. The installer also supports its original offline and complete existing-dependency adoption paths. Its inspect command with --load and --source reports the selected installation and original import readiness.

Use the resulting sourceRoot for direct source execution. These two commands are also registered in the product CLI:

| Command | Complete source entry |
| --- | --- |
| ruby-runtime-agent | distribution/ruby-runtime/connected/cli.mjs |
| ruby-runtime-mcp | distribution/ruby-runtime/connected/mcp.mjs |

The source paths above are beneath stellar/scf-starforge-20261009. The selected standalone product includes the same commands, complete sources and existing MCP feature.

## Connect a desktop or agent through stdio

Run the installed agent command with config and select the original absolute private Ruby runtime directory:

~~~sh
starforge ruby-runtime-agent config --directory /srv/starforge/ruby \
  --output /srv/starforge/ruby-agent-registration.json
~~~

When using the product's command launcher, put ruby-runtime-agent after its original command delimiter as shown in the installation example. Direct source execution is also available:

~~~sh
node "$SF_SOURCE/stellar/scf-starforge-20261009/distribution/ruby-runtime/connected/cli.mjs" \
  config --directory /srv/starforge/ruby \
  --output /srv/starforge/ruby-agent-registration.json
~~~

The generated file is ordinary MCP registration JSON under mcpServers.starforge-ruby. It uses the actual Node executable running the command and the installed server file, with literal arguments:

~~~json
{
  "mcpServers": {
    "starforge-ruby": {
      "command": "/absolute/selected/node",
      "args": [
        "/absolute/installed/source/stellar/scf-starforge-20261009/distribution/ruby-runtime/connected/mcp.mjs",
        "stdio",
        "--directory",
        "/srv/starforge/ruby"
      ]
    }
  }
}
~~~

The config command fills those executable/source paths from the actual installation. Add --create when explicitly initializing the selected private runtime. Normal reopening uses its existing directory.

stdio writes only MCP messages on stdout. Operational errors use stderr. Closing the client drains its admitted transfers and source persistence; the same saved native job can be read through the next connection.

## Run the authenticated HTTP service

~~~sh
starforge ruby-runtime-mcp serve --directory /srv/starforge/ruby --port 8476 --startup-json
~~~

The service listens on 127.0.0.1 and serves /mcp. Its startup JSON returns the actual URL, runtime directory and private token-file path. Port 0 selects an available loopback port. The default token record is ruby-mcp-token.json inside the private runtime. A selected --token-file must be an absolute path beneath an existing canonical parent.

The token is created once as a private file. Load its token field when connecting. The default listener uses the existing authenticated single-response MCP HTTP transport and preserves the original operation's code, message, status and details in failed tool responses.

A JavaScript HTTP connection uses:

~~~js
const client = await connectRubyRuntime({
  url: startup.url,
  bearerToken: originalTokenRecord.token
});
try {
  const workspace = await client.inspect();
  const customers = await client.customers({ offset: 0, limit: 25 });
  // Follow customers.nextOffset until it is null to read every saved customer.
} finally {
  await client.close();
}
~~~

Each source path passed to a tool is a path on the machine running the Ruby workspace. downloadFile's directory and uploadFile's archive are on the client machine.

## Saved CLI connection files

The CLI's --connection option uses a separate file shape from the desktop mcpServers registration. Its schema is stellar-forge.ruby-connected-configuration.v1, with one connection object.

For stdio:

~~~json
{
  "schema": "stellar-forge.ruby-connected-configuration.v1",
  "connection": {
    "command": "/absolute/selected/node",
    "args": [
      "/absolute/installed/source/stellar/scf-starforge-20261009/distribution/ruby-runtime/connected/mcp.mjs",
      "stdio",
      "--directory",
      "/srv/starforge/ruby"
    ]
  }
}
~~~

For HTTP:

~~~json
{
  "schema": "stellar-forge.ruby-connected-configuration.v1",
  "connection": {
    "url": "http://127.0.0.1:8476/mcp",
    "bearerToken": "the token field from the original private token record",
    "timeoutMs": 900000
  }
}
~~~

Keep that HTTP connection file private, like the original token file. Reuse the exact existing endpoint/token when reconnecting.

~~~sh
starforge ruby-runtime-agent call inspect --input /srv/starforge/empty-object.json \
  --connection /srv/starforge/ruby-connection.json \
  --output /srv/starforge/workspace.json
~~~

Here empty-object.json contains {}. --directory selects a local connected client instead of a transport. Every operating command accepts either --directory or --connection, and --output writes its complete JSON result.

## Use the typed JavaScript API

The public distribution exports ./ruby-runtime/client, with client.d.mts declarations and the same local/MCP client methods. It also exports ./ruby-runtime/receiving and ./ruby-runtime/mcp.

~~~js
import { openRubyConnectedClient, connectRubyRuntime }
  from '@tokenjunkielabs/starforge-merchant/ruby-runtime/client';

const client = await openRubyConnectedClient({ directory: '/srv/starforge/ruby' });
try {
  const saved = await client.customer({ id: originalCustomerId });
  const ready = await client.waitCustomer({
    id: saved.id,
    expectedSelectionSha256: saved.selectionSha256,
    timeoutMs: 30 * 60 * 1000
  });
  const application = await client.application({ id: ready.applicationId });
} finally {
  await client.close();
}
~~~

The selected product's own package name uses the same export suffixes. All original JSON result fields are retained. Named types cover customers, native operations, application data editions, reviews/receipts, complete file descriptors, uploads, connection selection and cancellation signals.

Use a saved operation UUID before a modifying call. If a response is lost, read that UUID or repeat its exact retained request. The runtime rejects a conflicting selection under the same ID. A wait timeout leaves the original native request available. resume continues its original arguments after the underlying problem is corrected; cancel requests the original worker and its native children to stop.

## Commission a customer

A new customer selection combines the original reviewed source, managed environment, source checkout, exact Python/Node executables, output directory and saved application/operation IDs.

1. Call previewSource with kind and the complete original source directory.
2. Retain its manifest.sha256 in expectedSourceSha256.
3. Save the complete selectCustomer input and UUIDs in the original customer request.
4. Call selectCustomer, then waitCustomer with the returned selectionSha256.
5. Read the original customer/application, open its actual Rails listener, or export its stopped full application.

The native selection requires sourceKey and datasetId. keys may be an empty array to select the source's original semantic key. The Baserow selection requires customerKey, datasetId and the exact lowercase 40-character sourceRef checkout commit; query is optional. Those two selection shapes have separate TypeScript interfaces.

For an existing original lifecycle output, previewExisting returns the original input SHA. adoptCustomer selects that same input/output and uses its retained customer operation and registration IDs. It advances the original completed work into the customer desk.

Customer phases include SELECTING, SELECTED, COMMISSIONING, CUSTOMER_COMPLETE, REGISTERING, FINALIZING and READY. READY includes the retained original result. CUSTOMER_NEEDS_RESUME and REGISTRATION_NEEDS_RESUME identify the original operation to inspect and resume. The CLI commission command follows the same saved selection.

~~~sh
starforge ruby-runtime-agent commission --id "$CUSTOMER_ID" --selection-sha "$SELECTION_SHA256" \
  --directory "$RUBY_RUNTIME" --output "$CUSTOMER_RESULT"
~~~


## Update an existing application's data

The same client exposes the complete managed application data-edition workflow. Stop the original listener before staging, preparing or committing an edition.

previewApplicationEditionSource inspects a completed native DatasetDelivery or compound BaserowCustomerDelivery. Its manifest.sha256 binds the complete packet. stageApplicationEdition retains that original source under the application and prepares the existing Rails change review. prepareApplicationEdition can prepare a retained edition against a later working revision using another saved review UUID. commitApplicationEdition approves the exact preview digest and uses the existing Rails transaction and receipt.

~~~js
const source = await client.previewApplicationEditionSource({
  format: originalFormat,
  directory: originalCompletedPacket
});

// Save the complete original stage request before this call.
const staged = await client.stageApplicationEdition(originalStageRequest);
await client.waitOperation({ operationId: staged.id });

const edition = await client.applicationEdition({
  id: originalStageRequest.id,
  editionId: originalStageRequest.editionId
});
const review = edition.reviews.find(value => value.id === originalStageRequest.reviewId);
const expectedPreviewSha256 = review.review.summary.preview_sha256;

// Review the complete counts and files, then retain the actual commit request
// with this preview SHA, original review ID, actor and its operation UUID.
const committed = await client.commitApplicationEdition(originalCommitRequest);
await client.waitOperation({ operationId: committed.id });
~~~

A stage request includes id, editionId, title, format, directory, expectedManifestSha256, reviewId, operationId and actor. Prepare uses id, editionId, reviewId, operationId and actor. Commit adds expectedPreviewSha256 to those prepare fields. The original review UUID is a lowercase version-4 UUID. The actor is the actual operator identity recorded in the original review.

applicationEditions returns editions, total and nextOffset. applicationEdition returns the complete retained source, original reviews, native operations, current receipt and file descriptors. Receive a selected file through the same complete-file API using source.kind = edition and its original application ID, editionId, optional reviewId and filename.

The current data source is resolved from the database's committed edition and original operation/review. Historical receipts remain bound to their own original edition rows. Removed source keys are retained separately from currently active rows. The application export carries the complete current database, source packets and reviews.

## Browse and carry the saved working dataset

The Rails operator's **Working records** screen saves the complete committed stream with its original source, imported values, current application values and original attachment links. Staff can search all original and working values, combine typed filters, sort the full result, open every page, compare one record and download the complete selected CSV or JSON. Saved pages and exports continue to use the same capture when the live application changes.

A complete saved dataset also provides its export selection:

~~~js
const workingCapture = {
  reviewId: originalReviewId,
  captureId: originalCaptureId,
  expectedCaptureSha256: originalCaptureSha256
};
~~~

Both IDs are the lowercase version-4 UUIDs returned by the operator. Copy the complete SHA-256 from that capture. The **Use this saved dataset for an application export** section provides the exact three-field selection together.

Stop the original application listener, then retain a new original verify or export request with this selection:

~~~js
const exported = await client.start({
  id: originalEnvironmentId,
  applicationId: originalApplicationId,
  action: 'export',
  operationId: originalExportOperationId,
  workingCapture
});
const completed = await client.waitOperation({ operationId: exported.id });
~~~

Verification uses the same input with action set to verify. The selected capture must match every current managed record, its source linkage and the original edition receipts. Later working edits require another complete capture. The export retains the complete application, original dataset editions, review and capture files, exact client source, dependency lock and local bundle. It reopens the copied application before publishing the archive. The receiving operation compares its complete native working-state observation with that saved export and retains the same capture selection for future verification.

An export without an explicit workingCapture uses the application's existing verification profile. A received application that already carries a captured working-state profile keeps that original profile. Older installed source packages remain readable; the runtime checks support before selecting a new record operation.

The existing runtime run method also exposes dataset-records for the saved-record CLI and dataset-records-lifecycle for the complete native customer journey. Both use the original environment and literal argv array. The complete guide is in developer/ruby-client/examples/rails_dataset/operator/records.md; its native journey opens the existing managed application, follows the actual signed capture form, reads every selected page and download, then receives and reopens a complete independent application.

## Download a complete original file

Retain the transfer UUID before the first call and give each selected file its own private receiving directory.

~~~js
const received = await client.downloadFile({
  transferId: originalTransferId,
  source: {
    kind: 'operation',
    operationId: originalExportOperationId,
    name: 'ruby-runtime.tar'
  },
  expectedSha256: originalArchiveSha256,
  directory: '/srv/starforge/receiving/customer-archive'
});
~~~

The returned path is the whole received file. Its bytes and sha256 match the original source descriptor. download.json and cursor.json keep the original transfer selection and durable committed offset. The receiver syncs each chunk before retaining the cursor, checks each chunk's bytes/digest, and verifies the complete final digest before publishing payload.tar, payload.json or payload. received.json describes that completed receiving.

Calling downloadFile again on the same directory continues the original cursor. A completed call rechecks the whole retained file and returns the same original result. A disconnected server can reopen the selected immutable operation/customer/edition file under that transfer ID.

For explicit chunk consumers:

1. openTransfer retains the exact original selection and returns its full size/SHA.
2. readTransfer reads base64 bytes at the chosen offset, up to 1 MiB decoded per call.
3. Verify sha256 for that chunk and fileSha256 for the selected complete file.
4. Continue at nextOffset until eof, then closeTransfer.

The CLI download command performs the complete receiving:

~~~sh
starforge ruby-runtime-agent download --transfer-id "$TRANSFER_ID" --source "$ORIGINAL_FILE_SELECTOR" \
  --sha256 "$FILE_SHA256" --out "$PRIVATE_FILE_DIRECTORY" --connection "$CONNECTION_FILE"
~~~

A selector is the source object shown in the JavaScript example, saved as JSON. Customer files use kind customer, id and name. Application edition files use kind edition, id, editionId, reviewId when the file belongs to a review, and name.

## Upload and receive the whole original runtime archive

uploadFile fingerprints the complete client TAR, uses the original receiving operation UUID, continues the server's durable byte cursor, checks that the source file stayed unchanged, and invokes the original complete archive receiver.

~~~js
const operation = await client.uploadFile({
  archive: '/srv/starforge/receiving/customer-archive/payload.tar',
  id: originalReceivingEnvironmentId,
  title: originalReceivingTitle,
  ruby: originalReceivingRubyExecutable,
  bundlerVersion: originalBundlerVersion,
  expectedSha256: originalArchiveSha256,
  bytes: originalArchiveBytes,
  operationId: originalReceivingOperationId
});
const finished = await client.waitOperation({ operationId: operation.id });
const application = await client.application({ id: finished.result.application.id });
~~~

The archive can be up to the existing runtime's 4 GiB limit. The same receiving UUID identifies the staged transfer and native receiving operation. A lost chunk response is reconciled against the saved committed offset. Identical already-committed chunks are acknowledged from their actual retained bytes. A gap or conflicting chunk returns the original receiving error and offset.

prepareUpload, upload, writeUpload and finishUpload expose the same workflow to explicit MCP clients. finishUpload checks the entire TAR and then uses the existing Ruby ABI, lock, cache and application receiving path. Poll its original native operation for completion.

~~~sh
starforge ruby-runtime-agent upload --archive "$ORIGINAL_TAR" --input "$ORIGINAL_RECEIVING_REQUEST" \
  --connection "$CONNECTION_FILE" --output "$RECEIVING_OPERATION"

starforge ruby-runtime-agent wait --operation-id "$RECEIVING_OPERATION_ID" \
  --connection "$CONNECTION_FILE" --output "$COMPLETE_RECEIVING_RESULT"
~~~

The upload input file contains the original id, title, ruby, optional bundlerVersion, operationId, and optional original expectedSha256/bytes. The command receives the archive argument separately. Use the same complete input on resumption.

## Run the complete original customer continuation

examples/customer-agent.mjs continues a completed managed customer and its existing customer desk. It uses the original source data, customer operation, registration and exported application.

~~~sh
node "$SF_SOURCE/stellar/scf-starforge-20261009/distribution/ruby-runtime/connected/examples/customer-agent.mjs" \
  --managed-directory "$ORIGINAL_MANAGED_CUSTOMER_DIRECTORY" \
  --customer-id "$ORIGINAL_CUSTOMER_ID" \
  --recipient-port "$AVAILABLE_RAILS_PORT"
~~~

The programme opens the real SDK stdio connection, receives the original customer result, downloads a real TAR chunk through the maintained receiver and lets its cursor reach durable storage. It closes that connection before a second read. The HTTP client reopens the same transfer ID and receiving directory and obtains all remaining bytes. An archive small enough to finish in one chunk follows the completed receiving path.

It then transfers the complete TAR through HTTP into a dedicated recipient beneath that original managed directory. Its receiving, verification and listener UUIDs are saved before their first calls. It opens the actual private Rails session and review page, stops the original listener, runs the native application's complete source/database/history verifier, and reopens the received application.

The native observation must match the original managed application's format, source key, complete dataset manifest, row count, edition count and history SHA. Re-running the programme uses its original saved selection and operations; completed receiving rehashes the full archive and customer file. It returns connected-result.json under connected-customer.

Use the existing managed/customer/edition programmes with their original execution owner. Their original directories, UUIDs, source captures and prepared requests remain the inputs to this continuation.

## Full tool catalogue

All methods are present on both local and connected JavaScript clients. The CLI tools command returns their complete input schemas. The application owns the same input validation and original operation admission regardless of transport.

| JavaScript method | MCP tool |
| --- | --- |
| inspect | ruby_runtime_inspect |
| probe | ruby_runtime_probe |
| create | ruby_runtime_create_environment |
| start | ruby_runtime_start_operation |
| run | ruby_runtime_run_customer_program |
| resume | ruby_runtime_resume_operation |
| cancel | ruby_runtime_cancel_operation |
| operation | ruby_runtime_get_operation |
| log | ruby_runtime_read_log |
| application | ruby_runtime_get_application |
| registerApplication | ruby_runtime_register_application |
| launchApplication | ruby_runtime_launch_application |
| stopApplication | ruby_runtime_stop_application |
| receive | ruby_runtime_receive_archive |
| previewSource | ruby_customer_preview_source |
| previewExisting | ruby_customer_preview_existing |
| customers | ruby_customer_list |
| customer | ruby_customer_get |
| selectCustomer | ruby_customer_select |
| adoptCustomer | ruby_customer_adopt |
| advanceCustomer | ruby_customer_advance |
| resumeCustomer | ruby_customer_resume |
| cancelCustomer | ruby_customer_cancel |
| previewApplicationEditionSource | ruby_application_edition_preview_source |
| stageApplicationEdition | ruby_application_edition_stage |
| prepareApplicationEdition | ruby_application_edition_prepare |
| commitApplicationEdition | ruby_application_edition_commit |
| applicationEditions | ruby_application_edition_list |
| applicationEdition | ruby_application_edition_get |
| openTransfer | ruby_file_open |
| transfer | ruby_file_status |
| readTransfer | ruby_file_read |
| closeTransfer | ruby_file_close |
| prepareUpload | ruby_archive_prepare |
| upload | ruby_archive_status |
| writeUpload | ruby_archive_write |
| finishUpload | ruby_archive_finish |

## Operation and resource ownership

A client closes admission, drains its accepted work and then closes its transport/snapshots. Closing a network connection does not replace or silently cancel a saved native operation. Reconnect and read that same original ID. Cancellation of a wait or client file transfer uses the supplied AbortSignal; the durable original file cursor remains available.

The server keeps at most four open outgoing snapshots and four incoming archive writers per handle. Closed file selections can reopen their immutable original snapshots. A complete JSON tool result over 768 KiB is retained as a readable file; the SDK client receives it in full up to the existing 128 MiB result limit. Explicit MCP consumers follow that returned file descriptor with ruby_file_read and close it afterward. File chunks themselves remain direct results.

Both HTTP and stdio return the original structured error. In particular, status/details needed for same-operation continuation survive the shared HTTP boundary. Inspect the original operation, complete worker log and selected receiving status when an action fails. Correct the underlying issue and continue the retained source/UUID.
