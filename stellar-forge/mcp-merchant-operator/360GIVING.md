# Complete 360Giving publisher agents

The 360Giving provider connects agents to a publisher that is already saved and
running in Applications. It uses that publisher's original editions, named
reviews, candidate revisions, native grant builds, comparisons and request IDs.
The same source includes a direct Node client, merchant tools, a typed merchant
client, and complete customer file receiving.

The maintained package exports are `./seller/360giving/client` and
`./merchant/360giving`. Both have paired Node TypeScript declarations. In a source
checkout, their modules are
`stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/operator/client.mjs`
and `stellar-forge/mcp-merchant-operator/360giving-download.mjs`.

## Connect to a saved publisher

Use the private `360giving-connection.json` retained by the original
[Applications workflow](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/360GIVING_APPLICATIONS.md).
A direct client authenticates the current native launch before every operation,
pins the publisher UUID, and rereads that same connection file after an
Applications restart. The original saved application can replace its listener
port and bearer fragment while the publisher identity stays fixed.

```js
import {connect360GivingPublisher} from
  './stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/operator/client.mjs';

const publisher = await connect360GivingPublisher({
  connectionFile: '/private/applications/application-id/360giving-connection.json',
  expectedWorkspaceId: process.env.PUBLISHER_WORKSPACE_ID,
  timeoutMs: 240000
});
try {
  const state = await publisher.state();
  for (const edition of state.editions) {
    const review = await publisher.review({edition: edition.id});
    // Present the original report and complete named-decision template.
    console.log({edition: edition.id, review});
  }
} finally {
  await publisher.close();
}
```

The connection file is private, regular and owned by the current operator. The
client verifies the original saved application's workspace and binding against
`/api/launch`. A caller may instead select the exact private native console URL
with `consoleUrl`. The saved-file form supports restart; a literal URL remains
the selected URL.

Native JSON number tokens arrive as their original strings, including decimals,
long integers, exponents, counts and timestamps. Monetary values and named
decision documents therefore retain their source precision. Convert a value to
a JavaScript number only when it is a known protocol counter and passes the
appropriate range check. The merchant tools use the same convention for native
results; their own page offsets and file byte counts are validated numbers.

## Operate complete native work

Upload a complete source package and its matching registry record, then retain
the exact admission ID and input:

```js
const source = await publisher.upload('/private/intake/original-package.json');
const registry = await publisher.upload('/private/intake/registry.json');
const admitted = await publisher.submit({
  id: 'fund-october-intake',
  action: 'intake',
  input: {
    dataset: 'publisher-fund',
    label: 'Publisher fund',
    sourceUrl: process.env.PUBLISHER_SOURCE_URL,
    source: source.id,
    registry: registry.id,
    capture: null,
    transport: null
  }
});
const completed = await publisher.wait(admitted.id);
const edition = completed.result.id;
const review = await publisher.review({edition});
```

Retain the source capture and original transport as uploaded object IDs when
they accompany the publisher package. Capture and transport are selected on
the same intake. A named review is uploaded as its original complete document;
its source SHA256, reviewer, original decisions and exact financial text remain
part of the native source history.

| Action | Original input |
| --- | --- |
| `intake` | `dataset`, `label`, `sourceUrl`, `source`, `registry`, optional `capture` and `transport` |
| `decisions` | `edition` and the uploaded complete decision `object` |
| `candidate` | `edition` and its named `decision` |
| `build` | `edition` and optional `candidate` |
| `compare` | `dataset`, `before` and `after` native build IDs |
| `export` | `edition`, optional `decision` and `candidate` |
| `receive` | Uploaded complete handoff `object` |

`submit` and `resume` return the original HTTP 202 admission immediately.
`request` reads that saved record. `wait` follows that same ID until completion,
a new native interruption or its caller's deadline. If the original work is
interrupted, `resume(id)` explicitly continues it; follow it with `wait(id)`.
An interrupted admission snapshot may remain visible while the accepted
continuation enters the original queue.

A transport failure can happen after admission. Read the original ID before
deciding whether another submission is needed. Reusing the same ID and exact
input reaches the original record. A changed input under that ID is an actual
conflict reported by the publisher. When a merchant reaches a request originally
created by the SDK, it compares the native optional defaults, then resubmits the
exact retained input object. Omitted optional keys therefore continue to work
alongside CLI records that explicitly saved those keys as null.

Query parameters are scalar strings. Follow every `response.body.page.nextCursor`.
For comparisons, follow every `nextOffset` from `changes` or download the
complete original NDJSON with `downloadChanges`:

```js
const native = await publisher.nativeState('publisher-fund');
const selected = native.builds[0];
let cursor = null;
do {
  const result = await publisher.query({
    dataset: 'publisher-fund',
    build: selected.id,
    query: {limit: '250', ...(cursor ? {cursor} : {})}
  });
  consumeEveryRow(result.response.body.rows);
  cursor = result.response.body.page.nextCursor;
} while (cursor !== null);

await publisher.downloadExport('fund-october-export', {
  output: '/private/customer/360giving-complete-handoff.zip'
});
```

The direct client streams uploads and downloads, verifies the original complete
SHA256 and byte count, checks the same file descriptor and named file, and
publishes completed files without replacing a different existing output.
Sources and handoffs may be up to the native 1 GiB limit. A completed matching
output can be reused. Closing a client cancels and drains that client's
requests and file operations. Applications retains the original publisher and
its accepted jobs.

## Declare publisher handles for a merchant

The host declares file references once; tools select their stable handles.
Create a private configuration such as `/private/publisher-workspaces.json`:

```json
{
  "schema": "stellar-forge.360giving-merchant-connection.v1",
  "workspaces": {
    "publisher": {
      "label": "Publisher grants",
      "connectionFile": "/private/applications/source-id/360giving-connection.json",
      "expectedWorkspaceId": "00000000-0000-4000-8000-000000000001",
      "files": {
        "package": {
          "path": "/private/intake/original-package.json",
          "kind": "source"
        },
        "registry": {
          "path": "/private/intake/registry.json",
          "kind": "registry"
        },
        "review": {
          "path": "/private/intake/review-decisions.json",
          "kind": "decisions"
        }
      }
    }
  }
}
```

Replace the example UUID with the original publisher UUID. File kinds are
`source`, `registry`, `capture`, `transport`, `decisions` and `handoff`. A declared
`sha256` pins the complete selected file. Paths are host configuration; remote
tool arguments select an alias and file handle.

Initialize the original provider with the maintained provider command:

```json
{
  "directory": "/private/publisher-merchant",
  "connection": "/private/publisher-workspaces.json",
  "name": "Publisher grants"
}
```

```sh
starforge merchant-providers init publisher-360giving --options /private/publisher-setup.json
```

The setup creates a private merchant configuration, its original release store,
and complete customer-export storage. Repeating it with the same directory and
intent reopens that setup. An existing shared release store can be supplied as
`releaseStore`.

A native host starts the maintained merchant server with that configuration and
its selected bearer-token environment:

```js
import {startMerchantMcp} from './stellar-forge/mcp-merchant-operator/serve.mjs';

const merchant = await startMerchantMcp({
  configPath: '/private/publisher-merchant/merchant-mcp.json',
  port: 3211,
  tokenEnv: 'PUBLISHER_MCP_TOKEN',
  environment: process.env
});
console.log({endpoint: merchant.url});
// Retain the same server owner, and await merchant.close() during shutdown.
```

The source-owned `publisher-360giving` declaration supplies its metadata,
configuration reader, runtime, request limits, instructions and initializer.
The distribution selects its complete implementation through the existing
provider registry.

## Agent tools and complete file delivery

| Tool family | Work |
| --- | --- |
| `workspaces`, `status`, `inventory` | Declared publishers, original identities and every saved/native inventory page |
| `upload`, `upload_text` | Complete declared source files or a small original UTF-8 document |
| `review`, `intake`, `decisions`, `candidate`, `build` | Original publisher source and named review workflow |
| `query`, `compare`, `changes` | Native grant queries and complete comparison paging |
| `request`, `resume` | Read or continue the original admitted work |
| `export`, `changes_export` | Retain the complete native ZIP or changes NDJSON |
| `exports`, `manifest`, `file`, `file_release` | Retained inventory, source-bound manifests and verified complete file transfer |
| `receive` | Receive a declared complete handoff or a retained export into a saved publisher |

Every tool name begins `merchant_360giving_`. A later inventory page repeats the
returned `snapshot` as `expectedSnapshot`. Page zero establishes a new snapshot
when the underlying publisher inventory changes.

A complete export retains the entire original native request, publisher UUID,
source selection, ZIP byte count and SHA256 in a canonical manifest. Changes
exports retain the entire original comparison and its complete NDJSON identity.
Retained files stay readable after the publisher stops, and after the merchant
reopens from the same configuration and export store.

The typed merchant client fixes each call and download checkpoint to one
configured alias:

```js
import {
  open360GivingMerchantClient,
  download360GivingExport
} from './stellar-forge/mcp-merchant-operator/360giving-download.mjs';

const client = await open360GivingMerchantClient({
  workspace: 'publisher',
  url: process.env.PUBLISHER_MCP_URL,
  tokenEnv: 'PUBLISHER_MCP_TOKEN'
});
try {
  const selection = {
    requestId: 'fund-october-export',
    edition: process.env.PUBLISHER_EDITION
  };
  let exported = await client.export(selection);
  if (exported.request.status !== 'complete') {
    await client.wait(selection.requestId);
    exported = await client.export(selection);
  }
  const delivery = exported.delivery;
  const completed = await download360GivingExport({
    client,
    exportId: delivery.exportId,
    expectedManifestSha256: delivery.manifestSha256,
    directory: '/private/customer/original-publisher-delivery'
  });
  console.log(completed);
} finally {
  await client.close();
}
```

`request` alone reads the native record. Repeat `export` with the original ID and
input once it is complete to retain its full-file delivery. The native export
itself remains the same saved work.

The shared downloader reads the complete canonical manifest, streams verified
chunks, saves durable prefixes, and publishes every complete file. Reuse the
same directory, alias, endpoint and export identity after interruption. It
verifies the retained prefix before continuing, reacquires a lost read handle
under the same file SHA256, and checks every completed file again on reopen.

For another configured saved publisher, receive the complete retained export:

```js
const receiver = await open360GivingMerchantClient({
  workspace: 'receiver',
  url: process.env.PUBLISHER_MCP_URL,
  tokenEnv: 'PUBLISHER_MCP_TOKEN'
});
try {
  const admitted = await receiver.receive({
    requestId: 'receive-original-fund',
    fromWorkspace: 'publisher',
    exportId: process.env.PUBLISHER_EXPORT_ID
  });
  const completed = await receiver.wait(admitted.request.id);
  console.log(completed.request.result);
} finally {
  await receiver.close();
}
```

The receiver can also select a declared `handoff` file. Both paths upload the
same complete archive to the original receiver and use its native receiving
operation. Publisher source, named reviews, candidates, native packages and
portable source remain in that complete handoff.

## Run the complete installed receiving workflow

The maintained command extends the original managed receiving owner. Use an
installed READY runtime containing this contribution and an existing complete
publisher workspace. Choose a new private directory for the combined workflow,
then retain that exact input and directory for every continuation.

```json
{
  "schema": "stellar-forge.360giving-agent-receiving-input.v1",
  "runtimeDirectory": "/private/starforge-runtime",
  "sourceWorkspace": "/private/original-publisher",
  "pythonExecutable": "/private/schema-runtime/bin/python",
  "directory": "/private/complete-agent-receiving",
  "label": "Publisher complete agent receiving",
  "timeoutMs": 240000,
  "pollMs": 500,
  "queryPageSize": 250
}
```

```sh
starforge dataset-360giving-agent-receiving --input /private/agent-receiving-input.json
```

The original Applications owner saves and connects source and receiving
publishers, exports every saved edition and review/candidate selection, retains
all native builds and comparisons, and cold-reopens both publishers. Its four
connected stages add the complete client and merchant work:

1. On the original source run, both clients read every inventory and named
   review. Complete declared objects are uploaded and checked against their
   original IDs. Completed intake, decisions, candidate, build and comparison
   requests are reached through their same native IDs and exact inputs.
2. Every original handoff and complete comparison file is retained through the
   merchant. A handoff transfer is interrupted after a durable prefix. The
   original merchant listener closes and reopens on the same endpoint, and the
   same download directory resumes to the complete file.
3. Both clients query every native build through every cursor and read every
   comparison page. Exact row content is retained, and the complete comparison
   file is parsed with the same exact-number parser to compare all paged changes.
4. The source publisher cold-reopens through its saved application. Both clients
   repeat the complete observations using the replaced saved connection.
5. With the source publisher stopped, its retained exports remain available.
   The receiving publisher reaches each original receive ID through both a
   retained export and its complete declared download, then repeats every native
   observation and comparison.
6. The receiving publisher cold-reopens. Complete files and native observations
   are read again under the original source and receiving identities.

The combined workflow uses one parent receiving journal and the same saved
Applications. The selected connection workflow is part of that journal's
original input. Its stage callbacks run before the parent stage is committed,
so an interrupted client/merchant stage continues with the same parent
operation. An already completed managed-only directory keeps its own original
input; select the combined workflow when preparing the complete following run.

`agent-publisher-result.json` links the original managed result, saved
applications and runs, every delivery and complete local file, the interrupted
and resumed prefix, and all four complete observations. The private
`agent/agent-journal.json` retains the merchant endpoint, source file handles,
export selections and continuation state. The final managed owner stops the
saved publisher runs and closes its original runtime workspace.

The native publisher's portable source selection includes the Node client,
its declaration and the existing exact JSON parser. The contribution declares
the dynamic merchant setup/runtime files and the complete receiving command so
the same source is present in the installed customer runtime.
