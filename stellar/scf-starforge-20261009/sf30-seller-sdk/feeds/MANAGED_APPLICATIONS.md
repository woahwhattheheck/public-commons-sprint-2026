# Open retained feeds and subscription collections in Applications

The **RSS, Atom and subscription collections** application opens the same private workspace as the feed CLI. Saved original XML, OPML folders, collection choices, capture progress, reviews, notes and dataset editions remain in that workspace.

## Choose the original workspace

Use an installed runtime that contains the complete feed/collection product and its managed startup. Initialize a new workspace with its existing Python executable:

~~~sh
stellar-forge dataset-feeds --python /absolute/python3 \
  --workspace /private/feed-library init
~~~

An already received feed project or subscription collection is ready to select. The completed collection workflow is described in [COLLECTIONS.md](COLLECTIONS.md).

In the existing Applications console, choose **RSS, Atom and subscription collections**, then select:

| Field | Selection |
|---|---|
| Original feed workspace | Its existing absolute private directory. |
| Existing Python executable | The Python 3.11+ interpreter used for this workspace; virtual-environment paths are retained. |
| Opening page | **subscriptions** for the library/collection console, or **feeds** for the original feed console. The default is **subscriptions**. |
| Local port | **0** selects an available loopback port. A chosen port is checked against the actual startup. |
| Private environment JSON | The existing optional environment input used by the Applications lifecycle. |

Choose **Review**, inspect the original workspace, interpreter and source selection, and **Save** the application. Then review and start its retained run. Applications opens the actual original process after matching its structured announcement with its authenticated local launch endpoint.

The run retains both **Open retained feeds** and **Open subscription collections**. The feed console also returns to a selected collection and acquisition; the collection console opens the original source review or dataset edition. Browser drafts and the original operation IDs remain part of those existing consoles.

## Stop and reopen

Use the existing Applications **Stop** control for the saved run. Its signal reaches the original Python operator: capture cancellation is requested, active requests and the current worker drain, and the original workspace lease closes. Completed source pages and operation results stay retained.

Reopen the saved application and start its next run. The selected opening page returns with its original workspace state. A partial acquisition resumes from the collection's existing run; a complete acquisition replays its original result.

The application binds the workspace directory and database identity, original marker, selected Python environment and the actual feed/XML/dataset/browser source files. Ordinary feed updates, notes and new collection revisions preserve the binding. Moving the workspace, replacing its database, switching Python or selecting another installed source calls for a fresh application review.

The original XML console and the feed console use the same workspace writer. A managed launch shares the current Applications workspace resource with that original writer; stop the existing operation before opening the same directory through the other console.

## Native command and structured startup

Inspect the exact original binding without opening the workspace writer:

~~~sh
stellar-forge dataset-feeds --python /absolute/python3 \
  --workspace /private/feed-library binding
~~~

The returned **sha256** binds the original workspace and execution source. An explicit original launch uses:

~~~sh
stellar-forge dataset-feeds --python /absolute/python3 \
  --workspace /private/feed-library serve \
  --expected-binding BINDING_SHA256 \
  --startup-format json \
  --landing subscriptions \
  --port 0
~~~

The compact startup record has schema **stellar-forge.feed-workspace-launch.v1**, status **FEED_WORKSPACE_READY**, the actual PID, workspace, binding hash, Python/source identity and both private console URLs. The authenticated **/api/launch** endpoint returns that same live record. The original CLI's normal console output remains available through its default startup format.

## Current Applications integration

The additive module is **distribution/runtime-workspace/application-rss-atom.mjs**. The current shared Applications composer uses these hooks:

~~~js
rssAtomApplication(common)
prepareRssAtomApplication(settings, {
  inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment
})
await rssAtomStartup(request, compactLine)
~~~

The catalog ID is **rss-atom**; its existing installed command is **dataset-feeds**. Preparation returns **args**, **inputs** and the original read-only **binding**. Append the common **--port** exactly once. Keep all returned input records in the existing review/save/start comparison; the original Python command checks the selected binding again before opening and after acquiring its workspace lease.

For this application, use the same physical workspace resource as the original XML application. The current shared state-resource mechanism owns save/start conflicts and cross-application reopening.

The serialized output observer calls the startup hook only for **dataset-feeds**. Its result is **{url, links, original}**. Preserve all three fields in the existing application-url.json record with the current application/run identity. The hook reads the original local launch endpoint and checks the returned record before exposing Open. Existing dispatch, saved operations, worker/process ownership, cancellation, recovery and Applications UI remain the lifecycle.
