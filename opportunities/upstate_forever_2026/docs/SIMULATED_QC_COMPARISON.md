# Continue the original field case into a retained QC comparison

This chapter consumes the completed simulated headwaters field operation. It selects its two original saved QC reviews and their explicitly declared eastern-tributary field-duplicate groups, saves a complete native comparison, retains its scientific source, and carries it through the existing delivery and whole-Workspace receiving workflow.

The original field records, laboratory source, scientific reviews, reviewer decisions and corrective task remain unchanged. The consumer reads those retained records; it does not prepare new samples or launch NDR, SDR or another scientific model.

**Needs expert review.** This is an explicitly authored teaching comparison. Its paired groups and criteria are part of the simulated input case. A difference in duplicate precision describes the selected original reviews; it does not establish environmental improvement, causation, model accuracy, sample acceptance or corrective-task closure.

## Original sources and ownership

Use the same completed operation returned by [the original field chapter](SIMULATED_FIELDWORK.md). Its native inspection must have schema **upstate.simulated-fieldwork/v1**, classification **SIMULATED DEMONSTRATION INPUTS** and phase **closeout**. The existing scientific Workspace retains its original project identity.

The comparison reads these named original steps and groups:

| Selection | Original field step | Original declared group |
| --- | --- | --- |
| Before | 04-initial-qc | right-initial-duplicate |
| After | 09-repeat-qc | right-repeat-duplicate |

It verifies each complete original request/result and native QC report through the original field inspector. The groups must occur exactly once, be declared field duplicates, and match the original design's selected observation IDs and criterion. The initial censored field blank remains unpaired and visible in the full original review.

Before and After are explicitly selected roles. This consumer intentionally uses the original initial collection as Before and the documented separate repeat collection as After. It does not sort arbitrary report names, dates or group arrays to infer a relationship.

The comparison's title, purpose and notes retain the simulated classification. Reviewer and date come from the original verified field-input manifest. The source binding retains the original recipe, complete input inventory, both report/review identities and chosen groups.

The maintained generic comparison evaluates the actual retained metrics and admissions. It withholds a difference when complete definitions, criterion, accepted qualifiers/QA status or evaluability differ, keeping the original values and reasons. See [Compare saved sample quality-control reviews](SAMPLE_QC_COMPARISON.md) for the complete scientific and operating contract.

## Continue the saved native case

Run from the received application's root, using its existing environment and original scientific Workspace:

~~~sh
python -m model.simulated_qc_comparison \
  --workspace /absolute/path/to/original-workspace \
  --field-operation ORIGINAL_FIELD_OPERATION_ID
~~~

Replace the path and field-operation ID with the actual values from that existing case. The identifier is the original field operation, not a model run, report ID or newly invented operation. The consumer derives its own deterministic comparison-operation identity from the original source and complete authored selection.

The returned JSON includes:

| Returned field | Meaning |
| --- | --- |
| schema | upstate.simulated-qc-comparison/v1 |
| operation_id | Stable native comparison operation |
| field_operation_id | Exact original field case |
| original_project_id, plan_id | Existing scientific project and plan |
| current_revision | Current plan revision at inspection; the selected original review revisions remain separately retained |
| phase | prepared, saved, or complete; continuation returns complete after scientific source retention |
| selection | Complete explicit original-pair selection |
| original_field | Original input, recipe and both review identities |
| comparison_report_id, comparison_id | Saved native report edition and scientific comparison identity |
| comparison | Full native retained comparison result, including its source files and complete pair details |
| report_source, delivery_selection | Actual retained source choice and its bound one-source scientific selection |
| browser_choice | Original project/plan/comparison/case identities for the existing recorded browser |
| retained_files | Full five-file original operation journal with Workspace-relative names, lengths and SHA-256 values |
| archive_selection | Exact comparison/case/report identity and retained journal inventory for the caller's whole-project export |
| directory | Workspace-relative original operation directory |

Keep the actual result with the existing driver. The native source API is:

~~~python
from model import simulated_qc_comparison

comparison_case = simulated_qc_comparison.continue_comparison(
    workspace, field_case["operation_id"]
)
~~~

Here **workspace** and **field_case** are the existing native objects/result. The consumer never creates another Workspace.

The new comparison can be opened through the existing **Implementation & fieldwork → Field records → Sample quality control → Compare saved QC reviews** desk. Choose **Open exact saved comparison** for the returned report ID. Read the two original source editions and the complete authored basis before interpreting the difference.

## Continue after interruption

The operation retains its own identity, original-field binding, full selection, saved report receipt and scientific-source receipt under:

~~~text
implementation/simulated-qc-comparisons/OPERATION_ID/
  operation.lock
  identity.json
  original-field.json
  selection.json
  saved.json
  scientific-source.json
~~~

These ordinary original Workspace files travel with the project. Create-only records reject conflicting content; the original per-operation lock prevents competing continuations from publishing into that journal.

Repeat the same **--field-operation** command after an interruption. It reuses the complete selected source. If the native report was saved but its response was lost, the comparison engine reopens the identical retained edition. If scientific-source import completed before its receipt was saved, the original source import is resumed from that saved report.

The source and selection determine the operation. Changing a title, criterion, pairing or original source is not an excuse to overwrite the old journal. For a separate reviewer-authored comparison, use the ordinary comparison desk and retain that distinct edition.

A later ordinary human edit to the current plan does not replace either original review. Inspection reopens the saved source editions and reports the current plan revision separately. A changed or missing original report, source byte or operation identity produces an explicit error; recover its actual original source through the existing receiving operation.

## Add the comparison to the existing mapped delivery

Keep the whole current delivery selection: original native run choices, maps, contacts, primary source role and any other existing report selections.

~~~python
delivery_selection = simulated_qc_comparison.attach_to_delivery(
    workspace, comparison_case["operation_id"], delivery_selection
)
~~~

The consumer preserves the existing selection and its report order. It appends any absent original observation-context, initial QC, repeat QC, initial closeout and repeat closeout sources, then appends the comparison. Existing primary-source metadata and every unrelated selection field remain intact; only the ordered observed-source list and its exact binding are refreshed.

Reapplying the same continuation does not add duplicate sources. If an existing selection deliberately places this comparison before its required five source reports, the consumer refuses to reorder that saved edition silently. Choose the intended original mapped-delivery selection explicitly and retain the previous one.

Use the augmented selection in the same maintained mapped-delivery/report call. The consumer returns a complete selection; it does not submit another model run or choose a new primary report.

The CLI can retain this complete new selection outside the Workspace:

~~~sh
python -m model.simulated_qc_comparison \
  --workspace /absolute/path/to/original-workspace \
  --field-operation ORIGINAL_FIELD_OPERATION_ID \
  --delivery-selection /absolute/path/to/current-delivery-selection.json \
  --delivery-output /absolute/path/to/new-delivery-selection.json
~~~

Both selection arguments are required together. The existing input is read as an ordinary JSON file. The output is create-only: a matching existing body can be reused, while different bytes are preserved and reported as a conflict.

## Bind the whole-project export to this comparison

Before the existing driver calculates its whole-project archive identity, join the actual comparison and retained journal:

~~~python
archive_selection = simulated_qc_comparison.attach_to_archive(
    workspace, comparison_case["operation_id"], archive_selection
)
~~~

Pass that complete augmented selection to the same original export function. It retains all existing model, field and customer IDs, and adds **simulated_qc_comparison** with this exact operation, field operation, plan, comparison report, comparison ID and five complete journal-file descriptors. An older field-only or customer-only archive therefore cannot be silently reused as the new comparison edition.

The returned **retained_files** identify identity.json, original-field.json, selection.json, saved.json and scientific-source.json under their actual Workspace-relative operation directory. Their original bytes travel with the whole scientific project. The saved comparison itself retains both original report banks and complete source companions through the existing Implementation archive path.

If an existing archive selection already names a different comparison, keep that original selection and explicitly prepare the desired new complete edition. Do not alter its old archive, strip the comparison identity to reuse it, or replace source IDs with local output filenames.

## Export and use the complete original reports

Export the actual saved comparison through its maintained native exporter:

~~~python
archive = simulated_qc_comparison.export_comparison(
    workspace, comparison_case["operation_id"],
    output_directory / "original-repeat-qc-comparison.zip",
)
~~~

Or add **--export /absolute/path/to/original-repeat-qc-comparison.zip** to the original continuation or inspection command. The archive lives outside the scientific Workspace.

The archive is the ordinary complete native comparison package. It includes the readable/printable report, full JSON, all-pair CSV, explicit selection, complete original source inventories and both unchanged original review ZIPs. The exporter verifies member names, lengths and hashes against the saved report.

Extract the comparison archive into a new directory and open **report.html**. Follow its original source links. Extract **before-review.zip** and **after-review.zip** into separate directories, then open each directory's **report.html**. Those archives preserve all original filenames so the original source links work.

Keep the actual exported archive identity returned by this execution. A receiver's newly produced outer ZIP may have its own file-level identity; its original members still verify against the same saved comparison. A sender's absolute output path is historical metadata, not a path to reuse on another machine.

A source-only CSV or screenshot is useful for explanation but does not contain the complete editable project. Carry the ordinary full scientific Workspace when the receiver needs the original field editor, history and saved comparison.

## Reopen after whole-Workspace receiving

Use the existing native project/Study transfer. The retained field operation, comparison journal, both original QC reports, scientific source collections and all companion records are ordinary Workspace members.

After the existing receiver opens the transferred scientific project:

~~~python
received_comparison = simulated_qc_comparison.inspect_comparison(
    received_workspace, comparison_case["operation_id"]
)
~~~

The equivalent read-only native command is:

~~~sh
python -m model.simulated_qc_comparison \
  --workspace /absolute/path/to/received-workspace \
  --inspect ORIGINAL_COMPARISON_OPERATION_ID
~~~

Inspection reads the same original identity and selection, verifies the completed field source, opens the retained native comparison and checks its scientific-source binding. It does not restart the field chapter or create another review.

Continue the received saved comparison in the normal desk. If a local ZIP is required, export from those actual retained sources to a receiver-owned output path. Preserve the original send/receive lineage and returned comparison IDs.

## Join the existing recorded rehearsal

The native result's **browser_choice** contains:

~~~text
project_id
plan_id
comparison_report_id
comparison_id
operation_id
field_operation_id
~~~

The current authenticated Operator supplies the actual **workspace_key** from its selected registration. A model Workspace does not infer that operator key from a folder name.

Pass that complete choice to the additive [recorded comparison browser chapter](SIMULATED_QC_COMPARISON_BROWSER.md). It joins the existing page, capture, checkpoint and recording owner. Keep the actual native comparison IDs and the same original case; do not create a second case or substitute a fresh unsaved comparison merely to obtain a screen.

The native comparison result and the actual browser's operated outputs remain separately identified. The producing worker must open and look at the real saved comparison, original report archives, scientific source and receiving application. Source review alone does not establish the outgoing layout or control behavior.

## Inspect and repair the outgoing product

Open the exact currently received application and look at the populated comparison at the actual screenshare width and at a narrow phone width. Read original definitions, criteria and withheld reasons; operate pair filtering and pagination, source links and complete exports. The review should lead directly to repairs of any clipped, confusing, stale or broken output.

Open the actual downloaded **report.html**, all relevant original report pages, both extracted original review packages, JSON/CSV and the editable received Workspace. Exercise the source-retention/Scientific Reports transition through the existing operator. Use the same recording and selected-source owner, and return any actual first exception with those original IDs.

The complete owner instruction is retained below for the producing/native workers who consume this guide.

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

