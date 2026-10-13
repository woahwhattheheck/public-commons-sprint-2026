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

## Reopen completed analyses from a received full Workspace

Use `--restored-selection` when the native Workspace already contains the chemical case and its completed analyses. This mode opens those original records directly, reads their actual requests and source references, inspects every selected analysis, downloads its original results, and exports the retained editable project. `--receive` additionally receives that project through Original sources and Reach chemistry; `--transfer` continues through the original full Workspace backup and independent receiving workflow.

The native case reader verifies the chemical project fingerprint and the bytes of its original source edition, manifest and companions. The browser checks the actual receiving project's identity, each completed run's case and project selection, and the complete retained case/run fingerprints. Each selected analysis is opened through the current Reach chemistry interface, including its native result collection and result downloads.

Prepare an explicit UTF-8 selection JSON. This is the completed original authored numerical-method reference in the retained Upper Savannah working Workspace:

```json
{
  "schema": "upstate.chemistry-browser-selection/v1",
  "project_id": "b9d5d257-c6bb-4f07-b975-8e8c63705db3",
  "case_id": "ddd984b567d881798f214530ebf0aef4601ab0744df7af7831bcb17e4e302abb",
  "run_ids": [
    "59d4b738620b469249bb297fa05626012de72a1cdd4e5135a9f6dc4b7f9c8a53",
    "6742a178dfe5c7dc69ea3c7b9cebfb1477bb3074db98f1c8990c5686569bc58d",
    "2296638a0531acf18d172955d3da5e7845dc71ccaf76189b36b0217565c40a5a",
    "9e2e96abc6dcdbb799c00a106e50fb93c98298ea8c44fccd2282e12ac202a044"
  ]
}
```

These IDs select the original simulation, calibration, 512-draw uncertainty and eight-observation monitoring analyses, in that order. Their numerical-method reference provenance remains part of the saved case and original source edition. Select the actual native case and completed run IDs when operating another retained study.

```sh
node source/run_chemistry_browser.mjs \
  --url-file PRIVATE_OPERATOR_URL_FILE \
  --workspace ACTUAL_RECEIVING_OPERATOR_KEY \
  --restored-selection chemistry-browser-selection.json \
  --receive --transfer \
  --browser-executable /tmp/chromium \
  --browser-renderer-limit 2 \
  --output RECEIVING_CHEMISTRY_BROWSER_DIRECTORY
```

The receiving operator's workspace key comes from its actual registered directory. Its scientific project ID remains unchanged. A fresh receiving operation uses a fresh output directory. The driver freezes the exact selected-file SHA, actual workspace key, original project/case/run IDs and receive/transfer choices in `request-state.json`. Native case and completed-run fingerprints exclude only transport-specific workspace/download fields. Continue the same operation with the same file bytes, workspace and flags plus `--resume`.

This mode selects saved outcomes; the existing `--case-id` / source-input modes continue to provide scientific editing and new calculation. The two modes are mutually exclusive. In restored mode the browser does not submit a valid case save or calculation. It retains the original case and completed runs through native result inspection, editable project export, optional project receiving and optional full Workspace transfer. Exported archives must include every selected analysis. Both forms of receiving check every selected analysis and its original artifact identities; editable-project receiving also compares the original native result rows.

Completed journals retain `case_id`, the first selected `run_id`, the complete ordered `run_ids` and the new input identity. Every queued export/import/receiving request keeps the original durable request body and operation ID, including after a lost browser response.

### Run on a constrained receiving worker

`--browser-renderer-limit 2` asks Chromium to limit renderer processes. Choose a value from 1 through 32 when the worker shares memory with scientific jobs. This is recorded in browser runtime metadata and stays outside the frozen scientific input. The atomic `journey.json.current_step` names browser opening, native analysis inspection, export and receiving stages so an interrupted worker leaves an actionable continuation.
