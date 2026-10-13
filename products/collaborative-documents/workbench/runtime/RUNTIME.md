# Hocuspocus application runtime

This contribution prepares the original application selected by the workshare, preserves its actual npm resolution and installed files, and independently receives the whole runtime on another compatible host. It also retains every original Hocuspocus and Tiptap source file and both original provider archives.

Operation: `TIPTAP-HOCUSPOCUS-APPLICATION-WORKSHARE-0C7A-20261012`.

The application owner supplies its complete source manifest, package selection, shared document/schema factory, native server and business workspace. The editor owner supplies `web/operator.mjs` and the actual browser programme. This runtime runs the application's selected build script and returns the resulting application directory to that same server. A business document workspace remains a separate, explicitly selected directory; its native Yjs state travels through the core owner's document/workspace export.

## Original selected sources

| Original | Release | Immutable commit | Complete source |
| --- | --- | --- | --- |
| ueberdosis/hocuspocus | v4.7.1 | bd288a4441fb60a663bbaf34660a490eb59dd6ea | 271 files; 1,600,054 bytes |
| ueberdosis/tiptap | v3.31.4 | d9af9c6a16e17438b06b2266765b9c1a21a3d7a0 | 2,214 files; 10,671,171 bytes |

`upstreams.json` contains every original file path, Git mode, byte count and blob identity. The actual complete original archive acquisition finished at 21:39:23 UTC on 12 October 2026. `ORIGINAL_SOURCE_RECEIVING.json` retains both HTTP 200 responses, provider archive hashes and the exact source counts. The acquisition programme compared every file body and executable/link mode with the selected trees before materializing it.

The original Hocuspocus development repository uses pnpm. The delivered application's actual npm manifest and lock resolve the published package builds; the installer does not substitute the upstream monorepo's workspace package references for published dependencies. Hocuspocus requires Node 22 or newer.

Original release and contract sources:

- https://github.com/ueberdosis/hocuspocus/releases/tag/v4.7.1
- https://github.com/ueberdosis/tiptap/releases/tag/v3.31.4
- https://tiptap.dev/blog/release-notes/hocuspocus-4-stable-release
- https://tiptap.dev/docs/hocuspocus/guides/persistence

Both original source repositories' complete licence files and native examples are included in a prepared runtime's `source/upstream/source/` trees. Hocuspocus's `playground/backend/src/default.ts` and `load-document.ts`, provider source, database extension and transformer source remain the original implementations.

## Select the complete application

Provide an ordinary source directory and its complete source manifest. The manifest is a JSON object with a non-empty `files` array. Every row has a normalized relative `path` and an original `sha256` or `git_blob_sha`. It may also supply `bytes` and Git `mode` (`100644`, `100755`, or `120000`). Optional repository/commit/operation fields carry the original source identity.

The installer reads and compares every selected member before copying. `package.json` must be included. Include the actual `package-lock.json` when already resolved, all application and browser source, the shared schema factory, the original build script, this runtime contribution, licence files and any application data required to build. Only members explicitly selected by that complete manifest enter the immutable application source; local secrets and business-workspace paths are not inferred from a directory scan.

The selected application may use the original Hocuspocus server/provider/transformer, Tiptap core and its selected schema/extensions, Yjs and the selected IndexedDB integration. The installed versions of the Hocuspocus server/provider/transformer and Tiptap core must match the retained upstream release selection. Additional extensions, build tools and transitive packages come from the application's actual resolved lock. Package inspection records every direct runtime, development and optional dependency actually installed.

## Prepare and build

Run from the complete source application:

```sh
python3 -B runtime/manage.py prepare \
  --application /PRIVATE/selected-application \
  --manifest /PRIVATE/selected-application-source.json \
  --directory /PRIVATE/prepared-runtime \
  --node /ACTUAL/node \
  --npm /ACTUAL/npm \
  --export /PRIVATE/complete-runtime.tar.gz
```

The runtime directory is a new ordinary directory outside the selected source. The optional export path is outside the runtime directory.

Preparation performs the whole sequence:

1. Retain the original application source and source manifest.
2. Receive and compare both complete original upstream source archives and trees.
3. Copy the selected application into its working installation.
4. Preserve the original lock, or obtain and retain the actual npm lock through `npm install --package-lock-only --ignore-scripts`.
5. Run `npm ci --include=dev --foreground-scripts --no-audit --no-fund` against that exact lock. Original selected dependency lifecycle scripts run where needed by native packages.
6. Run the application's original `npm run build` when its package defines that script.
7. Load the actual installed native package exports, compare their versions/lock, and inventory every installed application file.
8. Mark the runtime READY and, when requested, create the complete runtime archive before the process returns.

A retained exact upstream capture can be supplied with `--hocuspocus-archive` and `--tiptap-archive`. These options receive the provided original archives and verify every Git member. A different tar wrapper containing the same exact original Git tree is retained under its own archive hash. Failed/partial provider responses are retained with their original request details.

`--no-build` selects the actual application source without invoking its build script. The usual browser delivery uses the default build path. The original application build script owns its bundler, shared schema import and browser output paths; the runtime preserves its completed outputs and returns the prepared application path. The core server should serve those selected outputs and import the same schema factory used by the migration and editor.

## Native integration facade

The original Node control process can import the runtime bridge directly:

```js
import {
  prepareRuntime, inspectRuntime, exportRuntime, receiveRuntime, startRuntime
} from './runtime/client.mjs';

const prepared = await prepareRuntime({
  application: selectedSourceDirectory,
  manifest: completeSourceManifest,
  directory: selectedRuntimeDirectory,
  node: process.execPath,
  npm: selectedNpmExecutable,
  python: selectedPythonExecutable,
  onStart: saveOriginalRuntimeProcess,
  onProgress: recordOriginalRuntimeProgress,
  exportPath: completeRuntimeArchive
});
```

A successful preparation returns `hocuspocus.runtime-status.v1` with `status: "READY"`, the immutable runtime `id`, `directory`, `application`, original `source_id`, and native package/runtime details. If an export was requested, `export` contains its complete byte count, archive hash and file count.

`startRuntime(operation, options)` exposes the actual spawned process PID, `started` promise and `result` promise for the core owner's existing job journal. Other exports simply await that original result. Progress records describe the original native attempt and selected path. Native stdout/stderr and failures stay in the original preparation's `jobs/` directory.

Start the original core application with the returned `application` path and the separately selected business workspace. Receiving returns a new installed application path and runtime identity; use those returned values when opening the restored business workspace. The immutable application directory should contain source/build/runtime files. The application's mutable documents, sessions and service logs belong in its explicit business workspace.

## Reconnect to an existing preparation

Repeat the same prepare command with the same source, runtime directory, selected Node/npm and build choices. A POSIX lock covers the whole preparation. Accepted native commands inherit that lock through their supervisor and native process; disconnecting an observer does not create another installer.

Every native command records its exact argv, working directory, selected non-secret npm configuration, request identity, process identity, stdout/stderr and terminal result. A subsequent controller receives an existing successful attempt. If an original native owner is still live after a controller failure, the existing preparation reports that actual owner. Ended incomplete attempts remain available, and the next attempt uses a fresh numbered directory.

For a failed preparation whose dependency files need rebuilding, repeat with `--repair-dependencies`. This repeats the selected install/build commands and retains their predecessors. Finished READY runtimes are immutable: prepare their retained original source/lock into a new runtime directory when replacing an installation. Switching the core service to that selected runtime and rolling back to the previous one remain the original application owner's operations.

## Inspect, export and receive

```sh
python3 -B runtime/manage.py inspect --directory /PRIVATE/prepared-runtime --full

python3 -B runtime/manage.py export \
  --directory /PRIVATE/prepared-runtime \
  --output /PRIVATE/complete-runtime.tar.gz

python3 -B runtime/manage.py receive \
  --archive /PRIVATE/complete-runtime.tar.gz \
  --directory /PRIVATE/received-runtime \
  --node /ACTUAL/node
```

The complete archive includes the original application, full upstream source trees and raw archives, actual npm lock, installed dependencies/build output, original source selection, native operation history and complete file manifest. Internal exclusions apply only to the live lock at the runtime root. Original nested directory/file names are preserved.

The receiving path first validates the exact complete archive membership and every original ordinary-file/link body. It retains the original runtime as an immutable payload, creates a new runtime identity and current path binding, loads the installed packages on the selected host, and compares the complete installed application. Repeating the same archive/destination selection receives the same completed result, including when its first HTTP/controller response was lost. Interrupted member copies resume against their original hashes and retain temporary receiving work outside the original payload.

Receiving requires the original operating-system platform and architecture. If the installed application contains native Node add-ons, the Node ABI must also match. To move to a different architecture/ABI, prepare the retained application source and actual lock on that host into a new runtime. The original archive and its prior prepared runtime remain available.

The successful result is `hocuspocus.runtime-receiving-result.v1`, with the new `id`, current `directory` and `application`, original runtime/source/archive identities, and actual native package inspection. Give those paths to the same original application's delivered-workspace receiving flow.

## Current original receiving

The complete upstream source acquisition and Python/Node source parsing have executed successfully. The complete canonical application selects Node 24, the original exact package/lock, reference-v1 schema with the default fragment, and its createApplicationServer facade. Its original receiving/receive.mjs business course joins this runtime's preparation and independently received application to the original binary document-state export and browser programme. Source acquisition and parsing do not establish an executed application receiving result.

Internal coordination: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791838362319029

## Acquired command ownership during a record failure

The Document Workshop integration retains the original `run_child` command, lock descriptor, npm/build process and log files when process-identity inspection or the second `RUNNING.json` publication fails after acquisition. The same helper waits for that actual child before closing either log and publishing `RESULT.json`. It neither substitutes a command nor kills the child to finish a metadata write.

The first failure remains the command failure. A returned native exit is recorded separately as `native_exit_code` when that first failure exists; the original `exit_code` remains null on that failed helper path. No caller should treat an unwritten or failed command record as proof that a native command has closed. The original runtime lock, request ID and command directory remain the recovery boundary.

This is the complete integration successor of the original `runtime/manage.py` source, 37,137 bytes with SHA-256 `e4f08dc9a952dfcab2694c0cde2106306451b46bddfb4315a5ee23b3e5bf3bff`. All original prepare, inspect, export, receive, package-selection and npm command behavior is retained.
