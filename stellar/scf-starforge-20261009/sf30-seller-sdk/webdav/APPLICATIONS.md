# WebDAV in managed Applications

Use the maintained runtime workspace's **WebDAV source and merchant workspace**
entry to review, start, open, stop and reopen the original private WebDAV product.
The application retains the same source records, captures, mappings, editions,
merchant exports, publisher and customer history used by the original CLI and
browser. The existing managed controller owns launch history and recovery.

## Select the original workspace

Use a completed maintained merchant runtime containing this source and the
matching Applications registration. Its original native/operator profile supplies
Node, Python, flock and the selected original merchant dependencies. See the
[whole runtime installer](../../distribution/RUNTIME_INSTALL.md).

Prepare a new source workspace with the original WebDAV serve command, or import
an existing source packet with the [source receiving workflow](README.md#portable-source-packets-and-new-host-reopening).
The managed entry selects that already initialized private directory.

For a new workspace:

~~~sh
starforge webdav serve --directory /absolute/private/webdav-workspace --port 0
~~~

Use the original browser to save its collection and authoring decisions, then
stop that instance with Ctrl+C. In the existing runtime workspace, select the
ready runtime and open **Applications**. Choose **WebDAV source and merchant
workspace**, enter the original workspace directory, review and save the entry.

| Field | Selection |
| --- | --- |
| Original private WebDAV workspace | Existing canonical private directory containing its original workspace.json |
| Original Python executable | Optional absolute canonical executable; empty uses python3 from the selected managed environment |
| Port | Original operator listener port; zero selects an available local port |
| Private environment file | Existing managed environment input supplying only the source's named host references |

The source declaration stores environment variable names. Authentication values
remain in the selected host environment. The complete original [API contract](API_CONTRACT.md)
documents the source declaration, collection, transfer and native publisher inputs.

The original MCP companion opens one WebDAV server and workspace for its browser
and 18 tools. To switch that retained workspace into this Applications entry,
stop its existing owner and select the same directory. The native writer lease
then transfers through ordinary close/open. Use the original MCP host when the
browser and MCP tools should share its one running instance; this Applications
entry does not attach a second writer to a running workspace.

## Review and start

Review pins:

- the actual canonical source workspace directory;
- the original workspace UUID and creation identity;
- the selected complete runtime and its original manifest/dependency lock;
- all 14 owned executable WebDAV source files, including the original browser
  and Python source-packet/XML entrypoints;
- an explicit Python executable and private environment file when selected.

Normal edits change the original workspace revision and bytes. They do not
change its UUID or creation identity, so later Start can reopen those edited
records. Replacing the selected workspace with another identity requires a new
review.

Press **Start**. The maintained command invokes the original WebDAV serve path.
That path verifies the selected and actual launched source and checks the
workspace binding under its original writer lease before initial state or source
directories can be created. A different workspace or changed source returns a
specific native binding error before the service becomes ready.

The native CLI prints one compact JSON startup record. The existing serialized
startup observer checks its workspace/source/instance identity and exact loopback
port before offering **Open**. The page is the same seven-view operator product:
source connection, files, captures, projection, dataset/merchant, publisher/customer
and handoff/history.

The server's original Host, Origin and workspace-token checks remain in use.
Default HTTP port 80 is serialized using the native URL origin, so the browser's
own Origin and the server's Host validation agree.

## Operate and stop

Continue the original source/capture/edition/merchant workflow in the opened
page. The command uses the same original operation UUIDs, conditional file
transfers, publisher generations, buyer sessions and downloads. A request with
an uncertain response remains an original retained intent; use its existing
operation readback and continuation controls.

Use **Stop** in Applications. The original controller signals only its owned
child. WebDAV close cancels active source requests, drains accepted operations,
closes only publisher instances it opened, waits for their original shutdown and
releases the native workspace lease. Reopen the same saved application to retain
its source decisions and history.

A lost managed Start or Stop response is handled by the original operation's
Inspect/Resume/Recover controls. Retain that original managed operation and its
child identity while reconciling it. The WebDAV source workspace remains its
separate original operation authority.

A listener restart has a new instanceId and PID. Its original workspace UUID,
creation identity, source editions and native publisher history remain retained.
An old readiness record cannot identify the newly launched instance.

## Receiving on another host

1. Create the original source packet from the running WebDAV Handoff view.
2. Use the original import-source command to create a new private destination.
3. Select that received directory in a new reviewed Applications entry.
4. Start and open its retained sources and native edition.
5. Prepare a retained merchant export through the original publisher at that host.

The receiver has its own workspace UUID and empty active publisher index.
Original source/capture/mapping/edition/merchant/export records and exact incoming
projection remain retained. Existing seller, buyer, keys and ledger directories
stay with the original host's normal native backup; the full [receiving guide](README.md#portable-source-packets-and-new-host-reopening)
describes that split.

## Maintained integration contract

The additive helper is
`distribution/runtime-workspace/application-webdav.mjs`:

~~~js
webdavApplication(common);
await prepareWebDavApplication(settings, { inputPath, runtimeDirectory });
await webdavStartup(request, text);
~~~

The catalog ID and original command are both `webdav`. The helper returns the
original argument array, pinned input records, an empty createDirectories list
and the stable workspace binding. Port and environment inputs use the common
Applications preparer. The startup observer returns `{url, original}` for the
original serialized managed-operation observer.

The native `managed.mjs` exports:

~~~js
await inspectWebDavWorkspaceBinding(directory, {
  expectedWorkspaceId,
  expectedWorkspaceIdentity,
});
await inspectWebDavLaunchSource(sourceDirectory, { expectedSha256 });
~~~

These inspections are read-only. The workspace binding hashes its schema,
original UUID and createdAt. The source identity hashes the ordered per-file
names, byte lengths and SHA256 values. The source must be regular and canonical;
files that change while read are rejected. The 14-file product pin complements
the complete selected runtime's original source manifest.

A managed native launch uses the complete bound argument set:

~~~sh
node cli.mjs serve --directory /absolute/private/webdav-workspace --port 0 \
  --expected-workspace-id ORIGINAL_UUID \
  --expected-workspace-identity REVIEWED_SHA256 \
  --managed-source /absolute/selected/source/stellar/scf-starforge-20261009/sf30-seller-sdk/webdav \
  --expected-source-sha256 REVIEWED_SOURCE_SHA256 \
  --startup-format json
~~~

All five binding/format options are required together. The CLI compares the
reviewed source with the actual source from which it is executing, then opens
the original workspace under the expected identity. Ordinary unbound serve,
CLI, JavaScript and existing MCP calls retain their original interface.

The compact record begins with schema `stellar-forge.webdav-startup.v1` and
status `WEBDAV_OPERATOR_READY`. It includes url, directory, workspaceId,
workspaceIdentity, createdAt, sourceDirectory, launchSourceDirectory,
sourceSha256, sourceFiles, revision, pid and instanceId. The actual server health
endpoint includes workspaceId, createdAt, revision, pid and instanceId. Neither
readiness surface contains the page's private request token or source credentials.
