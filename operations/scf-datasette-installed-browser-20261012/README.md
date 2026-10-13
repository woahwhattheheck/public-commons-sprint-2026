# Installed Datasette application and browser continuation

This programme continues the already completed original publisher journey into the complete installed Datasette selection. It uses the maintained distribution builder, runtime installer, Applications review/save/start/stop operations, original Datasette HTTP client and a real Chromium browser.

The caller supplies the exact retained publisher programme directory and the full Git checkout containing the selected merged commit. Run the existing publisher programme through COMPLETE first so its received workspace, original WRI edition, merchant receiving files and finished shutdown/upload record are available.

## Run

Select Node 24 and the existing Playwright installation on the accepting host. Supply its module path when it is outside normal Node resolution. Retain an explicit source port and a distinct receiving port; browser recovery depends on reopening the same origin. The caller accepts both named chromium exports and the default.chromium export exposed by an existing CommonJS Playwright entry; it uses that same installed browser implementation.

```json
{
  "repository": "/absolute/public-commons-sprint-2026",
  "sourceRef": "e22cb42649f327ddf887fabc9abad227e3441da9",
  "publisherProgrammeDirectory": "/absolute/original-publisher-programme",
  "outputDirectory": "/absolute/installed-datasette-continuation",
  "playwrightModule": "/absolute/node_modules/playwright/index.mjs",
  "port": 53173,
  "receivedPort": 53174,
  "offline": false,
  "python": "python3",
  "npm": "npm"
}
```

The explicit sourceRef above is the immutable public source containing the complete Datasette selection, final browser recovery and customer Analysis SQL and query-job support. For a canonical repository that has its own commit history, omit sourceRef to resolve that checkout's HEAD to a complete commit SHA on the first invocation. The journey saves that resolved SHA with its original input before building. A rerun without sourceRef reuses the saved SHA even when repository HEAD has advanced; it never selects a new source implicitly. An explicitly supplied sourceRef must match the retained source on a rerun.

An existing populated npm cache may be supplied as npmCache; offline selects the maintained installer's offline dependency path. browserExecutable can select the host's installed Chromium executable.

```sh
node operations/scf-datasette-installed-browser-20261012/run-installed.mjs --input /absolute/installed-browser-input.json
```

The builder uses the pinned Git source with offline object reads. It creates a resumable complete Datasette product archive, then the original installer prepares and verifies that selected runtime. The full checkout must retain the source objects for that commit.

The journey records each runtime preparation target before invoking the maintained installer. If a preparation is interrupted before its complete plan and state are present, the next invocation preserves that directory and calls recoverRuntime into a retained recovery target. A partial dependency installation resumes in its same prepared directory. Managed Applications workspace initialization retains its chosen directory before creation. If creation ends before its complete workspace record exists, the next invocation preserves that original directory and records a separate recovery target before calling the original workspace creator. A completed workspace and its saved application identities always reopen in their original directory. Managed application reconnection uses applicationsConnect on the saved binding; pending and interrupted launches use applicationsRecover on the original run identity.

## Whole workflow

The installed source is checked for the original WRI gzip, customer Python stubs, maintained command entries and typed client exports. The programme attaches that READY runtime to a new managed Applications workspace, reviews the original received publisher directory, saves its application and starts its maintained launcher.

The desktop browser reads all 189 original rows and their 26 source positions, comparing displayed values and explicit cell types with the native edition response. It reads the original projection aliases, observation bounds and reusable WRI column declaration.

The browser then uploads the actual original WRI archive. A single transport interception allows the native upload to finish and drops only its response. The browser and managed application close and reopen on the same explicit port. The saved browser input finishes source receiving from the completed archive without reselecting the file.

A second actual response interruption exercises the original source-selection request receipt. The native source change completes once, and the browser resolves the saved requestId through the retained native request result.

The browser exports and downloads a complete source package and a complete source/publisher workspace ZIP, verifies the downloaded hashes, receives the ZIP into its own private directory and reopens that directory as a managed installed application. The installed Datasette command reads the same received workspace through its connection file. A mobile viewport opens the received edition, checks layout containment and retains a full screenshot.

The journey retains application reviews, start identities, stop outcomes, original upload/selection responses and downloaded archives in installed-browser-journey.json. Browser execution attempts retain their start time and error-history offset; a completed recovery checks its own error segment while preserving all earlier page errors. Screenshot completion is recorded after the image is written, and source/workspace downloads are marked complete only after their bytes match the original export receipt. Its normal completed result lists the product archive, source archive, workspace ZIP and desktop/mobile images. Continuing the same output directory retains the same source, publisher and receiving identities.

The separate customer Analysis programme continues its own analytical directory, saved queries, reports and workbook through its original receiver.

## Browser bindings after host recovery

When the same retained workspace moves to a recovered host, `playwrightModule` and `browserExecutable` may select the Playwright installation and Chromium executable available on that host. The original `state.input` remains unchanged, and the source commit, repository, publisher and receiving workspaces, output directory, workspace identity, and ports must still match the saved programme. `browserRuntimeSelections` records the original browser binding and each changed binding with its timestamp and preceding selection. Each `browserAttempts` entry records the selected Playwright module, actual executable path, and executable version used for that attempt. Continue the same output directory and journal to retain the original programme and browser profile.

## Save the installed runtime before managed adoption

The original delivery controller selects `installedCheckpoint: {protocol: "controller-stdio-v1", operation: "SCF-DATASETTE-SOURCE-EDITIONS-07476-20261012"}` as an execution option. This transport selection stays outside the retained business input. Standalone invocations may omit it; the complete delivery controller always selects it.

After the complete selected distribution is built, installed, reopened as READY, and its source/types/commands verified, the runner retains `INSTALLED_SOURCE_VERIFIED` and a stable request in `installedCheckpoints`. The request binds the original journal and workspace IDs, exact source commit, complete build archive path/bytes/SHA, installed runtime directory and source root. The runner then waits on its existing stdin for the matching controller acknowledgment before importing the application workspace or starting managed adoption.

Only this installed child receives a stdin pipe. Its original Python controller reads the request from stderr, validates the current journal and full build archive, and calls its existing `persist_complete_phase` under the original delivery lock. The same complete root, operating report, original journals, source, Git objects, installed runtime and build output are preserved. The checkpoint has the honest `INSTALLED_SOURCE_VERIFIED` state and distinct filenames:

- `Datasette_Installed_Ready_Result.json`
- `Datasette_Installed_Ready_Checkpoint.zip`
- `Datasette_Installed_Ready_Checkpoint_Parts.json` when complete part delivery is needed

Existing publisher and final operating filenames keep their behavior. The controller retains its complete archive or complete ordered parts receipt at `run-history/installed-ready-checkpoints/<request-id>.json`, saves that receipt with the same maintained helper, and records the upload identity beside it. Only then does it send a successful acknowledgment. The runner records that receipt, saves `INSTALLED_SOURCE_CHECKPOINT_SAVED`, and continues its original Applications/browser journal. Checkpoint latency counts toward the selected installed invocation timeout; a save that returns after that timeout receives a failed acknowledgment and cannot release managed adoption.

A controller failure, closed control pipe, mismatched identity or failed save rejects the wait and preserves the runner's original interrupted state. A resumed request with the same local saved receipt reuses its complete checkpoint. When restoring this checkpoint, also restore its separately saved receipt to the exact run-history path; the complete archive necessarily contains the pending request that preceded its own upload. Carry the matching upload sidecar when available. Without that sidecar, the controller saves the existing small receipt again. Without the receipt, the complete root remains reopenable and the same stable request saves another full checkpoint before proceeding. An already acknowledged journal reuses its exact saved delivery. No path, original input, source ref or completed application state is substituted.

## Pinned following source

The complete controller also accepts an optional `after_installed_source` object with full `content` and its `sha256`. It executes only after the installed journal reaches COMPLETE, the final complete checkpoint is saved, and the original delivery lease is closed. The controller checks and retains the full source under `continuation-source/<sha256>.py`, then invokes it with `delivery_payload` and `delivery_root`. Start, return and failure events remain on the existing receiving stream; a following-source failure keeps the retained receiver available. The following operation owns its own original lock, journal and output saving.

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.

Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
