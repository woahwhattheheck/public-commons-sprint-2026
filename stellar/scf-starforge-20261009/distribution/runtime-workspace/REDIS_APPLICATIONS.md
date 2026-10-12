# Redis and Valkey in Applications

The Redis application creates or reopens the original merchant workspace from a selected READY runtime. Its source connection, products, merchant terms, saved versions, customer packages and release controls remain in that one workspace.

## Select a workspace

Choose **Redis and Valkey merchant authoring** in Applications.

| Setting | Selection |
| --- | --- |
| Redis workspace | The original private directory, or a new directory in an existing private parent. |
| Set up a new workspace | Enable this for a new directory. A later start opens the saved workspace at that same path. |
| Saved connection setup JSON | Optional complete initial setup for a new workspace, containing source, merchant plan and public CA bundles. |
| Local port | Use 0 for an available loopback port, or select the original local port. |
| Private environment JSON | Optional private file containing the host environment names and string values required for live source access. |

For an existing workspace, select its original directory and review its immutable source binding. It can be opened and edited while Redis or its credentials are unavailable. The live preview and release operations resolve the original credential references when they use the source.

For a new workspace, enable **Set up a new workspace** and choose its destination. The destination's parent must already exist and be private. Review, save, connect the selected runtime if necessary, then review and start the application. **Open application** opens the original connection setup browser.

## Create the source and merchant

The setup browser handles standalone Redis or Valkey, Redis Cluster, Redis Sentinel and Upstash REST. It accepts the original source declarations, merchant plan and public certificate bundles, and compiles their complete customer routes before creation.

1. Choose the deployment and its original endpoints. Configure the data and, for Sentinel, monitor credentials by environment reference name.
2. Import or edit the named products and merchant terms. Supply the intended public origin, payment recipient, asset and amounts.
3. Select the data and monitor CA bundles required by the source. Each selected certificate bundle retains its exact bytes and SHA-256.
4. Review the complete draft. Use the original live preview when the source and its host credentials are available.
5. Create the workspace and open its original product editor.

The original initializer writes the workspace identity, connection profile, certificate blobs and setup creation identity into its retained database. The authoring server adopts that already open model and writer lease. Product saves, source reads, customer preparation and release operations then use the same original implementation.

The [connection setup guide](../../sf30-seller-sdk/redis/workspace/SETUP.md) covers source import, the complete JSON shape, deployment settings, certificates, live page continuation and browser recovery.

A complete initial setup can be selected through the ordinary Applications input:

~~~json
{
  "runtimeId": "ORIGINAL_READY_RUNTIME_ID",
  "kind": "redis",
  "label": "Inventory data",
  "settings": {
    "workspaceDirectory": "/private/merchants/inventory",
    "create": true,
    "setupFile": "/private/merchants/inventory-setup.json",
    "environmentFile": "/private/merchants/redis-environment.json",
    "port": 0
  }
}
~~~

The complete setup file contains public source configuration, merchant terms and selected CA certificate text. Private credential values belong in the environment file. The adapter reviews the complete setup through the original compiler and retains its raw input SHA-256; the queued original CLI checks that SHA before using the file. Without a setup file, the original installed templates seed the setup form. Its own review and create actions select the final connection and products.

For a saved workspace, omit `create` and `setupFile`. A saved application that still has those fields reopens the existing workspace and uses its retained source profile.

## What the review retains

A saved-workspace review uses the original read-only SQLite inspector. It reports the workspace ID and source profile digest, topology, original endpoint and credential-reference configuration, and the data and monitor CA fingerprints.

| Deployment | Reviewed source identity |
| --- | --- |
| Standalone | Original host, port, database, ACL reference names and data TLS/CA. |
| Cluster | Original seed endpoints, database zero, advertised address mapping, data ACL references and TLS/CA. |
| Sentinel | Original master name, monitor endpoints, address mapping, data credentials/TLS/CA and separate monitor credentials/TLS/CA. |
| Upstash REST | Original HTTPS endpoint and token environment name. |

The descriptor contains environment names and certificate fingerprints. The private environment values pass to the original child process. A missing live credential leaves offline opening, source review and editing available.

The source profile digest preserves the original binding format. A saved product revision can advance the workspace head between application review and start. The launch retains the immutable workspace and profile pins, and the original writer checks them before recovering operations. Every new start review describes the currently selected workspace.

For new setup, the application review describes its initial connection, required names, query products, customer routes and certificate digests. The setup browser performs the final review over the operator's complete current draft.

## Operate and reopen

**Open application** returns to the original setup or authoring URL saved with its managed run. Within the authoring workspace, edit products and merchant terms, review and save versions, preview the full source response, follow its native continuation input, and prepare customer packages. The original release console stages and operates those packages and exports the complete customer handoff.

Closing the Applications browser leaves its managed process available. Reopen that saved application to return to the same private session.

**Stop application** closes the setup listener, its adopted authoring server and owned release console before releasing the workspace. A fresh reviewed start then opens the saved workspace with a new local session and the same source profile, versions, requests, packages and release store.

The existing application resource lease covers the Redis directory throughout setup and later authoring. The original workspace writer also protects direct CLI or other host use.

## Continue an interrupted setup

The managed setup receives the existing queued operation UUID through `--setup-operation`. Creation retains that operation ID with the original setup ID, browser creation request, reviewed draft digest and selected initial-file SHA.

Applications **Continue** reconnects to the original retained operation. It resumes a queued command that has not launched, reattaches to a still-running command, or reconciles an ended command and its retained output. When the setup process has ended after creating the workspace, use a fresh reviewed **Start** on the same saved application. The existing directory selects `workspace open` with its original immutable workspace and profile pins.

The original setup CLI also supports an explicit continuation of its own creation operation. Repeat `workspace setup` with the same `--setup-operation`, initial file and `--expected-input-sha256`. The setup reads the retained creation identity and matches the operation and input before opening the saved workspace. The original writer checks that identity again under its lease and returns the original setup identity and completed result. This explicit CLI invocation is separate from Applications' managed-operation reconciliation.

For an unfinished setup whose destination has not been created, keep the complete setup JSON. A queued or still-running original command can continue through its original operation; a new reviewed Start after an ended command opens a fresh setup for that still-new directory.

The original retained workspace **Continue** action resumes interrupted previews, preparation and release requests. [Applications](APPLICATIONS.md) describes the common managed review, save, connection, start, stop and recovery commands.

## Receive the installed six-product workflow

The original native journey can create and operate its six-product workspace through an existing Applications home while the same native Redis fixture is running. Set `SF30_REDIS_JOURNEY_APPLICATIONS_CONFIG` to a private JSON file containing the actual selected installation and original Applications locations:

~~~json
{
  "runtimeDirectory": "/private/runtime/merchant",
  "bootstrapSourceRoot": "/private/runtime/merchant/package/source",
  "expectedSourceCommit": "ACTUAL_INSTALLED_40_HEX_COMMIT",
  "expectedManifest": "ACTUAL_SOURCE_MANIFEST_SHA256",
  "applicationWorkspace": "/private/applications",
  "homeId": "EXISTING_MANAGED_HOME_ID",
  "receptionDirectory": "/private/redis-applications-receiving"
}
~~~

Use the exact READY installation's source root, commit, manifest and existing home ID. The runtime contains the cumulative Redis setup, List/Set and Applications provider implementation; its native Redis, browser and original merchant dependencies remain selected by that installation. The existing receiving directory's parent must be private.

Run the original installed source with its full companion modes:

~~~sh
SF30_REDIS_JOURNEY_SETUP=1 \
SF30_REDIS_JOURNEY_COLLECTIONS=1 \
SF30_REDIS_JOURNEY_WORKSPACE=1 \
SF30_REDIS_WORKSPACE_BROWSER=1 \
SF30_REDIS_JOURNEY_APPLICATIONS_CONFIG=/private/redis-applications.json \
node /private/runtime/merchant/package/source/stellar/scf-starforge-20261009/sf30-seller-sdk/redis/native-journey.mjs
~~~

The call site reviews and saves one Redis application for the new private destination, connects its selected runtime and starts the original setup command. The original browser imports, previews and creates the six-product workspace through that managed process, edits the saved products, downloads customer files and stages the prepared release. It reattaches to the same live managed setup operation, stops that process, and verifies the original setup constructor's explicit cold continuation against the same operation and input SHA. The same saved application then runs its two reviewed open/reopen passes. Both use the original workspace, managed home, source installation and creation identity.

The receiving checks all six original query kinds and immutable connection/certificate/environment description. Live previews follow the actual source's continuation, including an empty Set page with a remaining cursor. Their complete results stay in the workspace under the original request IDs. Reopening reads those retained results and customer OpenAPI/client files again.

The native result includes `applications`, its receiving receipt and `retainedWorkDirectory`. This explicit mode keeps the original native work directory so the saved application remains reopenable. Include that directory and the receiving receipt in the existing worker's retained outputs. The native journey still owns and closes its Redis fixture and original servers after receiving.

For a separately retained workspace, the same consumer has an ordinary command entry:

~~~sh
node /private/runtime/merchant/package/source/stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/managed-journey.mjs \
  /private/redis-managed-receiving.json
~~~

That configuration also supplies `redisDirectory`. Optional `expectedQueryKinds`, `previewAll`, `previewInputs` and `customerPackageId` select the original product and saved package receiving. The receipt retains its application/save/start IDs. Repeating its configuration reattaches to live or queued original operations and resumes the retained source requests. If its managed command has ended, read that operation's outcome and use the application's normal fresh reviewed Start to reopen the saved workspace.
