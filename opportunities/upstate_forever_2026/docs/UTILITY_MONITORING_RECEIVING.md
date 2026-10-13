# Receive original utility reports and Monitoring in one native course

The receiver carries the original source collection through the same Regional watersheds provider used by the operator, then prepares the exact utility Monitoring networks and reopens their saved products in a fresh Workspace reader.

## Run the complete source-to-network course

Use the existing scientific Workspace and its GIS environment. Keep the application checkout fixed for the duration of each course.

~~~sh
python -B source_tools/receive_utility_monitoring.py \
  --workspace /absolute/existing/scientific-workspace \
  --operation /absolute/existing-operation/utility-monitoring
~~~

The operation directory must be outside both the application and the Workspace. The default receives ARJWS and PRWD/Pioneer. Repeat --utility ARJWS or --utility PRWD to select one. The original sampled station locations are included; --without-microbial creates an explicitly station-free edition.

The Workspace must contain the original 217-HUC polygon source. If its original upstate.sources/v1 manifest is available but not imported, supply --domain-manifest /absolute/original-domain/sources.json. Selection still verifies the original decoded geometry SHA256; this option does not substitute a different domain.

The course uses source/water_context/20261013/complete-native-sources.json by default. It verifies and imports that complete original source edition, including its 303-record native topology and original companions. --context-directory and --source-manifest can identify an existing complete retained edition on the receiving host.

## What completes

1. Import the verified complete source edition into the existing Workspace.
2. Invoke the current Regional watersheds analysis provider and save its original regional report.
3. Select each original available utility profile and invoke the same saved-export provider used by the browser.
4. Prepare the native whole-HUC receiving-water footprint, original datum-aware station view and Monitoring network.
5. Retain the complete source report ZIP, selected watershed JSON, original utility profile and preparation method in the external receiving directory.
6. Open a fresh Workspace reader and verify the regional report, every original report file, utility export, receiving plan, native network, full domain membership and utility candidate membership.

The output receiving.json gives actual saved report, source collection, utility export, receiving plan, Monitoring bridge and network IDs, with original HUC lists, station-assignment issues, scientific scope and reopened identities. state.json exposes the current phase and first exception. It identifies an actual execution only after this native command runs.

The Regional watersheds desk lists the saved report and exports. The existing Monitoring desk can open the returned network ID directly. Its original design/campaign controls retain the exact prepared geography.

## Supply an actual programme when ready

--programme /absolute/actual-programme.json additionally solves the supplied native design and creates an editable campaign when its result is feasible. The receiver supplies no budget, calendar dates, setup/visit costs, station credit or upstream representativeness assumption.

The file has this structure; configuration is the complete original Monitoring configuration from the reviewed programme:

~~~json
{
  "schema": "upstate.utility-monitoring-programme/v1",
  "title": "Actual reviewed utility programme",
  "utilities": {
    "ARJWS": {
      "title": "Actual ARJWS programme title",
      "configuration": {}
    }
  }
}
~~~

Replace the empty configuration object with the real native configuration before execution. The original solver requires a complete calendar and budget; its ordinary cost and design validation remains authoritative. Include PRWD with its own title/configuration for a second selected programme. A programme may name only utilities selected by this receiving command.

The receiver retains the exact original programme bytes and both supplied/effective configurations. It unions the prepared context-HUC exclusions into the effective excluded_ids, preserving any additional original exclusions. This keeps candidate selection inside the selected utility footprint while the full original graph remains available. Required IDs, station choices, costs, calendars, strata and other native constraints are passed unchanged and validated by the existing solver.

The actual native solver result is retained with its original status and diagnostics. A feasible/optimal result creates its campaign with a deterministic original operation identity. Infeasible or time-limited results retain their real status. A resume reuses an already saved result for the exact original decision, including one saved immediately before a process stopped writing its course checkpoint.

The returned design records include the original plan ID, selected IDs, status, original/effective configuration and, when created, exact campaign/revision IDs. No field event or sample is generated.

## Continue that saved campaign through fieldwork

The maintained native fieldwork course takes the actual IDs returned above:

~~~sh
python -B source_tools/receive_monitoring_fieldwork.py \
  --workspace /absolute/existing/scientific-workspace \
  --operation /absolute/existing-operation/utility-fieldwork \
  --campaign-id ACTUAL_CAMPAIGN_ID \
  --revision-id ACTUAL_REVISION_ID
~~~

It receives the original campaign into Implementation, retains the field report and original packet, transfers the complete application/Workspace and verifies the exact revision after fresh receiving. Keep separate operation directories for distinct utility campaigns. Actual field events, meeting notes, station commitments and sample results remain recorded through their existing native controls.

The utility source briefing remains in its original saved export and complete ZIP. The source-report → actual Meeting notes → Implementation path is documented in docs/UTILITY_SOURCE_BRIEFING.md. It can support the same utility work alongside the Monitoring campaign.

## Scope and interpretation

ARJWS retains its four original whole HUC12s. PRWD/Pioneer retains its 32 original whole HUC12s, including their cross-state context. The saved source report uses the original 303-record topology; the native Monitoring network retains the complete 217-polygon graph. Differences are present in the preparation method and must inform outlet-context interpretation.

Monitoring target weight is EPSG:5070 vector overlap hectares with the selected whole-HUC footprint. Original NRCS designation areas, sampled microbial concentrations, regional nutrient/flow observations and native annual pollutant masses keep their distinct source meanings.

The historical five/31 station assignments come from original utility-source membership. Native polygon assignment and any outside-domain/boundary issues remain visible. Historical presence alone grants no existing-programme credit. The 589 regional nutrient records retain their original regional scope.

## Resume and source preservation

selection.json binds the original Workspace, exact original domain source edition, selected utilities, exact original source manifest/input hashes, exact programme bytes and all composing source files. Resume the same path with the same pinned implementation and inputs. The retained domain choice is reopened explicitly, so an unrelated imported edition cannot change automatic source selection during resume. Use a new operation directory for a deliberately changed source or programme edition.

Native report/export/preparation records remain owned by their existing maintained engines. The receiver's external state records coordinate those products; they do not replace them. A fresh read verifies original source files before completion. Errors are retained with their actual type/message, then raised to the native caller.

The complete source-to-network course reads existing originals and executes native vector/network preparation. It does not download another source family or run InVEST.

## Continue the existing native receiving course

The same `source_tools/receive_utility_monitoring.py` accepts `--source-review /actual/upper-savannah-source-review.json`. Use a **complete utility planning area** review for this source-to-Monitoring course. The supplied review must belong to one of its selected ARJWS/PRWD utilities. Filtered and focused reviews use the Regional watersheds desk and its ordinary saved export instead.

The receiver binds the exact incoming bytes in its original immutable selection and retains `original-source-review.json` in the existing operation. The matching utility uses the same native export action with that text. The other selected utility retains its ordinary original selection. Fresh reopening verifies the original review hash, its bound source selection, the saved report and the original native network. Existing programme costs and dates continue to come from the explicit programme input.

Use the current accepting operation's real application, interpreter, Workspace and output directories. Keep the application pinned during a native run. Resume an issued course with the same exact inputs; to add a later review to an already completed course, use its reopened Regional watersheds desk and save the reviewed export there. The source review does not replace an existing operation's immutable selection.

Open the populated native HTML brief, source briefing and extracted complete ZIP. Operate the explorer at the actual screenshare and 390-pixel width, download the original review, import it, reopen its report and inspect the exact rendered discussion labels and area/geographic scope. Return the actual original report/export/network IDs and the first runtime exception through the existing receiving thread so the producing owner can repair it directly.

## Current owner product inspection instruction

The following is the complete current project instruction, source version `2026-10-13.1`, retained here for the native receiving worker.

# Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. This instruction does not extend or restart the Ecosystem sprint: the existing cutoff is October 13, 2026 at 10:00 a.m. America/Kentucky/Louisville, 14:00 UTC.

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
