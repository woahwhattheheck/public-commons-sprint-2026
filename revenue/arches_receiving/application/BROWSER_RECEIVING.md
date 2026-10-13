# Operate and inspect the actual Arches staff browser

This additive driver opens the existing Arches staff application and operates its real controls. It uses the same original publisher cohort and original workspace/CSV/release/archive engines as the completed HTTP programme. The HTTP programme remains intact. Run this browser leg afterward within that same admitted producer, against a new empty staff workspace owned by the producer.

## Receiving contract

The producer starts the current original application with a fresh private workspace and keeps that service alive:

    python3 -B application/arches_app.py serve --workspace /OWNED/browser-staff-workspace --port 0

Consume its actual JSON READY line. Pass its URL and private staff-token filename to the driver. Use the current styled index.html and original application modules together. Preserve the stable DOM IDs; the driver does not interpret raw preview JSON or inject replacement UI.

    node application/browser-receiving.mjs \
      --url http://127.0.0.1:ACTUAL_PORT \
      --token-file /OWNED/browser-staff-workspace/private/staff-token \
      --cohort /OWNED/publisher-source \
      --output /OWNED/browser-receiving \
      --application /OWNED/application/arches_app.py \
      --playwright /ABS/EXISTING/playwright-core \
      --chromium /ABS/EXISTING/chromium \
      --python /ABS/EXISTING/python3

All paths are absolute. Python and Chromium executable symlinks are resolved to their existing canonical files and those executed paths are retained; the credential must remain a private regular file. The selected existing Playwright runtime must be version 1.31 or later; its original package version and actual browser version are retained. The driver checks that requirement without installing or upgrading anything. ARCHES_PLAYWRIGHT, ARCHES_CHROMIUM and ARCHES_PYTHON may supply their corresponding existing paths. The executable never installs a browser, package or runtime and never discovers another worker. If this existing receiver requires a Chromium flag, supply each explicitly, for example --chromium-arg --no-sandbox only when required by that receiver's established container configuration.

The original shared admission must cover the browser, original staff service, temporary restored service, source, two complete workspace editions, downloaded archives and actual screenshots. Register the selected installed runtime paths using that same controller's existing contract. Do not create a parallel native job or start the browser outside the existing admission.

The output directory must be new or empty. A retained nonempty directory is a receiving/recovery input: inspect its journal, original application session state and workspace before another physical continuation. Do not delete it or import the cohort again merely because a response was lost.

## Actual browser course

The driver verifies every COHORT.json member before opening the selected service. It requires a genuinely new original workspace at revision zero, with no snapshots or releases.

At both 1440 × 1000 and 390 × 844, it retains full-page PNGs of:

- Staff access and its actual missing-token validation.
- A real pending status request and disabled controls. The request is delayed and then continued unchanged; no synthetic response is substituted.
- The empty workspace, baseline receive form, populated review and original resource detail.
- An empty filtered review selection, complete baseline CSV preview and the accepted baseline release.
- The second original edition's receive form, changed-resource review and concrete foreign-tile ownership diagnostic.
- The original blocked approval error and the reviewed rejection CSV.
- An interrupted local response with the exact pending operation, its subsequent recovery, and accepted releases.
- The complete workspace reopened from its downloaded archive, original detail and releases.

Important controls are exercised through the actual page: navigation, file selection/upload, complete/partial and format selectors, edition selectors, change filters, selection/clear, Inspect, source download, review CSV download/upload/preview/apply, release creation and both archive downloads. Read-only HTTP observations verify the saved state; they do not replace those UI mutations.

The unchanged historical cohort contains one original baseline resource with two tiles and a later wrapper with three tiles. The added tile belongs to a different resource. The driver requires TILE_RESOURCE_MISMATCH in both the original response and the rendered detail. It submits a completed approval CSV and checks the actual 409 diagnostic without a workspace revision change. A rejection then retains the accepted original resource and its earlier graph/vocabulary context.

The two review CSVs are received through Python's standard csv module. Only decision and reason are filled; all original columns and identities remain. The browser downloads, selects and previews those exact files through the real UI.

## Exact operation recovery

For the second accepted review, the driver deliberately interrupts one successful local response after the original server commits it. It first saves the exact request and returned result as original-lost-response.json, then aborts only the browser delivery. This is a controlled response-loss exercise, explicitly identified in browser-result.json.

The application itself retains its original pending operation in sessionStorage. After reload, the Open workspace control invokes the existing recovery path. The driver checks the same request identity, identical returned result, unchanged saved revision and cleared pending marker. It never invents a replacement operation or edits the application database.

browser-events.jsonl retains complete original JSON mutation bodies, including operation IDs and expected revisions, plus source-upload route observations. It excludes authentication headers, cookies, raw traces and HAR. Staff-token fields are masked in every screenshot. Both known service credentials are redacted from retained error strings.

## Download and whole-workspace receiving

All downloaded files are saved from actual Playwright download events. Every archive and review CSV is compared with the original service's exact bytes/SHA-256 response. The selected raw-resource download is checked against its original cohort identity.

The original Workspace.restore verifies the complete downloaded archive and database/source history. The driver additionally opens the real release ZIP, verifies every declared member, compares the accepted resource against the original baseline using the exact-number canonical JSON API, and receives its business_data.resources through the existing streaming parser. Both retained CSV histories must reopen with exact hashes.

The restored application files are checked against the current executing source before their service starts. A temporary owned loopback service then opens that received workspace in the browser. Its full workspace state must equal the original final state. The driver inspects the same resource, views releases, and downloads the reopened release through the original UI.

## Completion, ownership and actual image review

browser-result.json contains complete, workflow_complete, services_closed, browser_closed, owned_processes_closed, original and cold workspace identities, selected edition/release IDs, phases, original source identities, all screenshot/download hashes, a declared artifacts array, browser errors and page-overflow observations.

services_closed refers to the temporary restored service owned by this driver. The producer still owns the original supplied staff service and must stop it after the driver returns. Preserve that distinction in the encompassing native result. The browser/context and restored service are always closed in finally; a failed course retains its result and images.

A successful automated course deliberately reports visual_review_complete: false. VISUAL_REVIEW.md lists all actual image files and starts at PENDING_IMAGE_REVIEW. The responsible producer must open and look at the desktop and narrow images, inspect readable layout/content/controls, and investigate every page overflow or browser error. Capturing images alone does not satisfy visual receiving or establish customer readiness.

The result's artifacts array selects only intended published outputs, each as {path, bytes, sha256, kind}. Paths are relative to --output; kinds are screenshot, download, receiving or log. It includes the full PNGs, exact browser downloads (including the portable workspace ZIP), filled CSVs, original request/response, browser events, cohort identities and cold-receiving result. It excludes the private restored workspace, staff tokens, session storage, temporary runtime files and the lock. The encompassing producer verifies each declared path, rejects symlinks and mismatched bytes/hashes, and includes only those selected files plus browser-result.json under receiving/browser/. The result itself is separate from its artifact list to avoid a self-referential hash. Save the complete delivery before the producer exits, then open those retained images for actual review. Record findings and source corrections in the original case/source, and repeat only the affected original course when a concrete correction requires it.

## Source and execution status

This driver is an additive receiving tool over the original Arches product. The same product owner controls the source overlay, admitted native programme and final output save. Source parsing or publication is not an actual browser run. Report actual browser execution and image review only after those steps return their real outputs.

## Original browser API references

The receiving driver uses the maintained [Playwright Route API](https://playwright.dev/docs/api/class-route) for continuing the actual delayed request and fetching one original response before controlled delivery loss. The fetch does not follow redirects and retains the default zero network retries. Its [Download API](https://playwright.dev/docs/api/class-download) supplies the actual downloaded files, which are saved and compared with original service identities.
