# Original publication delivery continuation

This caller completes the downstream delivery of an existing approved publication. The original analysis/source owner supplies actual workspace, publication and export identities. The original buyer owner supplies an actual saved output. This programme does not reconstruct a lost capture or assert that an unexecuted purchase completed.

## Existing-page API

Import the installed **./sensorthings/analysis/merchant/native** export, or the source module **native-journey.mjs**, in the original browser owner's programme:

~~~js
import {runMerchantDelivery} from './native-journey.mjs';

const prepared = await runMerchantDelivery(originalInput, {
  page: originalOwnedPage,
  signal: originalAbortSignal,
  progress: originalProgress
});

// After the original buyer operation has produced its retained output:
const completed = await runMerchantDelivery(originalInput, {
  page: originalOwnedPage,
  receiving: exactSavedOutputSelection,
  signal: originalAbortSignal,
  progress: originalProgress
});
~~~

Keep the **same originalInput, operationId and controlDirectory** across both calls. The second argument is a separate exact receiving selection; it does not rewrite the preparation input. The caller claims one private kernel lease over its own control directory. Original domain changes still use the existing workspace writer and its operation journal.

The original page is deliberately reused and navigated among the selected source, receiving and reopening workspaces. Its owner must yield that page for this continuation. No browser, source workspace, buyer Inbox, provider capture, analysis programme or seller host is initialized by the helper.

## Inputs

[native-input.example.json](native-input.example.json) lists every field. Replace the explicit placeholders using the original owner handoff. Three separate **existing** workspace UUIDs are required:

| Input | Required retained state |
| --- | --- |
| source | Current host/private URL file, approved publication, matching source review and completed full project export |
| receiver | Current host/private URL file and its configured private source inbox |
| reopened | A separate current receiving host/private URL file and its configured private source inbox |

Existing receiving workspaces may contain unrelated projects; the original importer preserves them. The caller does not create an empty replacement workspace. The control directory must be separate from both configured inboxes.

The publication map binds projectId, versionId, publicationId/publicationSha256, exportId and complete archive bytes/SHA. Offer terms retain the original explicit payment and release choices. Optional **buyer** prepares the existing SF88 review for the full **project** route and selected payment option; it never dispatches that intent. Optional **startService** is an explicit request to the original long-running host. Historical service state is preserved when a host has stopped, and a lost service start is not silently recreated.

The actual original seller's 16 MiB per-file and 64 MiB total capacities are checked. Complete source/project bytes are never trimmed.

[native-receiving.example.json](native-receiving.example.json) names the original catalog, handoff and response files by full path, exact destination name, bytes and SHA. It selects the actual original job, catalog row, payment option and receiving decision. The catalog must equal this offer's actual native catalog, and the response must equal this offer's complete project archive. Optional Operations IDs select an existing case/deployment/purchase; the UI performs the actual current preview before committing.

## Existing-browser command

When the original browser owner supplies an actual existing Chromium CDP endpoint, the installed native command can attach to its already open page:

~~~sh
node analysis/merchant/native-cli.mjs \
  --input /absolute/private/original-delivery-input.json \
  --playwright-module /absolute/existing/playwright/index.mjs \
  --browser-endpoint-file /absolute/private/original-browser-cdp.url \
  --page-origin http://127.0.0.1:ORIGINAL_PORT
~~~

Add **--receiving /absolute/private/original-output-selection.json** to continue with the saved buyer outcome. The endpoint file contains the actual loopback HTTP or WebSocket CDP endpoint; it is never printed. The chosen origin must identify exactly one existing page. The command opens no tab or browser and disconnects its client afterward. It does not terminate the original browser process or stop its workspace hosts.

If the existing browser does not expose CDP, use the in-process API on its existing Playwright page. This programme does not enable a new debugger, install Playwright, acquire a browser or replace the current browser owner.

## What completes

Preparation drives the visible publication form, actual original native offer, optional native service and optional SF88 preparation. It downloads the full offer/review records using the maintained streaming file receiver and retains a screenshot. **prepared.json** records the exact offer and original artifacts, with nativeBuyerDispatched=false.

With actual saved output, the same continuation:

1. Verifies and receives the original three input files into the configured receiving inbox.
2. Drives the visible native job/publication selection and current optional Operations preview.
3. Commits the same original project/SF47 receiving operation and verifies its full record.
4. Downloads the original receiving file closure.
5. Uses the existing project exporter to freeze the complete receiving project and delivery history.
6. Downloads that full archive through the same native downloader.
7. Receives it in the separately selected workspace through the original project importer.
8. Verifies the original publication, exact receiving record/files and imported original operation history.
9. Retains receiving/reopening screenshots and **complete.json**.

The complete project export is the portable work product. The native control directory contains the exact caller input, request/result phases, full original downloads and screenshots. Runtime private URL files stay external. The resulting report states actual captured/received/installed outcomes; a prepared offer alone is not a completed buyer outcome.

## Interrupted operation

Before a visible form request can reach **/api/action**, the caller publishes its complete raw request, workspace/origin, operation ID and canonical request SHA. It then reads that original operation. An uncertain reply uses the same saved request ID and exact bytes. A failed operation remains failed until its original cause is resolved and its explicit attributed continuation is used. The caller does not choose a replacement ID.

Completed phases retain their original result SHA and complete result. Retained result verification uses the original store's JSON-byte hash; caller raw-request hashes are separate. Every phase binds the original parent input and workspace context. Foreign imported history cannot become a local execution journal.

First observed screenshots, final Operations observations and complete exports remain frozen. Later workspace edits are reported separately as current state. Receiving into an already advanced same-ID project does not require replacing its current head with a historical snapshot.

The original native downloader resumes its exact manifest and selected directory. A missing downloaded file can be re-received as the same original bytes. A missing native capture or committed domain artifact is reported as unavailable; it is not regenerated as a new scientific observation or purchase.

Keep every original pending/conflicting journal file. A complete digest-bound pre-link caller record can finish publication. Incomplete or contradictory caller bytes require recovery of that original record; they are never parsed into a guessed request. The caller owns and closes its own kernel lease, leaving the original application and native host owners intact.

## Execution status

This source is a portable continuation. Actual provider capture, analytical publication, native purchase, receiving and browser evidence must come from the existing operation's saved records. Neither sample configuration nor source compilation supplies those outcomes. The current Hamburg examples remain categorical; numeric eligibility and original analytical review are unchanged by merchant delivery.
