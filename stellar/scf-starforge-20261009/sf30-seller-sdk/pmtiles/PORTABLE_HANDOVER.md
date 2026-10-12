# Receive and operate the complete map release

This package contains the saved PMTiles workspace, its full source and release history, application source, original upstream records/licenses, and the exact built map runtime. Use the package's saved delivery result to select its archive SHA, workspace ID and package ID.

## 1. Preserve the delivered selection

Keep these actual fields from the sender's package-complete result:

| Field | Receiving purpose |
| --- | --- |
| archive.sha256 and archive.bytes | Select the complete original ZIP. |
| packageId | Select its complete logical package manifest. |
| workspaceId | Select the original saved workspace. |
| workspace.sha256 | Select the frozen workspace handover manifest. |
| runtimeSha256 | Select the exact native executables, browser/native bundles and compatible Python host contract. |

The ZIP contains PACKAGE.json, RECEIVE.py, START_HERE.md and content-addressed objects. PACKAGE.json maps each complete source/runtime/workspace file to its payload SHA, byte count and private mode. The receiver materializes all logical paths and checks their bytes. It preserves identical-file aliases without discarding their names.

Use a Linux x86-64 host with Node.js 22.16 or later, a complete Python 3.11+ standard library installation including ctypes, and util-linux flock. The package carries the selected Martin and go-pmtiles binaries and all built map modules. The receiver binds the current host's actual Python executable and records its hash/version while preserving the delivered runtime's compatible host contract.

The native browser uses the host's existing Chromium-compatible browser with WebGL. A browser on the host or the existing authorized local-forwarding route can open the loopback application.

## 2. Extract the original standalone receiver

If the PMTiles source is already installed, use its package.py directly in the next step. Otherwise obtain the two named bootstrap files from the delivered ZIP after checking its complete SHA.

Save this small command with the actual absolute archive path, expected SHA and a new private bootstrap directory:

~~~sh
python3 -I - <<'PY'
from pathlib import Path
import hashlib, os, zipfile

archive = Path("/ABS/delivery/regional-map-release.zip")
expected = "ACTUAL_COMPLETE_ARCHIVE_SHA256"
bootstrap = Path("/ABS/map-bootstrap")
digest = hashlib.sha256()
with archive.open("rb") as handle:
    while chunk := handle.read(262144):
        digest.update(chunk)
assert digest.hexdigest() == expected, "The delivered archive changed."
bootstrap.mkdir(mode=0o700)
with zipfile.ZipFile(archive) as package:
    for name in ("RECEIVE.py", "START_HERE.md"):
        item = package.getinfo(name)
        assert item.file_size <= 16777216
        with (bootstrap / name).open("xb") as output:
            os.chmod(output.fileno(), 0o600)
            output.write(package.read(item))
            output.flush()
            os.fsync(output.fileno())
print(bootstrap)
PY
~~~

The two names are fixed, and the output directory is new. The receiver itself checks the complete ZIP, package manifest, every selected member, source path and byte digest. It rejects duplicate, absolute, escaping, symlink and file/directory-collision entries.

## 3. Receive all source, runtime and workspace bytes

Choose a new complete package directory. Keep the actual workspace ID and archive SHA from the sender's result:

~~~sh
python3 -I /ABS/map-bootstrap/RECEIVE.py receive --archive /ABS/delivery/regional-map-release.zip --destination /ABS/received-map-product --expected-sha256 ACTUAL_COMPLETE_ARCHIVE_SHA256 --workspace-id ACTUAL_WORKSPACE_ID
~~~

Success returns SOURCE_COMPLETE, the exact package/workspace IDs and the installed CLI path. This step extracts and verifies complete files. Its original receiving request, lock, full source receipt and any retained partial files are kept inside the selected package directory.

If receiving stops, run that exact command again. It verifies already completed files and continues the same selected archive. The output path is private, and a different package cannot replace this original receiving selection.

The logical directories are:

| Directory | Complete contents |
| --- | --- |
| source/sf30-seller-sdk/pmtiles | Application, CLI, workspace, native lifecycle, browser, original source bundle and guides. |
| source/sf31-buyer-client and source/sf88-operator-buyer-cli | The actual literal source dependencies selected by the application, preserving their original relative paths. |
| runtime/bin | Original selected pmtiles and martin executables. |
| runtime/native and runtime/web | Full native library, parent-death launcher, browser renderer/CSS and MapLibre worker. |
| runtime/source and runtime/licenses | Complete captured build-input bytes and package license files. |
| runtime/build-native | The original runtime version/probe command records. |
| workspace-snapshot | Frozen database, complete source files, source receiving records, native inspection/server output and all saved releases. |

The merchant MCP companion runs inside the separately installed original merchant operator. Its guide declares its complete operator/runtime dependencies and points to this same received workspace and runtime; this CLI package does not invent an unrelated MCP installation.

## 4. Reopen the original native workspace

Create an absolute receiving JSON file. The live workspace directory is separate from the immutable received package directory and its workspace-snapshot:

~~~json
{
  "requestId": "regional-customer-receiving-01",
  "directory": "/ABS/received-map-product",
  "workspaceDirectory": "/ABS/customer-map-workspace",
  "pythonExecutable": "/usr/bin/python3",
  "expectedArchiveSha256": "ACTUAL_COMPLETE_ARCHIVE_SHA256",
  "expectedWorkspaceId": "ACTUAL_WORKSPACE_ID"
}
~~~

~~~sh
node /ABS/received-map-product/source/sf30-seller-sdk/pmtiles/cli.mjs receive-installed --input /ABS/customer-receiving.json
~~~

The installed receiver verifies every logical source/runtime/snapshot file, binds the actual local Python interpreter, checks the exact executable/bundle/runtime identity, and receives the frozen database through the original workspace transaction. It preserves the original workspace ID and prior release chain, adds the receiving event, and verifies the current release's complete files.

Success returns COMPLETE, runtimeProfile, workspaceDirectory, the current release, source and received revisions, and the actual serve command. Keep this complete result. Reopening the same JSON selects the same receiving operation and returns its completed result with the workspace's current revision/selection.

A receiver with the source already installed can do source extraction and native workspace receiving in one call:

~~~json
{
  "requestId": "regional-customer-receiving-01",
  "archive": "/ABS/delivery/regional-map-release.zip",
  "directory": "/ABS/received-map-product",
  "workspaceDirectory": "/ABS/customer-map-workspace",
  "pythonExecutable": "/usr/bin/python3",
  "expectedArchiveSha256": "ACTUAL_COMPLETE_ARCHIVE_SHA256",
  "expectedWorkspaceId": "ACTUAL_WORKSPACE_ID"
}
~~~

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs receive-package --input /ABS/customer-receiving-with-archive.json
~~~

Use either this joined route or the preceding two-step route for the selected package. The original receiving request and paths remain authoritative if a response is lost.

## 5. Open the saved map and continue editing

Use the actual runtimeProfile and workspace ID from COMPLETE:

~~~sh
node /ABS/received-map-product/source/sf30-seller-sdk/pmtiles/cli.mjs serve --workspace /ABS/customer-map-workspace --workspace-id ACTUAL_WORKSPACE_ID --runtime /ABS/received-map-product/runtime/installed-runtime.json --port 0
~~~

Open the returned local URL. It contains the current token in its fragment; the browser retains it in its session. Saved editions, original source information, native results and the current release are available immediately. Open native preview for the selected release.

The owned Martin startup reads the delivered original PMTiles file, serves the exact selected source, and confirms one known-present native tile against the same original tile's bytes. The OpenLayers/MapLibre browser then renders this endpoint. Original attribution and selected layer/glyph coverage remain visible beside the map.

Port 0 reuses the saved authoring port. If that port is already used on the new host, select another available nonzero port explicitly. Subsequent launches reuse the new saved port. Saved browser drafts belong to an origin and workspace ID, so keep that origin on later Stop/Start cycles.

To change the map, select an immutable saved edition, edit its title, release notes, archive/style bindings, layer choices or view, and Save edition. The next version retains its original expected version. Inspect the actual source, review that version against the current release, and prepare a new immutable release before publishing it.

## 6. Restore the prior release

The current release carries its actual previousReleaseId. The browser's Restore previous release operation reads that immutable chain and verifies its original files before changing the current selection.

The equivalent native request is:

~~~json
{
  "requestId": "regional-customer-restore-01",
  "expectedWorkspaceId": "ACTUAL_WORKSPACE_ID",
  "fromReleaseId": "ACTUAL_CURRENT_RELEASE_ID",
  "manifestSha256": "ACTUAL_CURRENT_RELEASE_MANIFEST_SHA256"
}
~~~

~~~sh
node /ABS/received-map-product/source/sf30-seller-sdk/pmtiles/cli.mjs restore --workspace /ABS/customer-map-workspace --workspace-id ACTUAL_WORKSPACE_ID --input /ABS/customer-restore.json
~~~

Reopen native preview on the restored release. If another operation has changed the current selection, inspect that actual change before making a fresh restore request. An identical completed restore request returns its retained result.

## 7. Preserve the continued work

Build another complete package after the receiver's edits and publication. Select new staging and ZIP paths and a new package request ID. The original source/runtime, original receiving history, new versions and full current release chain are then retained together.

The existing package-complete result always selects its frozen archive. It remains stable even as the live workspace advances. A different current workspace snapshot uses a new package request and destination.

The complete source includes the exact initial runtime builder and original captured dependency records. Running a new build requires the declared original packages and compatible existing host toolchain. Normal map serving and restoration on this receiver use the complete runtime already included in this package.
