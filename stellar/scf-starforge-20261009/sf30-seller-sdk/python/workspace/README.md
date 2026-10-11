# Python merchant workspace

A local authoring workspace for an existing Python merchant application. It retains selected source files and declarations, edits immutable revisions, executes explicit private previews, and operates the original SF82 Python release lifecycle. The browser covers the entire authoring and customer handoff flow.

The workspace uses the original `compilePythonMerchant`, `previewContext`, `createPythonSource`, Python release preparation, SF82 release store and process manager, and original customer client exporter. Payment terms, native challenges, worker startup/shutdown, source inspection, release comparison, generation guards, and seller process ownership continue to come from those implementations.

## Start with an existing application

Use Node 22.13 or later with the built-in `node:sqlite` module, and the Python interpreter selected by the original declaration. No additional workspace package is required. Run these commands from the repository root, replacing the application paths with your own:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/cli.mjs create \
  --workspace /absolute/path/to/new-workspace \
  --config /absolute/path/to/application/merchant.json \
  --python-root /absolute/path/to/application \
  --label "Python merchant"

node stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/cli.mjs serve \
  --workspace /absolute/path/to/new-workspace \
  --port 0
```

Open the operator URL printed by `serve`. The random local access token is in its URL fragment. The console binds to loopback and uses the original release console's host, origin, token and same-origin mutation boundary. Its static files have no external scripts, fonts or network dependencies.

`create` and `import` require a new destination directory. Keep the workspace outside the selected helper directory so future source captures cannot include the workspace itself. Omitting `--python-root` retains the original entry module only. Selecting a helper root retains its regular source/assets, subject to the original Python release limits: 512 files, 32 MiB total, 8 MiB per asset and 2 MiB for the entry module. The original dependency/cache/bytecode exclusions and symlink checks apply.

Creating, editing, compiling, inspecting and staging source do not import the Python application. **Run private preview** explicitly executes the selected saved function through the original Python worker. It uses the original configured interpreter, environment-name allowlist, input schema, output format, lifecycle hooks, worker count and timeouts. This is trusted application execution; “private” identifies the local preview operation, outside the customer payment request path.

## Work from source to a running release

1. **Application:** inspect the captured entry, declaration and helper files. The raw declaration is retained with the selected source. Edit source text, add files, remove files or choose another retained `.py` entry. The editor sends only changed files and removed paths; the base revision supplies the remaining exact source bytes.
2. **Functions & terms:** edit declared functions, examples, input/output contracts, paths, prices and payment terms. Full declaration editing preserves native fields that have no dedicated form control. Intermediate invalid declarations can be saved. Their original compiler diagnostic appears beside the revision, and preview/stage require a valid saved declaration.
3. **Save a revision:** each save creates a new immutable source revision. The expected current head prevents a concurrent browser or CLI from overwriting another saved change. Local unsaved drafts remain separate from the current server revision and historical read-only views.
4. **Try a function:** choose a saved revision, function and explicit input. The retained operation ID binds that source and input to one private execution. Repeating the same request returns its existing operation; changing its input or revision under the same ID returns a conflict. The result records complete original bytes, content type, SHA-256, pool statistics and original worker shutdown information.
5. **Releases:** stage a saved revision into the original SF82 immutable release store. Inspect its original file/source identity, compare it with another release (or no previous release), then activate it using the displayed selection generation. Stage IDs are explicit and retained so a lost response can be reconciled against the actual original release.
6. **Run:** start the selected release. With no facilitator, the native seller remains `CHALLENGE_ONLY`; it serves its original offers and challenges without importing the Python application. A configured native facilitator uses the original merchant payment lifecycle. Activation changes selection; restart changes this console's running instance. Rollback uses the original retained prior releases and generation guard.
7. **Customer handoff:** export the client from the owned running seller's original `/_seller/openapi.json`. The original exporter writes JavaScript, TypeScript declarations, OpenAPI, package metadata and its README into a new named export directory. Exact files remain downloadable after reopening the workspace.

The workspace retains the operator's raw declaration separately from the runnable copy. A preview or native stage materializes the selected revision in a private working directory and adjusts only its application path and any originally relative interpreter path. When the declaration itself was inside the helper root, that source record and its declaration editor stay consistent. Native Python release preparation still owns the final runtime configuration and hashes.

Historical source is read-only until **Restore** creates a new current revision. Refreshing the original source rereads only the config/helper paths selected at workspace creation and creates another revision. A portable import keeps its captured sources but does not assume that old absolute source paths belong to the new host; create another workspace with explicit paths to capture a different local application.

## Runtime and recovery

Preview states are `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED` and `INTERRUPTED`. The source/input record is committed before execution. The complete output blob is retained before completion is recorded. Reopening an unfinished operation whose owning process ended records `INTERRUPTED` and preserves its input/source; that operation ID is never automatically executed again. Start another explicit preview with a new ID when you want another execution.

Cancel closes only a preview owned by the current process. Closing the browser server or interrupting its foreground CLI aborts owned preview calls, waits for the original worker shutdown, and closes the original seller manager it owns. The native SF82 manager retains its original process ownership, source verification, graceful drain and child cleanup. Another console or CLI can inspect a running seller but cannot stop an instance it does not own.

Staging records the selected revision, original prepared source metadata, explicit release ID and runtime options before invoking the native stage. If a process ends after the original immutable release was published, reopening compares it with that retained preparation and recovers the completed stage. A conflicting release ID never overwrites native source.

The browser retains source drafts and exact pending mutations in IndexedDB, scoped to the immutable workspace ID. Structured strings and binary/base64 values are preserved without JSON conversion. Writes resolve only after their storage transaction commits, so larger source changes do not depend on duplicating their payload in session storage. Source saves can be reconciled with the current revision/history; stages with the named native release; runtime changes with the original instance and generation; customer handoff with its named export. The automatically replayable operation is the source/input-bound private preview ID. A partial customer export remains inspectable under its original create-only name; a fresh export uses another name.

## Export and reopen

Use **History & handoff → Export workspace**, or the CLI:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/cli.mjs export \
  --workspace /absolute/path/to/workspace \
  --out /absolute/path/to/new-workspace-export.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/cli.mjs import \
  --workspace /absolute/path/to/new-reopened-workspace \
  --bundle /absolute/path/to/new-workspace-export.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/cli.mjs serve \
  --workspace /absolute/path/to/new-reopened-workspace \
  --port 0
```

The portable JSON file includes the full retained revision history, raw declarations, deduplicated source/output blobs, preview records, stage mappings, original immutable native release files, release selection/history, and completed original customer exports. Each file's bytes and SHA-256 are checked on import; original release inspection checks the imported native source closure. Native running PIDs, process locks, working directories and live ownership are not imported. The reopened seller is stopped, with its original saved selection and source available for an explicit run.

The JSON bundle limit is 256 MiB. All workspace history stays in its local directory if a bundle exceeds that limit. Workspace directories use private permissions; file/output/export writes are create-only or committed atomically. SQLite transactions protect revision heads and operation identities, and retained blobs are addressed by SHA-256. The workspace does not capture process environment values or its access token; operator-selected source files and raw declarations are retained in full.

## CLI authoring and explicit previews

`--help` lists every command. In addition to create/serve/export/import, the CLI provides status, revision/file reads, source save/restore/refresh, private preview, native stage/diff/activate/rollback and the original foreground release manager.

`save --input change.json` accepts the same source patch as the browser. For example:

```json
{
  "expectedHead": "r-current-revision-id",
  "baseRevision": "r-current-revision-id",
  "note": "Use the new calculation helper",
  "files": [{"path": "helper.py", "text": "def double(value):\n    return value * 2\n"}],
  "remove": []
}
```

Omitted entry/declaration values retain their base revision values. A file can provide `text` or canonical `base64`. Source patches are limited to the original selected relative source space, without parent traversal, symlinks or excluded dependency/cache files.

An explicit CLI preview waits for its owned operation and original worker shutdown:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/cli.mjs preview \
  --workspace /absolute/path/to/workspace \
  --revision r-saved-revision-id \
  --function summarize \
  --input /absolute/path/to/input.json \
  --operation first-summary-preview \
  --out /absolute/path/to/new-result.json
```

## API and embedding

Import `createWorkspace`, `openWorkspace` or `importWorkspace` from `model.mjs`. `startPythonWorkspace(directoryOrOpenedModel, {port: 0})` from `server.mjs` returns `{server, workspace, url, token, operatorUrl, close, closed}`. Await `close()` for owned worker/seller cleanup. API requests use `X-Python-Workspace-Token`; POST requests also use the actual printed loopback `Origin` and `Content-Type: application/json`.

| Route | Result or action |
| --- | --- |
| `GET /api/state` | Current revision, historical summaries, preview summaries, native release status, retained stages/customer exports and current operation status |
| `GET /api/revision?id=…` | Full saved revision declaration/file descriptors and original compiler diagnostics |
| `GET /api/file?revision=…&path=…` | Complete original file content as UTF-8 or base64 with bytes/SHA-256 |
| `POST /api/revisions` | Save a new source revision with `expectedHead`, `baseRevision`, declaration/entry, changed `files` and `remove` |
| `POST /api/restore` | Create a new revision from `revisionId`, guarded by `expectedHead` |
| `POST /api/refresh-source` | Capture the startup-selected original source again, guarded by `expectedHead` |
| `POST /api/preview` | Explicit `revisionId`, `function`, `input` and `operationId` |
| `GET /api/preview?id=…` | Retained input, result, original pool/shutdown details and terminal error |
| `GET /api/preview-output?id=…` | Exact original result bytes |
| `POST /api/preview/cancel` | Cancel this process's owned preview `id` |
| `POST /api/stage` | Native stage for `revisionId`, explicit `id`, `label` and original `runtime` options |
| `GET /api/release?id=…` | Original source-verifying native release inspection |
| `GET /api/diff?to=…&from=…` | Original native comparison; omit `from` to compare the first release against no prior version |
| `POST /api/activate`, `/api/rollback` | Original selection changes using `expectedGeneration` and optional reason |
| `POST /api/run` | Start the selected original release using `expectedGeneration` |
| `POST /api/stop`, `/api/restart` | This console's original `instanceId`; restart also needs `expectedGeneration` |
| `POST /api/customer-export` | Original running-seller SDK export using a new `id` and owned `instanceId` |
| `GET /api/customer-file?id=…&file=…` | Exact retained original customer export member |
| `GET /api/export` | Complete portable saved workspace |

Errors return `{error, message, action, busy, retryable}` with an applicable original `generation`. Conflict responses preserve source or release changes made by another operator. Binary downloads include `Content-Disposition` and `X-Content-SHA256`. Source patch requests allow up to 48 MiB of JSON transfer while each saved revision retains the original native source limits.
