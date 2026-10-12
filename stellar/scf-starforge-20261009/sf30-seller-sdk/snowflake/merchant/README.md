# Snowflake merchant operations

The Snowflake merchant provider connects agents to the original Snowflake browser, capture journal, retained editions, SQLite merchant workbench and SF82 release/customer console. It exposes the original operations through the maintained authenticated Merchant MCP host. The typed client handles complete histories, resumable original-file uploads, complete merchant downloads and offline reopening.

## Connect the existing workspace

Select an initialized native Snowflake workspace and copy its actual UUID from its state or Applications inspection. Create a private connection file:

~~~json
{
  "schema": "stellar-forge.snowflake-merchant-connection.v1",
  "workspaces": {
    "finance": {
      "label": "Finance retained queries",
      "directory": "/srv/starforge/snowflake-finance",
      "workspaceId": "THE-EXISTING-NATIVE-WORKSPACE-UUID"
    }
  }
}
~~~

The reader checks the original SQLite metadata, canonical private directory and exact UUID without acquiring the native writer. Each existing directory has one alias; a connection supports up to 32 workspaces.

~~~sh
chmod 600 snowflake-connection.json
starforge merchant-snowflake init \
  --directory ./snowflake-merchant \
  --connection ./snowflake-connection.json \
  --workspace finance
starforge merchant serve --config ./snowflake-merchant/merchant-mcp.json
~~~

Provide the original Merchant MCP bearer token in the service's MCP_ACCESS_TOKEN environment variable. The saved Snowflake declaration refers to its own existing credential environment variable; that value belongs in the same service environment. Network clients can select a different token variable with --token-env.

The primary workspace's existing release-store is also the common merchant release store. Original Snowflake publication, native release activation and the shared merchant therefore inspect and operate the same seller state. Additional declared workspaces retain their own native release consoles. Repeating setup with the exact same configuration reopens it.

The original provider initializer is also available through the common registry:

~~~sh
starforge merchant providers inspect snowflake-workspaces
starforge merchant init-provider snowflake-workspaces --options snowflake-host-setup.json
~~~

The host setup JSON contains directory, connection and, when multiple workspaces are declared, workspace. An optional name labels the shared merchant host.

## Operate the original browser and native writer

Call merchant_snowflake_workspaces to inspect configured aliases, then merchant_snowflake_open with the selected workspace. The result contains the original workspace UUID, current process instanceId, browser URL and native state. The human browser and agent commands then use that same native writer.

The provider lazily opens one original Snowflake server per alias. Concurrent opens reuse its opening promise. The native Linux workspace lease owns the database. To move an existing Applications-owned workspace to this merchant owner, stop that original application and open the same saved directory through MCP. Every source, request, edition, review and publication remains in the original workspace.

Closing requires the exact instanceId returned by open. It drains accepted calls, stops the original browser and releases the native writer. A subsequent open returns a new process instance and the same saved workspace UUID. Host shutdown uses the original MerchantProviderOwners lifecycle and closes the original source and file-read owners.

## Tools and histories

Every listed name below has the merchant_snowflake_ prefix. Run merchant-snowflake tools for exact input schemas.

| Work | Actions | Original state |
| --- | --- | --- |
| Workspace and source | workspaces, open, state, sources, source, save_source, close | Native workspace UUID, revision, saved source and process instance |
| Capture | capture, resume, cancel, operations, operation, observations | Original request UUID, SQL API body, statement handle, result coverage and provider timing |
| Edition and review | editions, edition, rows, compare, review | Complete retained partitions, exact SQL values, native comparison and operator decision |
| Original receiving | receive_begin, receive_status, receive_chunk, receive_repair, receive_commit | Same receiving ID, partition hash and durable receivedBytes cursor |
| Merchant publication | prepare, publications, publication, resume_publication, release_console | Accepted edition, saved merchant terms, same publication UUID, native snapshot and SF82 release |
| Complete delivery | export, exports, manifest, file, file_release | Immutable selected delivery, complete file manifest and retained native read handles |

Supply the current expectedRevision when saving a source. Capture selects an existing named query, typed arguments and caller-retained requestId. The original compiler and SQL API implementation own the query and response rules. Resume uses the saved request body and original statement handle.

Capture and resume return the original operation promptly while its native job runs. The client awaitOperation method observes that same operation until it completes or reports an actionable provider outcome. Its interval and timeout affect observation only. The original journal retains provider cooldowns and nextAttemptAt.

Follow every nextOffset until it is null when reading sources, operations, observations, editions, rows, publications or exports. The typed client pages iterator performs that traversal and rejects a repeated or nonadvancing cursor. SQL values retain their original string representation, including large integers and exact decimal values; JSON null remains null.

## Typed client

The installed client export is ./merchant/snowflake. Its adjacent client.d.mts describes every named action, original selection, result, history page, file chunk and receiving result. The same implementation is available from merchant/client.mjs in the source tree.

~~~js
import {
  openSnowflakeClient,
  uploadSnowflakeOriginals,
  downloadSnowflakeExport,
  reopenSnowflakeExport,
} from './source/stellar/scf-starforge-20261009/sf30-seller-sdk/snowflake/merchant/client.mjs';

const client = await openSnowflakeClient({ url: process.env.SNOWFLAKE_MCP_URL });
const opened = await client.open({ workspace: 'finance' });
const current = await client.state({ workspace: 'finance' });

for await (const page of client.pages('editions', { workspace: 'finance', limit: 100 })) {
  for (const edition of page.items) console.log(edition.id, edition.rowCount);
}
~~~

Named methods use camel case, for example saveSource, receiveBegin and resumePublication. call accepts either the short action or its complete tool name. Original action metadata validates fields before dispatch; native source implementations validate their domain inputs.

The maintained MCP client keeps its existing 2 MiB default response limit. Snowflake selects a 16 MiB limit so the original source/request/partition metadata fits inside its text and structured MCP response. File chunks remain at most 196,608 bytes. The shared client accepts an explicit maximumResponseBytes from 1 KiB through 128 MiB for original providers with a different metadata envelope.

## Receive every original partition

The input is the original receiving.json and every partition it names. The manifest contains the source declaration, selected query and arguments, original request body and handle, edition identity, exact partition lengths and SHA256 values.

~~~sh
starforge merchant-snowflake upload \
  --url http://127.0.0.1:3211 \
  --workspace finance \
  --manifest ./original-export/receiving.json
~~~

The client verifies each original file with fixed-size reads, calls receive_begin and streams its bytes through receive_chunk. The original receiving ID is the digest of the canonical manifest. The server fsyncs the original partial file before advancing the same receiving journal.

Run the same command again after an interruption. The server returns the committed receivedBytes cursor. The client resumes that partition, then receives the remaining original partitions and commits the same immutable edition. An already committed byte range is accepted only when its exact original bytes match.

A crash after the final byte but before publication of the native object is recovered by replaying the original suffix. An unacknowledged file tail is removed at the saved cursor. When an incomplete original partial file is damaged, the client can reset that one incomplete partition and receive its verified original bytes again; --no-repair selects observation of that error instead. The native repair action preserves the same receiving ID and complete partitions.

Native bounds are inherited: each partition is at most 64 MiB, one receiving manifest describes at most 20,000 partitions and 1 GiB of original result bodies, and the manifest is at most 2 MiB. Whole-partition browser uploads and chunked merchant uploads share the original receiving implementation and journal.

## Prepare the original merchant

Review the selected edition with an explicit actor, decision and note. Prepare an accepted edition with its original SQLite workbench draft, selected runtime and a retained publicationId. The native compiler validates the merchant origin, payment terms, SQL queries, public example inputs and original retained database.

~~~json
{
  "workspace": "finance",
  "editionId": "THE-RETAINED-EDITION-SHA256",
  "publicationId": "THE-SELECTED-PUBLICATION-UUID",
  "draft": {
    "merchant": "THE-ORIGINAL-NATIVE-MERCHANT-DECLARATION",
    "queries": "THE-ORIGINAL-REVIEWED-QUERY-DECLARATIONS"
  },
  "runtime": { "port": 0 }
}
~~~

This illustrates the envelope; use the complete original native draft for merchant and queries. A repeated publication UUID must select the same edition and terms. resume_publication continues the saved request. The original SQLite workbench produces the merchant package, and SF82 retains its native snapshot and release inspection.

release_console opens the original SF82 console for release selection, activation, rollback, customer exports and receiving. It reuses the original live console when one is already open.

## Download the complete original delivery

Call export with workspace, editionId and a retained exportId. Include publicationId to deliver the original merchant files and native SQLite snapshot alongside its source edition. A different exact selection uses a new export ID. Repeating the original selection returns its same immutable manifest, even after later review or process changes.

| Delivered file | Contents |
| --- | --- |
| snowflake-export.json | Complete file names, lengths, hashes, original workspace and selected edition/publication |
| receiving.json and partition-*.json | Original native receiving manifest and every exact source response body |
| edition.json and review.json | Selected native edition and the operator review retained for this delivery |
| publication.json | Original publication identity, terms, request digest and release identity |
| merchant/** | Every file in the original prepared merchant package |
| native-snapshot.sqlite | Actual SF82 SQLite snapshot, query records and original partition BLOBs |
| cloud-delivery.json | Optional native cloud-delivery selection |
| README.md | Original receiving and reopening instructions |

The exporter retains immutable metadata and references the original content-addressed objects, merchant package and native snapshot. It verifies each opened original file with fixed memory and serves only manifest-selected files. The export supports nested merchant files, up to 40,032 manifest members, an 8 MiB manifest, an 8 GiB individual file and 32 GiB total selected delivery.

~~~sh
starforge merchant-snowflake inspect \
  --url http://127.0.0.1:3211 --export-id finance-october

starforge merchant-snowflake download \
  --url http://127.0.0.1:3211 --export-id finance-october \
  --directory ./finance-october \
  --manifest-sha256 THE-INSPECTED-MANIFEST-SHA256

starforge merchant-snowflake reopen \
  --export-id finance-october --directory ./finance-october \
  --manifest-sha256 THE-INSPECTED-MANIFEST-SHA256
~~~

The maintained downloader owns its private directory lease, original partial-file prefix, file-read IDs and exact checkpoint. Continue in the same directory after an interrupted connection. The checkpoint binds to the original Snowflake workspace UUID and manifest, so a new MCP loopback port can continue the same delivery.

Reopen verifies every complete file, the native receiving manifest and matching original partition descriptors. The downloaded receiving.json can be imported by the original Snowflake workspace. The selected snapshot is a native SQLite database that retains the exact original result bodies.

## Run the complete native receiving case

The source includes one whole receiving program. Supply an original exported result and its original native merchant draft:

~~~json
{
  "directory": "./snowflake-native-case",
  "manifestFile": "./original-export/receiving.json",
  "draftFile": "./original-merchant-draft.json",
  "publicationId": "THE-SELECTED-PUBLICATION-UUID",
  "exportId": "original-snowflake-delivery",
  "workspace": "warehouse"
}
~~~

~~~sh
starforge merchant-snowflake-receive --config original-receiving-case.json
~~~

The case initializes its own native workspace, connects the common Merchant MCP host, opens the original browser, retains an upload checkpoint, restarts the host and continues the same transfer. It prepares and resumes the original publication, retains every delivery file, interrupts and resumes the original download across another host restart, reopens every file, compares every native snapshot row and original partition body, receives the edition in a second original workspace, activates its selected native release and opens the SF82 customer console.

The case directory retains the original input hashes, workspace UUID, selected publication, completed stages and receiving/download state. Repeating the same config continues that case. Its original manifest and merchant terms remain fixed. Native Node, node:sqlite, Linux flock and the current installed merchant distribution are required.
