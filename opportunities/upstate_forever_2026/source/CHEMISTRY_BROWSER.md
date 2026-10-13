# Operate a retained chemical project in the browser

This journey opens the original scientific operator and drives the Reach chemistry desk against an existing Workspace. It uses the retained chemical project, source files, native analysis queue, original result downloads, editable chemistry export/receive, and complete workspace backup/restore.

Run it from the current application directory with Node and Playwright available to the receiving host. The operator must already be running from that same application and registered to the actual Workspace. Keep its startup URL in a local private text file; the driver reads the capability from the original URL fragment and sends it only to that operator's API routes.

## Start from the retained scientific case

    node source/run_chemistry_browser.mjs \
      --url-file /actual/private/operator-url.txt \
      --workspace ORIGINAL_OPERATOR_WORKSPACE_KEY \
      --case-id ORIGINAL_CHEMISTRY_CASE_ID \
      --receive --transfer --video \
      --output /actual/chemistry-browser

The Workspace key is the original server registration key, distinct from the scientific project ID. Select the existing chemical case in Reach chemistry or read the native catalogue to obtain its actual case ID.

A retained project JSON source can supply the starting case instead:

    node source/run_chemistry_browser.mjs \
      --url-file /actual/private/operator-url.txt \
      --workspace ORIGINAL_OPERATOR_WORKSPACE_KEY \
      --source-collection ORIGINAL_COLLECTION_ID \
      --source-id ORIGINAL_PROJECT_SOURCE_ID \
      --receive --transfer --video

This uses the desk's original source intake and chemistry.case.from-source operation. The original project source must already be retained by the Workspace. Its physical model, constituent basis, geometry/reach IDs, phases and source provenance supply the calculation.

## Select an actual edit and analysis

To exercise a prepared scientific change, pass the complete edited project and a specific reason:

    --edited-project /actual/chemical-project-edit.json \
    --reason "Documented change to the retained reach model"

Without an edited project, the journey saves a child working edition of the same project with its original physical parameters. The parent identity and complete project body are checked after the actual save.

Supply an existing original analysis request for calibration, sensitivity, source attribution, monitoring design or uncertainty:

    --request /actual/selected-analysis-request.json

The complete request goes unchanged through the native chemistry.run queue. Calibration retains its explicit observations, source reference, conserved basis, fraction, model-day origin, uncertainty and fit/holdout roles. Monitoring and uncertainty retain their original candidate/prior/distribution choices. With no request file, the journey asks the existing engine for a simulation at day zero and the selected project's own phase endpoints.

Additional controls:

| Argument | Effect |
| --- | --- |
| --receive | Download the native editable chemistry ZIP, retain its exact bytes through Original sources, receive it through Reach chemistry, and reopen the original project/results. |
| --transfer | Create the original complete scientific workspace backup, restore it to an independent receiving workspace, and reopen the same retained chemical case and analysis. |
| --video | Record the main operated browser context beside the screenshots and journal. |
| --headed | Show the actual browser while operating the workflow. |
| --browser-channel NAME | Select an installed Playwright browser channel. |
| --task-timeout-seconds NUMBER | Observe the same original queued task for this explicit period. Default 3600 seconds. |
| --output DIRECTORY | Save the actual journal, screenshots, recording, downloaded originals and private request state here. |
| --resume | Continue the original tasks in the same explicit output directory, using identical scientific input files and selections. |

## Operated workflow

1. Open the selected original Workspace and chemical case or retained project source.
2. Enter invalid project JSON in the real editor, observe its actual validation message, and restore the selected complete project.
3. Retain the draft project and analysis request while navigating away and back.
4. Save an immutable child edition and check its parent/project identities.
5. Run the actual native analysis, inspect its mode-specific result collection, operate result pages, and download available original HTML/CSV/JSON outputs.
6. Export the editable native chemistry package including the completed analysis.
7. Open the same saved case/results in a fresh browser context.
8. When selected, receive the editable package through the same original source intake and compare the original project, request and all retained artifact identities.
9. When selected, create and receive the complete native workspace archive, then reopen the same case and run in its independently registered receiving directory.

The native engine's transfer changes receiving case/run record IDs while preserving the project, original request and artifact bytes. Full workspace receiving preserves the original case/run IDs. The journey checks the respective native behavior.

## Output and continuation

The output directory contains journey.json, screenshots of actual operated pages, original downloaded reports/packages under exports/, and optional video/. Each download is checked against its original native ticket byte count and SHA-256. The journal records original task, case, run and receiving identities together with actual success or failure. Startup URL and capability are redacted from journal/error output.

### Restart the same operated journey

Repeat the original command with the same input files, selections and output directory, adding --resume:

    node source/run_chemistry_browser.mjs \
      --url-file /actual/private/operator-url.txt \
      --workspace ORIGINAL_OPERATOR_WORKSPACE_KEY \
      --case-id ORIGINAL_CHEMISTRY_CASE_ID \
      --receive --transfer --video \
      --output /actual/chemistry-browser --resume

Before a browser action reaches the operator, the driver flushes its complete original request body into request-state.json using an atomic file replacement. It flushes the returned task ID before observing progress. Resume reads that same task; when an HTTP response was lost, it resends the original operation ID and payload. Failed, interrupted or cancelled tasks continue through the original /api/task/resume action. The same saved child is reopened before analysis, and original completed exports, source intake, editable receive, backup and restore tasks are reused within this journey.

The continuation checks the original workspace and source/case choice, exact edited-project and analysis-request file hashes, reason and receive/transfer selections. A changed scientific request belongs in a new output directory. Input file bytes are read once and frozen for the current attempt. A fresh invocation refuses to overwrite an existing journey; --resume requires its original durable request state. Earlier journals created before this feature can still be continued manually through their retained operator task IDs.

request-state.json is a private local continuation file, created with owner-only permissions. It may contain original scientific selections, upload identities and local file-ticket references; keep it with the receiving worker and omit it from human-facing delivery packages. Authentication headers and startup capability are never written into this file. The public journey.json retains redacted operator references and also uses a flushed atomic replacement, so an interruption while writing its progress leaves the previous complete journal readable. Use one worker per output directory. Source selection, model preparation and compute continue through the existing native stores and task queue.

This driver is part of the current public application and therefore travels in the existing portable source export. The Reach chemistry interface and scientific input contract are documented in operator/CHEMISTRY_OPERATOR.md and the original model/reach_chemistry documentation.

## Use an existing Chromium executable

When the receiving machine already has a working Chromium binary, add `--browser-executable /actual/installed/chromium`. The driver passes that explicit path to the existing Playwright launch. Choose either this option or `--browser-channel NAME`; omitting both retains Playwright’s bundled Chromium selection.

The public journey records the requested browser kind, executable path or channel, and headless setting in `browser_runtime`. A resumed attempt preserves its previous runtime selection in the attempt history. This runtime choice is separate from the original scientific input and task fingerprints, so a repaired or newly available browser can continue the same retained requests with `--resume`.
