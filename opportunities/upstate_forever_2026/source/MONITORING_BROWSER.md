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
