# Workflow history → XES process-mining handover

The existing History analysis panel can export one saved process cohort as an XES log. Choose **Activity start/end observations** or **Task start/end observations**, prepare the export, and download the XES, its mapping and row inventory, and the complete history source bundle together. Reopen that source bundle in the same panel to reproduce either event view.

This is useful when the analyst uses a separate mining application and needs the exact native instance and definition identities behind the exported observations. It uses the original captured data and the same explicitly selected process-start cohort. It does not query a new live engine or mutate native work.

## What the log means

Each trace is one exact original process instance. Each event is one valid, retained start or end timestamp from the selected original collection. The source capture may represent open or ended work and does not contain every event that occurred during execution. Task and activity observations are separate choices so a user task is not counted twice by concatenating overlapping collections.

| XES field | Original meaning |
|---|---|
| trace concept:name | Native process instance ID |
| event concept:instance | Native historic task or activity instance ID |
| event concept:name | Original task/activity name, falling back to its element key |
| flowable:definitionId | The child row's original definition ID; this may differ from the captured parent's edition after migration |
| flowable:elementKey | Original taskDefinitionKey or activityId |
| time:timestamp | Original timestamp normalized to UTC milliseconds |
| flowable:originalTimestamp | Original timestamp spelling, including its offset |
| lifecycle:transition | observed-start or observed-end |
| flowable:sourceRowIndex | Index in the exact captured original collection |
| flowable:classification | The history analyst's classification, with its explicit basis |

The log declares the custom lifecycle model **flowable-history-observations-v1**. **observed-end is not the standard complete transition.** Historic activity REST responses do not expose completion versus cancellation. Task completion classification comes from native deletion reasons, and process classification uses the native completed/cancelled state. Missing, unknown and inferred classifications remain explicit. The exporter never derives an activity outcome from its parent's outcome.

The declared classifier combines definition ID, native element key and observed boundary. All three attributes are present on every exported event; a missing child definition is represented as an empty value and remains a source-quality observation. Choose that classifier in the mining tool. Choosing only a friendly label can merge different definitions or elements. A downstream tool that only understands a standard lifecycle may need a consciously selected mapping; do not silently convert observed-end to complete.

## Cohort, coverage and order

The parent process start cohort is the History panel's existing interval [from,to). Events from the chosen rows are included only when their original timestamp is at or before the selected as-of. Their start/end observations can extend beyond the cohort interval; the interval selects process starts, not an event-time window.

No missing start/end is invented. Valid endpoints are retained independently even when the other endpoint is absent or invalid. A reversed source interval keeps its two actual timestamps and emits an explicit row observation. Rows with no usable timestamp or native element key remain in the original source bundle and mapping inventory. Rows outside the selected process cohort also remain in that complete source.

Events are serialized by UTC timestamp, original row ID, start before end for an exact same-instance tie, then original collection index. Equal-time ordering is a deterministic file convention, not a proven causal order. Empty selected traces remain visible and counted.

The mapping JSON accounts for every row in the selected original collection and retains all original History source-quality findings. It binds the XES byte length/hash to the exact history bundle, inventory and saved portfolio revision. It is not a replacement source or a claim of a transactionally atomic snapshot. The original capture was paged; retention, history configuration, permissions, deletion and migration affect its coverage.

The projection does not add assignees, business keys or business variables. The accompanying complete original source bundle retains its original contents and sensitivity; use the existing customer-authorized receiving boundary.

## Original command line and independent receiving

Generate a portable export from a complete saved history bundle:

~~~sh
flowable-history-analysis --bundle history.history.json \
  --xes activities --out ./history-xes
~~~

Use tasks instead of activities for the task view. The original command writes the full source bundle, history-activities.xes and history-activities.xes-source.json. Existing byte-different output files are not overwritten.

For the complete original workspace receiving path, add --xes to the established command:

~~~sh
flowable-history-analysis --workspace /absolute/original-workspace \
  --receiver /absolute/independent-workspace \
  --selection /absolute/history-selection.json \
  --operation CUSTOMER-HISTORY-XES-ORIGINAL-01 \
  --out /absolute/original-receiving \
  --xes activities
~~~

The source and receiving workspace IDs must be distinct. The command freezes the selected XES view with the original receiving input, writes all existing report/source files plus XES and its mapping, exports the original complete workspace, then stages and adopts it through the original model. It compares the exact selected capture revision and reproduces the entire source bundle, XES and mapping from the independently received workspace. The CLI closes and reopens that receiver and repeats the same exact reproduction. Existing operation/request IDs and the saved adoption input are reused after output loss.

The optional field is eventLog:'activities' or eventLog:'tasks' on receiveFlowableHistory. Omit it to preserve the original history receiving behavior and receipt shape. Add it only to a new deliberately selected receiving operation/output; changing an already frozen operation is rejected. A received result includes xes.collection, xes.file and xes.manifest alongside the original report, CSV, archive and receiving references.

## Source interface and practical limits

exportFlowableHistoryXes({bundleText,collection}) returns xml, manifest, manifestText and exact manifest byte/hash fields. It verifies the original history bundle before rendering. The existing service exposes method xes with the same arguments. The browser uses that service and rejects stale responses after the selected workspace, report or view changes.

The original History limits apply to capture and report input. XES and mapping are independently capped at 64 MiB before delivery. Invalid XML characters and oversized attributes reject export without rewriting original source values. Narrow the selected capture/cohort when necessary.

## Primary format and native sources

- Current standards publication: IEEE 1849-2023, https://standards.ieee.org/ieee/1849/10907/ .
- IEEE Task Force public XES definition: https://www.tf-pm.org/upload/1581077299780.pdf .
- Public serialization sample: https://www.tf-pm.org/resources/xes-standard/about-xes/sample-log .
- Concept extension: https://www.tf-pm.org/resources/xes-standard/about-xes/standard-extensions/concept .
- Time extension: https://www.tf-pm.org/resources/xes-standard/about-xes/standard-extensions/time .
- Lifecycle extension: https://www.tf-pm.org/resources/xes-standard/about-xes/standard-extensions/lifecycle .
- Maintained native contract: workspace/history-source-contract.json.

Output deliberately uses the public Task Force sample's XES 2.0 / XML 1.0 serialization profile, standard concept/time extension fields, and an explicitly named custom lifecycle. The public older definition's legacy schema appendix differs from its namespaced example; the product does not assert IEEE certification or a successful independent importer run based on source review. Retain the actual selected importer/version and opening outcome when using the delivered file.

## Open the actual delivered result

Open the exact running History panel at a wide screenshare size and a narrow/mobile size. Operate the populated, empty, loading and error paths; change between task and activity views while work is pending; change the capture or workspace; reopen the saved source bundle. Download each XES/mapping/source file and use it in the actual recipient-facing XML or mining application. Inspect the selected classifier, original IDs, UTC times, unknown endings and empty traces. Exercise the complete original receiving/cold-reopen course. Fix the affected product when an actual opening reveals a problem. Code execution or a source review does not constitute this opening.

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
