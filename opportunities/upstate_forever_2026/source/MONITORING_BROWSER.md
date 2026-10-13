# Operate the prepared regional Monitoring campaign

This browser journey opens the actual source-bound network, saved design and editable campaign produced by the original regional preparation. It operates the maintained Monitoring design desk, downloads its HTML report and field package, receives a complete workspace through the original operator form, and reopens the same network, plan, campaign and field calendar.

The saved preparation supplies the original geometry, stations, planning costs, dates and campaign identities. The browser reads those retained records directly. Its working-input exercise edits the calendar draft, checks navigation retention, corrects invalid advanced JSON, and reopens the saved campaign. Native report and receiving operations use the existing task queue.

## Prepare the original campaign

From the current application, run the maintained preparation against the existing scientific workspace:

    python source_tools/prepare_regional_monitoring.py \
      --workspace /actual/scientific-workspace \
      --output /actual/regional-monitoring

The preparation guide is source/REGIONAL_MONITORING.md. Preserve its original domain and station source selections and the explicit planning policy. A completed native operation produces:

- /actual/regional-monitoring/monitoring-opening.json: the immutable original project, operator workspace, retained sources and native planning selection.
- /actual/regional-monitoring/receiving/receiving.json: the original network, feasible design and campaign IDs, full native source bindings, and completed receiving summary.

When using the complete regional progression, its original native Monitoring journal is PROGRESSION_OUTPUT/monitoring/receiving.json. Select the opening associated with that exact native selection. The driver checks the complete preparation selection and original project against the journal before opening the browser.

The receiving tool's independent copy can have its own later campaign title revision. This browser opens the sender campaign named in the journal, exports its actual current revision, and checks a newly received copy against that same selected revision.

## Run the native browser journey

Use the private startup URL file from the original operator. It contains the original HTTP/HTTPS address and capability fragment. Run with the existing Playwright installation and Chromium used by the other native browser journeys:

    node source/run_monitoring_browser.mjs \
      --url-file /actual/private/operator-url.txt \
      --opening /actual/regional-monitoring/monitoring-opening.json \
      --receiving /actual/regional-monitoring/receiving/receiving.json \
      --output /actual/regional-monitoring/browser \
      --video

The optional --workspace value must equal the opening's operator_workspace_key; the maintained progression wrapper can pass that original value. Use --headed to watch the operation and --browser-channel NAME for an already installed compatible browser. --task-timeout-seconds defaults to 3600 and controls observation of an original queued operation.

The operated workflow:

1. Open the original registered workspace and current Monitoring design desk. Verify the saved network, design, campaign and source bindings against the actual preparation.
2. Open the retained network in its original selector, render all original catchments, and inspect an actual map feature.
3. Open the saved design and campaign. Compare every visible calendar row with its actual visit ID, source-station binding, date, local time, crew and retained status.
4. Edit the existing calendar draft and navigate through Original sources back to Monitoring. Check that the draft survives, then restore its original values.
5. Enter invalid advanced JSON in the real design form, observe its native correction message, correct it, and reopen the same saved campaign.
6. Export and download the original HTML report, complete field package and editable workspace. Each downloaded file must match the native file ticket's byte count and SHA-256.
7. Open the same saved campaign in a fresh browser context and compare its original records and rendered calendar.
8. Upload the actual complete workspace through the native receiving form. Open the independently registered workspace and compare the complete network, plan, campaign, calendar and original source bindings.

This operates current shared UI, including WATERLINK12's network opening and readiness joins, the original campaign controls, and the observed-context successor. The driver is additive under source/ and uses those maintained APIs.

## Include an existing observational context

If the original observational workflow has already saved support for this exact campaign revision, add:

    --context-id ACTUAL_SAVED_CONTEXT_ID

The browser opens that record through the real Saved context selector, verifies its original network, plan and campaign revision, and includes it in each original campaign export. The same saved context is reopened after workspace receiving and must retain its complete original content.

The source owner’s original ingestion and station mapping remain in model/MONITORING_OBSERVED_CONTEXT.md. Choose the actual saved context ID after that workflow has completed.

## Continue after browser or worker interruption

Repeat the same command with --resume and the original explicit --output directory:

    node source/run_monitoring_browser.mjs \
      --url-file /actual/private/operator-url.txt \
      --opening /actual/regional-monitoring/monitoring-opening.json \
      --receiving /actual/regional-monitoring/receiving/receiving.json \
      --output /actual/regional-monitoring/browser \
      --resume

The opening and receiving files are pinned by their exact bytes. The selected campaign revision and complete native records are also pinned when first opened. If the original campaign advances independently, use a new output directory for the new revision.

Before each queued export or receive, request-state.json atomically retains the complete original request and operation ID. The accepted task ID is flushed immediately after its reply. A continuation reads that same task, replays the identical operation after a lost reply, or resumes the original interrupted/failed task through the native endpoint. Each of the three export formats has its own retained stage. A completed export remains the same actual file during that continuation.

Both request-state.json and journey.json use atomic flushed replacement. Keep request-state.json private: it contains native operation payloads, upload references and original file tickets. The public journey redacts the startup address and capability.

## Output and receiving progression contract

The output contains:

- journey.json: status, original selection, source and calendar checks, actual task IDs, file hashes, screenshots, and any first failure.
- request-state.json: private durable original request intentions and accepted tasks.
- exports/: original report HTML, field-package ZIP and complete workspace ZIP.
- PNG screenshots and optional video of the actual operated pages.

A completed journal uses schema upstate.monitoring-browser/v1, status complete and the original workspace_key. Its input contains opening_sha256, receiving_sha256, workspace_key, project_id, network_id, plan_id, campaign_id and context_id. Its received_workspace_key identifies the independently reopened native workspace. The complete progression can adopt that finished journey using these exact fields, or pass --resume when the same output retains request-state.json.

The original operator capability remains in the private URL file. Native API observations send it only to the original origin with redirects disabled. Screenshots capture page content; the address bar is outside the captured page.

## Current source

The maintained regional preparation is PR3278. The Monitoring browser consumes the composed WATERLINK12/observational client from PR3238 and PR3261, the original Monitoring APIs, and the existing native workspace receiving form. Complete scientific project contents, source bindings, campaign history and generated files travel through those original mechanisms.

## Use an existing Chromium executable

When the receiving machine already has a working Chromium binary, add `--browser-executable /actual/installed/chromium`. The driver passes that explicit path to the existing Playwright launch. Choose either this option or `--browser-channel NAME`; omitting both retains Playwright’s bundled Chromium selection.

The public journey records the requested browser kind, executable path or channel, and headless setting in `browser_runtime`. A resumed attempt preserves its previous runtime selection in the attempt history. This runtime choice is separate from the original scientific input and task fingerprints, so a repaired or newly available browser can continue the same retained requests with `--resume`.

## Shared worker memory

On a worker shared with other native jobs, `--browser-renderer-limit 2` asks Chromium to limit its renderer process count. The accepted range is 1–32; omitting it preserves Chromium’s normal choice. Combine it with the retained executable selection, for example `--browser-executable /tmp/chromium --browser-renderer-limit 2`.

This launch setting is recorded as `browser_runtime.renderer_process_limit` and stays outside the scientific selection and original request identity. After an operating-system termination, reuse the same `--output` with `--resume`; the driver reopens its exact saved campaign and resumes any retained original tasks. The browser limit is a Chromium process hint, not a total worker memory cap, so schedule large source imports and archive operations sequentially on a constrained worker.

`journey.json.current_step` is written atomically before browser launch, native opening, each export, fresh-browser reopening and complete receiving. A hard worker termination therefore leaves the last active operator stage alongside the existing exact request state, even if it occurs before the first screenshot.

## Open an existing campaign after transfer to another computer

A full scientific Workspace contains the original Monitoring network, design, campaign revisions and retained source objects. The preparation opening and browser execution journals can live outside that archive. On a receiving computer, select the existing native records directly with `--restored-selection`. This starts a browser operation bound to the receiving operator's actual workspace key; it does not import another network or recalculate the design.

Write a UTF-8 JSON selection using the original IDs from the completed receiving record or the native Monitoring library:

```json
{
  "schema": "upstate.monitoring-browser-selection/v1",
  "project_id": "ORIGINAL_PROJECT_ID",
  "network_id": "ORIGINAL_NETWORK_ID",
  "plan_id": "ORIGINAL_PLAN_ID",
  "campaign_id": "ORIGINAL_CAMPAIGN_ID"
}
```

The optional `context_id` selects retained observed context bound to that exact campaign revision. The existing `--context-id` flag may supply it when the file omits it; if both are supplied they must agree.

```sh
node source/run_monitoring_browser.mjs \
  --url-file PRIVATE_OPERATOR_URL_FILE \
  --restored-selection monitoring-browser-selection.json \
  --workspace ACTUAL_RECEIVING_OPERATOR_KEY \
  --output RECEIVING_BROWSER_DIRECTORY \
  --browser-executable /tmp/chromium \
  --browser-renderer-limit 2
```

Use the receiving operator's `workspace_key`, which is derived from its actual registered directory. The native project ID remains the scientific project's original ID. The browser reads `/api/state?compact=1`, the original Monitoring network, plan and campaign, and the retained vector catalogue. It checks the project, native record relationships, source collection and entry IDs, and original object hashes before operating the complete map, calendar, draft correction, exports and independent receiving course.

The selected JSON file's SHA-256, actual workspace key, original IDs and chosen context are frozen in the new `request-state.json`. The full native network/plan/campaign/calendar/source-binding fingerprints are retained after their first read. Continue an interrupted operation with the same selection bytes, actual key and output directory plus `--resume`. The original opening/receiving mode keeps its previous input identity and remains available unchanged. A fresh receiving operation gets its own output directory; original request files from a different workspace retain their original identity.

All modes use the same original queued export and Workspace restore requests. Report and project downloads retain the native file tickets' exact byte lengths and SHA-256 values.


## Continue through a saved budget comparison

After the saved-budget UI and native comparison provider are installed, the same browser journey can operate an existing frontier as part of the original campaign course. Add `--comparison-selection BUDGET_SELECTION.json` to either existing input mode.

The optional file is:

```json
{
  "schema": "upstate.monitoring-budget-browser-selection/v1",
  "frontier_id": "ACTUAL_SAVED_FRONTIER_ID",
  "baseline_plan_id": "ACTUAL_PLAN_ID_FROM_THAT_FRONTIER",
  "context_ids": [],
  "title": "Retained regional monitoring budget choices"
}
```

Use an actual frontier from the selected network. Its complete original record supplies the ordered `plan_ids`; the paged frontier library summaries do not include that inventory. Omit `baseline_plan_id` to use the first original plan. Each optional context must name the exact network and one of those saved plans; select at most one context per plan. The driver normalizes selected contexts to original frontier-plan order without changing the supplied file or its hash.

The existing campaign plan may be different from the frontier plan at the same budget. Keep the original campaign selection unchanged. The browser explicitly reopens that campaign after operating the frontier and before the existing report and full Workspace export stages.

This optional continuation:

1. Reads the actual native frontier and preview, then freezes the original frontier, plan and context fingerprints in the existing request journal.
2. Opens **Saved budget choices**, selects the baseline and original observed contexts, and compares the displayed complete preview with the native response.
3. Saves the comparison through the original queue. The existing request interceptor retains the exact payload and operation before sending it; resume reenters that original task.
4. Reopens the saved comparison from its native library and opens one exact original plan in the existing map/calendar desk.
5. Downloads the complete comparison ZIP through its original task-detail file ticket, checking the actual bytes and hash.
6. Returns to the original campaign and completes its normal exports.
7. Reopens the saved comparison in a fresh browser and again after the same full Workspace transfer, comparing complete native records and rendered source details.

The journey records the new comparison ID, source fingerprints, screenshots and downloaded package alongside the original campaign outputs. Both additional queued stages (`budget-comparison-save` and `budget-comparison-export`) use the existing durable request-state file and original task-resume behavior.

Commands without this option preserve their previous input object and resume identity. A comparison file adds its exact SHA-256 and parsed selection to `journal.input.comparison`. Resume with the same file, selections and output directory. To add comparison work to an already completed earlier browser course, choose a new output directory for the expanded intent.

The optional route opens retained solver results. It does not submit `monitoring.design` or `monitoring.frontier`. Newly prepared observed contexts must first be saved through the original observed-support workflow; this selection then references their actual immutable IDs.


For the completed original b9d5 scientific Workspace, the actual retained three-budget frontier selection is:

```json
{
  "schema": "upstate.monitoring-budget-browser-selection/v1",
  "frontier_id": "2c1c770ffb1b00c85995a58ad93823407a628052b7b2b01d58aeced5387d12e5",
  "context_ids": [],
  "title": "Regional 217-catchment monitoring budget choices"
}
```

The native receiver reads this frontier's actual ordered plans and uses its first plan as the baseline. The original separate six-area campaign remains the campaign selected by the existing Monitoring browser selection. Attach observed contexts only after reading their actual saved IDs for these exact frontier plans.
