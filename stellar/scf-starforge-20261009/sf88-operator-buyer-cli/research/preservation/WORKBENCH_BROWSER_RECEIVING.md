# Original preservation workbench browser receiving

This runner opens the same completed 169-record Workbench produced by the full Preservica HTTP receiving operation. It edits the source review through the actual browser, retains the original provider operation, downloads native and complete packages through the real links, and cold-opens the application received from that complete download.

It does not start another source intake, upload, provider fixture or customer-tenant operation. First run the complete provider packet d9ab8e90021d5572ee573658e0a5945d83324523 and its run_preservica_receiving.py582e266cdafede85176215f60f09012f7bcdf307. Receiving-result.json must say PASS,169records and VERIFIED, with the original operation ID below.

## Source and dependencies

Application source is the complete16-file closure from PR2102 head67556acb5d51a7626e1a6e49c6795ee6e67144c2. Every included application file is pinned in the runner, including the original preservation/OAI/RODA foundation and all provider/operator guides. Later integration changes must be composed from their full source and reviewed before changing this receiving identity.

Use Python3.11 or later, Node22 or later, an existing Chromium/Chrome executable and an installed Playwright module. The runner installs no dependency and downloads no browser. Pass the actual module and executable paths explicitly when they differ from the original host.

Actual original-host dependency inventory:

| Component | Actual selected source |
|---|---|
| Node | v24.19.0 at /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node |
| Playwright |1.62.1; /opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs |
| playwright-core |1.62.1; adjacent playwright-core directory |
| Browser |/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell;204,672,336bytes, executable |
| Playwright package.json SHA256 |ca170ec143a88ed3043ac953eb3b2377b2b97304104f4e1e23316684ce2c35af |
| playwright-core package.json SHA256 |07c47543631fef9508760365dee9fbe958c562093ec8d122543949ed231f233f |

This inventory describes the original host. It does not imply those dependencies are installed on a different worker. The run records its actual Node/version, module-entry and package hashes, browser executable/version/hash and Python version.

## Run the same complete browser journey

Keep run_workbench_browser.mjs and workbench_browser_support.py together. With the actual original provider receiving completed at RECEIVING:

~~~bash
node receiving/run_workbench_browser.mjs \
 --application RECEIVING/received-partial/application \
 --workspace RECEIVING/received-partial/workspace \
 --operation-id preservica-original-169-local-receiving-20261012 \
 --output RECEIVING/browser-output \
 --receiving-result RECEIVING/receiving-result.json \
 --playwright-module /opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
 --browser /workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell
~~~

Optional flags are --python EXECUTABLE and --timeout-ms MILLISECONDS (60,000 through1,800,000; default600,000). The two input files remain exact and the output directory stays outside the active source workspace.

The original provider servers must be drained before this browser phase. The runner starts the included Workbench's normal localhost server on an available port. It keeps one original server at a time, drains it before receiving/opening the downloaded application, and closes Chromium at completion. It uses the selected browser's standard headless/no-sandbox mode, one renderer-process limit and its own temporary directory.

## What actually runs

1. Open the original169-record source and its one original VERIFIED destination. Verify the saved configuration, source review, original upload/progress/handoff IDs and all169 verified records.
2. Correct one real record title and temporarily exclude another, each with an explicit reason. Save through the original Store revision check.
3. Hold the actual successful save HTTP response after the server commit, type a later sentence into the review note, and return the original response. Verify that later typing remains in the unsaved draft, then save that retained draft.
4. Apply the complete baseline JSON. While its actual validation response is delayed, change the record search and verify that the current search survives the later response.
5. Save the complete baseline again. The review contentSHA is unchanged from the initial baseline but its new revision remains a distinct selectable historical identity.
6. Select the original saved destination, then return to a separate unsaved destination draft. Check complete configuration/settings/revision retention and per-provider draft independence. Do not prepare or run a new destination.
7. Build/download native packages at both exact historical revision:SHA selections. Verify and receive each with the original preservation API. The packages retain different revision identities even though the restored review content is equal.
8. Capture desktop1440×1000 and narrow390×844 screenshots, including source review, saved/unsaved destinations and delivery. Detect whole-page horizontal overflow from the real browser layout.
9. Download the full application/workspace through the actual export UI. Verify the original provider journal/prepared-file inventory stayed byte-identical.
10. Drain the original server, receive the complete ZIP through the supplied native receiver, import that received application and open its Workbench. Verify the same169-record VERIFIED operation, original IDs, full saved/unpublished review history and exact original historical package download.
11. Drain both original/received Workbench processes and the browser. Retain complete phase requests/responses, source identities, download hashes, screenshots and results.

The source review changes are explicit receiving examples. The final saved catalogue restores the complete initial review content with all169 records included. All intermediate revisions remain retained. If a process loss requires a second explicit browser typing observation, the runner records those extra temporary revisions and then restores the baseline again; it does not replace earlier committed history.

## Interrupted receiving

A committed review whose HTTP response was lost is reconciled from its immutable original request, current saved review, and published ancestry. Reopening that reconciliation revalidates its original recorded observation; it does not publish a new timestamp over the same receipt. A previously retained JSON-preview fence is likewise reused after checking its exact query and record identity.

If a process ends after a late-save observation commits but before its typing proof is retained, the runner first restores the complete baseline through the original saved restore request. It records that numbered observation as lacking typing proof and then begins a distinct, explicitly numbered observation pair. It never repeats the committed save or claims that unrecorded typing was observed. Each completed pair retains its own two revisions and receipts, so a subsequent continuation can reopen it exactly. The first successfully retained typing proof completes this phase; the normal uninterrupted journey needs no extra pair.

Use the same command, source, operation and output directory. The runner reopens complete phase receipts, exact original PNGs/downloads and package identities. It never repeats a provider write.

Review requests are retained before the real browser save is forwarded. If a response is lost after a server commit, the current review/revision and published history are compared with that immutable request; the result is recorded as commit readback, not invented HTTP-response bytes. Complete original screenshot bytes have a retained capture descriptor before final publication, so a missing later sidecar can be recovered without redrawing different pixels.

A complete workspace export is selected from its own saved local queue request and job ID. It is not confused with an earlier unrelated export. The received application may mark its archived local RUNNING export job INTERRUPTED on opening; this expected local queue transition is preserved separately from the unchanged original provider operation.

The support script verifies all archive members on first complete receiving. When reopening that same received workspace, it preserves the application's later jobs/artifacts records and checks the original immutable source/application/prepared members. The browser checks the original full prepared-journal inventory separately before and after cold opening.

A concurrent source review, changed application file, contradictory saved request, provider identity mismatch or changed immutable archive remains a concrete error. Keep its original receipts and reconcile it before reusing the same operation.

## Outputs and visual review

- browser-result.json: complete actual result, identities, phases, check outcomes, image list and artifact inventory.
- Preservation_Workbench_Browser_Receiving.html and .md: standalone receiving report.
- screenshots/: eleven original desktop/narrow PNGs with exact capture identities and viewport/layout metrics.
- downloads/: both revision-specific native packages, full Workbench ZIP and the cold original-package download.
- received-workbench/: complete native received application, workspace and operator state.
- phases/,drains/,network-*.json: retained original UI actions, local queue/commit recovery and process/network boundaries.
- source/: exact runner/support code.

PASS is a native browser/HTTP/receiving result. The report explicitly leaves independent image inspection pending. Open the actual PNGs, inspect text/controls/overflow/layout, and record the review separately; DOM checks alone are not a visual inspection. A customer Preservica tenant has not been contacted by this example.

The output contains bibliographic metadata and local fixture configuration with token-environment names. It does not contain a customer's token. The browser is restricted to its original local Workbench origins and is required to make no upload/run/refresh/reconcile action.

## Preserve before releasing a private worker

When a worker's /dev directory is private to one invocation, save the complete downloaded ZIP, reports, result and screenshot/source bundle before that producing invocation ends. Do not rely on a held terminal surviving disconnect. Preserve original artifact names/hashes and the provider's save receipts; reopen this same received workspace rather than rerunning the original169 provider fixture.
