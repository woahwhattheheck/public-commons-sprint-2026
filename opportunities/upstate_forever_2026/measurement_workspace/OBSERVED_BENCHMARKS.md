# Observed water-quality benchmarks

This additive family works inside the existing Upper Savannah Measurements component. It uses the original source parser, SQLite workspace, authenticated extension, registered browser host, exports table and complete receiving routes. It adds no native engine, source acquisition, application database or regulatory standard.

## Start with the actual original files

Receive WQP or supported USGS daily sources through the existing Measurements source-intake workflow. Original raw values, reported units, complete text, mappings, rejected rows, source-line references and native review history stay owned by that workspace.

Open **Measured observations → Water quality benchmarks**. Choose an exact cohort, its original source files, station IDs and calendar range. The cohort includes source kind, reported characteristic, native parameter, fraction, normalized unit, **quantity basis** and method. “mg/L as N” and “mg/L as NO3” cannot share a threshold merely because both use mg/L. No unit or chemical-basis conversion is added here.

Choose whether to use only explicitly included native observations or all observations not excluded. An analyst must supply the threshold, comparison direction, period grouping, minimum observed sample count, reference title, exact reference location and scientific rationale. The optional maximum condition fraction is an explicitly entered decimal between 0 and 1; blank means report observed counts without a period-fraction decision. There are no preselected thresholds, jurisdictions, minimums, fractions, regulatory applicability decisions or pass/fail defaults.

## Compare the complete source population

Preview reparses the full original selected files through the original normalizer. It freezes the exact source bytes and original mappings with all selected observation and native review contexts. It does not use a truncated screen page. The selected cohort and station must exist in the complete original files. Cohort metadata is frozen independently of displayed rows, so a calendar range with no observations remains an honest empty result with its exact quantity, unit, basis and method.

Each observation is classified as condition, not-condition, indeterminate or excluded. Supported detection intervals are compared conservatively. A native '<' or '>' is an open bound only when the original parser explicitly says that the reported comparator supplied that bound. An unknown condition, conflicting detection direction, absent numeric bound or source condition awaiting scientific inclusion remains indeterminate. There is no zero, half-limit or detection-limit substitution.

Complete alternate versions remain attached. Versions sharing a native result identity are one potentially uncertain sample, not independent replicates. The analyst may select an exact version with a reason; otherwise conflicting versions remain indeterminate. An unresolved result whose versions disagree on its original date is **unallocated**: it contributes no sample toward a station-period minimum. All affected original dates, including versions outside the initial date/cohort filter, remain visible. Selecting an exact original version assigns that single sample to its original date. Original native excluded rows remain excluded.

Different native sample identities remain distinct. Identical normalized rows occurring on multiple source lines retain all provenance links but are counted once as the original Measurements record. The application does not infer laboratory replicate independence or sampling representativeness.

Calendar month, year and selected-range reports include empty selected periods. Sample mode reports the original logical sample. Every period gives condition count bounds, exact numerator/denominator fraction bounds, indeterminate results, excluded rows, unallocated date conflicts and minimum support. Above-rule and within-rule compare only the supplied analyst fraction. They are not compliance, impairment, safety or representative-period findings. A fraction is not reported when there are no allocated observed samples.

No arithmetic/geometric mean, flow weighting, statistical significance, rate, load or model calibration is computed by this family. Existing flow/load/trend/calibration owners remain authoritative.

## Saved editions, unfinished work and uncertain responses

Save the exact preview. The browser first retains its complete raw working copy and exact pending request. Study saves, working-copy snapshots and accepted request receipts use the original SQLite owner transaction and exports table. They do not advance the measured-input revision, so preserving a pending draft cannot invalidate its own preview. Source, mapping and native review changes continue to use the original measured revision.

Every saved study is immutable and content-addressed. A new edition names its original parent and study UUID; concurrent branches and all prior editions remain visible. The save request has one UUID and exact body. Accepted-request replay occurs before current-source checks and returns the original receipt. An uncertain response is recovered by reading or retrying that same request.

A 404 status read alone does not cancel an in-flight save. Explicit retirement uses **the original atomic abandon operation**, carrying the exact request and attributed reason. An already committed result wins; otherwise the same transaction writes a tombstone under the original UUID/body. A delayed save cannot then create a study. The complete retired request and reason remain in history.

Unfinished working copies retain invalid and incomplete raw editor text. Blank unfinished attribution stays blank; actual saved scientific studies require an identified analyst. The last structured source selection, complete original files/context and any original pending body are preserved. An invalid source selection is retained as raw work with an explicit source-snapshot error; it is not executed or reported as a completed source selection.

Within Measurements, tab changes, refresh and complete project export first retain unfinished work. The outer registered application has no pre-workspace-change hook; its existing workspace/person request guard remains intact. The extension therefore holds full per-person/per-workspace snapshots across synchronous detach/remount, warns before page unload when unsaved snapshots remain, and never writes through a stale identity. Return to that original workspace to save the snapshot or download the working copy.

## Complete export, receiving and reopened edits

- **Complete comparison JSON** contains one frozen study, calculation and every full original selected source.
- **Readable report HTML** is self-contained and contains the complete study, all rows, original text and source download controls. Open it, use the controls and inspect its original attachments.
- **Every row CSV / every period CSV** contain full populations, not the current display page. They use the existing spreadsheet-safe derived CSV encoder; original source text and JSON preserve the untouched raw literals.
- **Complete studies JSON** includes every saved study edition, original parent/source-basis histories, complete unfinished working copies and accepted/retired request receipts.
- The original **complete Measurements workspace JSON** and **large Measurements ZIP** also include this family in their original exports table. Receiving validates the entire benchmark family before admitting those original native archives.

Every save, draft retention, retirement and receiving transaction validates the entire resulting retained project, including its new receipt, against the complete 128 MiB transport bound (64 KiB is reserved for the receiving request and original bridge envelope) before committing. An over-limit attempt rolls back and leaves the previous exportable history intact.

Receiving a benchmark project unions exact immutable identities with the existing workspace. It rejects differing bytes for an existing identity and preserves later local studies, drafts and operations. Original receive UUID/body replay returns its first receipt. The browser offers the exact receiving request file so a disconnected receive can be retried with its original identity.

A received saved study can be opened without original live imports. To author a following rule edition, select its explicit historical source basis. A received unfinished draft likewise points to its exact saved draft basis; the original pending request itself is never rebound. Only source rows and contexts actually captured in that basis are available. Expanding to other original observations requires selecting the current original source basis, not inventing historical review context.

No study view mutates the existing native observation reviews, source selections, station assignments, flow studies or model outputs.

## Original CLI and HTTP surface

Use the original Node 22.16+ Measurements CLI:

```sh
node measurement_workspace/engine/cli.mjs benchmark-catalogue --workspace ./data --output catalogue.json
node measurement_workspace/engine/cli.mjs benchmark-preview --workspace ./data --file definition-request.json --output preview.json
node measurement_workspace/engine/cli.mjs benchmark-drafts --workspace ./data --file exact-draft-request.json --output draft-receipt.json
node measurement_workspace/engine/cli.mjs benchmark-save --workspace ./data --file exact-save-request.json --output receipt.json
node measurement_workspace/engine/cli.mjs benchmark-request --workspace ./data --id ORIGINAL_REQUEST_UUID --output original-receipt.json
node measurement_workspace/engine/cli.mjs benchmark-abandon --workspace ./data --file exact-abandon-request.json --output retirement.json
node measurement_workspace/engine/cli.mjs benchmark-read --workspace ./data --id STUDY_SHA --output study.json
node measurement_workspace/engine/cli.mjs benchmark-report --workspace ./data --id STUDY_SHA --output report.html
node measurement_workspace/engine/cli.mjs benchmark-rows --workspace ./data --id STUDY_SHA --output rows.csv
node measurement_workspace/engine/cli.mjs benchmark-periods --workspace ./data --id STUDY_SHA --output periods.csv
node measurement_workspace/engine/cli.mjs benchmark-project --workspace ./data --output complete-studies.json
node measurement_workspace/engine/cli.mjs benchmark-receive --workspace ./recipient --file exact-receive-request.json --output received.json
```

HTTP uses the original /api/measurement-workspace/benchmarks namespace: GET catalogue, project, studies/:id, drafts/:id and requests/:id; POST preview, save, drafts, abandon and receive. Saved study downloads use studies/:id/report.html, rows.csv and periods.csv. The existing authenticated registered host carries the same calls through /api/measurements/rpc. No external service or credential is added.

A preview takes {definition}. Save retains {request_id,expected_revision,expected_preview_id,definition}. The expected revision belongs to the preview's current or explicitly historical input basis. A working-copy append takes {request_id,draft}. Abandon takes {request:exactOriginalSave,actor,at,reason}. Receive takes {request_id,actor,at,note,project}. Keep these full original request files when operating through the CLI.

Complete studies are bounded at 64 MiB, authored raw draft text at 4 MiB, source-backed draft snapshots at 64 MiB and complete benchmark projects below 128 MiB (64 KiB reserved for receiving metadata). Each comparison admits at most 100,000 retained native records and 100,000 station-period cells. Refusal preserves original files and existing work; nothing is silently truncated. The original larger native Measurements archive remains available for complete workspace delivery.

## Integration and validation status

Generic source is composed in the existing public application. Native normalization is unchanged. The engine-only source course exercises exact decimal thresholds, open/closed detection boundaries, ambiguous source variants, missing periods and sampling denominators using the actual functions with controlled values. These are source-function checks, not field measurements, completed customer studies, native SQLite/browser execution or rendered acceptance.

The final native and browser course belongs to the original equipped Eco receiving owner. Use actual retained original observations and a clearly attributed analyst rule. Operate source selection, ambiguous versions, unfinished draft/reload, same-request recovery, saved report/CSV, complete project export and independent reopen. Actually view the final screens and attachments before calling them ready.

Current owner direction: CURRENT_OWNER_DIRECTION.md version 2026-10-13.4. Preserve the existing ongoing native simulations, application/receiver owners and call preparation. This module does not dispatch a new model run or contact the prospective customer.

## Complete producing-worker instruction

# Owner-directed rendered-product inspection

<!-- ecosystem-current-owner-direction:begin -->
Read [CURRENT_OWNER_DIRECTION.md](CURRENT_OWNER_DIRECTION.md), version `2026-10-13.4`, for the active Ecosystem demo/presentation/build direction. Execute the prepared simulated model on the verified native runtime and show actual outputs and editable handoff. Carry the complete brief into current child/provider/cloud work orders and handoffs, include its path/version with the next result, and relay it onward at the actual coordination surface. Keep active compute and the broad product build moving under Bryce's October 13, 10:46 a.m. Eastern renewal to finish as much as possible before his call; preserve every other existing owner control.
<!-- ecosystem-current-owner-direction:end -->

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. The earlier October 13, 10:00 a.m. Eastern / 14:00 UTC cutoff was superseded by Bryce's direct 10:46 a.m. instruction in CURRENT_OWNER_DIRECTION.md version `2026-10-13.4`. Continue existing unfinished Eco work toward the call while retaining completed outputs and active process ownership.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.


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
