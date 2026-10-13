# Continue the original APM2 procurement customer

This example continues the original CanadaBuys customer created from the complete 908-notice, 67-column federal open-tender capture. It operates the retained APM2 qualification, engineering workshare, reports, receiving workspace and merchant publication. The customer archive and its exact source capture are delivered in the original internal opportunity thread.

The HTTP and browser phases run in separate Node processes so that report/export buffers from the first phase can be released before Chromium starts. Both phases use the same original SQLite workspaces.

## Restore the retained customer

Restore the latest original customer archive with the authorized file service, verify its recorded byte count and SHA256, and retain its original root directory. Preserve these existing members:

- `operator-workspace/workspace.sqlite` and `receiving-workspace/workspace.sqlite`;
- `case-result.json`, `case-input.json` and the complete original open CSV;
- `apm2-operating-content.json`, which contains the source-linked qualification and the internal CAD 7,200 engineering workshare;
- existing `operator-api-journey`, `operator-journey`, `tool-journey` and merchant publication directories.

Materialize the selected complete repository source and original dependency closure under `<customer-root>/source`. Keep the selected source commit and original file hashes with the receiving record. The continuation reads the saved customer; it does not import a fresh substitute feed.

Set `CANADABUYS_CASE_ROOT` to that original customer root. Set `TMPDIR` to a private temporary directory inside it. Use the existing customer operation lock while the programme owns these databases, and keep one receiving owner for this operation.

## Finish the HTTP, merchant and Applications workflow

With Node 24 or a compatible runtime providing `node:sqlite`, run:

```sh
node --max-old-space-size=256 --max-semi-space-size=4 --expose-gc \
  source/stellar/scf-starforge-20261009/sf30-seller-sdk/canadabuys/examples/apm2/continue-customer.mjs

node --max-old-space-size=256 --max-semi-space-size=4 --expose-gc \
  source/stellar/scf-starforge-20261009/sf30-seller-sdk/canadabuys/operator/OPERATING_TOOLS.mjs \
  --source-root source --case-root "$CANADABUYS_CASE_ROOT"
```

Run these commands from the original customer root, with absolute executable paths where required by the caller's runtime. The first command:

1. Reopens the existing operator and receiving databases and verifies the original source capture.
2. Continues the saved HTTP operation, reconciling its original review, workshare and receiving identities.
3. Downloads complete HTML, CSV and JSON reports and the same full workspace package used by the receiver.
4. Prepares and previews the source-preserving merchant publication.
5. Closes and reopens both SQLite workspaces, retaining the 908 notices, complete original source and saved workshare.

The native API helper checkpoints each write intent and provider result using atomic files. The customer driver records the start and completion of each client call, together with actual process memory. A lost response is reconciled against the saved workshare or content-derived package receipt when the same operation resumes.

The second command loads the actual Applications registration and the registered 37-tool MCP provider, pages the original notice collection, downloads the complete original CSV through retained-file chunks, and reassembles the original merchant payload. Retain its completed `tool-journey/operating-*/result.json`; an already completed result belongs to this customer and should be reused on a later browser continuation.

## Continue the visible browser workflow

After the HTTP customer is complete, use the existing supported Chromium/Headless Shell runtime and Playwright installation. Set `CODEX_PRIMARY_RUNTIME_NODE_MODULES` to the installed module directory. Set `CANADABUYS_BROWSER_EXECUTABLE` when the accepted browser is at a different path.

```sh
node --max-old-space-size=256 --max-semi-space-size=4 --expose-gc \
  source/stellar/scf-starforge-20261009/sf30-seller-sdk/canadabuys/examples/apm2/continue-browser.mjs
```

This phase opens the original saved workshare through the industrial operator UI, downloads its source, reports and package, and uses the visible receiving form in the same receiving workspace. The existing source-owned `operateCanadaBuysDesk` helper captures the notice, source, qualification, partner-workshare, report and receiving screens. The driver checks the full source hash, receiving review/workshare agreement, original workshare identity, engineering fee and browser errors.

The browser phase retains its own completion or failure in `case-result.json` while preserving the completed HTTP/merchant result. It closes only the browser and servers it started. Actual screenshots remain under the original journey directory, with an inspection copy when the shared workspace can accept one.

## Preserve the completed customer

After each admitted programme ends, preserve the updated original databases, operating records, reports, source bytes, publication and browser captures in the same customer archive. Replace the known artifact version only after reconciling the previous save result. Record the actual executed source commit, phase results and artifact identity in the original internal opportunity thread. Open the resulting browser captures before presenting the visual handoff.

## Capacity and cost planning

Open **APM2 capacity planner** from the procurement navigation, or open [the standalone planner](capacity/index.html) with its sibling assets. The [operating guide](capacity/GUIDE.md) covers complete editable multi-scenario telemetry, measured transfer/storage/queue factors, explicit currencies and cost periods, JSON receiving and the source-linked report. Each project retains its own measurements and authored decisions as portable JSON.


## Continue the exact outgoing rendered delivery

The original browser course now continues through `operator/RENDERED_DELIVERY.mjs` after receiving the saved package. It uses the same browser context, original operator URL, notice/workshare identity and receiving URL. It opens populated bilingual notice, complete source, qualification and workshare screens at 1440 and 390 pixels; operates an empty search and restores the saved notice; opens the original bidder profile, captured evidence, requirements and frozen decision; and compares the saved decision with its current context using the original read operation.

Every captured response document is downloaded through its saved browser control and matched to its exact saved byte count and hash. The original HTML handover, full HTML notice report and saved decision report open from their exact downloaded bytes. An intercepted local browser navigation supplies those bytes where file navigation is unavailable; Markdown/JSON evidence uses an explicitly identified readable text view. The same receiver reopens its saved workshare at narrow width.

The producer must open the returned PNGs and look at the actual desktop/narrow views and outgoing files. The course saves original screenshots, viewport/layout observations, document identities and any browser errors in `rendered-delivery/result.json`. It reports capture separately from the producer's inspection. Horizontal overflow is recorded with the actual viewport and document dimensions for repair. The course creates no new customer and saves no edited qualification, profile or decision.

The saved browser receiving is checkpointed before this rendering phase. A later render interruption reuses that complete original journey and its downloads; it does not receive the package again. Only the browser pages and services started by the caller are closed. Retain the images with the same original customer archive and return them to the producing peer for direct viewing and concrete corrections.

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.

Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999


## Maintain the editable response documents

The complete editable document handover now has a maintained [document regeneration entrypoint](response-documents/REGENERATE.md). It preserves the original notice, complete incoming files, earlier reading editions and selected capacity project while generating a new reading directory from an explicitly selected structured or Markdown source. Its workshare checker reports contradictory retained commercial statements without rewriting authored prose. Current PDF attachments remain bound to their exact rendered HTML and bytes.

Use the full authorized internal baseline and document directory from the original response-documents operation with `node response-documents/maintain.mjs --baseline /absolute/APM2_Base_Edition.json --source /absolute/current/edition --authority structured --output /absolute/new/edition`. The public generic source does not contain customer-priced document state or its private baseline. Copy the entire resulting directory to retain its source, history, capacity planner and next-edit tools. The original bidder-response case and submission owner remain unchanged.
