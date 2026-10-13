# Receive and inspect the original Chemistry reports in the application

This course opens actual completed Chemistry analyses through the maintained operator, prepares immutable saved reports and typed scientific sources, uses **Open this report only** and **Add to current report**, renders one ordered scientific report, downloads its original files, exports its selected Study, and restores and reopens that Study.

The default four original analyses are the authored four-reach reference case already retained in the regional project. Its source describes the coefficients as an editable mathematical example. Keep that provenance visible when presenting its calibration, uncertainty or monitoring result. A different completed field or compound-observation case can use the same course with its actual case and run IDs.

Existing Chemistry, Scientific Reports, Study transfer, queue, restore, file tickets and scientific figures remain the application’s original implementations.

## Current source and original receiving operation

Use the current cumulative application containing:

- Chemistry compound/interval source from merged PR3724 and its maintained report, typed-source and Study-transfer consumers.
- The explicit replace/append prepared-source callers and verified source-bank installer from merged PR3847. The maintained Scientific Reports composer declares `SCIENTIFIC_REPORT_SOURCE_SELECTION = 'replace-v1'`.
- The application’s `AGENTS.md`, version 2026-10-13.1 or its maintained successor.

Use the [complete current Chemistry27 source bank](chemistry-source-bank.json) retained beside this guide, with its matching guarded installer and source manifest. This is the exact merged PR3893 receiving edition: 366,072 UTF-8 bytes / SHA256 `ca038c5e555e33a3987ac87535fe62ac48429cd09495acd264c1366fc7ffa881`; the same immutable bank is Git blob `84853aab2c55e2f729593fd53a5591f393271582`. It supplies 27 complete leaves and inherits eleven omitted required leaves from the actual installed application. The Study phase requires the maintained `model/chemistry_study_transfer.py` supporting BOTH `native-chemistry-scientific-source-v1` and `native-chemistry-scientific-source-v2`; the corrected complete helper is 24,377 bytes / SHA256 `2fefa43d8ac88706252500ecc64bf37682f2aa34ae80a88e55b3826ac4f670ca`. It preserves the actual producing edition while retaining local editable cases, runs, reports and sources. The earlier v1-only resolver omitted that history for v2 sources. Adopt the complete source/installer/manifest successor together, then continue this same course. Use the delivered bank’s operating guide for installation; this browser course does not install or rewrite the application.

The existing regional native operation is Chemistry5170, joined to DD6B/E8D9’s original report course2722. Continue its physically received project and actual installed application. The original project is `b9d5d257-c6bb-4f07-b975-8e8c63705db3`; default case `ddd984b567d881798f214530ebf0aef4601ab0744df7af7831bcb17e4e302abb`.

The application’s registered **Workspace key** can differ from that project UUID. Read the actual operator Workspace selector or ready record and use its key.

| Original analysis | Completed run |
|---|---|
| Simulation | `59d4b738620b469249bb297fa05626012de72a1cdd4e5135a9f6dc4b7f9c8a53` |
| Calibration | `6742a178dfe5c7dc69ea3c7b9cebfb1477bb3074db98f1c8990c5686569bc58d` |
| Original 512-draw uncertainty | `2296638a0531acf18d172955d3da5e7845dc71ccaf76189b36b0217565c40a5a` |
| Monitoring design | `9e2e96abc6dcdbb799c00a106e50fb93c98298ea8c44fccd2282e12ac202a044` |

Additional attribution, sensitivity or paired-control runs belong to their actual source holder. Include them when the selected Workspace retains their completed run records and artifacts.

## Runtime

Use the accepting host’s existing Node, Playwright and Chromium. The script imports the supplied Playwright module. The original operator must already be running and expose the selected Workspace.

Create a configuration file:

~~~sh
node source/chemistry-report-receiving/browser.mjs \
  --write-example /mnt/data/chemistry-browser-selection.json
~~~

Edit `workspace_key`. The example has the original four IDs, case/project identity, a provenance-specific report title and `restore_study: true`. Each run can additionally supply `report_id` and `source_record_id` when an existing saved edition is intended. Otherwise the real preparation controls produce and retain the current original editions.

~~~json
{
  "schema": "upstate.chemistry-browser-receiving/v1",
  "workspace_key": "ACTUAL_REGISTERED_WORKSPACE_KEY",
  "project_id": "b9d5d257-c6bb-4f07-b975-8e8c63705db3",
  "case_id": "ddd984b567d881798f214530ebf0aef4601ab0744df7af7831bcb17e4e302abb",
  "runs": [
    {
      "run_id": "59d4b738620b469249bb297fa05626012de72a1cdd4e5135a9f6dc4b7f9c8a53"
    }
  ],
  "title": "Upper Savannah Chemistry — authored reference analyses",
  "restore_study": true,
  "task_timeout_seconds": 1200
}
~~~

Optional `contact` has `name`, `organization` and `email`. Use the intended actual document contact. For another original case, replace or omit `case_id` and supply its actual `project_id`. Run/report/source IDs are original 64-character hex identities.

Run against the private original operator URL:

~~~sh
node source/chemistry-report-receiving/browser.mjs \
  --config /mnt/data/chemistry-browser-selection.json \
  --output /mnt/data/chemistry-browser-receiving \
  --url-file /actual/private/operator-url.txt \
  --playwright /actual/installed/playwright/index.mjs
~~~

The URL file stays local. `CHEMISTRY_OPERATOR_URL` is an alternative. The original capability stays in normal browser session storage and is used for same-origin reads. The receiving output retains the origin, not the token or authentication URL.

If needed, `CHROMIUM_EXECUTABLE` names the existing Chromium executable. `--headed` opens a visible window. `--cdp http://127.0.0.1:9222` or `CHEMISTRY_RECEIVING_CDP` connects to existing Chromium. The course creates and closes its own page, retaining the original browser context and existing pages.

Use a dedicated output directory and one receiving process for it.

## Actual product course

1. Select the original Workspace and open its Chemistry catalogue. Verify the completed state and selected case identity of each run.
2. Open its retained result table: calibration observations, uncertainty summaries, or monitoring selected rows.
3. Open or prepare each immutable report. New reports reopen through the **completed task’s own button**, exercising the original extension dispatcher and Workspace identity.
4. Open its actual iframe. Capture desktop 1440×1000 and narrow 390×844 screenshots, including each second-level report section at both sizes. Download the original report and editable/scientific ZIP controls; verify byte lengths and SHA256.
5. Open or prepare each typed scientific source, including its completed-task button. Report/run/source IDs must agree.
6. Use **Open this report only** for the first source and **Add to current report** for subsequent sources. The actual preview must return exactly those identities in their original order.
7. Operate **Preview selected sources** and **Prepare PDF, HTML and data**, or reopen the existing edition returned by that preview. Download HTML/PDF and complete scientific-report ZIP through the original visible anchors.
8. Transfer that saved report to Study transfer, preview its source/history closure and export the one selected report root.
9. With `restore_study: true`, choose that downloaded ZIP in **Receive study archive**, wait for the original `workspace.restore` task, select its returned Workspace and reopen every Chemistry report/source plus the saved scientific report.
10. Save actual browser errors, interrupted tasks if any, source/result IDs, checked downloads and screenshots.

The Study archive carries the maintained source-specific Chemistry history: local cases, completed runs, reports, typed sources and original artifacts. External-workspace sources use the maintained contained-source semantics.

`restore_study: false` is an explicitly export-only course. Normal receiving uses `true`.

## Continue an interrupted course

Rerun the identical command with the **same configuration and output directory**. The journal pins the selection SHA256 and records each original `operation_id` at actual browser submission, before its response. Returned task IDs are retained immediately.

An already submitted action is read through its original task ID. If its response was lost, the course looks up the exact operation in current Workspace state. An ambiguous lookup produces a retained exception. Reconcile that original `operation_id` in Operations and continue its task; preserve `receiving.json`.

Failed/interrupted/cancelled native tasks retain their actual exception. Correct the original source/runtime issue with its owner, resume the same task in the application, then rerun this course. Existing report/source IDs reopen directly.

The browser’s original draft and pending-request handling remain in place. A changed selection uses a new receiving output so different case identities remain distinct.

## Read the result

`receiving.json` holds original input selection, per-run report/source IDs, combined scientific report ID, original operation/task identities, Study ZIP and received Workspace key.

- `records/` contains the actual API responses used for Workspace, results, previews, tasks and report/source editions.
- `downloads/` contains original control downloads, each checked against retained bytes/SHA256.
- `images/` contains desktop/narrow views, report sections, queued states and actual failure images.
- `views/` contains loaded report HTML and the actual error DOM if interrupted.
- `REVIEW.md` links the actual screenshots.
- `visual-review.json` is written by the producing reviewer after opening the images/product: inspected files, findings, repairs and current source edition.

`browser_course_complete` records completed controls/downloads/receiving. The automatic `visual_review.state` remains `awaiting_actual_image_review` until a producing peer opens the actual images or application and records that inspection. Layout/text counts support the work.

## Visual and scientific inspection

Open the exact saved report and desktop/narrow images. Read the title, source provenance, key conclusions and full physical accounting tables. Inspect every section for clipping, overlaps, unreadable labels and missing figures. Operate wide table scrolling. Open the downloaded PDF and inspect units, markers, pagination and table headings.

Calibration distinguishes fitted/held-out rows, exact/censored/interval references and the full retained measurement operator. Inspect original convergence, termination and error scales; interval distance and endpoint inclusion remain the engine’s quantities.

Uncertainty retains its actual parameter prior, seed and draw count. Read the pointwise quantile and prior-variation meaning. A composite quantity uses the original per-draw operator. Retain conserved mass basis and integration duration.

Monitoring retains the selected observations and actual precision/design criterion. The authored reference case’s optimized coefficients and monitoring design remain visibly identified by their original provenance.

Operate both prepared-source controls, verify order, download files, reopen the saved report and received Study. Fix visible defects with the original renderer/controller owner, rerun that exact repaired edition and retain the prior receiving result.

Return accessible image/file handles through the existing native operation so producing peers can look at the pixels. A path on another host by itself cannot support image inspection.

## Maintained contracts and primary references

The driver uses the actual Workspace selector, Chemistry controls, Scientific Reports controls and Study controls. Reads inspect original records. Submitted actions are limited to report/source preparation, scientific rendering/export, selected Study export and ordinary Workspace restore.

Playwright’s [download API](https://playwright.dev/docs/api/class-download) saves real download bytes. Its [response waiting API](https://playwright.dev/docs/api/class-page#page-wait-for-response) starts waits before the triggering control. Its [browser close contract](https://playwright.dev/docs/api/class-browser#browser-close) distinguishes launched browsers from connected sessions.

Native scientific results and user-facing reports remain the maintained product implementations.
