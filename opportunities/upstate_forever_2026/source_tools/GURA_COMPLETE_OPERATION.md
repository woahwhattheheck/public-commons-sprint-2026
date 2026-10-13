# Complete original Gura operation

Run the maintained original Gura workflow from one command: source-native reference and application baseline, original-polygon restoration planning, native-study maps and customer report, and broad native parameter studies. The operation retains one scientific Workspace and resumes its existing runs and cases.

## Run the existing operation

Use the equipped Python environment containing the original supported InVEST version, matching GIS dependencies and the application’s pinned engine modules. Place the original official `NDR.zip` and `SDR.zip` archives in the input directory. The maintained original receiver verifies their identities and original input arguments.

```bash
GURA_APPLICATION=/path/to/upstate_forever_2026
GURA_OPERATION=/path/to/gura-operation
GURA_PYTHON=/path/to/equipped/python

"$GURA_PYTHON" -B "$GURA_APPLICATION/source_tools/receive_gura_operation.py" \
  --application "$GURA_APPLICATION" --operation "$GURA_OPERATION"
```

The default scientific Workspace is `OPERATION/workspace` and the input directory is `OPERATION/inputs`. To continue an already retained scientific Workspace and archives elsewhere, provide both paths explicitly:

```bash
"$GURA_PYTHON" -B "$GURA_APPLICATION/source_tools/receive_gura_operation.py" \
  --application "$GURA_APPLICATION" --operation "$GURA_OPERATION" \
  --workspace /path/to/existing-gura-workspace --inputs /path/to/original-archives
```

The supervisor creates the operation directory when needed. Its saved operation manifest binds the resolved application, scientific Workspace, inputs and interpreter paths. Use those same paths on subsequent invocations. The established private `run_gura_operation.py` supervisor and this maintained entrypoint share the same operation schema and lock; the maintained command can resume that operation directly.

## Scientific workflow

| Phase | Maintained receiver | Result |
|---|---|---|
| Original reference | `receive_gura_native.py` | Both original native models, application baseline and their retained output comparison |
| Restoration planning | `receive_gura_planning.py` | Original subwatershed inventory, selected portfolio, actual combined restoration run and portfolio report |
| Customer release | `receive_gura_study.py` | Native-study maps, annual physical results, customer report and offline briefing |
| Parameter studies | `receive_gura_studies.py` | Original and selected-landscape case results, summaries and portable suite ZIP |

The original Gura cohort retains the release watershed in Kenya, original 15 m grid, 0.0225 hectare pixel area and zero added upstream buffer. Its original tables define agriculture class 5 and forest class 8. The planning receiver checks those definitions, changes only selected class-5 cells, and evaluates the selected combined land-cover treatment through the ordinary native model runner.

The complete operation explicitly selects 90% minimum common-valid polygon coverage. Each original subwatershed’s measured coverage and unfilled valid-cell support remain visible in the inventory and report. The planning precision rule preserves raw physical changes while treating changes inside the actual retained mass raster’s numerical encoding bound as zero for ranking.

The standard parameter suite contains 28 logical cases per landscape: four NDR cases, eight SDR cases and sixteen combined cases. Once the selected portfolio has an actual completed evaluation, the supervisor includes its landscape for another 28 logical cases. Completed matching native stages and previously completed cases are verified and reused by their original scientific identities.

## Resource use and interruption recovery

The supervisor executes one phase at a time. It sets numerical worker threads to one, GDAL’s cache to 64 MB, and `MALLOC_ARENA_MAX=2`. Temporary files use `OPERATION/tmp`, keeping this operation’s transient files on the same disk as the operation. Parameter cases use `--isolate-native-cases`, which releases each native interpreter’s memory before the next unfinished case. Original model parameters are retained.

The operation lease is `OPERATION/operation.lock`. An active phase inherits that lock file descriptor. The isolated study receiver validates the inherited descriptor against the retained operation lock file and scientific Workspace, then passes the operation, suite and batch leases to each active native case. If the supervisor disappears while a child is still computing, the child retains custody. A second invocation must wait for the original live operation to finish or be deliberately stopped. PIDs can be reused across containers; the lock and actual saved native progress identify the live operation.

Run the same command after an interrupted operation. Each receiver validates its retained source, runs and outputs, then continues unfinished work. The supervisor records a new numbered phase log and the driver’s SHA256 for each attempt. Old native artifacts, case IDs and earlier logs remain retained.

A failure while starting a child is recorded as that phase’s launch error. A persistence failure after a child starts triggers bounded cleanup of that owned process session before the original failure propagates. Any surviving descendant retains the lease, and the supervisor does not start another phase alongside it. If restoration planning fails, the customer-release phase remains waiting for planning while the original-landscape parameter studies can still progress. The final operation state is `partial` until all selected phases complete.

### An explicit receiving deadline

Supply an absolute instant for a time-limited receiving attempt:

```bash
"$GURA_PYTHON" -B "$GURA_APPLICATION/source_tools/receive_gura_operation.py" \
  --application "$GURA_APPLICATION" --operation "$GURA_OPERATION" \
  --deadline-utc 2026-10-13T14:00:00Z
```

The deadline belongs to this execution attempt and changes no scientific selection.
At the instant, the supervisor stops dispatching further phases and sends SIGINT
to the process session created for its current phase, including that phase's
native descendants. It permits ten seconds for ordinary interruption journals,
then uses SIGTERM and SIGKILL with bounded waits if necessary. SIGINT or SIGTERM
sent to the supervisor uses the same owned-session cleanup. Unrelated processes
and other Workspaces are outside that session.

The operation returns 130 and retains the original child return code, signal
actions, logs, completed phase results and exact continuation arguments. An
ordinary child signal or a parameter receiver's propagated interruption also
stops the entire attempt before another phase starts. The original operation
lease remains held by any surviving descendant, preventing another writer.
A completed phase that returned successfully during the stop stays complete.

On retry, the prior phase record is retained unchanged under
`attempts/<phase>/<sha256>.json` before its new attempt is recorded.
The saved `continue_argv` includes the selected deadline: an expired deadline
does not automatically open a new execution window. For a later authorized
attempt, explicitly select its new deadline or omit that option.

## Read actual progress and deliverables

The operation directory contains:

- `operation.json`: selected targets, active phase, attempt, child PID, driver hash, command, exit status and phase logs.
- `logs/<phase>-<attempt>.log`: complete original receiver output for each attempt.
- `gura-parameter-suite.zip`: exported parameter suite, after the suite receiver exports it.
- `workspace/gura-receiving/`: original comparison, planning state, native-study state and parameter-suite state.
- `workspace/runs/`: authoritative native run records, stage provenance and annual mass exports.
- `workspace/experiments/`: the retained parameter-study records and exports, addressed by their saved study IDs.

Individual receiver states and run records remain authoritative for the corresponding scientific stage. An interrupted supervisor’s old `running` field can be reconciled with its live lease, child process and completed native records on resume.

The native-study report can also be built directly from a completed original baseline and explicit completed land-cover alternatives. This is useful when the physical comparison is ready while additional parameter cases continue:

```bash
"$GURA_PYTHON" -B "$GURA_APPLICATION/source_tools/receive_gura_study.py" \
  --application "$GURA_APPLICATION" --workspace /path/to/existing-gura-workspace \
  --inputs /path/to/original-archives \
  --baseline-run-id ORIGINAL_COMPLETED_BASELINE_ID \
  --alternative-run-id ORIGINAL_COMPLETED_ALTERNATIVE_ID
```

Repeat `--alternative-run-id` to choose the report’s map order. The receiver checks the actual original grid, native model scope, baseline profile and land-cover alternatives, then binds the customer edition to that exact run cohort.

<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->
