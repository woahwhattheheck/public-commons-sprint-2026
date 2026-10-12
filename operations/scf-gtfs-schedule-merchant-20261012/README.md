# Complete original NWConnector GTFS receiving

This is the operating continuation for SCF-GTFS-SCHEDULE-MERCHANT-6200-20261012. It runs the original product from source commit 71a9cc717d4372f8210ca57c2fa92c3905a76c9b and retains its one private operation journal. The source manifest selects the complete original native dependency closure; it verifies each Git blob before starting the application.

The input is the original public NWConnector GTFS ZIP already retained by its source owner:

- Filename in that original workspace: nwconnector_gtfs.zip
- Bytes: 826,295
- SHA-256: 68807e2b9f3b6238b214694fe7787dcb6a28ddcce45600034864c5e59bb4e985
- Original URL: https://oregon-gtfs.trilliumtransit.com/gtfs_data/tillamookcounty-or-us/tillamookcounty-or-us.zip
- Publisher: Trillium Solutions Inc.; feed edition 2026-09-30.
- Original source calculation for 12–18 October: 651 scheduled trip instances and 9,022 stop calls across all agencies; Tillamook agency22 has406 instances and5,894 calls.

The command verifies those original ZIP bytes. A later file at the same public URL is a different source edition.

## Run the same complete operation

Use the existing Node24+ and Python3.11+ runtimes with Linux flock and renameat2 support. The GTFS compiler and archive reader use the Python standard library. Native publication uses the original Node SQLite publisher. No model call or paid provider request is part of this receiving command.

~~~bash
node operations/scf-gtfs-schedule-merchant-20261012/receive.mjs \
  --source-root /absolute/selected-scf-source \
  --directory /absolute/private-original-operation \
  --archive /absolute/original/nwconnector_gtfs.zip \
  --source-manifest operations/scf-gtfs-schedule-merchant-20261012/source-manifest.json
~~~

The selected source can be the complete original Git checkout or its fully verified manifest closure. The three Python files and original Frictionless package are required, as are the original browser assets and developer client runtime included in the manifest. The program checks all declared files before opening a workspace.

To include the real published and received browser views in that same sequential operation, add the existing installed Playwright module and Chromium executable:

~~~bash
  --browser-module /absolute/installed/playwright/index.mjs \
  --chromium /absolute/installed/chromium
~~~

The browser is started and closed by this same receiving owner; it retains full-page images and page-error results in the private operation. Only one service/browser ownership chain runs at a time.

The command emits its actual PID, private operation root and current native phase. Reuse that exact directory and original source input after an interruption. Its journal preserves request UUIDs, saved revisions, source selections, native plan/run IDs, export identities and completed downloads. It reconciles the original saved native requests and published result before continuing.

## Native product sequence

1. Start the original CLI and verify its launch UUID, canonical path, PID and actual listener through the same managed Applications startup observer.
2. Exercise the original first-publication recovery with its retained initialization and initial workspace bytes. Read-only inspection preserves the staged links; the actual acquired root writer completes their original publication.
3. Retain the complete original ZIP through the browser's native upload endpoint. Inspect all feed members, original tables, agencies and routes.
4. Compile both complete service-date selections while retaining each chosen original physical table. Compare the exact editions, record the explicit source decision and select Tillamook for publication.
5. Save the native Frictionless query plan and run the original extraction. Inspect the 406-row dataset through the original publisher HTTP query preview; review and publish that exact candidate in the original version store.
6. Prepare the whole SF82 package with the original SF30 example payment declaration from examples/service.json, Git blob f44b91dbbafbf8e9ead1eab41d2a30065d286d86. Stage that retained source package in the original release store.
7. Serve all original publisher/GTFS browser assets together. Export and recover the same complete workspace archive request.
8. Reopen with the original merchant adapter. Recover the saved import when its declared original host input is unavailable, inspect through the borrowed native publisher, and download both the complete source ZIP and complete workspace archive through the original SHA-bound file reader.
9. Inspect the complete archive, receive it into a new private workspace, and reopen its selected capture, original publication history and native dataset generation. The original publisher settings relocate to this actual destination.
10. Record a following operator decision in the received workspace, recover the same receiving reply, and verify that later decision/revision survives. Export the complete received workspace and close every owned native service and reader.

The published and received workspaces retain original plans, source captures, schedules, comparisons, decisions, source packages and dataset generations. The source edition's original license metadata remains unchanged.

## Retained result

The same private operation contains:

- operation.json: durable original input, request identities, current phase and recovery state.
- result.json: terminal native result, complete counts, source selection, native plan/run/snapshot identities, archive and receiving results.
- workspace/ and received-workspace/: complete original live workspaces.
- workspace.exports/ and received-workspace.exports/: complete original archive journals and files.
- received-original.gtfs.zip and received-complete-workspace.tar.gz: complete original merchant downloads.
- seller-releases/: the original staged SF82 source package.
- browser-published.png and browser-received.png when the installed browser was selected.

Return the complete result and archives through the original product's artifact route before retiring an equipped worker. Keep the exact operation root while any original phase remains active.
