# Install and receive the native analysis viewer

This deployment opens the original Helgoland 2.2.3 static application against a selected, retained SensorThings analysis version. The existing SensorThings workspace owns source intake, review, immutable versions, operations, publications and file receiving. The deployment reads that state and serves the selected native viewer. Its installation does not create another observation service, credential store or source capture.

Use the complete composed SensorThings source, including the existing Operations Desk, the analysis core and analyst UI, the native viewer importer, this deployment directory, the original client/downloader and the upstream source manifest. The full [analysis guide](../ANALYSIS.md) explains selection, annotation, comparison and publication. The [native operating guide](../../SENSORTHINGS.md) and [distribution guide](../../DISTRIBUTION.md) retain the existing workspace and managed-client instructions.

## What is installed

The importer accepts the original **helgoland-complete.zip** release asset, declared by the publisher as 3,687,093 bytes, from the host-selected source inbox. The release is pinned to Helgoland v2.2.3 and commit a17117b955d3453af0cfc056be012ded507426b0. The exact received archive SHA-256 must come from the actual original bytes; the application does not claim an unobserved publisher hash.

The complete original archive and every selected asset are retained in the workspace's existing content-addressed storage. The original upstream source and license files are also retained, including **source-manifest.json byte for byte**. The original Helgoland LICENSE and README identify Apache 2.0 while its package metadata says MIT. Both declarations remain available with the source; this installation does not replace one with the other.

The runtime derives only the following connection material:

| Material | Purpose | Identity |
|---|---|---|
| Served index | Gives the native application its selected base path and a visible saved-selection caption | Separate exact length and SHA-256 |
| Configured settings | Points the existing native SensorThings connector at this saved version's retained endpoint | Separate exact length and SHA-256 |
| Connection script | Adds the existing registered analyst frame's headers to permitted original XHR requests | Source file length and SHA-256 |
| Original archive and assets | Native viewer implementation and original source record | Their unchanged received hashes |

The release is a complete static build. Running it does not require rebuilding its older Angular/Node toolchain. Use the supported Node runtime and dependencies of the complete maintained SensorThings SDK for the existing workspace and listener.

## 1. Select the original installation

Keep the current workspace UUID, original source-inbox directory, existing operation history and selected source editions. An already running Operations Desk owns that workspace's writer. Use its current private connection and managed client while it runs; starting another listener or opening a one-shot writer against the same directory is not a connection repair.

Before installation, obtain these actual values from the original owner or current workspace:

- The complete application/source pin and its absolute installation path.
- The existing workspace directory and UUID.
- The original source-inbox directory and the complete release file.
- The original release's observed byte count and SHA-256.
- The operator's attribution, selected edition and exact scalar stream keys.
- The existing private session or host-selected listener configuration.
- The required publication/receiving destination and the original operator responsible for its acknowledgement.

Keep the release as the same selected original file. Do not substitute a current GitHub branch archive for the pinned release asset, silently unpack a different build, or use a newly captured source to repair a missing retained edition.

The importer accepts one exact flat filename from the host-bound inbox. It verifies the held archive descriptor and full SHA before parsing. It bounds the central directory, each member and total expansion; checks original local headers, data descriptors, CRC and byte ranges; rejects overlapping or ambiguous paths, unsupported special files and nonempty directory entries; and verifies each original upstream source against the retained manifest. It uses the existing object store and original operation, with no standalone extraction directory.

## 2. Import through the existing action

Use the original action **analysis.viewer.import**. The request has the same four outer fields as every maintained SensorThings action:

```js
{
  operationId: originalImportOperationId,
  expectedRevision: currentWorkspaceRevision,
  action: 'analysis.viewer.import',
  payload: {
    filename: 'helgoland-complete.zip',
    expectedSha256: observedArchiveSha256,
    expectedBytes: 3687093,
    actor: operatorName
  }
}
```

These names stand for actual current values. Save the exact request before sending it, and keep that operation ID and body if the response is interrupted. On completion the existing core records the immutable viewer ID and manifest object in analysisViewers. Repeating the same original request recovers its existing result through the original operation implementation.

For a stopped workspace, the maintained one-shot CLI accepts the saved JSON request:

```bash
node /absolute/sdk/sensorthings/cli.mjs action \
  --workspace /absolute/private/original-workspace \
  --source-inbox /absolute/private/source-inbox \
  --input /absolute/private/viewer-import.json
```

For a running workspace, use its existing analyst action or the original managed connection. The action does not accept a caller-chosen arbitrary filesystem root; the host's source-inbox binding remains authoritative.

If the response is lost, read the original operation first. The existing direct CLI exposes **operation --workspace DIRECTORY --id ORIGINAL_ID** when the workspace is stopped. The running listener exposes its original operation read and the analyst UI retains pending request recovery. A changed current revision is a reason to inspect the original result and current state; it is not permission to invent a replacement import.

## 3. Save the viewer in the analysis version

A native frame is bound to an immutable analysis version. The version's **selection.viewerId** must equal the installed viewer ID in its URL. Save that choice through the original create/revise action before opening the frame.

The retained selection includes the exact source edition, one to twenty scalar Datastream keys, the selected period or null, the view choice and the source time policies. A period uses explicit offset-qualified start and exclusive end. The original time strings are retained alongside their normalized comparison values. Missing or unresolved source times remain visibly unplaced.

Use **analysis.create** for a new named analysis and **analysis.revise** with its exact projectId/baseVersionId for a later choice. A revision must preserve its attributed reason. Do not edit an old version or silently switch its viewer when another archive is installed. The original project head and prior views remain available.

The viewer supports a map and a numeric diagram under separate explicit paths. Those paths do not change the saved selection. The analyst's literal event lanes remain the appropriate representation for categorical observations. A scalar stream is not automatically numerical: the maintained numeric eligibility rule checks the actual original JSON number, declared numerical observation family, explicit instantaneous phenomenonTime, finite browser range and integral count semantics.

The Hamburg retained source is categorical. Its native map and literal analyst timeline can be inspected without assigning invented numeric values or claiming continuous station uptime. A numeric diagram uses a separately retained, explicitly selected eligible source such as the original BGS pressure window when that original intake exists. Source dates, identifiers, units and review history remain those of the selected edition.

## 4. Start the original listener without printing its token

If the original Desk is stopped, the deployment launcher delegates its existing CLI and lifecycle:

```bash
node /absolute/sdk/sensorthings/analysis/deployment/launch.mjs serve \
  --workspace /absolute/private/original-workspace \
  --session-file /absolute/private/operator-url.txt \
  --source-inbox /absolute/private/source-inbox \
  --expected-workspace-id ORIGINAL_WORKSPACE_UUID \
  --host 127.0.0.1 \
  --port 8879
```

The port is an explicit operator choice, not a new session identity. The existing session-file parent must already be the selected private directory. The original CLI writes that file with its normal private-file checks. The launcher prints only the origin, workspace UUID, process ID, session-file path and analysis path. It never copies the private URL or Bearer token into the startup record.

Open `/analysis/` on the selected private URL’s same origin and preserve that URL’s existing fragment in the private browser address. The optional original Desk may provide an Analysis link; a plain CLI listener can instead show only a status message at `/`. The analyst entry uses the same retained session in either case. This launcher creates no new authentication protocol, cookie, handshake or writer; it calls the maintained SensorThings CLI. Its normal stop signals drain the same listener.

The original CLI remains available unchanged. Its normal serve startup record contains a private URL, so keep that original record in its private operating context. The new launcher is the convenient choice when the startup output will be retained in an ordinary deployment log.

## 5. Open the selected native frame

The analyst UI must register its actual iframe before assigning the frame's src. It exposes the existing synchronous parent function:

```js
window.sensorThingsAnalysisHeaders(frameWindow)
```

Only its registered same-origin iframe.contentWindow may receive the current Bearer and X-SensorThings-Workspace headers. The function must not return credentials to arbitrary windows. The native frame does not retain a token literal.

The original pre-bootstrap settings XHR is redirected to the selected protected settings route. The connection script then adds the existing parent headers only to same-origin **/api/analysis/** reads, restricted to this saved version's retained SensorThings endpoint and configured settings. It does not forward credentials to an upstream provider, another origin or another saved version. Opening the frame as an unrelated top-level page cannot obtain the parent session; it displays a connection message directing the operator back to the current analysis workspace.

The native static paths are:

```text
/analysis/viewer/VIEWER_ID/VERSION_ID/map/timeseries/map-selection
/analysis/viewer/VIEWER_ID/VERSION_ID/numeric/timeseries/diagram
```

The derived caption identifies the selected saved version and native mode. The source archive and original index do not acquire this caption or connection configuration.

The settings retain the pinned application's ordinary language/configuration fields while replacing its data API list with the selected retained endpoint. Demo-provider URLs, a public proxy and unrelated basemap configuration are not configured for this local source view. The native map uses actual retained source geometry; absent geometry is not supplied. Its expanded source uses the first original Thing Location, without asserting that it is the location of every observation.

Use the native viewer's actual time controls for the selected historical interval. Verify its displayed start/end and selected source stream before recording output. A current-time default or an empty plot is not evidence that the retained source has no observations. The retained endpoint applies the saved source selection and the native request's supported explicit filters; it does not rewrite a requested current interval into a historical one.

## 6. Inspect original and derived identities

The following reads belong to this adapter:

| Read | Result |
|---|---|
| GET /api/analysis/viewers/VIEWER_ID | Complete immutable installed viewer manifest |
| GET /api/analysis/viewers/VIEWER_ID/VERSION_ID/MODE/deployment.json | Exact selected binding, availability, original files and runtime-derived identities |
| GET /api/analysis/viewers/VIEWER_ID/VERSION_ID/MODE/settings.json | Plain configured native settings |
| GET /analysis/viewer-bridge.js | The installed connection script |
| GET /analysis/viewer/VIEWER_ID/VERSION_ID/MODE/... | An exact retained native asset or the labelled derived application entry |

The parent listener authenticates every deployment API call through its existing Bearer/workspace checks. Static assets are selected through the original viewer manifest and object reader, never by joining a requested URL to a filesystem directory. Missing JavaScript or stylesheet assets produce an asset error, not an HTML fallback. HEAD reads preserve the actual byte-length metadata.

The deployment descriptor contains:

```js
{
  id, schema, workspaceId, origin,
  viewerId, versionId, projectId, editionId, mode,
  selection,
  paths: {base, entry, settings, metadata, sta, bridge},
  availability: {map, numeric, selected},
  original: {viewerId, archive, index, settings, upstream, upstreamSources},
  derived: {index, settings, bridge},
  sourceScope, sourceIssues, license, connection, derivation
}
```

Each original or derived file descriptor carries its length and SHA-256. The original viewer ID is the canonical identity of the retained manifest body. The deployment descriptor's own ID additionally binds its current original workspace/origin and derived connection material. A receiving installation can therefore preserve identical original/viewer/version hashes while observing a different legitimate deployment ID after its own workspace/origin is selected.

Availability describes native configuration eligibility, not a claimed browser run. Numeric availability reports the actual eligible row count. Each mode also exposes the saved native metadata checks and exact source issues. An explicit incompatibility in the original IDs, units or required relations prevents that expanded native configuration. Older saved summaries without the additive metadata check are marked unchecked; actual native projection errors remain explicit. The metadata route remains readable so the operator can understand an unavailable view.

The preserved [TypeScript contract](server.d.mts) describes these fields. HTTP or CLI diagnostics must retain the exact error and source/version context without copying private session headers into publication evidence.

## 7. Record actual output and review a later edition

Record a native screenshot or exported output only after the real frame has completed its selected source request. Save the observed viewer/version/mode, deployment descriptor, selected native stream and displayed time interval with that file. An analyst-rendered event lane is labelled as analyst output; it is not renamed as a native Helgoland screenshot.

Use **analysis.evidence.import** to retain the actual file from the same host-bound inbox. Its request binds projectId, baseVersionId, filename, expectedSha256, expectedBytes, title, actor and note. The original core copies the file into its existing immutable export/evidence path. A new source or changed analysis version does not inherit a claim that a screenshot was taken for that new version.

For a later retained source edition, use the original compare action. Keep its explicit left/right edition IDs, source occurrence keys, duplicate/unkeyed rows and limitations. Observed differences do not by themselves prove provider deletions or an atomic snapshot. A new analysis revision can select the later edition after operator review. Prior views, annotations, comparison and publication history remain intact.

Review source evidence through the original source-review action. Publication requires the current accepted review for that exact source edition and the current intended project version. Attributed annotations remain interpretations alongside the unchanged provider records. Neither a native render nor a receiving acknowledgement is scientific approval of source quality.

## 8. Publish and receive through the original file engine

Use the original **analysis.publish** action with the exact projectId/baseVersionId, title, actor, note and selected comparisonIds/evidenceIds. Its publication is frozen by the maintained core and publication module. The complete publication includes the selected data, analysis brief, source/selection manifest, exact current source review and explicitly supplied actual viewer evidence.

Inspect and download through the existing manifest-bound file selector:

```json
{
  "kind": "analysis",
  "id": "ORIGINAL_PUBLICATION_EXPORT_OR_VIEWER_ID"
}
```

A file field may select one exact displayed filename. Omitting it keeps the original file-list behavior. Do not supply an arbitrary output member path as a substitute for an existing manifest entry.

The maintained managed client now supports analysis reads and analysis file selections. Reuse the original command surface:

```bash
node /absolute/sdk/sensorthings/cli.mjs inspect-download \
  --config /absolute/private/connection.json \
  --alias ORIGINAL_WORKSPACE_ALIAS \
  --selection /absolute/private/publication-selection.json

node /absolute/sdk/sensorthings/cli.mjs download \
  --config /absolute/private/connection.json \
  --alias ORIGINAL_WORKSPACE_ALIAS \
  --selection /absolute/private/publication-selection.json \
  --directory /absolute/private/received-publication \
  --expected-manifest-sha256 ACTUAL_INSPECTED_MANIFEST_SHA256 \
  --export-id ORIGINAL_RECEIVING_EXPORT_ID \
  --progress
```

Keep the same connection alias, original workspace UUID, selector, manifest SHA and export ID after an interrupted download. The existing receiver owns held-file reads, exact file verification and its receiving journal. A read ID belongs to its original process; after it closes, continue the same selector/hash/offset through the supported reader rather than inventing a new source.

If the destination supplies an acknowledgement, retain those actual bytes through **analysis.receipt.import** against the original publication ID. Its actor/note and assertions remain distinct from this installation's file verification. A complete local download confirms the received bytes; it does not manufacture an external recipient's decision.

The original archive and upstream source/license files are downloadable through the same file engine with the installed viewer ID. This deployment adds no parallel archive transport.

## 9. Export the complete selected project and reopen

The original **analysis.export** action freezes the selected project's complete native snapshot. It retains every included immutable version and summary, source editions and original reviews, comparisons, actual evidence, publications and receipts, installed viewer manifests, original archive/assets and source/license objects. Its complete portable file goes through the same retained downloader.

This is the complete selected analysis project. Existing capture workers, unrelated projects and supplier/payment journals retain their original operating owners. They are not silently merged into another workspace by receiving a project archive.

At a receiving installation, keep the actual downloaded archive and its verified SHA/length in the selected source inbox. Use the original **analysis.import** action once with its retained operation ID. The importer verifies the complete original closure before publishing received state. If the project already exists, retain the current local head and imported history according to the maintained import result; do not overwrite a locally advanced analysis to make a source ID appear current.

Imported source reviews remain original evidence. The receiving workspace explicitly records any required local review. The viewer archive, version IDs, original objects and prior publication history retain their original hashes. Only this new workspace's runtime origin/session and derived deployment descriptor change.

Reopen the same saved version in a fresh native frame, read its deployment descriptor, verify the original viewer/archive/source/selection identities, and inspect the actual native map or eligible diagram. Save the receiving result with the original import/export IDs. Do not recapture upstream observations merely because the current process has restarted.

## Native selection and historical time on reopen

Use the deployment descriptor’s complete `paths.entry`, including its query. The pinned Helgoland [diagram permalink](https://github.com/52North/helgoland/blob/a17117b955d3453af0cfc056be012ded507426b0/src/common/timeseries/diagram/diagram-permalink.service.ts) restores `ids` and `time`; its [original internal-ID handler](https://github.com/52North/helgoland-toolbox/blob/ddd2b20f40ddd5fc80084f8d336644a06d53a484/libs/core/src/lib/dataset-api/internal-id-handler.service.ts) binds each original client ID to the selected retained API URL. The deployment uses those native parameters for eligible numeric streams. A fresh diagram therefore opens the selected historical period rather than relying on the viewer’s previous browser cache or current-week default.

`nativeNavigation` records the exact source/client IDs, derived native IDs, original UTC bounds and displayed epoch-millisecond range. The display starts with the explicit saved period, or the saved source summary’s extent when no period was selected. Its endpoints round outward to the native millisecond resolution; a single exact instant receives a one-millisecond display width. This describes the viewport only. It does not rewrite source timestamps, add an observation, establish a validity interval or claim interpolated measurements. IDs that collide or cannot be represented by the original permalink remain explicit native-view findings, while the complete original analysis stays available.

## Recovery reference

| Observation | Continue the original workflow |
|---|---|
| Import/action response is uncertain | Read the retained operation; retry its exact original body only through supported same-ID recovery |
| Viewer ID differs from the saved version | Save an explicit new analysis revision with the selected viewer through the original core |
| Numeric view is unavailable | Read eligible counts and source reasons; retain category/interval events without coercion |
| Native metadata is incompatible | Review the exact retained IDs, required relations and units; keep the source edition unchanged |
| Frame lacks the registered parent | Reopen it through the existing analyst workspace and current session |
| Original asset or object fails its hash | Preserve the failed identity and restore the exact original object/source through its maintained owner |
| Download response is interrupted | Continue the original selector, manifest and receiver export ID |
| Received project already exists | Read the import result and current local head; preserve both histories |
| Listener is stopping | Let the original owner drain it; the deployment closes only its own pending reads |

## Integration and execution ownership

The existing listener mounts createAnalysisDeployment({workspace,origin}). Its staticHandler runs before the maintained static fallback. Its handleApi is called only after the parent has checked the original session and workspace header. Both receive the already parsed URL and actual workspace UUID. They return true when the adapter handled a request and false for another owner's path.

The adapter has no timer, child process, state mutation or background importer. close waits for its own pending responses and does not close the parent workspace. A native browser/receiving continuation uses the same stopped original intake handoff, one owned listener, the existing session and original publication/downloader APIs. It must return observed IDs, file hashes, actual screenshots, receiving result and fresh-process reopen; source validation alone is not reported as that completed native journey.

## Original source references

- [Helgoland v2.2.3 release](https://github.com/52North/helgoland/releases/tag/v2.2.3) and [complete original static asset](https://github.com/52North/helgoland/releases/download/v2.2.3/helgoland-complete.zip).
- [Pinned Helgoland source](https://github.com/52North/helgoland/tree/a17117b955d3453af0cfc056be012ded507426b0), including its original README, LICENSE and package metadata. Their exact retained files and hashes are listed in the installed viewer’s upstreamSources.
- [OGC SensorThings API Part 1: Sensing 1.1](https://docs.ogc.org/is/18-088/18-088.html), used by the maintained source parser and retained native connector projection.

These references identify implementation/source editions. They do not assert that a publisher example is customer data or that a configured viewer has already run.
