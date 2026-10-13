# Original input files for Runtime Applications

Open **Applications → Original input files** to retain complete files from the
current computer or phone. Use **Choose original file**, keep or edit its filename,
and choose **Save complete original**. Files up to 16 MiB use the same maintained
resumable file engine as Collection request plans. Each one-megabyte part is
checked against the selected original; the completed original is checked and
published before duplicate upload chunks are retired. The allowance is shown
before upload. Existing absolute host paths remain available for larger inputs.

## Select a file into the current application

Open the existing application's configuration, or choose a new tool and runtime.
Beside the intended **file** path setting, select **Use saved file**. The shelf
shows that exact application kind and setting. Find the uploaded original and
choose **Prepare working copy**.

The workspace retains the selection request and creates a separate private
working file with the selected filename extension. It fills the chosen setting
only if the same configuration and field are still selected. Use **Review
application** and **Save** through the existing controls. The ordinary provider
validates the file format, related paths, runtime and application requirements.
Directory and executable settings continue to require their original types.

The uploaded original stays intact when an application edits its working copy.
The shelf shows the complete working path and whether its current bytes differ
from the original. **Use this working copy** reuses the existing path in the same
kind and setting; **Prepare working copy** makes a new explicit selection for
another application. Each original can be downloaded in full.

For example, choose **Grant planning and delivery → Original planning scenario**
and select an original SF47 scenario JSON. Keep the existing private Grant
workspace and runtime selections. The native Grant review remains authoritative
for that complete scenario and for reopening an existing saved plan.

## Continue interrupted work

An interrupted upload is listed with its saved byte count. Reselect the same full
file and filename, then save it again. The original content-derived upload
identity recognizes retained chunks and sends only missing parts.

Before creating a working copy, the browser retains its UUID and full selection.
**Continue prepared file selection** reopens that exact request. The server also
lists **PREPARING** copies after a browser restart or lost browser storage; use
**Continue this copy** on the original row. Repeating its UUID with different
file/kind/field is rejected. A completed working copy is never rewritten on
replay, including after an application has changed it.

If a review or configuration changes while file work runs, the saved file and
copy remain in the shelf. Reopen the intended setting and select the prepared
working copy explicitly. Application starts remain in the existing reviewed
lifecycle.

## Native command line

All commands use the original private Runtime workspace:

~~~sh
starforge runtime-workspace input-file-import \
  --workspace /srv/starforge/runtime-workspace \
  --file /srv/customer/original-scenario.json

starforge runtime-workspace input-files \
  --workspace /srv/starforge/runtime-workspace

starforge runtime-workspace input-file-prepare \
  --workspace /srv/starforge/runtime-workspace \
  --upload-id ORIGINAL_RETURNED_UPLOAD_SHA256 \
  --request-id ORIGINAL_SELECTION_UUID \
  --kind grant-workspace --field scenarioFile

starforge runtime-workspace input-file-selection \
  --workspace /srv/starforge/runtime-workspace \
  --request-id ORIGINAL_SELECTION_UUID

starforge runtime-workspace input-file-export \
  --workspace /srv/starforge/runtime-workspace \
  --upload-id ORIGINAL_RETURNED_UPLOAD_SHA256 \
  --output /srv/customer/original-returned.json
~~~

Retain the UUID before the first prepare call. The returned full working path is
a normal application setting; pass it through the current application review and
save API. The export target must be new. CLI import streams the original in the
same one-megabyte chunks and recognizes an earlier complete or partial upload.

From a checkout, use
node stellar/scf-starforge-20261009/distribution/runtime-workspace/cli.mjs
instead of starforge runtime-workspace.

## API and storage

The original openRuntimeWorkspace model exposes:

| Method | Selection | Result |
| --- | --- | --- |
| applicationInputsState | Optional query and independent file/working pagination | Saved originals, current working-copy identities and allowances |
| applicationInputBegin | Complete body-file upload manifest | Existing or new original upload |
| applicationInputChunk | Original upload ID, index and complete part bytes | Retained verified chunk |
| applicationInputComplete | Original upload ID | Full verified source file |
| applicationInputInspect | Original upload ID | Same original upload and progress |
| applicationInputPrepare | UUID, upload ID, application kind and file setting | Same durable selection and separate working path |
| applicationInputSelection | Original UUID | Saved selection plus current working-file identity |
| applicationInputDownload | Original upload ID | Complete original byte stream and SHA-256 |

The schema is declared in application-inputs.d.mts. The HTTP surface uses
/api/application-inputs and its begin, inspect, chunk, complete, prepare,
selection and download routes. It uses the existing private capability and
same-origin mutation controls. Downloads use the host's existing short-lived
download-link pattern.

All sources, original manifests, incomplete chunks, selection intents, working
copies and completion records are inside the original
WORKSPACE/application-inputs/ directory. **Workspace backup** includes their
full bytes through the existing complete-workspace walk. Independent receiving
restores the same original workspace location and identities before its normal
external-binding review. No separate file database or receiving writer is
introduced.

The maintained native receiving programme is
receiving/APPLICATION_INPUTS_RECEIVE.mjs. Give it an isolated existing parent
and an actual original input file. It uses the existing model, same-request
continuation, full-byte download, working-copy edit preservation, cold reopen,
and complete backup manifest inspection. The existing runtime owner can add its
READY Grant installation to complete the original provider review.

## Complete native receiving course

Run this course in an isolated private case directory on the existing Node/Python/Chrome host. Select an existing **READY** Runtime that includes the Grant workspace command and a complete original Grant scenario JSON. The programme retains its original bytes before any upload. The repository's existing illustrative example may be selected for a product demonstration; its own illustrative status and amounts remain unchanged.

```sh
node runtime-workspace/receiving/APPLICATION_INPUTS_RECEIVE.mjs \
  --operation /absolute/private/original-input-case \
  --file /absolute/original-scenario.json \
  --runtime /absolute/existing-ready-runtime \
  --chromium /absolute/existing/chrome \
  --playwright-root /absolute/existing/node_modules
```

The same command resumes its retained request IDs and completed phases. It saves an original chunk through the existing engine, reopens the workspace, completes the same upload in the browser, prepares a separate working file, preserves a native whitespace edit through request replay, and selects that file in the normal Grant application review/save. It uses the unchanged CLI path to download and compare the complete original. It then takes the existing complete workspace backup, retains the stopped original under the case directory, restores the same workspace at its original path, accepts its original binding review, and reopens the saved file selection and application.

The course records the complete original source identity, every phase, native request IDs, application revision, original backup and restore results, and desktop/320-pixel screenshots. Every invocation gets a separate output directory. A failed or interrupted phase remains in RECEIVING.json and resumes through the same command and native identities. The saved Grant application is connected but is not automatically started by this course. Application start remains its existing separate operator control.
