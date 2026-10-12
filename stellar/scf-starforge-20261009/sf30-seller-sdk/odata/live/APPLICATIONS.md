# OData in Applications

The OData card opens the original source workspace. Operators can connect a
service, inspect its declared schema, save and review a typed query, retain source
editions, prepare a live merchant, create the original buyer handoff, and receive
saved responses in that same workspace. An optional saved live service starts
with the workspace; managed Stop closes its merchant and operations listeners.
Reopening uses the original package and private runtime directory, including its
continuation key, operations history and delivery outbox.

## Original controller registration

`applications.mjs` in this directory exports:

| Hook | Native contract |
| --- | --- |
| `odataApplication(common)` | One `odata` catalog entry, original `dataset` command, shared port and private environment fields. |
| `prepareODataApplication(settings, context)` | Context supplies the existing `inputPath`, `runtimeDirectory`, and may include `selectedExecutable`, `root`, `runtimeId`. Returns `args`, `inputs`, `createDirectories`, and `identity`. |
| `odataStartup(request, operationDirectory, text, context)` | Async startup reader; the existing managed child context supplies `pid`. Returns `{url, original, links}` for the original Applications output record. |

In `distribution/runtime-workspace/applications.mjs`, import the catalog and
preparation functions from `../../sf30-seller-sdk/odata/live/applications.mjs`.
Add `odataApplication(common)` to the original catalog. The `type.id === 'odata'`
branch appends the returned `args`, `inputs`, and `createDirectories`; the common
port/environment handling remains in its current location. The returned identity
is useful for the review view; the original argv also pins the same identity, so
the existing request format already carries it through the managed worker.

In the existing `observeApplicationOutput` line reader, add an async family
branch for `request.command === 'dataset' && request.args[0] === 'odata'` before
the generic dataset URL extraction. Accept only a line beginning with
`{"schema":"stellar-forge.odata-workspace-startup.v1",`. Queue
`odataStartup(request, directory, text, context)` on its existing `saving`
promise. Save the returned `url`, `original`, and `links` in the same
`stellar-forge.application-url.v1` record used by the original event family.
The managed command already passes `{pid: child.pid}` to this observer.

## Original OData CLI and server joins

The original `odata/cli.mjs` serve branch uses these helpers from
`./live/startup.mjs`:

```js
const launch = await prepareODataLaunch({
  workspace,
  expectedIdentity: o['expected-workspace-identity'],
  liveId: o['live-service'],
  expectedLive: o['expected-live-identity'],
});
const server = await startODataServer({
  workspace,
  port: o.port === undefined ? 8797 : Number(o.port),
  liveServiceId: o['live-service'],
});
console.log(JSON.stringify(await announceODataWorkspace({
  workspace, server, launch, liveRuntime: server.liveRuntime ?? null,
})));
```

The original `startODataServer` adds `liveServiceId` to its options. After its
own loopback listener is ready, it starts that optional service through the same
`getLive()` manager used by `/api/live/start` and returns its `liveRuntime`.
On a startup error, it closes that same server and live manager. Its existing
`close()` still owns merchant drain, workspace close and listener close.

Under the existing Host/Origin checks, GET `/api/application` returns
`await odataWorkspaceProbe(workspace)`, imported from `./live/startup.mjs`.
This small response contains the original workspace creation identity and
running process identity. The Applications reader calls this actual listener
once; it does not download the complete catalog or retained row state.

## Operator selection and receiving

Applications settings are `workspaceDirectory`, optional `liveServiceId`, and
the original common `port`/`environmentFile`. A new private workspace may be
created in an existing private parent. To start a saved service automatically,
use its existing service ID; its source package must already be prepared in
that workspace. The source operator retains all other authoring, start/stop,
buyer and response receiving controls in its original browser UI.

The emitted command is:

```sh
starforge dataset odata --workspace /private/odata serve \
  --expected-workspace-identity WORKSPACE_IDENTITY_SHA256 \
  --live-service orders --expected-live-identity LIVE_IDENTITY_SHA256 --port 0
```

An application with no selected live service opens authoring immediately. A
selected service adds original merchant documentation and operations links to
the Applications view. New live services started from the workspace remain
available through the original OData UI.

Saved-query authoring calls `templateFromWorkspace(workspace, {planId, ...})`
before applying the operator's price, path and port settings. Its declared
output columns, filter/order allowlists, exact saved filters, source metadata
and original `authEnv` reference survive `prepareFromWorkspace` and package
readback. The original `prepareBuyerHandoff` writes the same body hash and
response path used by SF88; `receivePage` imports the saved response and retains
the original next request.

For an atomic buyer-directory publication, call
`prepareBuyerHandoff(prepared, {directory: stage, requestDirectory: final, ...})`,
sync the stage, and rename it to the final directory. The original buyer draft
pins `final/request.json` and `final/response.json` while its exact files are
written to the stage. The returned handoff also retains `final` as its request
directory. Omitting `requestDirectory` keeps the ordinary direct-directory API.

## Retained identity

Ordinary workspace edits and received pages update `workspace.json`. The
Applications binding uses its original schema, creation time and private
directory, allowing those edits to continue. A selected live product additionally
pins its immutable profile, complete package, source binding and original
private runtime path. Launch emits one structured line and writes the same
record privately as `application-launch.json`. The startup reader joins that
record with the actual managed child or its direct CLI child, Linux process
start identity, selected local port, and original listener response.

Use the existing `dataset` distribution command and whole SF30 component. The
following installed edition must include this helper, the original CLI/server
joins, and the serial Applications registrations together.
